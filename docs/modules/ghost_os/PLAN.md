# GhostOS core - plan

Module id `ghost_os` · table prefix `ghost_` · event namespace `ghost.` ·
event stream `ghost` · view id `ghost` · package `@dexnest/ghost-os` ·
branch `cloud/ghost-os`.

Status: **Phase 0 (plan).** Nothing is built yet. Read with `AGENTS.md` and
`docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`. Shaped after Developer
Intelligence's runtime/host split, and after the two modules built before it
on other branches (Skill Constellation, Reality RPG).

---

## 1. What it is

A local model of the owner: the people, projects, skills, knowledge,
memories, events, habits, decisions, files, conversations and places in
their life, how they connect, and how that changes over time. It is the
shared "who I am and what I've done" layer other modules can build on.

Every fact carries **where it came from** and **how sure it is**. A fact with
no source does not exist. Manual entries are marked as the owner's.

Two later views (MindAtlas: an analytical graph; Memory Palace: a spatial
view) will read the same data. They are **not** built now; the data model
below is shaped so they need no schema change (section 6).

## 2. Scope (this build)

- Entities of eleven types, relations (typed, directed, with strength and a
  validity range), observations (dated facts with source, evidence and
  confidence), and a provenance graph that makes "forget" cascade.
- Manual entry for every type, with type-specific details for memory,
  decision, habit, file and conversation.
- One source adapter, **Developer Intelligence** (repositories → projects,
  technologies → skills, commits as evidence), behind an adapter interface
  that Skill Constellation, Standup and Reality RPG can implement later.
- Simple, evidence-backed habit detection from observations (section 9).
- Timeline queries, local full-text search, JSON export and import.
- Registered actions, `ghost.*` events (ids and types only), a host file,
  IPC, preload bridge, and a simple view: timeline, entity detail, forms,
  adapter settings.

## 3. Out of scope

- MindAtlas and Memory Palace views.
- Inference beyond the simple habits in section 9: no guessing people,
  topics, sentiment, summaries or links from text.
- Reading any source not listed in section 5 - including chat histories,
  AI tool logs, auth files, browser data, and every other DexNest module.
- Copying file contents: a File entity stores a path and a label, never
  bytes, and GhostOS never opens the file.
- Embeddings, LLMs, network, sync, telemetry.
- People derived from commit authors (DI's events on `main` carry no
  author; Q2).

## 4. Where the code lives

One package, layered by folder, with static tests enforcing the layers
(as in the two previous modules):

| Path | Contents | I/O |
|---|---|---|
| `packages/ghost-os/src/domain/` | Types, validation of every input, provenance and cascade planning, confidence rules, habit detection, timeline and search-query building, export format (schema + validation), settings, events. | none |
| `packages/ghost-os/src/store/` | Migrations; persistence; FTS index; cascade delete; tombstones; export/import in one transaction. | DB |
| `packages/ghost-os/src/adapters/` | The adapter interface and the Developer Intelligence adapter. | through injected, narrowed readers |
| `packages/ghost-os/src/engine/` | Adapter sync (idempotent, per occurrence), apply/withdraw a contribution, habit detection runs. | DB |
| `packages/ghost-os/src/module/` | Runtime: settings, jobs, entry points for every action, events, manifest. | via ports |
| `apps/desktop/src/main/ghostOsHost.ts` | Wiring, data boundary, IPC (trusted frame), export/import file dialogs. | Electron |
| `apps/desktop/src/renderer/views/GhostOsView.tsx` (+ css, model) | The view. | renderer |
| `packages/action-registry`, `packages/shared-types` | Action definitions and module id (separate commit, as last time). | - |

Dependencies: `@dexnest/foundation`, and `@dexnest/dev-intelligence-contracts`
for **types only** (the DI adapter gets DI's stores injected by the host, as
Skill Constellation did). No dependency on any other module package.

## 5. What GhostOS may read - and nothing else

This list is enforced in code and by tests (section 11).

