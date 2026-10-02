// The NEVER rules at argv level, the environment, authentication, cancel,
// concurrency and crash recovery.

import { strict as assert } from "node:assert";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { assertReadOnlyGitArgv, NEVER_RULES, type GitRunner, type GitRunResult, type GitStep } from "@dexnest/projects";

import { assertSafeMutatingArgv, MUTATING_PREFIX, stepToArgv } from "../src/argv.ts";
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

const SHA = "a".repeat(40);
const g = (...rest: string[]) => [...MUTATING_PREFIX, ...rest];

test("argv: every forbidden command is refused, however it is spelled", () => {
  const forbidden: string[][] = [
    ["push", "--force", "origin", "main:refs/heads/main"],
    ["push", "-f", "origin", "main:refs/heads/main"],
    ["push", "origin", "+main:refs/heads/main"],
    ["push", "origin", "+refs/heads/main:refs/heads/main"],
    ["push", "--force-with-lease", "origin", "main:refs/heads/main"],
    ["push", "--force-if-includes", "origin", "main:refs/heads/main"],
    ["push", "--mirror", "origin"],
    ["push", "origin", "main"],
    ["push", "origin", "other:refs/heads/main"],
    ["push", "origin", ":refs/heads/main"],
    ["push", "--delete", "origin", "main"],
    ["reset", "--hard", SHA],
    ["reset", "--hard"],
    ["reset", "--mixed", SHA],
    ["reset", "--merge", SHA],
    ["reset", "--soft", "HEAD~1"],
    ["clean", "-fdx"],
    ["clean", "-n"],
    ["rebase", "main"],
    ["rebase", "--abort"],
    ["pull", "--rebase", "origin", "main"],
    ["pull", "origin", "main"],
    ["pull", "--ff-only", "origin", "main"],
    ["commit", "--amend", "--quiet", "--file=-"],
    ["commit", "--quiet", "--file=-", "--no-verify"],
    ["commit", "-m", "x"],
    ["checkout", "--", "."],
    ["checkout", "main"],
    ["restore", "."],
    ["branch", "-D", "-f", "x"],
    ["branch", "-f", "main", SHA],
    ["branch", "--no-track", "x", "HEAD"],
    ["branch", "-D", "--", "x"],
    ["stash", "clear"],
    ["stash", "drop"],
    ["stash", "drop", "stash@{0}"],
    ["stash", "pop"],
    ["fetch", "origin", "+refs/heads/*:refs/heads/*"],
    ["fetch", "--prune", "--upload-pack=evil", "origin"],
    ["update-ref", "-d", "refs/heads/main"],
    ["filter-branch", "--all"],
    ["reflog", "expire", "--all"],
    ["gc", "--prune=now"],
    ["merge", "feature"],
    ["switch", "-f", "main"],
    ["switch", "--discard-changes", "main"],
    ["switch", "-C", "main"],
    ["clone", "ext::sh -c x", "dir"],
    ["add", "--", "../outside"],
    ["add", "--", "/etc/passwd"],
    []
  ];
  for (const args of forbidden) assert.throws(() => assertSafeMutatingArgv(g(...args)), /refuses|never/, args.join(" "));
  // ...and without git-ops' own fixed prefix nothing is accepted at all.
  assert.throws(() => assertSafeMutatingArgv(["push", "origin", "main:refs/heads/main"]), /fixed options/);
  assert.throws(() => assertSafeMutatingArgv(["-c", "core.sshCommand=evil", ...g("fetch", "--prune", "origin")]), /fixed options/);
});

test("argv: every step the planners can produce builds an argv the validator accepts", () => {
  const steps: GitStep[] = [
    { op: "fetch", remote: null, prune: true },
    { op: "fetch", remote: "origin", prune: true },
    { op: "pull_ff", remote: "origin", branch: "main" },
    { op: "push", remote: "origin", branch: "feature/x", setUpstream: true },
    { op: "push", remote: "origin", branch: "main", setUpstream: false },
    { op: "push_sha", remote: "origin", sha: SHA, branch: "old" },
    { op: "push_delete", remote: "origin", branch: "old" },
    { op: "stage", paths: "all" },
    { op: "stage", paths: ["a b.txt", "-weird.txt"] },
    { op: "commit", message: "m", only: null },
    { op: "commit", message: "m", only: ["a.txt"] },
    { op: "stash_push", label: "discard", paths: ["a.txt"], includeUntracked: true },
    { op: "stash_push", label: "stash", paths: null, includeUntracked: false },
    { op: "stash_apply", sha: SHA },
    { op: "switch", branch: "main" },
    { op: "switch", branch: "feature/z", track: "origin/feature/z" },
    { op: "branch_create", name: "x", startPoint: SHA },
    { op: "branch_delete", name: "x", expectSha: SHA },
    { op: "reset_soft", to: SHA, expectHead: SHA }
  ];
  for (const step of steps) {
    const built = stepToArgv(step, { opId: "op_1" });
    assert.doesNotThrow(() => assertSafeMutatingArgv(built.args), JSON.stringify(step));
  }
  assert.doesNotThrow(() => assertSafeMutatingArgv(stepToArgv({ op: "stash_drop_if_clean", sha: SHA }, { opId: "op_1", stashRef: "stash@{2}" }).args));
  // A commit message is stdin, never an argument.
  const commit = stepToArgv({ op: "commit", message: "--amend", only: null }, { opId: "op_1" });
  assert.equal(commit.stdin, "--amend");
  assert.equal(commit.args.includes("--amend"), false);
});

