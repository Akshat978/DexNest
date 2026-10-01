// Every git-ops operation against real repositories: preview -> run -> result,
// journalled before and after, with undo where possible.

import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { commitFile, done, P, world, type World } from "./helpers.ts";

let worlds: World[] = [];
afterEach(() => {
  for (const w of worlds) w.dispose();
  worlds = [];
});
function w0(...args: Parameters<typeof world>): World {
  const w = world(...args);
  worlds.push(w);
  return w;
}

const head = (w: World, cwd: string, ref = "HEAD") => w.b.git(cwd, "rev-parse", ref).trim();

test("push: preview in plain words, run, journalled before and after, events, now all pushed", async () => {
  const w = w0();
  const sha = commitFile(w, w.app, "x.txt", "x", "work");
  const preview = await w.ops.preview({ projectId: P, path: w.app, request: { kind: "push" } });
  assert.equal(preview.refused, false);
  if (preview.refused) return;
  assert.equal(preview.plan.summary, "Push 1 commit from main to origin/main.");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui", expectedFingerprint: preview.fingerprint }));
  assert.equal(r.outcome, "succeeded");
  assert.match(r.message, /Push done\. Now: all pushed\./);
  assert.equal(head(w, w.bare, "refs/heads/main"), sha);
  const ops = w.store.listOperations(P);
  assert.deepEqual(ops.map((o) => [o.verb, o.state]), [["push", "succeeded"]]);
  assert.equal(ops[0].refsBefore?.branch, "main");
  const types = w.events.query({ stream: "projects" }).map((e) => e.type);
  assert.deepEqual(types, ["projects.op.started", "projects.op.finished"]);
});

test("push refuses when behind and when diverged; nothing reaches the remote", async () => {
  const w = w0();
  const other = w.b.clone(w.bare, "other");
  const theirs = commitFile(w, other, "t.txt", "t", "theirs");
  w.b.git(other, "push", "-q");
  w.b.git(w.app, "fetch", "-q");
  let r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  assert.equal(r.status === "refused" && r.refusal.code, "behind");
  commitFile(w, w.app, "mine.txt", "m", "mine");
  r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  assert.equal(r.status === "refused" && r.refusal.code, "diverged");
  assert.equal(head(w, w.bare, "refs/heads/main"), theirs);
  assert.deepEqual(w.store.listOperations(P).map((o) => [o.state, o.errorCode]), [["refused", "diverged"], ["refused", "behind"]]);
});

test("a stale view can't push more than the owner saw: a changed plan comes back as 'stale'", async () => {
  const w = w0();
  commitFile(w, w.app, "a1.txt", "1", "one");
  const preview = await w.ops.preview({ projectId: P, path: w.app, request: { kind: "push" } });
  assert.equal(preview.refused, false);
  if (preview.refused) return;
  commitFile(w, w.app, "a2.txt", "2", "two");
  const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui", expectedFingerprint: preview.fingerprint });
  assert.equal(r.status, "stale");
  assert.equal(r.status === "stale" && r.plan.summary, "Push 2 commits from main to origin/main.");
  assert.notEqual(head(w, w.bare, "refs/heads/main"), head(w, w.app));
});

test("a new branch: push is refused with an offer, then 'push and set upstream' works", async () => {
  const w = w0();
  w.b.git(w.app, "switch", "-q", "-c", "feature/new");
  commitFile(w, w.app, "f.txt", "f", "feature");
  const r1 = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  assert.deepEqual(r1.status === "refused" && r1.refusal.offers, ["push_set_upstream"]);
  const r2 = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push", setUpstream: true }, source: "module_ui" }));
  assert.equal(r2.outcome, "succeeded");
  assert.equal(w.b.git(w.app, "rev-parse", "--abbrev-ref", "@{upstream}").trim(), "origin/feature/new");
});

test("fetch records when, then pull fast-forwards; a pull that can't fast-forward changes nothing", async () => {
  const w = w0();
  const other = w.b.clone(w.bare, "other");
  const theirs = commitFile(w, other, "t.txt", "t", "theirs");
  w.b.git(other, "push", "-q");
  const f = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" }));
  assert.equal(f.outcome, "succeeded");
  assert.equal(w.store.fetchState(P)?.outcome, "succeeded");
  const p = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "pull" }, source: "module_ui" }));
  assert.equal(p.outcome, "succeeded");
  assert.equal(head(w, w.app), theirs);

  // The remote moves again, the owner commits locally, and doesn't fetch: the cached
  // state still says "nothing to pull", the pull fetches and finds a divergence.
  commitFile(w, other, "t2.txt", "t2", "theirs again");
  w.b.git(other, "push", "-q");
  const mine = commitFile(w, w.app, "m.txt", "m", "mine");
  const p2 = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "pull" }, source: "module_ui" }));
  assert.equal(p2.outcome, "failed");
  assert.equal(p2.errorCode, "not_fast_forward");
  assert.match(p2.message, /Nothing was changed/);
  assert.equal(head(w, w.app), mine, "no merge, no rebase");
});

