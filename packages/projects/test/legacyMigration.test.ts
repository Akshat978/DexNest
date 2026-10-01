// The projects.json migration, with synthetic files in temp directories only.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { assertSafeTestPath, createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";

import { projectToLegacy } from "../src/domain/legacy.ts";
import { createLegacyFileSource } from "../src/node/legacyFile.ts";
import { LEGACY_IMPORT_KEY, migrateLegacyProjects, reimportLegacyProjects, type LegacySource } from "../src/store/legacyMigration.ts";
import { createProjectsStore, runProjectsMigrations } from "../src/store/store.ts";

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function setup(content?: string) {
  const dir = assertSafeTestPath(mkdtempSync(join(tmpdir(), "dexnest-projects-legacy-")));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const settings = join(dir, "settings");
  const file = join(settings, "projects.json");
  const backupDir = join(settings, "backups");
  if (content !== undefined) {
    mkdirSync(settings, { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  const handle = createTestDatabase("dexnest-projects-db-");
  cleanup.push(() => handle.dispose());
  runProjectsMigrations(handle.db);
  let stampN = 0;
  const source = createLegacyFileSource({ file, backupDir, stamp: () => `stamp${++stampN}` });
  return { dir, settings, file, backupDir, handle, store: createProjectsStore(handle.db), source };
}

let c = 0;
const ctx = () => ({ now: "2026-10-01T00:00:00.000Z", newCommandId: () => `cmd_${++c}` });

const ENTRIES = [
  {
    id: "dexnest",
    name: "DexNest",
    path: "D:\\DeskNest",
    description: "the app",
    accent: "dev",
    commands: { start: "pnpm dev", build: "pnpm build", test: "pnpm test", typecheck: "pnpm typecheck", custom: "" },
    urls: ["http://localhost:5173"],
    notes: "",
    ports: [5173, 8787],
    stopCommand: "",
    healthUrl: "http://localhost:5173",
    projectType: "local_app",
    folders: [{ label: "Root", path: "D:\\DeskNest" }, { label: "Desktop", path: "D:\\DeskNest\\apps\\desktop" }],
    links: [{ label: "Repo", url: "https://github.com/me/dexnest" }],
    commandList: [{ id: "cmd_abc", label: "Lint", command: "pnpm lint" }, { id: "deploy", label: "Deploy", command: "x", requiresConfirmation: true }],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    lastOpenedAt: "2025-07-01T00:00:00.000Z",
    somethingNewer: { v: 2 }
  },
  { id: "blog", name: "Blog", path: "C:\\code\\blog", description: "", accent: "dev", commands: { start: "", build: "", test: "", typecheck: "", custom: "" }, urls: [], notes: "", createdAt: "2025-02-01T00:00:00.000Z", updatedAt: "2025-02-01T00:00:00.000Z" }
];
const TEXT = `${JSON.stringify(ENTRIES, null, 2)}\n`;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("imports every project with every field, keeps a verified backup, leaves the original untouched", () => {
  const s = setup(TEXT);
  const result = migrateLegacyProjects(s.handle.db, s.store, s.source, ctx());
  assert.equal(result.kind, "imported");
  if (result.kind !== "imported") return;
  assert.equal(result.count, 2);
  assert.equal(readFileSync(s.file, "utf8"), TEXT, "original is byte-for-byte unchanged");
  assert.equal(readFileSync(result.backupPath, "utf8"), TEXT);
  assert.equal(result.sha256, sha(TEXT));
  assert.ok(result.backupPath.startsWith(s.backupDir));
  // Every original field comes back through the old shape - nothing lost.
  const back = s.store.list({ includeArchived: true }).map(projectToLegacy).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(back, [...ENTRIES].sort((a, b) => a.id.localeCompare(b.id)));
});

test("running it again does nothing (idempotent), and survives close/reopen", () => {
  const s = setup(TEXT);
  migrateLegacyProjects(s.handle.db, s.store, s.source, ctx());
  const listed = s.store.list();
  s.handle.close();
  const again = s.handle.reopen();
  cleanup.push(() => again.close());
  const store = createProjectsStore(again.db);
  assert.deepEqual(migrateLegacyProjects(again.db, store, s.source, ctx()), { kind: "already", changedSinceImport: false });
  assert.deepEqual(store.list(), listed);
  assert.equal(readdirSync(s.backupDir).length, 1, "no second backup");
});

test("a changed projects.json is reported, never merged by itself; reimport adds only what is new", () => {
  const s = setup(TEXT);
  migrateLegacyProjects(s.handle.db, s.store, s.source, ctx());
  const changed = [...ENTRIES, { id: "new-one", name: "New One", path: "/n" }, { ...ENTRIES[1], name: "Blog renamed in the file" }];
  writeFileSync(s.file, JSON.stringify(changed), "utf8");
  assert.deepEqual(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()), { kind: "already", changedSinceImport: true });
  assert.equal(s.store.list().length, 2);

  const re = reimportLegacyProjects(s.handle.db, s.store, s.source, ctx());
  assert.equal(re.kind, "imported");
  if (re.kind !== "imported") return;
  assert.deepEqual(re.added, ["new-one"]);
  assert.equal(re.alreadyPresent, 3);
  assert.equal(s.store.get("blog")!.name, "Blog", "existing projects are never overwritten");
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()).kind, "already");
  assert.deepEqual(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()), { kind: "already", changedSinceImport: false });
});

