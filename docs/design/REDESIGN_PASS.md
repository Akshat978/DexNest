# Running a redesign pass

A redesign pass brings one module up to the bar in `docs/DESIGN_LANGUAGE.md`.
It changes how the module looks and feels, never what it does.

## Before you start

1. Read `AGENTS.md`, `docs/DESIGN_LANGUAGE.md` (all of it, especially section 8
   for your module) and `docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`.
2. Branch from `cloud/integration` (not `main`), named `cloud/redesign-<module>`.
3. Look at the reference: `docs/design/gallery/screenshots/` shows the kit's
   visual layer, and Heatmap and Finance are the best existing screens. To see
   the gallery live, from `apps/desktop` run
   `npx vite --config ../../docs/integration/harness/vite.config.mjs` and open
   `http://127.0.0.1:5199/docs/design/gallery/index.html?accent=<module>`.

## Rules

- Presentation only. Data, actions, events, IPC, permissions and the
  module's runtime package are not changed. If the design needs data the view
  doesn't have, stop and say so in the phase report instead of adding it.
- Use the kit (`components/ui/kit`): `Hero`, `StatTile`/`StatGrid`, `Meter`,
  `Ring`, `BarChart`, `Sparkline`, `ListRow`, `DashboardGrid`, `Reveal`, plus
  the existing header, cards, tabs, dialogs and states. Don't re-create them in
  the module. If a genuinely shared piece is missing, add it to the kit with a
  test, in its own commit.
- Tokens only, the module's own accent (`accentStyle("<module>")`), Inter and
  JetBrains Mono. No hex or rgb in the view or its CSS.
- Nothing animates while idle. Reduced motion is respected.
- Don't weaken tests. Where a view test pinned old markup, change it to pin
  the new markup and say which tests changed and why.
- Never push to `main`; never force push. Never read real user data.

## Phases (one per turn, then stop)

0. **Plan.** Screenshot the current view (the harness in
   `docs/integration/harness`, stub scenarios normal/empty/loading/error/large,
   1280×800 and 1920×1080). Write `docs/design/<module>/PLAN.md`: what's wrong
   today, an ASCII wireframe of the new layout for each screen and tab, which
   kit components go where, and any data the design wants but doesn't have.
1. **Main screen.** Hero, stat tiles, the primary list, layout.
2. **Secondary screens.** Tabs, detail panels, forms, dialogs, empty, loading
   and error states.
3. **Polish.** Both window sizes, long text, huge data, keyboard and focus,
   screen-reader labels, reduced motion. Fix everything found.
4. **Handoff.** After-screenshots of every screen and state in
   `docs/design/<module>/screenshots/after/`, and `docs/design/<module>/HANDOFF.md`:
   what changed, which tests changed and why, and a "needs Windows check" list.

## Gate after every phase

1. `pnpm typecheck` passes.
2. The desktop tests and the module's own tests pass (same Linux baseline as
   before; no new failures).
3. Screenshots of what this phase changed, and you looked at them.
4. Committed and pushed to the branch, with a short report: what was done,
   screenshots, open questions.
