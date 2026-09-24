# DexNest shared foundation

What every DexNest module shares, and why each piece is shaped the way it is.
Code: `packages/foundation` (`@dexnest/foundation`). Authoritative for new
modules: Developer Intelligence, Standup, Patchwork, and whatever follows.

The rule behind all of it: **one foundation, many consumers.** Two standalone
subsystems (Developer Intelligence, Patchwork) had each grown their own
database driver, event table, host-port list and action concept. Six more
planned systems would have done the same. This document fixes one answer per
concept, taken from code DexNest already had wherever that code was sound.

The foundation is deliberately small. It holds only what more than one module
genuinely needed. It is not a framework and does not load modules.

---

## 1. Persistence

**Decision: one database, namespaced tables, accessed through the `SqlDatabase`
port.** (Option A in the original question - the existing database directly -
done through a shared helper rather than a new DB service.)

- The database is `<dataRoot>/data/dexnest.sqlite`, opened once by
  `@dexnest/local-db` with better-sqlite3 in WAL mode. There is no second file.
- Each module owns a table prefix (`autopilot_`, `dev_`, `standup_`, later
  `patchwork_`) and never writes outside it. `validateManifest` checks this.
- Modules never import a driver. They receive a `SqlDatabase`
  (`exec`/`prepare`, statements with `run`/`get`/`all`, named or positional
  parameters). Production passes `localDb.getSqlDatabase()`; tests pass
  `createTestDatabase()` from `@dexnest/foundation/testing`, which is real SQLite
  (`node:sqlite`) on disk. Same SQL, same constraints, same transactions.
- **Every module gets the same adapter instance.** Transaction nesting is
  tracked per adapter; wrapping the connection twice would let two callers each
  believe they own the outermost transaction.
- Transactions: `withTransaction(db, work)` - `BEGIN IMMEDIATE` outermost,
  savepoints inside, synchronous by design (no `await` inside an open
  transaction). `afterCommit` defers announcements until the write is real.
- Migrations: `runModuleMigrations(db, moduleId, migrations)`. Each migration
  and its ledger row commit together; a failure rolls back both, so a crash
  mid-upgrade leaves nothing half-built and simply retries next start. Ledger:
  `dexnest_module_migrations (module, version)`.

**Why not a separate database or DB service (option B):** it would add a second
connection, second WAL, and make cross-module queries (Standup reading
repository events next to timetable data, say) impossible, to solve a problem
the table prefix already solves. Autopilot has run on option A since it was
built.

**Why not sql.js:** both standalone repos chose it only because
better-sqlite3 segfaulted on the Linux machine they were built on. sql.js keeps
the whole database in memory and serialises all of it to disk; Developer
Intelligence did that on every single write, non-atomically. SQLite's own WAL
journaling is crash-safe; a whole-file rewrite is not.

Crash safety comes from SQLite: WAL mode, `BEGIN IMMEDIATE`, and committed
transactions. Nothing in the foundation rewrites a database file.

*Exception kept:* Autopilot's own migration ledger (`autopilot_schema_migrations`)
predates this and stays - moving it would rewrite migration history in live
databases for no benefit.

## 2. Events

**Decision: one table, `event_log`, with one envelope. Domain event types stay
with their module.**

`event_log` already existed as the audit log. The foundation owns its schema and
extends it additively (migration `foundation:2`):

