# Rangkuman Kajian

This local project turns timestamped or plain-text kajian transcripts into Indonesian study notes. Use the Python command or the local website to generate and review them.

Notes preserve the limits of the supplied transcript. Missing teaching and Q&A are not filled in from guesses.

## Project files

```text
rangkuman-kajian/
├── README.md
├── summarize.py          # Local command
├── study.py             # Enrichment, study format and evidence checks
├── operations.py        # Shared operation lock, job history and transcript imports
├── test_summarize.py     # Legacy parser checks
├── test_study.py         # Study pipeline checks
├── prompts/             # Editable Indonesian drafting prompt
├── web/                 # Astro, Tailwind CSS and shadcn/ui reader
├── docs/                # Public operating and evidence documentation
├── examples/            # Reusable synthetic transcripts
├── transcript/          # Private source transcripts (ignored)
└── summarize/           # Private notes, evidence and archives (ignored)
```

The public repository contains code, documentation, and synthetic examples. Personal study data and planning documents stay local.
See [public repository preparation](docs/public-repository.md) for the ignore rules and first-commit checks.

## Try a reusable example

Copy the synthetic example into your private transcript directory:

```sh
rtk proxy cp examples/transcripts/amanah.txt transcript/kajian-amanah.txt
rtk proxy python3 summarize.py transcript/kajian-amanah.txt
```

The command above parses the example without AI calls. Add `--draft` to generate notes after configuring service credentials.
The [timestamped example](examples/transcripts/amanah-timestamped.md) demonstrates the other supported input format.
Example text and times are synthetic. A fresh clone starts with an empty personal library.

## Open the website

From the project directory, install the frontend dependencies once:

```sh
rtk proxy env npm_config_user_agent='OpenAI File Downloader, XaiImageApiFetch/1.0' npm --prefix web ci
```

Build the website:

```sh
rtk proxy npm --prefix web run build
```

Start the local server from a terminal with your existing Codex login and `TYPESAFE_API_KEY`:

```sh
rtk proxy npm --prefix web start
```

If `.zshrc` exports the key, start the server from your normal interactive Zsh terminal. The server inherits that environment.

For frontend development, use:

```sh
rtk proxy npm --prefix web run dev
```

