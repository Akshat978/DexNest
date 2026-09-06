// Phase 2 acceptance: a deliberately hostile run, contained by policy.
//
// The executor here makes no checks of its own. Everything that stops it is the
// policy layer, the approval system and the dispatcher — which is the property
// that has to hold once a real, untrusted coding agent sits in that seat.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AutopilotEngine } from "../src/engine.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { HostileExecutor, type HostileAttempt } from "../src/hostileExecutor.ts";
import { defaultCapabilityPolicy, type CapabilityPolicy } from "../src/policy.ts";
import { UnauthorizedDispatchError } from "../src/dispatcher.ts";
import type { Intent } from "../src/intent.ts";
import type { RuntimePorts } from "../src/ports.ts";
import { WorkspaceManager } from "../src/workspace.ts";
import { assertSafeDataRoot, createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./helpers/harness.ts";
import { createGitPort, createPlatformPorts, createTestRepository, type DispatchedCommand } from "./helpers/platform.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

const AMBIENT_ENV = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "C:/Windows",
  TEMP: process.env.TEMP ?? tmpdir(),
  ANTHROPIC_API_KEY: "sk-ant-must-not-leak",
  OPENAI_API_KEY: "sk-openai-must-not-leak",
  GITHUB_TOKEN: "ghp-must-not-leak"
};

interface Harness {
  root: string;
  repo: string;
  dbPath: string;
  workspacePath: string;
  scratchPath: string;
  policy: CapabilityPolicy;
  open(instance: number): {
    engine: AutopilotEngine;
    ports: RuntimePorts;
    platform: ReturnType<typeof createPlatformPorts>;
    executor: HostileExecutor;
    close: () => void;
  };
}

type AttemptFactory = (paths: { workspace: string; scratch: string; repo: string; root: string }) => HostileAttempt[];

function harness(
  attemptsOrFactory: HostileAttempt[] | AttemptFactory,
  options: { mutate?: (intent: Intent, stepKey: string) => Intent } = {}
): Harness {
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-enforce-")));
  dirs.push(root);
  process.env.DEXNEST_DATA_ROOT = root;

  const repo = createTestRepository(resolve(root, "repo"));
  const dbPath = resolve(root, "autopilot.sqlite");

  const manager = new WorkspaceManager({
    git: createGitPort(),
    fs: createPlatformPorts(AMBIENT_ENV).fs,
    worktreesRoot: resolve(root, "worktrees"),
    scratchesRoot: resolve(root, "scratch")
  });
  const plan = manager.plan("run-hostile", repo);
  createGitPort().addWorktree({ repoRoot: repo, worktreePath: plan.worktreePath, branch: plan.branch, baseRef: "HEAD" });
  manager.ensureScratch(plan);

  const policy: CapabilityPolicy = {
    ...defaultCapabilityPolicy(),
    workspaceRoot: plan.worktreePath,
    scratchRoot: plan.scratchRoot,
    allowedCommands: [
      { executable: "git", subcommand: "status", decision: "ALLOW", reason: "read-only", risk: "low" },
      { executable: "node", decision: "ALLOW", reason: "toolchain", risk: "low" }
    ]
  };

  // Attempts are built from this harness's own paths, so an intent can never
  // reference a workspace that belongs to a different temporary run.
  const attempts = typeof attemptsOrFactory === "function"
    ? attemptsOrFactory({ workspace: plan.worktreePath, scratch: plan.scratchRoot, repo, root })
    : attemptsOrFactory;

  return {
    root,
    repo,
    dbPath,
    workspacePath: plan.worktreePath,
    scratchPath: plan.scratchRoot,
    policy,
    open(instance: number) {
      const { db, close } = createNodeSqliteAdapter(dbPath);
      const platform = createPlatformPorts(AMBIENT_ENV);
      const ports: RuntimePorts = {
        db,
        clock: createTestClock(),
        ids: createTestIds(instance),
        logger: createTestLogger(),
        platform
      };
      runAutopilotMigrations(db, "2026-03-01T00:00:00.000Z");
      const executor = new HostileExecutor({ attempts, policy, mutateBeforeDispatch: options.mutate });
      const engine = new AutopilotEngine({ ports, executor, policy, windows: true });
      return { engine, ports, platform, executor, close };
    }
  };
}