test("commit all, then undo the commit: the changes come back staged; a second undo is refused", async () => {
  const w = w0();
  const before = head(w, w.app);
  w.b.write(join(w.app, "a.txt"), "changed\n");
  w.b.write(join(w.app, "new.txt"), "new");
  const c = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "Add new", files: "all" }, source: "module_ui" }));
  assert.equal(c.outcome, "succeeded");
  assert.equal(c.undoAvailable, true);
  assert.equal(w.b.git(w.app, "log", "-1", "--format=%s").trim(), "Add new");
  const u = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: c.opId }, source: "module_ui" }));
  assert.equal(u.outcome, "succeeded");
  assert.equal(head(w, w.app), before);
  assert.deepEqual(w.b.git(w.app, "diff", "--cached", "--name-only").trim().split("\n").sort(), ["a.txt", "new.txt"]);
  const again = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: c.opId }, source: "module_ui" });
  assert.equal(again.status === "refused" && again.refusal.code, "cannot_undo");
  assert.equal(w.store.getOperation(c.opId)?.undoneBy, u.opId);
  assert.ok(w.events.query({ stream: "projects", types: ["projects.op.undone"] }).length === 1);
});

test("commit only the chosen files; other changes stay; the message never reaches argv, journal or events", async () => {
  const w = w0();
  w.b.write(join(w.app, "a.txt"), "changed\n");
  w.b.write(join(w.app, "pick me.txt"), "picked");
  w.b.write(join(w.app, "leave.txt"), "left");
  const message = "Secret subject TOKEN-xyz-DO-NOT-LOG\n\nbody";
  const c = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message, files: ["pick me.txt", "a.txt"] }, source: "module_ui" }));
  assert.equal(c.outcome, "succeeded");
  assert.deepEqual(w.b.git(w.app, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(), ["a.txt", "pick me.txt"]);
  assert.match(w.b.git(w.app, "status", "--porcelain"), /\?\? leave\.txt/);
  assert.equal(w.b.git(w.app, "log", "-1", "--format=%B").trim(), message.trim());
  for (const call of w.calls) assert.equal(call.args.some((a) => a.includes("DO-NOT-LOG")), false, "message on the command line");
  w.db.close();
  const bytes = readFileSync(w.db.path);
  assert.equal(bytes.includes(Buffer.from("DO-NOT-LOG")), false, "message in the database");
  assert.equal(bytes.includes(Buffer.from("pick me.txt")), false, "file path in the database");
});

test("a pushed commit can't be undone", async () => {
  const w = w0();
  w.b.write(join(w.app, "a.txt"), "c\n");
  const c = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "x", files: "all" }, source: "module_ui" }));
  w.b.git(w.app, "push", "-q");
  const u = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: c.opId }, source: "module_ui" });
  assert.equal(u.status === "refused" && u.refusal.reason, "That commit has been pushed. DexNest never rewrites pushed history.");
});

test("stash, then undo (pop); pop a clean stash; a conflicting pop asks first and keeps the stash", async () => {
  const w = w0();
  w.b.write(join(w.app, "a.txt"), "edit\n");
  const s = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "stash" }, source: "module_ui" }));
  assert.equal(s.outcome, "succeeded");
  assert.equal(readFileSync(join(w.app, "a.txt"), "utf8"), "one\n");
  const u = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: s.opId }, source: "module_ui" }));
  assert.equal(u.outcome, "succeeded");
  assert.equal(readFileSync(join(w.app, "a.txt"), "utf8"), "edit\n");
  assert.equal(w.b.git(w.app, "stash", "list").trim(), "", "popped, not just applied");

  w.b.git(w.app, "stash", "push", "-q");
  const stashSha = head(w, w.app, "refs/stash");
  w.b.write(join(w.app, "a.txt"), "conflicting edit\n");
  const ask = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "stash_pop", index: 0, sha: stashSha }, source: "module_ui" });
  assert.equal(ask.status, "needs_confirmation");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "stash_pop", index: 0, sha: stashSha }, source: "module_ui", confirmation: { confirmed: true } }));
  assert.equal(r.outcome, "failed");
  assert.equal(r.errorCode, "local_changes");
  assert.equal(head(w, w.app, "refs/stash"), stashSha, "the stash is kept");
  assert.equal(readFileSync(join(w.app, "a.txt"), "utf8"), "conflicting edit\n", "local changes untouched");
});

