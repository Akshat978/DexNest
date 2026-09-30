# GhostOS core - handoff

Module id `ghost_os` · tables `ghost_*` · events `ghost.*` on stream `ghost` ·
view `ghost` · package `@dexnest/ghost-os` · branch `cloud/ghost-os`.

Built in a Linux container. **Nothing here has been run on Windows, and the
Electron app itself was never launched.** Its main and renderer bundles were
built with Vite to confirm they compile and bundle GhostOS as intended.
Everything Windows-specific is under "Needs Windows check" and is
unverified.

Design and every decision: `PLAN.md` (section 15 records your answers; the
"Refinements made in Phase N" notes record what changed along the way).
Linux test baseline: `LINUX_BASELINE.md`.

---

## What it does

A local model of you: people, projects, skills, knowledge, memories, events,
habits, decisions, file references, pasted conversations and places, how they
connect (typed, directed relations with strength and a validity range), and
dated observations about them - over time.

**Every fact says where it came from and how sure it is.** Each entity,
relation and observation carries its origin (entered by you, a source
adapter, or GhostOS's own habit detection), the source's reference, a list of
evidence and a confidence. A non-manual fact with no evidence is refused at
validation, in the store and on import. Manual entries are marked as entered
by you.

**Forget cascades**: forgetting an entry removes its connections, its
observations and everything derived from them - including the search index
and derivation links - in one transaction, and records a tombstone so a
source cannot bring it back.

It reads only what you type (and one export file you pick to import), plus -
**only once you turn it on** - Developer Intelligence's repository and
technology records and its `dev.commit.observed` events. It never reads the
vault, finance, journal, clipboard, captures, receipts, any other module's
content, chat histories, AI tool logs or auth files. No network, no LLM, no
embeddings, no sync. Event-log entries and audit lines carry ids, types and
counts, never your text.

MindAtlas and Memory Palace are not built; the data model (typed, weighted,
time-bounded relations; observations per entity; an entity table any layout
can key off) is shaped so they need no schema change.

## What was built

### Branch setup
- `2a125c7` - cherry-pick of `e6577c2` (foundation test guard recognises a
  Windows-spelled data root on POSIX), so the foundation package's tests pass
  on Linux.

### `@dexnest/shared-types`, `@dexnest/action-registry` (separate commit `227d27b`)
- `"ghost_os"` added to `DexNestModuleId`.
- Eleven actions, none phone- or Deck-exposed; editing ones `module_ui`
  only: `ghost_os.open` (-> `desktop.view.ghost`), `.entity.save`,
  `.relation.save`, `.observation.add`, `.decision.record_outcome`,
  `.forget`, `.adapter.enable`, `.adapter.disable`, `.adapter.sync`,
  `.export`, `.import`. **`forget` and `adapter.disable` are `caution` with a
  confirmation rule** (they delete data); the rest are `safe`.
- The only change outside the module's own package, desktop wiring and
  docs: the registry is the one action system.

### `@dexnest/ghost-os` (new, `packages/ghost-os`)

Depends on `@dexnest/foundation` only (a test enforces it) - not even on
Developer Intelligence's types: the adapter declares structural types
listing exactly the DI fields it reads.

| Folder | What | I/O |
|---|---|---|
| `domain/` | Types; ids (stable for source facts); **validation** of every row and input, per entity type; **provenance rules** (no evidence -> refused; confidence 0-1; derived never above 0.95; only habits are derived); **cascade planning** (forget/withdraw over the derivation graph, cycle-safe, with a step limit); **habit detectors** (time of day, weekly rhythm; fixed thresholds; 70-day lookback); search (FTS5 queries built from words only, LIKE patterns escaped) and timeline query parsing; the **export format** and all-or-nothing import parsing; the **read allowlist** and the commit projection (the only code that reads an event payload); the DI mapping (repositories -> projects, technologies -> skills, commits -> day observations); events; settings (every adapter off). | none (static test) |
| `store/` | Core tables via `runModuleMigrations` (ledger `ghost_os`): `ghost_entities`, `_tags`, `_relations`, `_observations`, `_derivations`, `_tombstones`, `_adapters`, `_runs`, `_state`. **FTS5 index in its own ledger** (`ghost_os_search`) with triggers; without FTS5 that ledger fails alone and search uses LIKE; when FTS5 appears the index is backfilled. Every write validated; derived rows written with their parents; tombstoned facts not written; forget/withdraw/import each one transaction; runs `UNIQUE (occurrence_id)`. | shared `SqlDatabase` |
| `adapters/` | The `SourceAdapter` interface (ready for Skill Constellation, Standup, Reality RPG); the **allowlisted event reader** (refuses any other stream, module or type before touching the log); the Developer Intelligence adapter (cursor by seq, rescans on seq regression, whole history for new projects, repositories inside DexNest's data not read past their record). | narrowed readers only |
| `engine/` | Sync: claim the occurrence, read outside a transaction, then write everything - entities, relations, observations, withdrawals of what the source no longer supports, habits, cursor, run record, the caller's events - in one transaction. Enable; disable = withdraw everything the adapter contributed (and derived from it). | via store |
| `module/` | Runtime: off by default; one **heavy** `sync` job only while a source is on (60 min, not at startup); a one-at-a-time sync queue; validated entry points for every action; `ghost.*` events inside the same transaction; audit lines with fixed summaries and ids/counts only; run recovery on start. | via ports |
| `manifest.ts` | `GHOST_OS_MANIFEST`, `GHOST_ACTION_IDS`; `validateManifest` returns no problems (core and search migrations). | - |

### `apps/desktop`
- `src/main/ghostOsHost.ts`: wiring; `createDataBoundary` with
  `realpathSync.native`; DI's stores **narrowed to the fields GhostOS reads**
  before it sees them; six IPC reads (`status`, `timeline`, `search`,
  `entity`, `settings`, `update-settings`) refused unless from the main
  window's main frame; `runGhostOsAction` maps each action to the module;
  export via a save dialog and import via an open dialog, both refused inside
  DexNest's data, import size-checked (64 MB) before reading; action messages
  are fixed text with counts (main.ts journals them).
- `src/main/main.ts`: starts the host after Developer Intelligence (works
  without it), routes and journals every `ghost_os.*` action, opens the
  `ghost` view, disposes on quit.
- `src/main/preload.ts`: six `ghostOs*` bridge methods.
- `src/renderer/views/GhostOsView.tsx` (+ `GhostOs.css`, `ghostOsModel.ts`):
  the view - Timeline (type filter, search, newest first, paged; entry
  detail with every fact's source, confidence and evidence; connections,
  observations, forget with confirmation, record a decision's outcome), Add
  (one form whose fields follow the type; edits your own entries), Sources
  (Developer Intelligence on/off, what it reads and never reads, sync,
  export, import). Loading, empty and error states; tabs keyboard-operable.
  "GhostOS" in the sidebar after Autopilot (icon `Ghost`, accent
  `--accent-search`). The renderer imports only types from the package.

## Definition of done

| Requirement | Proven by |
|---|---|
| Manifest exported; `validateManifest` returns no problems | `store.test.ts` › the manifest validates, and every table, index and trigger is under ghost_ |
| Migrations through `runModuleMigrations`; close/reopen keeps everything | `store.test.ts` › survives close and reopen: data stays, nothing is applied twice |
| Every user-meaningful action registered and writes to the event log | `module.test.ts` › each user action records its ghost event and one audit line; registration tests; desktop `ghostOsHost.test.ts` › every ghost_os action but open has a handler; `main.ts` journals each via `logActionEvent` |
| Scheduled work idempotent (fired twice, one result) | `module.test.ts` › a slot fired twice gives one result; `engine.test.ts` › the same occurrence twice does the work once; `hardening.test.ts` › the same slot delivered several times at once runs once |
| Data boundary: bait never recorded | `bait.test.ts` (other modules' events, audit rows, DI's other types, commit subjects and author emails, a repository inside the data root, files under it); `ghostOsHost.test.ts` › file references refused by path and through a link; DI narrowed to the fields it reads |
| Static test: no network/LLM (EC-036) | `static-safety.test.ts` (also: domain imports only domain; only `privacy.ts` reads a payload; no fs/process/os; no embedding or sync clients; foundation is the only dependency) |
| No hex/rgb in components | desktop `ghostOsView.test.mjs` › design tokens only |
| Off by default | `engine.test.ts` › reads nothing and writes nothing until the adapter is turned on; `module.test.ts` › starting schedules nothing; host › no timer exists until a source is turned on |
| Evidence and confidence on every fact | `validation.test.ts` › provenance…; `ghostOsView.test.mjs` › every fact with its source and its evidence |
| Forget cascades, nothing remains | `store.test.ts` › cascades through relations, observations and derived rows, and leaves no trace in search, links or the export; `engine.test.ts` › forgetting evidence removes the habit |
| Adapter off removes what it contributed | `engine.test.ts` › turning the adapter off removes everything it contributed, habits included |
| Export everything / import back | `store.test.ts` › round-trips everything into an empty GhostOS; `hardening.test.ts` › a large export imports back unchanged |
| Event log carries ids and types, never your text | `module.test.ts` › a marker in every text field appears nowhere in event_log, audit included |

## Final test counts (Linux)

| Package | Before (Phase 0) | After |
|---|---|---|
| foundation | 47 pass, 2 skipped | 47 pass, 2 skipped |
| dev-intelligence-store | 10 | 10 |
| dev-intelligence | 85 pass, 2 fail, 1 skipped | 85 pass, 2 fail, 1 skipped |
| standup | 25 | 25 |
| **ghost-os** | - | **160** |
| today | 13 | 13 |
| action-registry | 26 | 26 |
| desktop | 165 | 192 |
| autopilot-runtime | 668 pass, 17 fail, 4 skipped | 668 pass, 17 fail, 4 skipped (same 17 by name) |

Passing tests across the workspace: **1039 -> 1226**. Every failure is a
pre-existing Linux-only failure listed by name in `LINUX_BASELINE.md`; no
phase introduced a new one. `pnpm typecheck` passes, including the new
desktop test files (added to `tsconfig.node.json`). No skipped or `.only`
tests were added.

ghost-os by phase: 74 (1) -> 100 (2) -> 128 (3) -> 143 (4) -> 159 (7) -> 160
(8). Desktop: 165 -> 174 (5) -> 192 (6).

`pnpm test` on Linux stops at dev-intelligence's two known failures (the root
script chains packages with `&&`), so every gate ran each package separately.

## Mutation checks

Each was applied, shown failing, and reverted with the suite green again.

| Phase | Broke | Caught by |
|---|---|---|
| 1 | A fact with no evidence let through | 3 tests: adapter fact, derived habit, import file |
| 1 | Owner's words passed to FTS as syntax | 2 search tests (operators change results; stray quotes throw) |
| 2 | Forget without the derivation cascade | 4 store tests (forget, one observation -> habit, tombstones, withdraw) |
| 3 | Event reader accepts any query | reader test (the bait test alone does not catch it: the adapter's own query and the projection's re-check are two further layers) |
| 4 | Entity title put into an event payload | module › a marker in every text field appears nowhere in event_log |
| 5 | File-reference boundary check removed | host › refused by path and through a link; module › refused typed in or imported |
| 6 | Evidence shown without its source | view › every fact with its source and its evidence |
| 7 | Cascade cycle protection removed | cascade › ends on a derivation cycle; hardening › forget walks a cycle once (hit the step limit after 4 minutes of SQL - the limit was then lowered from 5M to 1M) |
| 8 | Editing a decision drops its recorded outcome (the bug found in Phase 8) | module › editing a decision keeps the outcome recorded for it |

## Known gaps and what is untested

- **The Electron app was never launched.** Host, IPC, preload and actions are
  tested with stand-ins that behave like Electron's where the host relies on
  them; dialogs are stand-ins.
- **No live-DOM tests.** The view is rendered to markup (Vite SSR +
  `react-dom/server`) and its logic tested in the model; real focus
  movement, focus rings and screen-reader output are not.
- **Choosing a connection's target** is limited to entries on the loaded
  timeline page. A proper entry picker (search inside the connection form)
  is the obvious next step.
- **Commits are "observed", not "mine".** On `main`, DI's commit events carry
  no author, so every commit in a watched repository counts (confidence 0.6;
  statements never say "I wrote"). The Skill Constellation branch has a DI
  change that records author email; with it, a "my emails" filter would be
  small.
- **Content is parsed, then dropped.** The foundation's `EventLog.query`
  parses each `dev.commit.observed` payload (including the subject line)
  before the projection keeps sha and time. It is in memory for an instant,
  never kept. A content-free read would need a foundation change.
- **A relation a source no longer supports is removed, not closed** (e.g. a
  technology gone from a repository). `validTo` exists for this; the DI
  adapter does not use it yet, so that history is lost on withdrawal.
- **Time-zone changes**: commit days are local days at sync time. Moving
  time zone splits later commits by the new zone; commits already recorded
  keep their day.
- **More than 1,000 commits in one repository on one day** keeps the first
  1,000 as evidence and counts those.
- **No retention** on the `ghost` event stream or `ghost_runs` (one run row
  per hourly sync while a source is on).
- **Two audit lines per user action** (the action's journal line and the
  module's own), as other modules do today.
- **Habit subjects**: a habit's identity is detector + subject ("commits").
  A second adapter reporting commits would share those habits; give it its
  own subject.
- **LIKE fallback** (only if FTS5 is missing) is ASCII case-insensitive and
  does not fold accents.
- **Memory** was not measured. Time was (Linux container, node:sqlite): 50,000
  commits across 20 repositories (7,300 day observations), first sync about
  3.5-3.7 s, quiet sync about 0.3 s, forgetting a project with 365 days of
  history about 30 ms.
- **Pre-existing, not this module's:** dev-intelligence (2) and
  autopilot-runtime (17) fail on Linux.

## Needs Windows check

Paths, files and the boundary
- File references and export/import paths refused inside
  `D:\DeskNest\local-data` and the live data root, **including through a
  junction** (tested on Linux with a symlink), and with Windows path
  spellings (drive letters, UNC, mixed case).
- Real Electron save/open dialogs; writing the export where the owner
  chooses; reading an import and the 64 MB size check.

SQLite
- **FTS5 on the Electron-rebuilt better-sqlite3.** Verified here on
  node:sqlite 3.51.2 and better-sqlite3 11.10.0 (Node build); if the
  Electron build lacks FTS5, search falls back to LIKE and the Sources tab
  shows "simple".
- Timings on Windows for a large sync.

Electron
- The IPC trusted-frame check against a real `BrowserWindow`; the preload
  bridge under context isolation.
- `ghost_os.*` actions from the Command palette and the view; the
  confirmation for `forget` and `adapter.disable`; `ghost_os.open` landing on
  the view.
- Idle behaviour: no timer while every source is off; one heavy hourly job
  when on, skipped in Performance Mode.

Data as Windows writes it
- DI repository roots with Windows paths and WSL roots (project names come
  from the display name or the root's last segment).
- Local day and part of day in the Windows time zone (ICU maps Windows
  zones), including a DST change.

The view and fonts
- Inter and JetBrains Mono actually loaded; date inputs; tab arrow keys;
  visible focus rings; Narrator reading tabs, forms and the forget
  confirmation.

## Changes from the plan, and why

- **No DI package dependency, not even types** (Phase 3): structural types
  list exactly the DI fields GhostOS reads; the host narrows DI's objects to
  them (Phase 5). The field list is the privacy contract, in code.
- **Provenance is uniform** (Phase 1): entities carry evidence and
  confidence too, not only observations.
- **One observation per repository per local day**, no separate "used X on
  day Z" observations (Phase 3): skills connect through `uses` relations.
- **Settings live in GhostOS's tables** (`ghost_state`, `ghost_adapters`), not
  a settings file (Phases 2/4): an adapter's on/off changes in the same
  transaction as the data it adds or withdraws. One more table than planned
  (`ghost_state`).
- **Search index keyed by an explicit `fts_rowid`**, kept by triggers from the
  optional search ledger (Phase 2): SQLite's implicit rowid can be
  renumbered by VACUUM.
- **Sync reconciles** (Phase 3): what the source no longer supports is
  removed (no tombstone); observations only go with their entity.
- **`ghost.adapter.synced` only when something changed** (Phase 4): a quiet
  hourly sync leaves a run row, not an event.
- **Export file written inside the export event's transaction** (Phase 5): a
  failed write leaves no event. Validation errors name fields, never values.
- **Forget has a step limit** and **habit detection reads 70 days**
  (Phase 7), both found by the hardening tests.
- **Imported tombstones for facts still held here are skipped** (Phase 7):
  import merges and never removes.
- **Editing a decision keeps its recorded outcome** (Phase 8): the edit form
  does not carry the outcome, and saving replaced the details wholesale.
- **Relation targets from the loaded timeline** (Phase 6): see known gaps.
