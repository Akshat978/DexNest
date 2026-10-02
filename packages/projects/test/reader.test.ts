// The read engine against real repositories (local bare "origin", no network).

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, test } from "node:test";

import { projectBadge } from "../src/domain/badge.ts";
import { planOperation } from "../src/domain/planners.ts";
import type { RepoState, RepoStateOk } from "../src/domain/repoState.ts";
import { GitReadError, createGitReader } from "../src/git/reader.ts";
import { assertReadOnlyGitArgv, READ_ONLY_GIT_VERBS } from "../src/git/readOnlyArgv.ts";
import { createNodeGitRunner, createNodeRepoFs } from "../src/node/gitRunner.ts";
import { sandbox, type Sandbox } from "./gitRepos.ts";

let boxes: Sandbox[] = [];
afterEach(() => {
  for (const box of boxes) box.dispose();
  boxes = [];
});
function box(): Sandbox {
  const b = sandbox();
  boxes.push(b);
  return b;
}

function ok(state: RepoState): RepoStateOk {
  if (!state.isRepo) assert.fail(`not a repo: ${state.reason}`);
  return state;
}

/** Every file under .git with its content hash - to prove reading changes nothing. */
function snapshotGitDir(dir: string): string {
  const lines: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else lines.push(`${relative(dir, full)} ${statSync(full).mtimeMs} ${createHash("sha1").update(readFileSync(full)).digest("hex")}`);
    }
  };
  walk(dir);
  return lines.sort().join("\n");
}

test("a missing folder, a plain folder and a bare repository are not working repos", async () => {
  const b = box();
  const reader = b.reader();
  assert.deepEqual(await reader.readRepoState(join(b.root, "nope")).then((s) => !s.isRepo && s.reason), "Folder not found.");
  assert.deepEqual(await reader.readRepoState(b.root).then((s) => !s.isRepo && s.reason), "Not a git repository.");
  const { bare } = b.origin();
  const state = await reader.readRepoState(bare);
  assert.equal(state.isRepo, false);
});

test("a fresh clone: on main, in sync with origin/main, default branch from origin/HEAD, all pushed", async () => {
  const b = box();
  const { app } = b.origin();
  const s = ok(await b.reader().readRepoState(app));
  assert.equal(s.head.branch, "main");
  assert.equal(s.head.detached, false);
  assert.equal(s.defaultBranch, "main");
  assert.deepEqual(s.remotes.map((r) => r.name), ["origin"]);
  const main = s.branches.find((x) => x.name === "main")!;
  assert.deepEqual(main.upstream, { ref: "origin/main", remote: "origin", branch: "main", gone: false, counts: { ahead: 0, behind: 0 } });
  assert.equal(main.isCurrent, true);
  assert.equal(s.lastCommit?.subject, "first");
  assert.equal(projectBadge(s).text, "all pushed");
  assert.equal(s.worktrees.length, 1);
  assert.equal(s.worktrees[0].owner, "self");
});

test("how far this PC is from GitHub: ahead, behind and diverged, as of the last fetch", async () => {
  const b = box();
  const { bare, app } = b.origin();
  const other = b.clone(bare, "other");
  b.write(join(app, "local.txt"), "x");
  b.git(app, "add", ".");
  b.git(app, "commit", "-q", "-m", "local work");
  let s = ok(await b.reader().readRepoState(app));
  assert.equal(projectBadge(s).text, "1 to push");
  assert.equal(s.lastFetchAt, null, "never fetched since the clone");

  b.write(join(other, "remote.txt"), "y");
  b.git(other, "add", ".");
  b.git(other, "commit", "-q", "-m", "their work");
  b.git(other, "push", "-q");
  s = ok(await b.reader().readRepoState(app));
  assert.equal(projectBadge(s).text, "1 to push", "remote state is only as fresh as the last fetch");

  b.git(app, "fetch", "-q");
  s = ok(await b.reader().readRepoState(app));
  assert.equal(projectBadge(s).text, "diverged");
  assert.ok(s.lastFetchAt, "fetch time comes from FETCH_HEAD");
  const refusal = planOperation(s, { kind: "push" });
  assert.equal(refusal.refused && refusal.code, "diverged");
});