test("switch with uncommitted changes asks; 'stash and switch' does both; undo switches back", async () => {
  const w = w0();
  w.b.git(w.app, "branch", "other");
  w.b.write(join(w.app, "a.txt"), "dirty\n");
  const ask = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "switch", branch: "other" }, source: "module_ui" });
  assert.deepEqual(ask.status === "refused" && ask.refusal.offers, ["stash_and_switch"]);
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "switch", branch: "other", dirty: "stash" }, source: "module_ui" }));
  assert.equal(r.outcome, "succeeded");
  assert.equal(w.b.git(w.app, "branch", "--show-current").trim(), "other");
  assert.match(w.b.git(w.app, "stash", "list"), /dexnest-switch-op_\d+/);
  const u = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: r.opId }, source: "module_ui" }));
  assert.equal(u.outcome, "succeeded");
  assert.equal(w.b.git(w.app, "branch", "--show-current").trim(), "main");
});

test("create a branch, undo deletes it again", async () => {
  const w = w0();
  const c = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "create_branch", name: "feature/x" }, source: "module_ui" }));
  assert.equal(head(w, w.app, "refs/heads/feature/x"), head(w, w.app));
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: c.opId }, source: "module_ui" }));
  assert.throws(() => head(w, w.app, "refs/heads/feature/x"));
});

test("delete a merged branch: confirmation dialog; undo recreates it at the same commit", async () => {
  const w = w0();
  w.b.git(w.app, "branch", "done");
  const sha = head(w, w.app, "refs/heads/done");
  const ask = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "delete_branch", name: "done" }, source: "module_ui" });
  assert.equal(ask.status === "needs_confirmation" && ask.plan.safety, "caution");
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "delete_branch", name: "done" }, source: "module_ui", confirmation: { confirmed: true } }));
  assert.throws(() => head(w, w.app, "refs/heads/done"));
  const last = w.store.latestUndoable(P)!;
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: last.id }, source: "module_ui" }));
  assert.equal(head(w, w.app, "refs/heads/done"), sha);
});

test("delete an unmerged branch: only the exact branch name typed will do", async () => {
  const w = w0();
  w.b.git(w.app, "switch", "-q", "-c", "wip");
  const tip = commitFile(w, w.app, "w.txt", "w", "unmerged work");
  w.b.git(w.app, "switch", "-q", "main");
  const request = { kind: "delete_branch", name: "wip" };
  for (const confirmation of [undefined, { confirmed: true }, { confirmed: true, typed: "WIP" }, { confirmed: true, typed: "wip " }]) {
    const r = await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation });
    assert.equal(r.status, "needs_confirmation", JSON.stringify(confirmation));
  }
  assert.equal(head(w, w.app, "refs/heads/wip"), tip);
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation: { confirmed: true, typed: "wip" } }));
  assert.equal(r.outcome, "succeeded");
  assert.equal(r.plan.safety, "strong");
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: r.opId }, source: "module_ui" }));
  assert.equal(head(w, w.app, "refs/heads/wip"), tip, "nothing lost");
});

test("delete a remote branch (type its name); undo pushes it back", async () => {
  const w = w0();
  w.b.git(w.app, "switch", "-q", "-c", "old");
  const tip = commitFile(w, w.app, "o.txt", "o", "old");
  w.b.git(w.app, "push", "-q", "-u", "origin", "old");
  w.b.git(w.app, "switch", "-q", "main");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "delete_remote_branch", remote: "origin", name: "old" }, source: "module_ui", confirmation: { confirmed: true, typed: "old" } }));
  assert.equal(r.outcome, "succeeded");
  assert.throws(() => head(w, w.bare, "refs/heads/old"));
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: r.opId }, source: "module_ui" }));
  assert.equal(head(w, w.bare, "refs/heads/old"), tip);
});

