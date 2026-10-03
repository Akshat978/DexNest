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
