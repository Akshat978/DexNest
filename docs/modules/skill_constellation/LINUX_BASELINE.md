# Linux test baseline (pre-existing failures)

Skill Constellation is built in a Linux container; the owner runs Windows.
These tests failed on this branch **before any Skill Constellation code
existed**, and are expected to pass on Windows (needs Windows check). A phase's
gate is: no failure outside this list, the Skill Constellation package fully
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

## Fixed in Phase 0

- `@dexnest/foundation > tests refuse the real data root` - the test guard now
  also checks the raw path string (commit "fix(foundation): test guard
  recognises a Windows-spelled data root on POSIX").
