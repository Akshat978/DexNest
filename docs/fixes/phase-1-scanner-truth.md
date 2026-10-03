# Phase 1: scanner truth

First phase of the fixes found in hands-on testing on 3 October 2026. The
repository scan (Developer Intelligence) and the Standup built on it reported
when a scan *noticed* something as when it *happened*. This phase makes them
report what happened.

## What was wrong, and what it does now

| Seen in testing | Cause | Now |
|---|---|---|
| "20 commits in window" for a repository last touched four months ago | Every commit the first scan saw counted as recent | A repository's first complete scan is a **baseline**. What it already held is history and is never reported as a change. |
| Every repository "Most recently active" | Being scanned counted as activity, and all are scanned together | Activity is a commit, push or pull, at the time Git recorded. Exactly one repository is named most recent; none when nothing was done. |
| A list full of "First seen on main" | The first sighting of a branch was a "branch change" | Only a real switch between two branches is listed. |
| "123 open TODOs" in DexNest | The word TODO anywhere on a line counted | A TODO is the first word of a comment (or a prose line starting `TODO:`). Not strings, test names, identifiers or sentences. |
| Pushes and pulls from the command line invisible | Only commits were observed | Read from the repository's reflog, so they are seen however they were made. |
| Tile said 50 changes, heading said 51 | The "more omitted" line was counted as a change, and the real total was lost | The section keeps its real total; the line becomes a note. |
| "Scan now" rescanned but showed the morning's report | One report per day, whoever asked | A scan or Standup the user asks for writes a fresh report covering the same day. The timer still writes one a day. |

## How

- `Repository.baselinedAt` (new column, migration 3): set once, when a
  repository's first inspection completes. Commits seen before then carry
  `baseline: true`. Standup leaves out anything observed up to the baseline.
- Commit times are stored in UTC. Standup shows and sorts commits by when they
  were made.
- New events `dev.push.observed` and `dev.pull.observed`, from `git log -g` on
  the refs that moved since the previous scan. Read-only; no remote is contacted.
- TODO markers the old detector recorded wrongly become `retracted`: not open,
  and not reported as resolved, since nobody resolved anything.
- Reality RPG drops `baseline` commits, so adding a folder does not pay out XP
  for its history.

## Upgrading existing data

A repository scanned before this has no baseline. On its next scan it is read
in full once, its wrongly recorded TODOs are retracted, and its baseline is
set, so what was recorded so far becomes history. Today's Standup stays as it
was written until "Scan now" is pressed or the next day's is written.

## Not covered here

- Skills and GhostOS still date their evidence by the scan (phases 5 and 7).
- XP already awarded for old commits is not taken back.
- A commit pulled in that was authored before the repository's baseline shows
  under its own date.

## Tests

- `packages/dev-intelligence/src/__tests__/scanner-truth.test.ts`: real and
  look-alike TODOs per language, retraction, baseline, push and pull against
  real temporary repositories.
- `packages/standup/src/__tests__/scanner-truth.test.ts`: history left out,
  real commit times, one "most recently active", capped totals.
- `module-runtime.test.ts`: one scheduled Standup a day; a requested scan
  writes a fresh one over the same day.
- Checked in the real app on a scratch data root: a repository with 25
  five-month-old commits showed no changes on its first scan and one real TODO
  of four look-alikes; a commit, push and new TODO made from the command line
  then appeared as exactly three changes.
