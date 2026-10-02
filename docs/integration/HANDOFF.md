# Integration: handoff

`cloud/integration` puts the five module branches together and runs one visual QA and fix pass over the whole app. It was built and checked in a Linux container, with synthetic data only. **Nothing here has been run on Windows.** Section 6 lists everything that needs a Windows check, merged from every module's handoff. Please go through it before merging.

**Where to look:**
- `MERGE_NOTES.md`: every merge conflict and how it was resolved.
- `ISSUES.md`: every problem found, and the status of each (F = functional, C = consistency, P = polish).
- `README.md`: how the screenshots were made.
- `screenshots/before/` and `screenshots/after/`: the evidence.
- `docs/modules/*/HANDOFF.md`: each module's own handoff.

## 1. What is in the branch

The five branches below were merged in this order with `--no-ff`. Every module's actions, views, tables and tests are kept.

| # | Branch | Module |
|---|---|---|
| 1 | `claude/admiring-babbage-kbw2ew` | Skill Constellation |
| 2 | `cloud/reality-rpg` | Reality RPG |
| 3 | `cloud/ghost-os` | GhostOS |
| 4 | `cloud/object-os` | ObjectOS |
| 5 | `cloud/projects` | Projects (replaces the Dev dashboard) |

After the merge, five phases ran, each stopping for review:

| Phase | What | Commits |
|---|---|---|
| 1 | Merge, run the real app, "before" screenshots, issue list | `d84ae0b` and the merge commits |
| 2 | Functional bugs F1–F15 | one commit per module, `53e78c6` … `7824400`, docs `dbf1608` |
| 3 | Consistency C1–C8: one shared component set | `ab82069` … `2c985ef`, `d17a8ed`, docs `5298524` and the phase 3 notes |
| 4 | Polish P1–P10 | `064e3d6` … `f68aee4` |
| 5 | "After" screenshots and this handoff | `67aeeb1` (screenshots), then the commit adding this file |

## 2. What changed, in short

**Bugs (phase 2).** All 13 functional bugs from the issue list are fixed, plus two found during the work. The two High items:
- GhostOS's Forget and "turn a source off" now actually run; before, the main process refused them.
- The OCR device now defaults to CPU, as `AGENTS.md` requires. A saved `"gpu"` is kept.

The rest:
- Calendar no longer has duplicate reminders or a button inside a button.
- The ten older views show an error, with Retry, when their data fails to load.
- The splash screen can no longer hang when a startup read fails.
- Skill Constellation's stars no longer sit on each other.
- Demo Finance data is visible after seeding.
- Command's "Open Dev Dashboard" now reads "Open Projects", with the same action id, so pins and Stream Deck buttons still work.
- Smaller fixes in ObjectOS, Reality RPG, External Devices and GhostOS: wording, units, zero counts.

**One shared component set (phase 3).**
- **Where:** `apps/desktop/src/renderer/components/ui/kit`. It is the token-only kit Projects already used, extended.
- **What it covers:** every view's loading, empty and error states. The four new modules, Audit and News also take their header, buttons, tabs, form fields, badges and confirmation dialog from it.
- **Accent:** a view sets its accent once on its root and the kit components inside it follow.
- **Status chips:** `StatusChip` is drawn as the kit badge in token colours.

**Polish (phase 4).** All ten polish items are fixed:
- ObjectOS: its tabs wrap instead of scrolling sideways, and settings rows read as one line.
- Vault: Secure Vault setup stays inside its card.
- Audit: the table fits at 1280, and ids break between words.
- Utilities: the date fields keep their own size.
- Projects: the header says "latest fetch" and counts never-fetched projects, and "Where you left off" lists readable evidence.
- Skill Constellation: labels no longer write over each other.

**Behaviour.** No module's behaviour changed beyond these fixes. The visible wording changes are listed in `ISSUES.md` under each phase.

## 3. State of the branch

On the final commit:
- `pnpm typecheck`: no errors.
- `pnpm install --frozen-lockfile --offline`: passes. The lockfile matches the merged workspace.
- Every package's own `test` script, run separately: everything passes except the 19 Linux-only failures in section 6, matched by name. The table is in section 7.
- Every fix in phases 2–4 has a test, and each of those tests fails when its fix is undone (each was checked by deliberately breaking the fix).

