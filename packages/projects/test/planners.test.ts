import { strict as assert } from "node:assert";
import { test } from "node:test";

import { confirmationSatisfied } from "../src/domain/safety.ts";
import {
  planOperation,
  planUndo,
  selectPullAll,
  type UndoFacts
} from "../src/domain/planners.ts";
import type { OperationPlan, OperationRequest, PlanResult, Refusal } from "../src/domain/operations.ts";
import type { RepoState, RepoStateOk } from "../src/domain/repoState.ts";
import { branch, remoteBranch, repo, sha, stash, tree, withCounts } from "./fixtures.ts";

function ok(result: PlanResult): OperationPlan {
  if (result.refused) assert.fail(`expected a plan, got refusal ${result.code}: ${result.reason}`);
  return result;
}

function no(result: PlanResult, code: Refusal["code"]): Refusal {
  if (!result.refused) assert.fail(`expected refusal ${code}, got plan: ${result.summary}`);
  assert.equal(result.code, code, result.reason);
  return result;
}

const plan = (state: RepoState, request: OperationRequest) => planOperation(state, request);

const autopilotWorktree = { path: "/work/dexnest-worktrees/coding-run-1", owner: "autopilot" as const };

// --- push --------------------------------------------------------------------

test("push: previews the commits in plain words and runs one non-force push", () => {
  const p = ok(plan(withCounts(3, 0), { kind: "push" }));
  assert.equal(p.summary, "Push 3 commits from main to origin/main.");
  assert.equal(p.safety, "normal");
  assert.equal(p.network, true);
  assert.deepEqual(p.confirm, { kind: "none" });
  assert.deepEqual(p.steps, [{ op: "push", remote: "origin", branch: "main", setUpstream: false }]);
  assert.equal(ok(plan(withCounts(1, 0), { kind: "push" })).summary, "Push 1 commit from main to origin/main.");
});

test("push: refuses when behind (pull first) and when diverged (never force)", () => {
  const behind = no(plan(withCounts(0, 2), { kind: "push" }), "behind");
  assert.deepEqual(behind.offers, ["pull"]);
  const diverged = no(plan(withCounts(2, 1), { kind: "push" }), "diverged");
  assert.match(diverged.reason, /never force-pushes/);
  assert.deepEqual(diverged.offers, ["open_terminal"]);
  no(plan(withCounts(0, 0), { kind: "push" }), "nothing_to_do");
});

test("push: a new branch is refused with an offer, then planned as push-and-set-upstream", () => {
  const feature = branch("feature/x", { isCurrent: true, upstream: null, vsDefault: { ahead: 2, behind: 0 }, mergedIntoDefault: false });
  const state = repo({ head: { branch: "feature/x", sha: feature.tipSha, detached: false, unborn: false }, branches: [branch("main"), feature] });
  const refusal = no(plan(state, { kind: "push" }), "no_upstream");
  assert.deepEqual(refusal.offers, ["push_set_upstream"]);
  const p = ok(plan(state, { kind: "push", setUpstream: true }));
  assert.deepEqual(p.steps, [{ op: "push", remote: "origin", branch: "feature/x", setUpstream: true }]);
  assert.match(p.summary, /as a new branch/);
  // Setting an upstream on a branch that already has one is refused, not silently re-pointed.
  no(plan(withCounts(1, 0), { kind: "push", setUpstream: true }), "invalid_request");
});

test("push: refuses detached HEAD, conflicts, an operation in progress, and Autopilot's branch", () => {
  no(plan(repo({ head: { branch: null, sha: sha("x"), detached: true, unborn: false } }), { kind: "push" }), "detached_head");
  no(plan(withCounts(1, 0, repo({ workingTree: tree({ conflicted: ["a.ts"] }) })), { kind: "push" }), "conflicts");
  no(plan(withCounts(1, 0, repo({ inProgress: "rebase" })), { kind: "push" }), "in_progress");
  const ap = branch("autopilot/run-1", { checkedOutElsewhere: autopilotWorktree, upstream: { ref: "origin/autopilot/run-1", remote: "origin", branch: "autopilot/run-1", gone: false, counts: { ahead: 1, behind: 0 } } });
  const r = no(plan(repo({ branches: [branch("main", { isCurrent: true }), ap] }), { kind: "push", branch: "autopilot/run-1" }), "other_worktree");
  assert.match(r.reason, /Autopilot worktree/);
});

