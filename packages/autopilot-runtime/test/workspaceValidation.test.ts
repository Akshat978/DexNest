// Re-validating the workspace before every worker action.
//
// This ran on every turn and had no tests, which is how it came to refuse an
// entire mode. "Valid" means opposite things in the two modes — a worktree run
// must NOT work in the project, a project-branch run must — and the validator
// only knew the first. Every project-branch run died before reaching a worker,
// with a message that reads like a safety rule working correctly.
//
// Real git, real directories.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { validateRunWorkspace as validateClaudeWorkspace } from "../src/workspace.ts";
import { createPlatformPorts } from "./helpers/platform.ts";
import type { RunSpecInput } from "../src/runSpec.ts";

const platform = createPlatformPorts({ PATH: process.env.PATH ?? "" });

function project(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-wsvalid-"));
  const repo = resolve(root, "project");
  mkdirSync(repo);
  execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8", windowsHide: true });
  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
  git(["config", "user.email", "t@example.invalid"]);
  git(["config", "user.name", "T"]);
  writeFileSync(resolve(repo, "README.md"), "x\n", "utf8");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { root, repo, git };
}

const spec = (input: { repo: string; cwd: string; mode?: "worktree" | "project-branch" }): RunSpecInput => ({
  goal: "g",
  projectPath: platform.fs.realPath(input.repo),
  ...(input.mode ? { workspaceMode: input.mode } : {}),
  capabilities: { workspaceRoot: platform.fs.realPath(input.cwd) } as never
});

// --- project-branch ---------------------------------------------------------

test("a project-branch run works in the project, and is allowed to", (t) => {
  const { repo } = project(t);
  // The exact case that used to throw "The primary checkout may never be used
  // as an autonomous writable workspace" on every single turn.
  assert.doesNotThrow(() => validateClaudeWorkspace(platform, spec({ repo, cwd: repo, mode: "project-branch" })));
});

test("a project-branch run may not work anywhere else", (t) => {
  const { root, repo } = project(t);
  const elsewhere = resolve(root, "elsewhere");
  mkdirSync(elsewhere);
  assert.throws(
    () => validateClaudeWorkspace(platform, spec({ repo, cwd: elsewhere, mode: "project-branch" })),
    /must work in the project itself/
  );
});

test("a project-branch run must name the repository root, not a subdirectory", (t) => {
  const { repo } = project(t);
  const nested = resolve(repo, "src");
  mkdirSync(nested);
  assert.throws(
    () => validateClaudeWorkspace(platform, spec({ repo: nested, cwd: nested, mode: "project-branch" })),
    /not a subdirectory/
  );
});

// --- worktree, unchanged ----------------------------------------------------

test("a worktree run still refuses to use the project as its workspace", (t) => {
  const { repo } = project(t);
  // The guard the project-branch mode had to step around must still hold for
  // the mode it was written for.
  assert.throws(
    () => validateClaudeWorkspace(platform, spec({ repo, cwd: repo })),
    /primary checkout may never be used/
  );
});

test("a worktree run accepts a registered worktree", (t) => {
  const { root, repo, git } = project(t);
  const worktree = resolve(root, "wt");
  git(["worktree", "add", "-b", "autopilot/test", worktree]);
  assert.doesNotThrow(() => validateClaudeWorkspace(platform, spec({ repo, cwd: worktree })));
});

test("a worktree run refuses a directory that is not a registered worktree", (t) => {
  const { root, repo } = project(t);
  const stray = resolve(root, "stray");
  mkdirSync(stray);
  assert.throws(() => validateClaudeWorkspace(platform, spec({ repo, cwd: stray })));
});

// --- both -------------------------------------------------------------------

test("a denied root is refused in either mode", (t) => {
  const { repo } = project(t);
  for (const mode of ["worktree", "project-branch"] as const) {
    assert.throws(
      () => validateClaudeWorkspace(platform, spec({ repo: "C:/Windows", cwd: "C:/Windows", mode })),
      /denied by policy|must exist at their canonical paths|not a subdirectory/
    );
  }
  assert.throws(() => validateClaudeWorkspace(platform, { ...spec({ repo, cwd: repo, mode: "project-branch" }), projectPath: "relative" }), /absolute/);
});