test("argv: values that slipped past a planner still can't become a force push or an option", () => {
  for (const branch of ["+main", "-f", "--force", "a:b", "x y"]) {
    const built = stepToArgv({ op: "push", remote: "origin", branch, setUpstream: false }, { opId: "op_1" });
    assert.throws(() => assertSafeMutatingArgv(built.args), /refuses|never/, branch);
  }
  assert.throws(() => assertSafeMutatingArgv(stepToArgv({ op: "fetch", remote: "--upload-pack=x", prune: true }, { opId: "op_1" }).args));
  assert.throws(() => assertSafeMutatingArgv(stepToArgv({ op: "reset_soft", to: "HEAD~3", expectHead: SHA }, { opId: "op_1" }).args));
});

test("every NEVER request is refused before git runs at all", async () => {
  const w = w0();
  w.calls.length = 0;
  for (const rule of NEVER_RULES) {
    for (const kind of rule.kinds) {
      const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind }, source: "module_ui" });
      assert.equal(r.status === "refused" && r.refusal.code, "never_allowed", kind);
    }
    for (const flag of rule.flags) {
      const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push", [flag]: true }, source: "module_ui" });
      assert.equal(r.status === "refused" && r.refusal.code, "never_allowed", flag);
    }
  }
  assert.equal(w.calls.length, 0, "not even a read");
});

test("across a full session, every git call was either a read or an allowed mutating shape", async () => {
  const w = w0();
  commitFile(w, w.app, "x.txt", "x", "x");
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  w.b.write(join(w.app, "a.txt"), "d\n");
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "discard", files: ["a.txt"] }, source: "module_ui", confirmation: { confirmed: true } });
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "create_branch", name: "b" }, source: "module_ui" });
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "delete_branch", name: "b" }, source: "module_ui", confirmation: { confirmed: true } });
  assert.ok(w.calls.length > 10);
  for (const call of w.calls) {
    const isRead = (() => {
      try {
        assertReadOnlyGitArgv(call.args);
        return true;
      } catch {
        return false;
      }
    })();
    if (!isRead) assert.doesNotThrow(() => assertSafeMutatingArgv(call.args), call.args.join(" "));
    assert.equal(call.args.some((a) => /^(--force|-f|--hard|--mirror)$/.test(a) || a.startsWith("+")), false, call.args.join(" "));
  }
});

test("mutating commands never prompt; ssh is made non-interactive unless the owner configured it", async () => {
  const w = w0();
  commitFile(w, w.app, "x.txt", "x", "x");
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  const push = w.calls.find((c) => c.args.includes("push"))!;
  assert.equal(push.env?.GIT_TERMINAL_PROMPT, "0");
  assert.equal(push.env?.GCM_INTERACTIVE, "never");
  assert.equal(push.env?.GIT_ASKPASS, "");
  assert.equal(push.env?.GIT_EDITOR, ":");
  assert.equal(push.env?.GIT_SSH_COMMAND, "ssh -o BatchMode=yes");
  assert.ok(push.args.includes("protocol.ext.allow=never"));

  w.b.git(w.app, "config", "core.sshCommand", "ssh -i ~/.ssh/work");
  commitFile(w, w.app, "y.txt", "y", "y");
  w.calls.length = 0;
  await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" });
  assert.equal(w.calls.find((c) => c.args.includes("push"))!.env?.GIT_SSH_COMMAND, undefined, "the owner's ssh setup wins");
  const local = w.make({ environmentSetsSsh: true });
  w.calls.length = 0;
  await local.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  assert.equal(w.calls.find((c) => c.args.includes("fetch"))!.env?.GIT_SSH_COMMAND, undefined);
});

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

function failingPush(stderr: string): (inner: GitRunner) => GitRunner {
  return (inner) => ({
    async run(request) {
      if (request.args.includes("push")) {
        return { exitCode: 128, stdout: "", stderr, timedOut: false, cancelled: false, truncated: false, notFound: false } satisfies GitRunResult;
      }
      return inner.run(request);
    }
  });
}

