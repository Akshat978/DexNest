# ObjectOS - handoff

Module id `object_os` · tables `obj_*` · events `object.*` on stream `object` ·
view `object` · package `@dexnest/object-os` · branch `cloud/object-os`.

Built in a Linux container. **Nothing here has been run on Windows, and the
Electron app itself was never launched.** Everything Windows-specific is
under "Needs Windows check" and is unverified.

Design and every decision: `PLAN.md` (section 14 records your answers - "go
with your defaults"; the "Refinements made in Phase N" notes record what
changed along the way). Linux test baseline: `LINUX_BASELINE.md`.

---

## What it does

One record for each physical thing you own - a printer, a computer, an
appliance, a tool, a vehicle - with everything about it:

- **Identity**: a short id made for a label (`7K3F-9QXM`, 8 Crockford base32
  characters, forgiving when typed), name, category (the fixed six), make,
  model, serial, location, status (active, stored, broken, lent out, sold,
  disposed), tags, notes, photo.
- **Components**: an object can be part of another, up to 32 levels.
  Moving, retiring or deleting a parent never deletes its components (they
  are detached); each part keeps its own history. Sold and disposed objects
  keep everything.
- **Records**: current state (key/value, each change kept); maintenance
  schedules by time or by a usage counter, with due / due soon (14 days, or
  10% of a usage interval) / overdue computed from the last completion;
  a maintenance log (who, cost, parts used - taken from stock in the same
  transaction, notes, counter reading); modifications (reversible or not,
  marked reverted); versioned settings snapshots with a diff; parts (part
  number, supplier, stock, restock level, which objects they fit; every
  stock change logged, never below zero); typed measurements with history
  (a key keeps one unit); purchase and warranty (date, price with its
  currency, shop, warranty end, receipt).
- **Files**: copied - never referenced - into
  `files/objects/<object id>/` in DexNest's data root, with name, size, type
  (by extension) and SHA-256. Up to 200 MB each. Never parsed or run:
  "open" hands a file to the system's default app; anything that could run
  a program is shown in its folder instead. Deleting an object deletes its
  files.
- **History**: one timeline per object, newest first, paged.
- **Needs attention**: overdue and due-soon maintenance, warranties ending
  within 30 days (or ended in the last 30), parts at or below their restock
  level - computed on demand. Optional daily reminders, **off by default**:
  one light job through the host scheduler, a quiet notification with counts
  only.
- **Export and import**: one object (with its components, all the way down)
  or everything, as a zip of `object-os.json` plus the files, written where
  you choose; import merges (objects already here are skipped and reported).
- **For later modules**: `createObjectReadApi(store)` gives GhostOS,
  RoomCompiler and Reality RPG ids, names, category, make, model, location,
  status, tags and attention - never serials, notes, prices, photos or
  files. It is exported but not wired to anything yet (none of those
  modules is on this branch).

Privacy: everything stays local; nothing is phone- or Stream Deck-exposed.
ObjectOS never reads Finance, Vault or any other module's data: a file can
be attached only from outside DexNest's data root (by its written path and
by where it really leads, links and junctions followed), and a receipt is
only a file you attach. Event-log entries and audit lines carry ids, types
and counts, never your text, serials or prices. No network, no LLM, no
telemetry, no new dependencies.

## What was built

### Branch setup
- `7abbc84` - cherry-pick of `e6577c2` (foundation test guard recognises a
  Windows-spelled data root on POSIX).

### `@dexnest/shared-types`, `@dexnest/action-registry` (separate commit `ef61a33`)
- `"object_os"` added to `DexNestModuleId`.
- 22 actions: `object_os.open` (-> `desktop.view.object`) and
  `.object.save`, `.object.set_status`, `.object.move`, `.object.delete`,
  `.state.set`, `.schedule.save`, `.maintenance.log`, `.modification.save`,
  `.settings.save`, `.part.save`, `.part.adjust_stock`, `.measurement.add`,
  `.purchase.save`, `.file.attach`, `.file.open`, `.file.remove`,
  `.record.delete`, `.reminders.enable`, `.reminders.disable`, `.export`,
  `.import`. **`object.delete`, `file.remove` and `record.delete` are
  `caution` with a confirmation rule**; the rest are `safe`. Triggers are
  `module_ui`, plus `command` for open, reminders on/off and export. None
  opts in to the phone.

### `@dexnest/object-os` (new, `packages/object-os`)

Depends on `@dexnest/foundation` only (a test enforces it).

