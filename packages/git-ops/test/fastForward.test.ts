// Moving a branch forward without checking it out, against real repositories.
//
// The promise: the branch only ever moves forward, the branch you are on and
// your files are not touched, nothing is downloaded, and anything that is not
// a plain fast-forward is refused - by the plan, and again by git itself.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import type { GitReader } from "@dexnest/projects";

import { assertSafeMutatingArgv, MUTATING_PREFIX, stepToArgv, UnsafeGitArgv } from "../src/argv.ts";
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
const SHA = "a".repeat(40);

/**
 * The shape from the dermassist repository: on `develop` with work in the
 * tree, local `main` behind `origin/main`, and `develop` ahead of both.
 */
function behindMain(w: World): { develop: string; remoteMain: string; oldMain: string } {
  const oldMain = head(w, w.app);
  // Someone else moves origin/main on.
  const other = w.b.clone(w.bare, "other");
  commitFile(w, other, "theirs.txt", "t", "theirs");
  const remoteMain = commitFile(w, other, "theirs2.txt", "t2", "theirs again");
  w.b.git(other, "push", "-q");
  // Here: fetch, then work on develop, which starts from the new origin/main.
  w.b.git(w.app, "fetch", "-q");
  w.b.git(w.app, "switch", "-q", "-c", "develop", "origin/main");
  const develop = commitFile(w, w.app, "feature.txt", "f", "feature");
  w.b.write(join(w.app, "wip.txt"), "uncommitted work\n");
  return { develop, remoteMain, oldMain };
}

test("a branch you are not on catches up with its upstream: forward only, files and HEAD untouched, nothing fetched", async () => {
  const w = w0();
  const { develop, remoteMain, oldMain } = behindMain(w);
  assert.equal(head(w, w.app, "refs/heads/main"), oldMain);
  const fetchHead = join(w.app, ".git", "FETCH_HEAD");
  const fetchedAt = statSync(fetchHead).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));

  const preview = await w.ops.preview({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" } });
  assert.equal(preview.refused, false);
  if (preview.refused) return;
  assert.equal(preview.plan.summary, "Move main forward 2 commits to origin/main, without switching to it.");

  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" }, source: "module_ui", expectedFingerprint: preview.fingerprint }));
  assert.equal(r.outcome, "succeeded", r.message);
  assert.equal(head(w, w.app, "refs/heads/main"), remoteMain, "main is where origin/main is");
  assert.equal(head(w, w.app), develop, "still on develop, at the same commit");
  assert.equal(w.b.git(w.app, "rev-parse", "--abbrev-ref", "HEAD").trim(), "develop");
  assert.equal(readFileSync(join(w.app, "wip.txt"), "utf8"), "uncommitted work\n", "uncommitted work is untouched");
  assert.equal(statSync(fetchHead).mtimeMs, fetchedAt, "'last fetched' still means the last real fetch");
  assert.equal(head(w, w.bare, "refs/heads/main"), remoteMain, "the remote was not written to");

  const ops = w.store.listOperations(P);
  assert.deepEqual(ops.map((o) => [o.verb, o.state]), [["fast_forward", "succeeded"]]);
  assert.deepEqual(w.events.query({ stream: "projects" }).map((e) => e.type), ["projects.op.started", "projects.op.finished"]);
  // One mutating command ran, and it was the local fetch.
  const mutating = w.calls.filter((c) => c.args[0] === "-c").map((c) => c.args.slice(MUTATING_PREFIX.length));
  assert.deepEqual(mutating, [["fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/remotes/origin/main:refs/heads/main"]]);

  // Again: nothing to do, and it says a fetch might show more.
  const again = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" }, source: "module_ui" });
  assert.equal(again.status === "refused" && again.refusal.code, "nothing_to_do");
});

