// What "ahead of main" is measured against, and the branch marked as deployed,
// read from real repositories.
//
// The case that prompted it: on `develop`, with a local `main` nobody had
// pulled for months. `develop` showed "32 ahead" of main when it was 6 ahead
// of the real main on the remote, and a branch already merged there showed as
// unmerged.

import { strict as assert } from "node:assert";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { planOperation } from "../src/domain/planners.ts";
import type { RepoState, RepoStateOk } from "../src/domain/repoState.ts";
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

function commit(b: Sandbox, cwd: string, name: string, message: string): string {
  b.write(join(cwd, name), `${message}\n`);
  b.git(cwd, "add", name);
  b.git(cwd, "commit", "-q", "-m", message);
  return b.git(cwd, "rev-parse", "HEAD").trim();
}

/** On `develop`, 2 ahead of origin/main; local `main` 3 behind origin/main; `staging` merged on the remote. */
function setup(): { b: Sandbox; app: string } {
  const b = sandbox();
  boxes.push(b);
  const { bare, app } = b.origin();
  // A branch that was merged on the remote later.
  b.git(app, "switch", "-q", "-c", "staging");
  commit(b, app, "staging.txt", "staging work");
  b.git(app, "push", "-q", "-u", "origin", "staging");
  b.git(app, "switch", "-q", "main");
  // The remote's main moves on: it takes staging and two more commits.
  const other = b.clone(bare, "other");
  b.git(other, "merge", "-q", "--ff-only", "origin/staging");
  commit(b, other, "r1.txt", "remote one");
  commit(b, other, "r2.txt", "remote two");
  b.git(other, "push", "-q");
  b.git(app, "fetch", "-q");
  // develop starts from the real main and adds two commits.
  b.git(app, "switch", "-q", "-c", "develop", "origin/main");
  commit(b, app, "d1.txt", "develop one");
  commit(b, app, "d2.txt", "develop two");
  b.git(app, "push", "-q", "-u", "origin", "develop");
  return { b, app };
}

const local = (state: RepoStateOk, name: string) => state.branches.find((x) => x.name === name)!;

test("a local main that is only behind is not the yardstick: branches are measured against the remote's main", async () => {
  const { b, app } = setup();
  const state = ok(await b.reader().readRepoState(app));
  assert.equal(state.defaultBranch, "main");
  assert.equal(state.defaultBase, "origin/main");
  assert.deepEqual(local(state, "main").upstream?.counts, { ahead: 0, behind: 3 });
  assert.equal(local(state, "main").vsDefault, null, "the default branch is not compared with itself");

  // 2 ahead of the real main - not 5 ahead of the stale local one.
  assert.deepEqual(local(state, "develop").vsDefault, { ahead: 2, behind: 0 });
  assert.equal(local(state, "develop").mergedIntoDefault, false);
  // Merged on the remote, so merged: against the stale local main it looked unmerged.
  assert.deepEqual(local(state, "staging").vsDefault, { ahead: 0, behind: 2 });
  assert.equal(local(state, "staging").mergedIntoDefault, true);

  // The remote's main is the base, so it is the one not compared.
  assert.equal(state.remoteBranches.find((x) => x.ref === "origin/main")!.vsDefault, null);
  assert.deepEqual(state.remoteBranches.find((x) => x.ref === "origin/develop")!.vsDefault, { ahead: 2, behind: 0 });
});

test("once local main is up to date, it is the yardstick again", async () => {
  const { b, app } = setup();
  b.git(app, "fetch", "-q", ".", "refs/remotes/origin/main:refs/heads/main");
  const state = ok(await b.reader().readRepoState(app));
  assert.equal(state.defaultBase, "main");
  assert.deepEqual(local(state, "develop").vsDefault, { ahead: 2, behind: 0 });
});

test("a local main with commits of its own stays the yardstick: it is not just an old copy", async () => {
  const { b, app } = setup();
  b.git(app, "switch", "-q", "main");
  commit(b, app, "local.txt", "only here");
  b.git(app, "switch", "-q", "develop");
  const state = ok(await b.reader().readRepoState(app));
  assert.deepEqual(local(state, "main").upstream?.counts, { ahead: 1, behind: 3 });
  assert.equal(state.defaultBase, "main");
  assert.deepEqual(local(state, "develop").vsDefault, { ahead: 5, behind: 1 });
});

test("with the stale main, bringing it up to develop is still a plain move forward", async () => {
  const { b, app } = setup();
  const state = ok(await b.reader().readRepoState(app));
  const plan = planOperation(state, { kind: "fast_forward", branch: "main", from: "develop" });
  assert.equal(plan.refused, false, plan.refused ? plan.reason : "");
  // And git agrees: the move the plan describes is a fast-forward.
  b.git(app, "fetch", "-q", "--no-tags", "--no-write-fetch-head", ".", "refs/heads/develop:refs/heads/main");
  assert.equal(b.git(app, "rev-parse", "refs/heads/main").trim(), b.git(app, "rev-parse", "refs/heads/develop").trim());
});

test("the deployed branch: every other branch is measured against what was pushed of it", async () => {
  const { b, app } = setup();
  // One more commit on develop that is not pushed: not live.
  commit(b, app, "d3.txt", "develop three, not pushed");

  const plain = ok(await b.reader().readRepoState(app));
  assert.equal(plain.deployed, undefined, "nothing marked, nothing compared");
  assert.equal(local(plain, "develop").vsDeployed, undefined);

  const state = ok(await b.reader().readRepoState(app, { deployedBranch: "develop" }));
  assert.deepEqual(state.deployed, { branch: "develop", base: "origin/develop" });
  assert.deepEqual(local(state, "develop").vsDeployed, { ahead: 1, behind: 0 }, "one commit here that is not live yet");
  assert.deepEqual(local(state, "main").vsDeployed, { ahead: 0, behind: 5 });
  assert.deepEqual(local(state, "staging").vsDeployed, { ahead: 0, behind: 4 });

  // Deployed straight from a branch with no remote copy: the local branch is the base.
  b.git(app, "branch", "-q", "hotfix", "develop");
  const localOnly = ok(await b.reader().readRepoState(app, { deployedBranch: "hotfix" }));
  assert.deepEqual(localOnly.deployed, { branch: "hotfix", base: "hotfix" });
  assert.equal(local(localOnly, "hotfix").vsDeployed, null, "the deployed branch itself, at the same commit");
  assert.equal(local(localOnly, "develop").vsDeployed, null, "the same commit as the deployed branch");

  // A name that no longer exists is reported as such, not guessed at.
  const gone = ok(await b.reader().readRepoState(app, { deployedBranch: "release" }));
  assert.deepEqual(gone.deployed, { branch: "release", base: null });
  assert.equal(local(gone, "develop").vsDeployed, undefined);
});