| Folder | What | I/O |
|---|---|---|
| `domain/` | Types; short ids and record ids; timestamps, calendar dates, interval arithmetic (month ends, leap days); money in minor units per currency; **validation** of every input (no future dates for work done, no `__proto__` settings keys, stock never negative); **due/overdue** for time and usage schedules; warranty and low stock; **attention** (grouped, linear in the number of rows); settings diff; cycle and depth check for components; file rules (sanitised names, types by extension, the executable list, the 200 MB limit, the refusal reasons); the **export format** and all-or-nothing import parsing (every reference inside the file, stored names that match their ids, no loops or chains deeper than 32); events and their typed payloads; fixed audit summaries; counts-only reminder text; the read-API field list; timeline items. | none (static test) |
| `store/` | 18 tables via `runModuleMigrations` (migration 1 `core`), plus `obj_pending_files` (migration 2, Phase 7). Foreign keys, no cascade from a parent to its children. Objects and components, state and its log, schedules, maintenance (with parts from stock in the same transaction), modifications, settings versions (a new version only when values change), parts with fits and a stock log, measurements, purchase, files, runs (`UNIQUE (occurrence_id)`), settings. Timeline as one `UNION` query. Export rows; import as one merging transaction. | shared `SqlDatabase` |
| `files/` | `ObjectFilePort` and `ImportArchive`: the whole contract with the host. The package never touches the file system. | - |
| `engine/` | Attach (inspect -> refuse -> copy -> record; a failure removes the copy), open decisions (executables shown in their folder), remove, delete object (rows, then the folder), reminders (claimed per occurrence), export bundles (missing bytes left out and reported, their rows too), import (one at a time; sizes checked, files copied with hash checks, rows in one transaction, copies removed on failure). **Pending markers** around every copy and delete of bytes, and `recoverPending()` at start. | via the port |
| `module/` | Runtime: validated entry points for every action; `object.*` events in the same transaction as the change; one audit line each with a fixed summary and ids/counts only (a failed audit line never fails a committed change); reads for the view; the reminders job, scheduled only while reminders are on; run and pending-file recovery on start. | via ports |
| `manifest.ts` | `OBJECT_OS_MANIFEST`, `OBJECT_ACTION_IDS`; `validateManifest` returns no problems. | - |

