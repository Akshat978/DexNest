# Phase 11: settings, sidebar and housekeeping

Eleventh phase of the fixes found in hands-on testing on 3 October 2026.

## What it does now

| Before | Now |
|---|---|
| The sidebar's order was fixed and long | Point at a module (or tab to it): **move up**, **move down**, **hide**. The order and what is hidden are saved |
| No way to put a module out of sight | Hidden modules collect under **Hidden** at the foot of the rail, each one click from opening or being shown again. Settings cannot be hidden |
| Skills kept its settings in an unstyled panel on its own screen, with a "Save emails" button beside a checkbox it may or may not have saved | **Settings → Modules**: Skills, the repository scan, Reality RPG and ObjectOS, one card each, one **Save** each. Skills keeps a link to it |
| The audit log showed only actions, 25 of them | **Activity log**: every stream (actions, the repository scan, Projects, Skills, Reality RPG, GhostOS, ObjectOS), newest first, with a filter |
| "clipboard" / "Clipboard", "DexNest Finance" / "finance" | One name per module, the one the sidebar uses |
| "Clear data" knew none of the newer modules | The repository scan and Standups, Skills and Reality RPG can be cleared. "Dev projects" says what it really holds |
| Command's quick action titles were cut ("Open Skill C…") | Two lines before a title is cut, and the whole title in the tooltip |
| Finance showed "3399% vs prev" | Past ten times, it says "far more than prev" |
| Command home's Today card listed calendar events only | It lists the shared agenda: events and timetable blocks |
| `autopilotControlCenter.ui.mjs` failed with "Script failed to execute" | Passes: its stand-in bridge lacked two calls the view now makes |

## How

- `renderer/lib/sidebarLayout.ts`: `arrangeSidebar`, `moveSidebarView`,
  `setSidebarHidden`. Saved to `settings/sidebar.json` under the data root. A
  module added after an order was saved goes after the module that precedes
  it by default. Hiding is not disabling: a hidden module is still reached
  from the Hidden group, the command bar, hotkeys and voice.
- `views/ModuleSettings.tsx`. Turning a module on or off stays on its own
  screen, where it is explained and logged; what moved is how it behaves once
  on. GhostOS has no settings: connecting repositories stays on its Sources
  tab, because disconnecting deletes what was added.
- `dexnest:list-activity` returns the envelope of each event from every
  stream and, for an action's own row, the short fields it wrote. A module
  event's payload is not sent. `renderer/lib/activityLabels.ts` names modules
  and words event types ("Commit observed").
- "Clear data" categories can name table prefixes. Clearing empties those
  tables in one transaction and leaves the tables themselves; names come from
  the database's own list, never from what was asked for.

## Not covered here

- GhostOS and ObjectOS have no "Clear data" category. Both keep rows the
  module needs to start (and ObjectOS has files on disk), and both already
  have their own ways to remove things: GhostOS's "Turn off and remove what it
  added" and per-entry Delete, ObjectOS's delete and export.
- Projects' own list is not in "Clear data" either: removing a project is
  done in Projects.
- The sidebar is reordered with buttons, not by dragging.
- Today's "Watching" card stays on Today; it is what the scan reads, not a
  setting.

## Tests

- `apps/desktop/test/housekeeping.test.ts`: sidebar order, hide and new
  modules; module names and event words; the Modules section; clear-data
  categories; the small fixes.
- Checked in the real app on a scratch data root: a module moved up and
  another hidden, saved to `settings/sidebar.json`, the hidden one still
  opening and then shown again; the activity log listing the repository scan,
  Skills, Reality RPG and ObjectOS under one name each, and the scan's events
  in words; Skills' link opening Settings on Modules; an email picked and
  saved, Reality RPG's interval saved, ObjectOS reminders turned on; Skills
  and Reality RPG cleared (22 and 15 rows), then Skills rebuilt and the game
  started again, with an ObjectOS object untouched; Command home's Today card
  showing an event and a timetable block.
- Clearing "Repository scan and Standups" was not run in the real app; it
  uses the same code path as the two that were.
- `node test/autopilotControlCenter.ui.mjs` passes.
