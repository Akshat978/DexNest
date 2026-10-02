// The Projects runtime wired to the real git-ops, as the desktop host wires it.

import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createDataBoundary } from "@dexnest/foundation";
import { createLegacyFileSource, createNodeInspectFs, createProjectsModule, type GitOpsPort, type ProjectsModule } from "@dexnest/projects";

import { cloneRepository } from "../src/clone.ts";
import { createGitOps } from "../src/executor.ts";
import { commitFile, world, type World } from "./helpers.ts";

let worlds: World[] = [];
afterEach(() => {
  for (const w of worlds) w.dispose();
  worlds = [];
});

function wired(): { w: World; module: ProjectsModule } {
  const w = world();
  worlds.push(w);
  const dataRoot = join(w.b.root, "DeskNest", "local-data");
  mkdirSync(join(dataRoot, "settings"), { recursive: true });
  const boundary = createDataBoundary({ dataRoot });
  const fs = createNodeInspectFs();
  let module: ProjectsModule | null = null;
  const ops = () => createGitOps({ runner: w.b.runner, reader: w.b.reader(), store: module!.store, events: w.events });
  let cached: ReturnType<typeof createGitOps> | null = null;
  const get = () => (cached ??= ops());
  const gitOps: GitOpsPort = {
    preview: (i) => get().preview(i),
    execute: (i) => get().execute(i),
    cancel: (id) => get().cancel(id),
    isBusy: (id) => get().isBusy(id),
    fetchAll: (p, o) => get().fetchAll(p, o),
    pullAll: (p, o) => get().pullAll(p, o),
    recoverInterrupted: () => get().recoverInterrupted(),
    clone: (input) => cloneRepository(input, { runner: w.b.runner, fs, isSensitive: (p) => boundary.isSensitive(p), store: module!.store, events: w.events, allowLocalUrls: true })
  };
  module = createProjectsModule({
    database: w.db.db,
    events: w.events,
    reader: w.b.reader(),
    gitOps,
    inspectFs: fs,
    isSensitive: (p) => boundary.isSensitive(p),
    launch: { env: () => ({ platform: "linux", env: {}, exists: () => false }), openPath: async () => null, openExternal: async () => undefined, spawnDetached: () => ({ ok: true }) },
    scheduler: { schedule: () => () => undefined, runNow: async () => undefined },
    settings: { read: () => ({}), write: () => undefined },
    legacy: createLegacyFileSource({ file: join(dataRoot, "settings", "projects.json"), backupDir: join(dataRoot, "settings", "backups") })
  });
  module.start();
  return { w, module };
}

test("Stream Deck 'push current project' pushes the most recently opened project, without asking", async () => {
  const { w, module } = wired();
  const added = await module.add({ path: w.app, name: "Shop" }, "wizard");
  assert.equal(added.ok, true);
  const id = added.ok ? added.project.id : "";
  module.touch(id);
  const sha = commitFile(w, w.app, "x.txt", "x", "work");
  const outcome = await module.runAction("projects.git.push_current", "stream_deck_http", {});
  assert.equal(outcome.ok, true, outcome.message);
  assert.equal(w.b.git(w.bare, "rev-parse", "refs/heads/main").trim(), sha);
  // Nothing to push now: refused, not asked.
  const again = await module.runAction("projects.git.push_current", "stream_deck_http", {});
  assert.equal(again.ok, false);
  assert.match(again.message, /Nothing to push/);
});

test("the old git_push path and the view use the same journal and events", async () => {
  const { w, module } = wired();
  const added = await module.add({ path: w.app, name: "Shop" }, "wizard");
  const id = added.ok ? added.project.id : "";
  commitFile(w, w.app, "y.txt", "y", "more");
  const result = await module.execute(id, { kind: "push" }, { source: "module_ui" });
  assert.equal(result.status === "done" && result.outcome, "succeeded");
  assert.deepEqual(module.operations(id).map((o) => [o.verb, o.state]), [["push", "succeeded"]]);
  assert.ok((module.get(id)?.lastActivityAt ?? "") > "2026");
});

test("clone through the runtime hands back an inspection for the wizard", async () => {
  const { w, module } = wired();
  const parent = join(w.b.root, "clones");
  mkdirSync(parent);
  const result = await module.clone({ url: w.bare, parentDir: parent, folderName: "copy" }, "module_ui");
  assert.equal(result.status === "done" && result.outcome, "succeeded");
  assert.equal(result.inspection?.kind, "ok");
});
