# L1: dates in your own time zone

First of the leftovers after the fifteen fix phases (item 84).

## What it does now

| Before | Now |
|---|---|
| Skills, Reality RPG, GhostOS and ObjectOS showed the UTC day. Something done at 9:30 in the evening in Saskatchewan showed tomorrow's date | They show the day, and the time, it was where you are |
| GhostOS's "Today" and "Yesterday" headings followed the UTC day | They follow yours |
| A GhostOS entry's edit form opened on the UTC day, so saving it unchanged in the evening moved it a day | It opens on the day shown |
| ObjectOS counted the days left on a warranty from the UTC day: in the evening it was one short, and a warranty ending today read "expired" | It counts from your day |
| Earlier Standups on Today were listed with UTC times | With your times |

## How

- `renderer/lib/dates.ts` is the one formatter those screens already used. It
  now writes a moment in the viewer's time zone (this computer's).
- **A day you picked stays that day.** GhostOS stores a day picked in a form
  as that day at midnight UTC, and ObjectOS as noon UTC. Shifting those by a
  time zone would turn 1 October into 30 September. A plain `2026-10-01`, and
  a timestamp at exactly midnight or noon UTC, are read as a day and shown as
  written, in every zone.
- `momentLabel` is for values that are always moments (a commit, a sync, a
  Standup): the day and time it was here, with no exception for noon or
  midnight.
- ObjectOS: `localDay` in `domain/time.ts`, a `timeZone` option on the module
  (this computer's by default), and the owner's day passed to
  `warrantyState` and to "needs attention".
- Reality RPG and GhostOS already counted streaks, quests and commit days in
  the computer's time zone inside their packages. Only what the screens
  printed was UTC.

## Not covered here

- A commit made at exactly midnight UTC, to the second, is shown in Skills
  on its UTC day rather than the evening before. About one commit in 86,400.
- Stored values are unchanged. Nothing is migrated, and nothing needs to be.
- The time zone is the computer's. There is no setting for another one.
- The two "today" helpers in the Reality RPG and ObjectOS models already used
  local time and were left as they are.
- Seven tests asserted exact UTC wording and would have read differently on
  each machine. Their files now name UTC as the display zone; every assertion
  in them is unchanged. The new behaviour has its own tests.

## Tests

- `apps/desktop/test/dates.test.ts`: the same moment in Regina, Auckland and
  Kolkata; a picked day in six zones, including the two furthest from UTC;
  "today"; a commit at exactly noon keeping its time.
- `packages/object-os`: `localDay`; days left on a warranty from the owner's
  day; a warranty that ends today not expiring late in the evening.
- Root `pnpm test`: 2,371 tests pass. The first run failed one timing test in
  the repository scan (6,007 ms against a 6,000 ms limit, unrelated to this
  change); the second run was clean.
- Checked in the real app on a scratch data root, on this computer's own time
  zone (America/Regina, six hours behind UTC): a GhostOS entry made at 21:30
  on 3 October, which is 4 October in UTC, shows 3 Oct 2026 and its edit form
  opens on 3 October; an entry whose day was picked as 1 October shows
  1 Oct 2026; an ObjectOS job done at the same late hour shows 3 Oct 2026 and
  one logged for 1 October shows 1 Oct 2026.
