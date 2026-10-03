# Reality RPG redesign: handoff

Brought up to the bar in `docs/DESIGN_LANGUAGE.md` (section 8, "a character
sheet, not a settings page"). Presentation only: the module's data, actions,
events, IPC and runtime are unchanged. Screenshots are in `screenshots/`; they
come from the stub harness with its synthetic data, with the browser clock set
to the data's dates.

## What changed

- **Character:**
  - **Hero:** a gold hero with the level in a `Ring`, the XP total, and one
    line: XP to the next level, the strongest stat, and achievements unlocked.
  - **Stat tiles:** strongest first, each against the strongest.
  - **"XP · last 14 days":** a bar chart. It says when the loaded awards (the
    snapshot carries the latest 50) may not cover the whole fortnight, and it
    says "No XP in the last 14 days" instead of drawing an empty chart.
  - **Active quests:** shown as meters.
  - **Recent XP:** shown as rows.
  - **Next achievement:** the closest locked one, with its progress.
- **Off:** only the explanation and a pointer to Rules; no empty level-1
  sheet under it.
- **Quests:** cards with an icon and a progress meter (green when met);
  completions and Abandon kept.
- **Achievements:** a medallion grid. Earned ones are lit gold with their
  date; locked ones are dim, with a meter. A screen reader hears "unlocked"
  or "locked".
- **History:** rich rows: the rule's name, the event type as small print, and
  the XP in gold.
- **Rules:** behaviour unchanged. Headings and the technical small print are
  restyled to match.
- **CSS:** `RealityRpg.css` is rewritten: tokens only, `--accent-rpg`, and the
  obsolete level-box, progress-bar and stat-bar styles are removed.

## Tests changed, and why

The view tests pinned the old markup, so four were updated to pin the new
one. What they protect is the same: level and progress, stats against the
strongest, quest progress as numbers, achievements with a date or progress,
and history that never shows event content.

New tests:
- the hero and the ring's spoken label;
- the 50-award caveat;
- the empty fortnight;
- the off state without an empty sheet;
- model tests for XP by day, ranked stats, the next achievement, the hero
  line (thousands grouped) and quest progress text.

## Not done

- **A streak.** It isn't in the snapshot, and computing one from 50 awards
  would sometimes be wrong. It needs a field from the module.
- **Per-stat sparklines.** These need per-stat history, which the snapshot
  doesn't carry.

## Needs Windows check

- The ring's glow and the hero gradient at 125% and 150% scaling.
- Narrator reading the ring label, the medallions ("unlocked" or "locked")
  and the meters.
- The chart in the real app on a real day: today's bar lands on the
  right-hand edge in the local time zone.
