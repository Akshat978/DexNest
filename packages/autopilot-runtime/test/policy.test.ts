import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { canonicalize, contains, samePath } from "../src/paths.ts";
import {
  buildEnvironment,
  defaultCapabilityPolicy,
  evaluateCommand,
  evaluateIntent,
  evaluatePathAccess,
  type CapabilityPolicy
} from "../src/policy.ts";
import { fingerprintIntent, executableName, type Intent } from "../src/intent.ts";

function policyFor(workspace: string, scratch: string): CapabilityPolicy {
  return {
    ...defaultCapabilityPolicy(),
    workspaceRoot: workspace,
    scratchRoot: scratch,
    readRoots: ["D:/OtherReadOnly"],
    allowedCommands: [
      { executable: "git", subcommand: "status", decision: "ALLOW", reason: "read-only", risk: "low" },
      { executable: "node", decision: "ALLOW", reason: "toolchain", risk: "low" }
    ]
  };
}

const WORKSPACE = "D:/AutopilotRuns/worktrees/run-1";
const SCRATCH = "D:/AutopilotRuns/scratch/run-1";

describe("path canonicalization", () => {
  test("normalizes slashes, case and traversal", () => {
    assert.equal(canonicalize("D:\\Foo\\Bar").key, "d:/foo/bar");
    assert.equal(canonicalize("D:/Foo/./Bar/").key, "d:/foo/bar");
    assert.equal(canonicalize("D:/Foo/Baz/../Bar").key, "d:/foo/bar");
    assert.equal(canonicalize('"D:/Foo/Bar"').key, "d:/foo/bar");
    assert.equal(canonicalize("D:\\Foo\\Bar").display, "D:\\Foo\\Bar");
  });

  test("traversal cannot escape above the root", () => {
    assert.equal(canonicalize("D:/../../secret").key, "d:/secret");
  });

  test("containment is boundary-aware, not a string prefix", () => {
    // The classic bug: C:\foo must not "contain" C:\foobar.
    assert.equal(contains("C:/foo", "C:/foobar"), false);
    assert.equal(contains("C:/foo", "C:/foo/bar"), true);
    assert.equal(contains("C:/foo", "C:/foo"), true);
    assert.equal(contains("C:/foo", "C:/FOO/BAR"), true);
    assert.equal(samePath("C:/foo", "c:\\foo\\"), true);
  });

  test("relative paths resolve against a base rather than being judged alone", () => {
    assert.equal(canonicalize("../escape", { base: "D:/a/b" }).key, "d:/a/escape");
  });
});

describe("path policy", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  test("A: write inside the worktree is allowed", () => {
    const decision = evaluatePathAccess(policy, { path: `${WORKSPACE}/src/app.ts`, mode: "write" });
    assert.equal(decision.decision, "ALLOW");
  });

  test("B: read inside the worktree is allowed", () => {
    assert.equal(evaluatePathAccess(policy, { path: `${WORKSPACE}/README.md`, mode: "read" }).decision, "ALLOW");
  });

  test("J: the scratch directory is writable", () => {
    assert.equal(evaluatePathAccess(policy, { path: `${SCRATCH}/log.txt`, mode: "write" }).decision, "ALLOW");
  });

  test("C: a sibling of the worktree is denied", () => {
    const decision = evaluatePathAccess(policy, { path: "D:/AutopilotRuns/worktrees/run-2/x.ts", mode: "write" });
    assert.equal(decision.decision, "DENY");
    assert.equal(decision.rule, "path.outside-write-roots");
  });

  test("D: ../ escape from the worktree is denied", () => {
    const decision = evaluatePathAccess(policy, { path: `${WORKSPACE}/../../../Windows/System32/drivers/etc/hosts`, mode: "write" });
    assert.equal(decision.decision, "DENY");
  });

  test("G: a textual prefix that is not a directory boundary is denied", () => {
    const decision = evaluatePathAccess(policy, { path: `${WORKSPACE}-evil/x.ts`, mode: "write" });
    assert.equal(decision.decision, "DENY", "run-1-evil must not be treated as inside run-1");
  });

  test("I: another repository is denied unless granted", () => {
    assert.equal(evaluatePathAccess(policy, { path: "D:/Projects/Other/src/x.ts", mode: "write" }).decision, "DENY");
  });

  test("explicitly granted read roots are readable but not writable", () => {
    assert.equal(evaluatePathAccess(policy, { path: "D:/OtherReadOnly/notes.md", mode: "read" }).decision, "ALLOW");
    assert.equal(evaluatePathAccess(policy, { path: "D:/OtherReadOnly/notes.md", mode: "write" }).decision, "DENY");
  });

  test("relative paths are rejected outright", () => {
    assert.equal(evaluatePathAccess(policy, { path: "src/app.ts", mode: "write" }).decision, "DENY");
  });
});

