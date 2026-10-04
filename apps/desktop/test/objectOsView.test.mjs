// ObjectOS view, rendered.
//
// The real ObjectOsView.tsx is bundled with the app's own Vite (SSR build,
// React external) and rendered with react-dom/server, once per state, from
// synthetic data. No Electron, no main process, no data root. Effects do not
// run under server rendering, which lets the `initial` prop pin each state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
let scratch = "";
let View;

before(async () => {
  // Inside the app's node_modules so the bundle resolves the app's React.
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "object-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/views/ObjectOsView.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  ({ ObjectOsView: View } = await import(pathToFileURL(join(scratch, "view.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const never = () => new Promise(() => {});
const bridge = {
  objectOsStatus: never, objectOsList: never, objectOsDetail: never, objectOsTimeline: never,
  objectOsAttention: never, objectOsSettingsDiff: never, objectOsLocations: never, objectOsPhoto: never,
  objectOsFind: never, objectOsWhatIsIn: never, objectOsRecentlyLocated: never, objectOsRooms: never, objectOsWhereabouts: never
};
const onAction = async () => ({ ok: true });
const T = "2026-06-01T09:00:00.000Z";
const SERIAL = "SN-SECRET-4471";

const status = (objects, extra = {}) => ({ remindersEnabled: false, lastReminder: null, lastError: null, objects, ...extra });
const printer = {
  id: "7K3F9QXM", name: "Workshop printer", category: "printer", make: "Prusa", model: "MK4", serial: SERIAL, location: "Workshop", status: "active",
  notes: "Keep the enclosure closed.", tags: ["3d"], parentId: null, photoFileId: "fil_photo0001", createdAt: T, updatedAt: T
};
const hotend = { ...printer, id: "9QXM7K3F", name: "Hotend", category: "other", serial: "SN-HOTEND", parentId: printer.id, photoFileId: null, notes: "" };
const objects = [hotend, printer];
const attention = {
  summary: {
    items: [
      { kind: "maintenance", objectId: printer.id, scheduleId: "sch_nozzle001", status: { state: "overdue", kind: "time", dueAt: T, daysLeft: -4, lastDoneAt: null } },
      { kind: "warranty", objectId: printer.id, state: "ending", daysLeft: 12 },
      { kind: "stock", partId: "prt_nozzle001", quantity: 1, lowStockAt: 2 }
    ],
    counts: { overdue: 1, dueSoon: 0, warrantyEnding: 1, lowStock: 1 }
  },
  names: { [printer.id]: printer.name, sch_nozzle001: "Replace nozzle", prt_nozzle001: "0.4 nozzle" }
};
const schedule = { id: "sch_nozzle001", objectId: printer.id, title: "Replace nozzle", rule: { kind: "usage", measurementKey: "print hours", every: 200 }, startsAt: T, startReading: null, active: true, notes: "", createdAt: T, updatedAt: T };
const snapshots = [
  { id: "set_slicer001", objectId: printer.id, name: "Slicer", version: 1, values: { layer_height: "0.2", infill: "15%" }, note: "", createdAt: T },
  { id: "set_slicer002", objectId: printer.id, name: "Slicer", version: 2, values: { layer_height: "0.15", infill: "15%", ironing: "on" }, note: "finer", createdAt: T }
];
const detail = {
  object: printer,
  parent: null,
  components: [hotend],
  state: [{ objectId: printer.id, key: "firmware", value: "6.1.2", updatedAt: T }],
  schedules: [{ schedule, status: { state: "overdue", kind: "usage", measurementKey: "print hours", dueAtReading: 400, latestReading: 412, left: -12, lastDoneAt: T } }],
  maintenance: [{ id: "mnt_log000001", objectId: printer.id, scheduleId: schedule.id, title: "Replaced nozzle", doneAt: T, doneBy: "me", cost: { amount: 1250, currency: "EUR" }, notes: "", usageReading: 200, parts: [{ partId: "prt_nozzle001", quantity: 1 }], createdAt: T }],
  modifications: [{ id: "mod_enclos001", objectId: printer.id, title: "Added enclosure", doneAt: T, reason: "ABS", before: "open", after: "closed", reversible: true, revertedAt: null, createdAt: T, updatedAt: T }],
  settings: snapshots,
  parts: [{ id: "prt_nozzle001", name: "0.4 nozzle", partNumber: "E3D-04", supplier: "E3D", unit: "pcs", quantity: 1, lowStockAt: 2, notes: "", fits: [printer.id], createdAt: T, updatedAt: T }],
  measurements: [
    { id: "msr_hours0001", objectId: printer.id, key: "print hours", value: 380, unit: "h", measuredAt: "2026-05-01T12:00:00.000Z", note: "", createdAt: T },
    { id: "msr_hours0002", objectId: printer.id, key: "print hours", value: 412, unit: "h", measuredAt: T, note: "", createdAt: T }
  ],
  purchase: { objectId: printer.id, purchasedOn: "2025-06-12", price: { amount: 109900, currency: "EUR" }, shop: "Prusa shop", warrantyUntil: "2026-06-13", receiptFileId: "fil_receip01", updatedAt: T },
  warranty: { state: "ending", daysLeft: 12 },
  files: [
    { id: "fil_photo0001", objectId: printer.id, role: "photo", name: "front.jpg", storedName: "fil_photo0001-front.jpg", sizeBytes: 204800, type: "image", sha256: "a".repeat(64), addedAt: T },
    { id: "fil_receip01", objectId: printer.id, role: "receipt", name: "receipt.pdf", storedName: "fil_receip01-receipt.pdf", sizeBytes: 5000, type: "pdf", sha256: "b".repeat(64), addedAt: T },
    { id: "fil_setup001", objectId: printer.id, role: "other", name: "setup.exe", storedName: "fil_setup001-setup.exe", sizeBytes: 3 * 1024 * 1024, type: "executable", sha256: "c".repeat(64), addedAt: T }
  ]
};
const ready = { status: status(2), objects, attention, locations: ["Workshop"] };

const render = (props) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...props }));
const section = (html, label) => {
  const at = html.indexOf(`aria-label="${label}"`);
  assert.ok(at >= 0, `no ${label}`);
  const end = html.indexOf("</ul>", at);
  return html.slice(at, end);
};

