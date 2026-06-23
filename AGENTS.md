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
- No cloud, login, accounts, external APIs, Google Calendar OAuth, bank APIs, or full AI agents in v1.
- Heavy workers must be lazy and on-demand only.
- Idle CPU should stay near zero.
- GPU must not be used unless explicitly enabled later.
- Use DexNest design tokens only. No hardcoded colors in components.
- Use Inter for UI text and JetBrains Mono for technical text.
- Keep features modular and small.
- Do not add new modules unless explicitly requested.

## Current Priority

Build only the spine first:

1. Desktop shell
2. Action registry
3. Event log
4. Command home
5. Dev dashboard
6. Deck localhost endpoints
7. Clipboard and Drop later

Do not implement Vault, Search, OCR, AI, mobile, Ambient Voice, Heatmap, or Loop until requested.

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