test("a corrupt file imports nothing and marks nothing, so a fixed file imports next time", () => {
  const s = setup("[{ \"id\": \"x\", ");
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()).kind, "corrupt");
  assert.equal(s.store.getMeta(LEGACY_IMPORT_KEY), null);
  assert.equal(readFileSync(s.file, "utf8"), "[{ \"id\": \"x\", ", "left exactly as it was");
  assert.equal(existsSync(s.backupDir), false);
  writeFileSync(s.file, TEXT, "utf8");
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()).kind, "imported");
});

test("an object instead of a list is corrupt too; a BOM is tolerated", () => {
  const s = setup("{\"projects\": []}");
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()).kind, "corrupt");
  writeFileSync(s.file, `\uFEFF${TEXT}`, "utf8");
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()).kind, "imported");
});

test("no projects.json: nothing to import, marked so a later file is reported rather than auto-imported", () => {
  const s = setup();
  assert.deepEqual(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()), { kind: "absent" });
  mkdirSync(s.settings, { recursive: true });
  writeFileSync(s.file, TEXT, "utf8");
  assert.deepEqual(migrateLegacyProjects(s.handle.db, s.store, s.source, ctx()), { kind: "already", changedSinceImport: true });
  assert.equal(s.store.list().length, 0);
});

test("if the backup can't be written or verified, nothing is imported", () => {
  const s = setup(TEXT);
  const failing: LegacySource = { read: () => s.source.read(), backup: () => { throw new Error("disk full"); } };
  assert.throws(() => migrateLegacyProjects(s.handle.db, s.store, failing, ctx()), /disk full/);
  assert.equal(s.store.list().length, 0);
  assert.equal(s.store.getMeta(LEGACY_IMPORT_KEY), null);
  const lying: LegacySource = { read: () => s.source.read(), backup: (text) => createLegacyFileSource({ file: s.file, backupDir: s.backupDir }).backup(text, "0".repeat(64)) };
  assert.throws(() => migrateLegacyProjects(s.handle.db, s.store, lying, ctx()), /does not match/);
  assert.equal(s.store.list().length, 0);
});

test("a crash after the backup but before the import just runs again: one import, no duplicates", () => {
  const s = setup(TEXT);
  let crashed = false;
  const crashing: LegacySource = {
    read: () => s.source.read(),
    backup: (text, hash) => {
      const path = s.source.backup(text, hash);
      if (!crashed) {
        crashed = true;
        throw new Error("power cut");
      }
      return path;
    }
  };
  assert.throws(() => migrateLegacyProjects(s.handle.db, s.store, crashing, ctx()), /power cut/);
  assert.equal(migrateLegacyProjects(s.handle.db, s.store, crashing, ctx()).kind, "imported");
  assert.equal(s.store.list().length, 2);
  assert.equal(readdirSync(s.backupDir).length, 2, "earlier backups are never overwritten");
});

test("a failure inside the import transaction leaves no projects and no marker", () => {
  const s = setup(TEXT);
  const store = { ...s.store, saveMany: (projects: Parameters<typeof s.store.saveMany>[0]) => { s.store.saveMany(projects.slice(0, 1)); throw new Error("disk I/O"); } };
  assert.throws(() => migrateLegacyProjects(s.handle.db, store, s.source, ctx()), /disk I\/O/);
  assert.equal(s.store.list().length, 0, "the first project was rolled back with the rest");
  assert.equal(s.store.getMeta(LEGACY_IMPORT_KEY), null);
});

test("ids already in the database are not overwritten by the import", () => {
  const s = setup(TEXT);
  const existing = { ...s.store, ids: () => new Set(["dexnest"]) };
  const result = migrateLegacyProjects(s.handle.db, existing, s.source, ctx());
  assert.equal(result.kind, "imported");
  assert.deepEqual(s.store.list().map((p) => p.id).sort(), ["blog", "dexnest-2"]);
});