| Column | Meaning |
|---|---|
| `id` | Event id (UUID, or the module's own id) |
| `rowid` → `seq` | Global insertion order; the polling cursor |
| `type` | Namespaced: `dev.commit.observed`, `standup.report.generated` |
| `stream` | `audit` (what people read as activity) or a module stream (`dev`) |
| `module` | Owning module id; null only for pre-foundation rows |
| `subject` | The entity it is about (repository id, run id) |
| `source`, `source_identity` | Producer, and the producing instance (a scan run) |
| `occurred_at` | When the fact happened |
| `created_at` → `recordedAt` | When it was written |
| `schema_version` | Payload version |
| `idempotency_key` | Unique when present; a replay records nothing |
| `payload_json` | Type-specific data |

- **Idempotency**: `append` with an `idempotencyKey` is `INSERT OR IGNORE`
  against a partial unique index; a duplicate returns the original event and
  `inserted: false`. Keys are namespaced by module (`developer_intelligence:<fp>`).
- **Streams keep the Audit view readable.** `local-db`'s audit reads, counts and
  "clear audit history" are scoped to `stream = 'audit'`. A repository scan
  writing hundreds of observations cannot bury the actions a person took, and
  clearing activity history does not reset a module's own history.
- **Querying**: `query/count` by stream, module, subject, types, occurred-time
  range, and `afterSeq` cursor. `prune` requires a stream or module; nothing
  clears the whole log.
- **Subscription**: `subscribe(filter, listener)`, in-process, called after
  commit and never for a rolled-back or replayed append. Cross-process delivery
  is not needed today and is not built.
- Existing rows read back unchanged: stream `audit`, no module, `occurredAt`
  falling back to `created_at`. `local-db.appendEvent` keeps working as-is.

Unify the infrastructure, not the semantics: `dev.*` types, payloads and
fingerprints belong to Developer Intelligence; the foundation only stores and
serves them.

## 3. Actions

**Decision: `@dexnest/action-registry` is the only action system.** It already
has what a second system would reinvent: `DexNestActionDefinition` with danger
level, confirmation rule, reversibility, triggers, phone exposure, and
`runRegisteredAction` with journalling to the audit stream.

- A module contributes actions by registering definitions with its `moduleId`.
- A module or widget that wants something done names a registered action id and
  calls `ModuleActions.run(actionId, params)`. It never implements confirmation,
  danger levels or journalling itself.
- Navigation is an action (`desktop.view.<id>`), not a port.
- Developer Intelligence contributes none yet; it is read-only.

**For Patchwork** (later): a widget's "declared actions" become a list of
registered action ids plus display metadata. Patchwork keeps its capability
gate - what a widget *may* request - but the action itself, its danger level
and its journal entry are the registry's.

## 4. Host capabilities

**Decision: the minimum set some module demonstrably needs** (`ModuleHost`):

| Capability | Why it exists |
|---|---|
| `database` | The shared `SqlDatabase` |
| `events` | The shared `EventLog` |
| `boundary` | The data boundary (section 6) |
| `scheduler` | Host-owned background jobs |
| `settings` | Module-scoped JSON under the data root |
| `lifecycle` | `onBeforeQuit` for cancel/flush |
| `actions` | Run a registered action |

**Scheduler ownership: the host.** DexNest's background work already runs on
host-owned main-process timers (calendar sync, timetable effects, heatmap), and
only the host knows about Performance Mode, shutdown and idle CPU. A module
declares a `ScheduledJob` and exposes an idempotent entry point keyed by
`occurrenceId`; the host decides when it fires, skips `heavy` jobs in
Performance Mode, and coalesces a manual run with one already in flight.

**Removed**, from one or both standalone port lists:

- Telemetry - DexNest has none and adds none.
- Auth / identity - DexNest has no accounts.
- Navigation - an action.
- Theme - modules use the `@dexnest/shared-ui` design tokens.
- Timezone - one machine; `Intl` gives the OS zone.
- Command palette - it lists the action registry.
- Alternate storage root - there is one data root.
- Process/WSL bridge - stays inside Developer Intelligence, which runs in
  the Node main process and already has its own process-runner port.

## 5. Module integration

**Decision: no module loader.** DexNest compiles views into the renderer and
actions into the registry, and `modules/*` is not a live registration system
(AGENTS.md). Autopilot established the shape, and new modules follow it:

1. A **runtime package** under `packages/` with zero Electron imports. All I/O
   arrives through injected ports.
2. A **host file** `apps/desktop/src/main/<module>Host.ts` that builds the
   `ModuleHost`, runs the module's migrations, registers IPC and schedules jobs.
3. **Actions** registered in `@dexnest/action-registry` under the module id.
4. **A view** in the renderer, opened by a `desktop.view.<id>` action.
5. A **`DexNestModuleManifest`** declaring id, table prefix, migrations, event
   streams and types, action ids, views and jobs - so the host file is written
   and reviewed against a declaration. `validateManifest` catches tables outside
   the prefix and event types outside the namespace.

## 6. Security and data boundary

`local-data` holds the vault, finance records, journal, receipts, captures and
the DPAPI keychain. Source-code access does not imply data access.

- `createDataBoundary({ dataRoot, extraSensitiveRoots, realpath })` answers
  `isSensitive(path)`. Comparison is by path segment, case-insensitive on
  Windows, and against both the written and the `realpath` form of each side,
  so a junction pointing into the data root is recognised.
- Any module that reads files must check the boundary before reading, and must
  not rely on `.gitignore` alone - `local-data/` being ignored is
  defence-in-depth, not the defence.
- Tests use `assertSafeTestPath`/`createTestDatabase`, which refuse any path
  that looks like a DexNest data root.
- Launching DexNest from a working copy for testing must set
  `DEXNEST_DATA_ROOT` to a scratch directory (and, if the installed app is
  running, a separate `--user-data-dir`).

---

## Migration: Developer Intelligence (first consumer)

| Standalone | On the foundation |
|---|---|
| sql.js, whole-file rewrite per write | Shared better-sqlite3 connection via `SqlDatabase` |
| Own `schema_migrations` | `runModuleMigrations("developer_intelligence")` |
| Unprefixed tables (`repositories`, ...) | `dev_` and `standup_` prefixes |
| `developer_events` table | `event_log`, stream `dev`, module `developer_intelligence`, `subject` = repository id, `idempotency_key` = namespaced fingerprint |
| 8 host ports, all stubs | `ModuleHost`; timezone/theme/navigation dropped; process runner stays internal |
| Module-owned scheduling undecided | Host-owned scan and Standup jobs, idempotent by `occurrenceId` |
| TODO scan walked the whole tree | `git ls-files`, boundary check on every path |

## Migration: Patchwork (later - feature work stays paused)

| Standalone | On the foundation |
|---|---|
| sql.js, localStorage/browser sink | Shared connection; persistence in the main process over IPC, never renderer storage (data must live under the data root, not AppData) |
| Own `events` table | `event_log`, stream `patchwork`, module `patchwork`, subject = workspace id |
| Own declared-action model | Registered action ids; Patchwork keeps only its capability gate |
| Two contradictory host-port tables incl. Telemetry and Auth | `ModuleHost` |
| `--pw-*` variables with hard-coded fallbacks | `@dexnest/shared-ui` tokens |
| Workspace order ties broken by random UUID | Deterministic tiebreak (fixed on its alignment branch) |
| Phases 6-8 (QA, reliability, handoff) not run | Run after the above, on Windows |
