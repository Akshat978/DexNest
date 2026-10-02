# Integration QA: bugs and UI problems found (phase 1), and their status

Branch `cloud/integration`, all five modules merged. Every item below was seen in a captured screenshot, or in a console log captured with it. Paths are under `screenshots/before/`:

- **E** = the real Electron app;
- **S** = the stub renderer (see `README.md`).

**Severity:**
- **High:** broken behaviour, or a rule from `AGENTS.md` broken.
- **Medium:** wrong or misleading on screen, or clearly inconsistent with the rest of the app.
- **Low:** polish.

"Pre-existing" means the problem is the same on `main`, not caused by the merge.

Phase 2 fixes the **functional bugs (F)**. Phase 3 handles **consistency (C)** and phase 4 **polish (P)**.

## Functional bugs (phase 2)

| # | Sev | Where | What happens | Evidence | Likely cause |
|---|---|---|---|---|---|
| F1 | **High** | GhostOS | **Forget never works.** Forget… → Forget shows "Forget in GhostOS requires confirmation." Nothing is forgotten, and the confirmation box stays open. Seen twice, on two fresh seeds. | E `flows/24-ghost-forget-confirm`, `flows/25-ghost-forget-done` | `ghost_os.forget` is a danger-level action, and the main process requires `confirmedDangerous: true`. `GhostOsView.tsx:191` sends only the target. ObjectOS sends the flag (`ObjectOsView.tsx:230`). Forgetting a connection or an observation goes through the same call, so it presumably fails too (not clicked) |
| F2 | **High** (rule) | Tools | **OCR "Device" defaults to `gpu`.** `AGENTS.md`: "GPU must not be used unless explicitly enabled … Never on by default." Pre-existing. | E `electron/tools-*` (Device: gpu), S `stub/tools-*` | `ToolsView.tsx:39,58` `toolsState.ocrDevice ?? "gpu"`; `main.ts` OCR jobs record `device: "gpu"`. Needs a check of what the OCR worker actually does with the setting; Windows only |
| F3 | Medium | Calendar | Console errors on every visit: duplicate React keys (`backup-reminder-<date>`, `journal-daily-<date>`), and **a `<button>` nested inside a `<button>`** (invalid HTML; React warns). Pre-existing. | E `electron/normal-console.json`, `empty-console.json` | Reminder items keyed by a non-unique id; a clickable card wrapping a button |
| F4 | Medium (raised to Medium on review; already Medium) | Ten older views | **A failed load looks like no data.** With every read failing, Calendar ("0 events"), Clipboard, Command, Deck, Drop, News, Settings, Timetable, Tools and Utilities show their normal or empty screens: no error, no retry. They have no loading state either. Pre-existing. | S `stub/{calendar,clipboard,command,deck,drop,news,settings,timetable,tools,utilities}-{error,loading}-*` | These views render the shell's state with fallbacks and never surface its load errors |
| F5 | Medium | Skill Constellation | **Stars and labels overlap on real data** (13 skills): "Docker" sits on "Vite", and "Next.js" on "React". Both are unreadable at both sizes. | E `electron/skills-normal-*`, `flows/42-skills-graph`, `43-skills-star-detail` | The layout places stars of strongly linked skills almost on top of each other; nothing separates them |
| F6 | Low | Projects | Console error on every render of a project's detail: duplicate React key in "Where you left off" (`event · 2026-10-02` appears twice). Logged 32 times in one session. | E `flows/flows.json` (step 05 onwards) | Evidence rows keyed by their text |
| F7 | Low | Demo data (`demo.seed`) | After seeding, Finance shows CA$0.00 everywhere. The seed adds its transactions to a new "Personal Finance" demo profile, but leaves the existing default profile active. Pre-existing. | E `electron/finance-normal-*` | `seedDemoData` keeps `profilesFile.activeProfileId` when the existing profile is kept |
| F8 | Low | Command | Quick actions and pins say **"Open Dev Dashboard"**; the view has been "Projects" since the Projects module. | E `electron/command-*` | The title of the `dev.open_dashboard` registry action |
| F9 | Low | ObjectOS | The status line ("Object saved.") never clears. It stays through the next twelve screens, including after deleting a different object. | E `flows/28` … `flows/39` | The notice isn't reset on navigation or on the next action |
| F10 | Low | ObjectOS | Wording with zero counts: "Its 0 components will be kept"; "Object deleted with 0 files; 0 components kept." | E `flows/40-object-delete-confirm`, `41-object-deleted` | No zero or singular case in the copy |
| F11 | Low | ObjectOS | A usage-based overdue item has no unit: "Replace nozzle: Overdue by 2" (2 print hours). The same text appears in Needs attention. | E `flows/30-object-tab-maintenance`, `electron/object-normal-*` | The due label leaves out the measurement key |
| F12 | Low | Reality RPG | After "Apply to past activity" a rule says **"Counts from 1970-01-01"**. | E `flows/52-rpg-rules` | Backfill sets `effectiveFrom` to the epoch; the view prints it as a date |
| F13 | Low | External Devices | On a fresh install a provider that is simply **off** is shown as an error: a red "Govee provider is disabled." banner and an "Error" chip. Pre-existing. | E `electron/devices-*` | The disabled state is mapped to the error tone |