test("authentication needed: stops, says so in plain words, and the token in git's output is redacted", async () => {
  const w = w0({ runner: failingPush(`fatal: could not read Username for 'https://me:${TOKEN}@github.com': terminal prompts disabled\n`) });
  commitFile(w, w.app, "x.txt", "x", "x");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" }));
  assert.equal(r.outcome, "auth_needed");
  assert.match(r.message, /Authentication needed - open a terminal here/);
  assert.equal(r.output.join("\n").includes(TOKEN), false);
  assert.equal(w.store.getOperation(r.opId)?.outcome, "auth_needed");
  assert.equal(JSON.stringify(w.events.query({ stream: "projects" })).includes(TOKEN), false);
});

test("ssh key problems and offline remotes are told apart", async () => {
  const w = w0({ runner: failingPush("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n") });
  commitFile(w, w.app, "x.txt", "x", "x");
  assert.equal(done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "push" }, source: "module_ui" })).outcome, "auth_needed");
  const off = w0({ runner: failingPush("ssh: Could not resolve hostname github.com: Temporary failure in name resolution\nfatal: Could not read from remote repository.\n") });
  commitFile(off, off.app, "x.txt", "x", "x");
  const r = done(await off.ops.execute({ projectId: P, path: off.app, request: { kind: "push" }, source: "module_ui" }));
  assert.equal(r.errorCode, "offline");
});

test("cancel stops a running operation; the journal row is finished as cancelled", async () => {
  let release: (() => void) | null = null;
  let fetchStarted = false;
  const w = w0({
    runner: (inner) => ({
      run(request) {
        if (!request.args.includes("fetch")) return inner.run(request);
        fetchStarted = true;
        return new Promise<GitRunResult>((resolve) => {
          request.signal?.addEventListener("abort", () => resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: true, truncated: false, notFound: false }));
          release = () => resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false, cancelled: false, truncated: false, notFound: false });
        });
      }
    })
  });
  const pending = w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  while (!fetchStarted) await new Promise((r) => setTimeout(r, 5));
  const opId = w.store.runningOperation(P)!.id;
  assert.equal(w.ops.isBusy(P), true);
  const second = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  assert.deepEqual(second, { status: "busy", runningOpId: opId, runningVerb: "fetch" });
  assert.equal(w.ops.cancel(opId), true);
  const r = done(await pending);
  assert.equal(r.outcome, "cancelled");
  assert.equal(w.store.getOperation(opId)?.state, "failed");
  assert.equal(w.store.getOperation(opId)?.outcome, "cancelled");
  assert.equal(w.ops.cancel(opId), false);
  void release;
});

test("a cancel that lands between steps stops before the next step", async () => {
  let ops: ReturnType<World["make"]> | null = null;
  const w = w0({
    runner: (inner) => ({
      async run(request) {
        const result = await inner.run(request);
        // Cancel right after the stash step of "stash and switch" completes.
        if (request.args.includes("stash") && request.args.includes("push")) {
          const running = w.store.runningOperation(P);
          if (running) ops!.cancel(running.id);
        }
        return result;
      }
    })
  });
  ops = w.ops;
  w.b.git(w.app, "branch", "other");
  w.b.write(join(w.app, "a.txt"), "dirty\n");
  const r = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "switch", branch: "other", dirty: "stash" }, source: "module_ui" }));
  assert.equal(r.outcome, "cancelled");
  assert.equal(w.b.git(w.app, "branch", "--show-current").trim(), "main", "the switch never ran");
  assert.match(w.b.git(w.app, "stash", "list"), /dexnest-switch-/, "the changes are safe in the stash");
});

test("two DexNest instances on one database: the journal lets only one run", async () => {
  const w = w0();
  const first = w.make();
  const second = w.make({ newOpId: () => "op_other" });
  w.store.beginOperation({ id: "op_elsewhere", projectId: P, verb: "push", safety: "normal", params: {}, refsBefore: null }, "2026-10-01T00:00:00.000Z");
  const r = await second.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" });
  assert.deepEqual(r, { status: "busy", runningOpId: "op_elsewhere", runningVerb: "push" });
  void first;
});

test("crash mid-operation: on the next start the row becomes interrupted, with an event, and the project is free", async () => {
  const w = w0();
  w.store.beginOperation({ id: "op_crashed", projectId: P, verb: "pull", safety: "normal", params: {}, refsBefore: null }, "2026-10-01T00:00:00.000Z");
  const restarted = w.make();
  assert.deepEqual(restarted.recoverInterrupted(), [{ opId: "op_crashed", projectId: P, verb: "pull" }]);
  assert.equal(w.events.query({ stream: "projects", types: ["projects.op.interrupted"] }).length, 1);
  assert.equal(done(await restarted.execute({ projectId: P, path: w.app, request: { kind: "fetch" }, source: "module_ui" })).outcome, "succeeded");
});