test("push: a branch name that looks like an option is refused before anything else", () => {
  no(plan(withCounts(1, 0), { kind: "push", branch: "--force" }), "invalid_name");
  no(plan(withCounts(1, 0), { kind: "push", branch: "+main" }), "invalid_name");
});

// --- pull --------------------------------------------------------------------

test("pull: fast-forward only; diverged is refused and offers nothing destructive", () => {
  const p = ok(plan(withCounts(0, 4), { kind: "pull" }));
  assert.equal(p.summary, "Pull 4 commits from origin/main into main.");
  assert.deepEqual(p.steps, [{ op: "pull_ff", remote: "origin", branch: "main" }]);
  const r = no(plan(withCounts(1, 2), { kind: "pull" }), "diverged");
  assert.deepEqual(r.offers, ["open_terminal"]);
  assert.match(r.reason, /won't merge or rebase/);
});

test("pull: no upstream, gone upstream, detached and unborn are refused", () => {
  const noUp = repo({ branches: [branch("main", { isCurrent: true, upstream: null })] });
  no(plan(noUp, { kind: "pull" }), "no_upstream");
  const gone = repo({ branches: [branch("main", { isCurrent: true, upstream: { ref: "origin/main", remote: "origin", branch: "main", gone: true, counts: null } })] });
  no(plan(gone, { kind: "pull" }), "upstream_gone");
  no(plan(repo({ head: { branch: null, sha: sha("d"), detached: true, unborn: false } }), { kind: "pull" }), "detached_head");
  no(plan(repo({ head: { branch: "main", sha: null, detached: false, unborn: true }, branches: [] }), { kind: "pull" }), "unborn");
});

test("pull with uncommitted changes is allowed but says git will stop rather than overwrite", () => {
  const p = ok(plan(withCounts(0, 1, repo({ workingTree: tree({ unstaged: [{ path: "a.ts", status: "modified" }] }) })), { kind: "pull" }));
  assert.ok(p.details.some((d) => /stops without changing anything/.test(d)));
});

test("pull all: only clean projects that can fast-forward; the rest are reported with a reason", () => {
  const dirty = withCounts(0, 1, repo({ workingTree: tree({ untracked: ["x"] }) }));
  const selection = selectPullAll([
    { projectId: "can", state: withCounts(0, 2) },
    { projectId: "dirty", state: dirty },
    { projectId: "diverged", state: withCounts(1, 1) },
    { projectId: "synced", state: withCounts(0, 0) },
    { projectId: "folder", state: { isRepo: false, reason: "Not a git repository.", readAt: "x" } }
  ]);
  assert.deepEqual(selection.pull.map((p) => p.projectId), ["can"]);
  assert.deepEqual(Object.fromEntries(selection.skipped.map((s) => [s.projectId, s.reason])), {
    dirty: "has uncommitted changes",
    diverged: "diverged",
    synced: "nothing to pull as of the last fetch",
    folder: "Not a git repository."
  });
});

// --- fetch -------------------------------------------------------------------

test("fetch: allowed even mid-rebase or with conflicts (it changes no branch); refused without a remote", () => {
  const p = ok(plan(repo({ inProgress: "rebase", workingTree: tree({ conflicted: ["a"] }) }), { kind: "fetch" }));
  assert.deepEqual(p.steps, [{ op: "fetch", remote: null, prune: true }]);
  assert.equal(p.network, true);
  no(plan(repo({ remotes: [] }), { kind: "fetch" }), "no_remote");
  no(plan(repo(), { kind: "fetch", remote: "upstream" }), "not_found");
  no(plan(repo(), { kind: "fetch", remote: "--upload-pack=evil" }), "invalid_name");
});

// --- commit ------------------------------------------------------------------

test("commit: message required; all files or only the chosen ones; undo recorded", () => {
  const state = repo({ workingTree: tree({ unstaged: [{ path: "a.ts", status: "modified" }], untracked: ["new.ts"], staged: [{ path: "b.ts", status: "added" }] }) });
  no(plan(state, { kind: "commit", message: "   ", files: "all" }), "invalid_request");
  const all = ok(plan(state, { kind: "commit", message: "Add things\n\nbody", files: "all" }));
  assert.deepEqual(all.steps, [{ op: "stage", paths: "all" }, { op: "commit", message: "Add things\n\nbody", only: null }]);
  assert.equal(all.summary, 'Commit all 3 changed files to main: "Add things".');
  assert.equal(all.undo, "uncommit");
  const some = ok(plan(state, { kind: "commit", message: "x", files: ["new.ts", "a.ts", "new.ts"] }));
  assert.deepEqual(some.steps, [{ op: "stage", paths: ["new.ts"] }, { op: "commit", message: "x", only: ["new.ts", "a.ts"] }]);
});

test("commit: refuses unknown files, paths escaping the repo, nothing to commit, detached HEAD", () => {
  const state = repo({ workingTree: tree({ unstaged: [{ path: "a.ts", status: "modified" }] }) });
  no(plan(state, { kind: "commit", message: "x", files: ["b.ts"] }), "stale_state");
  no(plan(state, { kind: "commit", message: "x", files: ["../outside"] }), "invalid_request");
  no(plan(state, { kind: "commit", message: "x", files: ["C:/Windows/x"] }), "invalid_request");
  no(plan(state, { kind: "commit", message: "x", files: [] }), "invalid_request");
  no(plan(repo(), { kind: "commit", message: "x", files: "all" }), "nothing_to_do");
  no(plan({ ...state, head: { branch: null, sha: sha("d"), detached: true, unborn: false } }, { kind: "commit", message: "x", files: "all" }), "detached_head");
});

test("commit: the first commit of a new repo has no undo (there is no parent)", () => {
  const p = ok(plan(repo({ head: { branch: "main", sha: null, detached: false, unborn: true }, branches: [], workingTree: tree({ untracked: ["a"] }) }), { kind: "commit", message: "first", files: "all" }));
  assert.equal(p.undo, null);
});

// --- stash -------------------------------------------------------------------

test("stash and pop: a clean pop is normal; one that may conflict needs a confirmation and keeps the stash", () => {
  const dirty = repo({ workingTree: tree({ unstaged: [{ path: "src/a.ts", status: "modified" }] }) });
  const s = ok(plan(dirty, { kind: "stash" }));
  assert.deepEqual(s.steps, [{ op: "stash_push", label: "stash", paths: null, includeUntracked: true }]);
  assert.equal(s.undo, "pop_stash");
  no(plan(repo(), { kind: "stash" }), "nothing_to_do");

  const entry = stash(0);
  const clean = ok(plan(repo({ stashes: [entry] }), { kind: "stash_pop", index: 0, sha: entry.sha }));
  assert.equal(clean.safety, "normal");
  assert.deepEqual(clean.steps, [{ op: "stash_apply", sha: entry.sha }, { op: "stash_drop_if_clean", sha: entry.sha }]);

  const conflicting = ok(plan({ ...dirty, stashes: [entry] }, { kind: "stash_pop", index: 0, sha: entry.sha }));
  assert.equal(conflicting.safety, "caution");
  assert.deepEqual(conflicting.confirm, { kind: "dialog" });
  assert.ok(conflicting.details.some((d) => /stash is kept/.test(d)));
});

test("stash pop refuses when the list moved under the view", () => {
  const entry = stash(0);
  no(plan(repo({ stashes: [entry] }), { kind: "stash_pop", index: 0, sha: sha("other") }), "stale_state");
  no(plan(repo({ stashes: [entry] }), { kind: "stash_pop", index: 1, sha: entry.sha }), "stale_state");
});

// --- switch / create ---------------------------------------------------------

test("switch: with uncommitted changes it asks (stash or cancel); choosing stash stashes first", () => {
  const dirty = repo({
    branches: [branch("main", { isCurrent: true }), branch("feature")],
    workingTree: tree({ unstaged: [{ path: "a", status: "modified" }] })
  });
  const r = no(plan(dirty, { kind: "switch", branch: "feature" }), "needs_choice");
  assert.deepEqual(r.offers, ["stash_and_switch"]);
  const p = ok(plan(dirty, { kind: "switch", branch: "feature", dirty: "stash" }));
  assert.deepEqual(p.steps, [
    { op: "stash_push", label: "switch", paths: null, includeUntracked: true },
    { op: "switch", branch: "feature" }
  ]);
  assert.equal(p.undo, "switch_back");
});

test("switch: a remote-only branch is checked out tracking it; Autopilot's branch is never touched", () => {
  const state = repo({ remoteBranches: [remoteBranch("main"), remoteBranch("feature/z")] });
  const p = ok(plan(state, { kind: "switch", branch: "feature/z" }));
  assert.deepEqual(p.steps, [{ op: "switch", branch: "feature/z", track: "origin/feature/z" }]);
  no(plan(state, { kind: "switch", branch: "nope" }), "not_found");
  const ap = repo({ branches: [branch("main", { isCurrent: true }), branch("autopilot/run-1", { checkedOutElsewhere: autopilotWorktree })] });
  no(plan(ap, { kind: "switch", branch: "autopilot/run-1" }), "other_worktree");
  no(plan(repo(), { kind: "switch", branch: "main" }), "nothing_to_do");
});

test("create branch: validates the name, refuses duplicates, starts at HEAD by default", () => {
  const p = ok(plan(repo(), { kind: "create_branch", name: "feature/new" }));
  assert.deepEqual(p.steps, [{ op: "branch_create", name: "feature/new", startPoint: repo().head.sha }]);
  assert.equal(p.undo, "delete_created_branch");
  no(plan(repo(), { kind: "create_branch", name: "main" }), "exists");
  for (const bad of ["-D", "has space", "a..b", "x.lock", "a/.hidden", "@", "x~1", "end/"]) {
    no(plan(repo(), { kind: "create_branch", name: bad }), "invalid_name");
  }
  no(plan(repo(), { kind: "create_branch", name: "x", startPoint: "ghost" }), "not_found");
});

// --- delete ------------------------------------------------------------------

test("delete branch: merged -> confirmation dialog; unmerged -> type the branch name", () => {
  const merged = branch("done", { mergedIntoDefault: true });
  const unmerged = branch("wip", { mergedIntoDefault: false, vsDefault: { ahead: 3, behind: 0 }, upstream: null });
  const state = repo({ branches: [branch("main", { isCurrent: true }), merged, unmerged] });

  const a = ok(plan(state, { kind: "delete_branch", name: "done" }));
  assert.equal(a.safety, "caution");
  assert.deepEqual(a.confirm, { kind: "dialog" });
  assert.deepEqual(a.steps, [{ op: "branch_delete", name: "done", expectSha: merged.tipSha }]);
  assert.equal(a.undo, "recreate_branch");

  const b = ok(plan(state, { kind: "delete_branch", name: "wip" }));
  assert.equal(b.safety, "strong");
  assert.deepEqual(b.confirm, { kind: "type", text: "wip" });
  assert.ok(b.details.some((d) => /3 commits not in main/.test(d)));
  assert.ok(b.details.some((d) => /isn't on the remote/.test(d)));
});

test("delete branch: never the current branch, the default branch, or one checked out in another worktree", () => {
  const state = repo({ branches: [branch("main", { isCurrent: true }), branch("ap", { checkedOutElsewhere: autopilotWorktree })] });
  no(plan(state, { kind: "delete_branch", name: "main" }), "current_branch");
  const onFeature = repo({ head: { branch: "f", sha: sha("f"), detached: false, unborn: false }, branches: [branch("main"), branch("f", { isCurrent: true })] });
  no(plan(onFeature, { kind: "delete_branch", name: "main" }), "default_branch");
  no(plan(state, { kind: "delete_branch", name: "ap" }), "other_worktree");
});

test("delete remote branch: strong, network, never the default branch", () => {
  const state = repo({ remoteBranches: [remoteBranch("main"), remoteBranch("old", { trackedBy: "old" })] });
  const p = ok(plan(state, { kind: "delete_remote_branch", remote: "origin", name: "old" }));
  assert.equal(p.safety, "strong");
  assert.equal(p.network, true);
  assert.deepEqual(p.confirm, { kind: "type", text: "old" });
  assert.deepEqual(p.steps, [{ op: "push_delete", remote: "origin", branch: "old" }]);
  no(plan(state, { kind: "delete_remote_branch", remote: "origin", name: "main" }), "default_branch");
  no(plan(state, { kind: "delete_remote_branch", remote: "origin", name: "gone" }), "not_found");
});

test("delete remote branch: refused when it is the upstream of a branch in an Autopilot worktree", () => {
  const ap = branch("autopilot/run-1", { checkedOutElsewhere: autopilotWorktree, upstream: { ref: "origin/autopilot/run-1", remote: "origin", branch: "autopilot/run-1", gone: false, counts: { ahead: 0, behind: 0 } } });
  const state = repo({ branches: [branch("main", { isCurrent: true }), ap], remoteBranches: [remoteBranch("main"), remoteBranch("autopilot/run-1")] });
  no(plan(state, { kind: "delete_remote_branch", remote: "origin", name: "autopilot/run-1" }), "other_worktree");
});

// --- discard -----------------------------------------------------------------

test("discard: caution, and the discard itself is a backup stash so it can be undone", () => {
  const state = repo({ workingTree: tree({ unstaged: [{ path: "a.ts", status: "modified" }], untracked: ["tmp.log"] }) });
  const p = ok(plan(state, { kind: "discard", files: ["a.ts", "tmp.log"] }));
  assert.equal(p.safety, "caution");
  assert.deepEqual(p.confirm, { kind: "dialog" });
  assert.deepEqual(p.steps, [{ op: "stash_push", label: "discard", paths: ["a.ts", "tmp.log"], includeUntracked: true }]);
  assert.equal(p.undo, "apply_stash");
  // No step anywhere is a destructive checkout/restore/clean.
  assert.ok(p.steps.every((s) => s.op === "stash_push"));
});

test("discard: refuses conflicted files, files with no changes, and an unborn repo", () => {
  no(plan(repo({ workingTree: tree({ conflicted: ["c.ts"] }) }), { kind: "discard", files: ["c.ts"] }), "conflicts");
  no(plan(repo({ workingTree: tree({ untracked: ["x"] }) }), { kind: "discard", files: ["y"] }), "stale_state");
  no(plan(repo({ head: { branch: "main", sha: null, detached: false, unborn: true }, branches: [], workingTree: tree({ untracked: ["x"] }) }), { kind: "discard", files: ["x"] }), "unborn");
});

// --- undo --------------------------------------------------------------------

const unpushed: UndoFacts = { commitOnRemote: false, objectExists: true };

test("undo commit: only while HEAD is still that commit and it was never pushed", () => {
  const head = repo().head.sha!;
  const record = { kind: "uncommit" as const, branch: "main", commitSha: head, parentSha: sha("parent") };
  const p = ok(planUndo(repo(), record, unpushed));
  assert.deepEqual(p.steps, [{ op: "reset_soft", to: sha("parent"), expectHead: head }]);
  const pushed = no(planUndo(repo(), record, { commitOnRemote: true, objectExists: true }), "cannot_undo");
  assert.match(pushed.reason, /never rewrites pushed history/);
  no(planUndo(repo(), record, { commitOnRemote: null, objectExists: true }), "cannot_undo");
  no(planUndo(repo(), { ...record, commitSha: sha("older") }, unpushed), "cannot_undo");
});

test("undo branch delete recreates it at the recorded commit; undo discard applies the backup", () => {
  const p = ok(planUndo(repo(), { kind: "recreate_branch", name: "wip", sha: sha("wip") }, unpushed));
  assert.deepEqual(p.steps, [{ op: "branch_create", name: "wip", startPoint: sha("wip") }]);
  no(planUndo(repo(), { kind: "recreate_branch", name: "main", sha: sha("x") }, unpushed), "exists");
  no(planUndo(repo(), { kind: "recreate_branch", name: "wip", sha: sha("wip") }, { commitOnRemote: null, objectExists: false }), "cannot_undo");

  const backup = stash(0, { message: "dexnest-discard-op1" });
  const d = ok(planUndo(repo({ stashes: [backup] }), { kind: "apply_stash", sha: backup.sha }, unpushed));
  assert.deepEqual(d.steps, [{ op: "stash_apply", sha: backup.sha }, { op: "stash_drop_if_clean", sha: backup.sha }]);
});

test("undo create branch only while the branch has nothing new", () => {
  const created = branch("feat");
  const state = repo({ branches: [branch("main", { isCurrent: true }), created] });
  ok(planUndo(state, { kind: "delete_created_branch", name: "feat", sha: created.tipSha }, unpushed));
  no(planUndo(state, { kind: "delete_created_branch", name: "feat", sha: sha("old") }, unpushed), "cannot_undo");
});

// --- general -----------------------------------------------------------------

test("every changing operation is refused on a folder that is not a repo", () => {
  const absent: RepoState = { isRepo: false, reason: "Not a git repository.", readAt: "x" };
  for (const request of [{ kind: "push" }, { kind: "pull" }, { kind: "fetch" }, { kind: "stash" }] as OperationRequest[]) {
    no(plan(absent, request), "not_a_repo");
  }
});

test("confirmation: strong plans need the exact branch name; dialogs need an explicit yes", () => {
  assert.equal(confirmationSatisfied({ kind: "none" }, undefined), true);
  assert.equal(confirmationSatisfied({ kind: "dialog" }, undefined), false);
  assert.equal(confirmationSatisfied({ kind: "dialog" }, { confirmed: true }), true);
  const typed = { kind: "type" as const, text: "feature/x" };
  assert.equal(confirmationSatisfied(typed, { confirmed: true }), false);
  assert.equal(confirmationSatisfied(typed, { confirmed: true, typed: "feature/X" }), false);
  assert.equal(confirmationSatisfied(typed, { confirmed: true, typed: " feature/x" }), false);
  assert.equal(confirmationSatisfied(typed, { confirmed: false, typed: "feature/x" }), false);
  assert.equal(confirmationSatisfied(typed, { confirmed: true, typed: "feature/x" }), true);
});

test("no plan from any planner contains a step outside the known safe set", () => {
  const safeOps = new Set(["fetch", "pull_ff", "push", "push_sha", "push_delete", "stage", "commit", "stash_push", "stash_apply", "stash_drop_if_clean", "switch", "branch_create", "branch_delete", "reset_soft"]);
  const dirty: RepoStateOk = repo({
    branches: [branch("main", { isCurrent: true }), branch("other", { mergedIntoDefault: false })],
    remoteBranches: [remoteBranch("main"), remoteBranch("rb")],
    workingTree: tree({ unstaged: [{ path: "a", status: "modified" }] }),
    stashes: [stash(0)]
  });
  const requests: OperationRequest[] = [
    { kind: "fetch" }, { kind: "pull" }, { kind: "push" }, { kind: "commit", message: "m", files: "all" },
    { kind: "stash" }, { kind: "stash_pop", index: 0, sha: stash(0).sha }, { kind: "switch", branch: "other", dirty: "stash" },
    { kind: "create_branch", name: "n", switchTo: true }, { kind: "delete_branch", name: "other" },
    { kind: "delete_remote_branch", remote: "origin", name: "rb" }, { kind: "discard", files: ["a"] }
  ];
  for (const request of requests) {
    for (const state of [dirty, withCounts(2, 0), withCounts(0, 2, dirty)]) {
      const result = plan(state, request);
      if (!result.refused) for (const step of result.steps) assert.ok(safeOps.has(step.op), `${request.kind} produced ${step.op}`);
    }
  }
});
