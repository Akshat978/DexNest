# Phase 5: how Skills calculates

Fifth phase of the fixes found in hands-on testing on 3 October 2026.

What prompted it: Jest showed 43% strength from one line in one
`package.json`; npm ranked above React at 83%; "Freshest" was ESLint; and every
date on the screen was the day of the first scan.

## What it does now

| Before | Now |
|---|---|
| Strength was the average of three bars, so anything scanned today started near 40% | Volume **multiplies** the score: little evidence is a low strength however recent it is |
| Recency came from the day a scan read the file | Recency comes from the last commit or resolved TODO. Nothing dated is 0% |
| A manifest line counted like work | A dependency counts the repositories that name it, and is dated by the commits there. With no commits anywhere it is "named only" and stays faint |
| A package manager or linter could be the top skill | Category weights: language and framework 1, library 0.9, runtime 0.7, tooling 0.6, package manager 0.4 |
| "Freshest" used the scan date | The skill last worked in; ties go to the strongest, so it names a language before the linter beside it |
| A repository's evidence was dated "2 Oct – 3 Oct" (the scan window) | The dates of the commits counted there, with how many |
| "My commit emails" was an empty box | The emails on the commits already scanned are offered to pick from |

The formula, in `packages/skill-constellation/src/domain/strength.ts`:

```
score = category weight × volume × (0.5 + 0.3 × recency + 0.2 × variety)
```

- Volume, language: commits and resolved TODOs, plus one per repository
  (63% at 20). Open TODOs and file-extension rows no longer add to it.
- Volume, anything else: repositories that name it (33% at one, 70% at three).
- Named with no dated work: the score is halved again.

On a test pair of repositories: TypeScript 72%, React 45%, npm 18%, Jest 16%,
ESLint 16%.

## How

- `deriveEvidence` returns the counted commits per repository (after the
  "my emails" filter); `aggregateSkills` uses them to date skills that have no
  rows of their own. A repository that removed a dependency no longer dates it.
- `Skill` gains `activityCount` and `firstActivityAt`; the snapshot gains
  `basis` per skill (`work`, `project`, `declared`) and `repositoryActivity`.
- Migration 2 (`dated_work`): two columns on `skill_skills` and the table
  `skill_repository_activity`. A repository whose evidence was all refused by
  the data boundary is not named there either.
- A scoring version is part of the build fingerprint, so a constellation built
  before this change shows as out of date and one Rebuild brings it up to date.
  The notice says which it is: new scan results, or a changed setting or scoring.
- `commitAuthors()` reads the author emails from the commit events already in
  the event log. Nothing is stored, git is not run, and the emails stay out of
  the audit log as before.

## The whole history, once

Found while checking this phase: a scan looks at a repository's latest 20
commits, so a long-lived project began at 20 counted commits and a range that
started at the oldest of those.

- The scanner now reads the history behind HEAD once per repository
  (`readCommitHistory`, 500 commits per git call, at most 5,000) and records
  each commit as baseline: history, never news. Standup and Reality RPG already
  skip baseline commits, so nothing is reported or awarded for them.
- It records sha, subject, author email and date, as for any commit. No
  message body.
- `dev_repositories.history_read_at` (scanner migration 4) marks it done. A
  repository baselined before this gets its history on its next scan; a commit
  already recorded as new stays new.
- A cancelled or failed read is not marked, and is retried on the next scan.
  A history over 5,000 commits is read to the newest 5,000.

## Not covered here

- The scan cannot see which files a commit touched, so a commit counts for
  every language the repository holds, and a dependency cannot be told apart
  from one that is listed and never imported.
- Layout, labels, the legend and the evidence panel's shape are phase 6.

## Tests

- `packages/skill-constellation`: `domain-skills.test.ts` (the Jest and npm
  cases, dating by repository commits, other people's commits, basis),
  `module.test.ts` (snapshot, stale after a scoring change, commit authors),
  `store.test.ts` (migration, round trip).
- Desktop: `skillConstellationModel.test.ts` and
  `skillConstellationView.test.mjs` (Freshest, captions, ranges).
- Checked in the real app on a scratch data root with two synthetic
  repositories whose commits run back over a year: the ranking above, no skill
  dated by the scan day, Freshest "TypeScript, last worked 11 Sep 2026", the
  email picker listing both authors, and after picking one and rebuilding only
  that author's commits counted. Run again after the history read: all 30
  commits of the larger repository counted, its range starting at its first
  commit over a year back, TypeScript 72%.
- `packages/dev-intelligence/src/__tests__/scanner-truth.test.ts`: the history
  is read once, as baseline; a repository baselined earlier is backfilled
  without turning a new commit into history; paging and the cap.