| Source | Exactly what | How |
|---|---|---|
| The owner | Whatever they type into GhostOS forms, or paste as a conversation | View → registered actions |
| An import file the owner picks | One GhostOS export JSON | Host file dialog → size-capped read → schema validation |
| Developer Intelligence (adapter, off by default) | `repositories.listRepositories()`; `technologies.listByRepository()`; `event_log` rows of type **`dev.commit.observed`** only (stream `dev`, module `developer_intelligence`), envelope + `sha` and `authorDate` from the payload | DI's store interfaces and a wrapper around `EventLog.query` that refuses any other stream, module or type |
| Its own `ghost_*` tables | Everything | `SqlDatabase` |

**Never read:** vault, finance, journal, clipboard, captures, receipts, drop,
search index, OCR output, voice/speech, calendar, timetable, heatmap, audit
history, Autopilot runs, any other module's tables or files, chat histories,
AI tool logs (`.claude`, `.codex`, …), auth files, browser profiles. GhostOS
opens no file on disk except the import file the owner picks, and writes no
file except the export file the owner picks.

A File entity is a **reference**: path + label, validated against the data
boundary (section 10), never opened.

## 6. Data model

### Entity types

`person`, `project`, `skill`, `knowledge`, `memory`, `event`, `habit`,
`decision`, `file`, `conversation`, `place`.

Every entity: stable `id`, `type`, `title`, `notes`, `tags`, `created_at`,
`updated_at`, plus **provenance** (`origin`: `manual` | `adapter` |
`derived`, the adapter id and the source's own reference) and an optional
**time span** (`occurred_at`, or `started_at`/`ended_at`) so the timeline and
"what was I doing in March" are plain range queries.

Type-specific details (validated JSON per type):

| Type | Details |
|---|---|
| memory | `text`, `occurredAt`; people and places are **relations** (`memory -involves-> person`, `memory -at-> place`) |
| decision | `decidedAt`, `choice`, `alternatives[]`, `rationale`, later `outcome`, `outcomeAt`, `reviewAt` |
| habit | `cadence` (daily/weekly/…), `declared` or `detected`, detector id and parameters |
| file | `path`, `label` (never contents) |
| conversation | `text` as pasted, `participants[]` (names; optional relations to persons), `importedAt`, `sourceLabel` ("pasted") |
| event | `occurredAt`, optional `endedAt` |
| others | none beyond the common fields |

### Relations

Typed and directed: `from -type-> to`, e.g. `person -worked_on-> project`,
`project -uses-> skill`, `decision -about-> project`, `memory -involves->
person`. A small built-in vocabulary (`worked_on`, `uses`, `about`,
`involves`, `at`, `part_of`, `related_to`, `learned_from`, `led_to`) plus
free-form types matching `[a-z][a-z0-9_]{0,39}` (Q6). Each has `strength`
(0-1), `valid_from`, `valid_to` (null = still true), provenance, and times.

### Observations

Dated facts about one entity: `statement` (short, structured - e.g.
`used TypeScript in app`), `observed_at`, `source` (`manual` or
`adapter:developer_intelligence`), `evidence` (a list of references, e.g.
`{ kind: "commit", repositoryId, sha }`, `{ kind: "technology", factId,
path }`, `{ kind: "manual" }`), `confidence` (0-1), provenance.

### Provenance and derivation

`ghost_derivations (child_kind, child_id, parent_kind, parent_id)`: every
derived row (a detected habit, a relation or observation an adapter derived
from others) lists what it came from. **Forget** deletes the target, then
everything whose derivation reaches it, transitively, plus relations and
observations attached to a deleted entity. Planned in the domain (pure),
executed in one transaction.

**Tombstones:** forgetting something an adapter contributed records
`(adapter_id, source_ref)` in `ghost_tombstones`, so the next sync does not
bring it back (Q4).

### Tables (all via `runModuleMigrations`, prefix `ghost_`)

| Table | Key | Purpose |
|---|---|---|
| `ghost_entities` | `id`; `UNIQUE (adapter_id, source_ref)` for adapter rows | Common fields, `details_json`, provenance, time span |
| `ghost_tags` | `(entity_id, tag)` | Tags, for filtering |
| `ghost_relations` | `id`; `UNIQUE (adapter_id, source_ref)` | Relations with strength and validity |
| `ghost_observations` | `id`; `UNIQUE (adapter_id, source_ref)` | Observations with evidence JSON and confidence |
| `ghost_derivations` | `(child_kind, child_id, parent_kind, parent_id)` | Provenance graph for cascades |
| `ghost_tombstones` | `(adapter_id, source_ref)` | Forgotten adapter facts stay forgotten |
| `ghost_adapters` | `id` | Enabled flag, cursor, last sync, counts |
| `ghost_runs` | `id`; `UNIQUE (occurrence_id)` | One sync or detection run per occurrence |
| `ghost_search` | FTS5 (external content over entities: title, notes, tags) | Search (section 8) |

Indexes for the timeline: entities by `(type, occurred_at)`, `created_at`;
observations by `(entity_id, observed_at)` and `observed_at`; relations by
`from_id`, `to_id`.

**For MindAtlas later:** typed, weighted, time-bounded relations plus
observation counts per entity are exactly a weighted temporal graph. **For
Memory Palace later:** entities and relations suffice; any layout it needs
becomes its own table (`ghost_palace_*`) without touching these.

## 7. Confidence and evidence rules

- Manual entries: `origin = manual`, confidence 1.0, evidence `[{ kind:
  "manual" }]` ("entered by me").
- Adapter facts: confidence set by the adapter's documented rules, e.g. DI:
  project from a repository record 1.0; `project -uses-> skill` from a
  technology fact 0.9 (a manifest) or 0.7 (file extension only); "used X in
  repo Y on day Z" from commits that day 0.6 (a commit in a repo that uses X,
  not proof the commit touched X).
