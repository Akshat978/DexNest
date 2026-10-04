// Moving a branch forward without checking it out: what the planner allows,
// what it refuses, and what it says. No git here; git-ops' own tests run it
// against real repositories.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseOperationRequest, type OperationPlan, type Refusal } from "../src/domain/operations.ts";
import { planFastForward, planOperation } from "../src/domain/planners.ts";
import type { RepoStateOk } from "../src/domain/repoState.ts";
import { branch, remoteBranch, repo, sha } from "./fixtures.ts";

/** On `develop`; local `main` is the default branch. */
function onDevelop(main: Partial<ReturnType<typeof branch>> = {}, develop: Partial<ReturnType<typeof branch>> = {}, extra: Partial<RepoStateOk> = {}): RepoStateOk {
  const dev = branch("develop", { isCurrent: true, vsDefault: { ahead: 6, behind: 0 }, mergedIntoDefault: false, ...develop });
  const local = branch("main", { upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead: 0, behind: 26 } }, ...main });
  return repo({
    head: { branch: "develop", sha: dev.tipSha, detached: false, unborn: false },
    branches: [dev, local],
    remoteBranches: [remoteBranch("main", { tipSha: sha("origin/main-new"), trackedBy: "main" }), remoteBranch("develop", { tipSha: dev.tipSha, trackedBy: "develop" })],
    ...extra
  });
}

const ok = (result: OperationPlan | Refusal): OperationPlan => {
  assert.equal(result.refused, false, result.refused ? result.reason : "");
  return result as OperationPlan;
};
const no = (result: OperationPlan | Refusal): Refusal => {
  assert.equal(result.refused, true);
  return result as Refusal;
};

test("to its upstream: a branch you are not on catches up, in one step, with nothing asked", () => {
  const state = onDevelop();
  const plan = ok(planFastForward(state, { kind: "fast_forward", branch: "main" }));
  assert.equal(plan.summary, "Move main forward 26 commits to origin/main, without switching to it.");
  assert.equal(plan.safety, "normal");
  assert.deepEqual(plan.confirm, { kind: "none" });
  assert.equal(plan.network, false, "it uses what the last fetch downloaded");
  assert.deepEqual(plan.steps, [{ op: "ff_branch", branch: "main", source: "refs/remotes/origin/main", expectSha: sha("main"), toSha: sha("origin/main-new") }]);
  assert.equal(plan.undo, null);
  assert.equal(plan.branch, "main");
  assert.equal(plan.counts.commits, 26);
  assert.match(plan.details.join(" "), /nothing on it is lost, and none of your files change/);
  // The same through the one entry point.
  assert.equal(planOperation(state, { kind: "fast_forward", branch: "main" }).refused, false);
});

test("the default branch up to another branch: asks first, and says only this PC changes", () => {
  const state = onDevelop();
  const plan = ok(planFastForward(state, { kind: "fast_forward", branch: "main", from: "develop" }));
  assert.equal(plan.title, "Bring main up to develop");
  assert.equal(plan.summary, "Move main forward to where develop is, without switching to it.");
  assert.equal(plan.safety, "caution");
  assert.deepEqual(plan.confirm, { kind: "dialog" });
  assert.deepEqual(plan.steps, [{ op: "ff_branch", branch: "main", source: "refs/heads/develop", expectSha: sha("main"), toSha: sha("develop") }]);
  assert.match(plan.details.join(" "), /Only this PC changes\. main is not pushed until you push it\./);
  assert.match(plan.details.join(" "), /main is also behind origin\/main; develop already contains those commits/);
  // Not behind its remote: that line is not there.
  const level = onDevelop({ upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead: 0, behind: 0 } } });
  assert.doesNotMatch(ok(planFastForward(level, { kind: "fast_forward", branch: "main", from: "develop" })).details.join(" "), /also behind/);
});

test("the branch you are on is refused: that is what Pull is for", () => {
  const r = no(planFastForward(onDevelop(), { kind: "fast_forward", branch: "develop" }));
  assert.equal(r.code, "current_branch");
  assert.match(r.reason, /You're on develop\. Use Pull/);
  assert.deepEqual(r.offers, ["pull"]);
});

test("a branch checked out in another worktree is never moved", () => {
  const state = onDevelop({ checkedOutElsewhere: { path: "/work/dexnest-worktrees/run-1", owner: "autopilot" } });
  for (const request of [{ kind: "fast_forward" as const, branch: "main" }, { kind: "fast_forward" as const, branch: "main", from: "develop" }]) {
    const r = no(planFastForward(state, request));
    assert.equal(r.code, "other_worktree");
    assert.match(r.reason, /an Autopilot worktree/);
  }
});

test("to its upstream: refused when there is nothing to do, when diverged, and when it cannot tell", () => {
  const upstream = (ahead: number, behind: number) => ({ upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead, behind } } });
  let r = no(planFastForward(onDevelop(upstream(0, 0)), { kind: "fast_forward", branch: "main" }));
  assert.equal(r.code, "nothing_to_do");
  assert.deepEqual(r.offers, ["fetch"], "it may only look up to date because nothing was fetched");

  r = no(planFastForward(onDevelop(upstream(2, 26)), { kind: "fast_forward", branch: "main" }));
  assert.equal(r.code, "diverged");
  assert.match(r.reason, /main has 2 commits that origin\/main doesn't, and is 26 commits behind it/);
  assert.match(r.reason, /won't merge or rebase/);

  // Ahead only: nothing to catch up with.
  assert.equal(no(planFastForward(onDevelop(upstream(3, 0)), { kind: "fast_forward", branch: "main" })).code, "nothing_to_do");

  assert.equal(no(planFastForward(onDevelop({ upstream: null }), { kind: "fast_forward", branch: "main" })).code, "no_upstream");
  assert.equal(no(planFastForward(onDevelop({ upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: true, counts: null } }), { kind: "fast_forward", branch: "main" })).code, "upstream_gone");
  // The remote branch is not in the state DexNest read: it will not guess where to move to.
  const blind = onDevelop({}, {}, { remoteBranches: [] });
  r = no(planFastForward(blind, { kind: "fast_forward", branch: "main" }));
  assert.equal(r.code, "stale_state");
  assert.deepEqual(r.offers, ["fetch"]);
});