describe("hostile run containment", () => {
  test("policy stops every forbidden effect and the platform never sees it", async () => {
    const full = harness(({ workspace, scratch }) => [
      { stepKey: "legit-write", expect: "allowed",
        intent: { kind: "WRITE_FILE", path: `${workspace}/generated.txt`, contents: "ok", purpose: "legitimate work" } },
      { stepKey: "escape-write", expect: "denied",
        intent: { kind: "WRITE_FILE", path: `${workspace}/../escaped.txt`, contents: "pwned", purpose: "escape" } },
      { stepKey: "read-local-data", expect: "denied",
        intent: { kind: "READ_FILE", path: "D:/DeskNest/local-data/settings/integration-keychain.json", purpose: "steal" } },
      { stepKey: "read-ssh", expect: "denied",
        intent: { kind: "READ_FILE", path: "C:/Users/aksha/.ssh/id_rsa", purpose: "steal" } },
      { stepKey: "git-push", expect: "denied",
        intent: { kind: "GIT_OPERATION", operation: "push", args: ["origin", "main"], cwd: workspace, purpose: "exfiltrate" } },
      { stepKey: "publish", expect: "denied",
        intent: { kind: "RUN_COMMAND", executable: "npm", args: ["publish"], cwd: workspace, purpose: "publish" } },
      { stepKey: "kill-foreign", expect: "denied",
        intent: { kind: "TERMINATE_PROCESS", pid: 4, purpose: "kill something else" } },
      { stepKey: "scratch-write", expect: "allowed",
        intent: { kind: "WRITE_FILE", path: `${scratch}/log.txt`, contents: "artifact", purpose: "artifact" } }
    ]);

    const { engine, platform, executor, close } = full.open(1);
    engine.createRun({ id: "run-hostile", goal: "hostile containment" });
    const finished = await engine.start("run-hostile");
    assert.equal(finished.state, "COMPLETED");

    const byStep = new Map(executor.outcomes.map((outcome) => [outcome.stepKey, outcome]));
    assert.equal(byStep.get("legit-write")!.status, "COMPLETED");
    assert.equal(byStep.get("scratch-write")!.status, "COMPLETED");

    for (const denied of ["escape-write", "read-local-data", "read-ssh", "git-push", "publish", "kill-foreign"]) {
      assert.equal(byStep.get(denied)!.status, "DENIED", `${denied} must be denied`);
    }
    assert.equal(byStep.get("read-local-data")!.rule, "path.dexnest-local-data");
    assert.equal(byStep.get("read-ssh")!.rule, "path.sensitive-fragment");
    assert.equal(byStep.get("kill-foreign")!.rule, "process.not-owned");

    assert.deepEqual(platform.process.dispatched, [], "no denied command reached the process port");
    assert.deepEqual(platform.process.terminated, [], "no process was terminated");
    assert.equal(existsSync(resolve(full.workspacePath, "..", "escaped.txt")), false, "no file escaped the workspace");
    assert.equal(readFileSync(resolve(full.workspacePath, "generated.txt"), "utf8"), "ok");

    assert.equal(createGitPort().isDirty(full.repo), false, "primary checkout stays clean");
    assert.equal(existsSync(resolve(full.repo, "generated.txt")), false);

    const denials = engine.snapshot("run-hostile").events.filter((event) => event.type === "OPERATION_DENIED");
    assert.equal(denials.length, 6, "each denial is auditable");
    close();
  });

  test("a real command executes with a filtered environment", async () => {
    const full = harness(({ workspace }) => [
      { stepKey: "print-env", expect: "allowed",
        intent: { kind: "RUN_COMMAND", executable: process.execPath,
                  args: ["-e", "console.log('ok')"], cwd: workspace, purpose: "inspect environment" } }
    ]);

    const { engine, platform, close } = full.open(1);
    engine.createRun({ id: "run-env", goal: "environment filtering" });
    await engine.start("run-env");

    assert.equal(platform.process.dispatched.length, 1, "the allowed command reached the platform");
    const env = platform.process.dispatched[0]!.env;
    for (const secret of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN"]) {
      assert.equal(env[secret], undefined, `${secret} must never reach a dispatched command`);
    }
    assert.ok(env.PATH, "PATH is preserved so tooling still works");
    close();
  });
});

