# ObjectOS - plan

Module id `object_os` · table prefix `obj_` · event namespace `object.` ·
event stream `object` · view id `object` · package `@dexnest/object-os` ·
branch `cloud/object-os`.

Status: **Phase 2 (store) done.** Domain and store exist; nothing is wired into the app yet. Read with `AGENTS.md` and
`docs/DEXNEST_FOUNDATION_ARCHITECTURE.md`. Shaped after Developer
Intelligence's runtime/host split and the modules built before it on other
branches (Skill Constellation, Reality RPG, GhostOS).

---

## 1. What it is

A persistent digital identity for each physical thing the owner has - the 3D
printer, the PC, appliances, tools, later a car - holding everything about it
for as long as the object exists: what it is, what it's made of, its current
state, maintenance (scheduled and done), modifications, settings snapshots,
spare parts, measurements, purchase and warranty, attached files, and one
timeline of all of it.

## 2. Scope (this build)

- Objects with a stable short id, the fields in the brief, and components
  (objects inside objects).
- Current state (key/value with last-updated time, and its change history).
- Maintenance schedules (by time or by a usage counter) with due/overdue
  computed from the last completion; a maintenance log.
- Modifications, versioned settings snapshots with a diff, parts and stock,
  typed measurements with history, purchase and warranty.
- Attached files copied into the data root through the host, recorded with
  name, size, type and SHA-256; opened through a registered action.
- One history timeline per object.
- "Needs attention" computed on demand; optional daily reminders through the
  host scheduler, off by default.
- Export one object or all as a zip (JSON + files) and import it back.
- A read-only API for later modules (GhostOS, RoomCompiler, Reality RPG).
- Registered actions, `object.*` events (ids, types, counts only), a host
  file, IPC, preload, and the view described in the brief.

## 3. Out of scope

- Hardware integrations (OctoPrint, OBD, smart plugs), shopping or price
  tracking, OCR or search inside manuals or any file, phone access, QR
  label printing (ids are designed for it), automatic detection.
- Reading any other module's data. A receipt is only a file the owner
  attaches here.
- Currency conversion (prices keep their own currency).
- Building the GhostOS / RoomCompiler / Reality RPG integrations (only the
  read API they would use).

## 4. Where the code lives

One package, layered by folder, with static tests enforcing the layers (as in
the previous modules):

| Path | Contents | I/O |
|---|---|---|
| `packages/object-os/src/domain/` | Types; short ids; validation of every input; due/overdue computation (time and usage); warranty and stock checks; settings diff; timeline assembly; file-name sanitising and type-by-extension; the export format; events; settings. | none |
| `packages/object-os/src/store/` | Migrations; persistence; timeline queries; the read API; export/import of rows in one transaction. | DB |
| `packages/object-os/src/files/` | The file port contract (what the host must provide) and the rules around it: target paths, size cap, the "may this be attached" check. | through an injected port |
| `packages/object-os/src/module/` | Runtime: every action's entry point, events, reminders job, attention summary, manifest. | via ports |
| `apps/desktop/src/main/objectOsHost.ts` | Wiring, data boundary, the file port (copy in, hash, delete, open, zip export/import), IPC, dialogs, notifications. | Electron, fs |
| `apps/desktop/src/renderer/views/ObjectOsView.tsx` (+ css, model) | The view. | renderer |
| `packages/action-registry`, `packages/shared-types` | Action definitions and module id (separate commit, as before). | - |

Dependencies: `@dexnest/foundation` only. The package never touches the
file system: copying, hashing, deleting, zipping and opening are the host's,
behind a port, so the rules are testable and the package stays Electron- and
fs-free (static test).

## 5. What ObjectOS may read - and nothing else

| Source | Exactly what | How |
|---|---|---|
| The owner | What they type into ObjectOS forms | View -> registered actions |
| A file the owner picks to attach | Its bytes, once, to copy it and compute its SHA-256 while copying. Never parsed, never executed. | Host file dialog -> boundary check -> size check -> streamed copy |
| Its own files folder `files/objects/<object id>/` | To open a file for the owner, to verify it, and to put it in an export | Host, with a realpath check that it is still inside that folder |
| An import zip the owner picks | The manifest JSON and the files it lists | Host file dialog -> size caps -> validation |
| Its own `obj_*` tables | Everything | `SqlDatabase` |

**Never read:** Finance (including `files/receipts/`), Vault, Journal,
Clipboard, Captures, Drop, Tools, Search index, OCR output, any other
module's tables, events or folders.

**Attaching a file** is refused when the source path, written or resolved
(junctions, symlinks), is inside DexNest's data root - that covers every
other module's folder, and ObjectOS's own (re-attaching a copy is never
needed). Attachments are always copies under `files/objects/<id>/`;
ObjectOS never records a reference to a path outside it.