test("loading: a status, busy, no controls yet", () => {
  const html = render({});
  assert.match(html, /role="status"[^>]*>(?:<[^>]+>)*Loading ObjectOS…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /role="tablist"/);
  assert.doesNotMatch(html, />Add object</);
});

test("error: an alert with the reason and a retry", () => {
  const html = render({ initial: { status: null, error: "database is locked" } });
  assert.match(html, /role="alert"/);
  assert.match(html, /class="kit-error__title">ObjectOS could not load<\/h2><p class="kit-error__message">database is locked<\/p>/);
  assert.match(html, />Try again</);
});

test("empty: says what ObjectOS is and what it never reads, and offers add and import", () => {
  const html = render({ initial: { status: status(0) } });
  // What it answers, and that it also keeps everything else about a thing.
  assert.match(html, /ObjectOS answers “where is my passport\?” and “what&#x27;s in the black drawer\?”/);
  assert.match(html, /kit-header__subtitle">Your things: where each one is, and everything about it</);
  // The five-second add is there before anything exists.
  assert.match(html, /<form class="objectos-locate__add" aria-label="Remember where something is">/);
  assert.match(html, /<h3 id="objectos-locate-title">Where is it\?<\/h3><p class="objectos-meta">Nothing yet<\/p>/);
  assert.match(html, /never reads Finance, Vault or any other module&#x27;s data/);
  assert.match(html, />Add object</);
  assert.match(html, />Import…</);
  assert.doesNotMatch(html, />Export all…</, "nothing to export yet");
});

test("list: search, filters by category, location and status, and a needs-attention section", () => {
  const html = render({ initial: ready });
  assert.match(html, /<form class="objectos-search" role="search" aria-label="Search objects">/);
  assert.match(html, /<label for="objectos-search-input">/);
  for (const label of ["Category", "Status", "Location"]) assert.match(html, new RegExp(`<label>${label}<select`));
  assert.match(html, /<option value="Workshop">Workshop<\/option>/);
  assert.match(html, /<h3 id="objectos-attention-title">Needs attention<\/h3>/);
  assert.match(html, /1 overdue, 1 warranty ending, 1 low on stock/);
  const att = section(html, "Needs attention");
  assert.match(att, /Replace nozzle: Overdue by 4 days/);
  assert.match(att, /Warranty ends in 12 days/);
  assert.match(att, /0.4 nozzle.*Low stock: 1 left \(restock at 2\)/);
  const list = section(html, "Objects");
  assert.match(list, /Workshop printer/);
  assert.match(list, /<span class="technical">7K3F-9QXM<\/span> · Printer · Active · Workshop/);
  assert.match(html, />Turn on daily reminders</);
  assert.match(html, /aria-pressed="false"/);
});

test("a long list says it is cut short and how to find the rest", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ ...printer, id: `A${String(i).padStart(7, "0")}`, name: `Thing ${i}` }));
  assert.match(render({ initial: { ...ready, status: status(5000), objects: many } }), /Showing the first 500 objects by name\. Search or filter to find the others\./);
  assert.doesNotMatch(render({ initial: ready }), /Showing the first/);
});