- Detected habits: confidence = the share of qualifying days (section 9),
  never above 0.95.
- Validation refuses an adapter or derived fact with no evidence, and a
  confidence outside 0-1.

## 8. Search and timeline

- **Search:** SQLite FTS5. Verified in this container on both drivers:
  node:sqlite (SQLite 3.51.2) and better-sqlite3 11.10.0 (SQLite 3.49.2)
  both create and query an FTS5 table with `unicode61 remove_diacritics`. The
  Electron-rebuilt better-sqlite3 on Windows is a *needs Windows check*. To
  make that safe: the FTS table lives in its **own migration ledger**
  (`runModuleMigrations(db, "ghost_os_search", …)`), so if FTS5 were
  missing, the core migrations still apply and search falls back to `LIKE`
  over titles, notes and tags. User input is turned into a quoted FTS query
  (no FTS syntax injection).
- **Timeline:** one query over entities (by `occurred_at`, else
  `created_at`) and observations (by `observed_at`) in a date range,
  filterable by type and by origin, paged.

## 9. Habits (the only inference)

- **Declared:** the owner creates a habit entity.
- **Detected** (after an adapter sync, from observations only), two
  detectors to start:
  - *time of day*: "commits most evenings" - over the last 30 days, on at
    least 8 days with commits, ≥ 60% of those days had a commit in the same
    local part of day (morning/afternoon/evening/night).
  - *weekly rhythm*: "commits on N days a week" - over the last 8 ISO weeks,
    the median number of days with commits, when ≥ 3 and stable.
- A detected habit's evidence is the observations it counted
  (`ghost_derivations`), so forgetting those observations - or turning the
  adapter off - removes the habit. Re-detection updates the same habit
  (stable id per detector + subject).

## 10. Privacy rules in practice

- Section 5 is enforced: the DI adapter receives only a DI reader and an
  event reader that throws on anything but `dev.commit.observed` in the
  `dev` stream from `developer_intelligence`.
- **File references** are checked with `createDataBoundary` (the live data
  root and every other DexNest data root, junctions resolved) and refused
  inside them. GhostOS never opens the file. Q5 proposes also refusing
  well-known secret locations.
- **Conversations** exist only when the owner pastes one. Nothing is read
  from any chat or AI tool store.
- **Event log** entries carry ids, types and counts only - never titles,
  notes, text, paths or tags. Audit lines say what kind of thing happened
  ("GhostOS entity saved"), never the owner's text.
