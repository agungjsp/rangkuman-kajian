# Website and evidence format

This extends the original local CLI blueprint with a private reading website and retrieved dalil. The original Word documents remain unchanged.

## Components

The Python CLI parses timestamped or plain-text transcripts, calls TypeSafe and the ChatGPT-signed-in Codex CLI, and retrieves external references. Codex runs read-only without the TypeSafe key in its environment. All application HTTP requests carry the required project user-agent.

Astro's local Node server reads the library, review queue, and articles from disk on each request. The queue links current findings to their evidence. Stale findings appear only as a document warning. Tailwind CSS and React islands retain the existing reader components. The browser contains no API keys. The local backend runs the Python script for AI operations and review writes.

## Local management

`/kelola/` supports transcript selection, UTF-8 imports up to 2 MiB, generation, verification, progress, retries, and recent history.
The API uses fixed Python arguments and a JSON request on stdin. It does not run browser-supplied shell commands.
The server binds to `127.0.0.1`. Middleware checks Host, Origin, JSON content type, request size, and a per-server CSRF token.

`operations.py` provides file validation, revisions, an OS operation lock, and JSON jobs under `.local/jobs/`.
The CLI and website share this lock for all mutations. A second operation receives a busy error.
Both interfaces record generation and verification jobs. Browser closure does not stop a worker.
History reads compare each running worker's PID and process start time. These reads do not compete for the operation lock.
If a worker disappeared, recovery acquires the lock before marking its record interrupted. The owner must request a retry.

`--events-json` provides structured progress events. `--expected-revision` protects version-sensitive writes.
A revision covers the transcript, Markdown, and evidence bytes. Generation also checks the prompt before publication.
Review writes and publication reject changes since the operation began. External editors do not participate in the OS lock.
As with ordinary filesystem editing, an external write at the exact publication instant cannot form a cross-process transaction.

Imports reject traversal, escaping symlinks, invalid UTF-8, binary text, and conflicting output names or document identities.
The server serves only transcripts within the project transcript directory. Source URLs remain links and do not trigger transcript downloads.
Python keeps draft checkpoints until both output files are saved. Output archives and evidence schema version 2 remain unchanged.

| Endpoint | Operation |
|---|---|
| `GET /api/status` | Check executable/key presence and active work without paid calls |
| `GET/POST /api/transcripts` | List transcripts or validate and import one |
| `POST /api/jobs` | Start a draft or verification and return its job ID |
| `GET /api/jobs` and `/api/jobs/:id` | Read durable job status |
| `POST /api/studies/:id/review` | Accept, reopen, or approve through the existing Python rules |

Mutation requests use same-origin JSON and the page's CSRF token. Generation and review require the displayed revision.
The owner must confirm replacement before regeneration and attest to full review before approval.
Error responses redact environment secrets. Codex still runs without the TypeSafe key in its environment.

## Sources and checks

- Transcript claims, Q&A, stories, and prayers use cited transcript passages.
- Optional actions use the teaching from which they derive.
- Reference matching uses the speaker's mention and retrieved candidates. Explicit surah names and verse numbers resolve by exact locator.
- Added explanations use the retrieved external text.
- Provider quotations must match the retrieved text exactly.

eQuran provides Indonesian Qur'an translations attributed to Kemenag. HadeethEnc provides hadith text and its own attribution and grading. The application preserves provider text and identifies its source. It does not adjudicate religious authenticity.

JEV returns `supports`, `contradicts`, or `insufficient`. The provisional support threshold is 0.8. Ambiguous reference matches remain unresolved. Low-confidence claims remain visible for human review. The manuscript remains a draft even when all automatic checks pass.

## Files and edits

Each summary has an editable Markdown file and `.evidence.json` companion. Schema version 2 records document identity, prompt hash, source hashes, references, claim IDs, evidence, findings, and check times.

Paired Markdown comments identify claims:

```markdown
<!-- study:begin c001 -->
An editable explanation.

Sumber: [0:01](https://www.youtube.com/watch?v=example&t=1s)
<!-- study:end c001 -->
```

The verifier reads current block text and citation lines. It rejects damaged markers, unknown sources, and modified provider quotations. Wording edits invalidate earlier evidence until verification succeeds. New claims require generation of matching metadata.

## Owner review

Both interfaces record owner decisions in the existing evidence file through the Python review function. Schema version 2 remains compatible with files without review decisions.

`human_review` contains `pending` or `reviewed`. The optional `owner_review` object contains:

```json
{
  "summary_hash": "SHA-256 of the reviewed Markdown",
  "transcript_hash": "SHA-256 of the reviewed transcript",
  "checked_at": "2026-09-30T01:00:00+00:00",
  "accepted_claims": {
    "c001": {
      "reason": "Owner's reason after inspecting the cited source",
      "accepted_at": "2026-09-30T02:00:00+00:00"
    }
  },
  "reviewed_at": null
}
```

This example describes the format. It is not a recorded review decision.

`--review` shows saved findings without writes or service calls. `--accept ID --reason TEXT` records acceptance of a flagged point. `--unaccept ID` removes acceptance. `--approve` records full-document review after every JEV flag has an acceptance reason.

Acceptance and approval require matching hashes, valid markers and citations, unchanged provider quotations, and complete saved findings. The CLI also compares saved claim text, evidence, and content hashes with the current source. Review commands require no API key or Codex login.

Owner decisions never change JEV verdicts or confidence values. Flags use the existing 0.8 threshold. The website retains accepted flags, reasons, and dates. Counts distinguish automatic flags from points awaiting owner acceptance.

Missing review data defaults to pending. Valid acceptances produce an in-progress state. A valid `reviewed_at` and complete acceptances produce a reviewed state. Malformed review data produces a stale warning without invalidating otherwise valid JEV evidence.

A Markdown or transcript change invalidates review. The verification timestamp also binds decisions to one JEV run. Successful regeneration or reverification resets `human_review` to `pending` and removes `owner_review`. Any acceptance change reopens approval. Repeated approval of the same version does not write files.

Review writes replace only the evidence file, atomically. Failed validation or writes preserve the previous file. Before generation or verification replaces a pair, the archive identity includes both files. Distinct evidence records for identical Markdown therefore retain separate archived pairs.

The reader and library show owner status in the initial HTML. The review queue shows acceptance reasons without JavaScript or browser storage. Reasons are plain text. The evidence panel requires JavaScript, as before. Review dates use Asia/Jakarta.

Approval means ready for personal study after owner review. It does not certify religious authenticity. The owner must confirm coverage, source meaning, optional applications, and uncertainty labels before `--approve`.

Markdown and transcript hashes control whether the website displays findings as current. Missing metadata leaves the article readable. A mismatched pair shows stale status, including after an interrupted two-file write.

All service work completes before publication. Files are staged, prior versions are archived, and ordinary write errors restore previous output. Abrupt process termination can leave a mismatched pair; hash checks prevent that pair from appearing verified.

## Study state and boundaries

The browser stores section bookmarks, the last section read, text size, and completed action content hashes. Changed actions do not inherit completion from previous text. The state belongs to one browser and one local origin.

The local manager adds transcript uploads, generation, and owner review. It has no accounts, network hosting, batch queues, AI chat, browser editor, or cross-device synchronization. Plain `.md` and `.txt` transcripts use numbered passage citations, nullable time fields, and original text in the evidence panel. Metadata is optional. The filename supplies a fallback title. Mixed timestamped and untimestamped entries are rejected.

Q&A is optional. An absent audience Q&A session produces an empty list and an explicit absence message. The prompt excludes rhetorical questions from audience Q&A.

Personal transcripts, notes, evidence, archives, and owner decisions stay outside the public repository.
Reusable inputs live under `examples/`. Browser tests seed labelled synthetic notes and do not read the owner's library.
