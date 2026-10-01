// The proj_ store on a real SQLite file in a temp directory.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { validateManifest } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";

import { PROJECTS_MANIFEST } from "../src/module/manifest.ts";
import { createProjectsStore, runProjectsMigrations, ProjectStoreError, type BeginOperation } from "../src/store/store.ts";
import { journalParams } from "../src/domain/events.ts";
import { planOperation } from "../src/domain/planners.ts";
import { normaliseProjectInput, type Project, type ProjectInput } from "../src/domain/project.ts";
import { repo, SECRET_MESSAGE, tree } from "./fixtures.ts";

let handles: TestDatabase[] = [];
afterEach(() => {
  for (const h of handles) h.dispose();
  handles = [];
});

function open() {
  const handle = createTestDatabase("dexnest-projects-");
  handles.push(handle);
  runProjectsMigrations(handle.db, "2026-10-01T00:00:00.000Z");
  return { handle, store: createProjectsStore(handle.db) };
}

let n = 0;
function project(input: ProjectInput, existing: Project | null = null): Project {
  const result = normaliseProjectInput(input, { existing, takenIds: new Set(), now: "2026-10-01T00:00:00.000Z", newCommandId: () => `cmd_${++n}` });
  if (!result.ok) throw new Error(result.error);
  return result.project;
}

function full(): Project {
  return {
    ...project({
      name: "Full App",
      path: "D:\\code\\full app ü",
      description: "everything set",
      accent: "vault",
      projectType: "mobile_app",
      tags: ["work", "Work", "rust"],
      favourite: true,
      pinned: true,
      notes: "line 1\nline 2",
      commands: { start: "pnpm dev", build: "pnpm build", test: "pnpm test", typecheck: "tsc", custom: "make x" },
      commandList: [
        { id: "deploy", label: "Deploy", command: "pnpm deploy", requiresConfirmation: true },
        { id: "lint", label: "Lint", command: "pnpm lint" }
      ],
      localUrls: ["http://localhost:3000", "http://127.0.0.1:5173"],
      links: [{ label: "Docs", url: "https://docs.example" }],
      folders: [{ label: "API", path: "D:\\code\\full app ü\\api" }],
      ports: [3000, 5173],
      healthUrl: "http://localhost:3000/health",
      stopCommand: "pnpm stop",
      logCommand: "pnpm logs",
      logPath: "D:\\logs\\x.log",
      dockerCompose: true,
      git: { isRepo: true, remoteName: "origin", remoteUrl: "https://me:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/me/full.git", hosting: { kind: "github", owner: "me", repo: "full" }, defaultBranch: "main" },
      tooling: { packageManager: "pnpm", framework: "vite", workspaceFile: "full.code-workspace" }
    }),
    realPath: "d:/code/full app ü",
    lastOpenedAt: "2026-09-01T00:00:00.000Z",
    lastActivityAt: "2026-09-02T00:00:00.000Z",
    legacy: { id: "full-app", extra: { nested: true } }
  };
}

test("the manifest validates and the migrations are idempotent", () => {
  assert.deepEqual(validateManifest(PROJECTS_MANIFEST, "projects"), []);
  const { handle } = open();
  assert.deepEqual(runProjectsMigrations(handle.db).applied, []);
  assert.equal(PROJECTS_MANIFEST.jobs[0].heavy, true);
});

test("a project round-trips with every field; tokens never reach the database", () => {
  const { handle, store } = open();
  const p = full();
  store.save(p);
  const back = store.get(p.id)!;
  assert.deepEqual(back, { ...p, git: { ...p.git, remoteUrl: "https://github.com/me/full.git" } });
  const raw = readFileSync(handle.path);
  assert.equal(raw.includes(Buffer.from("ghp_abcdef")), false, "token must not be in the database file");
});

test("close and reopen: projects, groups, fetch state, journal and meta are all still there", () => {
  const { handle, store } = open();
  store.saveGroup({ id: "g1", name: "Work", position: 0 });
  store.save({ ...full(), groupId: "g1" });
  store.save(project({ name: "Second", path: "/p/2" }));
  store.recordFetch("full-app", "2026-10-01T10:00:00.000Z", "succeeded");
  store.setMeta("legacy_import", { sha256: "abc" }, "2026-10-01T00:00:00.000Z");
  store.beginOperation({ id: "op1", projectId: "full-app", verb: "fetch", safety: "normal", params: { verb: "fetch" }, refsBefore: null }, "2026-10-01T10:00:00.000Z");
  const before = store.list();
  handle.close();

  const again = handle.reopen();
  handles.push(again);
  const reopened = createProjectsStore(again.db);
  assert.deepEqual(reopened.list(), before);
  assert.deepEqual(reopened.listGroups(), [{ id: "g1", name: "Work", position: 0 }]);
  assert.deepEqual(reopened.fetchState("full-app"), { lastFetchAt: "2026-10-01T10:00:00.000Z", outcome: "succeeded" });
  assert.deepEqual(reopened.getMeta("legacy_import"), { sha256: "abc" });
  assert.equal(reopened.runningOperation("full-app")?.id, "op1");
});

