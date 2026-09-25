# Skill Constellation - handoff

Module id `skill_constellation` · tables `skill_*` · events `skill.*` on stream
`skill` · view `skills` · branch `claude/admiring-babbage-kbw2ew`.

Built in a Linux container. **Nothing here has been run on Windows.** Anything
that depends on Windows paths, NTFS junctions, Electron windows, fonts or
Performance Mode is listed under "Needs Windows check" and is unverified.

Design and decisions: `PLAN.md` (sections 15-15d record every decision you
made and every change made along the way). Linux test baseline:
`LINUX_BASELINE.md`.

---

## What it does

Shows your skills as a constellation. A skill exists only because Developer
Intelligence (DI) recorded something that supports it - a technology fact, a
TODO in a file of that language, or a commit in a repository that evidences
that language. Every star can show why: the repositories, files and dates
behind it. Strength is computed from evidence only (volume, recency,
variety); there is no XP, level or self-rating. It is off by default and
never reads disk: it reads DI's stores and the event log.

## What was built, package by package

### `@dexnest/dev-intelligence-contracts` + `@dexnest/dev-intelligence` (small change)

- `dev.commit.observed` now carries `authorEmail` (optional). The event
  fingerprint is unchanged, so rescans record nothing new and older events
  simply have no author. Test: `commit-author.test.ts`.

### `@dexnest/foundation` (small fix)

- `assertSafeTestPath` also checks the raw path string, so a Windows spelling
  of the data root (`d:\desknest\LOCAL-DATA`) is refused on POSIX too. It
  was the first failure in `pnpm test` on Linux and stopped every later
  package from running. The existing test is unchanged; the guard is stricter.

### `@dexnest/shared-types`, `@dexnest/action-registry`

- `"skill_constellation"` added to `DexNestModuleId`.
- Four registered actions, all `safe`, triggers `command` + `module_ui`, not
  phone- or Deck-exposed (evidence names local paths):
  `skill_constellation.open` (-> `desktop.view.skills`), `.rebuild`,
  `.enable`, `.disable`.

### `@dexnest/skill-constellation` (new, `packages/skill-constellation`)

| Folder | What | I/O |
|---|---|---|
| `domain/` | Types; the catalogue and related-pairs **data files**; evidence rules (incl. the private-path deny-list, repository-escape check and "my emails" filter); skills; strength; links; deterministic layout; history retention (52 builds); settings (off by default); event names and idempotency keys. | none (enforced by a static test) |
| `store/` | Migrations via `runModuleMigrations` for 7 `skill_*` tables; one-transaction build commit; one build per occurrence (unique key); crash recovery; history pruning. | shared `SqlDatabase` |
| `engine/` | Reads DI through its store interfaces and the `dev` event stream (paged by seq, cursor read first); per-repository data boundary; skip-when-unchanged; serialised builds; live TODO text for display. | DB reads only |
| `module/` | Runtime (start/stop, schedule the one heavy `rebuild` job only when enabled, rebuild, enable/disable, snapshot for the view) and the event writer (inside the build transaction). | via ports |
| `manifest.ts` | `SKILL_CONSTELLATION_MANIFEST`; `validateManifest` returns no problems (tested). | - |

### `apps/desktop`

- `src/main/skillConstellationHost.ts`: wiring. Data boundary over the live
  data root **and** every other DexNest data root (junctions resolved with
  `realpathSync.native`); IPC reads refused unless from the main window's main
  frame; skill ids validated; settings over IPC cannot switch the module on
  and are audited with counts only (never the emails).
- `src/main/main.ts`: starts the host after DI (not at all if DI failed),
  handles the three internal actions and the open navigation, disposes on quit.
- `src/main/preload.ts`: six `skillConstellation*` bridge methods.
- `src/renderer/views/SkillConstellationView.tsx` (+ `.css`, +
  `skillConstellationModel.ts`): the view; "Skills" in the sidebar after
  Autopilot; `DexNestBridge extends SkillConstellationBridge`; the Vite-preview
  fallback bridge shows the "off" state.

## Definition of done

