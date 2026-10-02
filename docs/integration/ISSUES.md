# Integration QA: bugs and UI problems found (phase 1, "before")

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
| F4 | Medium | Ten older views | **A failed load looks like no data.** With every read failing, Calendar ("0 events"), Clipboard, Command, Deck, Drop, News, Settings, Timetable, Tools and Utilities show their normal or empty screens: no error, no retry. They have no loading state either. Pre-existing. | S `stub/{calendar,clipboard,command,deck,drop,news,settings,timetable,tools,utilities}-{error,loading}-*` | These views render the shell's state with fallbacks and never surface its load errors |
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

- **13 functional:** 2 High, 3 Medium, 8 Low.
- **8 consistency:** 1 High, 6 Medium, 1 Low.
- **10 polish:** 3 Medium, 7 Low.

Of these 31 items, 9 are pre-existing on `main`.
