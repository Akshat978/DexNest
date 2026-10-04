# Phase 3: branches in Projects

Third phase of the fixes found in hands-on testing on 3 October 2026. This is
the first phase that adds an operation which changes a repository.

## What was wrong, and what it does now

| Seen in testing | Now |
|---|---|
| "32 ahead" of main when the real figure was 6, because local `main` had not been pulled for months | When local `main` is only behind its remote copy, branches are compared with the remote copy. The column heading says which (`vs origin/main`) and a line says why. |
| No way to bring `main` up to date without switching to it | **Update** on a branch you are not on moves it forward to its upstream. |
| No way to make `main` level with `develop` | **Bring up to develop** on the default branch moves it forward to the branch you are on. Asks first. |
| Nowhere to say which branch is live | A **Deployed branch** choice on the Branches tab. That branch gets a badge, a `vs live` column appears, and the card says `live: develop`. |
| Cards showed only the current branch | A line under it: `3 branches · develop 6 ahead of origin/main`. |
| Long project names cut off | They wrap to two lines; the full name is the tooltip. |
| "Terminal opened" with no window in sight | "Started Windows Terminal in <project>. If it didn't come to the front, it's in the taskbar." |

## The new operation: `fast_forward`

One request, two forms, both forward-only:

- `{ kind: "fast_forward", branch }`: to its upstream, as of the last fetch.
  No confirmation; nothing is downloaded.
- `{ kind: "fast_forward", branch, from }`: the default branch up to another
  local branch. Confirmation dialog. Only the default branch moves this way,
  because how far two branches are apart is only known against it.

Refused, in words: the branch you are on (that is Pull), a branch checked out
in another worktree (Autopilot's included), diverged branches, nothing to do,
an unfinished merge or conflicts, and anything DexNest could not compare.

How it stays safe:

- **One command shape**, added to git-ops' allowlist:
  `git fetch --no-tags --no-write-fetch-head . <full source ref>:refs/heads/<branch>`.
  A fetch from the repository into itself. Without a `+`, git refuses anything
  that is not a fast-forward and refuses the checked-out branch, on its own.
- The refspec is checked token by token: full ref names on both sides, a
  local-branch destination, no `+`, no option-like names, not the same branch.
- Both tips are re-read right before running. If either moved since the
  preview, nothing runs.
- `--no-write-fetch-head` keeps "last fetched" meaning the last real fetch.
- No force, merge, rebase, reset or `update-ref` was added; those stay on the
  never list. No undo is recorded: undoing a fast-forward would need one of
  them.
- Pushing `main` afterwards is the existing push, naming the branch.

## The deployed branch

`Project.deployedBranch` (new column, Projects migration 2). The reader
compares each local branch with what was pushed of it (`origin/<branch>`, or
the local branch when there is no remote copy). DexNest knows the branch name
only: it cannot see a server, and the screen says so.

## Not covered here

- Bringing a non-default branch up to another branch.
- Updating the branch you are on other than by Pull.
- Whether the terminal window actually appeared: Windows gives DexNest no way
  to check.

## Tests

- `packages/projects/test/fastForward.test.ts`: every allow and refuse of the
  planner, and request parsing including refused force flags.
- `packages/git-ops/test/fastForward.test.ts`: real repositories. Forward only;
  HEAD, working tree, FETCH_HEAD and the remote untouched; confirmation
  required; diverged, current and other-worktree branches refused; stale
  preview stops it; git itself rejects a non-fast-forward given the same
  command; the argv shape and fourteen near-misses.
- `packages/projects/test/branchBase.test.ts`, `deployedBranch.test.ts`.
- Desktop: `projectBranches.test.ts`, and new cases in `projectDetail` and
  `projectsView`.
- Checked in the real app on a scratch data root with a repository shaped like
  the one that prompted this: the card and Branches tab showed "2 ahead of
  origin/main"; Update moved `main` three commits while staying on `develop`
  with uncommitted work untouched; Bring up moved nothing until confirmed, then
  moved `main` to `develop` without touching the remote; marking `develop` as
  deployed was saved and shown.