test("privacy: the attention list and the object list never show a serial number", () => {
  const html = render({ initial: { ...ready, detail: null } });
  for (const label of ["Needs attention", "Objects"]) {
    const part = section(html, label);
    assert.doesNotMatch(part, /SN-SECRET-4471|SN-HOTEND/, label);
  }
  assert.doesNotMatch(html, /SN-SECRET-4471|SN-HOTEND/);
});

test("detail tabs: nine, one tab stop, the selected tab controls a labelled, focusable panel", () => {
  const html = render({ initial: { ...ready, detail, tab: "files" } });
  assert.equal(html.split('role="tab"').length - 1, 9);
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) ?? []).length, 1);
  for (const t of ["Overview", "Maintenance", "Parts", "Modifications", "Settings", "Measurements", "Files", "Purchase", "History"]) assert.match(html, new RegExp(`role="tab"[^>]*>${t}</button>`));
  assert.match(html, /id="objectos-tab-files" aria-selected="true" aria-controls="objectos-panel-files" tabindex="0"/);
  assert.match(html, /role="tabpanel" id="objectos-panel-files" aria-labelledby="objectos-tab-files" class="kit-tabpanel objectos-panel" tabindex="0"/);
  assert.match(html, /<span class="technical">7K3F-9QXM<\/span> · Printer · Active/);
});

test("overview: photo with alt text, facts with the serial in technical type, components, current state", () => {
  const html = render({ initial: { ...ready, detail, tab: "overview", photo: "data:image/jpeg;base64,AAAA" } });
  assert.match(html, /<img class="objectos-photo" src="data:image\/jpeg;base64,AAAA" alt="Photo of Workshop printer"\/>/);
  assert.match(html, /<dt>Serial<\/dt><dd class="technical">SN-SECRET-4471<\/dd>/);
  assert.match(html, /Keep the enclosure closed\./);
  assert.match(html, /<h4 id="objectos-components-title">Components<\/h4>/);
  assert.match(html, /Hotend/);
  assert.match(html, /<th scope="row">firmware<\/th><td>6.1.2<\/td>/);
  assert.match(html, /aria-label="Clear firmware"/);
});