test("working tree: staged, unstaged, untracked, renamed, deleted - paths with spaces and unicode intact", async () => {
  const b = box();
  const { app } = b.origin();
  b.write(join(app, "keep.txt"), "k");
  b.write(join(app, "gone.txt"), "g");
  b.write(join(app, "old name.txt"), "o");
  b.git(app, "add", ".");
  b.git(app, "commit", "-q", "-m", "more");
  b.write(join(app, "a.txt"), "changed\n");
  b.git(app, "mv", "old name.txt", "nëw näme.txt");
  b.git(app, "rm", "-q", "gone.txt");
  b.write(join(app, "keep.txt"), "changed but not staged");
  b.write(join(app, "dir with space", "ü file.txt"), "new");
  b.write(join(app, "staged-new.txt"), "n");
  b.git(app, "add", "staged-new.txt");

  const s = ok(await b.reader().readRepoState(app));
  const t = s.workingTree;
  assert.deepEqual(t.staged.map((f) => [f.path, f.status, f.from ?? null]).sort(), [
    ["gone.txt", "deleted", null],
    ["nëw näme.txt", "renamed", "old name.txt"],
    ["staged-new.txt", "added", null]
  ]);
  assert.deepEqual(t.unstaged.map((f) => [f.path, f.status]).sort(), [["a.txt", "modified"], ["keep.txt", "modified"]]);
  assert.deepEqual(t.untracked, ["dir with space/"]);
  assert.deepEqual(t.counts, { staged: 3, unstaged: 2, untracked: 1, conflicted: 0 });
  assert.equal(projectBadge(s).text, "1 to push", "an unpushed commit outranks uncommitted changes");
});

test("a merge with conflicts: conflicted files listed, merge in progress, everything changing refused", async () => {
  const b = box();
  const { app } = b.origin();
  b.git(app, "switch", "-q", "-c", "feature");
  b.write(join(app, "a.txt"), "feature side\n");
  b.git(app, "commit", "-q", "-am", "feature change");
  b.git(app, "switch", "-q", "main");
  b.write(join(app, "a.txt"), "main side\n");
  b.git(app, "commit", "-q", "-am", "main change");
  assert.throws(() => b.git(app, "merge", "-q", "feature"));

  const s = ok(await b.reader().readRepoState(app));
  assert.equal(s.inProgress, "merge");
  assert.deepEqual(s.workingTree.conflicted, ["a.txt"]);
  assert.equal(projectBadge(s).kind, "conflict");
  for (const request of [{ kind: "push" }, { kind: "pull" }, { kind: "stash" }, { kind: "commit", message: "m", files: "all" }] as const) {
    const result = planOperation(s, request);
    assert.equal(result.refused, true, request.kind);
  }
  assert.equal(planOperation(s, { kind: "fetch" }).refused, false, "fetch is still fine");
});

test("a rebase stopped on a conflict is reported as a rebase in progress", async () => {
  const b = box();
  const { app } = b.origin();
  b.git(app, "switch", "-q", "-c", "topic");
  b.write(join(app, "a.txt"), "topic\n");
  b.git(app, "commit", "-q", "-am", "topic");
  b.git(app, "switch", "-q", "main");
  b.write(join(app, "a.txt"), "main\n");
  b.git(app, "commit", "-q", "-am", "main");
  b.git(app, "switch", "-q", "topic");
  assert.throws(() => b.git(app, "rebase", "-q", "main"));
  const s = ok(await b.reader().readRepoState(app));
  assert.equal(s.inProgress, "rebase");
  assert.equal(projectBadge(s).text.includes("conflict") || projectBadge(s).text === "rebase in progress", true);
});

test("detached HEAD and an unborn repository", async () => {
  const b = box();
  const { app } = b.origin();
  const sha = b.git(app, "rev-parse", "HEAD").trim();
  b.git(app, "switch", "-q", "--detach", sha);
  let s = ok(await b.reader().readRepoState(app));
  assert.equal(s.head.detached, true);
  assert.equal(s.head.sha, sha);
  assert.equal(projectBadge(s).text, "detached HEAD");

  const fresh = join(b.root, "fresh");
  b.git(b.root, "init", "-q", fresh);
  b.write(join(fresh, "x.txt"), "x");
  s = ok(await b.reader().readRepoState(fresh));
  assert.deepEqual(s.head, { branch: "main", sha: null, detached: false, unborn: true });
  assert.deepEqual(s.branches, []);
  assert.deepEqual(s.workingTree.untracked, ["x.txt"]);
  assert.equal(s.lastCommit, null);
});

