# Linux test baseline (pre-existing failures)

Reality RPG is built in a Linux container; the owner runs Windows.
These tests failed on this branch **before any Reality RPG code
existed**, and are expected to pass on Windows (needs Windows check). A phase's
gate is: no failure outside this list, the Reality RPG package fully
green, and `pnpm typecheck` green.

`pnpm test` chains packages with `&&`, so the first failing package stops the
run. The gate therefore runs each package's `test` script separately.

## @dexnest/dev-intelligence (2)

- `Developer Intelligence module runtime > refuses a root inside DexNest's data, by path and through a junction`
  - On Linux the fixture's roots use domain `wsl`, which the module deliberately exempts from the boundary check.
- `QA discovery (EC-001/004/005/006/008/043) > EC-006: permission-denied path isolated; others proceed`
  - The container runs as root; `chmod 000` does not deny root.

## @dexnest/autopilot-runtime (17 tests, in 4 failing suites)

Windows path handling (backslash-joined paths, `\tmp\...`) exercised on Linux.

- `CONSULTANT cannot start implementation or spend a primary grant`
- `a cloned form is valid input to create, and produces an equivalent run`
- `a re-run form reproduces the run it was cloned from`
- `a run that never got a grant is still worth cloning`
- `claude Control Center primary executes one fake turn through structured verification`
- `claude UI model creates a bounded run and dormant opposite consultant`
- `cloning a run with no iteration bound does not invent one`
- `codex Control Center primary executes one fake turn through structured verification`
- `codex UI model creates a bounded run and dormant opposite consultant`
- `the worktree is a sibling of the project, with the project name intact`
- `hostile run containment > policy stops every forbidden effect and the platform never sees it`
- `hostile run containment > a real command executes with a filtered environment`
- `approvals > an approval-gated operation waits, survives a restart, then executes exactly once`
- `TOCTOU protection > a settled operation can never be dispatched again`
- `worktree lifecycle > creates a run worktree and leaves the primary checkout untouched`
- `worktree lifecycle > worktree identity is deterministic and rediscoverable after a restart`
- `worktree lifecycle > stop and failure preserve the worktree; removal is explicit only`

Side effect: these tests leave directories named like `\tmp\dexnest-…` inside
`packages/autopilot-runtime/` on Linux (git-ignored). Delete them after a run.

## Carried over

- `@dexnest/foundation > tests refuse the real data root` failed on Linux on
  `main`. Fixed by cherry-picking `e6577c2` from
  `claude/admiring-babbage-kbw2ew` (commit `7e74c7e` on this branch).

Baseline counts on this branch before any Reality RPG code: foundation 47
pass / 2 skipped; dev-intelligence-store 10; dev-intelligence 85 pass / 2 fail
/ 1 skipped; standup 25; autopilot-runtime 668 pass / 17 fail / 4 skipped;
today 13; action-registry 26; desktop 165. Passing total 1039.
