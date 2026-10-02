// Phase 10 hardening, read side: many projects at once and a very large
// working tree. Real git, synthetic repositories in temp folders.

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { createDataBoundary, createEventLog, runFoundationMigrations } from "@dexnest/foundation";
import { createTestDatabase } from "@dexnest/foundation/testing";

import { createLegacyFileSource, createNodeInspectFs, createProjectsModule, type GitOpsPort, type GitReader, type ProjectsModule } from "../src/index.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

const cleanup: Array<() => void> = [];
after(() => {
  for (const fn of cleanup.reverse()) fn();
});

const noGitOps: GitOpsPort = {
  preview: async () => ({ refused: true, refusal: { refused: true, kind: "x", code: "invalid_request", reason: "not in this test", offers: [] } }),
  execute: async () => {
    throw new Error("not in this test");
  },
  cancel: () => false,
  isBusy: () => false,
  fetchAll: async () => [],
  pullAll: async () => ({ pulled: [], skipped: [] }),
  recoverInterrupted: () => [],
  clone: async () => ({ status: "refused", reason: "not in this test" })
};

function moduleWith(b: Sandbox, reader: GitReader, legacy?: unknown): ProjectsModule {
  const dataRoot = join(b.root, "DeskNest", "local-data");
  mkdirSync(join(dataRoot, "settings"), { recursive: true });
  if (legacy !== undefined) writeFileSync(join(dataRoot, "settings", "projects.json"), JSON.stringify(legacy));
  const db = createTestDatabase("dexnest-hardening-db-");
  cleanup.push(() => db.dispose());
  runFoundationMigrations(db.db);
  const boundary = createDataBoundary({ dataRoot });
  const module = createProjectsModule({
    database: db.db,
    events: createEventLog(db.db),
    reader,
    gitOps: noGitOps,
    inspectFs: createNodeInspectFs(),
    isSensitive: (p) => boundary.isSensitive(p),
    launch: { env: () => ({ platform: "linux", env: {}, exists: () => false }), openPath: async () => null, openExternal: async () => undefined, spawnDetached: () => ({ ok: true }) },
    scheduler: { schedule: () => () => undefined, runNow: async () => undefined },
    settings: { read: () => ({}), write: () => undefined },
    legacy: createLegacyFileSource({ file: join(dataRoot, "settings", "projects.json"), backupDir: join(dataRoot, "settings", "backups") }),
    platform: "linux"
  });
  module.start();
  return module;
}

test("120 projects: every one is read, never more than four at a time, and the list stays sorted", async () => {
  const b = sandbox("dexnest-hardening-many-");
  cleanup.push(() => b.dispose());
  const { app } = b.origin();
  const inner = b.reader();
  let inFlight = 0;
  let peak = 0;
  const reader: GitReader = {
    ...inner,
    async readRepoState(path, options) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await inner.readRepoState(path, options);
      } finally {
        inFlight -= 1;
      }
    }
  };
  const module = moduleWith(b, reader);
  const ids: string[] = [];
  const first = await module.add({ name: "Real repo", path: app }, "wizard");
  assert.ok(first.ok);
  if (first.ok) ids.push(first.project.id);
  for (let i = 0; i < 119; i += 1) {
    const dir = join(b.root, "many", `project ${String(i).padStart(3, "0")}`);
    mkdirSync(dir, { recursive: true });
    const added = await module.add({ name: `Project ${String(i).padStart(3, "0")}`, path: dir }, "wizard");
    assert.ok(added.ok, `project ${i}`);
    if (added.ok) ids.push(added.project.id);
  }

  const states = await module.repoStates();
  assert.equal(Object.keys(states).length, 120);
  for (const id of ids) assert.ok(states[id] && !("error" in states[id]), `${id} was read`);
  const real = states[ids[0]];
  assert.ok(real && "isRepo" in real && real.isRepo);
  assert.ok(peak >= 2, "reads run in parallel");
  assert.ok(peak <= 4, `at most four reads at once, saw ${peak}`);

  const names = module.list().map((s) => s.project.name);
  assert.equal(names.length, 120);
  assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y)));
});

