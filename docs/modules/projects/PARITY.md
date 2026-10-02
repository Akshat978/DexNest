# Projects: Dev dashboard parity (F1-F49)

Phase 10's proof that every feature of the old Dev dashboard (inventory in
`PLAN.md` section 4) still works now that Projects replaces it. Each row
names the evidence:

- **test**: a test file and test name, on Linux, in this repository.
- **unchanged**: the code path in `main.ts` is not modified by this branch.
  It reads projects through `listProjects()`, which now comes from
  Projects' `legacyProjects()`. The test "F1-F5: a projects.json project
  edited in the new view keeps every old field…" proves that function
  returns the old shape field for field, so an unchanged consumer sees
  exactly what it saw before.
- **needs Windows check**: the behaviour depends on Windows (PowerShell,
  `taskkill`, `netstat`, Code.exe, Windows Terminal) and cannot be shown on
  Linux. The owner must check it; see `HANDOFF.md` (Phase 11).

Abbreviations: `P/` = `packages/projects/test/`, `G/` = `packages/git-ops/test/`,
`D/` = `apps/desktop/test/`, `R/` = `packages/action-registry/test/`.

## Project data and editing

| # | Feature | Status | Evidence |
|---|---|---|---|
| F1 | Every `DexNestProject` field | kept | test `P/hardening.test.ts` "F1-F5: …"; `P/legacyMigration.test.ts` "imports every project with every field…"; `P/project.test.ts` "projects.json round-trips: every original field comes back…" |
| F2 | Ids from the name, `-2`/`-3`, stable; command-list ids kept | kept | `P/project.test.ts` "ids come from the name, with -2, -3 on collision, and never change on edit", "command list ids are kept when valid…"; `P/hardening.test.ts` "F1-F5" |
| F3 | Name and path required; ports 1-65535; omitted fields keep their value | kept | `P/project.test.ts` "name and path are required", "omitted fields keep the stored value…"; `P/runtime.test.ts` "the old Dev dashboard API…" |
| F4 | Delete the entry only, never files, with a confirmation | **changed, safer** | Delete now archives (restorable, same id). "Remove from DexNest…" asks first and removes only archived entries. Never touches files. Tests: `P/runtime.test.ts` "…delete archives…"; `P/store.test.ts` "archive instead of delete; removal only from the archive"; `D/projectDetail.test.mjs` "settings: … restore/remove for an archived one"; `P/hardening.test.ts` "F1-F5" (archived leaves the old list, restore brings the same id back) |
| F5 | `lastOpenedAt` touched by open and push | kept | `P/hardening.test.ts` "F1-F5"; `P/store.test.ts` "touch and activity". Opening a project in the new view calls `projects-touch` (Phase 8) |
| F6 | A corrupt `projects.json` doesn't stop the app | **changed** | The file is left in place and is no longer renamed `.corrupt-<ts>`. Nothing is imported or marked, so a fixed file imports next time. Test: `P/legacyMigration.test.ts` "a corrupt file imports nothing and marks nothing…". If the Projects host fails, `main.ts` falls back to the old `readJsonFile` path, which is unchanged |
| F7 | `dev.project.created/updated/deleted` events | kept, plus new events | The old `saveProject`/`deleteProject` bridge still logs them; that code in `main.ts` is unchanged except that the store is now Projects. The new view logs `projects.project.*` to the same `event_log`. Nothing in the repository reads the old event names. Tests: `P/contracts.test.ts` "event types all live in the projects namespace" |

## Per-project actions (`dev.project.<id>.<op>`)

