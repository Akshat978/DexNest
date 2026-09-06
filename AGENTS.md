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
  server of its own, and never phones home.
- No Google Calendar OAuth, bank APIs, or other third-party data integrations that would
  pull private accounts into DexNest.
- Autopilot is the one approved exception to "no external AI" — see the Autopilot
  section below. Everything outside Autopilot stays local.
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
