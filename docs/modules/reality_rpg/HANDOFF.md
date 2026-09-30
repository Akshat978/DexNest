# Reality RPG - handoff

Module id `reality_rpg` · tables `rpg_*` · events `rpg.*` on stream `rpg` ·
view `rpg` · package `@dexnest/reality-rpg` · branch `cloud/reality-rpg`.

Built in a Linux container. **Nothing here has been run on Windows, and the
Electron app itself was never launched.** Its main and renderer bundles were
built with Vite to confirm they compile. Everything Windows-specific is under
"Needs Windows check" and is unverified.

Design and every decision: `PLAN.md` (section 13b records your choices; the
Phase 1-7 notes record what changed along the way). Linux test baseline:
`LINUX_BASELINE.md`.

---

## What it does

A game layer over what already happens in DexNest. Rules - data, written by
the user - turn events in the shared `event_log` into XP for a stat. XP gives
a level; achievements unlock once when a condition over the award ledger is
met; quests are the user's own measurable goals (a count of awards, XP, or
distinct days, until done / daily / weekly / between two dates).

It reads **only the event types an enabled rule names** (with no rule
enabled, it reads nothing), keeps only an allow-listed envelope of each event
(id, seq, type, stream, module, action id, status, times - never content),
and **never uses vault, finance or journal activity**, or its own. Awarding
is idempotent: the same event never earns twice from the same rule. It is
off by default.

## What was built

### Branch setup
- `7e74c7e` - cherry-pick of `e6577c2` (foundation test guard recognises a
  Windows-spelled data root on POSIX), so the foundation package's tests pass
  on Linux.

### `@dexnest/shared-types`, `@dexnest/action-registry` (separate commit `233bf7d`)
- `"reality_rpg"` added to `DexNestModuleId`.
- Twelve actions, all `safe`, none phone- or Deck-exposed; the editing ones
  are `module_ui` only: `reality_rpg.open` (-> `desktop.view.rpg`),
  `.refresh`, `.enable`, `.disable`, `.rule.save`, `.rule.set_enabled`,
  `.rule.delete`, `.quest.create`, `.quest.abandon`, `.achievement.save`,
  `.achievement.delete`, `.backfill`.
- This is the only change outside the module's own package, desktop wiring
  and docs. It could not live in the module: the registry is the one action
  system.

### `@dexnest/reality-rpg` (new, `packages/reality-rpg`)