| Requirement | Where it is proven |
|---|---|
| Manifest exported, `validateManifest` returns no problems | `store.test.ts` › manifest is valid |
| Migrations through `runModuleMigrations`; close/reopen finds everything | `store.test.ts` › everything survives closing and reopening |
| Every user-meaningful action registered and writes to the event log | `module.test.ts` › every user action writes to the event log; registered actions tests; `main.ts` journals each via `logActionEvent` |
| Scheduled/repeatable work idempotent (fired twice, one result) | `module.test.ts` › a scheduled slot fired twice…; `hardening.test.ts` › the host scheduler…, many rebuilds at once |
| Data boundary: bait files never recorded | `engine.test.ts` › data boundary (bait); `domain-evidence.test.ts` › private paths; `hardening.test.ts` › odd paths; desktop `skillConstellationHost.test.ts` › other data roots |
| Static test: no network/LLM imports (EC-036 style) | `static-safety.test.ts` (also: no fs/child_process imports; domain imports only domain) |
| No hex/rgb colours in the module's components | desktop `skillConstellationView.test.mjs` › design tokens only |
| Off by default; nothing runs until turned on | `module.test.ts` › is off by default (no timer); desktop host › is off by default |

## Final test counts (Linux)

| Package | Before (Phase 0) | After |
|---|---|---|
| foundation | 46 pass, 1 fail, 2 skipped (and the run stopped there) | 47 pass, 2 skipped |
| dev-intelligence-store | 10 | 10 |
| dev-intelligence | 85 pass, 2 fail, 1 skipped | 86 pass, 2 fail, 1 skipped |
| standup | 25 | 25 |
| **skill-constellation** | - | **135** |
| autopilot-runtime | 668 pass, 17 fail, 4 skipped | 668 pass, 17 fail, 4 skipped (same 17 by name) |
| today | 13 | 13 |
| action-registry | 26 | 26 |
| desktop | 165 | 188 |

Passing tests across the workspace: 1039 -> 1198 (final run after Phase 7).
Every
failure is a pre-existing Linux failure listed by name in
`LINUX_BASELINE.md`; no new failures in any phase. `pnpm typecheck` passes
across the workspace, and the three new desktop test files are type-checked
(they were added to `tsconfig.node.json`; `apps/desktop/test` was not
type-checked before).

The skipped tests are pre-existing Windows-only tests (junctions, process
trees). Skill Constellation adds no skipped or `.only` tests.

## Mutation checks done

Each was applied, shown failing, and reverted with the suite green again.

| Phase | Broke | Caught by |
|---|---|---|
| 0 | Test guard ignoring Windows spellings (the original bug) | foundation › tests refuse the real data root |
| 1 | Private-path refusal disabled | private paths › are never recorded…; › honour the host's boundary… |
| 1 | "My emails" filter disabled | commits › count only my commits… |
| 1 | DI emitting commits without `authorEmail` | commit-author.test.ts |
| 2 | Build commit split into two transactions | a build lands whole or not at all › when a later write… fails |
| 2 | Unique occurrence key removed | one occurrence is one build… (and later two more tests) |
| 3 | Host boundary not passed to the build | data boundary (bait) - `go` and `vue` leaked in |
| 3 | Skip-when-unchanged removed | a second build is skipped…; concurrent builds… |
| 3 | Build serialisation removed | concurrent builds… run one after the other |
| 4 | "Discovered once ever" key removed | a skill is discovered once ever… |
| 4 | Events written after commit instead of inside it | events and the build commit together… |
| 4 | Job no longer checks it is still enabled | a slot landing after it was turned off does nothing |
| 5 | Trusted-frame check removed / subframes allowed | refuses anything but the trusted main frame |
| 5 | Settings over IPC may switch it on | settings over IPC… cannot switch it on |
| 5 | Other data roots dropped from the boundary | the other data roots are off limits too… |
| 6 | Every star in the tab order | ready: … one tab stop |
| 6 | Literal hex colour in the CSS | components use design tokens only |
| 6 | Arrow-key direction cone removed | arrow keys move to the nearest star… |
| 6 | Hidden skills drawn | hidden skills are left out…; ready: … hidden skills are not drawn |
| 7 | Paths escaping the repository accepted | 6 × odd paths |
| 7 | `start()` no longer recovers crashed builds | restart…; start closes out a build a crash left running |
| 7 | A commit counted once per clone | the same commit in two clones…, plus 4 others |
| 7 | Re-ran Phase 2's split-transaction mutation | now also caught by 3 disk-fault-at-every-write tests (the Phase 2 gap) |

## Known gaps and what is untested

- **Real key events and focus in a live DOM.** The repo has no DOM test
  library and none was added. Keyboard logic is tested in the model, and the
  rendered markup is checked for the roving tab stop and labels; actual
  focus movement, the focus ring and Escape returning focus are not.
