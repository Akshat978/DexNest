# L5: Search and voice, the rest

Fifth of the leftovers after the fifteen fix phases. It finishes two things
phase 13 left open.

## What it does now

| Before | Now |
|---|---|
| The Standup's lines could not be searched | Search finds them, under **Today**, and a result opens Today |
| "What needs me" opened Today and said "Opened" | It opens Today and says how many things need you |

## The Standup in Search

- Each line of the **latest** Standup is a search result: its title, and its
  section ("Where you left off", "Changed since the last Standup", "Needs
  attention"…). Earlier Standups are history and are listed on Today.
- Like the other newer modules, it is asked when a search is run and never
  written to the index file. The latest report is read just before a search
  from the Search screen and kept in memory.
- A line's summary is left out when it still carries an internal repository
  id. Today swaps those for project names; Search shows no ids.
- Search results do not leave the desktop: the Deck endpoint's reply has no
  results in it, and the phone has no search.

## Spoken answers

| You say | DexNest opens | and says |
|---|---|---|
| "What needs me" / "does anything need my attention" | Today | "3 things need you. They are on Today." |
| "What's my level" / "what is my XP" | Reality RPG | "You are level 4, with 320 XP. 80 more to reach level 5." |
| "What are my top skills" | Skills | "Your strongest skills are TypeScript, React and Python." |
| "Which warranties are ending" / "what maintenance is due" | ObjectOS | "2 maintenance jobs are overdue and 1 warranty is ending." |

- The answers are counts, a level and skill names. Nothing from the Vault,
  Finance or the Journal is read for them, and no object, file or project is
  named: they may be spoken in a room.
- A skill you hid is not said.
- These still only open the screen: "where did I leave off" (it would name a
  project), "show my quests", "what's my timeline".
- The count said for "what needs me" is the count Today shows, from the same
  three sources.
- If something cannot be read, the screen still opens and a short, true line
  is said ("Reality RPG is turned off.").
- `renderer/lib/spokenAnswers.ts`. The kind of answer comes from DexNest's
  own table of questions; anything else passed in its place says nothing.

## Not covered here

- The answer is spoken and is the reply recorded for the command. After the
  screen changes, the chat that showed it is gone, as with every command that
  opens a screen.
- A search run from somewhere other than the Search screen uses the Standup
  as it was last read.
- Voice still does not answer anything about the Vault, Finance or the
  Journal beyond the existing private lookup.
- Search results still open a module's screen, not the exact record.

## Along the way

- A stray control character got into one line of `moduleSearch.ts` while it
  was being edited (a mangled backslash), which made the id filter match
  nothing. The real-app check caught it; the line was rewritten and every
  source and test file was scanned for control characters. None remain.

## Tests

- `apps/desktop/test/spokenAnswers.test.ts`: the Standup records (one per
  line, sections named, ids left out, never indexed); each answer's wording,
  including one, many and none; hidden skills; object names not spoken;
  unknown kinds saying nothing; failing sources; the file reading none of the
  private modules; which questions answer and which only open.
- Root `pnpm test`: 2,409 tests pass; typecheck clean.
- Checked in the real app on a scratch data root with scratch repositories
  and a real Standup, 16 checks: two Standup lines found; the Today filter;
  old history not found as news; the result named "Today · standup line" with
  no id; Open going to Today; nothing of it in the index file; "what needs
  me" saying the count Today showed at that moment and not the object's name;
  the warranty count; the level, off and then on; skills; "where did I leave
  off" saying only "Opened".