test("editing replaces child rows rather than accumulating them", () => {
  const { store } = open();
  const p = full();
  store.save(p);
  const edited = project({ ports: [8080], tags: [], commandList: [{ id: "deploy", label: "Ship", command: "x" }], links: [] }, p);
  store.save(edited);
  const back = store.get(p.id)!;
  assert.deepEqual(back.ports, [8080]);
  assert.deepEqual(back.tags, []);
  assert.deepEqual(back.commandList, [{ id: "deploy", label: "Ship", command: "x", requiresConfirmation: false }]);
  assert.deepEqual(back.links, []);
  assert.deepEqual(back.folders, p.folders);
});

test("archive instead of delete; removal only from the archive", () => {
  const { store } = open();
  const p = project({ name: "Old", path: "/p/old" });
  store.save(p);
  assert.throws(() => store.remove(p.id), (e: unknown) => e instanceof ProjectStoreError && e.code === "not_archived");
  store.archive(p.id, "2026-10-02T00:00:00.000Z");
  assert.deepEqual(store.list(), []);
  assert.equal(store.list({ includeArchived: true }).length, 1);
  assert.ok(store.ids().has(p.id), "archived ids stay taken");
  store.restore(p.id, "2026-10-03T00:00:00.000Z");
  assert.equal(store.list()[0].archivedAt, null);
  store.archive(p.id, "2026-10-04T00:00:00.000Z");
  store.remove(p.id);
  assert.equal(store.get(p.id), null);
  assert.throws(() => store.remove("nope"), ProjectStoreError);
});

test("duplicates are found by real path and by remote, whatever the protocol", () => {
  const { store } = open();
  store.save(full());
  assert.equal(store.findByRealPath("d:/code/full app ü")?.id, "full-app");
  assert.equal(store.findByRemote("git@github.com:Me/Full")?.id, "full-app");
  assert.equal(store.findByRemote("https://github.com/me/other"), null);
  assert.equal(store.findByRealPath("/elsewhere"), null);
});

test("touch and activity", () => {
  const { store } = open();
  const p = project({ name: "A", path: "/a" });
  store.save(p);
  store.touch(p.id, "2026-10-05T00:00:00.000Z");
  assert.equal(store.get(p.id)!.lastOpenedAt, "2026-10-05T00:00:00.000Z");
  store.noteActivity(p.id, "2026-10-01T00:00:00.000Z");
  assert.equal(store.get(p.id)!.lastActivityAt, "2026-10-05T00:00:00.000Z", "activity never goes backwards");
  store.noteActivity(p.id, "2026-10-06T00:00:00.000Z");
  assert.equal(store.get(p.id)!.lastActivityAt, "2026-10-06T00:00:00.000Z");
  assert.throws(() => store.touch("missing", "x"), ProjectStoreError);
});

test("deleting a group ungroups its projects", () => {
  const { store } = open();
  store.saveGroup({ id: "g", name: "Side", position: 1 });
  store.save({ ...project({ name: "A", path: "/a" }), groupId: "g" });
  store.deleteGroup("g");
  assert.equal(store.get("a")!.groupId, null);
  assert.throws(() => store.saveGroup({ id: "x", name: "  ", position: 0 }), ProjectStoreError);
});

test("100+ projects list in a handful of queries' time and stay sorted", () => {
  const { store } = open();
  const many = Array.from({ length: 150 }, (_, i) => ({ ...full(), id: `p-${String(i).padStart(3, "0")}`, name: `Project ${149 - i}`, legacy: null, realPath: null }));
  store.saveMany(many);
  const started = performance.now();
  const listed = store.list();
  const ms = performance.now() - started;
  assert.equal(listed.length, 150);
  assert.equal(listed[0].name, "Project 0");
  assert.ok(listed.every((p) => p.ports.length === 2 && p.commandList.length === 2));
  assert.ok(ms < 1000, `listing took ${ms} ms`);
});

// --- the operation journal ------------------------------------------------------

function begin(id: string, projectId = "app"): BeginOperation {
  return { id, projectId, verb: "push", safety: "normal", params: { verb: "push" }, refsBefore: { head: "a".repeat(40), branch: "main", refs: { main: "a".repeat(40) } } };
}