- **The Electron app itself was never launched.** Host, IPC and preload are
  tested with stand-ins that behave like Electron's where the host relies on
  them; the main and renderer bundles were built with Vite to confirm they
  compile and bundle.
- **Technology recency lags between events.** DI refreshes a still-present
  fact's `lastObservedAt` on every scan without writing an event, so an
  otherwise unchanged repository does not trigger a rebuild just to refresh
  that date. Commits and resolved TODOs always arrive as events.
- **Commit attribution is coarse by design.** DI's commit events carry no file
  list, so a commit is credited to the repository's languages only. With no
  "my emails" set, every commit counts (the view says so).
- **Two audit lines per user action.** A Rebuild / Turn on / Turn off click
  writes the action's journal line and the module's own line (the module
  audits so scheduled builds are logged too). `standup.generate` behaves the
  same today.
- **No retention on the `skill` event stream** beyond what one event per
  completed build implies (builds only complete when DI moved). DI's `dev`
  stream has no retention either.
- **Performance measured on Linux only**: a 50,000-commit, 200-repository
  history built in about 2 s including the synthetic inserts; an unchanged
  rebuild skipped in under 0.5 s. Memory was not measured.
- **`--font-mono`** is used by existing renderer styles but is not defined
  in the tokens (pre-existing). This module uses `--font-tech`.
- **DI and autopilot-runtime Linux failures** (19 tests) are pre-existing and
  untouched; see `LINUX_BASELINE.md`.

## Needs Windows check

Paths and the boundary
- A repository whose evidence paths come from Windows (backslashes are
  normalised to `/` in the domain; drive, UNC and `..` paths are refused).
- The boundary with the real `D:\DeskNest\local-data`, with a scratch
  `DEXNEST_DATA_ROOT`, and with a repository reached through an **NTFS
  junction** into the data root (`realpathSync.native`).
- `skill-constellation-settings.json` written under the real settings root,
  not AppData.

Electron
- The IPC trusted-frame check against a real `BrowserWindow`; the preload
  bridge under context isolation.
- The `skill_constellation.*` actions from the Command palette, and
  `skill_constellation.open` landing on the Skills view.
- Performance Mode actually holding off the heavy `rebuild` job; turning the
  module on creating exactly one timer and off removing it (tested with the
  real host scheduler on Linux).
- Idle CPU with the view open (there is no animation or timer in the view).

The view
- Inter and JetBrains Mono actually loaded (the tokens name them; the fonts
  are the app's).
- SVG star labels legible at the app's default size and window widths.
- Arrow-key focus moving between stars, the visible focus ring, Escape
  returning focus; Narrator reading the star labels.

Developer Intelligence on Windows
- `authorEmail` populated from real repositories; `myEmails` matching
  case-insensitively against them.
- The two DI tests that fail only on Linux (`LINUX_BASELINE.md`) pass there.

## What changed from the plan, and why

- **Authors (your answer 1):** DI now records `authorEmail`; "my emails"
  filters commits; unknown authors count. With no emails set, every commit
  counts - nothing says whose a commit is - and the view says so.
- **History (answer 6):** added `skill_strength_history`, pruned to the
  newest 52 completed builds; build rows older than all of them are pruned
  too so `skill_builds` stays bounded.
- **Data files are `.ts` literal files**, not JSON, so they load the same in
  vitest, Node and the Electron bundle without import attributes.
- **Curated links** do not count toward the four-links-per-star cap.
- **Deny-list** grew beyond the plan (`captures/`, `.ssh/`, `.gnupg/`,
  `.npmrc`, `.netrc`, `*.p12`, `*.pfx`, `*.kdbx`), and Phase 7 added the
  repository-escape rule.
- **`skill.constellation.built`** fires on every completed build rather than
  "when something changed"; a build only completes when DI moved, a
  build-relevant setting changed, or it was forced.
- **`force` option** on rebuild (not used by the scheduled job or the button).
- **Settings over IPC keep on/off unchanged**; on/off goes only through the
  journalled actions.
- **Skill Constellation does not start if DI failed to start** (it has
  nothing to read).
- **Same commit in two clones counts once** (Phase 7 decision): counting it
  per clone would invent evidence.
- **Tests outside the plan:** the desktop view is rendered with the app's own
  Vite (SSR) and `react-dom/server` instead of a DOM library, to avoid adding
  dependencies.
- **Gate on Linux:** per your answer 9, "no new failures + new package green",
  with each package's tests run separately because `pnpm test` stops at the
  first failing package.
