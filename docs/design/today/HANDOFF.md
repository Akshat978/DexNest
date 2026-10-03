# Today: handoff

The morning screen from `docs/DESIGN_LANGUAGE.md` (section 8). Developer
Intelligence and Standup had no screen; Today is a reading of the latest
Standup report. It is a view, not a new module: no new package, table, IPC
channel or scheduler job. Screenshots are in `screenshots/`, from the stub
harness with synthetic data.

## What it shows

- **Hero, "Where you left off":** the report's top continuation, with the
  engine's reason and the folder. "Open in VS Code" appears when the folder is
  also a project in Projects, and goes through `projects.open_vscode`;
  otherwise the button opens Projects.
- **Stat tiles:** repositories, changes since the last Standup, issues needing
  attention (and how many are new), repositories with uncommitted work.
- **Needs attention:** each issue with a NEW / ONGOING / RESOLVED badge.
- **Changed since the last Standup:** commits, branch changes and TODO
  changes, each with its repository and time.
- **Also in motion:** the next continuations, with their reasons.
- **Repositories:** branch and working-tree state in words, with a Clean /
  Changes / Conflicts badge.
- Long sections show eight rows and a "Show all" button.

## States

- **Off:** says what turning it on does, and offers Projects' folders as a
  checklist: its import folders (every repository inside) and any project
  outside them (that repository). One button turns Developer Intelligence on
  and runs the first scan. With no projects, it points at Projects.
- **On, no report yet:** offers the scan; shows why the last one failed.
- **Loading, error:** the kit's states.

## How it is wired

- `views/TodayView.tsx`, `views/todayModel.ts` (pure), `views/Today.css`.
- Reads through the existing preload methods (`devIntelligenceStatus`,
  `devIntelligenceRepositories`, `standupLatest`). Scans and new Standups go
  through the registered actions `dev.scan_repositories` and
  `standup.generate`, so they are logged.
- New action `standup.open` ("Open Today"); command and module UI only, not
  phone or Deck, because a Standup names local paths.
- Second in the sidebar, under Command. Accent `--accent-today` (dawn).
- Saving Developer Intelligence settings now writes a line to the event log
  (`devIntelligenceHost.ts`); it did not before.
- Nothing polls. The report changes when a scan runs.

## Changed from the creative direction

- **Stat tiles are not "to push, to pull, open TODOs".** The Standup report
  does not carry ahead/behind counts or TODO totals, and Today adds no new
  reads. The tiles show what the report does hold. Push/pull counts live in
  Projects.
- **Wording, not data:** the engine's placeholder rows ("No activity in
  window") become empty-state lines; `dirty=3, staged=1…` becomes "3
  uncommitted · 1 staged"; "Branch ? → main" becomes "First seen on main".
  A state line the parser does not recognise is shown as written.

## Verified

- Desktop suite, action registry and Developer Intelligence tests pass;
  typecheck clean. New: `test/todayModel.test.ts`, `test/todayView.test.mjs`.
- In the real app on a scratch data root with six synthetic repositories:
  the off state offered the imported folder; a root inside DexNest's data was
  refused and nothing was turned on; "Turn on and scan" produced the report
  (6 repositories, 27 changes); a second scan returned to it; the event log
  held the settings change and both scans.

## Needs Windows check

- With your own repositories: that the top continuation is the one you would
  have picked, and that "Open in VS Code" opens it.
- 125% and 150% scaling; Narrator on the setup checklist.

## Not done

- The History section (resolved issues, previous report) is not shown.
- No way to edit the watched folders after setup from this screen.
