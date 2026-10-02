/**
 * GhostOS's main-process host.
 *
 * Real SQLite (node:sqlite) in a temp directory with the foundation's event log,
 * real files for the data-boundary, export and import checks, synthetic data
 * only, and stand-ins for ipcMain, the window and the file dialogs that behave
 * like Electron's where the host relies on them.
 */

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, createHostScheduler, runFoundationMigrations, type SchedulerTimers } from "@dexnest/foundation";
import { assertSafeTestPath, createTestDatabase, type TestDatabase, makeTestLink } from "@dexnest/foundation/testing";
import { seededActions } from "@dexnest/action-registry";
import {
  createGhostOsHost,
  GHOST_CHANNELS,
  runGhostOsAction,
  type DiStoresLike,
  type GhostFiles,
  type GhostIpcEvent,
  type GhostIpcMain
} from "../src/main/ghostOsHost.ts";

type Listener = (event: GhostIpcEvent, ...args: unknown[]) => unknown;

const MARK = "OWNER-TEXT-5d1e";

function fakeIpc(): GhostIpcMain & { handlers: Map<string, Listener> } {
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
const trusted: GhostIpcEvent = { sender: webContents, senderFrame: mainFrame };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
  window.destroyed = false;
});

interface Setup {
  handle: TestDatabase;
  base: string;
  dataRoot: string;
  host: ReturnType<typeof createGhostOsHost>;
  ipc: ReturnType<typeof fakeIpc>;
  timers: ReturnType<typeof heldTimers>;
  audit: string[];
  reads: string[];
  techCalls: unknown[];
  dialog: { exportPath: string | null; importPath: string | null };
  files: GhostFiles & { failWrites: boolean };
  call(channel: string, event?: GhostIpcEvent, ...args: unknown[]): unknown;
  run(actionId: string, params?: Record<string, unknown>): ReturnType<typeof runGhostOsAction>;
  ghostEvents(): string[];
}

function setup(options: { di?: DiStoresLike | null } = {}): Setup {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), "ghost-host-")));
  const dataRoot = join(base, "dexnest-data");
  mkdirSync(join(dataRoot, "files", "vault"), { recursive: true });
  writeFileSync(join(dataRoot, "files", "vault", "secret.txt"), `${MARK} vault`);
  const handle = createTestDatabase("ghost-host-db-");
  cleanups.push(() => { handle.dispose(); rmSync(base, { recursive: true, force: true }); });
  runFoundationMigrations(handle.db);
  const events = createEventLog(handle.db);
  const ipc = fakeIpc();
  const timers = heldTimers();
  const audit: string[] = [];
  const reads: string[] = [];
  const techCalls: unknown[] = [];
  const dialog = { exportPath: null as string | null, importPath: null as string | null };
  const files: GhostFiles & { failWrites: boolean } = {
    failWrites: false,
    writeText(path, text) {
      if (files.failWrites) throw new Error("disk full");
      writeFileSync(path, text, "utf8");
    },
    size: (path) => (existsSync(path) ? statSync(path).size : null),
    readText(path) {
      reads.push(path);
      return readFileSync(path, "utf8");
    }
  };
  const di: DiStoresLike = {
    repositories: {
      async listRepositories() {
        return [{ id: "repo-app", roots: [{ path: join(base, "code", "app"), domain: "windows", note: MARK }], displayName: "app", discoveredAt: "2026-01-01T00:00:00.000Z", remoteUrl: MARK } as never];
      }
    },
    technologies: {
      async listByRepository(repositoryId, opts) {
        techCalls.push([repositoryId, opts]);
        return [{ id: "tf-1", repositoryId, category: "language", name: "TypeScript", version: MARK, evidencePath: "package.json", evidenceKind: "package.json", status: "observed", firstObservedAt: "2026-01-02T00:00:00.000Z", fingerprint: MARK } as never];
      }
    }
  };
  const host = createGhostOsHost({
    database: handle.db,
    events,
    dataRoot,
    otherDataRoots: [],
    scheduler: createHostScheduler({ timers }),
    developerIntelligence: options.di === undefined ? di : options.di,
    ipcMain: ipc,
    getWindow: () => window,
    dialogs: {
      chooseExportPath: async () => dialog.exportPath,
      chooseImportPath: async () => dialog.importPath
    },
    files,
    audit: (summary) => { audit.push(summary); },
    now: () => new Date("2026-06-30T12:00:00.000Z")
  });
  cleanups.push(() => host.dispose());
  return {
    handle,
    base,
    dataRoot,
    host,
    ipc,
    timers,
    audit,
    reads,
    techCalls,
    dialog,
    files,
    call(channel, event = trusted, ...args) {
      const listener = ipc.handlers.get(channel);
      assert.ok(listener, `no handler for ${channel}`);
      return listener(event, ...args);
    },
    run: (actionId, params = {}) => runGhostOsAction(host, actionId, params),
    ghostEvents: () => events.query({ stream: "ghost" }).map((e) => e.type)
  };
}