Real app (Electron 35 under xvfb, a fresh temporary data root for every run, never a real one):
- Empty data root (all 27 views at 1280x800 and 1920x1080): 0 console errors. Phase 1 had 4, all from Calendar.
- Seeded with synthetic data (six git repositories, Developer Intelligence, Skill Constellation, GhostOS, ObjectOS and Reality RPG data, plus the app's demo seed): 0 console errors.
- Click-through flows of every new module and Projects: 57 of 57 steps passed, 0 console errors.
- Stub renderer (loading, error and large-data states of every view): 0 page errors.

## 4. Decisions for you

- **Vault OCR is GPU-only by design.** Its own text says "PaddleOCR GPU only". The phase 2 OCR fix covers the Tools setting only. Whether Vault OCR gets a CPU path is your call.
- **A saved `"gpu"` OCR setting is kept.** Earlier builds wrote `gpu` whenever OCR settings were changed, so an existing install may still have it. Change it in Tools if you want CPU.
- **Autopilot was not converted to the shared components.** It still has its own header, tabs and boxes. That's per your instruction not to touch its views beyond a clearly broken thing, and nothing in the real app was broken. Converting it is the same mechanical job as the four modules. Items for your local review:
  - **Its own look:** the eyebrow header, filled tab buttons and plain boxes (C1, C6).
  - **The preview harness:** the stub bridge lacks `autopilotQueue`, `autopilotPushSettings` and `autopilotMorningBrief`. In the stub preview Autopilot therefore shows its error card (now the shared one). The real app renders it.
  - **Shared row style:** its event rows share the `.event-row` class with Audit. Audit's column fix is scoped to Audit's list, so Autopilot's rows are unchanged.
- **The older views in `main.tsx`** (Clipboard, Finance, Vault, Calendar and so on) already look like the shared set, because the kit was built to match them. They are still written inline, with Tailwind classes and some hex colours. Moving them onto the shared components is a large edit with no visible change; left for a later pass.
- **Skill Constellation's layout fix** applies to a stored layout at the next rebuild of the constellation.

## 5. Running it yourself

- **Tests.** Run each package's `test` script separately. The root `pnpm test` stops at the first failing package, and two packages have known Linux-only failures (section 7).
- **The screenshot harness** (`harness/`, see `README.md`):
  - It always starts DexNest with a fresh temporary `DEXNEST_DATA_ROOT` and profile.
  - On Linux it needs the Electron build of `better-sqlite3` in place while Electron runs. That swap was for the screenshots only: no binary is committed, and nothing changes how the app or the tests load SQLite.
  - On Windows the app's normal Electron rebuild applies.

## 6. Needs Windows check

Tick these on your PC with real tools. Where a step touches data, first point `DEXNEST_DATA_ROOT` at a **copy** of your `local-data`. The first part comes from this integration pass. The rest is every module's own list, kept in full.

### This integration pass

#### OCR and Tools
- [ ] **The OCR worker with `cpu`.** On an install with no saved OCR device, Tools shows Device: cpu. Run an OCR job. Expected: it runs on the CPU and the GPU stays idle (Task Manager, GPU tab).
- [ ] **A saved `gpu` stays `gpu`.** On an install whose settings already say `gpu`, Tools still shows gpu after the update.
- [ ] **Vault OCR** still behaves as before (GPU only; see section 4).

#### Shell and states
- [ ] **Startup with a slow or failing disk read** (for example the data root on a slow drive). The splash screen goes away, and a view whose data failed shows "Could not load this module" with Try again.
- [ ] **The loading state** (label and placeholder blocks) shows for a slow view and does not flash for a fast one.
- [ ] **Command's quick action "Open Projects"**, an existing pin of it, and a Stream Deck button bound to `dev.open_dashboard` all open Projects.

#### Shared components (Windows rendering)
- [ ] **Fonts:** Inter and JetBrains Mono render in the shared header, buttons, fields and dialogs.
- [ ] **Selects:** the drawn arrow sits right in the GhostOS, ObjectOS and Reality RPG forms.
- [ ] **Date fields** show the Windows date format and a usable picker (on Linux they showed `mm/dd/yyyy`).
- [ ] **Confirmation dialog:**
  - it opens with focus on Cancel, and Escape cancels;
  - Narrator reads it as an alert dialog with its question and consequence;
  - a refused GhostOS Forget shows its reason inside the dialog.
- [ ] **View switchers in Calendar, Timetable and Utilities:** arrow keys move the choice, and Narrator reads them as a group of radio buttons with the selected one.
- [ ] **ObjectOS tabs:** they wrap onto a second row at 1280x800 and at 125% and 150% display scaling, and arrow keys still move between them.
- [ ] **Audit:** the table fits at 1280x800 at 125% and 150% scaling with no sideways scroll, and action ids break only after "." or "_".
- [ ] **Vault, Secure Vault setup:** the form and the vault path stay inside the card at 1280x800 and at 125% scaling.

#### Data as Windows writes it
- [ ] **External Devices with Govee configured but failing** (wrong key, no network): a red problem banner. With Govee simply off: the neutral "Off" chip.
- [ ] **Projects, "Where you left off"**, on a real repository scanned by Developer Intelligence: readable lines such as "Commit abc1234 · date" and "Uncommitted changes · date", and no commit messages.
- [ ] **Projects header** with a mix of fetched and never-fetched repositories: "latest fetch … · N never fetched".
- [ ] **Skill Constellation** on your real repositories after a rebuild: no two labels overlap.

### Common to the four new modules

GhostOS, ObjectOS, Reality RPG and Skill Constellation each listed this one. Check it once for all four.

- [ ] The IPC trusted-frame check against a real `BrowserWindow`; the preload bridge under context isolation.

### Projects

From `docs/modules/projects/HANDOFF.md`; every item kept.

Tick these on the owner's PC with real tools, ideally with
`DEXNEST_DATA_ROOT` pointing at a copy of your data first. Each item says
what to do and what should happen.

#### Git and credentials

- [ ] **Installed git is 2.32 or newer** (`git --version`). The read engine
      uses `--path-format=absolute` (2.31) and
      `stash show --include-untracked` (2.32).
- [ ] **Git Credential Manager, credentials stored.** Push a project with
      an https GitHub remote you've pushed to before. Expected: it pushes,
      with no window and no prompt.
- [ ] **Git Credential Manager, nothing stored** (or after signing out).
      Push. Expected: no GCM window. The dialog says "Authentication
      needed - open a terminal here". "Open a terminal here", then run
      `git push` there once to sign in. The next push from DexNest works.
- [ ] **A token in a remote URL** (`https://user:TOKEN@github.com/…`):
      add the project. Expected: the URL shown anywhere in DexNest (card,
      detail, Settings, event log, Recent operations) has no token.
- [ ] **ssh with the Windows OpenSSH agent**: push. Expected: it works.
      With the key not loaded, the dialog says "Authentication needed",
      with no hang.
- [ ] **ssh through PuTTY/plink** (`GIT_SSH` set), if you use it.
      DexNest then doesn't add `BatchMode`. Check that a push with no key
      loaded fails rather than waiting forever. If it waits, Cancel in the
      dialog must stop it.
- [ ] **Fetch all / Pull all** over 3+ real projects. Expected: one
      summary. Projects with local changes, or that are ahead, are skipped
      with a reason.
- [ ] **A folder git doesn't trust** (owned by another user,
      `safe.directory`). Expected: shown as a plain "git doesn't trust this
      folder" state, not an error.
