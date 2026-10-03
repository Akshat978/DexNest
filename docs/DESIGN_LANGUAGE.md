# DexNest design language

DexNest should look like one premium instrument, not a set of forms. This is
the bar every view is held to, taken from the screens that already reach it:
**Heatmap, Finance, Clipboard and Command**. Every redesign is measured against
these four.

Rules in `AGENTS.md` still apply: design tokens only, Inter for UI text,
JetBrains Mono for technical text, idle CPU near zero, offline.

## 1. What makes the good screens good

1. **A number before a list.** The screen opens with what matters, as big
   monospaced numbers in stat tiles (Heatmap: active today, focus blocks,
   context switches, top app). Lists come after.
2. **Every module has a colour, and it glows a little.** Its accent shows as a
   thin glowing rail on cards and tiles, as a tinted icon tile in the header,
   and in its charts. It never floods: backgrounds stay near-black.
3. **Data is drawn, not only written.** Bars for time, rings for completion,
   meters for goals, sparklines for trends, a grid for weeks.
4. **Dense, but every block is a card.** Gradient-surface cards with a hairline
   border, 12px radius, a 2:1 main/side layout. Nothing floats loose on the
   page background.
5. **Two typefaces with jobs.** Inter for words, JetBrains Mono for anything a
   machine produced: numbers, times, ids, paths, amounts, shortcuts.
6. **Quiet labels, loud values.** Section titles are small, uppercase and
   spaced, in `--text-muted`; values are large, in `--text`.
7. **It answers "what now?".** Status chips that pulse when something is live,
   and an attention list with the most urgent item first.

The newer modules (GhostOS, ObjectOS, Reality RPG, Skill Constellation) and
Autopilot fall short mainly on points 1, 2 and 3. Each is mostly text lists.

## 2. Building blocks

Everything is in `apps/desktop/src/renderer/components/ui/kit` (import from
`../components/ui/kit`). Don't rebuild these per module.

| Need | Component | Notes |
|---|---|---|
| Page title, icon, actions | `PageHeader` | Always first. Give `accent` the module's token name. |
| The one big moment | `Hero` | At most one per screen: a level, today's total, "where you left off". Takes a `visual` (a `Ring`, a `Sparkline`). |
| Headline numbers | `StatTile` in a `StatGrid` | 2 to 4 tiles. Value in mono. Optional `delta` (colour follows meaning, not sign) and `hint`. |
| Progress toward a goal | `Meter` | Label, value text and a glowing bar. Prefer it to a bare percentage. |
| Completion or level | `Ring` | Needs a `label` for screen readers. |
| Amounts over time | `BarChart` | Hours, days, weeks. Carries a hidden text version. |
| A trend in a small space | `Sparkline` | Inside a stat tile or a row. |
| Items in a list | `ListRow` | Icon tile, title, quiet meta line, trailing badge, time or amount. As a button when it opens something. |
| Layout | `DashboardGrid` | Main 2/3, side 1/3; stacks below 1024px. |
| Grouping | `Card`, `SectionTitle` | Card with `accent` gets the glowing rail. |
| States | `LoadingState`, `EmptyState`, `ErrorState` | Every view has all three. An empty state says what to do next and has the button for it. |
| Status | `Badge` (with `pulse` when live) | |
| Entrance | `Reveal` | One short staggered rise on mount. Use it for the main blocks, not for every row. |
| Forms and dialogs | `Field`, `TextInput`, `Select`, `Dialog`, `ConfirmDialog`, `Tabs`, `Segmented` | |

## 3. Colour

Only tokens from `packages/shared-ui/src/tokens.css`. Each module has one
accent and uses it for identity, not decoration:

| Module | Accent token |
|---|---|
| Command | `--accent-command` |
| Projects | `--accent-dev` |
| Autopilot | `--accent-autopilot` |
| Skill Constellation | `--accent-skills` (starlight) |
| Reality RPG | `--accent-rpg` (gold) |
| GhostOS | `--accent-ghost` (spectral orchid) |
| ObjectOS | `--accent-object` (coral) |

Set it once on the view root with `style={accentStyle("ghost")}`; every kit
component inside follows. Meaning colours (`--success`, `--warning`,
`--error`, `--info`) are for state only, never for identity. Tints are
`color-mix()` of a token. A new colour means a new token in `tokens.css`,
added on purpose, never a hex value in a component.

## 4. Type and spacing

- Page title 1.5rem, 600. Hero title 1.75rem. Section titles 0.75rem uppercase
  with 0.14em tracking. Body 0.875rem. Meta 0.75rem.
- Mono for every number, time, path, id, hash, amount and shortcut.
- Spacing only from `--space-1`…`--space-7`. Cards pad `--space-4`; the hero
  pads `--space-6`; blocks are `--space-5` apart.
- Long text truncates with an ellipsis and shows in full in a tooltip. Nothing
  scrolls sideways at 1280×800, or at 125% and 150% display scaling.