test("maintenance: due state in words, pause, delete asks first, and a labelled log form", () => {
  const html = render({ initial: { ...ready, detail, tab: "maintenance" } });
  assert.match(html, /Replace nozzle <span class="objectos-meta">every 200 print hours<\/span>/);
  assert.match(html, /<span class="kit-badge kit-badge--error"><span class="kit-badge__dot" aria-hidden="true"><\/span>Overdue by 12 print hours<\/span>/);
  assert.match(html, />Pause</);
  assert.match(html, /aria-label="Delete schedule Replace nozzle">Delete…</);
  for (const id of ["objectos-s-title", "objectos-s-kind", "objectos-s-every", "objectos-l-schedule", "objectos-l-title", "objectos-l-date", "objectos-l-by", "objectos-l-amount", "objectos-l-currency", "objectos-l-reading", "objectos-l-part", "objectos-l-qty", "objectos-l-notes"]) {
    assert.match(html, new RegExp(`<label for="${id}"(?: class="kit-field__label")?>`), id);
  }
  assert.match(html, /Replaced nozzle/);
  assert.match(html, /<span class="technical">12.50 EUR<\/span>/);
  assert.match(html, /1 part used/);
});

test("parts: stock, low stock said in words, stock change and add forms", () => {
  const html = render({ initial: { ...ready, detail, tab: "parts" } });
  assert.match(html, /<span class="technical">E3D-04<\/span>/);
  assert.match(html, /class="objectos-tone-warn"><span class="technical">1<\/span> pcs in stock · restock at <span class="technical">2<\/span> · low/);
  assert.match(html, /aria-label="Change stock of 0.4 nozzle"/);
  assert.match(html, /<h4>Add a part that fits this object<\/h4>/);
});

test("modifications: reversible ones can be marked reverted", () => {
  const html = render({ initial: { ...ready, detail, tab: "modifications" } });
  assert.match(html, /Added enclosure/);
  assert.match(html, /Reversible/);
  assert.match(html, />Mark reverted</);
  assert.match(html, /<label for="objectos-m-title" class="kit-field__label">What changed<\/label>/);
});

test("settings: versions grouped, compare shows the differences", () => {
  const diff = { from: "set_slicer001", to: "set_slicer002", diff: { added: [{ key: "ironing", value: "on" }], removed: [], changed: [{ key: "layer_height", from: "0.2", to: "0.15" }], unchanged: 1 } };
  const html = render({ initial: { ...ready, detail, tab: "settings", diff } });
  assert.match(html, /aria-label="Settings: Slicer"/);
  assert.match(html, /<span class="technical">v2<\/span>/);
  // P2: a version is one line of text, not one grid row per piece.
  assert.match(html, /<li class="objectos-row"><p class="objectos-version"><span class="technical">v2<\/span> · <time/);
  assert.match(html, /role="group" aria-label="Compare versions of Slicer"/);
  assert.match(html, /~ layer_height: 0.2 → 0.15/);
  assert.match(html, /\+ ironing = on/);
  assert.match(html, /1 unchanged/);
  assert.match(html, /<label for="objectos-set-values" class="kit-field__label">Values, one per line as key = value<\/label>/);
});

test("measurements: grouped by key with the latest reading and history", () => {
  const html = render({ initial: { ...ready, detail, tab: "measurements" } });
  assert.match(html, /print hours <span class="objectos-meta">latest <span class="technical">412<\/span> h<\/span>/);
  assert.match(html, /<td class="technical">380 h<\/td>/);
  assert.match(html, /<label for="objectos-ms-key" class="kit-field__label">What<\/label>/);
});

test("files: attach by role; open and remove each file; what happens to executables is said", () => {
  const html = render({ initial: { ...ready, detail, tab: "files" } });
  assert.match(html, /role="group" aria-label="Attach a file"/);
  assert.equal((html.match(/<option value="(manual|photo|receipt|model|config|other)">/g) ?? []).length, 6);
  assert.match(html, />Attach a file…</);
  assert.match(html, /Files that could run a program are shown in their folder instead of opened/);
  assert.match(html, /front.jpg \(photo\)/);
  assert.match(html, /receipt.pdf \(receipt\)/);
  assert.match(html, /aria-label="Open setup.exe">Open</);
  assert.match(html, /aria-label="Remove setup.exe">Remove…</);
  assert.match(html, /<td class="technical">3.0 MB<\/td>/);
});