test("the default branch is brought up to another branch only after a yes; then it can be pushed", async () => {
  const w = w0();
  const { develop } = behindMain(w);
  const request = { kind: "fast_forward", branch: "main", from: "develop" } as const;

  const asked = await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui" });
  assert.equal(asked.status, "needs_confirmation");
  assert.notEqual(head(w, w.app, "refs/heads/main"), develop, "nothing moved before the yes");

  const r = done(await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation: { confirmed: true } }));
  assert.equal(r.outcome, "succeeded", r.message);
  assert.equal(head(w, w.app, "refs/heads/main"), develop);
  assert.equal(w.b.git(w.app, "rev-parse", "--abbrev-ref", "HEAD").trim(), "develop");
  assert.ok(existsSync(join(w.app, "wip.txt")));
  assert.notEqual(head(w, w.bare, "refs/heads/main"), develop, "only this PC changed");

  // Pushing main from develop: the existing push, naming the branch.
  const pushed = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push", branch: "main" }, source: "module_ui" }));
  assert.equal(pushed.outcome, "succeeded", pushed.message);
  assert.equal(head(w, w.bare, "refs/heads/main"), develop);
});

test("a background trigger cannot say yes: the form that asks is refused when nobody is there", async () => {
  const w = w0();
  behindMain(w);
  const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main", from: "develop" }, source: "command", nonInteractive: true });
  assert.equal(r.status === "refused" && r.refusal.code, "needs_choice");
});

test("diverged: refused in words, and nothing moves", async () => {
  const w = w0();
  const { oldMain } = behindMain(w);
  // main gets a commit of its own that origin/main does not have.
  w.b.git(w.app, "stash", "-q", "--include-untracked");
  w.b.git(w.app, "switch", "-q", "main");
  const mine = commitFile(w, w.app, "mine.txt", "m", "mine");
  w.b.git(w.app, "switch", "-q", "develop");
  assert.notEqual(mine, oldMain);

  let r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" }, source: "module_ui" });
  assert.equal(r.status === "refused" && r.refusal.code, "diverged");
  r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main", from: "develop" }, source: "module_ui", confirmation: { confirmed: true } });
  assert.equal(r.status === "refused" && r.refusal.code, "diverged");
  assert.equal(head(w, w.app, "refs/heads/main"), mine);
});

test("the branch you are on, and a branch in another worktree, are never moved this way", async () => {
  const w = w0();
  const { oldMain } = behindMain(w);
  let r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "develop" }, source: "module_ui" });
  assert.equal(r.status === "refused" && r.refusal.code, "current_branch");

  w.b.git(w.app, "worktree", "add", "-q", join(w.b.root, "dexnest-worktrees", "run-1"), "main");
  r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" }, source: "module_ui" });
  assert.equal(r.status === "refused" && r.refusal.code, "other_worktree");
  assert.equal(head(w, w.app, "refs/heads/main"), oldMain);
});

test("if either branch moved between the preview and the run, nothing is moved", async () => {
  const w = w0();
  const { oldMain } = behindMain(w);
  // A reader that lets something else change `main` right after the state is read.
  let sabotage = false;
  const inner = w.b.reader();
  const reader: GitReader = {
    ...inner,
    async readRepoState(path, read) {
      const state = await inner.readRepoState(path, read);
      if (sabotage) {
        sabotage = false;
        w.b.git(w.app, "branch", "-q", "-f", "main", `${oldMain}`);
        w.b.git(w.app, "update-ref", "refs/heads/main", w.b.git(w.app, "commit-tree", "-m", "elsewhere", "-p", oldMain, `${oldMain}^{tree}`).trim());
      }
      return state;
    }
  };
  const ops = w.make({ reader });
  sabotage = true;
  const r = done(await ops.execute({ projectId: P, path: w.app, request: { kind: "fast_forward", branch: "main" }, source: "module_ui" }));
  assert.equal(r.outcome, "failed");
  assert.equal(r.errorCode, "stale_state");
  assert.match(r.message, /changed since the preview\. Nothing was moved\./);
  assert.notEqual(head(w, w.app, "refs/heads/main"), head(w, w.app, "refs/remotes/origin/main"));
  assert.equal(w.store.listOperations(P)[0]?.state, "failed", "the journal row is finished, not left running");
});