test("discard: a backup stash first, files back to the last commit, undo brings every byte back", async () => {
  const w = w0();
  w.b.write(join(w.app, "a.txt"), "precious edit\n");
  w.b.write(join(w.app, "scratch.txt"), "new file");
  w.b.write(join(w.app, "keep.txt"), "not chosen");
  const request = { kind: "discard", files: ["a.txt", "scratch.txt"] };
  assert.equal((await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui" })).status, "needs_confirmation");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation: { confirmed: true } }));
  assert.equal(r.outcome, "succeeded");
  assert.equal(readFileSync(join(w.app, "a.txt"), "utf8"), "one\n");
  assert.equal(existsSync(join(w.app, "scratch.txt")), false);
  assert.equal(readFileSync(join(w.app, "keep.txt"), "utf8"), "not chosen", "unchosen files untouched");
  assert.match(w.b.git(w.app, "stash", "list"), /dexnest-discard-/);
  done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "undo", opId: r.opId }, source: "module_ui" }));
  assert.equal(readFileSync(join(w.app, "a.txt"), "utf8"), "precious edit\n");
  assert.equal(readFileSync(join(w.app, "scratch.txt"), "utf8"), "new file");
});

test("Autopilot's worktree branch is never touched", async () => {
  const w = w0();
  w.b.git(w.app, "worktree", "add", "-q", "-b", "autopilot/run-1", join(w.b.root, "dexnest-worktrees", "run-1"));
  for (const request of [{ kind: "delete_branch", name: "autopilot/run-1" }, { kind: "switch", branch: "autopilot/run-1" }, { kind: "push", branch: "autopilot/run-1", setUpstream: true }]) {
    const r = await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation: { confirmed: true, typed: "autopilot/run-1" } });
    assert.equal(r.status === "refused" && r.refusal.code, "other_worktree", request.kind);
  }
});

test("deck and hotkey runs never ask: anything needing a confirmation or a choice is refused", async () => {
  const w = w0();
  w.b.git(w.app, "branch", "done");
  const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "delete_branch", name: "done" }, source: "deck", nonInteractive: true, confirmation: { confirmed: true } });
  assert.equal(r.status === "refused" && r.refusal.code, "needs_choice");
  commitFile(w, w.app, "d.txt", "d", "deck push");
  const p = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "deck", nonInteractive: true }));
  assert.equal(p.outcome, "succeeded");
});

test("fetch all and pull all: only clean projects that can fast-forward are pulled", async () => {
  const w = w0();
  const second = w.b.clone(w.bare, "second");
  const third = w.b.clone(w.bare, "third");
  const other = w.b.clone(w.bare, "other");
  commitFile(w, other, "n.txt", "n", "new upstream");
  w.b.git(other, "push", "-q");
  w.b.write(join(third, "dirty.txt"), "dirty");
  const projects = [{ projectId: "app", path: w.app }, { projectId: "second", path: second }, { projectId: "third", path: third }];
  const fetched = await w.ops.fetchAll(projects, { source: "module_ui" });
  assert.deepEqual(fetched.map((f) => f.result.status === "done" && f.result.outcome), ["succeeded", "succeeded", "succeeded"]);
  const pulled = await w.ops.pullAll(projects, { source: "module_ui" });
  assert.deepEqual(pulled.pulled.map((p) => [p.projectId, p.result.status === "done" && p.result.outcome]), [["app", "succeeded"], ["second", "succeeded"]]);
  assert.deepEqual(pulled.skipped, [{ projectId: "third", reason: "has uncommitted changes" }]);
  assert.equal(head(w, w.app), head(w, other));
});

test("a failing pre-commit hook is reported; the hook's output is shown", async () => {
  const w = w0();
  writeFileSync(join(w.app, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'lint failed: x.ts' >&2\nexit 1\n", { mode: 0o755 });
  w.b.write(join(w.app, "a.txt"), "c\n");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "m", files: "all" }, source: "module_ui" }));
  assert.equal(r.outcome, "failed");
  assert.ok(r.output.some((l) => l.includes("lint failed")));
});

test("a leftover index.lock is reported in plain words and never deleted", async () => {
  const w = w0();
  writeFileSync(join(w.app, ".git", "index.lock"), "");
  w.b.write(join(w.app, "a.txt"), "c\n");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "m", files: "all" }, source: "module_ui" }));
  assert.equal(r.errorCode, "locked");
  assert.ok(existsSync(join(w.app, ".git", "index.lock")));
  assert.equal(w.ops.isBusy(P), false);
  assert.equal(w.store.runningOperation(P), null, "the journal row is finished");
});