| # | Op | Status | Evidence |
|---|---|---|---|
| F8 | `open_folder` | unchanged | `main.ts`. PinButton in the detail header targets it (`D/projectDetail.test.mjs` header test) |
| F9 | `open_vscode` | **changed, fixes a gap** | Goes through Projects' launcher, which finds Code.exe, opens the workspace file and reports when VS Code is missing (it used to log success regardless). Tests: `P/launch.test.ts` "VS Code on Windows: …", "VS Code opens the workspace file…". **Needs Windows check** |
| F10 | `open_terminal` | **changed** | Windows Terminal when installed, else PowerShell `-NoExit Set-Location -LiteralPath` with the path safely quoted. Test: `P/launch.test.ts` "terminal: Windows Terminal when installed, else PowerShell…". **Needs Windows check** |
| F11 | `open_url` (first local URL only) | unchanged | `main.ts` |
| F12 | `open_link` (http(s) only) | unchanged | `main.ts`; the Links tab uses it (`D/projectDetail.test.mjs` "links: …") |
| F13 | `open_urls` | unchanged | `main.ts`; Run tab "Open URLs" (`D/projectsModel.test.ts` "Run tab parity…") |
| F14 | `git_push` | **changed, safer** | Now runs through `@dexnest/git-ops`: re-planned on fresh state, journalled, never forced, never prompts; refused when a decision is needed. `project_push_*` events are still written by `main.ts`. Tests: `G/runtime.test.ts` "the old git_push path and the view use the same journal and events", "deck and hotkey runs never ask…", "Stream Deck 'push current project'…" |
| F15 | `check_health` | unchanged | `main.ts`; Run tab button (`D/projectsModel.test.ts` "Run tab parity…") |
| F16 | `show_processes` | unchanged | as F15. **Needs Windows check** (netstat, tasklist) |
| F17 | `kill_ports` (danger, confirm) | unchanged | as F15; the confirm dialog is in the new view (`D/projectDetail.test.mjs` "run: …"). **Needs Windows check** (taskkill) |
| F18 | `docker_down` (danger, confirm) | unchanged | as F17 |
| F19 | `stop` (danger, confirm) | unchanged | as F17 |
| F20 | `restart` (danger, confirm) | unchanged | as F17 |
| F21 | `open_logs` | unchanged | as F15 |
| F22 | `run_start/build/test/typecheck/custom` | unchanged | `main.ts` runs them. The Run tab shows only the slots that are set, and asks first for dangerous commands (`D/projectsModel.test.ts` "Run tab parity…", Phase 8 mutation 4) |
| F23 | `run_cmd_<entryId>` | unchanged | as F22; ids are preserved (F2) |
| F24 | Command results persisted, listed, cleared | unchanged | `main.ts` store. The view reads them through `commandResults` and clears them through `clearCommandResult` (`renderer/main.tsx`); output and recent runs are tested in `D/projectDetail.test.mjs` "run: …" |

## Global actions and integrations

| # | Feature | Status | Evidence |
|---|---|---|---|
| F25 | `dev.open_dashboard` opens view `dev`; pins, routine, voice "dev" | unchanged | View id stays `dev` (decision 1); only the sidebar label changed. `D/navigation.test.mjs` "every sidebar module has an icon and a route" |
| F26 | `dev.git_status_all` | unchanged | `main.ts` + `gitStatus.ts` (`D/gitStatus.test.ts`) over `listProjects()` |
| F27 | Stream Deck "dev" group and button pack | unchanged | `R/streamDeckCatalog.test.ts` (every project gets a push button, labelled commands become cards addressed by id, …) |
| F28 | Deck HTTP `GET /actions`, `POST /actions/run` | unchanged | `main.ts`. Projects' own deck actions are limited by trigger (`P/runtime.test.ts` "triggers are enforced by the runtime…") |
| F29 | Timetable effect `dev.project.<id>.stop` | unchanged | `D/effectChoices.test.ts` "a project with nothing to stop is not offered", "stopping a project is pre-confirmed…" |
| F30 | Search index, Heatmap, Worklog, stats, pin type `project` | unchanged | `main.ts` over `listProjects()`; `D/worklog.test.ts` |
| F31 | Voice "run build", "start/stop <name>" | unchanged | `renderer/main.tsx` voice code (not touched) over `listProjects` |
| F32 | Demo seeding and data-clear of `dev.projects` | kept | Goes to `syncLegacy`; demo projects never touch archived ones (`P/runtime.test.ts` "the old Dev dashboard API: … demo sync") |
| F33 | Old bridge methods | kept | All eight are still in `preload.ts` (checked in Phase 10) |
| F34 | `dev.scan_repositories` (Developer Intelligence) | unchanged | Not touched. Projects only reads DI (`P/contracts.test.ts` "the domain is pure…") |

## Dev view UI, now the Projects view

The old `DevView` component was deleted in Phase 10, after this table.