describe("DexNest local-data hard deny", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  const spellings = [
    "D:/DeskNest/local-data",
    "D:/DeskNest/local-data/settings/integration-keychain.json",
    "d:/desknest/local-data/settings/vault-documents.json",
    "D:\\DeskNest\\local-data\\files\\vault\\passport.pdf",
    "D:\\DeskNest\\LOCAL-DATA\\data\\dexnest.sqlite",
    "D:/DeskNest/local-data/../local-data/settings/finance-transactions.json",
    "D:/DeskNest/repo/../local-data/settings/govee-api-key.local.json"
  ];

  for (const spelling of spellings) {
    test(`denies ${spelling}`, () => {
      for (const mode of ["read", "write"] as const) {
        const decision = evaluatePathAccess(policy, { path: spelling, mode });
        assert.equal(decision.decision, "DENY", `${spelling} (${mode})`);
        assert.equal(decision.rule, "path.dexnest-local-data");
        assert.equal(decision.risk, "critical");
      }
    });
  }

  test("denial holds even if the Run Spec tries to grant it", () => {
    const permissive: CapabilityPolicy = {
      ...policy,
      writeRoots: ["D:/DeskNest/local-data"],
      readRoots: ["D:/DeskNest/local-data"],
      denyRoots: []
    };
    const decision = evaluatePathAccess(permissive, { path: "D:/DeskNest/local-data/settings/vault-documents.json", mode: "read" });
    assert.equal(decision.decision, "DENY", "ALWAYS_DENIED_ROOTS is not overridable by a Run Spec");
  });

  test("credential directories are denied wherever they appear", () => {
    for (const path of ["C:/Users/aksha/.ssh/id_rsa", "C:/Users/aksha/.aws/credentials", `${WORKSPACE}/.ssh/key`]) {
      assert.equal(evaluatePathAccess(policy, { path, mode: "read" }).decision, "DENY", path);
    }
  });
});

describe("command policy", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  test("an allowed command in the workspace is permitted", () => {
    assert.equal(evaluateCommand(policy, { executable: "git", args: ["status"], cwd: WORKSPACE }).decision, "ALLOW");
  });

  test("git push is denied", () => {
    const decision = evaluateCommand(policy, { executable: "git", args: ["push", "origin", "main"], cwd: WORKSPACE });
    assert.equal(decision.decision, "DENY");
    assert.equal(decision.risk, "critical");
  });

  test("publish and deploy tooling is denied", () => {
    for (const [exe, args] of [["npm", ["publish"]], ["pnpm", ["publish"]], ["vercel", ["deploy"]]] as const) {
      assert.equal(evaluateCommand(policy, { executable: exe, args: [...args], cwd: WORKSPACE }).decision, "DENY", exe);
    }
  });

  test("shells are denied because they defeat structured argument policy", () => {
    for (const shell of ["cmd", "powershell.exe", "bash", "pwsh"]) {
      assert.equal(evaluateCommand(policy, { executable: shell, args: ["-c", "echo hi"], cwd: WORKSPACE }).decision, "DENY", shell);
    }
  });

  test("package installation requires approval", () => {
    const decision = evaluateCommand(policy, { executable: "pnpm", args: ["install"], cwd: WORKSPACE });
    assert.equal(decision.decision, "REQUIRE_APPROVAL");
    assert.ok(decision.approvalSummary);
  });

  test("an unknown command is denied by default", () => {
    assert.equal(evaluateCommand(policy, { executable: "mystery-tool", args: [], cwd: WORKSPACE }).decision, "DENY");
  });

  test("a safe command with a working directory outside the workspace is denied", () => {
    const decision = evaluateCommand(policy, { executable: "git", args: ["status"], cwd: "D:/Projects/Other" });
    assert.equal(decision.decision, "DENY");
    assert.equal(decision.rule, "command.cwd-outside-workspace");
  });

  test("an argument naming a critically denied path is rejected", () => {
    const decision = evaluateCommand(policy, {
      executable: "node",
      args: ["D:/DeskNest/local-data/settings/vault-documents.json"],
      cwd: WORKSPACE
    });
    assert.equal(decision.decision, "DENY");
    assert.equal(decision.rule, "command.arg-denied-path");
  });

  test("executable name extraction ignores directory and extension", () => {
    assert.equal(executableName("C:\\Program Files\\Git\\cmd\\git.EXE"), "git");
    assert.equal(executableName("pnpm"), "pnpm");
  });
});

describe("git operation policy", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  test("local operations are allowed, remote and destructive are not", () => {
    assert.equal(evaluateIntent(policy, { kind: "GIT_OPERATION", operation: "commit", args: ["-m", "x"], cwd: WORKSPACE, purpose: "" }).decision, "ALLOW");
    assert.equal(evaluateIntent(policy, { kind: "GIT_OPERATION", operation: "push", args: [], cwd: WORKSPACE, purpose: "" }).decision, "DENY");
    assert.equal(evaluateIntent(policy, { kind: "GIT_OPERATION", operation: "clean", args: ["-fdx"], cwd: WORKSPACE, purpose: "" }).decision, "DENY");
  });
});