## 5. Motion

- One entrance per screen (`Reveal`), about 0.4s, ease-out, staggered.
- Hover: border and tint shift, 0.15–0.25s.
- Values that change (meters, rings) animate their fill once.
- **Nothing loops while idle.** The only continuous animation allowed is a
  status dot pulsing while work is actually running. A starfield that twinkles
  forever costs CPU on an always-open app, so it doesn't happen.
- Everything respects `prefers-reduced-motion`.

## 6. Voice

Short, plain and specific: "Overdue by 2 print hours", not "Item is past due".
Empty states invite: "Bring in your projects", not "No data". Errors say what
happened and what to try, with a button. Never blame the user.

## 7. Accessibility

Visible focus on everything (the kit does it). Keyboard reachable; arrow keys
in tabs and grids. Charts carry a text version. Contrast at least 4.5:1 for
text, 3:1 for controls. A colour is never the only signal: pair it with an
icon or a word.

## 8. Creative direction per module

These are the target, for the redesign passes. Each keeps the module's data
and behaviour; only how it is presented changes.

### Reality RPG: a character sheet, not a settings page
- **Hero:** the character. Level in a large `Ring` (XP to next level), title
  ("Level 7 · Builder"), total XP, current streak.
- **Stat tiles:** each stat (Craft, Order, Lore…) with its level and a
  `Sparkline` of the last 30 days.
- **Quests** as cards with a `Meter` and a reward badge; completed ones get a
  quiet gold check.
- **Achievements** as a grid of medallions: earned ones lit in gold, locked
  ones dim with the hint "how to earn".
- **History** as `ListRow`s: "+20 XP · commit observed · 2h ago".
- **Feel:** gold on black, game-like, never childish.

### Skill Constellation: a night sky
- **The constellation fills its canvas.** Stars are sized by strength and
  their glow by recency, links are faint lines, and labels never overlap.
- Hovering a star brightens it and its neighbours. Selecting it opens a side
  panel: a `Hero`-like header (skill, strength `Ring`), the evidence as
  `ListRow`s (repository, file, date) and a recency `Sparkline`.
- **Stat tiles:** skills, strongest, most recent, new this month.
- Static when idle: the sky is drawn once, never twinkles in a loop.

### GhostOS: a model of you, with evidence
- **Hero:** "13 entries · 6 connections" with a line on what changed lately.
- **Timeline** grouped by day, each entry a `ListRow` with a type icon (person,
  project, skill, memory, decision…) and its source as a badge ("entered by
  you", "from Developer Intelligence").
- **Entity detail:** a header with the type icon tile; connections as linked
  rows; every fact with its source and confidence as a small `Meter`.
- **Type filter** as icon chips with counts.
- Calm and private-feeling: orchid accent, generous spacing.

### ObjectOS: your things, like a well-kept garage
- **Stat tiles:** objects, needs attention, warranties ending, low stock.
- **Needs attention** as `ListRow`s with icons and urgency badges (overdue in
  `--error`, due soon in `--warning`).
- **Objects** as a card grid with the photo (or a category icon tile), name,
  location and status badge, plus a list toggle.
- **Object detail:** a hero with the photo, make/model, status and warranty
  `Meter`; maintenance as a timeline; parts with stock `Meter`s.

### Autopilot: mission control
- Kit `PageHeader` and `Tabs`, not its own header and filled buttons.
- **Hero:** current or last run, with a state badge that pulses only while a
  run is live and a `Ring` for iteration progress.
- **Stat tiles:** runs today, awaiting you, success rate, plan usage.
- Runs as `ListRow`s with state, project, branch (mono) and duration.
- Its runtime and safety behaviour are not touched; presentation only.

### Today (new): the morning screen
Developer Intelligence and Standup have no screen yet. Standup is the best
morning moment the app has.
- **Hero:** "Where you left off": the top continuation with its reason and an
  "Open in VS Code" button.
- **Stat tiles:** repositories, to push, to pull, open TODOs.
- **Sections** from the Standup report: changes since the last Standup, issues
  (NEW / ONGOING / RESOLVED badges), TODO changes, health failures, as
  `ListRow`s.
- **Setup:** when Developer Intelligence is off, the empty state turns it on
  and offers Projects' folders as roots.

## 9. Definition of done for a redesign pass

1. Uses the kit's visual layer: at least the stat tiles, the hero where it
   fits, and `ListRow`s for lists. No module-local copy of a kit component.
2. Tokens only, the module's own accent, Inter and JetBrains Mono. The view's
   existing token test still passes.
3. Loading, empty and error states, each with a useful next step.
4. Screenshots before and after, at 1280×800 and 1920×1080, with realistic
   synthetic data. Use the harness in `docs/integration/harness`; never real
   data.
5. Keyboard and focus work; charts have a text version; reduced motion is
   respected; nothing animates while idle.
6. Behaviour unchanged: the module's tests pass without being weakened, and
   new presentation logic has tests.
