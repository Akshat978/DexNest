# DexNest UI audit - new module views

Branch `cloud/ui-audit` = `main` + Skill Constellation (`claude/admiring-babbage-kbw2ew`)
+ Reality RPG (`cloud/reality-rpg`) + GhostOS (`cloud/ghost-os`) + ObjectOS
(`cloud/object-os`). **Report only: no module code was changed.**

## How this was done

- **Real browser, real renderer.** `docs/ui-audit/harness/` serves the
  unmodified renderer (`apps/desktop/src/renderer/main.tsx`) with Vite and the
  app's own Tailwind config, and screenshots it with Playwright + Chromium
  (Linux). The harness sets `window.dexNest` to the app's own preview bridge
  (`fallbackBridge`) with the four new modules' read methods replaced by
  synthetic data for one scenario: `normal`, `empty`, `loading` (promises that
  never resolve), `error` (rejects with "database is locked") or `large`. Every
  screenshot below was taken; none is described without being looked at.
- **82 screenshots** in `docs/ui-audit/screenshots/` (JPEG, quality 82, to keep
  the repository small - the app's grain background makes PNGs about 1 MB
  each): every new view in all five states at 1280x800 and 1920x1080, a detail
  view for ObjectOS, GhostOS and Skill Constellation at both sizes, the
  sidebar with each module active, other tabs, forms, a confirmation and
  keyboard focus at 1280x800, and Command, Dev and Calendar for comparison.
  Reproduce: from `apps/desktop`, `npx vite --config
  ../../docs/ui-audit/harness/vite.config.mjs`, then `node
  docs/ui-audit/harness/shoot.mjs`.
- **What the screenshots are not.** Linux Chromium, not Windows/Electron.
  **Inter and JetBrains Mono are not installed here and the app does not bundle
  them**, so every screenshot shows the fallback fonts (see X3). Skill
  Constellation's star positions come from the harness data, not from the
  module's layout code, so the layout itself is not judged - only how the graph
  is drawn. The app's Content-Security-Policy meta tag is not in the harness
  page.
- **Autopilot could not be rendered**: the preview bridge lacks
  `autopilotQueue`, `autopilotPushSettings` and `autopilotMorningBrief`, the view
  throws, and the **whole window goes black**
  (`existing-autopilot-1280x800.jpg`). That is itself a finding (X4). Calendar
  was used as the third comparison view instead.
- Code-level checks: token use, fonts, focus styles, contrast computed from
  the actual values in `packages/shared-ui/src/tokens.css`, keyboard handling,
  and every registered action checked against what each view can reach.

## Summary

| Module | Consistency | Polish | Accessibility | Coverage |
|---|---|---|---|---|
| Skill Constellation | Needs work | Needs work | Needs work | Good |
| Reality RPG | Needs work | Needs work | Needs work | Needs work |
| GhostOS | Needs work | Needs work | Needs work | Good |
| ObjectOS | Needs work | Needs work | Good | Needs work |

All four follow the rules (tokens only, Inter/JetBrains Mono through
`--font-ui`/`--font-tech`, dark theme, labelled controls, loading/empty/error
states) - the gap is with the rest of the app, not with the rules. They were
built against the older plain style (`components/shared.tsx` `PageHeader`,
global `button`/`input` styles), while Command, Dev and Calendar use the newer
"glass" kit in `apps/desktop/src/renderer/components/ui` (icon-tile page
header, uppercase section titles, glass cards, tinted action buttons, status
chips). Side by side they read as a different app (compare
`existing-calendar-1280x800.jpg` with `object-detail-1280x800.jpg`).

The catch: **that glass kit itself breaks the tokens rule** - it is written
with hard-coded hex (`#F5F5F5`, `#A3A3A3`, `#1f1f1f`) and builds tints by
appending alpha digits to a hex accent (`${accent}14`). That cannot work with
token accents, which is exactly why the new modules could not simply use it,
and why their sidebar entries are broken (X1). The fix is one token-based
shared kit (below), not more per-module CSS.

---

## Cross-cutting issues (all four modules)

