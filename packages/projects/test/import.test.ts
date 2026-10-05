// "Import projects": every repository under a chosen folder, in one go.
// Synthetic folders in temp directories only; the walk is a stand-in here (the
// real one is Developer Intelligence's, tested with the desktop host).

import { strict as assert } from "node:assert";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createDataBoundary, createEventLog, runFoundationMigrations } from "@dexnest/foundation";
import { createTestDatabase, makeTestLink, type TestDatabase } from "@dexnest/foundation/testing";

import { MAX_IMPORT_ROOTS, normaliseProjectsSettings } from "../src/domain/settings.ts";
import { scanFoldersForImport, type FolderScanPort } from "../src/inspect/inspect.ts";
import { createProjectsModule, type ProjectsModule } from "../src/module/runtime.ts";
import { createNodeInspectFs } from "../src/node/inspectFs.ts";
import { createLegacyFileSource } from "../src/node/legacyFile.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

interface Rig {
  b: Sandbox;
  db: TestDatabase;
  module: ProjectsModule;
  dataRoot: string;
  code: string;
  events: ReturnType<typeof createEventLog>;
  scans: string[][];
  /** What the stand-in walk reports, per root. */
  found: Map<string, string[]>;
  settings: { value: unknown };
}

let rigs: Rig[] = [];
afterEach(() => {
  for (const r of rigs) {
    r.module.stop();
    r.db.dispose();
    r.b.dispose();
  }
  rigs = [];
});

function repo(r: Rig, ...parts: string[]): string {
  const dir = join(r.code, ...parts);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# synthetic\n");
  return dir;
}

function rig(): Rig {
  const b = sandbox("dexnest-import-");
  const dataRoot = join(b.root, "DeskNest", "local-data");
  mkdirSync(join(dataRoot, "files", "vault"), { recursive: true });
  const code = join(b.root, "code");
  mkdirSync(code, { recursive: true });
  const db = createTestDatabase("dexnest-import-db-");
  runFoundationMigrations(db.db);
  const events = createEventLog(db.db);
  const boundary = createDataBoundary({ dataRoot, realpath: realpathSync.native });
  const r = { b, db, dataRoot, code, events, scans: [], found: new Map(), settings: { value: {} } } as unknown as Rig;
  const folderScan: FolderScanPort = {
    async scan(roots) {
      r.scans.push([...roots]);
      return { repositories: roots.flatMap((root) => (r.found.get(root) ?? []).map((path) => ({ path, displayName: null }))), truncated: false, unreadable: 0 };
    }
  };
  r.module = createProjectsModule({
    database: db.db,
    events,
    reader: b.reader(),
    gitOps: {
      preview: async () => ({ refused: true, refusal: { refused: true, kind: "x", code: "invalid_request", reason: "no", offers: [] } }),
      execute: async () => { throw new Error("not in this test"); },
      cancel: () => false,
      isBusy: () => false,
      fetchAll: async () => [],
      pullAll: async () => ({ pulled: [], skipped: [] }),
      recoverInterrupted: () => [],
      clone: async () => ({ status: "refused", reason: "not in this test" })
    },
    inspectFs: createNodeInspectFs(),
    isSensitive: (p) => boundary.isSensitive(p),
    launch: { env: () => ({ platform: process.platform, env: {}, exists: () => false }), openPath: async () => null, openExternal: async () => undefined, spawnDetached: () => ({ ok: true }) },
    folderScan,
    scheduler: { schedule: () => () => undefined, runNow: async () => undefined },
    settings: { read: () => r.settings.value, write: (value) => { r.settings.value = value; } },
    legacy: createLegacyFileSource({ file: join(dataRoot, "settings", "projects.json"), backupDir: join(dataRoot, "settings", "backups") })
  });
  rigs.push(r);
  return r;
}

test("scan: every repository found, new ones first, already-added ones marked and never ticked twice", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const b = repo(r, "work", "beta");
  const c = repo(r, "work", "client", "gamma");
  r.found.set(r.code, [c, a, b]);
  const added = await r.module.add({ path: b, name: "Beta (mine)" }, "wizard");
  assert.equal(added.ok, true);

  const result = await r.module.scanFolders([r.code]);
  assert.deepEqual(result.roots, [r.code]);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.candidates.map((x) => [x.name, x.existing?.name ?? null]), [["alpha", null], ["gamma", null], ["beta", "Beta (mine)"]]);
});

