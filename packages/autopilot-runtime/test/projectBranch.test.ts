// Working directly in the operator's project, on a dedicated branch.
//
// This mode trades away the worktree's free isolation, so the tests are mostly
// about what was bought in exchange: the operator's own branch is never
// committed to, the way back is recorded durably before any work starts, and
// the run refuses outright in the one situation where a clean revert would be
// impossible afterwards.
//
// Real git, real SQLite, the real policy and dispatcher. No provider is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { ProjectBranchManager, ProjectBranchError, branchNameForRun, renderProjectBranchSummary } from "../src/projectBranch.ts";
import { createRunSpec, authoritativeFingerprint } from "../src/runSpec.ts";
import { defaultCapabilityPolicy, evaluatePathAccess } from "../src/policy.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";
import { EffectsGateway } from "../src/effects.ts";
import { Dispatcher } from "../src/dispatcher.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./helpers/harness.ts";
import { createPlatformPorts } from "./helpers/platform.ts";
import type { RuntimePorts } from "../src/ports.ts";

const RUN_ID = "coding-run-branch-1";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function initProject(dir: string): void {
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8", windowsHide: true });
  git(dir, ["config", "user.email", "project@example.invalid"]);
  git(dir, ["config", "user.name", "Project Test"]);
  writeFileSync(resolve(dir, "README.md"), "# project\n", "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "initial"]);
}

function open(root: string, instance = 1) {
  const project = resolve(root, "project");
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  const platform = createPlatformPorts({ PATH: process.env.PATH ?? "" });
  const ports: RuntimePorts = {
    db: database.db,
    platform,
    clock: createTestClock(),
    ids: createTestIds(instance),
    logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, ports.clock.now());

  const store = new AutopilotStore(ports);
  const policy = defaultCapabilityPolicy();
  policy.workspaceRoot = project;

  const effects = new EffectsGateway({ ports, store, dispatcher: new Dispatcher({ platform }) });
  const manager = new ProjectBranchManager({ ports, effects });
  const spec = createRunSpec(
    { goal: "work in the project", workspaceMode: "project-branch", capabilities: { workspaceRoot: project } as never },
    { id: "spec", now: ports.clock.now() }
  );
  // A restart reopens the same database, so the run is already there.
  try { store.requireRun(RUN_ID); } catch { store.createRun({ spec: { ...spec, id: RUN_ID }, executorId: "test" }); }

  return { ports, store, policy, manager, project, close: () => database.close() };
}

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-branch-"));
  mkdirSync(resolve(root, "project"));
  initProject(resolve(root, "project"));
  let handle = open(root);
  t.after(() => {
    try { handle.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return {
    root,
    get h() { return handle; },
    restart() { handle.close(); handle = open(root, 2); return handle; }
  };
}

const input = (h: ReturnType<typeof open>) => ({ runId: RUN_ID, repoRoot: h.project, policy: h.policy });

// --- preflight --------------------------------------------------------------

test("preflight reports the branch and the way back without changing anything", async (t) => {
  const { h } = fixture(t);
  const before = git(h.project, ["rev-parse", "--abbrev-ref", "HEAD"]);

  const plan = await h.manager.preflight(input(h));
  assert.equal(plan.branch, `dexnest/${RUN_ID}`);
  assert.equal(plan.baseBranch, "main");
  assert.equal(plan.baseSha, git(h.project, ["rev-parse", "HEAD"]));
  assert.equal(plan.alreadyOnBranch, false);

  // Read-only: no branch created, none checked out, nothing recorded.
  assert.equal(git(h.project, ["rev-parse", "--abbrev-ref", "HEAD"]), before);
  assert.equal(git(h.project, ["branch", "--list", plan.branch]), "");
  assert.equal(h.manager.record(RUN_ID), null);
});

test("a dirty project is refused, because no later checkpoint could untangle it", async (t) => {
  const { h } = fixture(t);
  writeFileSync(resolve(h.project, "operator-work.txt"), "half-finished\n", "utf8");

  await assert.rejects(() => h.manager.preflight(input(h)), (error: ProjectBranchError) => {
    assert.equal(error.rule, "project.dirty");
    assert.match(error.message, /1 uncommitted change/);
    assert.match(error.message, /commit or stash/i);
    return true;
  });
});

test("a detached HEAD is refused: there would be nothing to return the operator to", async (t) => {
  const { h } = fixture(t);
  git(h.project, ["checkout", "--detach", "HEAD"]);
  await assert.rejects(() => h.manager.preflight(input(h)), /detached HEAD/);
});

test("a subdirectory and a non-repository are both refused", async (t) => {
  const { h } = fixture(t);
  const nested = resolve(h.project, "src");
  mkdirSync(nested);
  await assert.rejects(
    () => h.manager.preflight({ ...input(h), repoRoot: nested, policy: { ...h.policy, workspaceRoot: nested } }),
    /repository root itself/
  );

  const plain = mkdtempSync(resolve(tmpdir(), "dexnest-plain-"));
  t.after(() => rmSync(plain, { recursive: true, force: true, maxRetries: 5 }));
  await assert.rejects(
    () => h.manager.preflight({ ...input(h), repoRoot: plain, policy: { ...h.policy, workspaceRoot: plain } }),
    /Not a git repository/
  );
});

test("a project inside or containing a denied root is refused before git is touched", (t) => {
  const { h } = fixture(t);
  assert.throws(() => h.manager.assertUsable("D:/DeskNest/local-data/projects/app"), /may not work inside/);
  assert.throws(() => h.manager.assertUsable("D:/DeskNest"), /contains D:\/DeskNest\/local-data/);
  assert.throws(() => h.manager.assertUsable("C:/Windows/System32"), /may not work inside/);
});

// --- branch creation --------------------------------------------------------

test("ensureBranch creates the branch, checks it out and records the way back", async (t) => {
  const { h } = fixture(t);
  const baseSha = git(h.project, ["rev-parse", "HEAD"]);

  const record = await h.manager.ensureBranch(input(h));
  assert.equal(record.branch, `dexnest/${RUN_ID}`);
  assert.equal(record.baseBranch, "main");
  assert.equal(record.baseSha, baseSha);
  assert.equal(git(h.project, ["rev-parse", "--abbrev-ref", "HEAD"]), `dexnest/${RUN_ID}`);

  const events = h.store.listEvents(RUN_ID).map((event) => event.type);
  assert.equal(events.filter((type) => type === "PROJECT_BRANCH_CREATED").length, 1);
});

test("calling ensureBranch again is a no-op rather than a second branch", async (t) => {
  const { h } = fixture(t);
  const first = await h.manager.ensureBranch(input(h));
  const second = await h.manager.ensureBranch(input(h));
  assert.deepEqual(second, first);
  assert.equal(
    h.store.listEvents(RUN_ID).filter((event) => event.type.startsWith("PROJECT_BRANCH_")).length,
    1,
    "an idempotent call must not journal a second branch event"
  );
});

test("the operator's own branch is never committed to", async (t) => {
  const { h } = fixture(t);
  const mainBefore = git(h.project, ["rev-parse", "main"]);
  await h.manager.ensureBranch(input(h));

  // Work of the kind the loop would checkpoint.
  writeFileSync(resolve(h.project, "feature.ts"), "export const feature = 1;\n", "utf8");
  git(h.project, ["add", "."]);
  git(h.project, ["commit", "-m", "run work"]);

  assert.equal(git(h.project, ["rev-parse", "main"]), mainBefore, "main must not have moved");
  assert.notEqual(git(h.project, ["rev-parse", "HEAD"]), mainBefore);
  // And the recorded base still points at where the operator was.
  assert.equal(h.manager.record(RUN_ID)!.baseSha, mainBefore);
});

test("a restart resumes the same branch and keeps the original revert target", async (t) => {
  const f = fixture(t);
  const baseSha = git(f.h.project, ["rev-parse", "HEAD"]);
  await f.h.manager.ensureBranch(input(f.h));

  writeFileSync(resolve(f.h.project, "feature.ts"), "export const feature = 1;\n", "utf8");
  git(f.h.project, ["add", "."]);
  git(f.h.project, ["commit", "-m", "run work"]);
  const moved = git(f.h.project, ["rev-parse", "HEAD"]);
  assert.notEqual(moved, baseSha);

  const h = f.restart();
  const resumed = await h.manager.ensureBranch(input(h));
  assert.equal(resumed.baseSha, baseSha, "the revert target must stay where the run began, not follow HEAD");
  assert.equal(resumed.baseBranch, "main");
  assert.equal(git(h.project, ["rev-parse", "HEAD"]), moved, "resuming must not discard the run's commits");
});

test("a restart that left the project on another branch checks the run branch back out", async (t) => {
  const f = fixture(t);
  await f.h.manager.ensureBranch(input(f.h));
  writeFileSync(resolve(f.h.project, "feature.ts"), "export const feature = 1;\n", "utf8");
  git(f.h.project, ["add", "."]);
  git(f.h.project, ["commit", "-m", "run work"]);
  const branchHead = git(f.h.project, ["rev-parse", "HEAD"]);
  git(f.h.project, ["checkout", "main"]);

  const h = f.restart();
  await h.manager.ensureBranch(input(h));
  assert.equal(git(h.project, ["rev-parse", "--abbrev-ref", "HEAD"]), `dexnest/${RUN_ID}`);
  assert.equal(git(h.project, ["rev-parse", "HEAD"]), branchHead);
  assert.equal(
    h.store.listEvents(RUN_ID).filter((event) => event.type === "PROJECT_BRANCH_RESUMED").length,
    1
  );
});

test("resuming does not re-impose the clean-tree precondition", async (t) => {
  const f = fixture(t);
  await f.h.manager.ensureBranch(input(f.h));

  // Mid-iteration crash: the agent's edits are still uncommitted.
  writeFileSync(resolve(f.h.project, "in-progress.ts"), "half written\n", "utf8");

  const h = f.restart();
  const resumed = await h.manager.ensureBranch(input(h));
  assert.equal(resumed.branch, `dexnest/${RUN_ID}`);
});

// --- repository internals ---------------------------------------------------

test(".git is denied while .gitignore and .github stay editable", (t) => {
  const { h } = fixture(t);
  const decide = (path: string, mode: "read" | "write") => evaluatePathAccess(h.policy, { path, mode });

  for (const path of [`${h.project}/.git/config`, `${h.project}/.git/hooks/pre-commit`, `${h.project}/.git/objects/ab/cd`]) {
    const decision = decide(path, "write");
    assert.equal(decision.decision, "DENY", path);
    assert.equal(decision.rule, "path.repository-internals");
  }
  // Reads too: the object store is not context.
  assert.equal(decide(`${h.project}/.git/config`, "read").decision, "DENY");

  // Files that merely start with ".git" are ordinary project files.
  for (const path of [`${h.project}/.gitignore`, `${h.project}/.gitattributes`, `${h.project}/.github/workflows/ci.yml`]) {
    assert.equal(decide(path, "write").decision, "ALLOW", path);
  }
});

// --- run spec ---------------------------------------------------------------

test("workspace mode defaults to worktree and is authoritative when it is not", () => {
  const at = { id: "spec-1", now: "2026-09-05T00:00:00.000Z" };
  const isolated = createRunSpec({ goal: "Build the thing" }, at);
  assert.equal(isolated.workspaceMode, "worktree");
  // Unchanged from before the field existed: the default must hash as absence.
  assert.equal(authoritativeFingerprint(isolated), "fnv1a-f3ffbda5");

  const inProject = createRunSpec({ goal: "Build the thing", workspaceMode: "project-branch" }, at);
  assert.equal(inProject.workspaceMode, "project-branch");
  assert.notEqual(
    authoritativeFingerprint(inProject),
    authoritativeFingerprint(isolated),
    "moving a run into the operator's project must be detectable drift"
  );

  // Unknown values fall back to the safe mode rather than being accepted.
  assert.equal(createRunSpec({ goal: "g", workspaceMode: "anywhere" as never }, at).workspaceMode, "worktree");
});

// --- naming and reporting ---------------------------------------------------

test("branch names are deterministic and shell-safe", () => {
  assert.equal(branchNameForRun("coding-run-abc123"), "dexnest/coding-run-abc123");
  assert.equal(branchNameForRun("run with spaces"), "dexnest/run-with-spaces");
  assert.equal(branchNameForRun("run;rm -rf ~"), "dexnest/run-rm--rf--");
});

test("the summary tells the operator where the work is and how to undo it", () => {
  const text = renderProjectBranchSummary({
    runId: RUN_ID, repoRoot: "D:/MyApp", branch: `dexnest/${RUN_ID}`,
    baseBranch: "main", baseSha: "abcdef1234567890", createdAt: "2026-09-05T00:00:00.000Z"
  });
  assert.match(text, /git checkout main/);
  assert.match(text, new RegExp(`git branch -D dexnest/${RUN_ID}`));
  assert.match(text, /abcdef123456/);
  assert.equal(renderProjectBranchSummary(null), "This run does not work in the project directly.");
});

test("project-branch runs require migration 16", async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-branch-nomig-"));
  mkdirSync(resolve(root, "project"));
  initProject(resolve(root, "project"));
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  t.after(() => { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });

  const platform = createPlatformPorts({ PATH: process.env.PATH ?? "" });
  const ports: RuntimePorts = {
    db: database.db, platform, clock: createTestClock(), ids: createTestIds(1), logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, ports.clock.now(), []);
  const manager = new ProjectBranchManager({
    ports,
    effects: new EffectsGateway({ ports, store: new AutopilotStore(ports), dispatcher: new Dispatcher({ platform }) })
  });
  assert.equal(manager.record(RUN_ID), null);
  const policy = defaultCapabilityPolicy();
  policy.workspaceRoot = resolve(root, "project");
  await assert.rejects(
    () => manager.ensureBranch({ runId: RUN_ID, repoRoot: resolve(root, "project"), policy }),
    /migration 16/
  );
});