Not bugs (harness artefacts): Autopilot's error boundary in the stub (the stub bridge lacks `autopilotMorningBrief`; the real app renders it); the Audit stub shots (left out).

## Phase 2 status (functional bugs)

Every item below is fixed with a test that fails without the fix (each fix was mutation-checked: reverting it makes its test fail). One commit per module. "After" screenshots of the screens that changed are in `screenshots/after/`; unchanged screens were not re-committed.

| # | Status | Commit | Fix | After evidence |
|---|---|---|---|---|
| F1 | Fixed | `53e78c6` | GhostOS sends `confirmedDangerous` with Forget. "Turn off" (Developer Intelligence source) now asks first, in an inline confirm box, then sends the flag. A test scans the four new views for any confirmation-required action sent without it. | E `after/electron/flows/25-ghost-forget-done` ("Forgotten, with 3 dependent records."), `26`–`28` |
| F2 | Fixed | `d05c966` | The OCR device defaults to **CPU**. Only the default changed: a saved `"gpu"` stays `"gpu"`. Tested both ways (no saved setting → cpu; saved gpu → gpu). Changing OCR settings no longer writes `gpu`. | E `after/electron/tools-*` (Device: cpu) |
| F3 | Fixed | `73fb8bc` | Reminders are de-duplicated by id; the Upcoming row is a keyboard-operable `div role="button"`, so no button sits inside a button. A test parses every renderer `.tsx` and fails on a nested button. | E console: 0 errors (4 before, all Calendar) |
| F4 | Fixed | `496115b` | The ten shell-data views show the shared "Could not load" card with Retry when the shell's load fails. No loading state was added: these views still show their normal screen while the shared load runs (a fast local read); the error case was the bug. | S `after/stub/*-error-*` (`command-loading-*` and `tools-loading-*` changed only through F8 and F2) |
| F5 | Fixed | `7f92fac` | Layout keeps stars at least 56 px apart: a colliding star steps outward, then sideways within its sector. Only a star that would land on another moves. | E `after/electron/skills-normal-*`, `flows/45`–`47` |
| F6 | Fixed | `dd5b64d` | Evidence rows keyed by position and text. | E console: 0 errors in flows |
| F7 | Fixed | `3a37110` | After `demo.seed`, the demo profile becomes active unless the current profile holds the user's own transactions or recurring entries. | E `after/electron/finance-normal-*` |
| F8 | Fixed | `f3510b0` | The action reads "Open Projects". The id `dev.open_dashboard` is unchanged, so pins and Stream Deck buttons keep working. | E `after/electron/command-*` |
| F9 | Fixed | `45e590a` | The ObjectOS notice clears on opening another object or tab. | E `after/electron/flows/29`–`44` |
| F10 | Fixed | `45e590a` | Zero and singular cases in the delete question and result. | E `after/electron/flows/43-object-delete-confirm`, `44-object-deleted` |
| F11 | Fixed | `45e590a` | Usage due labels include the unit ("Overdue by 2 print hours"). | E `after/electron/object-normal-*`, `flows/33-object-tab-maintenance` |
| F12 | Fixed | `475e378` | A rule applied to past activity says "Counts all past activity". | E `after/electron/flows/55-rpg-rules` |
| F13 | Fixed | `9e15d48` | A provider that is off shows a neutral "Off" chip and a muted note; red is kept for real problems. | E `after/electron/devices-*` |
| F14 | **New**, fixed | `496115b` | Found while fixing F4: if a boot warm-up read rejected, the splash never went away. Boot now always finishes. | S (error mode boots) |
| F15 | **New**, fixed | `7824400` | Found while capturing: turning a GhostOS source off said "Removed 0 entrys". Plurals and zero counts fixed in GhostOS messages. | E `after/electron/flows/28-ghost-sources-off-done` |

