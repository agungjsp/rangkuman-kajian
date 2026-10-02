"""Parse a kajian transcript and optionally draft source-linked study notes."""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from contextlib import nullcontext
from itertools import groupby
from pathlib import Path


ENTRY = re.compile(r"^\*\*([0-9]+:[0-9]{2}(?::[0-9]{2})?)\*\*\s*·\s*(\S.*)$")
USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0"
TOPICS = {
    "opening": "Greetings, channel advertisement or introduction",
    "teaching": "Explanation of the main teaching or a religious concept",
    "dalil": "Quran, hadith or scholarly references cited as evidence",
    "story": "A narrated event, story or historical example",
    "analogy": "An analogy or practical illustration",
    "qa": "Audience questions and answers",
    "closing": "Closing prayer, conclusion or farewell",
    "other": "None of the listed categories dominates",
}
SUPPORT_CRITERIA = {
    "supports": "The cited transcript passages, read with nearby context, support every substantive part of the claim as a report of what the speaker said. This does not verify religious truth or external attributions.",
    "contradicts": "The cited transcript passages say the opposite of a substantive part of the claim.",
    "insufficient": "The citations are related but omit, only partly support, or do not address a substantive part of the claim. Nearby uncited context cannot supply a missing claim.",
}
REVIEW_PREFIX = "**[Perlu ditinjau]** "
CONTRADICTION_PREFIX = "**[Bertentangan dengan sumber]** "
INSUFFICIENT_PREFIX = "**[Kutipan tidak cukup]** "


def timestamp_seconds(stamp: str) -> int:
    parts = [int(part) for part in stamp.split(":")]
    if parts[-1] >= 60 or (len(parts) == 3 and parts[1] >= 60):
        raise ValueError(f"invalid timestamp {stamp!r}")
    return sum(part * scale for part, scale in zip(reversed(parts), (1, 60, 3600)))


def parse_transcript(text: str, title: str = "Kajian tanpa judul") -> dict:
    lines = text.splitlines()
    start = lines.index("## Transcript") if "## Transcript" in lines else -1
    body_start = start + 1
    if start == -1:
        if lines and lines[0].strip() == "---":
            try:
                body_start = lines.index("---", 1) + 1
            except ValueError as exc:
                raise ValueError("unclosed metadata block") from exc
        else:
            while body_start < len(lines) and (not lines[body_start].strip() or lines[body_start].startswith(("title:", "source:"))):
                body_start += 1

    metadata = {"title": title, "source": ""}
    for line in lines[:body_start]:
        for field in ("title", "source"):
            if line.startswith(f"{field}:"):
                metadata[field] = line.partition(":")[2].strip().strip('"')
    metadata["title"] = metadata["title"] or title

    body = lines[body_start:]
    timed = any(re.match(r"^\s*(?:\*\*|\[)[0-9]+:[0-9]", line) for line in body)
    if not timed:
        passages = []
        raw = "\n".join(body)
        for paragraph in re.finditer(r"\S[^\n]*(?:\n(?!\s*\n)[^\n]+)*", raw):
            remaining = paragraph.group().strip()
            offset = paragraph.start()
            while remaining:
                end = len(remaining)
                if end > 1600:
                    boundaries = list(re.finditer(r"\s+", remaining[:1601]))
                    end = boundaries[-1].start() if boundaries else 1600
                piece = remaining[:end]
                passages.append({"id": f"P{len(passages) + 1:03}", "timestamp": None, "seconds": None,
                                 "line": body_start + raw[:offset].count("\n") + 1, "text": piece})
                tail = remaining[end:]
                offset += end + len(tail) - len(tail.lstrip())
                remaining = tail.lstrip()
        if not passages:
            raise ValueError("transcript has no text")
        return {**metadata, "format": "plain", "passages": passages}

    passages = []
    duplicates = Counter()
    previous = -1
    for line_number, line in enumerate(body, body_start + 1):
        if not line.strip():
            continue
        match = ENTRY.fullmatch(line)
        if not match:
            raise ValueError(f"line {line_number}: malformed transcript entry: {line[:80]!r}; use timestamped entries throughout or remove timestamps for plain-text input")
        stamp, content = match.groups()
        try:
            seconds = timestamp_seconds(stamp)
        except ValueError as exc:
            raise ValueError(f"line {line_number}: {exc}") from exc
        if seconds < previous:
            raise ValueError(f"line {line_number}: timestamp {stamp} is out of order")
        previous = seconds
        duplicates[seconds] += 1
        suffix = f"-{duplicates[seconds]:02d}" if duplicates[seconds] > 1 else ""
        passages.append(
            {
                "id": f"T{seconds:06d}{suffix}",
                "timestamp": stamp,
                "seconds": seconds,
                "line": line_number,
                "text": content.strip(),
            }
        )
    if not passages:
        raise ValueError("transcript has no timestamped passages")
    return {**metadata, "format": "timestamped", "passages": passages}


