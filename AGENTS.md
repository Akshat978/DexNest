# DexNest Agent Rules

DexNest is an offline-first personal command center for Windows, Android, and Stream Deck.

## Core Rules

- Use the name DexNest everywhere.
- Build as one monorepo.
- Use one main Electron desktop shell, not many Electron apps.
- Every module must register actions into the shared action registry.
- Every meaningful action must write to the shared event log.
- All real user data must stay under `./local-data`.
- Do not store documents, vault data, receipts, captures, indexes, or SQLite databases in C drive AppData.
- `local-data/` must stay gitignored.
- DexNest itself has no cloud, no login, no accounts, and no telemetry. It never runs a
  server of its own, and never phones home. The only requests it makes to an AI service
  are the ones the user has switched on, described under Autopilot and Outside AI below.
- No Google Calendar OAuth, bank APIs, or other third-party data integrations that would
  pull private accounts into DexNest.
- External AI is allowed in two places only, both off until the user turns them on:
  Autopilot and Outside AI. See their sections below. Everything else stays local.
- Heavy workers must be lazy and on-demand only.
- Idle CPU should stay near zero. An active, user-started Autopilot run is foreground
  work and is exempt while it runs; idle behaviour must be unchanged.
- GPU must not be used unless explicitly enabled. When enabled, it is opt-in and limited
  to local processing (OCR, embeddings, vision). Never on by default.
- Use DexNest design tokens only. No hardcoded colors in components.
- Use Inter for UI text and JetBrains Mono for technical text.
- Keep features modular and small.
- Do not add new modules unless explicitly requested.
- Source-code access does not imply data access. See Sensitive Data Boundary below.
- New modules build on `@dexnest/foundation`: one SQLite connection with namespaced
  tables, the shared `event_log`, the action registry, and the host capability set.
  Do not add a database driver, events table, action system or host-port list of
  a module's own. See `docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`.

## Autopilot

DexNest Autopilot is an approved evolution of DexNest, not a violation of these rules.
Its full design is in `docs/AUTOPILOT_ARCHITECTURE.md`, which is authoritative for all
Autopilot work. Read it before changing anything under `packages/autopilot-runtime` or
the Autopilot views.

Autopilot may drive locally installed, user-authenticated AI tools (Claude Code, Codex).
The revised local-first position:

- Orchestration, durable run state and project memory stay local.
- Local processing is preferred wherever practical.
- External AI integrations are explicit, opt-in, per-run, and logged.
- Unrelated private data is never exposed to a run.
- Secrets are never sent to external reasoning services.
- Resource-intensive work runs only during an explicitly started job.
- No telemetry is added because Autopilot exists.

Do not describe cloud-backed Autopilot operations as fully offline. DexNest is offline;
a run that uses Claude or Codex is not.

Autopilot lives in `packages/autopilot-runtime` (zero Electron imports — platform
capability is injected through ports) with views under
`apps/desktop/src/renderer/views/`. Do not create `modules/autopilot`; `modules/*` is
not a live registration system.

## Outside AI

Outside AI lets DexNest ask a service on the internet for help, using the user's own
OpenRouter key. It is an approved, narrow exception, not a general licence to call
external services. The code is `apps/desktop/src/main/outsideAi.ts`.

- Off by default. Nothing is sent until the user has saved a key, turned Outside AI on,
  and turned on the place it is used (spoken commands, typed commands). Each is a
  separate switch in Settings.
- The key is the user's own. It is stored encrypted in the integration keychain, read
  only at the moment a request is made, never logged, and never sent to the renderer.
- What may be sent is listed in code, per use. Today that is one thing: the words of a
  command the local rules could not place (300 characters at most), so a decision model
  can pick one intent from a fixed list. DexNest builds the action itself; the service
  never names an action or a parameter, and what it suggests waits for a confirmation.
- Never sent: anything from the Vault, Finance or Journal; files, documents or OCR text;
  the clipboard; search results; captures; repository contents, paths or names; anything
  under `local-data/`; secrets of any kind. A command that looks private (credentials,
  identity documents, money, long numbers, emails, links) is not sent and is handled
  locally.
- Every request writes one line to the shared event log: the service, the model, where
  it was used, how long the text was, how long it took and what was decided. The text
  itself is not logged.
- The local path always remains. Outside AI is asked only when the local rules are
  unsure, an answer below the confidence the user set is ignored, and any failure
  (no network, no credit, a changed API) falls back to the local path without an error
  the user has to deal with.
- Requests ask the provider not to retain or train on the data. That is a request, not a
  guarantee DexNest can enforce; say so in the interface.
- No telemetry is added because Outside AI exists.
- A new use of Outside AI (a new kind of content sent, a new module) needs the user's
  explicit approval and its own switch. Do not widen what is sent to make a feature work.

Do not describe DexNest as fully offline while Outside AI is on. With it off, which is
the default, nothing in this section sends anything.

## Sensitive Data Boundary

`local-data/` holds real private user data: the vault, finance records, the DPAPI
integration keychain, the SQLite event log, receipts, captures and drop files.

Working on DexNest source code does not grant permission to read or modify that data.
An Autopilot run must be denied access to `local-data/` unconditionally, including when
DexNest is itself the project under test.

Two consequences worth knowing:

- A git worktree is not a sandbox. It protects repository history and gives reversible
  working state; it does not stop a subprocess reading arbitrary paths. Access control
  must be enforced explicitly.
- The data root is resolved by absolute path (`D:\DeskNest\local-data`) whenever it
  exists, regardless of where the app is launched from. Anything that launches DexNest
  from an isolated working copy must set `DEXNEST_DATA_ROOT` to a scratch directory, or
  it will read and write the real user's live data.

## Current Priority

The original spine (desktop shell, action registry, event log, Command home, Dev
dashboard, Deck endpoints, Clipboard, Drop) is built, along with Vault, Search, OCR,
Ambient Voice, Heatmap and the remaining modules.

Current priority is **DexNest Autopilot**, built in phases. See
`docs/AUTOPILOT_ARCHITECTURE.md` for the design and the phase table.

Still not requested: mobile, Loop, general-PC automation, and everything in the
"Explicitly deferred" list of the Autopilot architecture document.

## Data Root

Default data root:

```txt
D:\DeskNest\local-data
./local-data
```

```txt
local-data/
  data/
    dexnest.sqlite
  files/
    documents/
    scans/
    receipts/
    vault/
    drop/
    captures/
  backups/
  index/
  settings/
```

## Gitignore

```txt
local-data/
*.db
*.sqlite
*.db-wal
*.db-shm
.env
.env.*
```

## UX Rule

DexNest should feel always available, not always busy.

Always-ready:

- Command hotkey
- Clipboard listener
- Deck endpoint
- tray service
- local action registry
- light notifications

On-demand only:

- OCR
- PDF compression
- AI indexing
- embeddings
- local LLM
- backups
- Heatmap aggregation
- Loop learning