| # | Feature | Where now | Evidence |
|---|---|---|---|
| F35 | Header with count and Add project | Home header | `D/projectsView.test.mjs` "home: …", Phase 9 header test |
| F36 | Empty state | Home | "no projects yet: a big 'Add your first project'…" |
| F37 | List: type badge, path, description, link/url count, git summary, last commit | Cards and list (type, path, branch line, last commit); detail header (type); Overview (description); Links tab (links and URLs) | "F37: a card shows the project type…", "F37: the project type the old Dev list showed is in the detail header", "header and card lines", "overview: …", "links: …" |
| F38 | Per-folder rows: Folder / VS Code / Terminal | Links tab | "links: … every folder in Folder / VS Code / Terminal" |
| F39 | Link buttons | Links tab | same |
| F40 | Push panel "Push N commits" | Header Push (badge "N to push"); the dialog says "Push N commits…" | "the detail: …"; "operation dialog: the preview in plain words…" |
| F41 | PinButton | Detail header | "the detail: …" |
| F42 | Edit modal with every field, extra commands with "Ask before running" | Settings tab, and the wizard's review step (same form) | "settings: the same form, pre-filled…"; "the project form round-trips…"; "wizard step 3: …" |
| F43 | Commands card, disabled while running, confirm when dangerous | Run tab | "run: every Dev dashboard command…"; "Run tab parity…" |
| F44 | Lifecycle card: Stop/Restart/Kill ports/Docker down confirmed; the rest not | Run tab | same |
| F45 | Output: status, duration, stdout/stderr, ANSI stripped | Run tab Output | "run: … the latest output with ANSI stripped" |
| F46 | Notes | Overview, About | "overview: …" (renders `notes`) |
| F47 | Local URLs, "Open app" | Links tab | "links: open the app…" |
| F48 | Recent commands (last 6) | Run tab, Recent runs | "run: … recent runs" |
| F49 | Git refresh on mount and after actions | Detail: on open, after every operation (version bump), after every Run/lifecycle action, on window focus | "F49: git state is read again after every Run or lifecycle action…"; Phase 8 detail tests |

## Hardening scenarios (Phase 10 list)

| Scenario | Evidence |
|---|---|
| 100+ projects | `P/hardening.test.ts` "120 projects: every one is read, never more than four at a time…"; `P/store.test.ts` "100+ projects list…"; `D/projectsView.test.mjs` "250 projects: …" |
| Huge repositories | `P/hardening.test.ts` "a huge working tree: lists stop at 500 entries…"; `P/reader.test.ts` "many branches: only the most recent get compared…"; the runner caps output at 8 MB |
| No network | `G/hardening.test.ts` "fetch all with one project offline…"; `G/safety.test.ts` "ssh key problems and offline remotes are told apart"; reading never touches the network (`P/reader.test.ts`) |
| Authentication needed | `G/safety.test.ts` "authentication needed: stops, says so in plain words…"; `G/clone.test.ts` |
| Detached HEAD | `P/reader.test.ts` "detached HEAD and an unborn repository"; `P/planners.test.ts` push/pull refusals |
| Conflicts | `P/reader.test.ts` "a merge with conflicts…"; `P/planners.test.ts`; `D/projectDetail.test.mjs` "changes: … conflicts sent to the editor" |
| Rebase in progress | `P/reader.test.ts` "a rebase stopped on a conflict…"; `P/planners.test.ts` "fetch: allowed even mid-rebase…" |
| Submodules | `P/reader.test.ts` "submodules are listed, not recursed into" |
| Worktrees | `P/reader.test.ts` "worktrees: Autopilot's is recognised…"; `G/operations.test.ts` "Autopilot's worktree branch is never touched" |
| Spaces / unicode paths | `P/reader.test.ts` "a repository folder with spaces and unicode in its path"; `G/hardening.test.ts` "a folder with spaces and unicode: commit, push and undo…". Windows paths and junctions: **needs Windows check** |
| Two operations at once | `G/hardening.test.ts` "two operations at once…"; `P/store.test.ts` "only one operation runs per project at a time", "the database itself refuses a second running operation…"; `G/runtime.test.ts` "two DexNest instances on one database…" |
| Crash mid-operation | `G/runtime.test.ts` "crash mid-operation: on the next start the row becomes interrupted…"; `P/store.test.ts` "after a crash, running operations become interrupted…" |