- [ ] **A leftover `.git/index.lock`**. Expected: the operation says the
      repository is locked and the lock file is not deleted.
- [ ] **A failing pre-commit hook** (e.g. husky). Expected: the commit
      fails and shows the hook's output.

#### VS Code launch

- [ ] **User install** (`%LOCALAPPDATA%\Programs\Microsoft VS Code`).
      "VS Code" opens the project folder.
- [ ] **System install** (`%ProgramFiles%`), if that's what you have.
- [ ] **Only `code` on PATH** (portable or Insiders): it must launch
      through the `Code.exe` beside `code.cmd`, not `code.cmd` itself.
- [ ] **A project with a `.code-workspace`** opens the workspace.
- [ ] **VS Code not found** (temporarily rename it): DexNest says so. It
      must not log success (that was the old bug).
- [ ] **"Open in VS Code" from a conflicted file** (Changes tab) opens the
      repository.
- [ ] No console window flashes when launching.

#### Terminal launch

- [ ] **Windows Terminal installed**, setting "auto": "Terminal" opens
      `wt.exe` in the project folder.
- [ ] **Setting "PowerShell"**, or Windows Terminal not installed:
      PowerShell opens with `Set-Location` to the folder.
- [ ] **A path with an apostrophe** (`D:\code\it's here`) and one with
      spaces: the terminal opens in the right folder.