test("a huge working tree: lists stop at 500 entries and say so, the counts stay exact", async () => {
  const b = sandbox("dexnest-hardening-huge-");
  cleanup.push(() => b.dispose());
  const { app } = b.origin();
  for (let i = 0; i < 1200; i += 1) writeFileSync(join(app, `new-${i}.txt`), `${i}\n`);
  for (let i = 0; i < 600; i += 1) writeFileSync(join(app, `tracked-${i}.txt`), `${i}\n`);
  b.git(app, "add", ...Array.from({ length: 600 }, (_, i) => `tracked-${i}.txt`));
  b.git(app, "commit", "-q", "-m", "many files");
  for (let i = 0; i < 600; i += 1) writeFileSync(join(app, `tracked-${i}.txt`), `changed ${i}\n`);

  const state = await b.reader().readRepoState(app);
  assert.ok(state.isRepo);
  if (!state.isRepo) return;
  const tree = state.workingTree;
  assert.equal(tree.truncated, true);
  assert.equal(tree.untracked.length, 500);
  assert.equal(tree.unstaged.length, 500);
  assert.equal(tree.counts.untracked, 1200, "the count is the real number, not the shown one");
  assert.equal(tree.counts.unstaged, 600);
  assert.equal(tree.counts.staged, 0);
});

// --- Dev dashboard parity: what main.ts still reads through listProjects() -------

test("F1-F5: a projects.json project edited in the new view keeps every old field, its id and command ids; touch shows as lastOpenedAt", async () => {
  const b = sandbox("dexnest-hardening-parity-");
  cleanup.push(() => b.dispose());
  const dir = join(b.root, "shop");
  mkdirSync(dir);
  const entry = {
    id: "shop",
    name: "Shop",
    path: dir,
    description: "the shop",
    accent: "dev",
    commands: { start: "pnpm dev", build: "pnpm build", test: "", typecheck: "", custom: "" },
    urls: ["http://localhost:3000"],
    notes: "remember the env file",
    ports: [3000],
    stopCommand: "pnpm stop",
    logCommand: "pnpm logs",
    logPath: "",
    dockerComposeEnabled: true,
    healthUrl: "http://localhost:3000/health",
    projectType: "live_website",
    folders: [{ label: "Root", path: dir }],
    links: [{ label: "Prod", url: "https://shop.example" }],
    commandList: [{ id: "cmd_deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true }],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    lastOpenedAt: null,
    somethingNewer: { v: 2 }
  };
  const module = moduleWith(b, b.reader(), [entry]);
  const [imported] = module.legacyProjects();
  assert.deepEqual(imported, entry, "F1: the old shape comes back exactly");

  const saved = await module.update("shop", { name: "Shop 2" });
  assert.ok(saved.ok, saved.ok ? "" : saved.reason);
  const [edited] = module.legacyProjects();
  const { name, updatedAt, ...rest } = edited;
  const { name: _n, updatedAt: _u, ...restBefore } = entry;
  assert.equal(name, "Shop 2");
  assert.notEqual(updatedAt, entry.updatedAt);
  assert.deepEqual(rest, restBefore, "F2/F3: id, command ids, notes and unknown fields survive an edit");

  module.touch("shop");
  const touched = module.legacyProjects()[0].lastOpenedAt;
  assert.ok(typeof touched === "string" && touched > "2026-01-01", `F5: lastOpenedAt is set (${touched})`);

  module.archive("shop");
  assert.deepEqual(module.legacyProjects(), [], "F4: an archived project leaves the old list (Deck, voice, search)");
  module.restore("shop");
  assert.equal(module.legacyProjects()[0].id, "shop", "and comes back with the same id");
});