### `apps/desktop`
- `src/main/objectOsHost.ts`: wiring; eight IPC reads (`status`, `list`,
  `detail`, `timeline`, `attention`, `settings-diff`, `locations`, `photo`)
  refused unless from the main window's main frame; `runObjectOsAction` maps
  each action to the module and **refuses anything not from DexNest's own
  window** (the Stream Deck endpoint runs any registered action and can
  listen on the LAN); attach, export and import always ask with a file
  dialog - paths in params are ignored; journal lines are fixed text (a
  refusal's reason, which can quote your text, goes to the window only).
- `src/main/objectOsFiles.ts`: the real file port. Data boundary
  (`createDataBoundary` with `realpathSync.native`) checked when a source is
  inspected and again right before it is opened; streamed copies with a size
  cap and SHA-256, a temporary name and a rename; nothing written if
  `files/objects` or an object's folder resolves anywhere else; stored files
  handed out only if they still resolve inside their folder; a folder that
  has become a link is unlinked, never followed.
- `src/main/objectOsZip.ts`: zips written and read **without holding them in
  memory** (stored entries streamed from disk, CRC-32 patched in; reading
  with hard caps - no ZIP64, no encryption, no multi-part, no duplicate
  names, stored or deflate only; every entry checked against its declared
  size and CRC and the export's SHA-256). Entry names are never used as
  paths.
- `src/main/main.ts`: starts the host after Developer Intelligence, routes
  and journals every `object_os.*` action, opens the `object` view, disposes
  on quit. `src/main/preload.ts`: eight `objectOs*` bridge methods.
- `src/renderer/views/ObjectOsView.tsx` (+ `ObjectOs.css`,
  `objectOsModel.ts`): the view. List column: needs attention, search,
  category / status / location filters, the objects (a note when the list is
  cut at 500), daily reminders on/off. Detail: header (edit, status, export,
  delete) and nine tabs - Overview (photo, facts, components, current
  state), Maintenance (schedules with due state, pause, log form, log),
  Parts (stock, change stock, add), Modifications (mark reverted), Settings
  (versions, show, start from, compare), Measurements (grouped by key),
  Files (attach by role, open, remove), Purchase (warranty, price, receipt),
  History. Add/edit form; loading, empty and error states; confirmations
  before deleting (Cancel focused, Escape cancels). "ObjectOS" in the
  sidebar after Autopilot (icon `Package`, accent `--accent-tools`). The
  renderer imports only types from the package.

## Definition of done

| Requirement | Proven by |
|---|---|
| Manifest exported; `validateManifest` returns no problems | `store.test.ts` › the manifest validates |
| Migrations through `runModuleMigrations`; close/reopen keeps everything | `store.test.ts` › everything survives closing and reopening (both migrations in the ledger, nothing applied twice) |
| Every user-meaningful action registered and writes to the event log | `module.test.ts` › each user action records its object event and one audit line; registration tests; desktop `objectOsHost.test.ts` › every object_os action but open has a handler; `main.ts` journals each through `logActionEvent` |
| Scheduled work idempotent (fired twice, one result) | `module.test.ts` › a slot delivered twice runs once: one event, one notification, counts only; `engine.test.ts` › when on, a slot delivered twice runs once; `hardening.test.ts` › one reminder slot delivered five times at once |
| Bait-files data boundary test | `bait.test.ts` › nothing inside the data root can be attached - directly, through a link, or through a linked folder (receipts, vault, another object's folder); host › bait: sources inside DexNest's data are refused, directly and through links; a source swapped for a link between inspecting and copying |
| Static no-network/LLM test (EC-036) | `static-safety.test.ts` › EC-036: no LLM, network or cloud client (also: the domain imports only the domain; no fs, process, OS, worker or Electron access; foundation is the only runtime dependency) |
| No hex/rgb in components | desktop `objectOsView.test.mjs` › design tokens only |
| Off by default | `module.test.ts` › are off by default: starting schedules nothing; `engine.test.ts` › are off by default: nothing is claimed or computed; host › no timer exists until reminders are turned on |
| Event log carries ids, types and counts, never your notes | `module.test.ts` › a marker in every text field appears nowhere in object or audit events (and no prices); host › messages and journal lines never carry the owner's text |
| Files copied into the data root, hashed, size-limited, never run | `engine.test.ts` › attaching…; refuses … over the limit; opens a stored file; an executable is only shown in its folder; host › attach copies the owner-picked file…; open hands the stored file to the system… |
| Components survive their parent | `store.test.ts` › deleting an object … detaches its components - never deletes them |
| Export and import back | `store.test.ts` › round-trips everything into an empty ObjectOS; host › export writes a zip any tool reads; import into an empty DexNest restores rows and identical files |

## Final test counts (Linux)

| Package | Before (Phase 0) | After |
|---|---|---|
| foundation | 47 pass, 2 skipped | 47 pass, 2 skipped |
| dev-intelligence-store | 10 | 10 |
| dev-intelligence | 85 pass, 2 fail, 1 skipped | 85 pass, 2 fail, 1 skipped |
| standup | 25 | 25 |
| **object-os** | - | **142** |
| today | 13 | 13 |
| action-registry | 26 | 26 |
| desktop | 165 | 220 |
| autopilot-runtime | 668 pass, 17 fail, 4 skipped | 668 pass, 17 fail, 4 skipped (same 17 by name) |

Passing tests across the workspace: **1039 -> 1236**. Every failure is a
pre-existing Linux-only failure listed by name in `LINUX_BASELINE.md`; no
phase introduced a new one. `pnpm typecheck` passes, including the new
desktop test files (added to `tsconfig.node.json`). No skipped or `.only`
tests were added.

object-os by phase: 60 (1) -> 83 (2) -> 102 (3) -> 113 (4) -> 142 (7).
Desktop: 165 -> 184 (5) -> 217 (6) -> 220 (7).

`pnpm test` on Linux stops at dev-intelligence's two known failures (the root
script chains packages with `&&`), so every gate ran each package separately.

## Mutation checks

Each was applied, shown failing, and reverted with the suite green again.

| Phase | Broke | Caught by |
|---|---|---|
| 1 | Due computed from the schedule's start instead of the last completion | maintenance › after a completion, count from the last one - not from the start |
| 2 | Deleting a parent cascades to its children | store › deleting an object … detaches its components - never deletes them |
| 3 | A source inside the data root let through | bait › nothing inside the data root can be attached… |
| 4 | Maintenance notes put into an event payload | module › a marker in every text field appears nowhere in object or audit events |
| 4 | Each reminder delivery gets its own occurrence (no idempotency) | module › a slot delivered twice runs once; engine › when on, a slot delivered twice runs once |
| 5 | The link/realpath re-check removed from opening a stored file | host › a stored file replaced by a link, or a folder replaced by one, is never opened |
| 5 | The copy-time boundary re-check removed | host › a source swapped for a link between inspecting and copying is refused at copy time |
| 6 | A serial number shown in the attention list | view › privacy: the attention list and the object list never show a serial number |
| 7 | Moving an object without the cycle check | store › refuses a component inside itself…; hardening › a chain can be 32 levels deep and no deeper; moving never makes a loop |

Also checked in Phase 5: the old `.pipe()` zip reader (errors not passed on)
fails the broken-deflate test instead of hanging silently; in Phase 7: a
price put into an event payload is still caught after the flaky test fix.

## Known gaps and what is untested

- **The Electron app was never launched.** Host, IPC, preload and actions
  are tested with stand-ins that behave like Electron's where the host
  relies on them; dialogs and the shell are stand-ins.
- **No live-DOM tests.** The view is rendered to markup (Vite SSR +
  `react-dom/server`) and its logic tested in the model; real focus
  movement, focus rings and screen-reader output are not.
- **The read API is not wired.** `createObjectReadApi` exists and is tested;
  no other module uses it yet, and the host does not expose it.
- **The list shows 500 objects at a time.** Beyond that, search or filter
  (the view says so). There is no paging control.
- **Parts are edited only for stock** in the view. Name, number, supplier,
  restock level and which objects a part fits are set when it is added
  (from the object it is added on); the action accepts all of them, the
  view does not offer the edit yet.
- **"Move" is part of edit.** `object_os.object.move` is registered and
  handled, but the view changes a parent through the edit form.
- **An orphan file inside a live object's folder** can only come from a
  crash at one exact moment and is removed at the next start (pending
  markers). Bytes placed there by anything else are ignored - never listed,
  never opened - and removed when the object is deleted.
- **No retention.** The reminders job adds one run row and one
  `object.reminder_checked` event a day while on; nothing prunes them.
- **One export is at most about 4 GB and 60,000 files** (no ZIP64); larger
  sets are exported a part at a time.
- **Photos** are shown inline only for png, jpg, gif and webp up to 8 MB;
  others (and SVG) are listed as files.
- **Money is never converted**: prices keep the currency they were paid in.
- **Measurements** of a key keep the first unit recorded; converting units
  is not supported.
- **Scale** was measured, not memory: 5,000 objects, 10,000 schedules and
  100,000 readings - needs attention about 1 s with every object needing
  attention; list, search, filter, detail, history and status well under a
  second (Linux container, node:sqlite).
- **Two audit lines per user action** (the action's journal line and the
  module's own), as other modules do today.
- **Pre-existing, not this module's:** dev-intelligence (2) and
  autopilot-runtime (17) fail on Linux.

## Needs Windows check

Paths, files and the boundary
- Attach refused inside `D:\DeskNest\local-data` and the live data root,
  **including through a junction** (tested on Linux with symlinks), and with
  Windows path spellings (drive letters, UNC, mixed case).
- `realpathSync.native` resolving junctions for the source, the object's
  folder and the stored file; `lstat` reporting a junction as a link (so
  deleting an object whose folder became a junction removes the junction,
  not its target); case-insensitive comparisons.
- Real file dialogs (attach, export, import); `shell.openPath` with the
  default app; `shell.showItemInFolder` for executables; a 200 MB copy.
- Start-up recovery of pending files and folders on NTFS.

Electron
- The IPC trusted-frame check against a real `BrowserWindow`; the preload
  bridge under context isolation.
- `object_os.*` actions from the view and the Command palette; the
  confirmations for delete, remove file and delete record; `object_os.open`
  landing on the view; a Stream Deck request for an ObjectOS action being
  refused.
- The reminder notification (silent, counts only); no timer while reminders
  are off; one light daily job when on.

The view and fonts
- Inter and JetBrains Mono actually loaded; date inputs; tab arrow keys;
  visible focus rings; Narrator reading tabs, forms, the attention list and
  the delete confirmation.
- Timings on Windows at the scale above.

## Changes from the plan, and why

- **Short ids** are 8 Crockford base32 characters shown as `7K3F-9QXM`
  (Q1), parsed forgivingly (lower case, dashes, I/L as 1, O as 0).
- **Expired warranties drop off after 30 days** (Phase 1): the plan listed
  "ending within 30 days, or expired"; a warranty that ended long ago is
  history, not something to act on, so only ones that ended in the last 30
  days stay in needs attention.
- **Settings get a new version only when the values change** (Phase 2), and
  `object.settings_saved` is written only then (Phase 4).
- **Parts used by maintenance leave stock in the same transaction** and write
  `object.stock_changed` events (Phases 2 and 4); quantity edits go through
  the stock log.
- **"Check now"** runs reminders even when they are off (Phase 4); it is not
  exposed in the view (the attention list is always current).
- **ObjectOS checks where an action comes from** (Phase 5): only DexNest's
  own window. Not in the plan; found while wiring the host -
  `runRegisteredAction` does not enforce `allowedTriggers`, and the Stream
  Deck endpoint runs any registered action.
- **Zips are read and written by ObjectOS's own streaming code** (Phase 5),
  not `adm-zip`, which holds whole archives in memory. Zips written by other
  tools, compressed ones included, import.
- **Journal lines are fixed text** (Phase 5): refusal reasons can quote your
  text and go to the window only.
- **Pending-file markers (migration 2)**, **one import at a time**, events
  for files inside their transaction, **import refuses loops and over-deep
  chains**, and **attention grouped per schedule** (Phase 7) - all found by
  the hardening tests.
- **Dates picked in forms** (Phase 6): today is sent as the current time, an
  earlier day as noon UTC.
