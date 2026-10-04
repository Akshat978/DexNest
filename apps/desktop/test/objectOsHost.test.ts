/**
 * ObjectOS's main-process host, file store and zips.
 *
 * Real SQLite (node:sqlite) in a temp directory with the foundation's event
 * log, real files and real links for the data-boundary checks, synthetic
 * data only, and stand-ins for ipcMain, the window, the dialogs and the
 * shell that behave like Electron's where the host relies on them.
 */

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createEventLog, createHostScheduler, runFoundationMigrations, type SchedulerTimers } from "@dexnest/foundation";
import { assertSafeTestPath, createTestDatabase, type TestDatabase, makeTestLink } from "@dexnest/foundation/testing";
import { seededActions } from "@dexnest/action-registry";
import { EXPORT_JSON_NAME, OBJECT_ACTION_IDS as A, type FileRecord, type ObjectRecord } from "@dexnest/object-os";
import {
  createObjectOsHost,
  objectJournalLine,
  OBJECT_CHANNELS,
  runObjectOsAction,
  type ObjectIpcEvent,
  type ObjectIpcMain
} from "../src/main/objectOsHost.ts";
import { allItems, changePlace, findItems, forgetItem, itemsIn, migrateFinderItems, rememberItem, reviseItem } from "../src/main/objectLocate.ts";
import { openZip, writeZip } from "../src/main/objectOsZip.ts";

type Listener = (event: ObjectIpcEvent, ...args: unknown[]) => unknown;

const MARK = "OWNER-TEXT-7c3a";

function fakeIpc(): ObjectIpcMain & { handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>();
  return {
    handlers,
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      handlers.set(channel, listener);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    }
  };
}

function heldTimers(): SchedulerTimers & { count(): number } {
  let next = 0;
  const live = new Set<number>();
  return {
    set: () => { const id = ++next; live.add(id); return id; },
    clear: (id) => { live.delete(id as number); },
    count: () => live.size
  };
}