test("scan: folders inside DexNest's data are refused before any walk - by path and through a junction", async () => {
  const r = rig();
  const sneaky = join(r.b.root, "innocent");
  makeTestLink(r.dataRoot, sneaky);
  const file = join(r.code, "notes.txt");
  writeFileSync(file, "x");
  const result = await r.module.scanFolders([r.dataRoot, join(r.dataRoot, "files"), sneaky, file, join(r.code, "missing")]);
  assert.deepEqual(result.roots, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.refused.length, 5);
  assert.equal(result.refused.filter((x) => /DexNest's own data folder/.test(x.reason)).length, 3, "the data root, a folder in it, and a junction to it");
  assert.deepEqual(r.scans, [], "nothing was walked");
});

test("scan: a repository the walk reports inside the data root, or twice through a link, is shown at most once and never from the data root", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const alias = join(r.b.root, "alpha-link");
  makeTestLink(a, alias);
  const hidden = join(r.dataRoot, "files", "vault", "repo");
  mkdirSync(join(hidden, ".git"), { recursive: true });
  r.found.set(r.code, [a, alias, hidden]);
  const result = await r.module.scanFolders([r.code]);
  assert.deepEqual(result.candidates.map((x) => x.name), ["alpha"]);
});

test("import: the chosen repositories become projects in one go, each with an event; repeats and refusals are reported", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const b = repo(r, "beta");
  const result = await r.module.importFolders([a, b, a, join(r.dataRoot, "files")]);
  assert.deepEqual(result.added.map((p) => p.name).sort(), ["alpha", "beta"]);
  assert.equal(result.skipped.length, 2, "the repeat and the data folder");
  const events = r.events.query({ stream: "projects", types: ["projects.project.added"] });
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => (e.payload as { source: string }).source === "folder_import"));
  // Scanning again shows both as already added.
  r.found.set(r.code, [a, b]);
  const again = await r.module.scanFolders([r.code]);
  assert.ok(again.candidates.every((x) => x.existing !== null));
});

test("import through the registered action", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const outcome = await r.module.runAction("projects.import_folder", "module_ui", { paths: [a] });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.message, "Imported 1; 0 skipped.");
  assert.equal(r.module.list().length, 1);
});

test("the folders looked in are remembered, newest first, without repeats, up to five", async () => {
  const r = rig();
  const roots = Array.from({ length: 7 }, (_, i) => {
    const dir = join(r.code, `root${i}`);
    mkdirSync(dir);
    return dir;
  });
  for (const root of roots) await r.module.scanFolders([root]);
  await r.module.scanFolders([roots[3]!]);
  const saved = r.module.getSettings().importRoots;
  assert.equal(saved.length, MAX_IMPORT_ROOTS);
  assert.deepEqual(saved, [roots[3], roots[6], roots[5], roots[4], roots[2]]);
  // A refused folder is never remembered.
  await r.module.scanFolders([r.dataRoot]);
  assert.equal(r.module.getSettings().importRoots[0], roots[3]);
  // Settings read back from disk are cleaned.
  assert.deepEqual(normaliseProjectsSettings({ importRoots: [" D:\\a ", "D:\\a", 3, ""] }).importRoots, ["D:\\a"]);
});

test("without a walk, scanning says so instead of pretending nothing was found", async () => {
  const deps = { fs: createNodeInspectFs(), isSensitive: () => false, projects: [] };
  const empty: FolderScanPort = { scan: async () => ({ repositories: [], truncated: true, unreadable: 2 }) };
  const b = sandbox("dexnest-import-plain-");
  try {
    const result = await scanFoldersForImport([b.root], empty, deps);
    assert.equal(result.truncated, true);
    assert.equal(result.unreadable, 2);
  } finally {
    b.dispose();
  }
});

// --- watched folders ---------------------------------------------------------------

test("watching: off unless asked for, and only a remembered folder can be watched", () => {
  assert.deepEqual(normaliseProjectsSettings({}).watchedRoots, []);
  assert.deepEqual(normaliseProjectsSettings(null).watchSkipped, []);
  const s = normaliseProjectsSettings({ importRoots: ["D:\code", "D:\work"], watchedRoots: ["D:\code", "C:\Windows", "d:\WORK\\", "D:\code", 7, ""] });
  assert.deepEqual(s.watchedRoots, ["D:\code", "d:\WORK\\"], "a folder that is not remembered is dropped; case and a trailing slash do not matter");
  // Forgetting the folder stops the watching.
  assert.deepEqual(normaliseProjectsSettings({ importRoots: ["D:\work"], watchedRoots: ["D:\code"] }).watchedRoots, []);
  assert.deepEqual(normaliseProjectsSettings({ watchSkipped: ["a", "a", " b ", 3] }).watchSkipped, ["a", "b"]);
});

