# Phase 2: one project list, one name, one date style

Second phase of the fixes found in hands-on testing on 3 October 2026.

## What was wrong, and what it does now

| Seen in testing | Now |
|---|---|
| Today asked which folders to watch, although Projects already had them | **Projects is the one list.** The repository scan follows every project that is a Git repository. Turning Today on needs nothing chosen. |
| A folder shown as "every repository inside" that was really one project | No checklist. The setup lists your projects by name. |
| "DeskNest" on Today, "dexnest" in Projects | A repository that is a project is called what Projects calls it: in the scan, the Standup, Today, and Autopilot's queue. |
| No way to change what is watched after setup | Add, archive or remove a project in Projects. A folder set by hand in an older setup shows under "Watching" with **Stop watching**. |
| A project removed or archived kept appearing | The Standup and the repository list cover what the last finished scan looked for. |
| "Developer Intelligence", a name seen nowhere else | **Repository scan**, everywhere a person reads it. |
| 2026-10-03 on some screens, "3 Oct" on others | One wording, **3 Oct 2026** (and "3 Oct 2026, 15:50"), in Skills, Reality RPG, GhostOS and ObjectOS. |
| The demo data made a project inside DexNest's own data folder | It no longer makes a project. One seeded earlier can still be cleared. |

## How

- `createDevIntelligenceModule` takes `linkedRepositories()`; the host passes
  Projects' list (`apps/desktop/src/main/projectLinks.ts`). Linked repositories
  go first in discovery and carry `displayName`, so a watched folder that also
  reaches one does not rename it back.
- A linked project inside DexNest's data is left out, not reported as refused.
- `currentRepositoryIds` (Standup): the repositories the last finished scan
  targeted. Used by `collectFacts` and by the scan's own repository list and
  count. The store keeps the history of ones no longer followed.
- `apps/desktop/src/renderer/lib/dates.ts`: `dayLabel`, `dayTimeLabel`,
  `dayKey`. The four module models' `shortDate` delegate to it.
- Autopilot: only the label of a queueable project changed. Which projects can
  be queued is still decided by past runs.

## Decided here

- The scan is called "Repository scan" (the user left the choice to me).
- The scanner's repository id is not stored on the project. It is derived from
  the folder, so the two are matched by folder wherever needed; a stored id
  would be a second thing to keep in step.

## Not covered here

- Dates in Skills, Reality RPG, GhostOS and ObjectOS are still the UTC day, as
  before; only the wording changed. Late-evening items can show the next day.
  Today uses the report's timezone.
- GhostOS still builds its own "project" and "skill" entries (phase 7).
- Projects' import folders are no longer offered to the scan. Repositories in
  them that are not projects are not followed until added.

## Upgrading existing data

Folders already in the scan's settings keep working. Those that are projects
are simply covered by Projects now and are not shown as extras. Names change to
Projects' names at the next scan.

## Tests

- `apps/desktop/test/oneProjectList.test.ts`, `dates.test.ts`.
- `module-runtime.test.ts`: linked projects scanned without configuration,
  renamed, and dropped when removed; a project keeps its name when a watched
  folder also reaches it.
- Standup `scanner-truth.test.ts`: only what the last scan looked for.
- Today model and view tests rewritten for the new setup and "Watching".
- Checked in the real app on a scratch data root: three imported projects, one
  renamed "Storefront"; Today listed them by name and turned on without writing
  any folder to the scan's settings; archiving one removed it from Today after
  a scan; a hand-set folder appeared as an extra and "Stop watching" removed it.