Flow step numbers moved by three after step 25 (three GhostOS source steps were added), so `before/flows/28` is `after/flows/31`, and so on.

### Notes for the owner

- **Vault OCR is GPU-only by design.** Its own UI says "PaddleOCR GPU only", and it was left as it is. F2 covers the Tools OCR setting only. Whether Vault OCR should get a CPU path is a decision, not a bug fix. **Needs Windows check:** what the OCR worker does with `cpu` on a real machine.
- **A saved `"gpu"` is kept.** Anyone who already has `ocrDevice: "gpu"` in their settings keeps it; only new or unset installs get CPU. Earlier builds wrote `gpu` when OCR settings were changed, so some existing installs will still have it.
- **Skill Constellation:** a stored layout is only re-spaced at the next rebuild of the constellation.
- **Autopilot (for local review, not changed):** nothing broken in the real app. The stub bridge lacks `autopilotQueue`, `autopilotPushSettings` and `autopilotMorningBrief`, so Autopilot shows its error boundary in the stub. Preview only.
- **Left for polish (phase 4):** the "Next.js" and "React" labels are no longer on top of each other but still sit close.
- Heatmap and Audit differ between before and after only because of the data captured; they were not changed.

## Phase 3 status (consistency)

**The shared component set is `apps/desktop/src/renderer/components/ui/kit`.** It is the token-only kit Projects already used, moved there and extended (`ab82069`, `17692e7`):
- page header, card, section title;
- button, badge, tabs, segmented control;
- field, text input, select (token-drawn arrow), text area;
- the one loading state, empty state, error state and confirmation dialog;
- inline error, notice and "nothing here" line.

A view sets its module accent once on its root and every kit component inside it follows. `StatusChip` keeps its props but is drawn as the kit badge in token colours. `sharedUi.test.mjs` covers the set: tokens only, accent inheritance, the markup of each state, and no hand-made tablists in views.

Checked in the real app (Electron under xvfb, fresh temp data root):
- empty and seeded runs: 0 console errors;
- flows: 57 of 57 steps passed, 0 console errors;
- stub run (loading and error states): 0 page errors.

These screenshots are not committed; the full "after" set comes in phase 5.

| # | Status | Commits | What changed |
|---|---|---|---|
| C1 | Done, except Autopilot | `b38c2de` `9abe585` `f1630f2` `3151199` `a4a02f3` | GhostOS, ObjectOS, Reality RPG, Skill Constellation, Audit and News have the icon-tile header, kit buttons and kit cards like the other views. Autopilot is unchanged (local review, below). |
| C2 | Done | `a28874c` + the module commits | One error state everywhere: the shell's per-view card (its icon no longer takes the module accent), the view error boundary, the four new modules and Projects. "Try again" everywhere. |
| C3 | Done | `a28874c` + the module commits | One loading state: a label over skeleton blocks. The five spinner views (Backup, External Devices, App Health, Heatmap, Search) now show it too. |
| C4 | Done for first-run states | module commits | First-run empty states are the kit's (GhostOS, ObjectOS, Reality RPG, Skill Constellation, Projects). "Nothing in this list" lines in those modules, Audit and App Health use the kit's note. Older views' in-panel empty boxes are unchanged (below). |
| C5 | Done for confirmations | module commits | Every confirmation in the new modules is the kit's ConfirmDialog: an alert dialog, focus on Cancel, Escape cancels, the question as title and the consequence below. A refused GhostOS forget is reported inside the dialog. |
| C6 | Done, except Autopilot | `64ca93d` + module commits | The new modules use the kit tabs. Utilities, Timetable and Calendar switchers are the kit segmented control; Calendar's was a tablist without tabs. |
| C7 | Done in the new modules | module commits | Kit inputs, selects with a token arrow, and dark-scheme date inputs in GhostOS, ObjectOS and Reality RPG. |
| C8 | Done | `ab82069` `2c985ef` | `StatusChip` is the kit badge with token colours. ObjectOS's due state is a badge. |
| P7 | Done (found here) | `a28874c` | App Health's "No health check has run yet" is a neutral note, not a red error. |

Also fixed while checking the screenshots (`d17a8ed`):
- a double gap under the header in the new modules;
- ObjectOS's due badge laid out as a grid;
- full-width submit buttons in ObjectOS.

The harness now makes the add-project flow's repository itself (`5298524`).

**Behaviour.** Nothing a module does changed. Visible wording changes:
- Audit's title is "Audit" (was "Recent Events");
- the empty-state titles are new ("Nothing in GhostOS yet", "Reality RPG is off" and so on), with the same text below them;
- confirmations are split into a question and its consequence;
- removing an ObjectOS file says "Remove" on its button (it said "Delete").