describe("worktree and process policy", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  test("a worktree may not be the primary checkout or live inside it", () => {
    const repo = "D:/Projects/App";
    assert.equal(
      evaluateIntent(policy, { kind: "CREATE_WORKTREE", repoRoot: repo, worktreePath: repo, branch: "b", baseRef: "HEAD", purpose: "" }).rule,
      "worktree.equals-primary-checkout"
    );
    assert.equal(
      evaluateIntent(policy, { kind: "CREATE_WORKTREE", repoRoot: repo, worktreePath: `${repo}/.autopilot/wt`, branch: "b", baseRef: "HEAD", purpose: "" }).rule,
      "worktree.inside-primary-checkout"
    );
  });

  test("a worktree may not be created inside DexNest local-data", () => {
    const decision = evaluateIntent(policy, {
      kind: "CREATE_WORKTREE",
      repoRoot: "D:/Projects/App",
      worktreePath: "D:/DeskNest/local-data/wt",
      branch: "b",
      baseRef: "HEAD",
      purpose: ""
    });
    assert.equal(decision.rule, "worktree.inside-denied-root");
  });

  test("terminating a process the run does not own is denied", () => {
    const decision = evaluateIntent(policy, { kind: "TERMINATE_PROCESS", pid: 4, purpose: "" }, { ownedPids: [1234] });
    assert.equal(decision.decision, "DENY");
    assert.equal(decision.rule, "process.not-owned");
  });

  test("terminating an owned process is allowed", () => {
    assert.equal(
      evaluateIntent(policy, { kind: "TERMINATE_PROCESS", pid: 1234, purpose: "" }, { ownedPids: [1234] }).decision,
      "ALLOW"
    );
  });
});

describe("environment filtering", () => {
  const policy = policyFor(WORKSPACE, SCRATCH);

  const ambient = {
    PATH: "C:/bin",
    SystemRoot: "C:/Windows",
    TEMP: "C:/Temp",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    OPENAI_API_KEY: "sk-openai-secret",
    GITHUB_TOKEN: "ghp_secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    MY_APP_PASSWORD: "hunter2",
    DEXNEST_DATA_ROOT: "D:/DeskNest/local-data",
    RANDOM_UNLISTED: "value"
  };

  test("only allowlisted variables survive", () => {
    const env = buildEnvironment(policy, ambient);
    assert.deepEqual(Object.keys(env).sort(), ["PATH", "SystemRoot", "TEMP"]);
  });

  test("known secrets never reach the child", () => {
    const env = buildEnvironment(policy, ambient);
    for (const secret of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "MY_APP_PASSWORD", "DEXNEST_DATA_ROOT"]) {
      assert.equal(env[secret], undefined, `${secret} must be stripped`);
    }
    assert.ok(!Object.values(env).some((value) => value.includes("secret")));
  });

  test("a secret-looking variable is stripped even if explicitly allowlisted", () => {
    const permissive: CapabilityPolicy = {
      ...policy,
      environment: { allow: [...policy.environment.allow, "ANTHROPIC_API_KEY"], stripPatterns: policy.environment.stripPatterns }
    };
    assert.equal(buildEnvironment(permissive, ambient).ANTHROPIC_API_KEY, undefined);
  });
});

describe("intent fingerprints", () => {
  test("respelling a path does not change the fingerprint", () => {
    const a: Intent = { kind: "WRITE_FILE", path: "D:/Foo/Bar.txt", contents: "x", purpose: "" };
    const b: Intent = { kind: "WRITE_FILE", path: "D:\\Foo\\.\\Bar.txt", contents: "y", purpose: "" };
    assert.equal(fingerprintIntent(a), fingerprintIntent(b), "an approval must not be evadable by respelling");
  });

  test("changing arguments changes the fingerprint", () => {
    const a: Intent = { kind: "RUN_COMMAND", executable: "git", args: ["status"], cwd: "D:/w", purpose: "" };
    const b: Intent = { kind: "RUN_COMMAND", executable: "git", args: ["status", "--porcelain"], cwd: "D:/w", purpose: "" };
    assert.notEqual(fingerprintIntent(a), fingerprintIntent(b));
  });

  test("write content length participates, so a different payload is a different operation", () => {
    const a: Intent = { kind: "WRITE_FILE", path: "D:/w/a.txt", contents: "12345", purpose: "" };
    const b: Intent = { kind: "WRITE_FILE", path: "D:/w/a.txt", contents: "1234567890", purpose: "" };
    assert.notEqual(fingerprintIntent(a), fingerprintIntent(b));
  });
});