test("purchase: warranty in words, price in technical type, receipt opens through the action", () => {
  const html = render({ initial: { ...ready, detail, tab: "purchase" } });
  assert.match(html, /class="objectos-tone-warn">Warranty ends in 12 days/);
  assert.match(html, /<dd class="technical">1099.00 EUR<\/dd>/);
  assert.match(html, /<button type="button" class="objectos-link">receipt.pdf<\/button>/);
  assert.match(html, /<label for="objectos-pu-warranty" class="kit-field__label">Warranty until<\/label>/);
});

test("history: newest first, with kind and time; empty says so", () => {
  const history = [{ kind: "maintenance", refId: "mnt_log000001", at: T, title: "Replaced nozzle", detail: "me" }, { kind: "created", refId: printer.id, at: T, title: "Added", detail: "" }];
  const html = render({ initial: { ...ready, detail, tab: "history", history } });
  assert.match(html, /aria-label="History, newest first"/);
  assert.match(html, /Replaced nozzle: me/);
  assert.match(html, /Maintenance · <time class="technical" datetime="2026-06-01T09:00:00.000Z">1 Jun 2026, 09:00<\/time>/i);
  assert.match(render({ initial: { ...ready, detail, tab: "history", history: [] } }), /No history yet\./);
});

test("needs attention shows the five most urgent, then a toggle for the rest", () => {
  const many = { ...attention, summary: { ...attention.summary, items: Array.from({ length: 8 }, (_, i) => ({ kind: "warranty", objectId: printer.id, state: "ending", daysLeft: i + 1 })) } };
  const html = render({ initial: { ...ready, attention: many } });
  const list = section(html, "Needs attention");
  assert.equal((list.match(/<li>/g) ?? []).length, 5);
  assert.match(html, /<button type="button" class="objectos-link" aria-expanded="false" aria-controls="objectos-attention-list">Show all 8<\/button>/);
  assert.doesNotMatch(render({ initial: ready }), /Show all/, "no toggle for three items");
});

test("the empty state offers the first steps itself", () => {
  const html = render({ initial: { status: status(0) } });
  assert.match(html, /<section class="kit-empty" aria-label="Nothing in ObjectOS yet">/);
  assert.match(html, /<button type="button" class="kit-button kit-button--primary kit-button--md">Add your first object<\/button>/);
  assert.match(html, />Import an export…<\/button>/);
});

test("the detail header's status select is named, not labelled above, so the header buttons stay one height", () => {
  const html = render({ initial: { ...ready, detail } });
  assert.match(html, /<select class="kit-input kit-select objectos-status-select" aria-label="Status">/);
  assert.doesNotMatch(html, /<label class="objectos-inline">Status/);
});

test("the add form marks the name as required", () => {
  const html = render({ initial: { ...ready, editing: { id: null, name: "", category: "other", make: "", model: "", serial: "", location: "", status: "active", parentId: "", tags: "", notes: "" } } });
  assert.match(html, /<label for="objectos-f-name" class="kit-field__label">Name \(required\)<\/label><input class="kit-input" id="objectos-f-name" required=""/);
});

test("delete asks first: an alert dialog that names what is kept", () => {
  const confirm = { actionId: "object_os.object.delete", params: { input: { id: printer.id } }, title: "Delete Workshop printer?", detail: "All its records and attached files are deleted. Its 1 component will be kept. This cannot be undone." };
  const html = render({ initial: { ...ready, detail, confirm } });
  assert.match(html, /<div class="kit-backdrop" style="--kit-accent:var\(--accent-object\)"><div class="kit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"><header class="kit-dialog__header"><h2 id="\1" class="kit-dialog__title">Delete Workshop printer\?<\/h2><p id="\2" class="kit-dialog__description">/);
  assert.match(html, /Its 1 component will be kept/);
  assert.match(html, />Cancel<\/button><button type="button" class="kit-button kit-button--danger kit-button--md kit-confirm__ok">Delete<\/button>/);
});

