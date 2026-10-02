# Projects: handoff

Projects is DexNest's project manager. It replaces the Dev dashboard: same
sidebar slot, same view id (`dev`), now labelled "Projects". It was built on
branch `cloud/projects` in phases 0-11, in a Linux container, with synthetic
data only. **Nothing here has been run on Windows.** Everything that depends
on Windows is in the checklist in section 6. Please go through it before
merging.

Design and per-phase decisions: `PLAN.md`. Parity with the old Dev
dashboard (F1-F49) and the hardening scenarios: `PARITY.md`. Linux test
baseline: `LINUX_BASELINE.md`.

## 1. What you get

- **Home**: every project as a card or a list row. Each shows a status
  badge (to push, to pull, uncommitted, all pushed, local only…), its branch
  and last commit, and quick buttons (VS Code, Terminal, Fetch, Pull, Push).
  There are filters, search (`/`), sections (needs attention, favourites,
  all, archived), and Fetch all / Pull all.
- **Add a project**: choose a folder, paste a path, or drop a folder
  anywhere on the window. DexNest inspects it and pre-fills the name,
  commands, ports, framework and GitHub remote. You can also pick from
  Developer Intelligence's suggestions, or clone from GitHub.
- **Project detail**: Overview (status, worktrees, where you left off,
  recent operations with Undo), Branches (compared with upstream and the
  default branch), Changes (commit all or selected files, stash, discard),
  History, Run (the old Dev commands and start/stop buttons), Links,
  Settings. Keys: `F`/`P`/`U` for fetch/pull/push, `1`-`7` for tabs, `Esc`
  for back.
- **Every git change goes through a dialog**: a preview in plain words,
  then git's live output, then the result, and Undo where possible. Nothing
  runs without the preview.
- **Actions**: 29 `projects.*` actions in the shared registry. The deck and
  hotkeys may only fetch, fetch all, and push the current project (the most
  recently opened one). Everything else is UI-only.

## 2. Safety, and where it is enforced

