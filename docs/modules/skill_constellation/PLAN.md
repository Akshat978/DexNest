# Skill Constellation - plan

Module id `skill_constellation` · table prefix `skill_` · event namespace `skill.` ·
event stream `skill` · view id `skills`.

Status: **Phase 3 (engine) done.** Decisions on the Phase 0 questions are in section 15. Read with `AGENTS.md` and
`docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`; this module is shaped after
Developer Intelligence (DI) and Standup.

---

## 1. What it is

A view of the owner's skills as a constellation, where every star exists only
because Developer Intelligence observed something that supports it, and every
star can say *why*: which repositories, which files, which dates.

It is a **consumer of DI facts**. DI's own contracts say so explicitly:
`TechnologyFact` - "Consumers may interpret these; DI must not infer skill
proficiency." Skill Constellation is that consumer. DI stays unchanged.

## 2. Scope

In scope:

- Derive skills from DI's recorded facts:
  - technology facts (`dev_technologies` through `TechnologyStore`) - languages,
    runtimes, package managers, tooling, and mapped libraries/frameworks;
  - TODO markers (`TodoStore`) - their file extension evidences a language, and
    resolved TODOs are dated activity;
  - commit observations (`dev.commit.observed` in `event_log`, stream `dev`) -
    dated activity in a repository;
  - the repository list (`RepositoryStore`) for names and identity.
- Every skill carries its evidence rows (repository, path, date, kind, and the
  DI record it came from).
- Strength from evidence only: **volume, recency, variety** (section 6).
- Links between skills from evidence: skills that co-occur in the same
  repositories (section 7).
- A rebuild that is off by default, idempotent, incremental-aware (skips work
  when the dev stream has not moved), and runs only on the host scheduler or on
  the user's request.
- Registered actions, event-log writes, a manifest, a host file with IPC, a
  preload bridge, and a renderer view.

## 3. Out of scope

- **Reading disk.** The module never opens a file, walks a directory, runs git
  or spawns a process. It reads DI's stores and the event log, nothing else.
- Inventing skills: no skill without at least one evidence row; no "XP", levels,
  badges, streaks or gamified numbers; no inference from commit messages.
- LLMs, embeddings, network, telemetry, cloud, import from GitHub/LinkedIn etc.
- Changing DI's scanner, its detection tables, or its events. (If DI coverage
  is too thin, that is a DI change for later, asked for separately.)
- Self-rating, goals, learning plans, endorsements, CV export.
- Mobile / phone / Deck exposure (results name local paths - same decision as
  `dev.scan_repositories`).
- A force-directed layout running continuously (idle CPU): layout is computed
  once, deterministically, per build (section 9).
- Strength history over time / trend charts (open question Q6).

## 4. Where the code lives

Following DI's split, but smaller - one package is enough for a module this
size, with the layers kept apart by folder and enforced by a static test:

| Path | Contents | I/O |
|---|---|---|
| `packages/skill-constellation/src/domain/` | Types, skill catalogue (name → canonical skill), extension map, strength, links, layout. Pure. | none |
| `packages/skill-constellation/src/store/` | Migrations, `skill_*` persistence on `SqlDatabase` | DB |
| `packages/skill-constellation/src/engine/` | Evidence collection from DI ports + event log, build, diffing | DB reads |
| `packages/skill-constellation/src/module/` | `runtime.ts`: settings, job, actions entry points, manifest | via ports |
| `apps/desktop/src/main/skillConstellationHost.ts` | Wiring + IPC (trusted-main-frame check) | Electron |
| `apps/desktop/src/main/preload.ts` | Bridge methods | Electron |
| `apps/desktop/src/renderer/views/SkillConstellationView.tsx` (+ `.css`) | The view | renderer |
| `packages/action-registry/src/index.ts` | Action definitions | - |

Dependencies: `@dexnest/foundation`, `@dexnest/dev-intelligence-contracts`
(types and the `PersistencePorts` interface only). Tests additionally use
`@dexnest/dev-intelligence-store/testing` and `@dexnest/foundation/testing` to
seed synthetic DI data on real SQLite in temp dirs. **No dependency on the DI
scanner package** (`@dexnest/dev-intelligence`): the host passes the DI
module's `persistence` in, so the constellation cannot trigger a scan.

Style: `.ts` specifiers and vitest, like the DI packages. Added to the root
`test` script.

## 5. Data model

### Domain types (Phase 1)

