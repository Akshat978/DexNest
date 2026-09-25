# `@dexnest/dev-intelligence`

Developer Intelligence: observes local Git repositories read-only and records
facts other modules reuse - repository state, commits, conflicts, TODO markers,
technologies and the results of health checks the user configured.

- `scan/` - the scan orchestrator (bounded concurrency, cancel, partial
  failure, crash recovery, incremental enrichment).
- `module/runtime.ts` - the DexNest module: settings, the host-scheduled scan
  job, the day's Standup after a scan, and data-boundary enforcement.
  Hosted by `apps/desktop/src/main/devIntelligenceHost.ts`.

Files are read only from Git's listing (`git ls-files`), and every path is
checked against DexNest's data boundary before it is opened. Persistence is
injected (`PersistencePorts`, implemented by `@dexnest/dev-intelligence-store`).

`pnpm --filter @dexnest/dev-intelligence test` runs the suite against real git.
See `docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`.