## 6. Data model

### Ids

Objects get a **short id**: 8 characters of Crockford base32 (digits and
letters without I, L, O, U), random, shown as `7K3F-9QXM`, case-insensitive
on input. ~10^12 values; a collision is retried. Short enough for a QR label
later, stable for the object's life. Every other row gets an internal id
(`<kind>_<uuid>`).

### Tables (all via `runModuleMigrations`, prefix `obj_`)

| Table | Holds |
|---|---|
| `obj_objects` | id, name, category, make, model, serial, location, status, notes, parent_id (-> obj_objects, nullable), photo_file_id, created_at, updated_at |
| `obj_tags` | (object_id, tag) |
| `obj_changes` | Field changes that matter for history: status, location, parent (from, to, at) |
| `obj_state` | Current state: (object_id, key) -> value, updated_at |
| `obj_state_log` | Every state change (object_id, key, value, at) |
| `obj_schedules` | Maintenance schedules: title, kind `time` or `usage`; for time an interval (N days/weeks/months/years); for usage a measurement key and an interval in that key's unit; start, active |
| `obj_maintenance` | Log: object, schedule (nullable), done_at, done_by, cost (minor units + currency), notes, usage reading at the time |
| `obj_maintenance_parts` | Parts used by a log entry (part_id, quantity) |
| `obj_modifications` | title, done_at, reason, before, after, reversible, reverted_at |
| `obj_settings` | Snapshots: (object_id, name, version) -> values (JSON key/value), note, created_at |
| `obj_parts` | name, part number, supplier (text), unit, quantity on hand, low-stock threshold, notes |
| `obj_part_fits` | (part_id, object_id) |
| `obj_stock_log` | Stock changes (part, delta, reason: used/restocked/corrected, maintenance id, at) |
| `obj_measurements` | Readings: object, key, value (number), unit, measured_at, note |
| `obj_purchase` | One per object: purchased_on, price (minor units), currency, shop, warranty_until, receipt_file_id |
| `obj_files` | object, role (manual, photo, receipt, model, config, other), display name, stored name, size, type (by extension), sha256, added_at |
| `obj_runs` | Reminder runs, `UNIQUE (occurrence_id)` |
| `obj_state_kv` | Module settings (reminders on/off, windows) |

Money is integer minor units plus an ISO 4217 code; no conversion.

**Components:** `parent_id`. Moving an object records a change; deleting or
retiring a parent never deletes a child - children become top-level
(recorded as a change on each child). Cycles are refused (an object cannot
be inside its own descendant). Each record belongs to the object it
happened to, so a GPU moved to a new PC keeps its history.

**Status** `sold`/`disposed` keeps everything. Only an explicit delete
removes an object: its rows, its files on disk, and its fits; children are
detached, not deleted.

### Computed, never stored

- Due/overdue per schedule: time -> last completion (or start) + interval;
  usage -> latest reading of the key minus the reading at the last
  completion, against the interval. `due soon` window: 14 days for time,
  10% of the interval for usage (Q3).
- Warranty ending: within 30 days (brief), or expired.
- Low stock: quantity <= threshold.
- History: a union over the tables above, newest first, paged.

### For other modules later

`createObjectReadApi(db)` in the package: list and get objects (name,
category, make, model, location, status, parent, tags), components, due
maintenance, and parts below threshold. **It leaves out serial numbers,
prices, shops, notes and files** - other modules get what they need to show
or place an object, not its private details.

## 7. Files

- Attach: the owner picks a file; the host checks the boundary (section 5),
  checks size <= 200 MB before copying (Q4), copies it to
  `files/objects/<object id>/<file id>-<sanitised name>`, computing SHA-256
  while streaming, then records it. A failed copy leaves no row and no file.
- Type is decided from the extension only (a fixed table); contents are
  never parsed.