- [ ] Per-folder Terminal buttons on the Links tab open each folder.

#### Windows paths and junctions

- [ ] **Drive letters and case**: add `D:\Code\App`, then try
      `d:\code\app`. Expected: refused as a duplicate.
- [ ] **A junction to a project folder**
      (`mklink /J D:\link D:\code\app`): adding `D:\link` is refused as the
      same folder.
- [ ] **A junction into the data root**
      (`mklink /J D:\sneaky D:\DeskNest\local-data`): adding `D:\sneaky`,
      or a folder under it, is refused. Clone into it is refused too.
- [ ] **`D:\DeskNest\local-data` itself** (and anything under it) is
      refused in the wizard, in paste, in drop, and as a clone parent.
- [ ] **Long paths** (> 260 characters, deep `node_modules`-style): the
      project reads and shows status without errors.
- [ ] **Unicode and spaces** in a project path (`D:\code\my app – ü 日本`):
      read, commit, push and undo work.
- [ ] **CRLF repositories** (`core.autocrlf=true`): a clean checkout shows
      "all pushed" with no phantom changes.
- [ ] **A folder on another drive / a network share**: it reads, or shows
      a plain message.
- [ ] **Drag a folder from Explorer** onto the window: the wizard opens
      with that path. Dropping a file says "That's a file. Choose the
      project's folder."