| Rule | Enforced by |
|---|---|
| Never force push, `reset --hard`, `clean -fdx`, rebase, amend, or anything that rewrites pushed history | Requests are parsed strictly (`parseOperationRequest`). The planners can't produce such steps. git-ops re-checks every finished argv against an allowlist of exact shapes and a list of forbidden tokens. Tests: `never.test.ts`, `git-ops/test/safety.test.ts` |
| Never touch a branch checked out in another worktree (Autopilot's) | Planners refuse to switch, push, delete or delete-remote such a branch; the UI shows the reason |
| Tokens stripped from remote URLs | `stripUrlCredentials` at inspection and at the store boundary; `redactCredentials` on git output. A test reads the SQLite file's bytes |
| No file contents or commit messages in the event log or journal | Commit messages go to git on stdin; tests scan argv, the database and the event log |
| Never reads `local-data` | The data boundary is checked on the written path and on the resolved path (links and junctions). A project inside the data root is never read or operated on |
| No network except fetch/pull/push/clone you clicked | The read engine allows only reading git verbs and runs `--no-optional-locks`, with no prompts. Scheduled fetch is off by default |
| Never prompts or hangs on credentials | `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, empty askpass, ssh `BatchMode=yes` unless you configured ssh yourself. Failures say "Authentication needed - open a terminal here" |
| One operation per project at a time | An in-memory lock, plus a partial unique index in SQLite (also covers two DexNest instances) |
| Undo | Only the latest finished operation, only if it succeeded. Undo of a commit only while it is unpushed |
| Discard is recoverable | A discard is a backup stash. Undo applies it |
| Idle stays idle | Git is read on open, on focus (2 s debounce) and after actions. No polling. Scheduled fetch is opt-in, a heavy job, and never runs at startup |

## 3. Your data on first run

- On the first start, `settings/projects.json` is **imported once** into
  the `proj_` tables of `data/dexnest.sqlite`. Before importing, a verified
  copy is written to `settings/backups/`. The original file is left exactly
  as it was.
- From then on, Projects does **not write `projects.json`**. Edits live in
  SQLite only. If you later change `projects.json` by hand, the home screen
  says so and offers "Import projects.json" (it adds new ids only).
- Delete now **archives**. Use the Archived filter, then Restore or
  "Remove from DexNest…". Nothing ever deletes project files.
- New settings file: `settings/projects-settings.json` (stale after 30
  days, scheduled fetch off / 30 min, fetch concurrency 4, terminal "auto",
  layout).
- **Rolling back to `main`** brings back the old Dev dashboard reading
  `projects.json`, which still holds the state from before the import.
  Edits made in Projects since then are not in it.
- **Trying the branch from a separate working copy?** Set
  `DEXNEST_DATA_ROOT` to a scratch folder, or it will open your real
  `D:\DeskNest\local-data` (see `AGENTS.md`).

## 4. Where the code is

| Path | What |
|---|---|
| `packages/projects/src/domain` | Pure: types, planners, safety classes, badge, URL stripping, legacy mapping, action contract (renderer imports values from `@dexnest/projects/domain` only) |
| `packages/projects/src/store` | `proj_` migrations, store, journal, `projects.json` migration |
| `packages/projects/src/git` | Read-only git engine with its allowlist |
| `packages/projects/src/inspect`, `src/node` | Folder inspector; Node runner, filesystem and launchers |
| `packages/projects/src/module` | Runtime (`createProjectsModule`) and manifest |
| `packages/git-ops` | The only place a changing git command runs |
| `apps/desktop/src/main/projectsHost.ts` | Wiring and 32 trusted-frame IPC channels |
| `apps/desktop/src/renderer/views/projects/` | Home, wizard, detail, dialog, model |
| `apps/desktop/src/renderer/components/kit/` | Token-only UI kit (moves to `shared-ui` once that package carries React) |

## 5. State at handoff

Test results (Linux, each package run separately):

| Package | Before Projects | Now |
|---|---|---|
| @dexnest/projects | - | 139 pass, 0 fail |
| @dexnest/git-ops | - | 45 pass, 0 fail |
| @dexnest/desktop | 165 / 0 | 220 / 0 |
| @dexnest/foundation | 46 / 1 | 46 / 1 |
| @dexnest/dev-intelligence | 85 / 2 | 85 / 2 |
| @dexnest/autopilot-runtime | 668 / 17 | 668 / 17 |
| dev-intelligence-store, standup, today, action-registry | 10, 25, 13, 26 / 0 | unchanged |

The 20 failures are the Linux baseline; none come from Projects.
`pnpm typecheck` is green.

Deviations from the brief (all recorded in `PLAN.md`):

- The UI kit lives in the renderer, not in `shared-ui`, because that
  package has no React.
- Delete archives instead of removing.
- A corrupt `projects.json` is left in place rather than renamed.
- VS Code, terminal and push go through Projects (safer; F9/F10/F14 in
  `PARITY.md`).
- Screenshots from Phase 9 are not committed (17 MB).
- `DevView` has been deleted.

Open questions for you:

1. Add "open projects" as a voice phrase? ("open dev" keeps working
   either way.)
2. Other modules' dialogs leave the sidebar undimmed. Projects' dialogs
   cover the whole window. Align the rest?

## 6. Needs Windows check

Tick these on the owner's PC with real tools, ideally with
`DEXNEST_DATA_ROOT` pointing at a copy of your data first. Each item says
what to do and what should happen.

### Git and credentials

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

### VS Code launch

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

### Terminal launch

- [ ] **Windows Terminal installed**, setting "auto": "Terminal" opens
      `wt.exe` in the project folder.
- [ ] **Setting "PowerShell"**, or Windows Terminal not installed:
      PowerShell opens with `Set-Location` to the folder.
- [ ] **A path with an apostrophe** (`D:\code\it's here`) and one with
      spaces: the terminal opens in the right folder.
- [ ] Per-folder Terminal buttons on the Links tab open each folder.

### Windows paths and junctions

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

### Old Dev features that only run on Windows

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

### First run with your real data

- [ ] Start once with `DEXNEST_DATA_ROOT` at a **copy** of `local-data`.
      Check: every project appears with its commands, ports, URLs, folders,
      links and extra commands. `settings/backups/projects.json.<timestamp>` exists,
      and `settings/projects.json` is unchanged (same size and date).
- [ ] Edit a project, restart DexNest: the edit is still there.
- [ ] Archive, then restore a project: same id. Deck buttons for it work
      again.

### Look, feel and idle

- [ ] Inter and JetBrains Mono render. Switching between Projects and
      Tools/Finance/Clipboard keeps the header in the same place.
- [ ] At 1280x800 and at 125%/150% display scaling, the home list rows and
      the Branches table don't overflow.
- [ ] With Projects open and idle, Task Manager shows no CPU use and no
      `git.exe` processes after the first read. No fetch happens unless you
      click one, or turn scheduled fetch on.

### Baseline failures

- [ ] The 20 Linux-only test failures (`LINUX_BASELINE.md`) pass on
      Windows: `pnpm --filter @dexnest/foundation test`,
      `… dev-intelligence test`, `… autopilot-runtime test`.
