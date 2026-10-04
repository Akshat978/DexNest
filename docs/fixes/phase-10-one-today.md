# Phase 10: one "today", and one place for what needs you

Tenth phase of the fixes found in hands-on testing on 3 October 2026.

What prompted it: the Today screen showed only the developer Standup, while
the merged day (calendar, timetable, nudges) existed and was served only to the
phone. Reminders lived in three places that did not know about each other.
Calendar did not show Timetable blocks. The Standup mentioned "123 open TODOs"
with nowhere to see them, and its History section was never shown.

## What it does now

| Before | Now |
|---|---|
| Today showed the Standup only | **Your day** at the top: the calendar events and timetable blocks for today in one list, with times. It is there whether or not the repository scan is on |
| Nudges, ObjectOS reminders and Autopilot's waiting runs each had their own list | **Needs you**: one list, most pressing first, each row opening the module that deals with it |
| The bell opened the audit log and counted nothing | The bell counts what needs you and opens Today. The audit log is one click away from there ("Activity log") |
| "123 open TODOs" with no list | **Open TODOs** on Today, by project, each with its file and line |
| The Standup's History section was not shown | **History**: what was put right since the last Standup, and the Standups before this one |
| Calendar showed only events | The selected day also lists its Timetable blocks, read-only, with a link to Timetable |
| Recurring bills reached the calendar only as nudges | A button on each recurring bill puts it in the Calendar on its due date, repeating as the bill does |

## How

- `dexnest:get-today-agenda` was already built for the phone
  (`packages/today`, `buildAgenda`); it is now in the preload as
  `getTodayAgenda`, so the desktop reads the same list.
- `todayDayModel.ts`: `dayRows`, `needsYou`, `todoGroups`, `earlierStandups`,
  `resolvedSince`, `bellBadge`. `needsYou` merges three reads the screens
  already had (the agenda's nudges, `objectOsAttention`, `autopilotAttention`);
  nothing new is stored and no module reads another's data.
- `TodayDay.tsx`: the cards. A source that is missing or fails is simply empty.
- `dexnest:dev-intelligence-todos`: the open TODO markers per repository
  (file, line, text), capped at 1,000.
- The bell's count is read when the view changes, not on a timer.
- Calendar gets the active timetable's blocks as a prop and shows those on the
  selected date's weekday.
- A recurring bill is sent with `calendar.create_event` (source `finance`,
  recurrence weekly, monthly or yearly), once, on a click.

## Not covered here

- Command home still assembles its own "today" strip. It shows the same
  sources, but through its older code path; moving it onto the shared agenda
  touches the Command screen's layout and is left for the Settings and
  housekeeping phase.
- Nudges, ObjectOS and Autopilot still each store their own reminders; this
  phase puts them in one list, it does not merge the stores.
- Pressing the bill's button twice adds it twice: Calendar does not know the
  bill is already there.
- The phone's agenda is unchanged: it does not include ObjectOS or Autopilot
  items.

## Tests

- Desktop: `todayModel.test.ts` (the day's rows, needs-you order, TODO groups,
  earlier Standups), `todayView.test.mjs` (the cards, quiet states, and the
  shell wiring for the bell, Calendar and Finance).
- Checked in the real app on a scratch data root: a calendar event and a
  timetable block for today both on Today with their times; overdue ObjectOS
  maintenance and three reminders in one "Needs you" list; the bell showing 4
  and opening Today; the activity log opening from Today; a needs-you row
  opening ObjectOS; Calendar's selected day listing the block; a recurring
  bill arriving in the Calendar as a monthly event on its due date.