- Open: a registered action; the host resolves the stored path, checks with
  realpath that it is still inside that object's folder (a junction placed
  there later is refused), and hands it to the system's default app. Files
  with executable extensions (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`,
  `.vbs`, `.js`, `.lnk`, `.scr`, `.com`, `.jar`, ...) are **shown in their
  folder instead of opened** (Q5).
- Remove: deletes the file and its row; if it was the photo or the receipt,
  that reference is cleared.
- Nothing is read from anywhere else, and no path outside the data root is
  ever stored.

## 8. Export and import

- Export one object (with its components, Q6) or all objects: a zip with
  `object-os.json` (rows) and `files/<object id>/<file id>-<name>`, written
  where the owner chooses (save dialog; refused inside the data root).
- Import: the owner picks a zip; size caps (compressed and total
  uncompressed), entry names checked against the manifest (no `..`, no
  absolute paths - zip-slip), each file's SHA-256 verified, JSON validated,
  then rows written in one transaction and files copied in. An object id
  already present is skipped and reported (merge, as GhostOS does; Q7).

## 9. Reminders

- "Needs attention" is computed on demand when the view opens: overdue, due
  soon, warranty ending within 30 days, parts below threshold.
- Optional daily reminder, **off by default**: a light (not heavy) host
  scheduler job, interval 24 h, idempotent per slot (`obj_runs`), which
  computes the same summary and shows one light notification with counts
  only ("2 maintenance tasks due, 1 part low", Q8). No timer of its own; no
  job at all while off.

## 10. Privacy rules in practice

- Serial numbers, prices, shops and receipts live only in `obj_*` tables and
  `files/objects/`; they are not in events, audit lines, notifications or
  the read API.
- Event payloads carry ids, types and counts; audit summaries are fixed
  strings (as in GhostOS).
- Nothing is phone- or Deck-exposed.
- Attach refuses sources inside the data root; open refuses stored files
  that no longer resolve inside the object's folder.

## 11. Events

Stream `object`, module `object_os`, payloads ids / types / counts only:

`object.created`, `object.updated`, `object.moved` (parent changed),
`object.status_changed` (payload: from/to status - values, not text),
`object.deleted`, `object.state_set` (key count), `object.schedule_saved`,
`object.maintenance_logged`, `object.modification_saved`,
`object.settings_saved` (version number), `object.part_saved`,
`object.stock_changed` (delta), `object.measurement_recorded`,
`object.purchase_saved`, `object.file_attached` (role, size),
`object.file_removed`, `object.record_deleted` (kind),
`object.reminder_checked` (counts; idempotency key per slot),
`object.export_created`, `object.import_completed`.

State keys, measurement keys and setting names are owner text, so payloads
carry counts, not keys.

## 12. Actions

`moduleId: "object_os"`; none phone- or Deck-exposed; editing actions
`module_ui` only. `caution` + confirmation for the ones that delete
(`object.delete`, `file.remove`, `record.delete`).

`object_os.open` (-> `desktop.view.object`), `object_os.object.save`,
`object_os.object.set_status`, `object_os.object.move`,
`object_os.object.delete`, `object_os.state.set`,
`object_os.schedule.save`, `object_os.maintenance.log`,
`object_os.modification.save`, `object_os.settings.save`,
`object_os.part.save`, `object_os.part.adjust_stock`,
`object_os.measurement.add`, `object_os.purchase.save`,
`object_os.file.attach`, `object_os.file.open`, `object_os.file.remove`,
`object_os.record.delete`, `object_os.reminders.enable`,
`object_os.reminders.disable`, `object_os.export`, `object_os.import`.

## 13. Risks

| Risk | Mitigation |
|---|---|
| A file from another module is attached (e.g. a Finance receipt) | Boundary check on the source, written and realpath; test with bait under a synthetic data root, including through a symlink/junction |
| A stored file is replaced by a junction later | Open/export re-check with realpath that the file is inside `files/objects/<id>/` |
| Opening executes something | Executable extensions shown in folder, never opened |
| Private details leak into the event log, audit, notifications or other modules | Typed payloads without text fields; fixed audit summaries; counts-only notifications; read API without serial/price/files; marker test over `event_log` |
| Huge or hostile import zip | Size caps, zip-slip checks, hash verification, JSON validation, one transaction; files copied only after rows validate |
| Half-attached file | Copy to a temp name in the object folder, hash, then row + rename in order; cleanup on failure |
| Deleting a parent loses children | Children detached and recorded, never deleted; test |
| Component cycles | Refused on move |
| Usage schedules with no readings | Shown as "no reading yet", never due |
| Reminders waking the machine | Light job, off by default, at most daily, no timer when off |

## 14. Decisions (owner: "go with your defaults")

1. **Short ids:** 8 characters of Crockford base32, shown `7K3F-9QXM`.
2. **Categories:** the brief's six, fixed.
3. **Due soon:** 14 days before a time schedule is due; within 10% of the
   interval for a usage schedule.
4. **File size:** 200 MB per file; no total per object.
5. **Executables:** attachable; "open" shows them in their folder instead of
   running them.
6. **Export of one object** includes its components.
7. **Import:** an object id already present is skipped and reported.
8. **Reminder notification:** counts only.
9. **Deleting an object** deletes its files from disk too.
10. **Accent:** `--accent-tools`. No new tokens.

### Refinements made in Phase 1

- No `cumulative` flag on measurements: a usage schedule names a
  measurement key and counts from the reading at the last completion (the
  reading recorded with it, else the last reading taken at or before it,
  else the latest - as if just done); before any completion, from the
  schedule's start reading, else the first reading ever. No reading at all
  is `no_reading`, never due.
- Due states are `ok`, `due_soon`, `overdue` (from the due moment on),
  `no_reading` and `inactive`.
- A warranty is "ending" from 30 days before its last day through that day;
  an expiry in the last 30 days still needs attention, an older one is
  history. Sold and disposed objects never need attention.
- Maintenance, measurements and modifications refuse dates in the future.
- Settings values are stored as text with sorted keys; `__proto__`,
  `constructor` and `prototype` are refused as keys.
- The export's file entries must have the stored name
  `<file id>-<sanitised name>` exactly, so a zip entry can never point
  outside `files/<object id>/`.
- The read API is a fixed field list (`PUBLIC_OBJECT_FIELDS`) copied field by
  field: no serial, notes, photo or files, even if the record grows.

### Refinements made in Phase 2

- Module settings live in `obj_kv` (the plan said `obj_state_kv`).
- Every stock change goes through `obj_stock_log`, including a part's first
  quantity (`restocked`) and an edit that changes it (`corrected`); a
  maintenance entry's parts are taken (`used`) in the same transaction, and
  not enough stock refuses the whole entry.
- A settings snapshot gets a new version only when its values change.
- Deleting a schedule keeps its maintenance log (unlinked); deleting a
  maintenance entry keeps the stock it used as used; deleting a part removes
  its fits and stock log, and unlinks it from maintenance entries.
- Search matches name, make, model, serial, location, tags and the short id
  as printed (`PRN0-0000`), locally.
- Exporting some objects drops parent links to objects not exported, and a
  part's fits to them. Import keeps a part already here (by id) as it is and
  adds its fits to the new objects; it records parts used by imported
  maintenance but does not take stock again (the file's quantities already
  reflect it).
- The read API is `createObjectReadApi(store)`: list, get, components and
  attention, public fields only.

## 15. Phases for this module

Each phase ends at the gate: `pnpm typecheck`; every package's tests with no
new failures against the Linux baseline (section 16); new tests; a mutation
check; commit and push to `cloud/object-os`; report.

| Phase | Deliverable | Key tests | Planned mutation check |
|---|---|---|---|
| 1 Contracts | `domain/`: types, short ids, validation (objects, state, schedules, logs, modifications, settings, parts, measurements, purchase, files), due/overdue (time + usage), warranty, low stock, settings diff, attention summary, file rules (names, types, executable list, size), export schema, events, settings | Due/overdue at the edges (month ends, leap day, usage with no reading); cycles refused; diff; id alphabet and parsing; static test | Due computed from the schedule start instead of the last completion |
| 2 Store | Migrations, persistence, components and detaching, state log, stock log, timeline union, read API (no private fields), export/import rows in one transaction, manifest | Close/reopen; delete detaches children; read API has no serial/price/notes; import rolls back on a bad row; `validateManifest` = [] | Delete a parent cascading to its children |
| 3 Engine | Attachment rules against the file port, attention summary, reminder run (idempotent per slot), export/import orchestration with the port | **Bait test**: sources under a synthetic data root (receipts, vault, another object's folder, a symlink into it) refused and never recorded; oversized refused before copy; executable never opened; hash mismatch on import refused | Let a source inside the data root through |
| 4 Actions + events | Registry entries (separate commit), runtime entry points, `object.*` events, fixed audit summaries | Reminder slot fired twice -> one result; every action writes the log; a marker in every text field never in `event_log` | Put a note into an event payload |
| 5 Host | `objectOsHost.ts`: boundary, the real file port (copy+hash, delete, realpath re-check, open/show-in-folder, zip export/import), IPC trusted frame, preload, `main.ts` wiring, reminders job | Untrusted frames refused; attach through a symlink into the data root refused; stored file replaced by a link refused on open; zip-slip refused; no timer until reminders are on | Remove the realpath re-check on open |
| 6 View | Object list (search, filters, needs attention), detail with the nine tabs, forms, empty/loading/error, keyboard | Rendered states (Vite SSR + `react-dom/server`); model tests; no hex/rgb | Show a serial number in the attention list |
| 7 Hardening | Faults at every write, restart mid-import, 5k objects / 100k measurements, duplicate triggers, deep component trees, hostile zips, file copy failures | As listed | Break cycle detection on move |
| 8 Handoff | `HANDOFF.md` | - | - |

## 16. Baseline (Linux)

Branch `cloud/object-os` is `origin/main` plus the cherry-picked foundation
test-guard fix (`e6577c2` -> `7abbc84`), the same starting point as the
previous modules. Known Linux-only failures, not this module's: 2 in
`@dexnest/dev-intelligence`, 17 in `@dexnest/autopilot-runtime`. Counts go
in the Phase 0 report; the list by name goes in `LINUX_BASELINE.md` in
Phase 1.