test("branches: local-only, remote-only, upstream gone, merged or not, how far from main, last commit", async () => {
  const b = box();
  const { bare, app } = b.origin();
  const other = b.clone(bare, "other");
  // merged: a branch at main
  b.git(app, "branch", "merged-one");
  // local-only with 2 commits
  b.git(app, "switch", "-q", "-c", "local-only");
  for (const n of [1, 2]) {
    b.write(join(app, `l${n}.txt`), "l");
    b.git(app, "add", ".");
    b.git(app, "commit", "-q", "-m", `local ${n}`);
  }
  b.git(app, "switch", "-q", "main");
  // pushed then deleted on the remote -> gone
  b.git(app, "switch", "-q", "-c", "doomed");
  b.write(join(app, "d.txt"), "d");
  b.git(app, "add", ".");
  b.git(app, "commit", "-q", "-m", "doomed");
  b.git(app, "push", "-q", "-u", "origin", "doomed");
  b.git(app, "switch", "-q", "main");
  b.git(other, "push", "-q", "origin", "--delete", "doomed");
  // remote-only
  b.git(other, "switch", "-q", "-c", "theirs");
  b.write(join(other, "t.txt"), "t");
  b.git(other, "add", ".");
  b.gitAt(other, "2025-01-01T00:00:00Z", "commit", "-q", "-m", "their old branch");
  b.git(other, "push", "-q", "-u", "origin", "theirs");
  b.git(app, "fetch", "-q", "--prune");

  const s = ok(await b.reader().readRepoState(app));
  const local = Object.fromEntries(s.branches.map((x) => [x.name, x]));
  assert.equal(local["merged-one"].mergedIntoDefault, true);
  assert.equal(local["merged-one"].upstream, null);
  assert.deepEqual(local["local-only"].vsDefault, { ahead: 2, behind: 0 });
  assert.equal(local["local-only"].mergedIntoDefault, false);
  assert.equal(local["local-only"].lastSubject, "local 2");
  assert.equal(local["doomed"].upstream?.gone, true);
  assert.equal(local["doomed"].upstream?.counts, null);
  assert.equal(local.main.vsDefault, null, "the default branch isn't compared with itself");

  const remote = Object.fromEntries(s.remoteBranches.map((x) => [x.ref, x]));
  assert.ok(!("origin/HEAD" in remote));
  assert.ok(!("origin/doomed" in remote), "pruned");
  assert.equal(remote["origin/theirs"].trackedBy, null, "remote-only");
  assert.equal(remote["origin/theirs"].name, "theirs");
  assert.deepEqual(remote["origin/theirs"].vsDefault, { ahead: 1, behind: 0 });
  assert.equal(remote["origin/theirs"].lastCommitAt?.startsWith("2025-01-01"), true);
  assert.equal(remote["origin/main"].trackedBy, "main");

  const del = planOperation(s, { kind: "delete_branch", name: "local-only" });
  assert.equal(!del.refused && del.safety, "strong");
  const delMerged = planOperation(s, { kind: "delete_branch", name: "merged-one" });
  assert.equal(!delMerged.refused && delMerged.safety, "caution");
  const sw = planOperation(s, { kind: "switch", branch: "theirs" });
  assert.deepEqual(!sw.refused && sw.steps, [{ op: "switch", branch: "theirs", track: "origin/theirs" }]);
});

test("stashes are listed newest first with the files they touch", async () => {
  const b = box();
  const { app } = b.origin();
  b.write(join(app, "a.txt"), "edit\n");
  b.git(app, "stash", "push", "-q", "-m", "first stash");
  b.write(join(app, "new.txt"), "untracked");
  b.git(app, "stash", "push", "-q", "-u", "-m", "second stash");
  const s = ok(await b.reader().readRepoState(app));
  assert.equal(s.stashes.length, 2);
  assert.equal(s.stashes[0].index, 0);
  assert.match(s.stashes[0].message, /second stash/);
  assert.deepEqual(s.stashes[0].files, ["new.txt"]);
  assert.deepEqual(s.stashes[1].files, ["a.txt"]);
  assert.equal(s.stashes[1].branch, "main");
});

test("worktrees: Autopilot's is recognised and its branch is never touched", async () => {
  const b = box();
  const { app } = b.origin();
  const wt = join(b.root, "dexnest-worktrees", "coding-run-1");
  b.git(app, "worktree", "add", "-q", "-b", "autopilot/coding-run-1", wt);
  const s = ok(await b.reader().readRepoState(app));
  assert.equal(s.worktrees.length, 2);
  const ap = s.worktrees.find((w) => !w.isCurrent)!;
  assert.equal(ap.owner, "autopilot");
  assert.equal(ap.branch, "autopilot/coding-run-1");
  const branch = s.branches.find((x) => x.name === "autopilot/coding-run-1")!;
  assert.equal(branch.checkedOutElsewhere?.owner, "autopilot");
  for (const request of [{ kind: "delete_branch", name: branch.name }, { kind: "switch", branch: branch.name }] as const) {
    const result = planOperation(s, request);
    assert.equal(result.refused && result.code, "other_worktree", request.kind);
  }
  // Read from inside the worktree, it is the current one.
  const inside = ok(await b.reader().readRepoState(wt));
  assert.equal(inside.worktrees.find((w) => w.isCurrent)?.branch, "autopilot/coding-run-1");
  assert.equal(inside.head.branch, "autopilot/coding-run-1");
});

