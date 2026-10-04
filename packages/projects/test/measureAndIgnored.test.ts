// What the reader adds when asked: how big new files and folders are, and
// what git ignores. Real repositories and a real disk.

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { planOperation } from "../src/domain/planners.ts";
import type { RepoState, RepoStateOk } from "../src/domain/repoState.ts";
import { createNodeRepoFs } from "../src/node/gitRunner.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

let boxes: Sandbox[] = [];
afterEach(() => {
  for (const box of boxes) box.dispose();
  boxes = [];
});

function ok(state: RepoState): RepoStateOk {
  if (!state.isRepo) assert.fail(`not a repo: ${state.reason}`);
  return state;
}

function setup(): { b: Sandbox; app: string } {
  const b = sandbox();
  boxes.push(b);
  const { app } = b.origin();
  writeFileSync(join(app, "small.txt"), "hello\n");
  mkdirSync(join(app, "dataset", "raw"), { recursive: true });
  for (let i = 0; i < 25; i += 1) writeFileSync(join(app, "dataset", i % 2 ? "raw" : "", `f${i}.bin`), Buffer.alloc(1000, 1));
  return { b, app };
}

test("new files and folders are measured only when asked", async () => {
  const { b, app } = setup();
  assert.equal(ok(await b.reader().readRepoState(app)).workingTree.sizes, undefined, "the home screen does not pay for a walk");
  const sizes = ok(await b.reader().readRepoState(app, { measureUntracked: true })).workingTree.sizes!;
  assert.deepEqual(sizes["small.txt"], { files: 1, bytes: 6, truncated: false });
  assert.deepEqual(sizes["dataset/"], { files: 25, bytes: 25_000, truncated: false }, "a folder is counted to the bottom");
});

test("counting stops at the cap and says so; links are not followed", async () => {
  const { app } = setup();
  const fs = createNodeRepoFs();
  assert.deepEqual(fs.measure!(join(app, "dataset"), 10), { files: 10, bytes: 10_000, truncated: true });
  assert.deepEqual(fs.measure!(join(app, "dataset"), 25), { files: 25, bytes: 25_000, truncated: false });
  assert.equal(fs.measure!(join(app, "not-there"), 10), null);
});

test("a very large new folder turns Commit all and Stash all into questions", async () => {
  const b = sandbox();
  boxes.push(b);
  const { app } = b.origin();
  mkdirSync(join(app, "dataset"));
  for (let i = 0; i < 1100; i += 1) writeFileSync(join(app, "dataset", `f${i}.bin`), "x");
  writeFileSync(join(app, "code.ts"), "export {};\n");

  const blind = ok(await b.reader().readRepoState(app));
  const seen = ok(await b.reader().readRepoState(app, { measureUntracked: true }));
  const commitBlind = planOperation(blind, { kind: "commit", message: "work", files: "all" });
  const commit = planOperation(seen, { kind: "commit", message: "work", files: "all" });
  assert.equal(!commitBlind.refused && commitBlind.confirm.kind, "none", "not measured: nothing is claimed");
  assert.equal(!commit.refused && commit.confirm.kind, "dialog");
  assert.match(!commit.refused ? commit.details[0] : "", /^dataset\/ \(1 KB in 1,100 files\) is very large\.$/);
  const stash = planOperation(seen, { kind: "stash" });
  assert.equal(!stash.refused && stash.confirm.kind, "dialog");
  // The one code file on its own is still one click.
  const one = planOperation(seen, { kind: "commit", message: "work", files: ["code.ts"] });
  assert.equal(!one.refused && one.confirm.kind, "none");
});

test("what git ignores is listed when asked, folders as one line", async () => {
  const { b, app } = setup();
  writeFileSync(join(app, ".gitignore"), "/dataset/\n*.log\n");
  writeFileSync(join(app, "debug.log"), "x");
  mkdirSync(join(app, "src"));
  writeFileSync(join(app, "src", "trace.log"), "x");

  const plain = ok(await b.reader().readRepoState(app));
  assert.equal(plain.workingTree.ignored, undefined);
  assert.deepEqual(plain.workingTree.untracked.sort(), [".gitignore", "small.txt"], "ignored paths are not changes");

  const tree = ok(await b.reader().readRepoState(app, { includeIgnored: true })).workingTree;
  // `src/` holds nothing but an ignored file, so git names the folder.
  assert.deepEqual([...tree.ignored!].sort(), ["dataset/", "debug.log", "src/"]);
  assert.equal(tree.ignoredTruncated, false);
});