const mainFrame = { name: "main frame" };
const webContents = { mainFrame };
const window = { destroyed: false, isDestroyed() { return this.destroyed; }, webContents };
const trusted: ObjectIpcEvent = { sender: webContents, senderFrame: mainFrame };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
  window.destroyed = false;
});

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Every file under a directory, relative. */
function walk(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() && !d.isSymbolicLink() ? walk(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`]
  );
}

interface Setup {
  handle: TestDatabase;
  base: string;
  home: string;
  dataRoot: string;
  host: ReturnType<typeof createObjectOsHost>;
  ipc: ReturnType<typeof fakeIpc>;
  timers: ReturnType<typeof heldTimers>;
  audit: string[];
  notes: string[];
  opened: string[];
  shown: string[];
  dialog: { attach: string | null; exportPath: string | null; importPath: string | null };
  call(channel: string, event?: ObjectIpcEvent, ...args: unknown[]): unknown;
  run(actionId: string, params?: Record<string, unknown>, source?: string): ReturnType<typeof runObjectOsAction>;
  objectEvents(): string[];
  newObject(name?: string): Promise<ObjectRecord>;
  attach(objectId: string, path: string, role?: string): Promise<FileRecord>;
}

function setup(label = "obj-host-"): Setup {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), label)));
  const dataRoot = join(base, "dexnest-data");
  const home = join(base, "home");
  mkdirSync(join(dataRoot, "files", "vault"), { recursive: true });
  mkdirSync(join(dataRoot, "files", "receipts"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(dataRoot, "files", "vault", "secret.txt"), `${MARK} vault`);
  writeFileSync(join(dataRoot, "files", "receipts", "finance.pdf"), `${MARK} finance`);
  const handle = createTestDatabase("obj-host-db-");
  cleanups.push(() => { handle.dispose(); rmSync(base, { recursive: true, force: true }); });
  runFoundationMigrations(handle.db);
  const events = createEventLog(handle.db);
  const ipc = fakeIpc();
  const timers = heldTimers();
  const audit: string[] = [];
  const notes: string[] = [];
  const opened: string[] = [];
  const shown: string[] = [];
  const dialog = { attach: null as string | null, exportPath: null as string | null, importPath: null as string | null };
  const host = createObjectOsHost({
    database: handle.db,
    events,
    dataRoot,
    otherDataRoots: [],
    scheduler: createHostScheduler({ timers }),
    ipcMain: ipc,
    getWindow: () => window,
    dialogs: {
      chooseAttachSource: async () => dialog.attach,
      chooseExportPath: async () => dialog.exportPath,
      chooseImportPath: async () => dialog.importPath
    },
    shell: {
      openPath: async (path) => { opened.push(path); return ""; },
      showItemInFolder: (path) => { shown.push(path); }
    },
    notify: (title, body) => { notes.push(`${title}: ${body}`); },
    audit: (summary) => { audit.push(summary); },
    now: () => new Date("2026-06-30T12:00:00.000Z")
  });
  cleanups.push(() => host.dispose());
  const s: Setup = {
    handle,
    base,
    home,
    dataRoot,
    host,
    ipc,
    timers,
    audit,
    notes,
    opened,
    shown,
    dialog,
    call(channel, event = trusted, ...args) {
      const listener = ipc.handlers.get(channel);
      assert.ok(listener, `no handler for ${channel}`);
      return listener(event, ...args);
    },
    run: (actionId, params = {}, source = "module_ui") =>
      runObjectOsAction(host, actionId, params, { source, allowedTriggers: seededActions.find((a) => a.id === actionId)?.allowedTriggers ?? ["module_ui"] }),
    objectEvents: () => events.query({ stream: "object" }).map((e) => e.type),
    async newObject(name = "Printer") {
      const r = await s.run(A.objectSave, { input: { name, category: "printer", serial: `${MARK} serial` } });
      assert.equal(r?.ok, true, String(r?.error));
      return r?.value as ObjectRecord;
    },
    async attach(objectId, path, role = "manual") {
      dialog.attach = path;
      const r = await s.run(A.fileAttach, { objectId, role });
      dialog.attach = null;
      assert.equal(r?.ok, true, String(r?.error));
      return r?.value as FileRecord;
    }
  };
  return s;
}

// --- IPC and scheduling -------------------------------------------------------

test("IPC answers only the trusted main frame of a live window", () => {
  const s = setup();
  assert.deepEqual([...s.ipc.handlers.keys()].sort(), Object.values(OBJECT_CHANNELS).sort());
  assert.ok(s.call(OBJECT_CHANNELS.status));
  const refused = /trusted desktop main frame/;
  assert.throws(() => s.call(OBJECT_CHANNELS.list, { sender: {}, senderFrame: mainFrame }), refused);
  assert.throws(() => s.call(OBJECT_CHANNELS.detail, { sender: webContents, senderFrame: { name: "iframe" } }, "7K3F9QXM"), refused);
  window.destroyed = true;
  assert.throws(() => s.call(OBJECT_CHANNELS.attention), refused);
});

test("dispose removes every handler and the reminders timer", async () => {
  const s = setup();
  await s.run(A.remindersEnable);
  assert.ok(s.timers.count() > 0);
  s.host.dispose();
  assert.equal(s.ipc.handlers.size, 0);
  assert.equal(s.timers.count(), 0);
});

test("no timer exists until reminders are turned on, and none after they are turned off", async () => {
  const s = setup();
  assert.equal(s.timers.count(), 0);
  await s.newObject();
  assert.equal(s.timers.count(), 0);
  assert.equal((await s.run(A.remindersEnable))?.ok, true);
  assert.ok(s.timers.count() > 0);
  assert.equal((await s.run(A.remindersDisable))?.ok, true);
  assert.equal(s.timers.count(), 0);
});

test("changes run only from DexNest's own window: the Stream Deck endpoint and a phone are refused", async () => {
  const s = setup();
  for (const source of ["stream_deck_http", "companion", "deck", "command", "system"]) {
    const r = await s.run(A.objectSave, { input: { name: "Drill", category: "tool" } }, source);
    assert.equal(r?.ok, false, source);
  }
  // Even an action whose registry entry listed the Stream Deck would be refused from it.
  const forced = await runObjectOsAction(s.host, A.export, {}, { source: "stream_deck_http", allowedTriggers: ["stream_deck_http", "module_ui"] });
  assert.equal(forced?.ok, false);
  assert.deepEqual(s.call(OBJECT_CHANNELS.list), { ok: true, value: [] });
  assert.deepEqual(s.objectEvents(), []);
  // The command palette may turn reminders on, as its registry entry allows.
  assert.equal((await s.run(A.remindersEnable, {}, "command"))?.ok, true);
  // No ObjectOS action has opted in to the phone or the Stream Deck.
  for (const a of seededActions.filter((x) => x.moduleId === "object_os")) {
    assert.equal("phone" in a && a.phone !== undefined, false, a.id);
    for (const t of a.allowedTriggers) assert.ok(["module_ui", "command"].includes(t), `${a.id} allows ${t}`);
  }
});

test("every object_os action but open has a handler", async () => {
  const s = setup();
  const ids = seededActions.filter((a) => a.moduleId === "object_os" && a.id !== A.open).map((a) => a.id);
  assert.equal(ids.length, 22);
  for (const id of ids) assert.notEqual(await s.run(id, {}), null, id);
  assert.equal(await s.run(A.open), null);
  assert.equal(await s.run("ghost_os.export"), null);
});

// --- attaching ------------------------------------------------------------------

test("attach copies the owner-picked file into files/objects/<id>/ with its hash; a path in params is ignored", async () => {
  const s = setup();
  const o = await s.newObject();
  const manual = join(s.home, "manual.pdf");
  writeFileSync(manual, "%PDF manual");
  s.dialog.attach = manual;
  const r = await s.run(A.fileAttach, { objectId: o.id, role: "manual", sourcePath: join(s.dataRoot, "files", "vault", "secret.txt") });
  assert.equal(r?.ok, true, String(r?.error));
  const file = r?.value as FileRecord;
  const stored = join(s.dataRoot, "files", "objects", o.id, file.storedName);
  assert.equal(readFileSync(stored, "utf8"), "%PDF manual");
  assert.equal(file.sha256, sha("%PDF manual"));
  assert.deepEqual(walk(join(s.dataRoot, "files", "objects")), [`${o.id}/${file.storedName}`]);

  s.dialog.attach = null;
  assert.equal((await s.run(A.fileAttach, { objectId: o.id, role: "manual" }))?.cancelled, true);
});

test("bait: sources inside DexNest's data are refused, directly and through links, and nothing is copied or recorded", async () => {
  const s = setup();
  const o = await s.newObject();
  const other = await s.newObject("Other");
  await s.attach(other.id, (() => { const p = join(s.home, "other.pdf"); writeFileSync(p, "other"); return p; })());
  const before = walk(join(s.dataRoot, "files"));
  const eventsBefore = s.objectEvents().length;

  const fileLink = join(s.home, "innocent.pdf");
  // A file link needs admin rights on Windows; without them it cannot exist there.
  const fileLinked = makeTestLink(join(s.dataRoot, "files", "vault", "secret.txt"), fileLink);
  const dirLink = join(s.home, "docs");
  makeTestLink(join(s.dataRoot, "files"), dirLink);
  const otherObjectFile = walk(join(s.dataRoot, "files", "objects", other.id))[0] as string;
  const baits = [
    join(s.dataRoot, "files", "vault", "secret.txt"),
    join(s.dataRoot, "files", "receipts", "finance.pdf"),
    join(s.dataRoot, "files", "objects", other.id, otherObjectFile),
    ...(fileLinked ? [fileLink] : []),
    join(dirLink, "receipts", "finance.pdf"),
    join(s.dataRoot, "files", "vault")
  ];
  for (const bait of baits) {
    s.dialog.attach = bait;
    const r = await s.run(A.fileAttach, { objectId: o.id, role: "receipt" });
    assert.equal(r?.ok, false, bait);
  }
  assert.deepEqual(walk(join(s.dataRoot, "files")), before);
  assert.equal(s.objectEvents().length, eventsBefore);
  const detail = s.call(OBJECT_CHANNELS.detail, trusted, o.id) as { ok: true; value: { files: unknown[] } };
  assert.deepEqual(detail.value.files, []);
});

test("a source swapped for a link between inspecting and copying is refused at copy time", async (t) => {
  const s = setup();
  const o = await s.newObject();
  const src = join(s.home, "swap.pdf");
  writeFileSync(src, "fine");
  const info = s.host.files.inspect(src);
  assert.equal(info?.insideDataRoot, false);
  unlinkSync(src);
  if (!makeTestLink(join(s.dataRoot, "files", "vault", "secret.txt"), src)) {
    t.skip("a file link needs admin rights or Developer Mode on Windows, so this swap cannot happen here");
    return;
  }
  await assert.rejects(() => s.host.files.copyIn(src, o.id, "fil_x-swap.pdf", 1024), /inside DexNest's data/);
  assert.deepEqual(walk(join(s.dataRoot, "files", "objects")), []);
});

test("nothing is written when files/objects has been made a link that leads out of the data root", async () => {
  const s = setup();
  const o = await s.newObject();
  const elsewhere = join(s.base, "elsewhere");
  mkdirSync(elsewhere);
  makeTestLink(elsewhere, join(s.dataRoot, "files", "objects"));
  const src = join(s.home, "a.pdf");
  writeFileSync(src, "a");
  s.dialog.attach = src;
  const r = await s.run(A.fileAttach, { objectId: o.id, role: "manual" }).catch((e: unknown) => ({ ok: false, error: String(e) }));
  assert.equal(r?.ok, false);
  assert.deepEqual(walk(elsewhere), []);
});

// --- opening --------------------------------------------------------------------------

test("open hands the stored file to the system; an executable is shown in its folder instead", async () => {
  const s = setup();
  const o = await s.newObject();
  const pdf = join(s.home, "manual.pdf");
  writeFileSync(pdf, "pdf");
  const exe = join(s.home, "setup.exe");
  writeFileSync(exe, "MZ");
  const f1 = await s.attach(o.id, pdf);
  const f2 = await s.attach(o.id, exe, "other");

  const r1 = await s.run(A.fileOpen, { fileId: f1.id });
  assert.equal(r1?.ok, true);
  assert.deepEqual(s.opened, [join(s.dataRoot, "files", "objects", o.id, f1.storedName)]);

  const r2 = await s.run(A.fileOpen, { fileId: f2.id });
  assert.equal(r2?.ok, true);
  assert.match(String(r2?.message), /shown in its folder/);
  assert.equal(s.opened.length, 1);
  assert.deepEqual(s.shown, [join(s.dataRoot, "files", "objects", o.id, f2.storedName)]);
});

test("a stored file replaced by a link, or a folder replaced by one, is never opened", async () => {
  const s = setup();
  const o = await s.newObject();
  const pdf = join(s.home, "manual.pdf");
  writeFileSync(pdf, "pdf");
  const f = await s.attach(o.id, pdf);
  const stored = join(s.dataRoot, "files", "objects", o.id, f.storedName);

  // The file itself becomes a link to the vault.
  // (A file link needs admin rights on Windows; without them, only the folder case below can happen.)
  unlinkSync(stored);
  if (makeTestLink(join(s.dataRoot, "files", "vault", "secret.txt"), stored)) {
    const r1 = await s.run(A.fileOpen, { fileId: f.id });
    assert.equal(r1?.ok, false);
  }

  // The object's folder becomes a link to a folder holding a file of the same name.
  const decoy = join(s.base, "decoy");
  mkdirSync(decoy);
  writeFileSync(join(decoy, f.storedName), "decoy");
  rmSync(join(s.dataRoot, "files", "objects", o.id), { recursive: true, force: true });
  makeTestLink(decoy, join(s.dataRoot, "files", "objects", o.id));
  const r2 = await s.run(A.fileOpen, { fileId: f.id });
  assert.equal(r2?.ok, false);

  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.shown, []);
  // Its photo is not handed out either.
  assert.equal(s.call(OBJECT_CHANNELS.photo, trusted, f.id), null);
});

test("photos: a stored image of a known type is inlined; other types and untrusted callers get nothing", async () => {
  const s = setup();
  const o = await s.newObject();
  const png = join(s.home, "front.png");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const svg = join(s.home, "front.svg");
  writeFileSync(svg, "<svg/>");
  const p = await s.attach(o.id, png, "photo");
  const v = await s.attach(o.id, svg, "photo");
  assert.equal(s.call(OBJECT_CHANNELS.photo, trusted, p.id), `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
  assert.equal(s.call(OBJECT_CHANNELS.photo, trusted, v.id), null);
  assert.equal(s.call(OBJECT_CHANNELS.photo, trusted, "fil_nope"), null);
  assert.throws(() => s.call(OBJECT_CHANNELS.photo, { sender: {}, senderFrame: mainFrame }, p.id));
});