| # | Sev | Issue | Screenshot | Fix |
|---|---|---|---|---|
| X1 | **High** | **The active sidebar entry of every new module is broken.** The shell builds the active style as `` `${meta.accent}12` `` / `` `${meta.accent}26` `` / `` `${meta.accent}10` ``. The new modules' accents are tokens (`var(--accent-tools)` etc.), so this becomes `var(--accent-tools)12` - invalid CSS - and the tint, border and glow are dropped; the button shows a plain light outline instead. Calendar (hex accent) shows the intended tint. | `sidebar-object-1280x800.jpg`, `sidebar-ghost-*`, `sidebar-rpg-*`, `sidebar-skills-*` vs `sidebar-calendar-1280x800.jpg` | In `main.tsx`'s sidebar, build tints with `color-mix(in srgb, ${accent} 7%, transparent)` (works for hex and `var()`), and move every `MODULE_META` accent to tokens. |
| X2 | **High** | **Two visual generations.** New views: eyebrow + small title + rule (`components/shared` `PageHeader`), plain bordered buttons, plain boxes. Existing views: icon tile + 24 px title + subtitle, tinted `ActionButton`s, glass cards with uppercase section titles. | `object-normal-1280x800.jpg` vs `existing-dev-1280x800.jpg`, `existing-calendar-1280x800.jpg` | Adopt the shared kit below in all four views: `PageHeader` with the module icon and accent, `Card` + `SectionTitle`, `Button` variants. |
| X3 | **High** (app-wide) | **Inter and JetBrains Mono are never loaded.** No `@font-face` anywhere and the CSP only allows `font-src 'self'`, so the fonts appear only if installed on the machine; otherwise `--font-ui` falls back to Segoe UI / system-ui and `--font-tech` to Consolas. Every screenshot here shows fallbacks. | every screenshot | Ship Inter and JetBrains Mono (woff2, OFL) in `packages/shared-ui`, declare `@font-face` next to `tokens.css`. Offline, no CDN. |
| X4 | **High** (app-wide) | **One failing view blanks the whole app.** There is no error boundary around views: Autopilot throwing in the preview leaves a black window with no sidebar. The new views catch their own load errors, but anything thrown while rendering would do the same. | `existing-autopilot-1280x800.jpg` | A shared `ViewErrorBoundary` around `activeView` in `main.tsx`: sidebar stays, the view shows the shared `ErrorState` with "Try again". |
| X5 | Medium | **Four tab styles.** GhostOS and ObjectOS: transparent tabs, the selected one outlined in the accent. Reality RPG: filled pills, the selected one outlined. Calendar: a segmented control with a filled selected pill. Skill Constellation: no tabs. | `ghost-normal-*`, `object-detail-*`, `rpg-normal-*`, `existing-calendar-*` | One shared `Tabs` (roving focus already written three times - see below) styled like Calendar's segmented control. |
| X6 | Medium | **Loading, empty and error states are bare.** Loading is a line of text in a box (no skeleton, unlike the existing `ModuleSkeleton`). Errors are red text plus a **full-width "Try again" button** spanning the page. Empty states are a paragraph with no icon and no button (Dev's empty state has an icon, a title and the primary action). | `*-loading-*`, `*-error-*`, `*-empty-*` vs `existing-dev-1280x800.jpg` | Shared `LoadingState` (skeleton), `ErrorState` (icon, message, a normal-width retry), `EmptyState` (icon, title, one sentence, primary action). |
| X7 | Medium | **Checkboxes are stretched to full width** by the global `input { width: 100% }` in `styles.css`. Reality RPG's "Rules that count" list shows it worst: each checkbox sits mid-row with its label pushed right. | `rpg-tab-quests-1280x800.jpg` | Global `input[type="checkbox"], input[type="radio"] { width: auto; }` (fixes every module at once); then a shared `Checkbox`. |
| X8 | Medium | **Large gap under the header.** About 50 px between the header rule and the first content in ObjectOS; existing views start content about 24 px under the header. | `object-normal-1280x800.jpg` vs `existing-calendar-1280x800.jpg` | The shared `PageHeader` owns the spacing (`margin-bottom: var(--space-5)`); views drop their own top padding. |
| X9 | Medium (app-wide token) | **Borders and input outlines are 1.3:1** (`--border` `#262626` on `--surface` `#0A0A0A`), below the 3:1 WCAG 1.4.11 asks for the outline of a control. | inputs in `object-form-add-1280x800.jpg` | Add `--border-strong` at `#666666` (3.45:1 on surface, 3.66:1 on bg) for inputs, selects and the selected tab; keep `--border` for card edges. |
| X10 | Low | Native `<select>`s and date inputs keep the platform look (white chevrons, `mm/dd/yyyy`), unlike the custom controls in Calendar. | `object-form-add-*`, `ghost-tab-add-*` | Shared `Select` and `DateInput` styled with tokens (keep the native element underneath for keyboard and screen readers). |

---

## Skill Constellation

| Sev | Issue | Screenshot | Fix |
|---|---|---|---|
| **High** | **Labels overlap into an unreadable mass at scale** (80 skills). Every star always draws its label, and labels are 22 units in a 1000-unit `viewBox`, so they grow with the graph - large at 1920. | `skills-large-1920x1080.jpg`, `skills-large-1280x800.jpg` | Label only the top N by strength (say 15) plus the focused/hovered/selected star; fixed label size in CSS pixels; simple collision culling. Offer a list view (sortable table of skills with strength, evidence count, last seen) beside the graph - also the accessible alternative. |
| Medium | Every star is the same blue; category is not shown anywhere on the graph. | `skills-normal-1280x800.jpg` | Shape or ring style by category (not colour alone), with a legend. |
| Medium | Detail panel stats wrap mid-value at 1280 ("last 2026-" / "06-30"; "1 repos, 1" / "kinds"). | `skills-detail-1280x800.jpg` | Two-column `dl` with values that do not break (`white-space: nowrap` on dates), or one stat per row in the narrow panel. Also "1 repos" -> "1 repository". |
| Medium | Focus outline uses `--focus-ring` (accent mixed 40% into transparent): about 2.3:1 on the surface, under 3:1. The star itself has a clear white focus halo. | `skills-focus-1280x800.jpg` (star) | Use a solid accent outline (as GhostOS/ObjectOS do) for buttons, inputs and the settings summary. |
| Low | Hidden stars are drawn in `--text-disabled` (2.5:1) but stay focusable and clickable. | code: `SkillConstellation.css` `.skill-star--hidden` | Keep them dim but give the focus halo full contrast, and add "hidden" to the accessible name (`starLabel` gives name, category, strength and evidence, but not that the star is hidden). |
| Low | "Rebuild" is offered while the module is off; it is not obvious that it builds once without turning it on. | `skills-empty-1280x800.jpg` | Label it "Build once" while off. |
| Low | Settings live in a collapsed `<details>` under the graph, easy to miss; the "add your commit emails below" hint points at it. | `skills-settings-1280x800.jpg` | Make the hint a link that opens and scrolls to the settings. |

Coverage: everything registered is reachable (rebuild, on/off, hide/show,
commit emails, unmapped libraries, evidence, history). **Gap:** the rebuild
interval (`rebuildIntervalMinutes`) has no control.

---

## Reality RPG

| Sev | Issue | Screenshot | Fix |
|---|---|---|---|
| **High** | **"Rules that count" checkboxes are laid out broken** in the New quest form (X7): checkbox mid-row, label wrapped at the right edge. | `rpg-tab-quests-1280x800.jpg` | Global checkbox width fix (X7); `.rpg-check` then aligns as intended. |
| Medium | **Deleting a rule happens at once**, with no confirmation, unlike GhostOS and ObjectOS (the action is `safe` in the registry). Abandoning a quest is the same. | `rpg-tab-rules-1280x800.jpg` | Shared `ConfirmDialog` for delete and abandon (and mark both `caution` in the registry if they lose data). |
| Medium | Stats are full-width rows with the value at the far right - at 1920 the name and the number are 1,500 px apart; no visual of relative size. | `rpg-large-1920x1080.jpg`, `rpg-normal-1280x800.jpg` | A compact grid of stat cards (name, XP, a bar relative to the top stat), max width about 48rem. |
| Medium | Focus outline uses `--focus-ring` (about 2.3:1). | `rpg-focus-1280x800.jpg` | Solid accent outline. |
| Medium | History rows likewise stretch full width; raw event type ids (`dev.commit.observed`) are the main text. | `rpg-tab-history-1280x800.jpg` | Rule name as the text, event type as small technical meta; constrain the width. |
| Low | Rules show raw event types and action ids as their main description (`action_executed · standup.generate`). | `rpg-tab-rules-1280x800.jpg` | Lead with a human sentence ("When Standup is generated: +3 Focus, at most 20 a day"), keep the ids as technical meta. |
| Low | Empty state offers "Refresh" while the module is off. | `rpg-empty-1280x800.jpg` | Hide or disable Refresh while off. |

Coverage gaps: **custom achievements cannot be created or deleted** (only
starter achievements can be added; `reality_rpg.achievement.delete` has no
UI); the processing interval (`intervalMinutes`) has no control. History paging
("Show older") is there.

---

## GhostOS

| Sev | Issue | Screenshot | Fix |
|---|---|---|---|
| Medium | Links in the detail (connection targets, in `--accent-search` `#6366F1`) are 4.43:1 on `--surface` and 4.23:1 on `--surface-2` - just under AA 4.5:1 for normal text. | `ghost-detail-1280x800.jpg` | Underlined `--text` links, or a lighter accent tint for text (e.g. `color-mix(in srgb, var(--accent-search) 70%, white)`), defined once as a token. |
| Medium | The connection-type picker shows raw enum values (`related_to`, `worked_on`). | `ghost-detail-1280x800.jpg` | Human labels ("related to", "worked on") in the model, as the timeline already does. |
| Medium | Detail actions are scattered: "Forget..." for the entry sits between the notes and Connections; each connection and observation has its own right-aligned "Forget...". | `ghost-detail-1920x1080.jpg` | Entry actions in the detail header (with Edit); per-row actions in a consistent trailing column. |
| Medium | Type filter is 11 native checkboxes in a fieldset - busy, and wraps to three lines at 1280. | `ghost-normal-1280x800.jpg` | Shared `ToggleChip` group (buttons with `aria-pressed`) on one scrollable line. |
| Low | Several timeline rows highlight at once (every row of the selected entry); can read as a multi-selection. | `ghost-detail-1280x800.jpg` | Highlight the clicked row; mark the entry's other rows with a subtle left rule. |
| Low | The empty state puts the intro above the full working UI (search, 11 filters, "Nothing on the timeline yet"). | `ghost-empty-1280x800.jpg` | When empty, show only the shared `EmptyState` with "Add an entry" and "Turn on Developer Intelligence". |
| Low | Large counts (thousands of entries) are not shown anywhere on the Timeline tab. | `ghost-large-1920x1080.jpg` | Counts in the header subtitle ("4,200 entries · 9,100 connections"). |

Coverage: every action is reachable (save, connect, observe, decision
outcome, forget, sources on/off, sync, export, import). **Gap:** the sync
interval (`syncIntervalMinutes`) - `ghostOsUpdateSettings` is in the bridge but
no view calls it.

---

## ObjectOS

| Sev | Issue | Screenshot | Fix |
|---|---|---|---|
| **High** | **"Needs attention" has no limit**: 60 items push search, filters and the object list off the screen. | `object-large-1280x800.jpg` | Show the 5 most urgent, then "Show all 60" (or a scrollable region with a max height), counts always visible. |
| Medium | Detail header: the Status `<select>` has a label above it, so Edit / Export / Delete stretch to its height (about 56 px) - taller than the page's own header buttons. | `object-detail-1280x800.jpg` | Put "Status" as an `aria-label` / visually hidden label, or move status into the subtitle with a small menu button; buttons at the standard height. |
| Medium | Nine tabs wrap to two rows at 1280. | `object-detail-1280x800.jpg` | Shared `Tabs` with horizontal overflow scrolling (and arrow buttons), or group into fewer tabs (Overview, Care = maintenance + parts + modifications, Data = settings + measurements, Files, Purchase, History). |
| Medium | Files table is cramped in the detail column at 1280: dates wrap ("2025-09-" / "03"), names wrap, Open/Remove stack. | `object-tab-files-1280x800.jpg` | At narrow widths render files as a list (name + meta line + actions); `white-space: nowrap` on dates and sizes. |
| Medium | Maintenance: Pause/Delete stack vertically per schedule, the due state floats mid-row, and the add-schedule form follows the list with no separation; "Add schedule" is a full-width disabled bar. | `object-tab-maintenance-1280x800.jpg` | Schedule rows as list items with a status badge and an actions menu; "Add schedule" opens a form in a card or a dialog. |
| Medium | The delete confirmation appears as a banner at the top of the page, far from the button that opened it, and pushes everything down. | `object-confirm-delete-1280x800.jpg` | Shared `ConfirmDialog` (modal, focus trapped, Cancel focused - the focus and Escape handling already written here can move into it). |
| Low | Table row actions ("Clear") sit lower than their row text. | `object-detail-1920x1080.jpg` | `vertical-align: middle` for action cells; smaller ghost buttons in tables. |
| Low | The add form's submit stays disabled until a name is typed, with no hint why. | `object-form-add-1280x800.jpg` | Mark Name as required ("Name *" / helper text). |
| Low | The overview facts list is tight (label/value columns almost touching) and leaves the right half empty at 1920. | `object-detail-1920x1080.jpg` | Shared `KeyValue` grid with a fixed label column and two columns at wide sizes. |

Accessibility is the strongest of the four: every control labelled (tested),
roving tabs, a focusable tab panel, an alert dialog with Cancel focused and
Escape, tone said in words as well as colour, and a solid accent focus outline
(7.5:1) - visible in `object-focus-1280x800.jpg`.

Coverage gaps: **parts can only have their stock changed** after they are
added (name, number, supplier, restock level and which objects they fit are
set at creation only); **moving an object** is only possible through Edit
("Part of") - `object_os.object.move` is registered but no control calls it;
"check reminders now" exists in the module but not in the view.

---

## Developer Intelligence and Standup: the missing views

Both run on `main` with IPC and preload methods in place and **no renderer code
calling them** (`devIntelligence*` and `standup*` appear only in the preload
and the bridge type). The Dev dashboard on `main` is a different, older feature
(projects and commands). What the code supports, and so what the views should
contain:

**Developer Intelligence** (`devIntelligenceStatus`, `-Settings`,
`-UpdateSettings`, `-Scan`, `-Repositories`; action `dev.scan_repositories`)
- Header: on/off switch (off by default - "DexNest does not walk anyone's disk
  until asked"), "Scan now", status chip (scanning / last scan time / last
  error).
- **Where to look** (settings): scan roots and manual repositories, each a path
  plus its domain (Windows or WSL), add/remove; excluded roots; scan interval
  (minimum 5 minutes); "run my configured health checks" toggle. Show the
  roots refused because they are inside DexNest's data (`refusedRoots` from the
  last scan) as a warning.