test("add and edit: a labelled form; part-of never offers the object itself", () => {
  const add = render({ initial: { ...ready, editing: { id: null, name: "", category: "other", make: "", model: "", serial: "", location: "", status: "active", parentId: "", tags: "", notes: "" } } });
  assert.match(add, /<h3 id="objectos-form-title">Add an object<\/h3>/);
  for (const id of ["objectos-f-name", "objectos-f-category", "objectos-f-status", "objectos-f-make", "objectos-f-model", "objectos-f-serial", "objectos-f-location", "objectos-f-parent", "objectos-f-tags", "objectos-f-notes"]) {
    assert.match(add, new RegExp(`<label for="${id}"(?: class="kit-field__label")?>`), id);
  }
  assert.match(add, /<button type="submit" class="kit-button kit-button--primary kit-button--md" disabled="">Add object<\/button>/, "no name, no submit");
  const edit = render({ initial: { ...ready, editing: { id: printer.id, name: printer.name, category: "printer", make: "", model: "", serial: "", location: "", status: "active", parentId: "", tags: "", notes: "" } } });
  assert.match(edit, /Edit object/);
  assert.doesNotMatch(edit, new RegExp(`<option value="${printer.id}">`));
  assert.match(edit, new RegExp(`<option value="${hotend.id}">Hotend \\(9QXM-7K3F\\)</option>`));
});

test("every form control has a label", () => {
  for (const tab of ["overview", "maintenance", "parts", "modifications", "settings", "measurements", "files", "purchase"]) {
    const html = render({ initial: { ...ready, detail, tab } });
    for (const [tag] of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const id = tag.match(/ id="([^"]+)"/)?.[1];
      if (/ aria-label="[^"]+"/.test(tag)) {
        // Named directly (the header's status select).
      } else if (id) {
        assert.match(html, new RegExp(`<label for="${id}"(?: class="kit-field__label")?>`), `${tab}: ${tag}`);
      } else {
        // No id: it must sit inside a <label>.
        const at = html.indexOf(tag);
        const open = html.lastIndexOf("<label", at);
        const close = html.lastIndexOf("</label>", at);
        assert.ok(open > close, `${tab}: unlabelled ${tag}`);
      }
    }
  }
});

test("design tokens only: no literal colours; fonts from tokens; the tools accent", () => {
  const files = ["ObjectOsView.tsx", "ObjectOs.css", "objectOsModel.ts"].map((f) => readFileSync(join(desktop, "src/renderer/views", f), "utf8"));
  for (const text of files) {
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, "no hex colours");
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, "no rgb/hsl colours");
    assert.doesNotMatch(text, /\b(white|black|red|blue|green|gray|grey|gold|yellow|orange)\b\s*[;"'}]/i, "no named colours");
  }
  const css = files[1];
  for (const [, family] of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, family);
  assert.match(css, /var\(--accent-object\)/);
  assert.doesNotMatch(css, /animation|transition/, "nothing animates");
});

test("P1, P4: nine tabs wrap instead of scrolling sideways; with nothing chosen the detail column says what to do in a framed note", () => {
  const html = render({ initial: { ...ready, detail } });
  assert.match(html, /<div class="kit-tabs kit-tabs--wrap" role="tablist" aria-label="Object sections">/);
  const none = render({ initial: { ...ready } });
  assert.match(none, /<p class="kit-empty-note">Choose an object to see its maintenance/);
});

test("table buttons keep their label on one line", () => {
  const css = readFileSync(join(desktop, "src/renderer/views/ObjectOs.css"), "utf8");
  const rule = css.match(/([^{}]*\.objectos-table button[^{}]*)\{([^}]*)\}/);
  assert.ok(rule, "a rule targets buttons inside ObjectOS tables");
  assert.match(rule[2], /white-space:\s*nowrap/);
});