- **Forget** cascades (section 6). Turning an adapter off withdraws
  everything it contributed and everything derived from it.
- **Export** writes one JSON file the owner chooses the location of;
  **import** reads one file the owner picks, size-capped, validated; file
  references in it are re-checked against the boundary.

## 11. Events

Stream `ghost`, module `ghost_os`, payloads ids / types / counts only:

| Type | Subject | When |
|---|---|---|
| `ghost.entity.saved` | entity id | Created or updated (payload: type, origin, created/updated) |
| `ghost.relation.saved` | relation id | Created or updated (payload: relation type) |
| `ghost.observation.recorded` | observation id | Manual observations only; adapter observations are counted in the sync event |
| `ghost.forgotten` | the forgotten row's id | Payload: kind and counts of what the cascade removed |
| `ghost.adapter.synced` | adapter id | Idempotency key `ghost_os:sync:<occurrenceId>`; counts added/updated/withdrawn |
| `ghost.adapter.withdrawn` | adapter id | Adapter turned off; counts removed |
| `ghost.habit.detected` | habit id | Idempotency key per habit and detection period |
| `ghost.export.created` / `ghost.import.completed` | - | Counts only |

## 12. Actions

`moduleId: "ghost_os"`, all `safe` except the two that remove data in bulk
(`ghost_os.forget` of an entity with many dependents and
`ghost_os.adapter.disable` withdraw data - proposed `caution`, Q7); none
phone- or Deck-exposed; editing actions `module_ui` only.

`ghost_os.open` (-> `desktop.view.ghost`), `ghost_os.entity.save`,
`ghost_os.relation.save`, `ghost_os.observation.add`,
`ghost_os.decision.record_outcome`, `ghost_os.forget` (entity, relation or
observation), `ghost_os.adapter.enable`, `ghost_os.adapter.disable`,
`ghost_os.adapter.sync`, `ghost_os.export`, `ghost_os.import`.

## 13. Scheduling