- **Repositories**: list with display name, roots (technical text), discovered
  and last seen; per repository, the stores already have technologies, open
  TODOs, recent commits (`EventStore`), health checks and runs, and snapshots -
  a detail panel with those as tabs.
- **Scan history** (`ScanRunStore.listRecent`): time, trigger, repositories,
  outcome.
- States: off (explain what it reads and never reads), scanning (progress),
  empty (no roots yet - primary action "Add a folder"), error.

**Standup** (`standupGenerate`, `standupLatest`, `standupList`; action
`standup.generate`)
- The latest report, grouped by its sections - Continue (with ranked
  continuation candidates and their reasons), Changed, Needs attention (by
  severity: info / warning / critical, with NEW / ONGOING / RESOLVED
  lifecycle badges), Repository state, History - each item with its title,
  summary, repository and evidence references.
- "Generate now" and "Generate a fresh one" (`forceNew`); the time window
  covered and when it was generated (scheduled or manual).
- A list of past reports (`standupList`) to open; "copy as text" for pasting
  into a team channel by hand (no integration).
- Empty state: "Turn on Developer Intelligence and scan first" when there are
  no repositories.

Both views can be built entirely from the shared set below.

---

## Proposed shared component set (`packages/shared-ui`)

Today `packages/shared-ui` holds only `tokens.css`. The four modules have
re-built the same pieces with their own CSS (1,135 lines across
`SkillConstellation.css`, `RealityRpg.css`, `GhostOs.css`, `ObjectOs.css`,
each re-declaring `.technical`, focus rules, hint/meta text, cards and list
rows), and the app has a second, hex-based kit in `components/ui`. One
token-only set would replace both:

| Component | Replaces | Notes |
|---|---|---|
| `fonts.css` | - | `@font-face` for bundled Inter and JetBrains Mono (X3). |
| `PageHeader` | `components/shared` `PageHeader`, `components/ui` `PageHeader`, four header layouts | Icon tile, title, subtitle, status chips, actions; accent as a token; owns the spacing below it. |
| `Card`, `SectionTitle` | `GlassCard`, `.ghost-card`, `.objectos-card`, `.rpg-*` boxes, `.skill-*` panels | Tints by `color-mix()`, not hex+alpha. |
| `Button` (`primary`, `secondary`, `ghost`, `danger`; sizes) | `ActionButton`, global `button` styles | Consistent heights in headers, rows and tables. |
| `Tabs` | three roving-tab implementations (GhostOS, Reality RPG, ObjectOS) and their CSS | Roving focus, Home/End, overflow scrolling for many tabs; segmented look. |
| `ConfirmDialog` | GhostOS's and ObjectOS's inline confirmations; Reality RPG's missing one | Modal, focus trap, Cancel focused, Escape, a destructive variant. |
| `EmptyState`, `LoadingState` (skeleton), `ErrorState` (with retry) | each module's own three states; `components/shared` `EmptyState`; `ModuleSkeleton` | Same layout everywhere (X6). |
| `ViewErrorBoundary` | - | Around every view in `main.tsx` (X4). |
| `Notice` (`status` / `alert`) | `.ghost-notice`, `.objectos-notice`, Reality RPG's and Skill Constellation's notices | Live region included. |
| `Field`, `TextInput`, `TextArea`, `Select`, `DateInput`, `Checkbox`, `CheckboxGroup` | ObjectOS's `Field`, GhostOS's and Reality RPG's form markup | Label, hint, error, required marker, `--border-strong` outline. |
| `ToggleChip` group | GhostOS's type checkboxes, the hidden-skills toggle | `aria-pressed` buttons. |
| `Badge` / `StatusChip` (tone said in words) | `components/ui` `StatusChip` (hex), ObjectOS due labels, Reality RPG "unlocked", GhostOS origin text | Tones from `--success`, `--warning`, `--error`, `--info`. |
| `ListRow` (title, meta line, trailing actions) | `.ghost-item`, `.objectos-item`, `.rpg-item`, timeline/history rows | Selected state, keyboard. |
| `KeyValue` | four facts lists | Fixed label column, wraps cleanly. |
| `DataTable` | ObjectOS's tables | Compact, `nowrap` for technical columns, row actions aligned. |
| `ProgressBar` | Reality RPG's XP bar | Labelled (`role="progressbar"`). |
| `Technical` (`<span>` in `--font-tech`) | `.technical` declared four times | |
| tokens: `--border-strong`, `--accent-text-*`, a solid `--focus-outline` | `--focus-ring` used as an outline | X9, GhostOS links, the 2.3:1 focus outlines. |