test("deleting an object deletes its folder, never following a link", async () => {
  const s = setup();
  const o = await s.newObject();
  const keep = join(s.base, "keep");
  mkdirSync(keep);
  writeFileSync(join(keep, "precious.txt"), "keep me");
  const pdf = join(s.home, "manual.pdf");
  writeFileSync(pdf, "pdf");
  await s.attach(o.id, pdf);
  rmSync(join(s.dataRoot, "files", "objects", o.id), { recursive: true, force: true });
  makeTestLink(keep, join(s.dataRoot, "files", "objects", o.id));
  const r = await s.run(A.objectDelete, { input: { id: o.id } });
  assert.equal(r?.ok, true, String(r?.error));
  assert.equal(readFileSync(join(keep, "precious.txt"), "utf8"), "keep me");
  assert.equal(existsSync(join(s.dataRoot, "files", "objects", o.id)), false);
});

// --- export and import ------------------------------------------------------------------

async function populated(s: Setup): Promise<{ parent: ObjectRecord; child: ObjectRecord; files: FileRecord[] }> {
  const parent = await s.newObject("Printer");
  const cr = await s.run(A.objectSave, { input: { name: "Hotend", category: "other", parentId: parent.id } });
  const child = cr?.value as ObjectRecord;
  const a = join(s.home, "manual.pdf");
  writeFileSync(a, "%PDF manual ".repeat(1000));
  const b = join(s.home, "photo.jpg");
  writeFileSync(b, Buffer.alloc(70_000, 7));
  const files = [await s.attach(parent.id, a), await s.attach(child.id, b, "photo")];
  await s.run(A.purchaseSave, { input: { objectId: parent.id, shop: "Shop", price: { amount: "300.00", currency: "EUR" }, warrantyUntil: "2027-01-01" } });
  return { parent, child, files };
}