One job, `sync`, via `createHostScheduler`: scheduled only while at least one
adapter is enabled (no timer otherwise), `heavy: true` (it walks DI's
records and commit history), interval 60 minutes, `runAtStartup: false`
(DI's own startup scan comes first). Each run: each enabled adapter syncs
from its cursor (idempotent per occurrence and per source record), then the
habit detectors run. Manual "Sync now" joins or queues behind a scheduled
run. Manual entry, search, timeline and export need no job.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Something private is read | Section 5 allowlist; narrowed readers that throw; static test on imports; bait tests with vault/finance/journal/clipboard rows and files |
| Owner text leaks into event log or audit | Payloads and summaries built from ids/types/counts only; a test fills every text field with a marker and scans `event_log` |
| Forget leaves something behind | Cascade planned in the domain over the derivation graph; test forgets every kind and checks no row, FTS entry or event text references it |
| A re-sync resurrects forgotten facts | Tombstones (Q4) |
| DI commits include other people's (no author on `main`) | Evidence says "commit observed in repo", confidence 0.6, statements never say "I wrote"; Q2 |
| FTS5 missing on the Windows build | Separate migration ledger + `LIKE` fallback |
| Import of a hostile or huge file | Size cap, JSON schema validation, id/type checks, boundary re-check on file paths, one transaction (all or nothing) |
| Large DI history (tens of thousands of commits) | Commits become per-repo-per-day observations, not one row per commit (Q3); paged reads by seq; heavy job |
| Timeline across time zones / DST | Local day via `Intl`, as in the previous modules |
| Relations that change | `valid_from`/`valid_to`, never overwritten silently: a changed fact closes the old range and opens a new one |

## 15. Open questions for you

1. **Import behaviour.** Merge into what exists (default: an id already
   present is left as is and reported), or "replace everything" (wipe then
   import)? Or both, with replace behind a confirmation?
2. **Commit authors.** On `main`, DI's commit events have no author, so every
   observed commit counts, including other people's. Bring over the small DI
   change from the Skill Constellation branch (records `authorEmail`; its
   own commit, as there), plus a "my emails" setting here? Or accept "commits
   observed" as evidence with the lower confidence as planned?
3. **Commit granularity.** One observation per repository per day ("3
   commits in app on 2026-06-01", evidence: the shas) - default - or one per
   commit?
4. **Forget and adapters.** Forgetting something an adapter contributed
   keeps it forgotten on the next sync (tombstone, default). Should turning
   the adapter off and on again clear those tombstones, or keep them?
5. **File references.** Refuse only DexNest's data roots (the brief), or also
   well-known secret locations (`.ssh`, `.gnupg`, `.aws`, AI tool config
   folders, browser profiles)?
6. **Relation types.** The built-in vocabulary plus free-form (default), or
   the built-in list only?
7. **Danger levels.** `ghost_os.forget` and `ghost_os.adapter.disable` remove
   data: mark them `caution` with the registry's confirmation, or keep all
   actions `safe` like the previous modules?
8. **Skills from DI.** Which technology facts become skills: languages,
   runtimes, tooling and package managers (default), or libraries too?
9. **Export location.** Always ask with a save dialog (default), or also
   offer a default under the data root's `backups/`?
10. **Accent colour.** No GhostOS token exists. Reuse one (suggest
    `--accent-search` or `--accent-command`)? No new tokens unless you say.

## 16. Phases for this module

Each phase ends at the gate: `pnpm typecheck`; every package's tests with no
new failures against the Linux baseline (section 17); new tests; a mutation
check; commit and push to `cloud/ghost-os`; report.

| Phase | Deliverable | Key tests | Planned mutation check |
|---|---|---|---|
| 1 Contracts | `domain/`: types; validation of entities (per type), relations, observations (no evidence → refused for non-manual; confidence bounds); cascade planning over the derivation graph; habit detectors; timeline/search query building (FTS quoting); export schema; settings; events | Cascade reaches every derived row; evidence required; habits need their thresholds; FTS input can't inject syntax; static test: domain imports only domain | Let a derived fact through without evidence |
| 2 Store | Migrations (core + separate search ledger), CRUD, FTS sync, cascade delete in one transaction, tombstones, export/import (all or nothing), manifest | Close/reopen; forget cascades incl. FTS; import rolls back on a bad row; LIKE fallback path; `validateManifest` = [] | Delete without the derivation cascade |
| 3 Engine | Adapter interface; DI adapter; sync apply/withdraw; habit detection | **Bait test** (vault/finance/journal/clipboard rows and files; commit payload text) - nothing recorded; reader refuses other types; turning off withdraws everything incl. habits; re-sync after forget doesn't resurrect | Let the event reader accept any type |
| 4 Actions + events | Registry entries (separate commit), runtime entry points, `ghost.*` events with idempotency keys, owner text never in events/audit | Sync slot fired twice → one result; every action writes the log; a marker in every text field never appears in `event_log` | Put the title into an event payload |
| 5 Host | `ghostOsHost.ts`: boundary for file refs, IPC trusted-frame, export/import dialogs, preload, `main.ts` wiring | Untrusted frames refused; file inside the data root (and via junction, where testable) refused; import size cap; no timer until an adapter is on | Remove the file-reference boundary check |
| 6 View | Timeline, entity detail (relations, observations, evidence, source), forms (entity, relation, decision, memory, file, conversation), adapter settings; empty/loading/error; keyboard | Rendered states (Vite SSR + `react-dom/server`); model tests; no hex/rgb | Show evidence without its source |
| 7 Hardening | Restart mid-sync, disk faults at every write, 50k commits, duplicate triggers, cyclic derivations, huge/hostile import, forget races with sync | As listed | Break cascade on cycles |
| 8 Handoff | `HANDOFF.md` | - | - |

## 17. Baseline (Linux)

Branch `cloud/ghost-os` is `origin/main` plus the cherry-picked foundation
test-guard fix (`e6577c2` → `2a125c7`), the same starting point as
`cloud/reality-rpg`. Known Linux-only failures, not this module's: 2 in
`@dexnest/dev-intelligence`, 17 in `@dexnest/autopilot-runtime`. Counts are
in the Phase 0 report; the list by name goes in `LINUX_BASELINE.md` in
Phase 1.
