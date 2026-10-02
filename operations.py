"""Local operation locking, job history, and the website's file boundary."""

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid

MAX_INPUT = 2 * 1024 * 1024
_current_job = None


class OperationError(ValueError):
    def __init__(self, message, code="invalid"):
        self.code = code
        super().__init__(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def clean_error(error):
    message = str(error)
    for name, value in os.environ.items():
        if value and any(word in name.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD")):
            message = message.replace(value, "<REDACTED>")
    return message[:1200]


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def operation_lock(root):
    directory = root / ".local"
    directory.mkdir(mode=0o700, exist_ok=True)
    with (directory / "operation.lock").open("a+") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise OperationError("Proses lain masih berjalan. Tunggu hingga selesai, lalu coba lagi.", "busy") from exc
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def confined(base, relative):
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise OperationError("Lokasi berkas tidak diizinkan.")
    resolved = (base / path).resolve()
    if not resolved.is_relative_to(base.resolve()):
        raise OperationError("Berkas harus berada di direktori proyek yang sesuai.")
    return resolved


def output_path(root, path):
    return confined(root / "summarize", path.with_suffix(".md").name)


def revision(root, path):
    output = output_path(root, path)
    hasher = hashlib.sha256()
    for file in (path, output, confined(root / "summarize", output.with_suffix(".evidence.json").name)):
        content = file.read_bytes() if file.exists() else None
        hasher.update(b"missing" if content is None else str(len(content)).encode() + b":" + content)
    return hasher.hexdigest()


def check_revision(root, path, expected):
    if expected is not None and revision(root, path) != expected:
        raise OperationError("Berkas telah berubah. Muat ulang halaman dan tinjau versi terbaru sebelum melanjutkan.", "conflict")


def transcript_id(root, path):
    return hashlib.sha256(path.relative_to(root / "transcript").as_posix().encode()).hexdigest()[:24]


def transcript_paths(root):
    base = root / "transcript"
    for path in sorted(base.rglob("*")):
        if path.is_file() and path.suffix in (".md", ".txt"):
            yield path


def resolve_transcript(root, identifier):
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{24}", identifier):
        raise OperationError("ID transkrip tidak valid.")
    for path in transcript_paths(root):
        if transcript_id(root, path) == identifier:
            return confined(root / "transcript", path.relative_to(root / "transcript"))
    raise OperationError("Transkrip tidak ditemukan.", "not_found")


def describe(root, path):
    from summarize import parse_transcript
    from study import digest
    safe = confined(root / "transcript", path.relative_to(root / "transcript"))
    raw = safe.read_bytes()
    if len(raw) > MAX_INPUT:
        raise OperationError("Transkrip melebihi batas 2 MiB.")
    parsed = parse_transcript(raw.decode("utf-8-sig"), title=path.stem)
    source = parsed["source"]
    if source:
        from urllib.parse import urlsplit
        url = urlsplit(source)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
            raise OperationError("URL sumber harus berupa HTTP(S) tanpa kredensial.")
    output = output_path(root, path)
    slug = "kajian-" + digest(source or os.path.relpath(safe, root))[:12]
    evidence = confined(root / "summarize", output.with_suffix(".evidence.json").name)
    if evidence.exists():
        try:
            metadata = json.loads(evidence.read_text())
            if re.fullmatch(r"[a-z0-9-]+", metadata.get("id", "")):
                slug = metadata["id"]
            stored = metadata.get("transcript_file")
            if stored and (root / stored).resolve() != safe:
                raise OperationError("Nama keluaran dipakai transkrip lain. Gunakan nama transkrip yang berbeda.", "conflict")
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
    argument = shlex.quote(os.path.relpath(safe, root))
    return {"id": transcript_id(root, path), "filename": path.relative_to(root / "transcript").as_posix(),
            "title": parsed["title"], "source": source, "format": parsed["format"], "passages": len(parsed["passages"]),
            "has_summary": output.exists(), "slug": slug, "identity": "kajian-" + digest(source or os.path.relpath(safe, root))[:12],
            "revision": revision(root, safe),
            "commands": {"draft": f"rtk proxy python3 summarize.py {argument} --draft" + (" --force" if output.exists() else ""),
                         "verify": f"rtk proxy python3 summarize.py {argument} --verify"}}


def catalog(root):
    items = []
    for path in transcript_paths(root):
        try:
            items.append(describe(root, path))
        except (OSError, ValueError, UnicodeError) as exc:
            items.append({"id": transcript_id(root, path), "filename": path.relative_to(root / "transcript").as_posix(),
                          "title": path.stem, "error": clean_error(exc)})
    for item in items:
        others = [other for other in items if other is not item and (
            Path(other["filename"]).stem.casefold() == Path(item["filename"]).stem.casefold()
            or item.get("identity") and other.get("identity") == item["identity"]
            or item.get("slug") and other.get("slug") == item["slug"])]
        if others:
            item["error"] = "Sumber atau nama keluaran bertabrakan dengan: " + ", ".join(other["filename"] for other in others)
    return items


def import_transcript(root, request):
    from summarize import parse_transcript, write_draft
    from study import digest
    filename = request.get("filename", "")
    if not isinstance(filename, str) or not filename or Path(filename).name != filename or any(c in filename for c in "\\/\x00\r\n") or filename.startswith("."):
        raise OperationError("Gunakan nama berkas sederhana dengan akhiran .md atau .txt.")
    if Path(filename).suffix not in (".md", ".txt"):
        raise OperationError("Hanya berkas .md dan .txt yang didukung.")
    try:
        raw = base64.b64decode(request.get("content", ""), validate=True)
        if len(raw) > MAX_INPUT:
            raise OperationError("Transkrip melebihi batas 2 MiB.")
        text = raw.decode("utf-8-sig")
    except (UnicodeError, ValueError) as exc:
        raise OperationError("Isi harus berupa teks UTF-8, maksimum 2 MiB.") from exc
    parsed = parse_transcript(text, title=Path(filename).stem)
    if "\x00" in text:
        raise OperationError("Berkas berisi karakter biner, bukan transkrip teks.")
    if parsed["source"]:
        from urllib.parse import urlsplit
        url = urlsplit(parsed["source"])
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
            raise OperationError("URL sumber harus berupa HTTP(S) tanpa kredensial.")
    with operation_lock(root):
        path = confined(root / "transcript", filename)
        identity = "kajian-" + digest(parsed["source"] or os.path.relpath(path, root))[:12]
        for existing in catalog(root):
            if Path(existing["filename"]).stem.casefold() == path.stem.casefold() or identity in (existing.get("identity"), existing.get("slug")):
                raise OperationError("Transkrip sudah ada atau memakai identitas yang sama: " + existing["filename"] + ". Pilih transkrip tersebut.", "conflict")
        output = output_path(root, path)
        if output.exists() or output.with_suffix(".evidence.json").exists():
            raise OperationError("Nama keluaran sudah ada. Pilih nama berkas lain.", "conflict")
        for evidence in (root / "summarize").glob("*.evidence.json"):
            try:
                metadata = json.loads(confined(root / "summarize", evidence.name).read_text())
                if metadata.get("id") == identity or parsed["source"] and metadata.get("source_url") == parsed["source"]:
                    raise OperationError("Sumber ini sudah memiliki rangkuman. Gunakan transkrip yang sesuai.", "conflict")
            except (json.JSONDecodeError, AttributeError):
                continue
        write_draft(path, text, False)
        return describe(root, path)


def process_signature(pid):
    if type(pid) is not int or pid < 1:
        return None
    try:
        result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True, timeout=3)
        return result.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def jobs(root):
    def read():
        records = []
        for file in (root / ".local/jobs").glob("*.json"):
            try:
                record = json.loads(file.read_text())
                if isinstance(record, dict) and record.get("id") == file.stem:
                    records.append(record)
            except (OSError, ValueError):
                continue
        return sorted(records, key=lambda record: record.get("started_at", ""), reverse=True)
    records = read()
    abandoned = [record for record in records if record.get("status") == "running"
                 and (not record.get("process_started") or process_signature(record.get("pid")) != record["process_started"])]
    if not abandoned:
        return records
    try:
        with operation_lock(root):
            records = read()
            for record in records:
                if record.get("status") == "running":
                    record.update(status="interrupted", finished_at=now(), error="Proses terhenti sebelum selesai. Coba lagi untuk melanjutkan draf yang tersimpan.")
                    atomic_json(root / ".local/jobs" / (record["id"] + ".json"), record)
            return records
    except OperationError as exc:
        if exc.code != "busy":
            raise
        return read()


def status(root):
    records = jobs(root)
    active = next((record for record in records if record.get("status") == "running"), None)
    return {"python": True, "codex": bool(shutil.which("codex")), "typesafe": bool(os.environ.get("TYPESAFE_API_KEY")),
            "busy": active is not None, "active": active}


def emit(value):
    try:
        print(json.dumps(value, ensure_ascii=False), flush=True)
    except BrokenPipeError:
        # A closed website connection must not prevent publication or journal updates.
        sys.stdout = open(os.devnull, "w")


class Job:
    def __init__(self, root, path, operation, origin="command", events=False):
        self.root, self.events = root, events
        self.record = {"id": uuid.uuid4().hex, "operation": operation, "origin": origin, "status": "running",
                       "stage": "parsing", "filename": path.name, "started_at": now(), "updated_at": now(),
                       "pid": os.getpid(), "process_started": process_signature(os.getpid())}
        try:
            self.record["transcript_id"] = transcript_id(root, path.resolve())
        except ValueError:
            pass
        self.path = root / ".local/jobs" / (self.record["id"] + ".json")

    def __enter__(self):
        global _current_job
        _current_job = self
        self.update()
        return self

    def update(self, **values):
        self.record.update(values, updated_at=now())
        atomic_json(self.path, self.record)
        if self.events:
            emit({"type": "job", "job": self.record})

    def complete(self, **values):
        self.update(status="succeeded", stage="complete", finished_at=now(), **values)

    def __exit__(self, kind, error, traceback):
        global _current_job
        try:
            if error is not None:
                self.update(status="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                            finished_at=now(), error=clean_error(error), code=getattr(error, "code", "failed"))
            elif self.record["status"] == "running":
                self.update(status="interrupted", finished_at=now(), error="Proses berakhir sebelum penyimpanan selesai. Coba lagi.")
        finally:
            _current_job = None


def progress(stage, completed=None, total=None):
    if _current_job is not None:
        _current_job.update(stage=stage, completed=completed, total=total)


def web_request(root, request):
    if not isinstance(request, dict):
        raise OperationError("Permintaan tidak valid.")
    action = request.get("action")
    if action == "status":
        return status(root)
    if action == "transcripts":
        return catalog(root)
    if action == "import":
        return import_transcript(root, request)
    if action == "jobs":
        return jobs(root)
    if action not in ("draft", "verify", "accept", "unaccept", "approve"):
        raise OperationError("Operasi tidak dikenal.")
    path = resolve_transcript(root, request.get("transcript_id"))
    if not isinstance(request.get("revision"), str) or not re.fullmatch(r"[a-f0-9]{64}", request["revision"]):
        raise OperationError("Versi berkas diperlukan. Muat ulang halaman.", "conflict")
    args = [str(path), "--events-json", "--expected-revision", request["revision"], "--origin", "website"]
    if action in ("draft", "verify", "approve"):
        args.append("--" + action)
    else:
        claim = request.get("claim_id")
        if not isinstance(claim, str) or not re.fullmatch(r"[a-z0-9-]+", claim):
            raise OperationError("ID poin tidak valid.")
        args.extend(["--" + action, claim])
        if action == "accept":
            reason = request.get("reason")
            if not isinstance(reason, str) or not reason.strip() or len(reason) > 10000:
                raise OperationError("Tuliskan alasan berdasarkan sumber, maksimum 10.000 karakter.")
            args.append("--reason=" + reason)
    if action == "approve" and request.get("attested") is not True:
        raise OperationError("Konfirmasi bahwa seluruh catatan dan sumber telah ditinjau.")
    if action == "draft" and request.get("replace") is True:
        args.append("--force")
    from summarize import main
    main(args)
    return None