- [ ] **A drive root** (`D:\`) is refused: "That's a whole drive…".
- [ ] **The folder picker** ("Choose folder…", "Browse…") opens the native
      dialog.
- [ ] **Windows reserved names** as a clone folder name (`con`, `nul`):
      refused.

#### Old Dev features that only run on Windows

- [ ] Run tab **Processes** (netstat + tasklist) lists processes on the
      project's ports.
- [ ] Run tab **Kill ports…** asks first, then frees the port (taskkill).
- [ ] **Stop… / Restart… / Docker down…** ask first and behave as before.
- [ ] **Run** a dev/build command, then **Recent runs** and Output show it.
      A command marked "ask before running" asks.
- [ ] **Stream Deck**: the project buttons still run (`run_*`, `stop`,
      `git_push`). "Push current project" pushes the project you opened
      most recently in Projects, without asking. A destructive action from
      the deck is refused.
- [ ] **Timetable effect** "stop project" still runs at its time.
- [ ] **Voice**: "open dev", "run build", "stop <name>".
- [ ] **Command palette / search** finds projects; **pins** of type project
      open the folder.

#### First run with your real data

- [ ] Start once with `DEXNEST_DATA_ROOT` at a **copy** of `local-data`.
      Check: every project appears with its commands, ports, URLs, folders,
      links and extra commands. `settings/backups/projects.json.<timestamp>` exists,
      and `settings/projects.json` is unchanged (same size and date).
- [ ] Edit a project, restart DexNest: the edit is still there.
- [ ] Archive, then restore a project: same id. Deck buttons for it work
      again.

#### Look, feel and idle

- [ ] Inter and JetBrains Mono render. Switching between Projects and
      Tools/Finance/Clipboard keeps the header in the same place.
- [ ] At 1280x800 and at 125%/150% display scaling, the home list rows and
      the Branches table don't overflow.
- [ ] With Projects open and idle, Task Manager shows no CPU use and no
      `git.exe` processes after the first read. No fetch happens unless you
      click one, or turn scheduled fetch on.

#### Baseline failures

- [ ] The 20 Linux-only test failures (`LINUX_BASELINE.md`) pass on
      Windows: `pnpm --filter @dexnest/foundation test`,
      `… dev-intelligence test`, `… autopilot-runtime test`.

### GhostOS

From `docs/modules/ghost_os/HANDOFF.md`; every item kept.

#### Paths, files and the boundary
- [ ] File references and export/import paths refused inside
      `D:\DeskNest\local-data` and the live data root, **including through a
      junction** (tested on Linux with a symlink), and with Windows path
      spellings (drive letters, UNC, mixed case).
- [ ] Real Electron save/open dialogs; writing the export where the owner
      chooses; reading an import and the 64 MB size check.

#### SQLite
- [ ] **FTS5 on the Electron-rebuilt better-sqlite3.** Verified here on
      node:sqlite 3.51.2 and better-sqlite3 11.10.0 (Node build); if the
      Electron build lacks FTS5, search falls back to LIKE and the Sources tab
      shows "simple".
- [ ] Timings on Windows for a large sync.

#### Electron
- [ ] `ghost_os.*` actions from the Command palette and the view; the
      confirmation for `forget` and `adapter.disable`; `ghost_os.open` landing on
      the view.
- [ ] Idle behaviour: no timer while every source is off; one heavy hourly job
      when on, skipped in Performance Mode.

#### Data as Windows writes it
- [ ] DI repository roots with Windows paths and WSL roots (project names come
      from the display name or the root's last segment).
- [ ] Local day and part of day in the Windows time zone (ICU maps Windows
      zones), including a DST change.

#### The view and fonts
- [ ] Inter and JetBrains Mono actually loaded; date inputs; tab arrow keys;
      visible focus rings; Narrator reading tabs, forms and the forget
      confirmation.
- [ ] The connection picker: typing, arrow keys and Enter in the real window;
      Narrator announcing the combobox, the highlighted option and the live
      region ("Nothing matches …", "3 entries found").
- [ ] Retention on a long-running install: runs capped at 500 and `ghost`
      events at 180 days after an hourly sync, with Performance Mode skipping
      the heavy job (and so the retention with it).

### ObjectOS

From `docs/modules/object_os/HANDOFF.md`; every item kept.

#### Paths, files and the boundary
- [ ] Attach refused inside `D:\DeskNest\local-data` and the live data root,
      **including through a junction** (tested on Linux with symlinks), and with
      Windows path spellings (drive letters, UNC, mixed case).
- [ ] `realpathSync.native` resolving junctions for the source, the object's
      folder and the stored file; `lstat` reporting a junction as a link (so
      deleting an object whose folder became a junction removes the junction,
      not its target); case-insensitive comparisons.
- [ ] Real file dialogs (attach, export, import); `shell.openPath` with the
      default app; `shell.showItemInFolder` for executables; a 200 MB copy.
- [ ] Start-up recovery of pending files and folders on NTFS.

#### Electron
- [ ] `object_os.*` actions from the view and the Command palette; the
      confirmations for delete, remove file and delete record; `object_os.open`
      landing on the view; a Stream Deck request for an ObjectOS action being
      refused.
- [ ] The reminder notification (silent, counts only); no timer while reminders
      are off; one light daily job when on.

#### The view and fonts
- [ ] Inter and JetBrains Mono actually loaded; date inputs; tab arrow keys;
      visible focus rings; Narrator reading tabs, forms, the attention list and
      the delete confirmation.
- [ ] Timings on Windows at the scale above.

### Reality RPG

From `docs/modules/reality_rpg/HANDOFF.md`; every item kept.

#### Paths and files
- [ ] `reality-rpg-settings.json` written under the real settings root, not
      AppData.
- [ ] (No data boundary: the module reads no files and no module's tables, only
      `event_log`. Nothing path-based to check beyond the settings file.)

#### Electron
- [ ] The `reality_rpg.*` actions from the Command palette and from the view;
      `reality_rpg.open` landing on the view.
- [ ] Idle behaviour: no timer when off; one light timer when on, and an idle
      run cheap.

#### Data as Windows writes it
- [ ] Real audit rows: `payload.module`, `actionId` and `status` as the app
      writes them, so rules match what users expect.
- [ ] Local day and ISO week in the Windows time zone (ICU maps Windows zones),
      including a DST change.

#### The view and fonts
- [ ] Inter and JetBrains Mono actually loaded (tokens name them; the fonts are
      the app's).
- [ ] The native `<progress>` bar taking `accent-color`, date inputs for
      fixed-window quests, tab-list arrow keys, visible focus rings, Narrator
      reading the tabs and buttons.

### Skill Constellation

From `docs/modules/skill_constellation/HANDOFF.md`; every item kept.

#### Paths and the boundary
- [ ] A repository whose evidence paths come from Windows (backslashes are
      normalised to `/` in the domain; drive, UNC and `..` paths are refused).
- [ ] The boundary with the real `D:\DeskNest\local-data`, with a scratch
      `DEXNEST_DATA_ROOT`, and with a repository reached through an **NTFS
      junction** into the data root (`realpathSync.native`).
- [ ] `skill-constellation-settings.json` written under the real settings root,
      not AppData.

#### Electron
- [ ] The `skill_constellation.*` actions from the Command palette, and
      `skill_constellation.open` landing on the Skills view.
- [ ] Performance Mode actually holding off the heavy `rebuild` job; turning the
      module on creating exactly one timer and off removing it (tested with the
      real host scheduler on Linux).
- [ ] Idle CPU with the view open (there is no animation or timer in the view).

#### The view
- [ ] Inter and JetBrains Mono actually loaded (the tokens name them; the fonts
      are the app's).
- [ ] SVG star labels legible at the app's default size and window widths.
- [ ] Arrow-key focus moving between stars, the visible focus ring, Escape
      returning focus; Narrator reading the star labels.

#### Developer Intelligence on Windows
- [ ] `authorEmail` populated from real repositories; `myEmails` matching
      case-insensitively against them.
- [ ] The two DI tests that fail only on Linux (`LINUX_BASELINE.md`) pass there.

### Linux-only test failures

These fail in the Linux container and are expected to pass on Windows. They failed the same way before any of this work.

- [ ] **`@dexnest/dev-intelligence`** (2):
  - `EC-006: permission-denied path isolated; others proceed`
  - `refuses a root inside DexNest's data, by path and through a junction`
- [ ] **`@dexnest/autopilot-runtime`** (17): the tests listed in `docs/modules/object_os/LINUX_BASELINE.md`. They sit under the suites TOCTOU protection, approvals, hostile run containment and worktree lifecycle.

Projects' baseline also lists one `@dexnest/foundation` failure. It passes on this branch (47 of 47).

## 7. Test gate

Each package's `test` script, run on its own, on the final commit:

| Package | Passed | Failed |
|---|---|---|
| `@dexnest/action-registry` | 27 | 0 |
| `@dexnest/attention` | 107 | 0 |
| `@dexnest/autopilot-runtime` | 668 | 17 (Linux-only, by name) |
| `@dexnest/dev-intelligence` | 86 (+1 skipped) | 2 (Linux-only, by name) |
| `@dexnest/dev-intelligence-store` | 10 | 0 |
| `@dexnest/foundation` | 47 | 0 |
| `@dexnest/ghost-os` | 175 | 0 |
| `@dexnest/git-ops` | 45 | 0 |
| `@dexnest/object-os` | 142 | 0 |
| `@dexnest/projects` | 139 | 0 |
| `@dexnest/reality-rpg` | 126 | 0 |
| `@dexnest/run-queue` | 164 | 0 |
| `@dexnest/skill-constellation` | 137 | 0 |
| `@dexnest/standup` | 25 | 0 |
| `@dexnest/today` | 13 | 0 |
| `@dexnest/desktop` | 420 | 0 |

`dev-intelligence-contracts`, `local-db`, `shared-types` and `shared-ui` have no tests. The desktop package had 400 tests after phase 1; phases 2–4 added the rest.

The `autopilot-runtime` tests leave git-ignored folders named `\tmp\dexnest-…` in `packages/autopilot-runtime/` on Linux. Delete them after a run.

The only failures are the Linux-only ones above, matched by name.

## 8. Screenshots

All taken in Linux, with fonts rendered by FreeType. Native controls look like Linux Chromium's.

- **`screenshots/before/`**: after the merge, before any fix (phase 1). 274 files.
- **`screenshots/after/`**: the final state, phase 5. Per your rule, only screens that look different from `before/` are committed; a screen missing from `after/` looks the same as before. It has 250 files: 96 real-app screens, 44 flow steps (three of them new) and 110 stub screens. `README.md` says how the set was chosen.
- **Two methods:** `electron/` is the real app; `stub/` is the renderer with a stubbed bridge, used for loading, error and large-data states. `README.md` says which made what.
- **Step numbers:** in `after/electron/flows/`, three GhostOS steps were added (26–28: turning a source on and off). Later step numbers are three higher than in `before/`.
