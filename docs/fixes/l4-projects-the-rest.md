# L4: Projects, the rest

Fourth of the leftovers after the fifteen fix phases. It finishes three things
phases 2, 3 and 4 left open in Projects.

## What it does now

| Before | Now |
|---|---|
| Only the default branch could be brought up to the branch you are on | Any branch you are not on can |
| A secrets file git already tracked was guarded against an accidental commit, and nothing said it was tracked | The Changes tab says which tracked files look like secrets, why ignoring them is not enough, and what to run |
| A new repository in a folder you had imported from stayed unknown until you ran Import again (item 85) | A folder can be **watched**: new repositories in it become projects when you open Projects |

## Bring any branch level

- Every branch you are not on has **Bring up to *the branch you are on***.
  The branch only ever moves forward, you stay where you are, and your files
  are not touched.
- How two branches other than the default one stand to each other is not part
  of an ordinary read. It is measured when the dialog opens, and again when
  the operation runs. A branch with commits of its own is refused in words:
  that needs a merge, and DexNest does not merge.
- Still asked first (it is a "caution" operation), still never forced, and a
  branch another working copy has checked out is not offered.
- `ReadOptions.between`, `RepoStateOk.between`, and `pairOf` in the executor.
  The planner no longer refuses a non-default branch outright.

## Tracked secrets

- On a project's own page only, the read also lists the tracked files whose
  names look like secrets (`.env`, key files; not `.env.example`). Names only:
  what is in the files is never read. At most 20 are listed.
- The Changes tab shows them with what is so: adding a tracked file to
  `.gitignore` does not stop git following it; the command that stops
  tracking it and keeps the file; and that what is in the history stays
  there, so real secrets that were pushed should be changed.
- **DexNest runs nothing.** The command is shown for a terminal. Untracking a
  file is a change to the repository DexNest does not make for you.

## Watched folders

- In **Import projects**, each remembered folder has a **Watch** checkbox.
  Off by default.
- A watched folder is looked in when you open Projects, at most once in ten
  minutes, and when asked to check now. **Never on a timer and never in the
  background.** The walk is the same bounded one Import uses.
- New repositories are added as projects and a notice names them. Each add is
  an event in the activity log with its source, `watched_folder`.
- A project you remove from a watched folder is remembered and not added
  back. An archived project is left alone. Adding it again by hand still
  works.
- At most 50 are added by one look; a folder with more is better imported by
  hand.
- Forgetting a folder (it drops off the five remembered) stops the watching.
- `ProjectsSettings.watchedRoots` and `watchSkipped`;
  `ProjectsModule.checkWatchedFolders`; `dexnest:projects-check-watched`.

## Not covered here

- The branch you are on is still updated with Pull, not this way.
- There is no undo for bringing a branch level. Nothing is lost by it (the
  branch only gains commits), and the dialog says so.
- There is no "Check now" button on the Projects screen. Opening Projects is
  the check; the forced check exists for the screen to use later.
- No button untracks a secrets file.
- Tracked secrets are found by file name. A secret inside a file with an
  ordinary name is not noticed.

## Along the way

- Removing a project recorded "do not add this back" before checking that the
  removal was allowed (a project must be archived first). It now records it
  only after the removal succeeds. Found by the tests for this phase.
- The check on opening Projects ran twice in development and dropped its own
  answer, so the "added" notice never showed. It now runs once per opening.
  Found by the real-app check.
- Two tests encoded the old limits ("only the default branch moves this way",
  "…and only it") and were rewritten to the new behaviour, with more cases.
  One test that pins the exact call the project page makes had the new option
  added to what it expects.

## Tests

- `packages/projects/test/fastForward.test.ts`: any branch, only when the two
  have been compared; a comparison of another pair, or the other way round,
  does not count; diverged, nothing to do, the current branch, a branch held
  elsewhere; the default branch unchanged.
- `packages/git-ops/test/fastForward.test.ts`, real repositories: a release
  branch brought up to develop with HEAD, files and other branches untouched;
  a branch with its own commit refused and not moved; tracked secrets listed
  by name, the template and an untracked key left out, and gone from the list
  once untracked.
- `packages/projects/test/import.test.ts`: watching off by default and only
  for a remembered folder; a look adding what is new with its event; not
  repeated within ten minutes unless forced; removed projects not added back,
  and a refused removal remembering nothing; nothing without a walk.
- `apps/desktop/test/projectsLeftovers.test.ts`, `projectBranches.test.ts`.
- Root `pnpm test`: 2,400 tests pass; typecheck clean.
- Checked in the real app on a scratch data root with scratch repositories,
  18 checks: nothing watched until asked; the checkbox watching the folder; a
  new repository added on opening Projects, with the notice; a second look
  doing nothing and a forced one adding the next; a removed project staying
  removed; the adds in the activity log; three "Bring up to develop" buttons;
  release moved to develop with HEAD, the working file and main untouched;
  side refused with the reason and not moved; the Changes warning naming the
  two tracked files and not the template; no file contents on screen; `.env`
  still tracked afterwards.
- The first two runs of that check failed before doing anything, on the first
  call into the app's main process ("promise was garbage collected"). The app
  itself started normally when launched directly, and the call succeeded on a
  retry, so the check now retries that call. The cause was not found.