test("up to another branch: only when the default branch can simply move forward to it", () => {
  // main has commits develop lacks: a merge would be needed, and DexNest does not merge.
  let r = no(planFastForward(onDevelop({}, { vsDefault: { ahead: 6, behind: 2 } }), { kind: "fast_forward", branch: "main", from: "develop" }));
  assert.equal(r.code, "diverged");
  assert.match(r.reason, /main has 2 commits that develop doesn't/);
  assert.match(r.reason, /won't merge for you/);

  r = no(planFastForward(onDevelop({}, { vsDefault: { ahead: 0, behind: 0 }, tipSha: sha("other") }), { kind: "fast_forward", branch: "main", from: "develop" }));
  assert.equal(r.code, "nothing_to_do");

  // Same commit already.
  r = no(planFastForward(onDevelop({}, { tipSha: sha("main") }), { kind: "fast_forward", branch: "main", from: "develop" }));
  assert.equal(r.code, "nothing_to_do");

  // Not compared (a branch beyond the comparison limit): it will not guess.
  r = no(planFastForward(onDevelop({}, { vsDefault: null }), { kind: "fast_forward", branch: "main", from: "develop" }));
  assert.equal(r.code, "stale_state");

  assert.equal(no(planFastForward(onDevelop(), { kind: "fast_forward", branch: "main", from: "nope" })).code, "not_found");
  assert.equal(no(planFastForward(onDevelop(), { kind: "fast_forward", branch: "main", from: "main" })).code, "nothing_to_do");
});

test("up to another branch: only the default branch moves this way", () => {
  const state = onDevelop();
  const withFeature: RepoStateOk = { ...state, branches: [...state.branches, branch("feature/x", { vsDefault: { ahead: 1, behind: 0 } })] };
  const r = no(planFastForward(withFeature, { kind: "fast_forward", branch: "feature/x", from: "develop" }));
  assert.equal(r.code, "invalid_request");
  assert.match(r.reason, /only brings the default branch \(main\) up to another branch/);
});

test("the shared blockers apply: an unfinished merge or conflicts stop it", () => {
  assert.equal(no(planFastForward(onDevelop({}, {}, { inProgress: "merge" }), { kind: "fast_forward", branch: "main" })).code, "in_progress");
  assert.equal(no(planFastForward(onDevelop(), { kind: "fast_forward", branch: "missing" })).code, "not_found");
});

test("names are checked before they can reach a command line", () => {
  for (const name of ["+main", "-f", "--force", "a:b", "x y", ""]) {
    assert.equal(no(planFastForward(onDevelop(), { kind: "fast_forward", branch: name })).code, "invalid_name", name);
    assert.equal(no(planFastForward(onDevelop(), { kind: "fast_forward", branch: "main", from: name })).code, "invalid_name", name);
  }
});

test("the request: branch required, from optional, nothing else; a force flag is refused outright", () => {
  assert.deepEqual(parseOperationRequest({ kind: "fast_forward", branch: "main" }), { ok: true, request: { kind: "fast_forward", branch: "main", from: undefined } });
  assert.deepEqual(parseOperationRequest({ kind: "fast_forward", branch: "main", from: "develop" }), { ok: true, request: { kind: "fast_forward", branch: "main", from: "develop" } });
  for (const bad of [{ kind: "fast_forward" }, { kind: "fast_forward", branch: 3 }, { kind: "fast_forward", branch: "main", from: 1 }, { kind: "fast_forward", branch: "main", to: "x" }]) {
    const parsed = parseOperationRequest(bad);
    assert.equal(parsed.ok, false, JSON.stringify(bad));
    if (!parsed.ok) assert.equal(parsed.refusal.code, "invalid_request");
  }
  for (const flag of ["force", "hard", "rebase"]) {
    const parsed = parseOperationRequest({ kind: "fast_forward", branch: "main", [flag]: true });
    assert.equal(!parsed.ok && parsed.refusal.code, "never_allowed", flag);
  }
});
