# Phase 9: Reality RPG

Ninth phase of the fixes found in hands-on testing on 3 October 2026.

What prompted it: turning the game on took several steps and said "it is off"
twice; the character page was five empty boxes; writing a rule meant typing
event names like `dev.commit.observed`; and the built-in set was four rules
and three achievements, with no quests.

## What it does now

| Before | Now |
|---|---|
| An "is off" card, a second "nothing earned yet" line, then Rules, then Turn on | One screen: tick what should count from the built-in set, then one button ("Turn on with 8 rules and 4 quests") |
| Four built-in rules, added switched off, shown as event names | Eighteen, in three groups, each said in plain words with what it is worth |
| No built-in quests | Seven: commit on 5 days this week, push 3 times this week, back up this week, finish 3 timetable blocks today, and more |
| Three achievements | Twenty-five, in tiers: 10 / 100 / 1,000 commits; 7 / 30 / 100 days of commits; levels 5, 10 and 20; pushes, TODOs, backups, routine, maintenance |
| Five empty boxes after turning on | "How to earn your first XP": the rules that are on, as things to go and do |
| A rule form asking for event type names | "What earns it", picked from a list ("When you make a backup"). The event names are filled in behind it and tucked away |
| Nothing for leaving a project tidy | A new event the scanner writes when a project that had uncommitted changes has none |

The built-in rules:

- **Your projects:** made a commit, pushed, pulled, cleared a TODO, finished a
  merge or rebase, left a project with nothing uncommitted, picked up a new
  skill, read the Standup, scanned.
- **Things done in DexNest:** made a backup, captured a thought, filed
  something from the inbox, put something in the calendar, made something
  with Tools, remembered where something is, wrote down a memory or decision.
- **Day to day:** finished a timetable block, looked after something you own.

## Old commits earn nothing

Checked rather than assumed. A rule counts from the moment it is switched on,
and commits the scan reads from a repository's history are marked as history
and dropped before any rule sees them. In the real app, thirty commits already
in a repository earned 0 XP; one commit made after turning on earned 5.

## What is left out, and why

Journal, finance and vault are still not counted, even by type. Counting "a
journal entry was made" needs that wall lowered, which was asked and not
answered, so the set leaves them out: no journal streak, no "logged an
expense", no "added a document". Capture's "send to Vault / Finance / Journal"
is left out of "filed something" for the same reason. Saying yes later is a
small change: three rules and two quests.

Also not in the set, because nothing DexNest logs can tell them apart:

- "Every project all pushed" and "a health check went from failing to
  passing": the events carry that in their content, which the game does not
  read.
- "An Autopilot run completed": Autopilot logs one kind of line for
  everything it does.

## How

- `packages/reality-rpg/src/domain/data/starter-pack.ts`: the rules, the
  achievements, the quests and, for each rule, its group and what earns it in
  words (`STARTER_INFO`).
- `enableWith({ ruleIds, questIds })` on the module, reached through
  `reality_rpg.enable` with a `starter` parameter: the picked rules are saved
  switched on from now, the quests they make possible are created, and the
  achievements that count a picked rule (and the XP ones) are added. A rule
  the owner already has is switched on, not replaced. Doing it twice changes
  nothing.
- `dev.working_tree.cleaned` (repository scan): written when the previous
  scan saw uncommitted changes and this one sees none. No payload. Never on a
  first look at a repository.
- `RealityRpgStart.tsx`: the first screen, the first-XP panel and the built-in
  set under Rules.

## Tests

- `packages/reality-rpg`: every built-in rule, quest and achievement is valid
  and refers to something that exists; none names vault, finance or journal;
  the level achievements sit on the level curve; turning on with a selection;
  history and earlier commits earning nothing.
- `packages/dev-intelligence`: the new event, once per tidy-up and never on a
  first look.
- Desktop: `realityRpgModel.test.ts`, `realityRpgView.test.mjs` (the first
  screen, the first-XP panel, the built-in set and the rule form),
  `realityRpgHost.test.ts`.
- Checked in the real app on a scratch data root. After turning on with
  everything ticked (18 rules, 7 quests, 25 achievements) and then doing each
  thing: a commit, a cleared TODO, a tidied project, a backup, a capture, a
  calendar event, a located object, logged maintenance and a memory each
  earned their XP, and five quests moved.
- Not exercised in the real app: push, pull, a finished merge, a new skill,
  Tools, filing a capture and a timetable block. Their events were confirmed
  by reading where each is logged; a timetable block could not be marked done
  in the check because no block was current at that moment.