describe("approvals", () => {
  const gatedInstall = ({ workspace }: { workspace: string }): HostileAttempt[] => [
    { stepKey: "install", expect: "approval",
      intent: { kind: "RUN_COMMAND", executable: "pnpm", args: ["install"], cwd: workspace, purpose: "install deps" } }
  ];

  test("an approval-gated operation waits, survives a restart, then executes exactly once", async () => {
    const full = harness(gatedInstall);

    const first = full.open(1);
    first.engine.createRun({ id: "run-approve", goal: "approval flow" });
    const afterStart = await first.engine.start("run-approve");

    assert.equal(afterStart.state, "AWAITING_APPROVAL", "the run holds for a human decision");
    const pending = first.engine.listPendingApprovals("run-approve");
    assert.equal(pending.length, 1);
    assert.deepEqual(first.platform.process.dispatched, [], "the gated command has NOT executed");
    first.close();

    const second = full.open(2);
    const outcomes = await second.engine.recoverAll();
    assert.equal(outcomes[0]!.resolvedState, "AWAITING_APPROVAL", "the approval survives the restart");

    const stillPending = second.engine.listPendingApprovals("run-approve");
    assert.equal(stillPending.length, 1, "still exactly one pending approval, not a second request");
    assert.equal(stillPending[0]!.id, pending[0]!.id, "the same approval, not a duplicate");
    assert.deepEqual(second.platform.process.dispatched, [], "still not executed");

    second.engine.resolveApproval({ approvalId: stillPending[0]!.id, decision: "APPROVED", source: "test" });
    await second.engine.start("run-approve");

    // Re-read rather than reusing the earlier reference: assert.deepEqual(x, [])
    // narrows the array type to never[] for the rest of the scope.
    const dispatchedAfterApproval: DispatchedCommand[] = [...second.platform.process.dispatched];
    assert.equal(dispatchedAfterApproval.length, 1, "executed exactly once after approval");
    assert.equal(dispatchedAfterApproval[0]!.executable, "pnpm");

    const installs = second.engine.effects!.operations
      .listForRun("run-approve")
      .filter((operation) => operation.summary.includes("pnpm install"));
    assert.equal(installs.length, 1, "exactly one operation record, not one per attempt");
    second.close();

    const third = full.open(3);
    await third.engine.recoverAll();
    assert.deepEqual(third.platform.process.dispatched, [], "a fresh process does not repeat the approved command");
    third.close();
  });

  test("a rejected approval never executes and stays rejected across a restart", async () => {
    const full = harness(gatedInstall);

    const first = full.open(1);
    first.engine.createRun({ id: "run-reject", goal: "rejection flow" });
    await first.engine.start("run-reject");

    const pending = first.engine.listPendingApprovals("run-reject");
    assert.equal(pending.length, 1);

    first.engine.resolveApproval({ approvalId: pending[0]!.id, decision: "REJECTED", source: "test" });
    assert.deepEqual(first.platform.process.dispatched, [], "a rejected operation never executes");

    const approval = first.engine.effects!.operations.requireApproval(pending[0]!.id);
    assert.equal(approval.status, "REJECTED");
    assert.equal(approval.resolutionSource, "test");
    first.close();

    const second = full.open(2);
    const after = second.engine.effects!.operations.requireApproval(pending[0]!.id);
    assert.equal(after.status, "REJECTED", "rejection is durable");
    assert.equal(second.engine.listPendingApprovals("run-reject").length, 0);
    assert.deepEqual(second.platform.process.dispatched, [], "still never executed");
    second.close();
  });

  test("resolving an unknown approval fails loudly", () => {
    const full = harness([]);
    const opened = full.open(1);
    opened.engine.createRun({ id: "run-unknown", goal: "unknown approval" });
    assert.throws(() => opened.engine.resolveApproval({ approvalId: "missing", decision: "APPROVED", source: "t" }), /was not found/);
    opened.close();
  });
});