test("export writes a zip any tool reads; import into an empty DexNest restores rows and identical files", async () => {
  const s = setup();
  const { parent, child, files } = await populated(s);
  s.dialog.exportPath = join(s.home, "out.zip");
  const r = await s.run(A.export, { objectIds: [parent.id] });
  assert.equal(r?.ok, true, String(r?.error));
  assert.equal(r?.message, "Exported 2 objects and 2 files.");
  assert.equal(existsSync(`${s.dialog.exportPath}.part`), false);

  // Another tool (adm-zip) reads it.
  const other = new AdmZip(s.dialog.exportPath);
  const names = other.getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(names, [EXPORT_JSON_NAME, ...files.map((f) => `files/${f.objectId}/${f.storedName}`)].sort());

  const t = setup("obj-host-b-");
  t.dialog.importPath = s.dialog.exportPath;
  const imported = await t.run(A.import);
  assert.equal(imported?.ok, true, String(imported?.error));
  assert.equal(imported?.message, "Imported 2 objects and 2 files.");
  for (const f of files) {
    assert.equal(sha(readFileSync(join(t.dataRoot, "files", "objects", f.objectId, f.storedName))), f.sha256);
  }
  const detail = t.call(OBJECT_CHANNELS.detail, trusted, child.id) as { ok: true; value: { object: ObjectRecord; parent: { id: string } } };
  assert.equal(detail.value.parent.id, parent.id);

  // Importing again skips what is already there and copies nothing.
  const again = await t.run(A.import);
  assert.equal(again?.ok, true);
  assert.match(String(again?.message), /Imported 0 objects and 0 files; 2 already here, skipped/);
});

