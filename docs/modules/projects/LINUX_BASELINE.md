# Linux test baseline (pre-existing failures)

Projects is built in a Linux container; the owner runs Windows. Recorded on
`cloud/projects` at `6140a2f` (= `main`), **before any Projects code**.
`pnpm typecheck` is green. Each package's `test` script was run separately,
because the root `pnpm test` chain stops at the first failing package.

| Package | Pass | Fail |
|---|---|---|
| @dexnest/foundation | 46 | 1 |
| @dexnest/dev-intelligence-store | 10 | 0 |
| @dexnest/dev-intelligence | 85 (+1 skipped) | 2 |
| @dexnest/standup | 25 | 0 |
| @dexnest/autopilot-runtime | 668 | 17 |
| @dexnest/today | 13 | 0 |
| @dexnest/action-registry | 26 | 0 |
| @dexnest/desktop | 165 | 0 |

The 20 failures, all expected to pass on Windows (needs Windows check):

- **foundation (1)**: `tests refuse the real data root` - asserts that
  `D:/DeskNest/local-data/data` is refused; on Linux `D:/...` is a relative
  path and resolves under the working directory.
- **dev-intelligence (2)**: `refuses a root inside DexNest's data, by path and
  through a junction` (fixture roots use domain `wsl`, which the module
  exempts) and `EC-006: permission-denied path isolated` (the container runs
  as root; `chmod 000` does not deny root).
- **autopilot-runtime (17)**: Windows path handling (backslash-joined paths)
  exercised on Linux - the same 17 listed in
  `docs/modules/object_os/LINUX_BASELINE.md` on `cloud/object-os`.

Gate for every Projects phase: no failure outside this list, the new
packages fully green, typecheck green.