test("watching: a look adds the repositories that are new, each with an event that says where it came from", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const b = repo(r, "beta");
  r.found.set(r.code, [a, b]);
  await r.module.add({ path: a }, "wizard");

  // Nothing is watched: nothing is walked.
  let check = await r.module.checkWatchedFolders({ force: true });
  assert.deepEqual([check.ran, check.added.length, r.scans.length], [false, 0, 0]);

  await r.module.scanFolders([r.code]);
  r.module.updateSettings({ watchedRoots: [r.code] });
  r.scans.length = 0;
  check = await r.module.checkWatchedFolders();
  assert.equal(check.ran, true);
  assert.deepEqual(check.added.map((p) => p.name), ["beta"], "alpha was a project already");
  assert.deepEqual(r.scans, [[r.code]]);
  assert.deepEqual(r.module.list().map((p) => p.project.name).sort(), ["alpha", "beta"]);
  const event = r.events.query({ stream: "projects" }).filter((e) => e.type === "projects.project.added").pop();
  assert.deepEqual([event?.source, (event?.payload as { source?: string }).source], ["system", "watched_folder"]);
});

test("watching: not repeated within ten minutes unless asked, so opening Projects again costs nothing", async () => {
  const r = rig();
  r.found.set(r.code, [repo(r, "alpha")]);
  await r.module.scanFolders([r.code]);
  r.module.updateSettings({ watchedRoots: [r.code] });
  r.scans.length = 0;
  assert.equal((await r.module.checkWatchedFolders()).ran, true);
  const again = await r.module.checkWatchedFolders();
  assert.deepEqual([again.ran, again.added.length], [false, 0]);
  assert.equal(r.scans.length, 1, "the second look walked nothing");
  assert.equal((await r.module.checkWatchedFolders({ force: true })).ran, true, "\"Check now\" looks anyway");
  assert.equal(r.scans.length, 2);
});

test("watching: a project you remove is not added back, and an archived one is left alone", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const b = repo(r, "beta");
  const c = repo(r, "gamma");
  r.found.set(r.code, [a, b, c]);
  await r.module.scanFolders([r.code]);
  r.module.updateSettings({ watchedRoots: [r.code] });
  const first = await r.module.checkWatchedFolders({ force: true });
  assert.equal(first.added.length, 3);

  const alpha = first.added.find((p) => p.name === "alpha")!;
  const beta = first.added.find((p) => p.name === "beta")!;
  // Removing asks for the project to be archived first; a refused removal remembers nothing.
  assert.throws(() => r.module.remove(alpha.id), /Archive a project before removing it/);
  assert.deepEqual(normaliseProjectsSettings(r.settings.value).watchSkipped, []);
  r.module.archive(alpha.id);
  r.module.remove(alpha.id);
  r.module.archive(beta.id);
  assert.equal(normaliseProjectsSettings(r.settings.value).watchSkipped.length, 1);

  const second = await r.module.checkWatchedFolders({ force: true });
  assert.deepEqual(second.added, [], "neither comes back");
  assert.equal(second.skipped, 1, "the removed one was seen and left out");
  assert.deepEqual(r.module.list({ includeArchived: true }).map((p) => p.project.name).sort(), ["beta", "gamma"]);

  // Adding it again by hand still works: the skip list only stops the automatic add.
  assert.equal((await r.module.add({ path: a }, "wizard")).ok, true);
});

test("watching: a project removed from a folder that is not watched is not remembered", async () => {
  const r = rig();
  const a = repo(r, "alpha");
  const added = await r.module.add({ path: a }, "wizard");
  assert.equal(added.ok, true);
  if (added.ok) {
    r.module.archive(added.project.id);
    r.module.remove(added.project.id);
  }
  assert.deepEqual(normaliseProjectsSettings(r.settings.value).watchSkipped, []);
});

test("watching: without a walk it does nothing, and says so by not running", async () => {
  const b = sandbox("dexnest-import-nowatch-");
  const db = createTestDatabase("dexnest-import-nowatch-db-");
  try {
    runFoundationMigrations(db.db);
    let stored: unknown = { importRoots: [b.root], watchedRoots: [b.root] };
    const module = createProjectsModule({
      database: db.db,
      events: createEventLog(db.db),
      reader: b.reader(),
      gitOps: { preview: async () => ({ refused: true, refusal: { refused: true, kind: "x", code: "invalid_request", reason: "no", offers: [] } }), execute: async () => { throw new Error("no"); }, cancel: () => false, isBusy: () => false, fetchAll: async () => [], pullAll: async () => ({ pulled: [], skipped: [] }), recoverInterrupted: () => [], clone: async () => ({ status: "refused", reason: "no" }) },
      inspectFs: createNodeInspectFs(),
      isSensitive: () => false,
      launch: { env: () => ({ platform: process.platform, env: {}, exists: () => false }), openPath: async () => null, openExternal: async () => undefined, spawnDetached: () => ({ ok: true }) },
      scheduler: { schedule: () => () => undefined, runNow: async () => undefined },
      settings: { read: () => stored, write: (value) => { stored = value; } },
      legacy: createLegacyFileSource({ file: join(b.root, "projects.json"), backupDir: join(b.root, "backups") })
    });
    assert.equal((await module.checkWatchedFolders({ force: true })).ran, false);
    module.stop();
  } finally {
    db.dispose();
    b.dispose();
  }
});