def make_chunks(passages: list[dict]) -> list[dict]:
    chunks = []
    if passages and passages[0]["seconds"] is None:
        members = []
        length = 0
        groups = []
        for passage in passages:
            if members and length + len(passage["text"]) > 4000:
                groups.append(members)
                members, length = [], 0
            members.append(passage)
            length += len(passage["text"])
        if members:
            groups.append(members)
    else:
        groups = [list(group) for _, group in groupby(passages, key=lambda passage: passage["seconds"] // 120)]
    for group in groups:
        members = list(group)
        chunks.append(
            {
                "start_id": members[0]["id"],
                "end_id": members[-1]["id"],
                "text": "\n".join(f"{p['timestamp'] or p['id']} {p['text']}" for p in members),
            }
        )
    return chunks


class TypeSafeError(RuntimeError):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"TypeSafe returned HTTP {status}: {detail}")


def ask_jev(state: dict, questions: dict) -> dict:
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise RuntimeError("TYPESAFE_API_KEY is not set")
    request = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=json.dumps(
            {"state": state, "model": "jev-latest", "questions": questions},
            ensure_ascii=False,
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read(8192).decode("utf-8", errors="replace").replace(key, "<REDACTED>")
        raise TypeSafeError(exc.code, detail[:1200] or exc.reason) from exc


def label_chunks(chunks: list[dict]) -> list[dict]:
    from operations import progress
    progress("analysis", 0, len(chunks))
    labeled = []
    for offset in range(0, len(chunks), 6):
        batch = chunks[offset : offset + 6]
        questions = {
            str(i): {
                "type": "choice",
                "instructions": f"Which topic best describes only chunks[{i}].text? Choose other if none dominates.",
                "criteria": TOPICS,
            }
            for i in range(len(batch))
        }
        answers = ask_jev({"chunks": batch}, questions)["answers"]
        for i, chunk in enumerate(batch):
            answer = answers[str(i)]
            if answer["choice"] not in TOPICS:
                raise RuntimeError(f"TypeSafe returned an unknown topic: {answer['choice']}")
            labeled.append(
                {
                    "start_id": chunk["start_id"],
                    "end_id": chunk["end_id"],
                    "topic": answer["choice"],
                    "confidence": answer["confidence"],
                }
            )
        print(f"JEV labeled {len(labeled)}/{len(chunks)} windows", file=sys.stderr)
        progress("analysis", len(labeled), len(chunks))
    return labeled


def render_draft(transcript: dict, draft: dict) -> str:
    passages = {passage["id"]: passage for passage in transcript["passages"]}

    def references(ids: list[str]) -> str:
        if not ids:
            raise ValueError("a draft item has no source passage")
        links = []
        for source_id in ids:
            if source_id not in passages:
                raise ValueError(f"unknown source passage {source_id}")
            passage = passages[source_id]
            separator = "&" if "?" in transcript["source"] else "?"
            url = f"{transcript['source']}{separator}t={passage['seconds']}s"
            links.append(f"[{passage['timestamp']}]({url})")
        return ", ".join(links)

    lines = [
        f"# {transcript['title']}",
        "",
        "> **Draf otomatis.** Dukungan tiap klaim belum diperiksa oleh JEV. "
        "Atribusi ayat, hadis, dan ulama belum diverifikasi dengan sumber primer; "
        "tinjau isi sebelum dipakai.",
        "",
        f"[Video sumber]({transcript['source']})",
        "",
        "## Ikhtisar",
        "",
    ]
    for point in draft["overview"]:
        lines.append(f"- {point['text']} ({references(point['source_ids'])})")
    lines.extend(["", "## Peta kajian", ""])
    for section in draft["sections"]:
        if not section["points"]:
            raise ValueError(f"section {section['title']!r} has no points")
        lines.append(f"- {section['title']} ({references(section['points'][0]['source_ids'])})")
    lines.extend(["", "## Catatan utama", ""])
    for section in draft["sections"]:
        lines.extend([f"### {section['title']}", ""])
        for point in section["points"]:
            lines.append(f"- {point['text']} ({references(point['source_ids'])})")
        lines.append("")
    lines.extend(["## Tanya jawab", ""])
    if not draft["qa"]:
        lines.extend(["Tidak ada sesi tanya jawab yang teridentifikasi.", ""])
    for item in draft["qa"]:
        lines.extend([f"### {item['question']}", "", f"{item['answer']} ({references(item['source_ids'])})", ""])
    lines.extend(["## Perlu ditinjau", ""])
    for note in draft["review_notes"]:
        lines.append(f"- {note['text']} ({references(note['source_ids'])})")
    if not draft["review_notes"]:
        lines.append("- Belum ada catatan otomatis; tinjauan manusia tetap diperlukan.")
    return "\n".join(lines).rstrip() + "\n"


def collect_claims(markdown: str, transcript: dict) -> tuple[list[str], list[dict]]:
    lines = markdown.split("\n## Pemeriksaan bukti JEV", 1)[0].rstrip().splitlines()
    passages = transcript["passages"]
    by_second = {}
    for index, passage in enumerate(passages):
        by_second.setdefault(passage["seconds"], []).append(index)
    section = ""
    question = ""
    claims = []
    for line_index, original in enumerate(lines):
        line = original.replace(REVIEW_PREFIX, "").replace(CONTRADICTION_PREFIX, "").replace(INSUFFICIENT_PREFIX, "")
        lines[line_index] = line
        if line.startswith("## "):
            section = line[3:]
        elif line.startswith("### ") and section == "Tanya jawab":
            question = line[4:]
        is_point = section in ("Ikhtisar", "Peta kajian", "Catatan utama") and line.startswith("- ")
        is_answer = section == "Tanya jawab" and line and not line.startswith("#") and line != "Tidak ada sesi tanya jawab yang teridentifikasi."
        if not (is_point or is_answer):
            continue
        split = line.rfind(" ([")
        if split < 0:
            raise ValueError(f"draft line {line_index + 1} has no source citations")
        claim = line[2:split] if is_point else f"Pertanyaan: {question}\nJawaban: {line[:split]}"
        citations = line[split:]
        stamps = re.findall(r"\[([^]]+)\]\(([^)]+)\)", citations)
        if not stamps:
            raise ValueError(f"draft line {line_index + 1} has malformed citations")
        cited_indices = []
        for stamp, url in stamps:
            separator = "&" if "?" in transcript["source"] else "?"
            if not url.startswith(transcript["source"] + separator + "t="):
                raise ValueError(f"draft line {line_index + 1} has an unexpected source URL")
            seconds = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("t", [""])[0]
            if not seconds.endswith("s") or not seconds[:-1].isdigit():
                raise ValueError(f"draft line {line_index + 1} has an invalid time link")
            matches = [i for i in by_second.get(int(seconds[:-1]), []) if passages[i]["timestamp"] == stamp]
            if not matches:
                raise ValueError(f"draft line {line_index + 1} cites a missing passage")
            cited_indices.extend(matches)
        evidence = []
        for index in dict.fromkeys(cited_indices):
            nearby = passages[max(0, index - 2) : index + 3]
            evidence.append(
                {
                    "cited": f"{passages[index]['timestamp']} {passages[index]['text']}",
                    "context": "\n".join(f"{p['timestamp']} {p['text']}" for p in nearby),
                }
            )
        claims.append(
            {"line_index": line_index, "section": section, "claim": claim, "citations": citations, "evidence": evidence}
        )
    if not claims:
        raise ValueError("draft has no claims to verify")
    return lines, claims


def check_claims(claims: list[dict]) -> tuple[str, list[dict]]:
    checked = []
    model = ""
    for offset in range(0, len(claims), 6):
        batch = claims[offset : offset + 6]
        state = {"items": [{"claim": item["claim"], "evidence": item["evidence"]} for item in batch]}
        questions = {
            str(i): {
                "type": "choice",
                "instructions": f"Does items[{i}].evidence support every substantive part of items[{i}].claim as a faithful report of the speaker? Judge transcript support only, not external truth. Use context to interpret cited lines, not to fill gaps in them.",
                "criteria": SUPPORT_CRITERIA,
            }
            for i in range(len(batch))
        }
        response = ask_jev(state, questions)
        model = response["model"]
        for i, item in enumerate(batch):
            answer = response["answers"][str(i)]
            if answer["choice"] not in SUPPORT_CRITERIA:
                raise RuntimeError(f"TypeSafe returned an unknown verdict: {answer['choice']}")
            checked.append({**item, "verdict": answer["choice"], "confidence": answer["confidence"]})
        print(f"JEV checked {len(checked)}/{len(claims)} claims", file=sys.stderr)
    return model, checked


def render_verification(lines: list[str], model: str, checked: list[dict]) -> str:
    confirmed = sum(item["verdict"] == "supports" and item["confidence"] >= 0.8 for item in checked)
    flagged = []
    for item in checked:
        if item["verdict"] == "supports" and item["confidence"] >= 0.8:
            continue
        if item["verdict"] == "contradicts" and item["confidence"] >= 0.8:
            prefix, status = CONTRADICTION_PREFIX, "Bertentangan"
        elif item["verdict"] == "insufficient" and item["confidence"] >= 0.8:
            prefix, status = INSUFFICIENT_PREFIX, "Kutipan tidak cukup"
        else:
            prefix, status = REVIEW_PREFIX, "Belum pasti"
        index = item["line_index"]
        lines[index] = lines[index].replace("- ", "- " + prefix, 1) if lines[index].startswith("- ") else prefix + lines[index]
        flagged.append({**item, "status": status})
    lines = [
        line.replace(
            "Dukungan tiap klaim belum diperiksa oleh JEV.",
            "Dukungan klaim telah diperiksa secara otomatis oleh JEV; temuan yang belum pasti ditandai.",
        )
        for line in lines
    ]
    lines.extend(
        [
            "",
            "## Pemeriksaan bukti JEV",
            "",
            "Pemeriksaan ini membandingkan isi catatan dengan bagian transkrip yang dikutip. "
            "Ini bukan verifikasi kebenaran dalil atau atribusi terhadap sumber luar. "
            "Catatan tentang transkripsi pada bagian Perlu ditinjau juga memerlukan pemeriksaan audio.",
            "",
            f"- Model: {model}; ambang dukungan otomatis: 0,80.",
            f"- Didukung oleh kutipan: {confirmed} dari {len(checked)} poin.",
            f"- Perlu tinjauan: {len(flagged)} poin.",
        ]
    )
    if flagged:
        lines.extend(["", "### Poin untuk diperiksa", ""])
        for item in flagged:
            excerpt = item["claim"].replace("\n", " / ")
            if len(excerpt) > 125:
                excerpt = excerpt[:122].rstrip() + "..."
            first_link = re.search(r"\[[^]]+\]\([^)]+\)", item["citations"]).group()
            lines.append(
                f"- **{item['status']}** ({item['section']}; JEV: {item['verdict']}, "
                f"keyakinan {item['confidence']:.2f}): {excerpt} {first_link}"
            )
    return "\n".join(lines).rstrip() + "\n"


def verify_markdown(markdown: str, transcript: dict) -> str:
    lines, claims = collect_claims(markdown, transcript)
    model, checked = check_claims(claims)
    return render_verification(lines, model, checked)


def write_draft(output: Path, content: str, force: bool) -> None:
    if output.exists() and not force:
        raise FileExistsError(f"{output} exists; use --force to replace it")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as file:
        temporary = Path(file.name)
        file.write(content)
    try:
        if force:
            temporary.replace(output)
        else:
            os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None) -> None:
    from operations import (Job, OperationError, catalog, check_revision, clean_error, emit,
                            operation_lock, output_path, progress, revision, web_request)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, help="timestamped or plain transcript (.md or .txt)")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--json", action="store_true", help="print every passage as JSON")
    action.add_argument("--draft", action="store_true", help="write a source-linked study-note draft")
    action.add_argument("--verify", action="store_true", help="check an existing draft against cited passages")
    action.add_argument("--review", action="store_true", help="show saved findings and owner decisions without service calls")
    action.add_argument("--accept", metavar="CLAIM_ID", help="accept a flagged point after inspecting its source")
    action.add_argument("--unaccept", metavar="CLAIM_ID", help="reopen a flagged point for owner review")
    action.add_argument("--approve", action="store_true", help="attest that the full note, sources, coverage and uncertainty labels were reviewed")
    action.add_argument("--web-request", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--reason", help="source-based reason for --accept")
    parser.add_argument("--force", action="store_true", help="replace an existing draft")
    parser.add_argument("--events-json", action="store_true", help="emit structured operation events")
    parser.add_argument("--expected-revision", help="reject writes if the input or output revision changed")
    parser.add_argument("--origin", choices=("command", "website"), default="command", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    root = Path(os.environ.get("KAJIAN_ROOT", Path(__file__).parent)).resolve()
    if args.web_request:
        try:
            raw = sys.stdin.buffer.read(3 * 1024 * 1024 + 1)
            if len(raw) > 3 * 1024 * 1024:
                raise OperationError("Permintaan terlalu besar.")
            response = web_request(root, json.loads(raw))
            if response is not None:
                emit({"type": "result", "result": response})
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
            emit({"type": "error", "code": getattr(exc, "code", "invalid"), "message": clean_error(exc)})
            raise SystemExit(2)
        return
    if args.force and not args.draft:
        parser.error("--force requires --draft")
    if args.reason is not None and not args.accept:
        parser.error("--reason requires --accept")
    if args.accept and (args.reason is None or not args.reason.strip()):
        parser.error("--accept requires a nonempty --reason")
    if args.path is None:
        files = sorted(p for p in (root / "transcript").iterdir() if p.is_file() and p.suffix in (".md", ".txt"))
        if len(files) != 1:
            parser.error("expected one .md or .txt transcript; specify a path")
        args.path = files[0]
    reviewing = args.review or args.accept or args.unaccept or args.approve
    mutating = args.draft or args.verify or args.accept or args.unaccept or args.approve
    if args.draft or args.verify or reviewing:
        try:
            with operation_lock(root) if mutating else nullcontext():
                output = output_path(root, args.path)
                check_revision(root, args.path, args.expected_revision)
                baseline = revision(root, args.path)
                if args.draft and (output.exists() or output.with_suffix(".evidence.json").exists()) and not args.force:
                    raise OperationError(f"{output.name} exists; use --force to replace it", "conflict")
                if (args.verify or reviewing) and not output.is_file():
                    raise OperationError(f"{output.name} does not exist; create a draft first", "not_found")
                for item in catalog(root):
                    if (root / "transcript" / item["filename"]).resolve() == args.path.resolve() and item.get("error"):
                        raise OperationError(item["error"], "conflict")
                with Job(root, args.path, "draft" if args.draft else "verify", args.origin, args.events_json) if args.draft or args.verify else nullcontext() as job:
                    result = parse_transcript(args.path.read_text(encoding="utf-8-sig"), title=args.path.stem)
                    from study import generate_study, verify_study, save_study, review_study, draft_checkpoint
                    if args.draft or args.verify:
                        if not os.environ.get("TYPESAFE_API_KEY"):
                            raise OperationError("TYPESAFE_API_KEY belum tersedia. Atur pada terminal yang menjalankan server, lalu mulai ulang server.", "prerequisite")
                    if args.draft:
                        prompt_hash = (root / "prompts/kajian.md").read_bytes()
                        checkpoint = draft_checkpoint(args.path, root)
                        content, evidence = generate_study(result, args.path, root)
                        if (root / "prompts/kajian.md").read_bytes() != prompt_hash:
                            raise OperationError("Prompt berubah selama proses. Coba lagi dengan prompt terbaru.", "conflict")
                        progress("saving")
                        check_revision(root, args.path, baseline)
                        save_study(output, content, evidence, args.force)
                        checkpoint.unlink(missing_ok=True)
                    else:
                        content = output.read_text(encoding="utf-8")
                        evidence_path = output.with_suffix(".evidence.json")
                        if reviewing:
                            if not evidence_path.exists():
                                raise ValueError("Evidence metadata is missing; restore the matching pair or regenerate")
                            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
                            review_action = "accept" if args.accept else "unaccept" if args.unaccept else "approve" if args.approve else "review"
                            message = review_study(output, content, evidence, result, args.path, review_action, args.accept or args.unaccept, args.reason,
                                                   before_write=lambda: check_revision(root, args.path, baseline))
                            if args.events_json:
                                emit({"type": "result", "result": {"message": message, "revision": revision(root, args.path)}})
                            else:
                                print(message)
                            return
                        if "<!-- study:" in content or evidence_path.exists():
                            if not evidence_path.exists():
                                raise ValueError("evidence metadata is missing; restore the .evidence.json file or regenerate")
                            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
                            content, evidence = verify_study(content, evidence, result, args.path)
                            progress("saving")
                            check_revision(root, args.path, baseline)
                            save_study(output, content, evidence, True)
                        else:
                            progress("verification")
                            content = verify_markdown(content, result)
                            progress("saving")
                            check_revision(root, args.path, baseline)
                            write_draft(output, content, True)
                            evidence = {}
                    job.complete(slug=evidence.get("slug") or evidence.get("id"), output=output.name)
                if not args.events_json:
                    print(output)
        except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired) as exc:
            if args.events_json:
                emit({"type": "error", "code": getattr(exc, "code", "invalid" if isinstance(exc, (ValueError, KeyError, TypeError)) else "failed"), "message": clean_error(exc)})
                raise SystemExit(2)
            parser.exit(2, f"error: {clean_error(exc)}\n")
        return
    try:
        result = parse_transcript(args.path.read_text(encoding="utf-8-sig"), title=args.path.stem)
    except (OSError, UnicodeError, ValueError) as exc:
        parser.exit(2, f"error: {clean_error(exc)}\n")
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    passages = result["passages"]
    print(result["title"])
    if result["format"] == "plain":
        print(f"{len(passages)} numbered passages; no timestamps supplied")
        for chunk in make_chunks(passages):
            print(f"{chunk['start_id']}–{chunk['end_id']}")
        return
    print(f"{len(passages)} passages, {passages[0]['timestamp']}–{passages[-1]['timestamp']}")
    for _, group in groupby(passages, key=lambda passage: passage["seconds"] // 600):
        chunk = list(group)
        print(f"{chunk[0]['id']}  {chunk[0]['timestamp']}  {len(chunk)} passages")


if __name__ == "__main__":
    main()
