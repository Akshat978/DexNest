# DexNest

DexNest is an offline-first Electron + React + TypeScript command center. It uses one desktop shell, local actions, local Audit events, and `./local-data` for real user data.

## Commands

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm build
corepack pnpm rebuild:native
```

## Windows Packaging Prep

```bash
corepack pnpm package:win
corepack pnpm dist:win
```

Packaged output is written under `apps/desktop/release/`. Do not commit `release/` or `local-data/`.

## Backup

DexNest backup and restore lives in Settings. Backups are local zip files under:

```text
./local-data/backups
```

Default backups include settings, files, local database files, vault documents, the encrypted secure vault file, receipts, and Drop files. The rebuildable search index is excluded by default.

Restore previews a backup zip first, extracts to staging, creates a safety backup, then replaces only known DexNest local-data folders.

## Health Check

Open Settings and use `App Health` -> `Run health check` to verify local-data safety, Git safety, action registry shape, Audit status, Secure Vault status, performance assumptions, and local integrations. Checks run on demand only and log one metadata-only Audit event.

## Local Data

DexNest stores real user data under:

```text
./local-data
```

The Electron shell sets its `userData`, session, logs, and crash dump paths under `./local-data` so DexNest data does not go to Windows AppData.

## Local Action Endpoint

```text
POST http://127.0.0.1:43217/actions/:actionId
```

## Branch Policy

- `dev` is active development.
- `main` is production/stable only.