test("IPC answers only the trusted main frame of a live window", () => {
  const s = setup();
  assert.deepEqual([...s.ipc.handlers.keys()].sort(), Object.values(GHOST_CHANNELS).sort());
  assert.ok(s.call(GHOST_CHANNELS.status));
  const refused = /trusted desktop main frame/;
  assert.throws(() => s.call(GHOST_CHANNELS.status, { sender: {}, senderFrame: mainFrame }), refused);
  assert.throws(() => s.call(GHOST_CHANNELS.status, { sender: webContents, senderFrame: { name: "iframe" } }), refused);
  window.destroyed = true;
  assert.throws(() => s.call(GHOST_CHANNELS.timeline), refused);
});

test("dispose removes every handler", () => {
  const s = setup();
  s.host.dispose();
  assert.equal(s.ipc.handlers.size, 0);
});

test("no timer exists until a source is turned on, and none after it is turned off", async () => {
  const s = setup();
  assert.equal(s.timers.count(), 0);
  assert.equal((await s.run("ghost_os.adapter.enable", { adapterId: "developer_intelligence" }))?.ok, true);
  assert.ok(s.timers.count() > 0);
  assert.equal((await s.run("ghost_os.adapter.disable", { adapterId: "developer_intelligence" }))?.ok, true);
  assert.equal(s.timers.count(), 0);
});

test("without Developer Intelligence there is no source to turn on", async () => {
  const s = setup({ di: null });
  const r = await s.run("ghost_os.adapter.enable", { adapterId: "developer_intelligence" });
  assert.equal(r?.ok, false);
  assert.equal(s.timers.count(), 0);
});

