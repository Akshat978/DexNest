# GhostOS redesign: handoff

Brought up to the bar in `docs/DESIGN_LANGUAGE.md` (section 8, "a model of you,
with evidence"). Presentation only: the module's data, actions, events, IPC,
privacy rules and runtime are unchanged. Screenshots are in `screenshots/`,
from the stub harness with synthetic data.

## What changed

- **Stat tiles** for entries, connections, observations and sources on. They
  replace the line of counts above the timeline, which said the same thing.
- **Every kind of entry has its own mark:** person, project, skill, knowledge,
  memory, event, habit, decision, file, conversation and place, plus marks for
  an observation and for a connection that ended. The mark appears on timeline
  rows, search results, filter chips and the entry's header.
- **The timeline is grouped under day headings** ("Today", "Yesterday", then
  dates). The headings are hidden from screen readers, because every row
  still reads its own date.
- **Rows** use the kit's rich-row look, with an icon tile, title and quiet
  meta; the selected row and the entry's related rows are marked.
- **The entry panel:** a large type mark next to the title, and a faint orchid
  glow. Every fact's source shows as a small pill ("From Developer
  Intelligence · 90% sure"), with its evidence in mono under it. Connections
  and observations are shown as cards. Section headings match the kit.
- **Sources:** descriptions are a size down and muted.

## Kept on purpose

- **"Nothing animates."** GhostOS's own rule is stricter than the design
  language: no transitions, not even a hover fade, and its test enforces it.
  The redesign respects that, so hover changes are instant.
- **The empty state still shows the tabs below it.** That is existing, tested
  behaviour ("still offers every section").

## Tests changed, and why

- **The entity header test** pinned the exact old markup. It now pins the
  type icon in front of the type and title, with the actions unchanged.
- **The timeline test** checked the line of counts; it now checks the stat
  tile and that the count isn't repeated.
- **New tests:** stat tiles, day headings, the icons for an observation, an
  ended connection, a person and a filter chip, no tiles when empty, and model
  tests for day grouping (including across a month end) and sources-on.

## Needs Windows check

- Narrator: the day headings are skipped (aria-hidden) and each row is read
  with its date.
- Icon legibility at 125% and 150% scaling.