| Folder | What | I/O |
|---|---|---|
| `domain/` | Types; **projection** (the only code that reads a payload; drops vault/finance/journal and the game's own events; free text never passes); privacy rules; **validation** of rules, achievements and quests as data; matching; **awards** (idempotent by rule + event, daily caps by local day, rules start at `effectiveFrom` by recorded time); level curve (data); achievement and quest progress; local day / ISO week; settings (off by default); milestone event names and keys; a disabled starter pack (data). | none (static test) |
| `store/` | Migration 1 via `runModuleMigrations`: 10 `rpg_*` tables. Ledger `UNIQUE (rule_id, event_id)`; runs `UNIQUE (occurrence_id)`; one-transaction run commit; rule versions; stored definitions re-validated on read; crash recovery; definitions fingerprint. | shared `SqlDatabase` |
| `engine/` | Reads named types only, paged by seq after a cursor; projects; awards; evaluates achievements, quests (including periods of late-processed awards) and levels; commits once. Detects seq reuse after an audit clear and rescans. Skips idle runs on a fingerprint without loading the ledger. Serialised runs. | `event_log` reads |
| `module/` | Runtime: off by default; one light `process` job only while enabled; validated, audited entry points for every action; milestone events inside the run transaction. | via ports |
| `manifest.ts` | `REALITY_RPG_MANIFEST`; `validateManifest` returns no problems. | - |

### `apps/desktop`
- `src/main/realityRpgHost.ts`: wiring; IPC reads
  (`status`, `snapshot`, `history`, `settings`, `update-settings`) refused
  unless from the main window's main frame; history pages validated and
  capped at 200; settings over IPC cannot switch the module on;
  `runRealityRpgAction` maps each action and its params to the module.
- `src/main/main.ts`: starts the host after Developer Intelligence (it does
  not depend on it), routes and journals every `reality_rpg.*` action, opens
  the `rpg` view, disposes the host on quit.
- `src/main/preload.ts`: five `realityRpg*` bridge methods.
- `src/renderer/views/RealityRpgView.tsx` (+ `RealityRpg.css`,
  `realityRpgModel.ts`): the view; "Reality RPG" in the sidebar after
  Autopilot (icon `Swords`, accent `--accent-loop`); `DexNestBridge extends
  RealityRpgBridge`; the Vite-preview fallback bridge shows the "off" state.

## Definition of done

| Requirement | Proven by |
|---|---|
| Manifest exported; `validateManifest` returns no problems | `store.test.ts` › manifest is valid |
| Migrations through `runModuleMigrations`; close and reopen keeps everything | `store.test.ts` › everything survives closing and reopening |
| Every user-meaningful action registered and writes to the event log | `module.test.ts` › every user action writes to the event log; registered actions tests; desktop `realityRpgHost.test.ts` › every registered action is handled; `main.ts` journals each via `logActionEvent` |
| Scheduled/repeatable work idempotent (fired twice, one result) | `module.test.ts` › a scheduled slot fired twice…; `hardening.test.ts` › the real host scheduler…, ten refreshes at once; `engine.test.ts` › replaying from the start awards nothing twice |
| Data boundary: bait never recorded | `engine.test.ts` › bait: vault, finance and journal (content-laden rows, a mislabelled vault action, a rule broad enough to match everything); `projection.test.ts`; `hardening.test.ts` › corrupt or sneaky stored rule is never queried |
| Static test: no network/LLM imports (EC-036 style) | `static-safety.test.ts` (also: no fs/process imports; domain imports only domain; only the projection reads a payload) |
| No hex/rgb colours in the module's components | desktop `realityRpgView.test.mjs` › design tokens only |
| Off by default | `module.test.ts` › is off by default (no job, no timer, nothing read); desktop host › is off by default |

## Final test counts (Linux)

| Package | Before (Phase 0) | After |
|---|---|---|
| foundation | 47 pass, 2 skipped | 47 pass, 2 skipped |
| dev-intelligence-store | 10 | 10 |
| dev-intelligence | 85 pass, 2 fail, 1 skipped | 85 pass, 2 fail, 1 skipped |
| standup | 25 | 25 |
| **reality-rpg** | - | **126** |
| autopilot-runtime | 668 pass, 17 fail, 4 skipped | 668 pass, 17 fail, 4 skipped (same 17 by name) |
| today | 13 | 13 |
| action-registry | 26 | 26 |
| desktop | 165 | 192 |

Passing tests across the workspace: **1039 -> 1192**. Every failure is a
pre-existing Linux-only failure listed by name in `LINUX_BASELINE.md`; no
phase introduced a new one. `pnpm typecheck` passes, and the three new
desktop test files are type-checked (added to `tsconfig.node.json`;
`apps/desktop/test` was not type-checked before). No skipped or `.only` tests
were added.

`pnpm test` on Linux still stops at dev-intelligence's two known failures
(the root script chains packages with `&&`), so every gate ran each
package's tests separately.

## Mutation checks

Each was applied, shown failing, and reverted with the suite green again.

| Phase | Broke | Caught by |
|---|---|---|
| 1 | Projection copies the whole payload | 3 projection tests (incl. "legacy audit rows… no content") |
| 1 | Validation stops refusing vault/finance/journal | 5 validation tests |
| 1 | Awards stop skipping what is already awarded | awards › is idempotent… |
| 2 | Ledger `UNIQUE (rule_id, event_id)` removed | store › the ledger holds each (rule, event) once (the forged-id case) |
| 2 | Run commit split into two transactions | 5 store tests (thrown error + 4 disk faults) |
| 2 | Run `UNIQUE (occurrence_id)` removed | store › one occurrence is one run |
| 3 | Log queried without the `types` filter | engine › reads only the event types enabled rules name |
| 3 | Seq-regression detection disabled | engine › seq reuse after an audit clear |
| 3 | Engine keeps rows the projection would drop | engine bait test; static check "only the projection reads a payload" |
| 4 | Milestone events written after the commit | module › milestone events and the run commit together |
| 4 | Job no longer re-checks it is enabled | module › a slot landing after it was turned off does nothing |
| 4 | The game's own audit lines let through | module › own audit lines never earn XP; projection test |
| 5 | Trusted-frame check removed / subframes allowed | host › refuses anything but the trusted main frame |
| 5 | History page not capped | host › history… caps its size (first **missed**; the test used an empty ledger - strengthened with 250 awards, then caught) |
| 5 | `main.ts` stops routing `reality_rpg.*` | host › main.ts starts, routes and disposes the host |
| 6 | Every tab in the tab order | view › tabs: one tab stop |
| 6 | Literal hex colour in the CSS | view › design tokens only |
| 6 | Backfill offered for switched-off rules | view › rules… |
| 6 | History line includes event content | model › history lines name the rule and action, never event content |
| 7 | Unreadable-time crash restored | hardening › an event with an unreadable time is skipped |
| 7 | Idle skip ignores changed definitions | engine › a new achievement is unlocked from existing awards |
| 7 | Idle skip removed (idle runs load the ledger) | hardening › 100,000-event log (idle-run time limit) |

## Known gaps and what is untested

- **Real key events and focus in a live DOM.** No DOM test library exists in
  the repo and none was added. The view is rendered to markup (Vite SSR +
  `react-dom/server`) and its keyboard logic is tested in the model; actual
  focus movement, focus rings and screen-reader output are not.
- **The Electron app was never launched.** Host, IPC, preload and actions are
  tested with stand-ins that behave like Electron's where the host relies on
  them.
- **Memory** was not measured. Time was (Linux container): a 100,000-row log
  with 50,000 named events processed in about 1.3-1.6 s; the next run with 10
  new events about 0.35 s; an idle run about 3 ms. A run that does have new
  events still loads the whole award ledger to evaluate achievements and
  quests; at very large ledgers that cost grows linearly.
- **Content is parsed, then dropped.** The foundation's `EventLog.query`
  parses each named-type row's full payload before the projection keeps the
  allow-listed fields (decision 2). Rows of shared types such as
  `action_executed` from vault/finance/journal are therefore deserialised in
  memory for an instant, never kept. A content-free read would need a
  foundation change.
- **Two audit lines per user action** (the action's journal line and the
  module's own), as `standup.generate` does today.
- **No retention** on the `rpg` event stream or the award ledger.
- **Seq reuse** is handled by rescanning named types from the start when the
  newest named seq drops below the last one seen; on a very large log that
  rescan reads every named row once (the ledger prevents double awards).
- **Rules match exact type strings.** What a user can usefully write depends
  on the event types DexNest emits; the starter set names four that exist
  today.
- **Pre-existing, not this module's:** dev-intelligence (2) and
  autopilot-runtime (17) fail on Linux; autopilot-runtime's `loop.test.ts`
  hung twice waiting on its fake worker when the container was paused
  mid-run (both times it passed on a clean re-run).

## Needs Windows check

Paths and files
- `reality-rpg-settings.json` written under the real settings root, not
  AppData.
- (No data boundary: the module reads no files and no module's tables, only
  `event_log`. Nothing path-based to check beyond the settings file.)

Electron
- The IPC trusted-frame check against a real `BrowserWindow`; the preload
  bridge under context isolation.
- The `reality_rpg.*` actions from the Command palette and from the view;
  `reality_rpg.open` landing on the view.
- Idle behaviour: no timer when off; one light timer when on, and an idle
  run cheap.

Data as Windows writes it
- Real audit rows: `payload.module`, `actionId` and `status` as the app
  writes them, so rules match what users expect.
- Local day and ISO week in the Windows time zone (ICU maps Windows zones),
  including a DST change.

The view and fonts
- Inter and JetBrains Mono actually loaded (tokens name them; the fonts are
  the app's).
- The native `<progress>` bar taking `accent-color`, date inputs for
  fixed-window quests, tab-list arrow keys, visible focus rings, Narrator
  reading the tabs and buttons.

## Changes from the plan, and why

- **Rules start by recorded time, not seq** (Phase 3). The plan had
  `effectiveFromSeq`. After "clear audit history", new rows can reuse lower
  seq values; a seq threshold would have made every existing rule ignore new
  activity forever. `RawEvent`/`ObservedEvent` gained `recordedAt` and the
  column became `effective_from` (edited in place; nothing had shipped).
- **The game's own activity is never counted** (Phase 4). Its audit lines
  (module `reality_rpg`, action ids `reality_rpg.*`) would otherwise let a
  broad rule award XP for using the game. They are dropped at projection and
  refused in rules, alongside the `rpg` stream and `rpg.*` types.
- **Idle skip on a definitions fingerprint** (Phase 7), found by measurement:
  idle runs no longer load the ledger.
- **Unreadable event times no longer fail a run** (Phase 7), found by test: a
  single bad row would have stuck the cursor for good.
- **Achievements are not events per award**: only milestones go to the event
  log (as planned), and `rpg.run.completed` only for runs that awarded
  something.
- **Action → module mapping lives in the host file** (`runRealityRpgAction`)
  rather than inline in `main.ts`, so it is tested; `main.ts` only routes.
- **The sidebar accent class** `.accent-loop` is defined in
  `RealityRpg.css` rather than the shared `styles.css`, so no other module's
  file was edited.
- **Backfill requires the rule to be on**, and editing a rule that is on keeps
  its start time (the input cannot move it).
- **A completed quest cannot be abandoned**; deleting a rule or achievement
  keeps the XP and unlocks it produced (your decisions 3 and 9).