test("submodules are listed, not recursed into", async () => {
  const b = box();
  const { bare, app } = b.origin();
  b.git(app, "-c", "protocol.file.allow=always", "submodule", "add", "-q", bare, "libs/dep");
  b.git(app, "commit", "-q", "-m", "add submodule");
  const s = ok(await b.reader().readRepoState(app));
  assert.deepEqual(s.submodules, ["libs/dep"]);
});

test("undo facts: a local commit isn't on the remote, a pushed one is, an unknown one doesn't exist", async () => {
  const b = box();
  const { app } = b.origin();
  const pushed = b.git(app, "rev-parse", "HEAD").trim();
  b.write(join(app, "n.txt"), "n");
  b.git(app, "add", ".");
  b.git(app, "commit", "-q", "-m", "local");
  const local = b.git(app, "rev-parse", "HEAD").trim();
  const reader = b.reader();
  assert.deepEqual(await reader.undoFacts(app, local), { commitOnRemote: false, objectExists: true });
  assert.deepEqual(await reader.undoFacts(app, pushed), { commitOnRemote: true, objectExists: true });
  assert.deepEqual(await reader.undoFacts(app, "0".repeat(40)), { commitOnRemote: null, objectExists: false });
  assert.deepEqual(await reader.undoFacts(app, "--all"), { commitOnRemote: null, objectExists: null }, "not a sha: nothing is run");
});

test("history marks which commits are on the remote; diff stat counts lines and flags binaries", async () => {
  const b = box();
  const { app } = b.origin();
  b.write(join(app, "n.txt"), "1\n2\n3\n");
  b.git(app, "add", ".");
  b.git(app, "commit", "-q", "-m", "local one");
  const history = await b.reader().history(app, { limit: 10 });
  assert.deepEqual(history.map((h) => [h.subject, h.onRemote]), [["local one", false], ["first", true]]);

  b.write(join(app, "a.txt"), "one\ntwo\n");
  writeFileSync(join(app, "bin.dat"), Buffer.from([0, 1, 2, 0, 255]));
  b.git(app, "add", "bin.dat");
  const stat = await b.reader().diffStat(app);
  assert.deepEqual(stat.unstaged, [{ path: "a.txt", added: 1, deleted: 0 }]);
  assert.deepEqual(stat.staged, [{ path: "bin.dat", added: null, deleted: null }]);
});

test("reading never changes the repository - not even the index", async () => {
  const b = box();
  const { app } = b.origin();
  b.write(join(app, "a.txt"), "dirty\n");
  b.write(join(app, "u.txt"), "untracked");
  b.git(app, "stash", "push", "-q", "-m", "s");
  b.write(join(app, "a.txt"), "dirty again\n");
  const before = snapshotGitDir(join(app, ".git"));
  const reader = b.reader();
  await reader.readRepoState(app);
  await reader.history(app);
  await reader.diffStat(app);
  await reader.undoFacts(app, b.git(app, "rev-parse", "HEAD").trim());
  assert.equal(snapshotGitDir(join(app, ".git")), before);
});

test("every command the engine ran was a reading command; none touched the network", async () => {
  const b = box();
  const { app } = b.origin();
  b.git(app, "stash", "push", "-q", "-m", "x", "--include-untracked");
  const reader = b.reader();
  await reader.readRepoState(app, { allBranches: true });
  await reader.history(app);
  await reader.diffStat(app);
  await reader.undoFacts(app, b.git(app, "rev-parse", "HEAD").trim());
  assert.ok(b.calls.length > 5);
  const network = new Set(["fetch", "pull", "push", "clone", "ls-remote", "remote-update", "submodule"]);
  for (const call of b.calls) {
    assert.doesNotThrow(() => assertReadOnlyGitArgv(call.args), call.args.join(" "));
    const verb = call.args.find((a, i) => !a.startsWith("-") && !(call.args[i - 1] === "-c"))!;
    assert.ok(READ_ONLY_GIT_VERBS.includes(verb), verb);
    assert.equal(network.has(verb), false, verb);
    assert.equal(call.env?.GIT_TERMINAL_PROMPT, "0");
    assert.equal(call.env?.GIT_OPTIONAL_LOCKS, "0");
    assert.ok(call.args.includes("core.fsmonitor=false"));
  }
});