Open [the study library](http://127.0.0.1:4321). Select **Buka catatan** to read a kajian.

- Search by title, speaker, or words within the notes.
- Use **Daftar isi** on mobile or the desktop sidebar to move between sections.
- Select **Lihat bukti** beside a point to inspect its transcript passages, external references, and JEV findings. Untimestamped passages use labels such as **Bagian P001**.
- Open **Tinjauan JEV** to see every point that needs attention. Select **Buka poin dan bukti** to jump to that point and open its evidence panel. This queue uses saved findings; opening it makes no AI calls.
- Read the owner-review label separately from the JEV finding. Accepted points retain their automatic finding, with the owner's reason and date.
- Select the bookmark beside a heading to save that section.
- Tick action items to record your progress. These are suggestions derived from the teaching.
- Use the text-size buttons, **Markdown** download, and **Cetak** controls as needed.

Reading position, bookmarks, text size, and action checkmarks stay in this browser. Clearing browser data removes them. They do not synchronize between devices.

The article remains readable without JavaScript or browser storage. Personal study controls require JavaScript. The local server must remain available during reading.

To check a new frontend build locally:

```sh
rtk proxy npm --prefix web run build
rtk proxy npm --prefix web start
```

The build makes no AI calls. The Node server reads the current summaries, evidence, and transcripts on each request.
New results appear without a rebuild. Frontend code changes require a new build for `npm start`.
The server binds to `127.0.0.1`. It supports local use by one owner, with no accounts or network hosting.

## Manage summaries on the website

Open [Kelola rangkuman](http://127.0.0.1:4321/kelola/).

1. Select an existing transcript, upload a `.md` or `.txt` file, or paste text with a title.
2. Select **Periksa dan simpan transkrip** for a new source.
3. Read the detected format and passage count.
4. Select **Buat rangkuman** to start generation.
5. Follow the stage and available counts above the transcript list or in **Riwayat proses**.
6. After completion, select **Buka catatan** and inspect its evidence.

Imports require UTF-8 text, with a limit of 2 MiB. Duplicate output names and source identities are rejected.
Importing a transcript makes no AI calls. A source URL links to the recording. It does not download a video or extract its transcript.

One operation can change project data at a time. The website and command share an OS lock.
Closing the browser does not cancel the job. Job history lives in `.local/jobs/`, separate from browser storage.
If the server restarts, a surviving worker can finish. Dead workers appear as **Terhenti** and require an explicit retry.

**Coba lagi** resumes a matching saved draft. **Periksa ulang** refreshes evidence and resets owner decisions after success.
**Buat ulang rangkuman** replaces current wording and archives the previous pair after success. Its checkbox confirms that replacement.
If a transcript, summary, or evidence file changes during a job, publication stops instead of replacing those edits.

The website also shows equivalent terminal commands. Existing command usage remains supported.
The website requires JavaScript for management and review actions. Reading remains available without JavaScript.

Credentials stay in the server environment. Reading and owner review require no service credentials.
Drafting requires Codex CLI, its signed-in session, and `TYPESAFE_API_KEY`. Verification requires the TypeSafe key.
The readiness display detects the executable and key presence. It does not check service quotas or prove that sign-in remains valid.
After changing credentials, restart the server. Keep keys out of project files and browser input.

`KAJIAN_ROOT` can select an isolated data directory for tests. It must contain `transcript/`, `summarize/`, and `prompts/kajian.md`.
The server always runs the project's Python script. It does not accept executable paths or shell commands from the browser.

## Read and review the notes

1. Open a generated note in the library or its Markdown file under `summarize/`.
2. Read **Ikhtisar** for the overview, **Peta kajian** for navigation, and **Catatan utama** for details.
3. Read **Tanya jawab** for all audience questions and answers.
4. Open the cited passages to compare each point with its source transcript under `transcript/` and optional recording.
5. Review points marked **[Perlu ditinjau]**, **[Kutipan tidak cukup]**, or **[Bertentangan dengan sumber]** in **Tinjauan JEV**. The Markdown file also has **Pemeriksaan bukti JEV**.

The summary is a draft until the owner reviews it. JEV checks speaker claims against the transcript and added explanations against retrieved references. Its confidence measures model certainty, not religious authenticity.

The generator retrieves Qur'an translations from eQuran and hadith text from HadeethEnc. It labels additions as **Referensi tambahan**. Ambiguous or unavailable references remain unresolved. Scholarly attributions outside these providers remain statements by the speaker.

## Complete owner review

Owner review uses the same Python rules and evidence file through either interface. It requires no TypeSafe key or Codex sign-in.

On the website, open **Lihat bukti** for a flagged point. Inspect the quotations and their context.
Enter a source-based reason, then select **Terima setelah tinjauan sumber**.
**Buka kembali poin** removes that acceptance. The review queue also provides these actions under **Catat keputusan pemilik**.

After resolving every flagged point, read the entire note and complete the attestation at its end.
Select **Setujui catatan untuk belajar** only after that review. This approval does not certify religious authenticity.
If another tab or command changes the files, the website rejects stale decisions and asks you to reload.

For the command workflow, follow these steps.

Set an explicit transcript path:

```sh
kajian='transcript/kajian-amanah.txt'
```

Read the saved findings:

```sh
rtk proxy python3 summarize.py "$kajian" --review
```

This command shows evidence freshness, review status, flagged IDs, source citations, and acceptance reasons. It makes no changes.

1. Read the whole note, including points supported automatically.
2. Inspect the cited sources and nearby context for each flagged point.
3. Correct wording or citations inside the existing study markers.
4. After all corrections, run `--verify` with `TYPESAFE_API_KEY` in the environment.
5. Record acceptance only after you inspect the current sources.

For a flagged point, record your own source-based reason:

```sh
rtk proxy python3 summarize.py "$kajian" --accept c004 --reason 'Your reason after inspecting the cited passages.'
```

The example reason is a placeholder. Replace it with the evidence that supports your decision.

To reopen a point:

```sh
rtk proxy python3 summarize.py "$kajian" --unaccept c004
```

Before approval, confirm these items:

- Every retained point has valid source citations.
- The note covers the main teaching and all audience Q&A topics.
- Qualifications and conditional answers match the speaker's meaning.
- AI applications remain optional and separately labelled.
- Provider quotations remain unchanged, and unresolved attributions remain labelled.
- Every remaining JEV flag has an acceptance reason.

Compare the note's coverage with the supplied transcript. Keep any source-specific review worksheets in private local files.

After you complete the full review, approve the current version:

```sh
rtk proxy python3 summarize.py "$kajian" --approve
```

`--approve` records your attestation that you reviewed the whole note, sources, coverage, and uncertainty labels. The command rejects unresolved flags or damaged evidence. Repeated approval of an unchanged version makes no changes.

Approval means ready for personal study. It does not certify religious authenticity or change JEV verdicts and confidence values.

The website shows pending, in-progress, reviewed, or stale owner review. It retains accepted JEV flags and shows their reasons in the queue and evidence panel. The queue also shows reasons without JavaScript.

Any acceptance change reopens document approval. A Markdown or transcript edit invalidates saved review. Successful regeneration or reverification resets all owner decisions. Complete verification before recording final acceptances.

If review data is damaged, restore the matching archived pair or run `--verify`, then repeat owner review. After a transcript change, regenerate. Old review decisions never apply automatically to a new version.

## Run the local command

Use Python 3 from the project directory. The commands below use the installed `rtk` wrapper. Python code uses the standard library. Drafting requires the ChatGPT-signed-in Codex CLI and `TYPESAFE_API_KEY` in the shell environment. Verification requires the TypeSafe key. Keep the key out of project files.

To inspect the transcript index without an API key:

```sh
rtk proxy python3 summarize.py
```

To rerun JEV checks on the current summary:

```sh
rtk proxy python3 summarize.py --verify
```

This command reads your edited note text and replaces the evidence report after all checks succeed. If a service check fails, previous output stays unchanged.

If TypeSafe reports `max_tokens_exceeded`, the verifier splits the evidence batch and retries with fewer claims. It retains the cited text and removes repeated context from requests. Other request errors stop the run and show the API error detail.

During generation, a completed draft is saved under `.cache/drafts/` before JEV verification. If verification fails, rerun the same `--draft` command to resume from that draft. It skips reference extraction and drafting when the transcript, input path, and prompt are unchanged. The checkpoint is removed only after successful verification and publication of both output files. To request new wording, remove its checkpoint from `.cache/drafts/` first.

For new summaries, keep each `.md` file beside its matching `.evidence.json` file. Edit wording inside paired `study:begin` and `study:end` comments. Preserve block IDs, source links, numbered citations, and provider quotations. Do not place new teaching claims outside the markers.

The website displays **Perlu diperiksa ulang** after a Markdown edit. Run `--verify` to refresh its findings. If the transcript changes, regenerate the notes so reference matching uses the new source. If metadata is missing or damaged, restore the matching pair from `summarize/archive/` or regenerate.


Old Markdown summaries remain readable. Their existing verification command remains supported until regeneration converts them to the new format.

To create a draft when no summary file exists:

```sh
rtk proxy python3 summarize.py --draft
```

The draft command labels passages, extracts reference mentions, retrieves references, drafts notes, and checks their evidence. The [drafting prompt](prompts/kajian.md) controls the Indonesian writing instructions.

Output uses the transcript filename under `summarize/`, with companion evidence metadata. Previous versions go into `summarize/archive/`. Reference responses are cached under `.cache/references/`.

With multiple transcripts, give the input path explicitly:

```sh
rtk proxy python3 summarize.py "transcript/your-kajian.md" --draft
```

Both `.md` and `.txt` inputs are supported. Output always uses `.md`, with a matching `.evidence.json` file. Use distinct input filenames to avoid matching output names.

### Transcript with timestamps

Use the existing format: optional `title` and `source` metadata, a `## Transcript` heading, and entries such as `**0:01** · Spoken text`. A source URL enables video seek links.

### Transcript without timestamps

Save the raw text in `transcript/`, for example `transcript/kajian-amanah.txt`. Separate paragraphs with blank lines when possible:

```text
Pembicara menjelaskan pentingnya menjaga amanah.

Selanjutnya, pembicara memberikan contoh penerapannya dalam keseharian.
```

Generate the notes with the same command:

```sh
rtk proxy python3 summarize.py "transcript/kajian-amanah.txt" --draft
```

The program detects plain text automatically and assigns passage IDs such as `P001` and `P002`. It splits very long paragraphs into smaller passages without inventing timestamps. JEV checks claims against those passages, and **Lihat bukti** shows their original text.

The filename supplies the title when metadata is absent. A source URL is optional. You can add `title:` and `source:` lines before the text. If you change the source transcript or its passage boundaries, regenerate the notes.

Do not mix timestamped entries with unmarked prose. The parser stops with an error so no source text is silently lost. Use consistent timestamped entries or remove the timestamps for plain-text processing.

### Kajian without Q&A

No Q&A is required. The prompt returns an empty Q&A list when no audience discussion is present. The notes show **Tidak ada sesi tanya jawab yang teridentifikasi.** Rhetorical questions are not audience Q&A.

**Caution:** The following command replaces the current summary and manual edits:

```sh
rtk proxy python3 summarize.py --draft --force
```

To run the local tests:

```sh
rtk proxy python3 -B -m unittest -q test_summarize.py test_study.py test_operations.py
```

Build before the Playwright tests. On this Mac, use the installed Google Chrome executable:

```sh
rtk proxy npm --prefix web run build
rtk proxy env PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm --prefix web test
```

Playwright starts the built Node server on port 4327. It seeds synthetic study files into a temporary directory and replaces AI services with test doubles.
Tests cover generation, retry, locking, imports, review decisions, request protection, and CLI equivalence.
Reader checks cover search, evidence panels, study state, mobile navigation, unavailable storage, and reading without JavaScript.
Tests also cover stale evidence and unsafe Markdown. They do not modify the owner's study files or make paid AI calls.

See [the website scope and content contract](docs/website-and-evidence.md) for the implementation boundaries and evidence format.