## Recommended fix order

1. **Sidebar active state** (X1) - small change in `main.tsx`, visible on every
   new module today.
2. **Global checkbox width** (X7) - one CSS rule, fixes Reality RPG's broken
   quest form.
3. **Bundle the fonts** (X3) and **add the view error boundary** (X4) - both
   app-wide, both small.
4. **Token fixes**: `--border-strong`, a readable accent-text token, a solid
   focus outline (X9; GhostOS links; Skill Constellation and Reality RPG
   focus).
5. **Build the shared set** in `packages/shared-ui` (token-only), starting with
   `PageHeader`, `Card`/`SectionTitle`, `Button`, `Tabs`, `ConfirmDialog` and
   the three states.
6. **Move the four new views onto it** (X2, X5, X6, X8), fixing per module as
   they move: ObjectOS's attention cap, header and tabs; Skill Constellation's
   labels and list view; Reality RPG's confirmations and stats layout;
   GhostOS's relation labels and detail actions.
7. **Coverage gaps**: Reality RPG custom achievements (create/delete); ObjectOS
   part editing and a Move control; interval settings for Skill
   Constellation, Reality RPG and GhostOS.
8. **Build the Developer Intelligence and Standup views** on the shared set.
9. **Migrate `components/ui`** (hex-based) and the older views to the shared
   set, so the whole app follows the tokens rule.

## Merge notes

Merging the four branches into `main` conflicted in the same places each time
- the lists every module appends to: `main.ts` (imports, settings paths, host
start functions, dispose calls, navigation targets, action routing),
`preload.ts`, the bridge fallback, `moduleMeta.ts`, `main.tsx` (imports, the
`DexNestBridge` extends list, routes), `tsconfig.node.json`, the root
`package.json` test chain, `action-registry`, `shared-types`
(`DexNestModuleId`), `tsconfig.base.json`, `apps/desktop/package.json` and the
lockfile. All were resolved by keeping both sides. Two things to watch when
these branches really merge:

- An automatic resolution placed the new hosts' start calls inside the
  `second-instance` handler and their dispose calls inside the macOS
  `activate` handler (syntax-valid in one case, a real behaviour change in the
  other). They were moved back by hand: starts after
  `startDevIntelligenceHost()`, disposes in `before-quit`. Check this spot in
  any merge.
- Skill Constellation needs Developer Intelligence started first (it reads
  DI's stores), as does GhostOS's DI source.

After the merge: `pnpm typecheck` passes, desktop tests 304 pass, action
registry 26 pass, `pnpm install --frozen-lockfile` is satisfied. No module
code was changed.