test("a file reference inside DexNest's data is refused, by path and through a link", async () => {
  const s = setup();
  const direct = await s.run("ghost_os.entity.save", { entity: { type: "file", title: "f", details: { path: join(s.dataRoot, "files", "vault", "secret.txt") } } });
  assert.equal(direct?.ok, false);
  assert.match(String(direct?.error), /inside DexNest's data/);

  const link = join(s.base, "innocent-link");
  makeTestLink(join(s.dataRoot, "files"), link);
  const viaLink = await s.run("ghost_os.entity.save", { entity: { type: "file", title: "f", details: { path: join(link, "vault", "secret.txt") } } });
  assert.equal(viaLink?.ok, false);

  const outside = await s.run("ghost_os.entity.save", { entity: { type: "file", title: "f", details: { path: join(s.base, "notes.txt") } } });
  assert.equal(outside?.ok, true);
  // A reference is never opened.
  assert.deepEqual(s.reads, []);
});

test("export writes the chosen file, refuses DexNest's data, and records nothing when the write fails", async () => {
  const s = setup();
  await s.run("ghost_os.entity.save", { entity: { type: "person", title: "Me" } });
  assert.deepEqual(await s.run("ghost_os.export"), { ok: false, cancelled: true, error: "Export cancelled." });

  s.dialog.exportPath = join(s.dataRoot, "backups-export.json");
  assert.equal((await s.run("ghost_os.export"))?.ok, false);
  assert.equal(existsSync(s.dialog.exportPath), false);

  s.dialog.exportPath = join(s.base, "out.json");
  s.files.failWrites = true;
  await assert.rejects(() => s.run("ghost_os.export") as Promise<unknown>, /disk full/);
  assert.equal(s.ghostEvents().includes("ghost.export.created"), false);

  s.files.failWrites = false;
  const ok = await s.run("ghost_os.export");
  assert.equal(ok?.ok, true);
  const written = JSON.parse(readFileSync(s.dialog.exportPath, "utf8")) as { format: string; entities: unknown[] };
  assert.equal(written.format, "dexnest.ghost_os");
  assert.equal(written.entities.length, 1);
  assert.equal(s.ghostEvents().filter((t) => t === "ghost.export.created").length, 1);
});

test("import: owner-picked file only, outside DexNest's data, size-capped before it is read, validated", async () => {
  const s = setup();
  await s.run("ghost_os.entity.save", { entity: { type: "person", title: "Me" } });
  s.dialog.exportPath = join(s.base, "out.json");
  await s.run("ghost_os.export");

  assert.equal((await s.run("ghost_os.import"))?.cancelled, true);

  s.dialog.importPath = join(s.dataRoot, "files", "vault", "secret.txt");
  assert.equal((await s.run("ghost_os.import"))?.ok, false);

  const big = join(s.base, "big.json");
  writeFileSync(big, "x");
  s.host.files.size = () => 65 * 1024 * 1024;
  s.dialog.importPath = big;
  const tooBig = await s.run("ghost_os.import");
  assert.match(String(tooBig?.error), /larger than 64 MB/);
  s.host.files.size = (path) => (existsSync(path) ? statSync(path).size : null);

  s.dialog.importPath = join(s.base, "missing.json");
  assert.equal((await s.run("ghost_os.import"))?.error, "That file does not exist.");

  const notJson = join(s.base, "note.json");
  writeFileSync(notJson, "{ nope");
  s.dialog.importPath = notJson;
  assert.equal((await s.run("ghost_os.import"))?.error, "That file is not JSON.");
  assert.deepEqual(s.reads, [notJson]);

  const other = setup();
  other.dialog.importPath = join(s.base, "out.json");
  const imported = await other.run("ghost_os.import");
  assert.equal(imported?.ok, true, String(imported?.error));
  assert.match(String(imported?.message), /Imported 1 entry/);
});

test("Developer Intelligence reaches GhostOS narrowed to the fields it reads", async () => {
  const s = setup();
  await s.run("ghost_os.adapter.enable", { adapterId: "developer_intelligence" });
  const r = await s.run("ghost_os.adapter.sync");
  assert.equal(r?.ok, true, String(r?.error));
  assert.deepEqual(s.techCalls, [["repo-app", { status: "observed" }]]);
  const dump = JSON.stringify(s.handle.db.prepare("SELECT * FROM ghost_entities").all()) + JSON.stringify(s.handle.db.prepare("SELECT * FROM ghost_relations").all());
  assert.match(dump, /TypeScript/);
  assert.equal(dump.includes(MARK), false);
});

test("every ghost_os action but open has a handler, and messages never carry the owner's text", async () => {
  const s = setup();
  const ids = seededActions.filter((a) => a.moduleId === "ghost_os" && a.id !== "ghost_os.open").map((a) => a.id);
  assert.equal(ids.length, 10);
  for (const id of ids) assert.notEqual(await s.run(id, {}), null, id);
  assert.equal(await s.run("ghost_os.open"), null);

  const saved = await s.run("ghost_os.entity.save", { entity: { type: "memory", title: `${MARK} title`, notes: MARK, details: { text: MARK, occurredAt: "2026-06-01T00:00:00Z" } } });
  assert.equal(saved?.ok, true);
  const id = (saved?.value as { id: string }).id;
  const obs = await s.run("ghost_os.observation.add", { observation: { entityId: id, statement: MARK } });
  const forgot = await s.run("ghost_os.forget", { kind: "entity", id });
  for (const r of [saved, obs, forgot]) {
    assert.equal(r?.ok, true);
    assert.equal(String(r?.message).includes(MARK), false);
  }
  assert.equal(s.audit.some((line) => line.includes(MARK)), false);
});

test("messages: correct plurals, no zero counts (Integration QA F15)", async () => {
  const { plural, sourceOffMessage, forgottenMessage } = await import("../src/main/ghostOsHost.ts");
  assert.equal(plural(1, "entry"), "1 entry");
  assert.equal(plural(0, "entry"), "0 entries");
  assert.equal(plural(2, "entry"), "2 entries");
  assert.equal(plural(2, "connection"), "2 connections");
  assert.equal(plural(2, "day"), "2 days", "a vowel before y keeps -s");
  assert.equal(sourceOffMessage({ entity: 0, relation: 0, observation: 0 }), "Source turned off. It had added nothing.");
  assert.equal(sourceOffMessage({ entity: 3, relation: 0, observation: 5 }), "Source turned off. Removed 3 entries and 5 observations.");
  assert.equal(sourceOffMessage({ entity: 1, relation: 2, observation: 1 }), "Source turned off. Removed 1 entry, 2 connections and 1 observation.");
  assert.equal(forgottenMessage(0), "Forgotten.");
  assert.equal(forgottenMessage(3), "Forgotten, with 3 dependent records.");
});