```ts
type SkillCategory = 'language' | 'framework' | 'library' | 'runtime' | 'tooling' | 'packageManager';

type EvidenceKind =
  | 'technology.manifest'    // package.json dep, Cargo.toml, go.mod, Dockerfile ...
  | 'technology.extension'   // language seen by file extension (DI samples one path)
  | 'technology.removed'     // was evidenced, since removed (kept, dated)
  | 'todo.open'              // open TODO in a file of this language
  | 'todo.resolved'          // TODO resolved: dated activity
  | 'commit';                // commit observed in a repo that evidences the skill

interface SkillEvidence {
  id: string;                // deterministic: hash(skillId, kind, sourceRef)
  skillId: string;
  kind: EvidenceKind;
  repositoryId: string;
  repositoryName: string | null;
  path: string | null;       // repository-relative, forward slashes; null for commits
  at: string;                // ISO date the evidence is dated by
  sourceRef: string;         // DI record: tech fact id / todo id / event id (sha for commits)
  detail: string | null;     // e.g. "package.json#dependencies react@^18" - never commit subjects/TODO text
}

interface Skill {
  id: string;                // slug of canonical name, e.g. "typescript"
  name: string;              // "TypeScript"
  category: SkillCategory;
  evidenceCount: number;
  repositoryCount: number;
  evidenceKinds: number;     // distinct kinds
  firstEvidenceAt: string;
  lastEvidenceAt: string;
  lastActivityAt: string | null;  // latest commit / resolved TODO
}

interface SkillLink { a: string; b: string; sharedRepositories: number; weight: number; } // a < b

interface SkillStrength { volume: number; recency: number; variety: number; score: number; } // 0..1 each
```

`Strength` is **computed at read time** from the stored counts and dates plus
`now`, never stored. Recency decays with time even when nothing is rescanned;
storing it would make a stored build go stale with no new input and would
force a rebuild just because the clock moved.

### Tables (Phase 2)

All created through `runModuleMigrations(db, 'skill_constellation', …)`:

| Table | Key | Purpose |
|---|---|---|
| `skill_builds` | `id`; `UNIQUE(occurrence_id)` | One row per build: occurrence id, trigger, dev cursor seq it consumed, started/finished, status (`running`/`completed`/`failed`/`skipped`), counts, error |
| `skill_skills` | `id` | Current skills (columns of `Skill`) + `build_id` |
| `skill_evidence` | `id`; index `(skill_id, at)` | Evidence rows (columns of `SkillEvidence`) |
| `skill_links` | `(a, b)` | Current links |
| `skill_layout` | `skill_id` | Deterministic x/y per star from the last build |
| `skill_state` | `key` | `dev_cursor_seq`, `last_build_id`, `settings_fingerprint` |
| `skill_strength_history` | `(build_id, skill_id)` | Strength per skill per build; last 52 builds kept |

Schema guards: `skill_skills.evidence_count > 0` (a skill with no evidence is
refused by SQLite itself), `skill_links` requires `a < b`, build status is a
closed set. When history is pruned to the newest 52 completed builds, build
rows older than all of them (skipped/failed included) are pruned too, so the
table stays bounded.

A build replaces `skill_skills`, `skill_evidence`, `skill_links`,
`skill_layout` inside **one** `withTransaction`, and writes its `skill_builds`
row and the new cursor in the same transaction. A crash mid-build leaves the
previous constellation intact; a `running` build row left by a crash is closed
out as `failed` on start (as DI does for scans).

Settings (not a table): `settings/skill-constellation-settings.json` under the
data root via `ModuleSettings`, like DI:

```ts
{ schemaVersion: 1, enabled: false, rebuildIntervalMinutes: 60,
  includeUnmappedLibraries: false, hiddenSkills: string[], myEmails: string[] }
```

## 6. Strength (evidence only)

Per skill, each in `[0, 1]`, deterministic, documented in code and shown in the
UI next to the numbers that produced it:

- **volume** = `1 - exp(-n / 20)` over evidence rows `n` (saturating; 20 is a
  constant, not a tuning knob in settings).
