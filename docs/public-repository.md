# Public repository preparation

The public repository contains application code, prompts, documentation, dependency lockfiles, and synthetic examples.
Personal study data stays local. The ignore rules do not delete files or affect the running website.

## Files that stay private

- `transcript/`: real source transcripts.
- `summarize/`: generated notes, evidence, owner decisions, and archived versions.
- `.local/`: job records, worker details, and live smoke-test files.
- `.cache/`: retrieved reference responses and draft checkpoints.
- `.env` files, authentication configuration, private keys, and `secrets/` directories.
- Local Word planning documents, the source-review worksheet, and the local validation report under `docs/`.
- Dependency directories, builds, browser reports, logs, and generated design-tool artifacts.

Only `.gitkeep` files are published from the private transcript and summary directories. They preserve the empty folders in a clone.
Examples under `examples/transcripts/` are synthetic and remain publishable. Browser tests create their own synthetic library.
The `.env.example` file contains an empty placeholder. The application does not automatically load environment files.
Export real credentials from the terminal that runs the server. Never replace the public placeholder with a real key.

## Preparation checks

On 2 October 2026, the ignore policy passed 44 checks against private paths and required public files.
The prospective public file list contained 59 files. It included no matching exported credential values, common credential patterns, or personal machine paths.
The Astro build and all 17 browser tests passed using synthetic fixtures. Both reusable transcripts parsed without AI calls.
This folder was not a Git repository during these checks. No index or existing commit history was available to audit.

## Prepare the first commit

From the project directory, initialize Git when you are ready:

```sh
rtk git init
rtk git add .
rtk git status --short
rtk git diff --cached --stat
```

Read the staged file list before committing. Keep `web/package-lock.json`, application sources, public docs, and synthetic test fixtures.
Do not use `git add -f` for private files. Ignore rules can be bypassed by that option.

For a repository that already tracks private files, inspect the index first:

```sh
rtk proxy git ls-files -ci --exclude-standard
```

Files listed by this command are tracked despite matching the current ignore rules.
Remove each reviewed private path from the index with `git rm --cached`. This keeps the working copy but does not erase earlier commits.

If credentials reached a commit or remote, revoke or rotate them before publishing. Removing a current file does not remove historical copies.
See the [Git ignore documentation](https://git-scm.com/docs/gitignore) and [GitHub sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

## Check an empty personal library

Run the frontend build and browser tests with the published synthetic fixtures:

```sh
rtk proxy npm --prefix web run build
rtk proxy env PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm --prefix web test
```

The executable path above is for this Mac. On another machine, use a local Chromium executable through the same environment variable.
The test setup copies only the public prompt. It seeds its own transcript and note files and removes its temporary directory afterward.
