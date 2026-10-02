// The Projects runtime with a fake git-ops port and fake launchers, a real
// database, a real read engine and real repositories.

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createDataBoundary, createEventLog, runFoundationMigrations, type JobOccurrence, type ScheduledJob } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";

import type { ExecuteInput, ExecuteResult, GitOpsPort } from "../src/domain/gitOpsPort.ts";
import { DEFAULT_PROJECTS_SETTINGS, type ProjectsSettings } from "../src/domain/settings.ts";
import { createProjectsModule, type LaunchPort, type ProjectsModule } from "../src/module/runtime.ts";
import { createNodeInspectFs } from "../src/node/inspectFs.ts";
import type { LaunchCommand } from "../src/node/launch.ts";
import { createLegacyFileSource } from "../src/node/legacyFile.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

interface Rig {
  b: Sandbox;
  db: TestDatabase;
  module: ProjectsModule;
  dataRoot: string;
  settingsRoot: string;
  executed: ExecuteInput[];
  spawned: LaunchCommand[];
  opened: string[];
  jobs: ScheduledJob[];
  unscheduled: number;
  saved: ProjectsSettings[];
  events: ReturnType<typeof createEventLog>;
  recovered: number;
  exists: Set<string>;
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

function rig(options: { legacy?: unknown; platform?: NodeJS.Platform } = {}): Rig {
  const b = sandbox("dexnest-runtime-");
  const dataRoot = join(b.root, "DeskNest", "local-data");
  const settingsRoot = join(dataRoot, "settings");
  mkdirSync(settingsRoot, { recursive: true });
  if (options.legacy !== undefined) writeFileSync(join(settingsRoot, "projects.json"), JSON.stringify(options.legacy));
  const db = createTestDatabase("dexnest-runtime-db-");
  runFoundationMigrations(db.db);
  const events = createEventLog(db.db);
  const boundary = createDataBoundary({ dataRoot });
  let settings: unknown = {};
  const r = { b, db, dataRoot, settingsRoot, executed: [], spawned: [], opened: [], jobs: [], unscheduled: 0, saved: [], events, recovered: 0, exists: new Set<string>() } as unknown as Rig;
  const done = (input: ExecuteInput): ExecuteResult => ({
    status: "done",
    opId: "op_1",
    outcome: "succeeded",
    plan: { refused: false, kind: "push", safety: "normal", title: "Push", summary: "Push.", details: [], network: true, confirm: { kind: "none" }, steps: [], undo: null, branch: "main", counts: {}, expectHead: null },
    message: `ran for ${input.source}`,
    errorCode: null,
    output: [],
    undoAvailable: false,
    state: null
  });
  const gitOps: GitOpsPort = {
    preview: async () => ({ refused: true, refusal: { refused: true, kind: "x", code: "invalid_request", reason: "no", offers: [] } }),
    execute: async (input) => {
      r.executed.push(input);
      return done(input);
    },
    cancel: () => false,
    isBusy: () => false,
    fetchAll: async (projects) => projects.map((p) => ({ projectId: p.projectId, result: done({ projectId: p.projectId, path: p.path, request: { kind: "fetch" }, source: "routine" }) })),
    pullAll: async () => ({ pulled: [], skipped: [] }),
    recoverInterrupted: () => {
      r.recovered += 1;
      return [];
    },
    clone: async () => ({ status: "refused", reason: "not in this test" })
  };
  const launch: LaunchPort = {
    env: () => ({ platform: options.platform ?? "win32", env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", PATH: "" }, exists: (p) => r.exists.has(p) }),
    openPath: async (p) => {
      r.opened.push(p);
      return null;
    },
    openExternal: async (url) => {
      r.opened.push(url);
    },
    spawnDetached: (command) => {
      r.spawned.push(command);
      return { ok: true };
    }
  };
  r.module = createProjectsModule({
    database: db.db,
    events,
    reader: b.reader(),
    gitOps,
    inspectFs: createNodeInspectFs(),
    isSensitive: (p) => boundary.isSensitive(p),
    launch,
    scheduler: {
      schedule: (job) => {
        r.jobs.push(job);
        return () => {
          r.unscheduled += 1;
        };
      },
      runNow: async () => undefined
    },
    settings: { read: () => settings, write: (value) => { r.saved.push(value); settings = value; } },
    legacy: createLegacyFileSource({ file: join(settingsRoot, "projects.json"), backupDir: join(settingsRoot, "backups") }),
    platform: "linux"
  });
  rigs.push(r);
  return r;
}

const LEGACY = [{ id: "shop", name: "Shop", path: "/code/shop", description: "", accent: "dev", commands: { start: "pnpm dev", build: "", test: "", typecheck: "", custom: "" }, urls: [], notes: "", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }];

test("start: imports projects.json once (with an event), recovers interrupted operations, schedules nothing by default", () => {
  const r = rig({ legacy: LEGACY });
  const first = r.module.start();
  assert.equal(first.legacy.kind, "imported");
  assert.equal(r.recovered, 1);
  assert.deepEqual(r.jobs, [], "no scheduled fetch unless the owner turns it on");
  assert.deepEqual(r.module.legacyProjects().map((p) => p.id), ["shop"]);
  assert.equal(r.events.query({ stream: "projects", types: ["projects.legacy.imported"] }).length, 1);
  assert.equal(r.module.start().legacy.kind, "already");
  assert.equal(r.events.query({ stream: "projects", types: ["projects.legacy.imported"] }).length, 1);
});

test("scheduled fetch: off by default; on -> one heavy job, never at startup; a slot delivered twice is recorded once", async () => {
  const r = rig();
  r.module.start();
  assert.equal(r.module.getSettings().scheduledFetch.enabled, false);
  r.module.updateSettings({ scheduledFetch: { enabled: true, intervalMinutes: 20 } });
  assert.equal(r.jobs.length, 1);
  const job = r.jobs[0];
  assert.deepEqual([job.id, job.intervalMs, job.heavy, job.runAtStartup], ["scheduled_fetch", 20 * 60_000, true, false]);
  const occurrence: JobOccurrence = { occurrenceId: "slot-1", scheduledAt: "2026-10-02T00:00:00.000Z", trigger: "scheduled" };
  await job.run(occurrence);
  await job.run(occurrence);
  assert.equal(r.events.query({ stream: "projects", types: ["projects.fetch.scheduled"] }).length, 1);
  r.module.updateSettings({ scheduledFetch: { enabled: false } });
  assert.equal(r.unscheduled, 1);
  assert.equal(r.jobs.length, 1);
});

test("triggers are enforced by the runtime: the deck may fetch and push the current project, never discard or delete", async () => {
  const r = rig();
  r.module.start();
  const { app } = r.b.origin();
  const added = await r.module.add({ path: app, name: "App" }, "wizard");
  assert.equal(added.ok, true);
  const id = added.ok ? added.project.id : "";
  for (const actionId of ["projects.git.discard", "projects.git.delete_branch", "projects.git.commit", "projects.git.push", "projects.remove"]) {
    const outcome = await r.module.runAction(actionId, "deck", { projectId: id, request: { kind: "discard", files: ["a"] } });
    assert.equal(outcome.ok, false, actionId);
    assert.match(outcome.message, /can't be started from deck/);
  }
  assert.equal(r.executed.length, 0);
  r.module.touch(id);
  const pushed = await r.module.runAction("projects.git.push_current", "deck", {});
  assert.equal(pushed.ok, true);
  assert.equal(r.executed[0].nonInteractive, true, "never asks");
  assert.deepEqual(r.executed[0].request, { kind: "push" });
  await r.module.runAction("projects.git.fetch", "stream_deck_http", { projectId: id });
  assert.equal(r.executed[1].nonInteractive, true);
  const ui = await r.module.runAction("projects.git.commit", "module_ui", { projectId: id, request: { kind: "push" } });
  assert.match(ui.message, /can only commit/);
  assert.equal((await r.module.runAction("projects.nope", "module_ui", {})).ok, false);
});

test("open: only the project's own folders, never the data root; VS Code via Code.exe; a clear message when it's missing", async () => {
  const r = rig();
  r.module.start();
  const { app } = r.b.origin();
  const added = await r.module.add({ path: app, name: "App", folders: [{ label: "Docs", path: join(app) }] }, "wizard");
  const id = added.ok ? added.project.id : "";
  const missing = await r.module.open(id, "vscode", {}, "module_ui");
  assert.match(missing.message, /VS Code wasn't found/);
  r.exists.add(join("C:\\Users\\me\\AppData\\Local", "Programs", "Microsoft VS Code", "Code.exe"));
  const ok = await r.module.open(id, "vscode", {}, "module_ui");
  assert.equal(ok.ok, true);
  assert.deepEqual(r.spawned[0].args, [app]);
  assert.match(r.spawned[0].file, /Code\.exe$/);
  const elsewhere = await r.module.open(id, "folder", { path: "/etc" }, "module_ui");
  assert.match(elsewhere.message, /isn't one of this project's folders/);
  const term = await r.module.open(id, "terminal", {}, "module_ui");
  assert.equal(term.ok, true);
  assert.equal(r.spawned[1].file, "powershell.exe");
  assert.equal((await r.module.open(id, "folder", {}, "module_ui")).ok, true);
  assert.deepEqual(r.opened, [app]);
  const gh = await r.module.open(id, "github", {}, "module_ui");
  assert.match(gh.message, /isn't on GitHub/);
  assert.ok(r.module.get(id)?.lastOpenedAt, "opening counts as activity");
});

test("open on GitHub: repo, branch and compare pages", async () => {
  const r = rig();
  r.module.start();
  const { app } = r.b.origin();
  r.b.git(app, "remote", "set-url", "origin", "git@github.com:me/shop.git");
  const added = await r.module.add({ path: app }, "wizard");
  const id = added.ok ? added.project.id : "";
  await r.module.open(id, "github", {}, "module_ui");
  await r.module.open(id, "github", { branch: "feature/x" }, "module_ui");
  await r.module.open(id, "github", { branch: "feature/x", base: "main" }, "module_ui");
  assert.deepEqual(r.opened, ["https://github.com/me/shop", "https://github.com/me/shop/tree/feature/x", "https://github.com/me/shop/compare/main...feature/x"]);
});

test("the old Dev dashboard API: save, update keeps fields, name and path required, delete archives, demo sync", () => {
  const r = rig();
  r.module.start();
  const created = r.module.saveLegacy({ name: "Blog", path: "/code/blog", urls: ["http://localhost:4000"], ports: [4000], dockerComposeEnabled: true, commandList: [{ label: "Lint", command: "pnpm lint" }] });
  assert.equal(created.id, "blog");
  assert.deepEqual(created.urls, ["http://localhost:4000"]);
  assert.equal(created.dockerComposeEnabled, true);
  const updated = r.module.saveLegacy({ id: "blog", name: "Blog 2", path: "/code/blog" });
  assert.equal(updated.name, "Blog 2");
  assert.deepEqual(updated.ports, [4000], "omitted fields keep their value");
  assert.equal(updated.commandList?.length, 1);
  assert.throws(() => r.module.saveLegacy({ name: "", path: "/x" }), /name and path are required/);
  assert.throws(() => r.module.saveLegacy({ name: "Bad", path: join(r.dataRoot, "files") }), /data folder/);
  r.module.archiveLegacy("blog");
  assert.deepEqual(r.module.legacyProjects(), []);
  assert.equal(r.module.list({ includeArchived: true }).length, 1, "archived, not deleted");
  assert.throws(() => r.module.archiveLegacy("nope"), /not found/);

  r.module.syncLegacy([{ ...LEGACY[0], id: "demo", name: "Demo" }]);
  assert.deepEqual(r.module.legacyProjects().map((p) => p.id), ["demo"]);
  r.module.syncLegacy([]);
  assert.deepEqual(r.module.legacyProjects(), []);
  assert.equal(r.module.list({ includeArchived: true }).length, 1, "the archived project is left alone");
});

test("reading a project's git state keeps its facts and activity current", async () => {
  const r = rig();
  r.module.start();
  const plain = join(r.b.root, "plain");
  mkdirSync(plain);
  const added = await r.module.add({ path: plain, name: "Plain" }, "wizard");
  const id = added.ok ? added.project.id : "";
  assert.equal(r.module.get(id)?.git.isRepo, false);
  r.b.git(plain, "init", "-q");
  writeFileSync(join(plain, "a"), "a");
  r.b.git(plain, "add", "a");
  r.b.gitAt(plain, "2026-09-01T00:00:00Z", "commit", "-q", "-m", "first");
  const states = await r.module.repoStates();
  assert.equal(states[id] && "isRepo" in states[id] && states[id].isRepo, true);
  assert.equal(r.module.get(id)?.git.isRepo, true);
  assert.equal(r.module.get(id)?.git.defaultBranch, "main");
  assert.ok((r.module.get(id)?.lastActivityAt ?? "") >= "2026-09-01");
});

test("a project whose path is in the data root is never read or operated on", async () => {
  const r = rig();
  r.module.start();
  const inside = join(r.dataRoot, "files", "repo");
  mkdirSync(inside, { recursive: true });
  // Planted directly in the store, as a hand-edited projects.json could.
  const store = r.module.store;
  const base = r.module.saveLegacy({ name: "Elsewhere", path: "/code/elsewhere" });
  store.save({ ...store.get(base.id)!, path: inside });
  r.b.calls.length = 0;
  const state = await r.module.repoState(base.id);
  assert.equal(state.isRepo, false);
  const result = await r.module.execute(base.id, { kind: "push" }, { source: "module_ui" });
  assert.equal(result.status, "refused");
  assert.equal(r.executed.length, 0);
  assert.equal(r.b.calls.length, 0);
});

test("settings are normalised and saved", () => {
  const r = rig();
  r.module.start();
  const saved = r.module.updateSettings({ staleDays: 7, terminal: "powershell", layout: "list", vscodePath: "  D:\\VSCode\\Code.exe " });
  assert.equal(saved.staleDays, 7);
  assert.equal(saved.vscodePath, "D:\\VSCode\\Code.exe");
  assert.deepEqual(r.saved.at(-1), saved);
  assert.deepEqual(r.module.updateSettings("garbage"), saved);
  assert.equal(DEFAULT_PROJECTS_SETTINGS.scheduledFetch.enabled, false);
});