test("a zip written by another tool, with compressed entries, imports", async () => {
  const s = setup();
  const { files } = await populated(s);
  s.dialog.exportPath = join(s.home, "out.zip");
  await s.run(A.export);
  const reZipped = new AdmZip();
  for (const e of new AdmZip(s.dialog.exportPath).getEntries()) reZipped.addFile(e.entryName, e.getData());
  const compressed = join(s.home, "recompressed.zip");
  reZipped.writeZip(compressed);
  const zip = openZip(compressed, s.host.files, 1024 * 1024 * 1024);
  zip.close();

  const t = setup("obj-host-c-");
  t.dialog.importPath = compressed;
  const r = await t.run(A.import);
  assert.equal(r?.ok, true, String(r?.error));
  for (const f of files) assert.equal(sha(readFileSync(join(t.dataRoot, "files", "objects", f.objectId, f.storedName))), f.sha256);

  // Broken compressed data is refused - not left waiting - and leaves nothing.
  const broken = readFileSync(compressed);
  const photo = files[1] as FileRecord;
  const nameAt = broken.indexOf(Buffer.from(`files/${photo.objectId}/${photo.storedName}`));
  assert.equal(broken.readUInt32LE(nameAt - 30), 0x04034b50);
  assert.equal(broken.readUInt16LE(nameAt - 30 + 8), 8, "the photo entry is deflated");
  const dataAt = nameAt + broken.readUInt16LE(nameAt - 30 + 26) + broken.readUInt16LE(nameAt - 30 + 28);
  broken[dataAt] = 0xff;
  const brokenPath = join(s.home, "broken.zip");
  writeFileSync(brokenPath, broken);
  const u = setup("obj-host-g-");
  u.dialog.importPath = brokenPath;
  const refused = await u.run(A.import);
  assert.equal(refused?.ok, false);
  assert.deepEqual(walk(join(u.dataRoot, "files", "objects")).filter((p) => !p.endsWith("/")), []);
  assert.deepEqual(u.call(OBJECT_CHANNELS.list), { ok: true, value: [] });
});

test("export refuses DexNest's data (directly and through a link), and stops if a stored file changed", async () => {
  const s = setup();
  const { files } = await populated(s);
  s.dialog.exportPath = join(s.dataRoot, "backups", "out.zip");
  assert.equal((await s.run(A.export))?.ok, false);
  const link = join(s.home, "backups-link");
  makeTestLink(join(s.dataRoot, "files"), link);
  s.dialog.exportPath = join(link, "out.zip");
  assert.equal((await s.run(A.export))?.ok, false);
  assert.equal(existsSync(join(s.dataRoot, "files", "out.zip")), false);

  const f = files[0] as FileRecord;
  writeFileSync(join(s.dataRoot, "files", "objects", f.objectId, f.storedName), "tampered");
  s.dialog.exportPath = join(s.home, "out.zip");
  await assert.rejects(() => s.run(A.export) as Promise<unknown>, /changed since it was attached/);
  assert.equal(existsSync(s.dialog.exportPath), false);
  assert.equal(existsSync(`${s.dialog.exportPath}.part`), false);
  assert.equal(s.objectEvents().includes("object.export_created"), false);
});