test("the allowlist refuses every changing verb and every option that runs or writes something", () => {
  for (const verb of ["push", "pull", "fetch", "commit", "add", "checkout", "switch", "reset", "clean", "merge", "rebase", "branch", "tag", "cherry-pick", "revert", "am", "apply", "gc", "update-ref", "reflog", "filter-branch", "clone", "init", "mv", "rm", "restore", "notes", "replace", "submodule", "symbolic-ref", "update-index", "prune", "repack", "ls-remote", "daemon", "fast-import", "credential"]) {
    assert.throws(() => assertReadOnlyGitArgv([verb]), /not allowed/, verb);
  }
  for (const args of [
    ["stash"], ["stash", "push"], ["stash", "pop"], ["stash", "drop", "stash@{0}"], ["stash", "clear"],
    ["worktree", "add", "x"], ["worktree", "remove", "x"], ["worktree", "prune"],
    ["remote", "add", "x", "y"], ["remote", "set-url", "origin", "y"], ["remote", "prune", "origin"],
    ["config", "user.name", "x"], ["config", "--unset", "x"], ["config", "--file", "f", "a", "b"],
    ["diff", "--numstat"], ["diff", "--no-ext-diff", "--no-textconv"], ["diff", "--numstat", "--no-ext-diff", "--no-textconv", "--output=/tmp/x"],
    ["log", "--output=x"], ["log", "--ext-diff"], ["log", "--textconv"],
    ["status"],
    ["cat-file", "-p", "HEAD"],
    ["-c", "core.pager=sh", "log"], ["-c", "core.fsmonitor=evil", "status", "--porcelain=v2"], ["--exec-path=/tmp", "log"], ["-C", "/elsewhere", "log"],
    []
  ]) {
    assert.throws(() => assertReadOnlyGitArgv(args), /not allowed|only|must|no git verb/, args.join(" "));
  }
  assert.doesNotThrow(() => assertReadOnlyGitArgv(["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2"]));
  assert.doesNotThrow(() => assertReadOnlyGitArgv(["config", "--file", ".gitmodules", "--get-regexp", "x"]));
});

test("git missing, a timeout and a cancel are reported as errors, not as 'not a repo'", async () => {
  const b = box();
  const { app } = b.origin();
  const missing = createGitReader({ runner: createNodeGitRunner({ gitPath: join(b.root, "no-such-git"), env: b.env }), fs: createNodeRepoFs() });
  await assert.rejects(missing.readRepoState(app), (e: unknown) => e instanceof GitReadError && e.code === "git_missing");
  const slow = createGitReader({
    runner: { run: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true, cancelled: false, truncated: false, notFound: false }) },
    fs: createNodeRepoFs()
  });
  await assert.rejects(slow.readRepoState(app), (e: unknown) => e instanceof GitReadError && e.code === "timeout");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(b.reader().readRepoState(app, { signal: controller.signal }), (e: unknown) => e instanceof GitReadError && e.code === "cancelled");
});

test("many branches: only the most recent get compared with main, unless all are asked for", async () => {
  const b = box();
  const { app } = b.origin();
  for (let i = 0; i < 30; i += 1) b.git(app, "branch", `b${String(i).padStart(2, "0")}`);
  b.calls.length = 0;
  const limited = ok(await b.reader({ branchLimit: 5 }).readRepoState(app));
  const compares = b.calls.filter((c) => c.args.includes("rev-list")).length;
  assert.ok(compares <= 10, `${compares} comparisons`);
  assert.equal(limited.branches.length, 31, "every branch is still listed");
  assert.ok(limited.branches.filter((x) => x.vsDefault === null).length > 20, "older ones aren't compared");
  const all = ok(await b.reader({ branchLimit: 5 }).readRepoState(app, { allBranches: true }));
  assert.equal(all.branches.filter((x) => x.name !== "main" && x.vsDefault === null).length, 0);
});

test("a repository folder with spaces and unicode in its path", async () => {
  const b = box();
  const { bare } = b.origin();
  const odd = b.clone(bare, "my projëct (copy)");
  const s = ok(await b.reader().readRepoState(odd));
  assert.equal(s.worktrees[0].isCurrent, true);
  assert.equal(projectBadge(s).text, "all pushed");
});