**Tests.** Where tests pinned exact markup, they were updated to the kit's markup and check the same things. One deviation: Skill Constellation's "no chart" checks now look for the chart's own SVG, since the header icon is an SVG too.

### Left as is, and why

- **Autopilot (for local review).** Its views still use the eyebrow header, filled tab buttons and its own boxes. Left alone per the phase 2 instruction not to touch Autopilot's views beyond a clearly broken thing. Converting them is a mechanical job like the four modules above.
- **The older views' own markup.** Their headers, buttons (`ActionButton`) and form pop-ups are written inline in `main.tsx` with Tailwind classes. They already match the kit's look (the kit was built to match them), so no screen changes. Moving them onto the components is a large edit of `main.tsx` with no visible gain; left for a later pass.
- **Older views' in-panel empty boxes** (for example Clipboard's dashed "No clipboard history matches." box with an icon) are unchanged.
- **Date inputs** show `mm/dd/yyyy` because that is the Linux Chromium locale here. On Windows they follow the system date format. **Needs Windows check.**
- **ObjectOS tabs** still scroll sideways at 1280 (P1, phase 4).

## Phase 4 status (polish)

Each fix has a test (CSS rules in `apps/desktop/test/polish.test.mjs`, the rest beside the module's own tests).

| # | Status | Commit | What changed |
|---|---|---|---|
| P1 | Fixed | `064e3d6` `2a701f1` | ObjectOS's nine detail tabs wrap onto a second row instead of scrolling sideways with cut-off labels. The kit tabs have a `wrap` option for this. |
| P2 | Fixed | `2a701f1` | A settings version reads as one line ("v2 · 2026-10-02 · 4 values · less stringing") beside its buttons. |
| P3 | Fixed | `a013be3` | Secure Vault's setup panel stays inside its card at 1280: panels have one column that may shrink, and technical text (the vault path) wraps. |
| P4 | Fixed | `2a701f1` `52bcd37` | With nothing chosen, the empty detail column in GhostOS and ObjectOS shows its hint in a framed note instead of a lone line far to the right. |
| P5 | Fixed in phase 3 | `9abe585` `f1630f2` | Reality RPG's and Skill Constellation's intro panels are the kit empty state, with no empty band above the text. |
| P6 | Fixed | `0143830` | Audit's action ids wrap after "." and "_", not mid-word. The table was also wider than the content area at 1280 (the page scrolled sideways and Refresh was cut off); its columns now fit. Autopilot's rows share the class and are unchanged. |
| P7 | Fixed in phase 3 | `a28874c` | See phase 3. |
| P8 | Fixed | `e4037d6` | Utilities' date-calculator fields keep a modest width at 1920. |
| P9 | Fixed | `7114285` | The Projects header says "latest fetch 2 minutes ago", and adds "1 never fetched" when repositories with a remote were never fetched. |
| P10 | Fixed | `cc9928c` | "Where you left off" lists "Working tree scanned", "Commit abcdef1", "Uncommitted changes" and so on, instead of raw kinds. A commit shows its short sha, never its subject. |
| From phase 2 | Fixed | `b26b0f2` | Skill Constellation: a label that would overlap a neighbour's goes above its star, so "Next.js" and "React" no longer write over each other. |

## Consistency (phase 3: one shared component set)

| # | Sev | What | Evidence |
|---|---|---|---|
| C1 | **High** | **Two visual generations side by side.** Most views use an icon-tile header with a 24 px title and subtitle, glass cards and tinted buttons (Clipboard, Finance, Tools, Projects…). Autopilot, Skill Constellation, Reality RPG, GhostOS, ObjectOS, News and Audit use an eyebrow line, a smaller title, a rule, and plain bordered buttons and boxes. Still open from the UI audit (X2). | E `electron/*-normal-1280x800` (compare `clipboard`, `dev` with `ghost`, `object`, `rpg`, `skills`, `autopilot`, `news`) |
| C2 | Medium | **Five error-state styles:** a centred "Could not load this module" card (older views); Projects' red card with "Try again"; plain red text and a plain button (the four new modules); the view error boundary; and none at all (F4). The older views' card colours its warning icon with the **module accent**, so it is green for Finance and App Health. | S `stub/*-error-1280x800` |
| C3 | Medium | **Three loading styles:** a skeleton grid (Capture, Finance, Finder, Journal, Vault, Projects); a centred spinner (Backup, External Devices, App Health, Heatmap, Search); a plain "Loading…" box (the four new modules). Plus ten views with none (F4). | S `stub/*-loading-1280x800` |
| C4 | Medium | **Five empty-state layouts:** Projects' dashed card with icon and action; ObjectOS and GhostOS intro panels with two buttons; Reality RPG and Skill Constellation intro text boxes; the older views' icon-and-sentence boxes; Autopilot's plain box. | E `electron/*-empty-1280x800` |
| C5 | Medium | **Four confirmation styles:** Projects' modal (kit `Dialog`); ObjectOS's and Reality RPG's small overlay box; GhostOS's inline box inside the detail panel; the older views' modals. GhostOS also reports a failed forget at the top of the page, far from the box (F1). | E `flows/18`, `24`, `40`, `48`, `53` |
| C6 | Medium | **Several tab styles:** Projects (underline); GhostOS (outlined tab); Reality RPG and ObjectOS (outlined pills); Autopilot (filled buttons); Timetable and Utilities (segmented pills). Still open from the audit (X5). | E `electron/{dev,ghost,rpg,object,autopilot,timetable,utilities}-normal-*`, `flows/05`, `29` |
| C7 | Medium | **Native `select` and date inputs** (`mm/dd/yyyy`) in GhostOS Add, the ObjectOS forms and Purchase, and the Reality RPG quest form, while the older views use styled controls. Audit X10. | E `flows/21-ghost-add-form`, `27-object-add-form`, `36-object-tab-purchase`, `46-rpg-quests` |
| C8 | Low | **Status chips and badges differ:** the older `StatusChip` (hex colours), the Projects kit `Badge`, and ObjectOS/GhostOS plain text tones. | E `electron/*-normal-*` |

## Polish (phase 4)

| # | Sev | What | Evidence |
|---|---|---|---|
| P1 | Medium | **ObjectOS detail tabs overflow at 1280.** Nine tabs scroll sideways with labels cut off ("Measurem…", a stray "ts" at the left) and a scrollbar under the tabs. | E `flows/29` … `37` |
| P2 | Medium | **ObjectOS Settings tab rows fall apart:** "v2", "-", the date and "· 4 values · less stringing" each on their own line, beside Show / Start from this / Delete. | E `flows/33-object-tab-settings` |
| P3 | Medium | **Vault's Secure Vault setup panel overflows its card at 1280.** The password inputs and the file path are cut off at the right edge. Fine at 1920. Pre-existing. | E `electron/vault-{empty,normal}-1280x800` |
| P4 | Low | **At 1920, GhostOS and ObjectOS keep a narrow list column** with a large empty area. The "choose an entry" hint sits alone far to the right. | E `electron/{ghost,object}-normal-1920x1080` |
| P5 | Low | Reality RPG's and Skill Constellation's intro panels have a tall empty band above the text. | E `electron/{rpg,skills}-empty-1280x800` |
| P6 | Low | Audit's table breaks action ids mid-word ("heatmap.log_current_ / app", "skill_constellat / ion"). Pre-existing. | E `electron/audit-*` |
| P7 | Low | App Health's neutral "No health check has run yet" uses the red error style. Pre-existing. | E `electron/health-empty-*` |
| P8 | Low | Utilities' date calculator stretches the "Base date" input across the full width at 1920. Pre-existing. | E `electron/utilities-normal-1920x1080` |
| P9 | Low | Projects: a card says "never fetched" for a repository that has never been fetched, while the page header says "fetched 2 minutes ago" (the latest fetch of any project). Reads as a contradiction. | E `electron/dev-normal-*` |
| P10 | Low | Projects "Where you left off" lists raw evidence kinds ("snapshot · 2026-10-02 · event · 2026-10-02 · event…"), which say little. | E `flows/05-projects-detail-shop` |

Checked and fine: the sidebar active state for every module (both sizes); Projects at both sizes; the Projects wizard, operation dialog (preview → push → result), archive and remove; ObjectOS add, edit and delete; Reality RPG quest create and abandon, and rule delete; the Skill Constellation star detail and settings; GhostOS add. No page errors in any stub capture. Fonts are the bundled Inter and JetBrains Mono everywhere (Linux rendering).

## Counts

- **13 functional:** 2 High, 3 Medium, 8 Low. All fixed in phase 2, plus two found during it (F14, F15).
- **8 consistency:** 1 High, 6 Medium, 1 Low. Done in phase 3, Autopilot apart (see its status).
- **10 polish:** 3 Medium, 7 Low. All fixed in phases 3 and 4.

Of these 31 items, 9 are pre-existing on `main`.