test("zip-slip: entry names are never paths, and a manifest naming one is refused", async () => {
  const s = setup();
  const { files } = await populated(s);
  s.dialog.exportPath = join(s.home, "out.zip");
  await s.run(A.export);
  const src = new AdmZip(s.dialog.exportPath);
  const json = src.readAsText(EXPORT_JSON_NAME);
  const entries = src.getEntries().map((e) => ({ name: e.entryName, data: e.getData() }));

  // Extra hostile entries alongside a valid export are ignored.
  const hostile = join(s.home, "hostile.zip");
  await writeZip(hostile, [
    ...entries,
    { name: "../../escape.txt", data: Buffer.from(MARK) },
    { name: "/tmp/absolute-escape.txt", data: Buffer.from(MARK) },
    { name: "files/../../../escape2.txt", data: Buffer.from(MARK) }
  ]);
  const t = setup("obj-host-d-");
  t.dialog.importPath = hostile;
  const r = await t.run(A.import);
  assert.equal(r?.ok, true, String(r?.error));
  assert.deepEqual(walk(t.base).filter((p) => p.includes("escape")), []);
  assert.equal(existsSync("/tmp/absolute-escape.txt"), false);
  assert.deepEqual(walk(join(t.dataRoot, "files", "objects")).sort(), files.map((f) => `${f.objectId}/${f.storedName}`).sort());

  // A manifest whose file row points outside is refused before anything is copied.
  const data = JSON.parse(json) as { files: { storedName: string }[] };
  (data.files[0] as { storedName: string }).storedName = "../../escape.txt";
  const bad = join(s.home, "bad.zip");
  await writeZip(bad, [{ name: EXPORT_JSON_NAME, data: Buffer.from(JSON.stringify(data)) }, { name: "files/../../escape.txt", data: Buffer.from(MARK) }]);
  const u = setup("obj-host-e-");
  u.dialog.importPath = bad;
  const refused = await u.run(A.import);
  assert.equal(refused?.ok, false);
  assert.deepEqual(walk(u.base).filter((p) => p.includes("escape")), []);
  assert.deepEqual(walk(join(u.dataRoot, "files", "objects")), []);
});

