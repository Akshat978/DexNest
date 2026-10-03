# ObjectOS redesign: handoff

Brought up to the bar in `docs/DESIGN_LANGUAGE.md` (section 8, "your things,
like a well-kept garage"). Presentation only: the module's data, actions,
events, IPC, file handling and runtime are unchanged. Screenshots are in
`screenshots/`, from the stub harness with synthetic data.

## What changed

- **Stat tiles:**
  - objects, and in how many locations;
  - maintenance due, red when anything is overdue;
  - warranties ending in the next 30 days;
  - parts low on stock, amber because that is a warning.
- **Every object row carries its category's mark:** printer, computer,
  appliance, tool, vehicle or other.
- **Needs attention:** each row carries its urgency's mark (overdue, due
  soon, warranty, low stock) in the meaning colour, with a red or amber rail.
- **The object** sits in a framed panel with a faint coral glow and its
  category mark beside its name. Facts, notes and section headings ("Components",
  "Current state") are sized to the kit.
- **Cards and rows** use the kit's surfaces and section-title style.

## Changed from the creative direction

- **No photo-card grid.** ObjectOS is a list-and-detail screen with the list
  in a narrow left column; a card grid there would break the layout.
  Category marks give the rows their identity instead. A grid view for large
  collections could come later as a toggle.

## Kept on purpose

- **"Nothing animates."** ObjectOS's own rule, enforced by its test. Hover
  changes are instant.
- **The attention summary line** ("1 overdue, 1 due soon…"). Its tests pin
  it, and it reads the counts in words for screen readers.

## Tests

All 28 existing view tests pass unchanged: the new markup keeps the
structure they check.

New tests:
- the stat tiles, with low stock as a warning, and none while empty;
- the category mark on object rows;
- the urgency marks on attention rows;
- the mark in the object's header.

## Needs Windows check

- The marks' meaning colours at 125% and 150% scaling.
- Narrator: the marks are hidden (aria-hidden); the row's words carry the
  urgency.
