# DexNest Blueprint Summary

Quick Codex-readable companion for the full blueprint `.docx`. The `.docx` remains the full reference.

## 1. Product Vision

DexNest is an offline-first personal command center for Windows, Android, and Stream Deck. It should feel like one connected local productivity layer, not a set of unrelated apps.

The desktop Command app is the hub: it launches actions, shows status, routes module commands, controls Stream Deck routines, and reads shared local data without cloud dependency.

## 2. Final Module List

1. DexNest Command
2. DexNest Drop
3. DexNest Clipboard
4. DexNest Tools
5. DexNest Vault
6. DexNest Search
7. DexNest Capture
8. DexNest Finance
9. DexNest Dev
10. DexNest Deck
11. DexNest Journal
12. DexNest Calendar
13. DexNest Finder
14. DexNest Heatmap
15. DexNest Voice
16. DexNest Loop

## 3. Build Order

1. Core contracts: action registry, event log, shortcut policy, performance budget.
2. Dev module and Deck localhost endpoints.
3. Clipboard and Drop.
4. Command home, pinned actions, stats shell, audit view.
5. Tools and scanner basics.
6. Journal, Calendar, and Voice.
7. Vault.
8. Capture and Finder.
9. Finance.
10. Search.
11. Heatmap.
12. Ambient Voice.
13. Loop.

## 4. Architecture Rules

- Use one Electron desktop shell with internal routing.
- Use one lightweight core service for tray, hotkey, clipboard listener, Deck endpoint, Drop server when enabled, and nudges.
- Modules must register actions into the shared action registry.
- Modules must write meaningful events into the shared event log.
- Android comes later with Expo React Native and acts mainly as capture/input.
- Stream Deck triggers the same registered actions as Command and module UIs.
- Avoid cloud, accounts, bank APIs, Google Calendar OAuth, and external APIs in v1.

## 5. Performance Rules

- DexNest should feel always available, not always busy.
- Idle CPU should stay near zero.
- GPU usage should stay at 0% unless explicitly enabled later.
- Always-ready: Command hotkey, Clipboard basics, Deck endpoint, tray service, local action registry, light nudges, Drop server only when enabled.
- Cold/on-demand only: OCR, PDF conversion, indexing, embeddings, local LLM, backups, Heatmap aggregation, Loop analysis, Ambient Voice.
- Performance/Gaming Mode pauses heavy workers, file watchers, Heatmap, Loop, Ambient Voice, backups, and GPU/AI tasks.

## 6. Data and Root Folder Rules

- All real user data must stay under `./local-data`.
- Do not store source data, documents, receipts, captures, vault data, indexes, or SQLite databases in C drive AppData.
- Use SQLite plus visible folders.
- Source files should remain portable and restorable.
- Search/AI indexes are rebuildable and are not source of truth.
- Backups and restore must be designed from day one.

Expected root shape:

```txt
local-data/
  data/
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

## 7. Action Registry and Event Log Importance

The action registry is the control spine. Command, Deck, Voice, Loop, routines, and module UIs should trigger the same stable action IDs.

The event log is the memory spine. It powers Stats, Audit/History, Heatmap summaries, Journal context, Loop suggestions, debugging, and restore confidence.

Audit events must record what happened, not private content. Store summaries and metadata, not full clipboard text, secrets, document contents, or private messages.

## 8. Current Build Priority

Build the spine first:

1. Desktop shell
2. Shared design tokens
3. Shared types
4. Local SQLite database
5. Event log
6. Action registry
7. Command home
8. Dev dashboard
9. Deck localhost endpoints
10. Clipboard and Drop placeholders

Do not implement Vault, Search, OCR, AI, mobile, Ambient Voice, Heatmap, or Loop until explicitly requested.