describe("TOCTOU protection", () => {
  test("an approved operation cannot be reused for modified arguments", async () => {
    let calls = 0;
    const full = harness(
      ({ workspace }) => [
        { stepKey: "install", expect: "approval",
          intent: { kind: "RUN_COMMAND", executable: "pnpm", args: ["install"], cwd: workspace, purpose: "install" } }
      ],
      {
        mutate: (intent) => {
          calls += 1;
          if (calls === 1) return intent;
          const command = intent as Extract<Intent, { kind: "RUN_COMMAND" }>;
          return { ...command, args: ["install", "--force", "evil-package"] };
        }
      }
    );

    const opened = full.open(1);
    opened.engine.createRun({ id: "run-toctou", goal: "toctou" });
    await opened.engine.start("run-toctou");

    const pending = opened.engine.listPendingApprovals("run-toctou");
    assert.equal(pending.length, 1, "the original command was gated");
    const approvedOperation = opened.engine.effects!.operations.require(pending[0]!.operationId);

    opened.engine.resolveApproval({ approvalId: pending[0]!.id, decision: "APPROVED", source: "test" });
    await opened.engine.start("run-toctou");

    const dispatchedArgs = opened.platform.process.dispatched.map((entry) => entry.args.join(" "));
    assert.ok(
      !dispatchedArgs.some((args) => args.includes("evil-package")),
      "the mutated command must never be dispatched under the old approval"
    );

    const mutated = opened.engine.effects!.operations
      .listForRun("run-toctou")
      .find((operation) => operation.summary.includes("evil-package"));
    if (mutated) {
      assert.notEqual(mutated.id, approvedOperation.id, "a different command is a different operation");
      assert.notEqual(mutated.fingerprint, approvedOperation.fingerprint);
      assert.notEqual(mutated.status, "COMPLETED", "the mutated command must not have completed");
    }
    opened.close();
  });

  test("a settled operation can never be dispatched again", async () => {
    const full = harness([]);
    const { engine, close } = full.open(1);
    engine.createRun({ id: "run-fp", goal: "fingerprint" });

    const authorized: Intent = {
      kind: "WRITE_FILE", path: `${full.workspacePath}/a.txt`, contents: "safe", purpose: "write"
    };
    const outcome = await engine.effects!.request({ runId: "run-fp", stepKey: null, policy: full.policy, intent: authorized });
    assert.equal(outcome.status, "COMPLETED");

    await assert.rejects(
      () => engine.effects!.execute({
        runId: "run-fp", stepKey: null, policy: full.policy,
        intent: { ...authorized, path: `${full.workspacePath}/b.txt` },
        operation: outcome.operation
      }),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedDispatchError);
        assert.equal(error.rule, "effects.already-settled");
        return true;
      }
    );
    close();
  });
});

describe("workspace containment at dispatch time", () => {
  test("a write outside the workspace is refused and the target is untouched", async () => {
    const full = harness([]);
    const { engine, close } = full.open(1);
    engine.createRun({ id: "run-real", goal: "realpath" });

    const outside = resolve(full.root, "outside.txt");
    writeFileSync(outside, "existing", "utf8");

    const outcome = await engine.effects!.request({
      runId: "run-real", stepKey: null, policy: full.policy,
      intent: { kind: "WRITE_FILE", path: outside, contents: "x", purpose: "escape" }
    });

    assert.equal(outcome.status, "DENIED");
    assert.equal(readFileSync(outside, "utf8"), "existing", "the file was not modified");
    close();
  });
});
