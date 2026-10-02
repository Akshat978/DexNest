// Phase 10 hardening, write side: two operations at once, a project folder
// with spaces and unicode in its path, and one unreachable remote during
// "fetch all". Real git against local bare repositories; no network.

import { strict as assert } from "node:assert";
import { join } from "node:path";
import { after, test } from "node:test";

import { normaliseProjectInput, type GitRunResult } from "@dexnest/projects";

import { commitFile, done, P, world, type World } from "./helpers.ts";

const worlds: World[] = [];
after(() => {
  for (const w of worlds) w.dispose();
});
const w0 = (options: Parameters<typeof world>[0] = {}) => {
  const w = world(options);
  worlds.push(w);
  return w;
};

function addProject(w: World, id: string, path: string): void {
  const made = normaliseProjectInput({ id, name: id, path }, { existing: null, takenIds: new Set(w.store.list({ includeArchived: true }).map((p) => p.id)), now: "2026-10-01T00:00:00.000Z", newCommandId: () => "cmd_1" });
  assert.ok(made.ok);
  if (made.ok) w.store.save(made.project);
}

test("two operations at once: the same project says busy, different projects both run", async () => {
  let release: (() => void) | null = null;
  let held = false;
  const w = w0({
    runner: (inner) => ({
      run(request) {
        // Hold the first fetch until the second request has been answered.
        if (!held && request.args.includes("fetch")) {
          held = true;
          return new Promise<GitRunResult>((resolve) => {
            release = () => void inner.run(request).then(resolve);
          });
        }
        return inner.run(request);
      }
    })
  });
  const second = w.b.clone(w.bare, "second");

  const first = w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  for (let i = 0; i < 200 && !release; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.ok(release, "the first fetch is running");
  assert.equal(w.ops.isBusy(P), true);

  const clash = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  assert.equal(clash.status, "busy");
  if (clash.status === "busy") assert.equal(clash.runningVerb, "fetch");

  const other = done(await w.ops.execute({ projectId: "second", path: second, request: { kind: "fetch" }, source: "module_ui" }));
  assert.equal(other.outcome, "succeeded", "another project is not blocked");

  (release as unknown as () => void)();
  assert.equal(done(await first).outcome, "succeeded");
  assert.equal(w.ops.isBusy(P), false);
  const busyRows = w.store.listOperations(P, 10).filter((r) => r.state === "running");
  assert.deepEqual(busyRows, [], "nothing is left running");
});

test("a folder with spaces and unicode: commit, push and undo all work, the path reaches git intact", async () => {
  const w = w0();
  const dir = w.b.clone(w.bare, "my app – ünïcødé 日本");
  addProject(w, "uni", dir);

  commitFile(w, dir, "ファイル with space.txt", "hello\n", "local work");
  const pushed = done(await w.ops.execute({ projectId: "uni", path: dir, request: { kind: "push" }, source: "module_ui" }));
  assert.equal(pushed.outcome, "succeeded");
  assert.equal(w.b.git(w.bare, "log", "-1", "--format=%s", "main").trim(), "local work");

  w.b.write(join(dir, "ノート.md"), "notes\n");
  const committed = done(await w.ops.execute({ projectId: "uni", path: dir, request: { kind: "commit", message: "add notes", files: "all" }, source: "module_ui" }));
  assert.equal(committed.outcome, "succeeded");
  assert.equal(committed.undoAvailable, true);
  const undone = done(await w.ops.execute({ projectId: "uni", path: dir, request: { kind: "undo", opId: committed.opId }, source: "module_ui" }));
  assert.equal(undone.outcome, "succeeded");
  assert.match(w.b.git(dir, "status", "--porcelain"), /ノート\.md|\\343/, "the change is back, staged");
  for (const call of w.calls) if (call.cwd.includes("ünïcødé")) assert.equal(call.cwd, dir, "cwd passed through untouched");
});

test("fetch all with one project offline: the others are fetched, the offline one says so, nothing throws", async () => {
  const w = w0();
  const second = w.b.clone(w.bare, "second");
  const offline = w.b.clone(w.bare, "third");
  w.b.git(offline, "remote", "set-url", "origin", join(w.b.root, "gone.git"));

  const results = await w.ops.fetchAll(
    [
      { projectId: P, path: w.app },
      { projectId: "second", path: second },
      { projectId: "third", path: offline }
    ],
    { source: "module_ui", concurrency: 2 }
  );
  const by = Object.fromEntries(results.map((r) => [r.projectId, r.result]));
  assert.equal(done(by[P]).outcome, "succeeded");
  assert.equal(done(by.second).outcome, "succeeded");
  const off = done(by.third);
  assert.equal(off.outcome, "failed");
  assert.equal(off.errorCode, "offline");
  assert.match(off.message, /Couldn't reach the remote/);
  assert.equal(w.ops.isBusy("third"), false);
});