test("import refuses damaged bytes, duplicate names, DexNest's data and non-zips, leaving nothing behind", async () => {
  const s = setup();
  await populated(s);
  s.dialog.exportPath = join(s.home, "out.zip");
  await s.run(A.export);
  const good = readFileSync(s.dialog.exportPath);

  // Flip a byte inside the photo's data.
  const damaged = Buffer.from(good);
  const at = damaged.indexOf(Buffer.alloc(64, 7));
  assert.ok(at > 0);
  damaged[at + 10] = 8;
  const damagedPath = join(s.home, "damaged.zip");
  writeFileSync(damagedPath, damaged);

  const src = new AdmZip(s.dialog.exportPath);
  const entries = src.getEntries().map((e) => ({ name: e.entryName, data: e.getData() }));
  const dupPath = join(s.home, "dup.zip");
  await writeZip(dupPath, [...entries, entries[entries.length - 1] as { name: string; data: Buffer }]);

  const notZip = join(s.home, "note.zip");
  writeFileSync(notZip, `${MARK} not a zip`);

  const t = setup("obj-host-f-");
  for (const [path, expected] of [
    [damagedPath, /damaged|does not match/],
    [dupPath, /same name twice/],
    [notZip, /not a zip/],
    [join(t.dataRoot, "files", "vault", "secret.txt"), /inside DexNest's data/],
    [join(s.home, "missing.zip"), /does not exist/]
  ] as const) {
    t.dialog.importPath = path;
    const r = await t.run(A.import);
    assert.equal(r?.ok, false, path);
    assert.match(String(r?.error), expected, path);
  }
  assert.deepEqual(walk(join(t.dataRoot, "files", "objects")), []);
  assert.deepEqual(t.call(OBJECT_CHANNELS.list), { ok: true, value: [] });
  assert.equal(t.objectEvents().includes("object.import_completed"), false);
});

test("hostile zips: a compression bomb and an oversized manifest are refused without writing or reading them", async () => {
  const s = setup();
  const { files } = await populated(s);
  s.dialog.exportPath = join(s.home, "out.zip");
  await s.run(A.export);
  const photo = files[1] as FileRecord;
  const photoName = `files/${photo.objectId}/${photo.storedName}`;

  // The photo entry, deflated from 20 MB of zeros but declaring its real size (70,000 bytes).
  const bomb = new AdmZip();
  for (const e of new AdmZip(s.dialog.exportPath).getEntries()) bomb.addFile(e.entryName, e.entryName === photoName ? Buffer.alloc(20 * 1024 * 1024) : e.getData());
  const bombBuf = bomb.toBuffer();
  const declare = (buf: Buffer, name: string, size: number) => {
    const nameBytes = Buffer.from(name);
    for (let at = buf.indexOf(nameBytes); at >= 0; at = buf.indexOf(nameBytes, at + 1)) {
      if (at >= 30 && buf.readUInt32LE(at - 30) === 0x04034b50) buf.writeUInt32LE(size, at - 30 + 22);
      if (at >= 46 && buf.readUInt32LE(at - 46) === 0x02014b50) buf.writeUInt32LE(size, at - 46 + 24);
    }
  };
  declare(bombBuf, photoName, photo.sizeBytes);
  const bombPath = join(s.home, "bomb.zip");
  writeFileSync(bombPath, bombBuf);

  // The manifest claiming to be 300 MB.
  const big = readFileSync(s.dialog.exportPath);
  declare(big, EXPORT_JSON_NAME, 300 * 1024 * 1024);
  const bigPath = join(s.home, "big-manifest.zip");
  writeFileSync(bigPath, big);

  const t = setup("obj-host-h-");
  t.dialog.importPath = bombPath;
  const r1 = await t.run(A.import);
  assert.equal(r1?.ok, false);
  assert.match(String(r1?.error), /larger than it says|damaged|does not match/);
  t.dialog.importPath = bigPath;
  const r2 = await t.run(A.import);
  assert.equal(r2?.ok, false);
  assert.match(String(r2?.error), /object-os\.json is too large/);
  assert.deepEqual(walk(join(t.dataRoot, "files", "objects")), []);
  assert.deepEqual(t.call(OBJECT_CHANNELS.list), { ok: true, value: [] });
});

// --- privacy -----------------------------------------------------------------------------

test("messages and journal lines never carry the owner's text, even when a refusal quotes it", async () => {
  const s = setup();
  const o = await s.newObject(`${MARK} printer`);
  const first = await s.run(A.measurementAdd, { input: { objectId: o.id, key: "hours", value: 1, unit: MARK } });
  assert.equal(first?.ok, true, String(first?.error));
  const refused = await s.run(A.measurementAdd, { input: { objectId: o.id, key: "hours", value: 2, unit: "h" } });
  assert.equal(refused?.ok, false);
  // The window is told why...
  assert.match(String(refused?.error), new RegExp(MARK));
  // ...the journal is not.
  const line = objectJournalLine(refused ?? { ok: false });
  assert.equal(JSON.stringify(line).includes(MARK), false);
  assert.deepEqual(objectJournalLine({ ok: false, cancelled: true, error: MARK }), { summary: "Cancelled by the owner.", error: null });

  const pdf = join(s.home, `${MARK} manual.pdf`);
  writeFileSync(pdf, "x");
  const results = [
    await s.run(A.purchaseSave, { input: { objectId: o.id, shop: MARK } }),
    await (async () => { s.dialog.attach = pdf; return s.run(A.fileAttach, { objectId: o.id, role: "manual" }); })(),
    await s.run(A.stateSet, { input: { objectId: o.id, key: MARK, value: MARK } }),
    await s.run(A.remindersEnable)
  ];
  for (const r of results) {
    assert.equal(r?.ok, true, String(r?.error));
    assert.equal(JSON.stringify(objectJournalLine(r as NonNullable<typeof r>)).includes(MARK), false);
    assert.equal(String(r?.message).includes(MARK), false);
  }
  assert.equal(s.audit.some((l) => l.includes(MARK)), false);
  const logged = JSON.stringify(s.handle.db.prepare("SELECT * FROM event_log").all());
  assert.equal(logged.includes(MARK), false);
});

test("the delete message counts files and kept components only when there are some (Integration QA F10)", async () => {
  const { deletedMessage } = await import("../src/main/objectOsHost.ts");
  assert.equal(deletedMessage(0, 0), "Object deleted.");
  assert.equal(deletedMessage(2, 0), "Object deleted with 2 files.");
  assert.equal(deletedMessage(0, 1), "Object deleted; 1 component kept.");
  assert.equal(deletedMessage(1, 3), "Object deleted with 1 file; 3 components kept.");
});

// --- where things are (what Finder did) ------------------------------------------

test("locate: a name and a place make an object; the same action moves, lends and returns it", async () => {
  const s = setup();
  const added = await s.run(A.objectLocate, { input: { name: "Passport", location: "black drawer", room: "Bedroom" } });
  assert.equal(added?.ok, true, String(added?.error));
  assert.equal(added?.message, "Saved, with where it is.");
  const id = (added?.value as { id: string }).id;

  const found = s.call(OBJECT_CHANNELS.find, trusted, "passport") as { ok: true; value: { name: string; whereabouts: { room: string } }[] };
  assert.deepEqual(found.value.map((o) => [o.name, o.whereabouts.room]), [["Passport", "Bedroom"]]);
  const there = s.call(OBJECT_CHANNELS.whatIsIn, trusted, "black drawer") as { ok: true; value: { name: string }[] };
  assert.deepEqual(there.value.map((o) => o.name), ["Passport"]);
  assert.deepEqual(s.call(OBJECT_CHANNELS.rooms), ["Bedroom"]);
  assert.equal((s.call(OBJECT_CHANNELS.recentlyLocated) as unknown[]).length, 1);

  const lent = await s.run(A.objectLocate, { input: { objectId: id, lentTo: "Alex" } });
  assert.equal(lent?.message, "Where it is has been updated.");
  const now = s.call(OBJECT_CHANNELS.whereabouts, trusted, id) as { ok: true; value: { status: string; whereabouts: { lentTo: string } } };
  assert.equal(now.value.status, "lent_out");
  assert.equal(now.value.whereabouts.lentTo, "Alex");

  // Not from the Deck or the phone, like every other ObjectOS change.
  assert.equal((await s.run(A.objectLocate, { input: { objectId: id, returned: true } }, "deck"))?.ok, false);
  // A place, a room and a borrower never reach the journal.
  assert.ok(s.audit.every((line) => !/Passport|black drawer|Bedroom|Alex/.test(line)));
});

test("the bridge the old where-is-it commands use: remember, find, look in a place, move, lend, return, forget", () => {
  const s = setup();
  const m = s.host.module;
  const passport = rememberItem(m, { itemName: "Passport", location: "black drawer", room: "Bedroom", tags: ["documents"] });
  rememberItem(m, { itemName: "Charger", location: "nightstand", room: "Bedroom" });
  const bank = rememberItem(m, { itemName: "Power bank", lentTo: "Alex" });
  assert.equal(passport.status, "at_home");
  assert.deepEqual([bank.status, bank.lentTo], ["lent_out", "Alex"]);
  assert.ok(bank.lentAt, "a loan is dated when it starts");

  assert.deepEqual(findItems(m, "passport").map((i) => i.itemName), ["Passport"]);
  assert.deepEqual(findItems(m, "").map((i) => i.itemName), ["Charger", "Passport", "Power bank"], "an empty question lists everything");
  assert.deepEqual(findItems(m, "", "lent_out").map((i) => i.itemName), ["Power bank"]);
  assert.deepEqual(itemsIn(m, "bedroom").map((i) => i.itemName), ["Charger", "Passport"]);
  assert.equal(allItems(m).length, 3);

  const moved = changePlace(m, passport.id, { kind: "moved", location: "safe", room: "Study" });
  assert.deepEqual([moved.location, moved.room, moved.status], ["safe", "Study", "at_home"]);
  assert.equal(changePlace(m, passport.id, { kind: "missing", missing: true }).status, "missing");
  assert.equal(changePlace(m, passport.id, { kind: "missing", missing: false }).status, "at_home");
  assert.deepEqual([changePlace(m, bank.id, { kind: "returned" }).status, changePlace(m, bank.id, { kind: "returned" }).lentTo], ["at_home", null]);
  assert.equal(changePlace(m, bank.id, { kind: "lent", to: "" }).lentTo, "someone", "lent with no name still records that it is out");

  const renamed = reviseItem(m, passport.id, { itemName: "Passport (new)", notes: "renewed" });
  assert.deepEqual([renamed.itemName, renamed.notes, renamed.location], ["Passport (new)", "renewed", "safe"]);
  // Put away, not deleted: it is still an object, and still found.
  assert.equal(changePlace(m, passport.id, { kind: "archived" }).status, "at_home");
  assert.equal(m.store.getObject(passport.id)?.status, "stored");

  forgetItem(m, bank.id);
  assert.deepEqual(findItems(m, "power").length, 0);
  assert.throws(() => changePlace(m, "AAAAAAAA", { kind: "returned" }));
});

test("Finder's items move into ObjectOS with nothing dropped", () => {
  const s = setup();
  const m = s.host.module;
  const result = migrateFinderItems(m, [
    { id: "finder-item-1", itemName: "Passport", location: "black drawer", room: "Bedroom", container: "black drawer", notes: "in the folder", tags: ["Documents", "ID & travel"], status: "at_home", confidence: "sure" },
    { id: "finder-item-2", itemName: "Power bank", location: "with Alex", tags: ["lent"], status: "lent_out", lentTo: "Alex", lentAt: "2026-03-01T10:00:00.000Z" },
    { id: "finder-item-3", itemName: "Umbrella", location: "Unknown location", tags: [], status: "missing", confidence: "old" },
    { id: "finder-item-4", itemName: "Old phone", location: "attic box", tags: [], status: "archived", confidence: "maybe" },
    { id: "finder-item-5", itemName: "", location: "shelf", tags: [], status: "at_home" }
  ]);
  assert.deepEqual(result, { moved: 5, failed: [] });

  const by = new Map(allItems(m).map((i) => [i.itemName, i]));
  assert.deepEqual([by.get("Passport")?.location, by.get("Passport")?.room, by.get("Passport")?.container, by.get("Passport")?.notes], ["black drawer", "Bedroom", "black drawer", "in the folder"]);
  assert.deepEqual(by.get("Passport")?.tags, ["documents", "id travel"], "tags are kept, in the characters ObjectOS allows");
  assert.deepEqual([by.get("Power bank")?.status, by.get("Power bank")?.lentTo, by.get("Power bank")?.lentAt], ["lent_out", "Alex", "2026-03-01T10:00:00.000Z"]);
  assert.deepEqual([by.get("Umbrella")?.status, by.get("Umbrella")?.location], ["missing", ""]);
  assert.match(by.get("Umbrella")?.notes ?? "", /this place may be out of date/);
  assert.match(by.get("Old phone")?.notes ?? "", /not sure this is where it is\.\nFinder: archived\./);
  assert.ok(by.has("Untitled item"));
  const phone = m.store.locate({ search: "old phone" })[0];
  assert.equal(phone?.status, "stored");
});