test("the shell routes to it: sidebar entry, icon, action", () => {
  const meta = readFileSync(join(desktop, "src/renderer/lib/moduleMeta.ts"), "utf8");
  const shell = readFileSync(join(desktop, "src/renderer/main.tsx"), "utf8");
  assert.match(meta, /\{ id: "object", label: "ObjectOS", accentClass: "accent-object", actionId: "object_os.open" \}/);
  assert.match(meta, /object: \{ icon: Package, accent: "var\(--accent-object\)" \}/);
  assert.match(shell, /activeView === "object" && <ObjectOsView bridge=\{getBridge\(\)\}/);
  // After integration the shell bridge extends every module's bridge; ObjectOS's must be one of them.
  assert.match(shell, /export interface DexNestBridge extends [^{]*\bObjectOsBridge\b[^{]*\{/);
});

test("the view imports only types from the package, so the renderer never bundles the store", () => {
  for (const f of ["ObjectOsView.tsx", "objectOsModel.ts"]) {
    const text = readFileSync(join(desktop, "src/renderer/views", f), "utf8");
    for (const [line] of text.matchAll(/^import[^;]*"@dexnest\/object-os";/gms)) assert.match(line, /^import type /, `${f}: ${line}`);
  }
});

test("numbers first: objects, maintenance due, warranties ending, low stock - and none while empty", () => {
  const html = render({ initial: ready });
  assert.match(html, /kit-stat__label">Objects<\/p><\/div><p class="kit-stat__value">/);
  assert.match(html, /kit-stat__label">Maintenance due<\/p><\/div><p class="kit-stat__value">1<\/p><p class="kit-stat__foot"><span class="kit-stat__hint">1 overdue</);
  assert.match(html, /kit-stat__label">Warranties ending<\/p><\/div><p class="kit-stat__value">1</);
  assert.match(html, /--kit-tone:var\(--warning\)[^>]*>(?:(?!kit-stat").)*Low on stock/s, "low stock is a warning, not good news");
  assert.doesNotMatch(render({ initial: { status: status(0) } }), /kit-stat/);
});

test("every row carries a mark: the category on objects, the urgency on attention", () => {
  const html = render({ initial: { ...ready, detail } });
  const list = section(html, "Objects");
  assert.match(list, /<span class="objectos-icon" aria-hidden="true"><svg[^>]*lucide-printer/);
  const att = section(html, "Needs attention");
  assert.match(att, /objectos-tone-bad"><span class="objectos-icon" aria-hidden="true"><svg[^>]*lucide-(?:triangle-alert|alert-triangle)/);
  assert.match(att, /<svg[^>]*lucide-shield-alert/);
  assert.match(att, /<svg[^>]*lucide-package-minus/);
  // The object's own mark sits in its header, before its name.
  assert.match(html, /<div class="objectos-detail-head"><span class="objectos-icon" aria-hidden="true"><svg[^>]*lucide-printer[\s\S]*?<\/svg><\/span><div class="objectos-detail-title"><h3 id="objectos-detail-title">Workshop printer<\/h3>/);
});

// --- where things are (what Finder did) ------------------------------------------------

const placed = (o, whereabouts = {}) => ({ ...o, whereabouts: { objectId: o.id, room: "", container: "", lentTo: "", lentAt: null, missing: false, locatedAt: T, ...whereabouts } });
const passport = placed({ ...printer, id: "PASS0001", name: "Passport", category: "other", location: "black drawer", photoFileId: null }, { room: "Bedroom" });
const bank = placed({ ...printer, id: "BANK0001", name: "Power bank", category: "other", location: "", status: "lent_out", photoFileId: null }, { lentTo: "Alex", lentAt: "2026-03-01T10:00:00.000Z" });

test("where is it: a labelled lookup with two modes, a five-second add, and what was placed lately", () => {
  const html = render({ initial: { ...ready, locate: { recent: [passport, bank], rooms: ["Bedroom", "Kitchen"] } } });
  assert.match(html, /<section class="objectos-card objectos-locate" aria-labelledby="objectos-locate-title">/);
  assert.match(html, /<p class="objectos-meta">2 things in 2 rooms<\/p>/);
  assert.match(html, /<button type="button" class="objectos-chip" aria-pressed="true">Where is my…<\/button><button type="button" class="objectos-chip" aria-pressed="false">What&#x27;s in…<\/button>/);
  assert.match(html, /<input class="kit-input" id="objectos-locate-query" type="search" aria-label="The thing you are looking for"/);
  // Recently placed, each saying where it is in a few words.
  assert.match(html, /<ul class="objectos-list" aria-label="Recently placed">/);
  assert.match(html, /<span>Passport<\/span><span class="objectos-meta">Bedroom · black drawer · placed <time[^>]*>1 Jun 2026<\/time>/);
  assert.match(html, /<span>Power bank<\/span><span class="objectos-meta">with Alex/);
  // Rooms as shortcuts into "what's in".
  assert.match(html, /<div class="objectos-locate__rooms" role="group" aria-label="Rooms"><button type="button" class="objectos-chip">Bedroom<\/button><button type="button" class="objectos-chip">Kitchen<\/button>/);
  for (const id of ["objectos-quick-name", "objectos-quick-where", "objectos-quick-room"]) assert.match(html, new RegExp(`<label for="${id}">`), id);
  assert.match(html, /<button type="submit" class="kit-button kit-button--primary kit-button--md" disabled="">Remember<\/button>/);
});

test("where is it: results say where each thing is; nothing found says what to do next", () => {
  const found = render({ initial: { ...ready, locate: { query: "pass", results: [passport] } } });
  assert.match(found, /<ul class="objectos-list" aria-label="Where it is">/);
  assert.match(found, /<span>Passport<\/span><span class="objectos-meta">Bedroom · black drawer/);
  assert.doesNotMatch(found, /Recently placed/, "results replace the recent list");
  const none = render({ initial: { ...ready, locate: { query: "umbrella", results: [] } } });
  assert.match(none, /Nothing called “umbrella” yet\. Add it on the right, with where it is\./);
  const place = render({ initial: { ...ready, locate: { mode: "place", query: "attic", results: [] } } });
  assert.match(place, /aria-label="The place, room or container"/);
  assert.match(place, /Nothing is recorded in “attic”\./);
});

test("an open object says where it is and offers moved, lent, back and missing", () => {
  const home = render({ initial: { ...ready, detail, whereabouts: placed(printer, { room: "Garage", container: "bench" }) } });
  assert.match(home, /<section class="objectos-whereabouts" aria-label="Where Workshop printer is">/);
  assert.match(home, /<strong>Garage · Workshop · bench<\/strong><span class="objectos-meta"> · placed <time[^>]*>1 Jun 2026<\/time>/);
  assert.match(home, />I moved it<\/button>/);
  assert.match(home, />Lent to…<\/button>/);
  assert.match(home, />Mark missing<\/button>/);
  const out = render({ initial: { ...ready, detail, whereabouts: { ...bank, name: printer.name } } });
  assert.match(out, /<strong>with Alex<\/strong><span class="objectos-meta"> · since <time[^>]*>1 Mar 2026<\/time>/);
  assert.match(out, />It&#x27;s back<\/button>/);
  assert.doesNotMatch(out, />Lent to…</);
  const lost = render({ initial: { ...ready, detail, whereabouts: placed(printer, { missing: true }) } });
  assert.match(lost, /<strong>missing<\/strong>/);
  assert.match(lost, />Found it<\/button>/);
});

test("Finder is gone from the shell: no screen, no sidebar entry; its commands open ObjectOS", () => {
  const meta = readFileSync(join(desktop, "src/renderer/lib/moduleMeta.ts"), "utf8");
  const shell = readFileSync(join(desktop, "src/renderer/main.tsx"), "utf8");
  assert.doesNotMatch(meta, /id: "finder"/);
  assert.doesNotMatch(shell, /function FinderView|activeView === "finder"/);
  assert.match(shell, /finder: \{ module: "object", actionId: "object_os\.open" \}/);
  const main = readFileSync(join(desktop, "src/main/main.ts"), "utf8");
  assert.doesNotMatch(main, /saveFinderItems|writeJsonFile\(finderItemsPath, items\)/, "nothing writes Finder's own file any more");
  assert.match(main, /function loadFinderItems\(\): FinderItem\[\] \{\r?\n  return objectOsHost \? allItems\(objectOsHost\.module\) : \[\];/);
});