test("git itself refuses anything that is not a fast-forward, even if a plan asked for it", async () => {
  const w = w0();
  behindMain(w);
  w.b.git(w.app, "stash", "-q", "--include-untracked");
  w.b.git(w.app, "switch", "-q", "main");
  const mine = commitFile(w, w.app, "mine.txt", "m", "mine");
  w.b.git(w.app, "switch", "-q", "develop");

  // Straight to the runner, past the planner: the command shape alone must be safe.
  const built = stepToArgv({ op: "ff_branch", branch: "main", source: "refs/remotes/origin/main", expectSha: mine, toSha: SHA }, { opId: "op_x" });
  assert.doesNotThrow(() => assertSafeMutatingArgv(built.args));
  const result = await w.b.runner.run({ cwd: w.app, args: built.args, timeoutMs: 30_000, maxBytes: 1024 * 1024 });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /rejected|non-fast-forward/);
  assert.equal(head(w, w.app, "refs/heads/main"), mine, "the diverged branch is exactly where it was");

  // And the branch that is checked out is refused by git too.
  const current = stepToArgv({ op: "ff_branch", branch: "develop", source: "refs/remotes/origin/main", expectSha: SHA, toSha: SHA }, { opId: "op_y" });
  const refused = await w.b.runner.run({ cwd: w.app, args: current.args, timeoutMs: 30_000, maxBytes: 1024 * 1024 });
  assert.notEqual(refused.exitCode, 0);
});

test("argv: the one shape, and nothing near it", () => {
  const good = [
    { op: "ff_branch", branch: "main", source: "refs/remotes/origin/main", expectSha: SHA, toSha: SHA },
    { op: "ff_branch", branch: "main", source: "refs/heads/develop", expectSha: SHA, toSha: SHA },
    { op: "ff_branch", branch: "release/1.2", source: "refs/remotes/upstream/release/1.2", expectSha: SHA, toSha: SHA }
  ] as const;
  for (const step of good) {
    const built = stepToArgv(step, { opId: "op_1" });
    assert.deepEqual(built.args.slice(MUTATING_PREFIX.length, -1), ["fetch", "--no-tags", "--no-write-fetch-head", "."]);
    assert.equal(built.network, false);
    assert.doesNotThrow(() => assertSafeMutatingArgv(built.args), JSON.stringify(step));
  }
  const p = [...MUTATING_PREFIX];
  const bad: string[][] = [
    // A '+' makes a refspec a forced update.
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "+refs/heads/develop:refs/heads/main"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:+refs/heads/main"],
    // Forced, by flag.
    [...p, "fetch", "--force", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:refs/heads/main"],
    [...p, "fetch", "-f", ".", "refs/heads/develop:refs/heads/main"],
    // Not this repository: that would be a network fetch into a local branch.
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", "origin", "refs/heads/develop:refs/heads/main"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", "https://example.com/x.git", "refs/heads/develop:refs/heads/main"],
    // Destinations that are not a local branch.
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:refs/tags/v1"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:refs/remotes/origin/main"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:main"],
    // Sources that are not a branch.
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", `${SHA}:refs/heads/main`],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "develop:refs/heads/main"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/remotes/origin:refs/heads/main"],
    // A branch onto itself, and two refspecs at once.
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/main:refs/heads/main"],
    [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/a:refs/heads/b", "refs/heads/c:refs/heads/d"]
  ];
  for (const args of bad) assert.throws(() => assertSafeMutatingArgv(args), UnsafeGitArgv, args.slice(MUTATING_PREFIX.length).join(" "));
  // Names that slipped past a planner cannot become an option or a forced refspec.
  for (const branch of ["+main", "-f", "--force", "a:b", "x y"]) {
    assert.throws(() => assertSafeMutatingArgv(stepToArgv({ op: "ff_branch", branch, source: "refs/heads/develop", expectSha: SHA, toSha: SHA }, { opId: "op_1" }).args), UnsafeGitArgv, branch);
  }
  for (const source of ["+refs/heads/develop", "refs/heads/-f", "refs/remotes/--upload-pack=x/main", "HEAD~3"]) {
    assert.throws(() => assertSafeMutatingArgv(stepToArgv({ op: "ff_branch", branch: "main", source, expectSha: SHA, toSha: SHA }, { opId: "op_1" }).args), UnsafeGitArgv, source);
  }
});