test("only one operation runs per project at a time", () => {
  const { store } = open();
  assert.equal(store.beginOperation(begin("op1"), "2026-10-01T00:00:00.000Z").ok, true);
  const second = store.beginOperation(begin("op2"), "2026-10-01T00:00:01.000Z");
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.busy.id, "op1");
  assert.equal(store.beginOperation(begin("op3", "other"), "2026-10-01T00:00:01.000Z").ok, true, "other projects are independent");
  store.finishOperation("op1", { state: "succeeded", outcome: "succeeded" }, "2026-10-01T00:00:02.000Z");
  assert.equal(store.beginOperation(begin("op4"), "2026-10-01T00:00:03.000Z").ok, true);
});

test("the database itself refuses a second running operation, even past the store's check", () => {
  const { handle, store } = open();
  store.beginOperation(begin("op1"), "2026-10-01T00:00:00.000Z");
  assert.throws(() =>
    handle.db.prepare("INSERT INTO proj_operations (id, project_id, verb, safety, state, params_json, started_at) VALUES ('x', 'app', 'push', 'normal', 'running', '{}', 'now')").run()
  );
});

test("finish records refs and undo; the latest successful operation is the one that can be undone", () => {
  const { store } = open();
  store.beginOperation(begin("op1"), "2026-10-01T00:00:00.000Z");
  store.finishOperation("op1", { state: "succeeded", outcome: "succeeded", undo: { kind: "recreate_branch", name: "wip", sha: "b".repeat(40) }, refsAfter: { head: null, branch: "main", refs: {} } }, "2026-10-01T00:00:01.000Z");
  assert.equal(store.latestUndoable("app")?.id, "op1");
  assert.deepEqual(store.getOperation("op1")!.undo, { kind: "recreate_branch", name: "wip", sha: "b".repeat(40) });
  store.markUndone("op1", "op2");
  assert.equal(store.latestUndoable("app"), null);
  assert.throws(() => store.markUndone("op1", "op3"), ProjectStoreError, "can't be undone twice");
  assert.throws(() => store.finishOperation("op1", { state: "failed", outcome: "failed" }, "x"), ProjectStoreError, "finished once only");

  store.beginOperation(begin("op5"), "2026-10-01T00:01:00.000Z");
  store.finishOperation("op5", { state: "succeeded", outcome: "succeeded", undo: { kind: "switch_back", branch: "main" } }, "2026-10-01T00:01:01.000Z");
  store.beginOperation(begin("op6"), "2026-10-01T00:02:00.000Z");
  store.finishOperation("op6", { state: "failed", outcome: "failed", errorCode: "auth_needed" }, "2026-10-01T00:02:01.000Z");
  assert.equal(store.latestUndoable("app"), null, "a later failed operation hides older undos");
  assert.deepEqual(store.listOperations("app").map((o) => o.id), ["op6", "op5", "op1"]);
});

test("after a crash, running operations become interrupted and the project is free again", () => {
  const { handle, store } = open();
  store.beginOperation(begin("op1"), "2026-10-01T00:00:00.000Z");
  handle.close();
  const again = handle.reopen();
  handles.push(again);
  const reopened = createProjectsStore(again.db);
  const recovered = reopened.recoverInterrupted("2026-10-01T01:00:00.000Z");
  assert.deepEqual(recovered.map((r) => [r.id, r.state]), [["op1", "interrupted"]]);
  assert.equal(reopened.runningOperation("app"), null);
  assert.equal(reopened.beginOperation(begin("op2"), "2026-10-01T01:00:01.000Z").ok, true);
  assert.deepEqual(reopened.recoverInterrupted("2026-10-01T02:00:00.000Z").map((r) => r.id), ["op2"]);
});

test("refusals are journalled too", () => {
  const { store } = open();
  const record = store.recordRefusal(begin("op1"), "diverged", "2026-10-01T00:00:00.000Z");
  assert.equal(record.state, "refused");
  assert.equal(record.errorCode, "diverged");
  assert.equal(store.runningOperation("app"), null);
});

test("the journal never stores a commit message or file path", () => {
  const { handle, store } = open();
  const state = repo({ workingTree: tree({ unstaged: [{ path: "private/diary.md", status: "modified" }] }) });
  const plan = planOperation(state, { kind: "commit", message: SECRET_MESSAGE, files: ["private/diary.md"] });
  assert.equal(plan.refused, false);
  if (plan.refused) return;
  store.beginOperation({ id: "op1", projectId: "app", verb: plan.kind, safety: plan.safety, params: journalParams(plan), refsBefore: null }, "2026-10-01T00:00:00.000Z");
  store.finishOperation("op1", { state: "succeeded", outcome: "succeeded" }, "2026-10-01T00:00:01.000Z");
  handle.close();
  const bytes = readFileSync(handle.path);
  for (const secret of ["DO-NOT-LOG", "rotate key", "private/diary.md"]) assert.equal(bytes.includes(Buffer.from(secret)), false, secret);
});
