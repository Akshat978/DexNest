# Autopilot redesign: handoff

Brought the Autopilot Control Center's dashboard up to the bar in
`docs/DESIGN_LANGUAGE.md`. Presentation only: no runtime, IPC, policy,
provider, approval or run-state code changed, and the selected-run control
surface (start, pause, approvals, worker sends, consultations, handoffs) is
untouched. Screenshots are in `screenshots/`, from the stub harness with
synthetic runs.

## What changed

- **Header:** the kit page header with the Autopilot mark, in the sky-blue
  Autopilot accent. Refresh is a kit button.
- **Areas** (New Run, Queue, Runs, Selected Run, Notifications) take the kit's
  tab look. They stay a nav of toggle buttons with `aria-pressed`, because the
  areas are shown and hidden in place and "Selected Run" is disabled until
  there is a run.
- **Stat tiles** across the Runs dashboard: runs, active, needs you (amber
  when anything does), completed. Counted from the categories the runtime
  already assigns; none while there are no runs.
- **The brief** ("last night") is a hero: the headline is what needs you, then
  one line of totals, then each run. A run's name reads as a link to it.
- **Run cards** carry their state as a badge whose colour says what to do:
  amber when it needs you, accent while working, green done, red failed.
- **Colours:** every hard-coded hex and grey `rgba` in `Autopilot.css` and the
  inline diff colours are now design tokens.

## Kept on purpose

- **No progress rings or charts.** The runtime's numbers (turns, grants,
  verification) are already shown as text on each card; a chart over a handful
  of runs would add nothing.
- **"Autopilot Control Center"** as the title, and the area list as a literal:
  the navigation test pins both.

## Tests

- New `test/autopilotView.test.mjs`: the badge tones, the dashboard counts, and
  the rendered header, accent, tabs and empty dashboard.
- Desktop suite: 453 tests, 0 failures (one existing skip). Typecheck clean.
- `test/autopilotControlCenter.ui.mjs` (the Electron UI script, not part of
  `pnpm test`) fails with "Script failed to execute" — **before and after this
  change**, verified by running it with the change stashed. Not caused by the
  redesign; worth a separate look.

## Harness

`docs/integration/harness/harness.tsx` gained an Autopilot stub: the dashboard
list, the brief, and just enough of a selected run for the view to settle.

## Needs Windows check

- The badge colours at 125% and 150% scaling.
- Narrator on the tabs: each should read as a toggle button, pressed or not.
