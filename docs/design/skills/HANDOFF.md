# Skill Constellation redesign: handoff

Brought up to the bar in `docs/DESIGN_LANGUAGE.md` (section 8, "a night
sky"). Presentation only: the module's data, actions, events, IPC and runtime
are unchanged. Screenshots are in `screenshots/`, from the stub harness with
synthetic data.

## What changed

- **The sky fills its frame.** The view is fitted to where the stars actually
  are (padded for labels, 16:10, with a minimum size so two close stars don't
  become giants), instead of the whole 1000×1000 layout with the stars in one
  corner. Stars, links and labels are scaled to that zoom, so names keep one
  size on screen.
- **A night sky:**
  - a dark gradient with a faint starlight glow;
  - static star dust: deterministic, drawn once, never twinkling;
  - each star glows more the more recent its evidence is;
  - hovering or selecting a star brightens it.
- **Labels never collide.** A label goes below its star, else above, right or
  left: the first side that clears every other label *and* every other star.
  Before, it was below or above only, and checked against other labels only.
- **Stat tiles:** skills (and how many are languages), strongest, freshest,
  and the evidence count.
- **Nothing selected:** the side panel lists the five brightest stars; one
  click opens a star's evidence.
- **The evidence panel:**
  - strength as a `Ring`, with the category as a badge;
  - volume, recency and variety as `Meter`s;
  - the strength history as a sparkline (the numbers are kept beside it);
  - evidence grouped by repository, restyled.
- **Unknown categories** show as themselves, not "undefined".
- **Harness:** its sample data used two categories the module doesn't have;
  now corrected.

## Tests changed, and why

- **"ready" and "a selected star":** these pinned the fixed `0 0 1000 1000`
  viewBox and the old strength list. They now pin the fitted viewBox (and that
  it isn't the whole layout), the stat tiles, the glow, the dust, the
  brightest-stars list, the strength ring and the meters.
- **"off" and "empty":** these asserted "no sky" by looking for the old
  viewBox string, so they would have passed even with a sky drawn. They now
  look for the sky element itself.
- **The two-close-stars label test:** it expected "Next.js" below its star,
  which put that label across the React star. It now expects "above", the
  correct placement.
- **New model tests:** fitting, glow, dust (deterministic and inside the
  sky), stats and brightest stars, and three stacked stars whose labels clear
  every star and label, checked geometrically.

## Needs Windows check

- **Blur:** the star glow uses a CSS blur on SVG. Check that it renders in
  Electron on Windows and is cheap at idle (Task Manager: no CPU with the
  view open).
- **Label size** at 125% and 150% scaling, and with a large real
  constellation.
- **Narrator:** the stars (role button, with full labels), the strength ring
  and the brightest-stars rows.
