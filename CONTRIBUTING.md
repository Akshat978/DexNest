# Contributing to DexNest

Thanks for your interest! DexNest is an offline-first, local-only desktop app, and
a few project rules keep it that way. Please read these before opening a PR.

## Ground rules

- **Never commit user data.** `local-data/` is gitignored and must stay that way. It holds real documents, receipts, the vault, and the database.
- **Offline-first.** No cloud services, logins, accounts, external APIs, or telemetry. Everything runs on the user's machine.
- **Data stays in `local-data/`** - never write app data to Windows AppData.
- **Keep it modular.** Features live in `modules/` and register actions into the shared action registry; meaningful actions write metadata-only audit events.
- **Use the design tokens.** No hardcoded colors in components - see [`docs/DESIGN_TOKENS.md`](docs/DESIGN_TOKENS.md).

## Development setup

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

See the [README](README.md#build-from-source) for prerequisites (Node 20+, Windows C++ build tools for `better-sqlite3`).

## Before you open a PR

Both of these must pass:

```bash
corepack pnpm typecheck
corepack pnpm build
```

- Keep changes focused and match the surrounding code style.
- If you touch a module's actions or events, keep them consistent with [`docs/ACTION_EVENT_CONTRACTS.md`](docs/ACTION_EVENT_CONTRACTS.md).
- Describe what you changed and how you verified it.

## Reporting issues

Open a GitHub issue with your OS version, DexNest version (or commit), steps to
reproduce, and what you expected. For anything voice-related, the **Settings →
Ambient Voice / Wake** and **Speech / Voice Engine** diagnostics panels have the
details worth pasting in (paths, engine, mic level) - they contain no private content.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
