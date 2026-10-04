# Phase 7: GhostOS

Seventh phase of the fixes found in hands-on testing on 3 October 2026.

What prompted it: GhostOS listed 7 skills where Skills listed 17, with
different numbers; every entry was dated the day of the scan; evidence read
"Technology fact in repo_b2a5d4c8…"; "← uses DeskNest" on pnpm meant DeskNest
uses pnpm; pnpm was "90% sure" and TypeScript 70%; deleting was called
"Forget…" and could not be found; and the owner had to ask what the screen
and "Observations" were.

## What it does now

| Before | Now |
|---|---|
| GhostOS derived its own skills from the scan | The skills are the ones Skills holds, by the same names. A skill hidden in Skills is not listed. Until Skills has been built there are none |
| Projects and connections dated by the scan | A project starts at its first commit; "uses" connections start with the project; a skill starts at its first dated work |
| "Technology fact in repo_…: package.json (package.json#packageManager)" | "Used in door-crew-website", "Commit abcdef1 in DeskNest, 3 Oct 2026, 09:00". No ids |
| "← uses DeskNest from 2026-10-03" | "Used by DeskNest · since 3 Oct 2025 · ongoing", read from the entry that is open |
| "from a source, 90% sure" | "From your repositories". A fact read from a repository carries no percentage. Less than certain says how much and why ("Commits in a repository are counted whoever wrote them") |
| "Forget…" on the detail only | "Delete…", and a delete button on every timeline row. The question says it stays deleted |
| No way to say something has not ended | "Present / ongoing" on entries and on connections, ticked by default; the end date is asked for only when unticked. Shown as "since … · ongoing" on the timeline and detail |
| Empty state pointed at "Developer Intelligence under Sources" | "Connect your repositories" as one button on the empty state, which turns the source on and reads it |
| Search box, eleven filters and "Nothing on the timeline yet" on an empty screen | None of them until there is something to search |
| "Your life, as evidence" | What it answers, in examples: "when did I start that project?" |
| "Observations" unexplained | One line saying what they are, with examples |
| "Saved to GhostOS." stayed on screen | A success notice clears after five seconds; an error stays |

## How

- `DiReader.listSkills` (optional): the host passes what Skills holds: id,
  name, the repositories that evidence it, and its first dated work. With it,
  the technology facts are not read at all. `null` means Skills has never
  been built. A host that leaves it out gets the old derivation; the desktop
  host always passes it.
- `datedByFirstCommit`: projects and their "uses" relations take the earliest
  commit date, the earlier of what was read now and what was already held, so
  the scanner's one-time history read moves a start back and nothing moves it
  forward.
- Confidence: that a repository holds a technology is a fact, however it was
  seen. `technologyManifest` and `technologyExtension` are both 1 (they were
  0.9 and 0.7). A day's commits stay 0.6, and the screen says why.
- `EntityDetail.repositoryNames`: the project title for each repository the
  evidence points at. `TimelineItem.ongoing`: a start and no end.
- Skill entries now have the key Skills uses (`nodejs`, not `node`), so on
  the first sync after this the old skill entries are withdrawn and the new
  ones added. A skill deleted under its old key can reappear once under the
  new one.
- Deleting an entry that came from the repositories already left a marker so
  a sync would not bring it back; that is unchanged, and now checked in the
  real app.

## Not covered here

- GhostOS still shows no strength for a skill. Skills is where that lives.
- The Sources tab and its settings stay on this page; moving module settings
  into Settings is phase 11.
- Other modules (Journal, Calendar, ObjectOS) feeding GhostOS is phase 13.

## Tests

- `packages/ghost-os`: `engine.test.ts` (skills from Skills, none until
  built, dropped when hidden, projects dated by first commit and only ever
  moved back), `privacy.test.ts` (confidence).
- Desktop: `ghostOsModel.test.ts` (source and sureness wording, evidence in
  names, connection phrases, ongoing), `ghostOsView.test.mjs` (empty state,
  timeline rows, detail, delete dialog, forms), `ghostOsHost.test.ts`.
- Checked in the real app on a scratch data root with three synthetic
  repositories: the empty state and its one button; 17 skills here and 17 in
  Skills, the same names; projects named as in Projects and starting at their
  first commits (one in 2024); nothing from the repositories dated today; a
  skill reading "Used by desk · since 22 May 2025 · ongoing" with no ids,
  arrows or percentages; a deleted project not returning after a sync; a new
  entry saved as ongoing; the "Saved" notice clearing itself.