- **recency** = `0.5 ^ (daysSince(lastEvidenceAt) / 90)` - half-life 90 days,
  dated by the latest evidence (commits and resolved TODOs date activity; a
  technology fact is dated by `lastObservedAt`, i.e. "still present at the last
  scan").
- **variety** = mean of `min(repos/5, 1)` and `min(kinds/4, 1)`.
- **score** = `0.4·volume + 0.35·recency + 0.25·variety`.

A skill with zero evidence does not exist - there is no row to score. Hidden
skills (`hiddenSkills`) are still built but not shown; this is a display
preference, not a deletion.

## 7. Links

Two skills are linked when they are evidenced in the same repositories:
`weight = |repos(a) ∩ repos(b)| / |repos(a) ∪ repos(b)|` (Jaccard), kept when
`shared ≥ 2` or `weight ≥ 0.5`, at most 4 links per star (strongest first,
ties by id) so the drawing stays readable. Every link can explain itself: "both
in *app*, *api*". Curated links come from the data file
`src/domain/data/related-pairs.ts`, are drawn only when both skills already
exist, are marked `source: 'curated'`, and do not count toward the per-star cap.

## 8. Evidence rules

What becomes a skill, from DI's categories:

| DI category | Becomes a skill? |
|---|---|
| `language` | yes (TypeScript, Python, Go, Rust, …) |
| `runtime` | yes, canonicalised (`node` → Node.js, `python` → Python) |
| `packageManager` | yes (npm, pnpm, yarn, …) |
| `tooling` | yes (Docker) |
| `library` | only when in the **catalogue** (react → React, vitest → Vitest, electron → Electron, …); `@types/*` and unmapped deps ignored unless `includeUnmappedLibraries` |
| `project`, `baseImage`, `toolchain` | no - a project name or base image tag is not a skill |

- The catalogue is a static, reviewable table in `domain/catalogue.ts`. It maps
  names to a canonical skill; it never *creates* evidence.
- TODO markers evidence a language by file extension (same extension table as
  DI's detector, kept as a pure copy in the domain - DI's is not exported).
- **Commits** carry no file list and no author in DI's event payload
  (`sha, subject, authorDate, branch`). A commit therefore counts as dated
  activity in its repository, attributed to the repository's evidenced
  **languages** only, and labelled in the UI as "commit in *repo*", never as
  "wrote TypeScript". See Q1 / Q2.
- One repository with many `package.json` files counts once toward variety.
- **Stored text is minimal**: no commit subjects and no TODO text are copied
  into `skill_*`; evidence keeps the DI record id, the path and the date. The
  view can show a TODO's text by looking it up live from DI (Q5).

### Data boundary

The module reads no files, but it does record paths. Defence in depth:

1. Evidence whose repository root + relative path `boundary.isSensitive()` is
   dropped (catches a DI row written before DI's own boundary fixes).
2. A name deny-list drops evidence whose path looks private regardless of where
   it is: `local-data/`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.kdbx`,
   `*.sqlite`/`*.db`, `vault/`, `receipts/`, `finance/`, `journal/`.
3. Dropped evidence is counted (`refusedEvidence` on the build) - never logged
   by path.

Test (Phase 3/7): seed DI with bait facts and TODOs at `local-data/files/vault/journal.md`,
`.env`, `secrets/id_rsa`, `finance/receipts.sqlite`, and a repository root inside
the synthetic data root, and assert no `skill_*` row or event payload contains
them.

## 9. Layout

Computed in the domain at build time, stored in `skill_layout`, **no runtime
simulation**:

- Category sectors around a centre (languages, frameworks/libraries, runtimes,
  tooling, package managers), stars placed by strength (stronger = nearer the
  centre) with a deterministic angular jitter from a hash of the skill id.
- Same input → same coordinates (tested). Adding one skill does not reshuffle
  unrelated stars more than their sector.
- Rendered as SVG with a viewBox; star radius from score; link opacity from
  weight. Reduced-motion respected; no animation loop.

## 10. Events

Stream `skill`, module `skill_constellation`, namespace `skill.`:

| Type | Subject | Idempotency key | When |
|---|---|---|---|
| `skill.constellation.built` | build id | `skill_constellation:build:<occurrenceId>` | A build completed and changed something |
| `skill.discovered` | skill id | `skill_constellation:discovered:<skillId>` | A skill appears for the first time ever |
| `skill.evidence_lost` | skill id | `skill_constellation:lost:<skillId>:<buildId>` | A skill that existed has no evidence left |

Payloads carry ids, counts and dates - no paths, no text. Plus one audit-stream
line for each user-meaningful action (build requested, enabled/disabled), via
the host's `audit` callback exactly as DI does.

A build that finds the dev cursor unchanged and the settings fingerprint
unchanged records a `skipped` build row and **no** event.

## 11. Actions

Registered in `@dexnest/action-registry`, `moduleId: "skill_constellation"`,
`dangerLevel: "safe"`, not phone-exposed, triggers `command`, `module_ui`:

| Action id | handlerRef | Does |
|---|---|---|
| `skill_constellation.open` | `desktop.view.skills` | Open the view |
| `skill_constellation.rebuild` | `skill_constellation.rebuild` | Rebuild now (manual; runs even when the timer is paused; joins one in flight) |
| `skill_constellation.enable` | `skill_constellation.enable` | Turn on (starts the scheduled job) |
| `skill_constellation.disable` | `skill_constellation.disable` | Turn off (stops the job; keeps data) |

Each writes an audit line through `runRegisteredAction`'s journalling.

## 12. Scheduling

One job, `rebuild`, via `createHostScheduler`:

- Scheduled **only when enabled** (no timer at all when off - tested by timer
  count, as DI does).
- `heavy: true` - it aggregates over the whole dev history, so Performance
  Mode holds it off (AGENTS.md lists aggregation as on-demand work).
- Interval `rebuildIntervalMinutes` (default 60, min 15), `runAtStartup: false`
  - DI's own startup scan is the thing that produces new facts.
- Idempotent twice over: the `skill_builds.occurrence_id` unique key (a slot
  delivered twice builds once), and the dev cursor check (no new dev events,
  no work beyond one `SELECT MAX(seq)`).
- Opening the view never builds on its own; if stale it says so and offers
  Rebuild (Q4).

## 13. Reading the dev stream

- Facts (current state): `technologies.listByRepository`, `todos.listByRepository`,
  `repositories.listRepositories` through the injected `PersistencePorts`.
- History (dated activity): `EventLog.query({ stream: 'dev', module:
  'developer_intelligence', types: [...], afterSeq, orderBy: 'seq', limit })`
  paged by `afterSeq`, so a large history is read in bounded pages rather than
  capped at 500 like `listByRepository`.
- Staleness: `skill_state.dev_cursor_seq` vs the newest dev event seq.
- DI's tables are **read through its stores**, never by SQL against `dev_*`
  from this module (prefix ownership).
- The cursor is read first, then facts, and commits only up to the cursor, so
  a build never records a cursor newer than the input it used.
- Builds are serialised in-process; a failed build does not block the next.
- `force: true` rebuilds even when nothing changed (not used by the job).
- Known limit: DI refreshes a still-present fact's `lastObservedAt` on every
  scan without emitting an event, so an otherwise unchanged repository does
  not trigger a rebuild just to refresh that date. Activity (commits, resolved
  TODOs) always arrives as events.
- TODO text for the evidence panel: `engine.describeEvidence(skillId)` looks it
  up from DI's TODO store at call time; private-looking paths get none.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Commits by other people inflate activity (DI records every observed commit, no author in the event) | Label as repo activity, attribute only to languages, keep weight modest; Q1 |
| Library noise (80 deps per package.json) | Catalogue-only by default |
| DI coverage is thin (6 manifest types, one sample path per language) | Show honest evidence; no guessing to fill gaps. Out of scope to extend DI |
| Evidence records a private path | Boundary + deny-list + bait tests (section 8) |
| Large history (10k+ commits, many repos) | Paged reads, aggregation in memory per build, single transaction write; Phase 7 test with synthetic 50k events and a time budget |
| Idle CPU | No timer when off; heavy job; no render loop |
| DI later prunes the dev stream (retention not built yet) | A full rebuild reflects what DI still has; Q6 |
| Repository identity changes (DI id is path-derived) | Evidence keyed by DI ids; a renamed repo shows as its DI record does |
| Windows-only behaviour untestable here | "Needs Windows check" list kept from Phase 5 on |

## 15. Decisions (answers to the Phase 0 questions)

1. **Authors.** Developer Intelligence now records `authorEmail` on
   `dev.commit.observed` (separate commit, with a test; fingerprint unchanged,
   so no duplicates). Setting `myEmails`: when set, only commits whose author
   is in it count; a commit recorded without an author (older events) still
   counts. When `myEmails` is empty every commit counts, because nothing says
   whose it is - the view will say so and point at the setting.
2. **Commits** credit the repository's evidenced languages only.
3. **Links:** same-repository links, plus a hand-written pair list kept as
   data (`src/domain/data/related-pairs.ts`), drawn only when both skills exist.
4. **Build on open:** no. A Rebuild button only.
5. **TODO text:** looked up from Developer Intelligence at display time; never
   stored in `skill_*` (a test proves the domain drops it).
6. **History:** one strength row per skill per build, last 52 builds kept.
   Adds table `skill_strength_history` (Phase 2).
7. **Accent:** `--accent-dev`. No new tokens.
8. **Unmapped libraries:** hidden by default; `includeUnmappedLibraries` toggles.
9. **Gate on Linux:** no new failures, the new package fully green, and the
   pre-existing Linux failures listed by test name (section 17).

## 16. Phases for this module

Each phase ends at the gate in the brief (typecheck, whole-workspace tests, new
tests, a mutation check, commit + push, report).

| Phase | Deliverable | Key tests | Planned mutation check |
|---|---|---|---|
| 1 Contracts | `domain/`: types, catalogue, extension map, evidence normalisation + deny-list, strength, links, layout. Pure. Package scaffold, added to root `test`. | Strength monotonic in volume/recency/variety; zero evidence → no skill; catalogue never adds a skill without evidence; deny-list; links deterministic and capped; layout deterministic; static test: `domain/` imports nothing from `node:*` or a DB | Remove the "no evidence → no skill" guard |
| 2 Store | `skill_*` migrations via `runModuleMigrations`, persistence API, replace-in-one-transaction, manifest skeleton | Close and reopen DB, all rows there; failed replace leaves previous build intact; `validateManifest` returns `[]` | Split the replace into two transactions → crash test fails |
| 3 Engine | Evidence collection from `PersistencePorts` + paged event log, boundary filter, build, cursor/staleness | Synthetic DI data → expected skills and evidence; **bait files never recorded**; unchanged cursor → skipped; paging beyond 500 events | Disable the boundary filter → bait test fails |
| 4 Actions + events | Registry entries, `skill.*` events with idempotency keys, audit lines, runtime entry points, `rebuild` job idempotent by occurrence | Fire the same occurrence twice → one build, one event; discovered emitted once ever; every action writes the log | Drop the occurrence unique key → duplicate test fails |
| 5 Host | `skillConstellationHost.ts`, IPC with trusted-main-frame check, preload bridge, scheduler registration in `main.ts`, off by default | Host unit tests (untrusted sender refused, no job scheduled when off, dispose removes handlers) | Remove the frame check → refusal test fails |
| 6 View | `SkillConstellationView` via `desktop.view.skills`: SVG constellation, evidence panel, empty/loading/error/off/"DI has no data" states, keyboard (Tab to stars, arrows between neighbours, Enter opens evidence, Esc closes) | Render tests of states and keyboard; static test: no hex/rgb in the module's components; fonts via tokens | Inject a hex colour → static test fails |
| 7 Hardening | Restart mid-build, fault injection in stores, 50k synthetic events, duplicate triggers racing, removed tech, repo disappears, clock skew | As listed | Break the stale-`running` recovery → restart test fails |
| 8 Handoff | `HANDOFF.md` | - | - |

## 17. Baseline found in Phase 0

On this Linux container, `pnpm typecheck` passes. `pnpm test` did **not** pass
on the unchanged branch:

- `@dexnest/foundation` - `tests refuse the real data root` failed:
  `assertSafeTestPath("d:\\desknest\\LOCAL-DATA")` did not throw on POSIX
  (a Windows spelling resolves under the cwd with its backslashes intact).
  Because `pnpm test` stops at the first failing package, nothing after it ran.
  **Fixed in this phase** by making the guard also check the raw string
  (stricter guard, test unchanged).
- `@dexnest/dev-intelligence` - 2 failures, both environment-specific, **not
  fixed** (see the Phase 0 report): EC-006 (the container runs as root, so
  `chmod 000` does not deny) and the module-runtime junction test (on Linux the
  fixture's roots use domain `wsl`, which DI deliberately exempts from the
  boundary check). Both are expected to pass on Windows - needs Windows check.
- `@dexnest/autopilot-runtime` - 17 failures, not fixed: Windows path handling
  (`\tmp\...` paths, "outside every root" on backslash-joined paths) run on
  Linux. It does not use the foundation test guard. Needs Windows check.

Per-package baseline on Linux (after the foundation fix): foundation 47 pass /
2 skipped (Windows junctions); dev-intelligence-store 10; dev-intelligence 85
pass / 2 fail / 1 skipped; standup 25; autopilot-runtime 668 pass / 17 fail /
4 skipped; today 13; action-registry 26; desktop 165.

Until you say otherwise, every later phase's gate on this machine reads
"no new failures against this baseline, and the new package fully green", with
the full `pnpm test` result stated as-is.
