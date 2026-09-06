# DexNest Architecture

DexNest starts with one Electron shell and small workspace packages.

## Spine

- `apps/desktop`: Electron main process and React renderer.
- `packages/action-registry`: Action definition validation and in-memory registry.
- `packages/local-db`: SQLite setup and event log table.
- `packages/shared-types`: Shared TypeScript contracts.
- `packages/shared-ui`: Design tokens.
- `modules/command`: DexNest Command home screen.
- `modules/dev`: Dev dashboard placeholder.
- `modules/deck`: Deck action endpoint placeholder.

## Data Boundary

All real user data belongs under `./local-data`. The desktop app sets Electron `userData` to `./local-data/app` and stores SQLite data at `./local-data/data/dexnest.sqlite`.

`local-data/` contains private user data (vault, finance, integration keychain, event log). Source-code access does not imply access to it — see the Sensitive Data Boundary section of `../AGENTS.md`.

## Autopilot

See `AUTOPILOT_ARCHITECTURE.md` for the Autopilot runtime design. Autopilot lives in `packages/autopilot-runtime` (no Electron imports) with views under `apps/desktop/src/renderer/views/`.
