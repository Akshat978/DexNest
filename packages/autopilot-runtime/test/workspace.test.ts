import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { WorkspaceManager, WorkspaceError } from "../src/workspace.ts";
import { createGitPort, createFileSystemPort, createTestRepository } from "./helpers/platform.ts";
import { assertSafeDataRoot } from "./helpers/harness.ts";

const dirs: string[] = [];

function tempDir(): string {
  const dir = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-ws-")));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 3 });
});

function manager(root: string) {
  return new WorkspaceManager({
    git: createGitPort(),
    fs: createFileSystemPort(),
    worktreesRoot: resolve(root, "worktrees"),
    scratchesRoot: resolve(root, "scratch")
  });
}

describe("worktree lifecycle", () => {
  test("creates a run worktree and leaves the primary checkout untouched", () => {
    const root = tempDir();
    const repo = createTestRepository(resolve(root, "repo"));
    const workspaces = manager(root);

    const before = workspaces.primaryCheckoutState(repo);
    assert.equal(before.dirty, false);

    const plan = workspaces.plan("run-1", repo);
    createGitPort().addWorktree({
      repoRoot: repo,
      worktreePath: plan.worktreePath,
      branch: plan.branch,
      baseRef: "HEAD"
    });
    workspaces.ensureScratch(plan);

    // Write in the worktree only.
    writeFileSync(resolve(plan.worktreePath, "generated.txt"), "autopilot wrote this", "utf8");

    const after = workspaces.primaryCheckoutState(repo);
    assert.equal(after.dirty, false, "the primary checkout must stay clean");
    assert.equal(after.head, before.head, "the primary checkout HEAD must not move");
    assert.equal(existsSync(resolve(repo, "generated.txt")), false, "no file may appear in the primary checkout");
    assert.equal(readFileSync(resolve(plan.worktreePath, "generated.txt"), "utf8"), "autopilot wrote this");

    const state = workspaces.validate(plan);
    assert.equal(state.exists, true);
    assert.equal(state.registered, true);
    assert.equal(state.dirty, true, "the worktree itself has the change");
  });

  test("worktree identity is deterministic and rediscoverable after a restart", () => {
    const root = tempDir();
    const repo = createTestRepository(resolve(root, "repo"));

    const first = manager(root).plan("run-42", repo);
    createGitPort().addWorktree({ repoRoot: repo, worktreePath: first.worktreePath, branch: first.branch, baseRef: "HEAD" });

    // A completely fresh manager, as after an app restart.
    const rediscovered = manager(root).plan("run-42", repo);
    assert.equal(rediscovered.worktreePath, first.worktreePath, "naming must be deterministic");

    const state = manager(root).validate(rediscovered);
    assert.equal(state.exists, true);
    assert.equal(state.registered, true, "git still knows the worktree after a restart");
  });

  test("the primary checkout can never be selected as the writable workspace", () => {
    const root = tempDir();
    const repo = createTestRepository(resolve(root, "repo"));
    const workspaces = manager(root);

    assert.throws(() => workspaces.assertUsable(repo, repo), (error: unknown) => {
      assert.ok(error instanceof WorkspaceError);
      assert.equal(error.rule, "workspace.equals-primary-checkout");
      return true;
    });

    assert.throws(() => workspaces.assertUsable(repo, resolve(repo, "sub", "wt")), (error: unknown) => {
      assert.ok(error instanceof WorkspaceError);
      assert.equal(error.rule, "workspace.inside-primary-checkout");
      return true;
    });
  });

  test("a worktree may not resolve inside DexNest local-data", () => {
    const root = tempDir();
    const repo = createTestRepository(resolve(root, "repo"));
    const workspaces = new WorkspaceManager({
      git: createGitPort(),
      fs: createFileSystemPort(),
      worktreesRoot: "D:/DeskNest/local-data/worktrees",
      scratchesRoot: resolve(root, "scratch")
    });

    assert.throws(() => workspaces.plan("run-x", repo), (error: unknown) => {
      assert.ok(error instanceof WorkspaceError);
      assert.equal(error.rule, "workspace.inside-denied-root");
      return true;
    });
  });

  test("a non-repository source is rejected", () => {
    const root = tempDir();
    const workspaces = manager(root);
    assert.throws(() => workspaces.resolveRepositoryRoot(root), /Not a git repository/);
    assert.throws(() => workspaces.resolveRepositoryRoot(resolve(root, "missing")), /does not exist/);
  });

  test("stop and failure preserve the worktree; removal is explicit only", () => {
    const root = tempDir();
    const repo = createTestRepository(resolve(root, "repo"));
    const workspaces = manager(root);
    const plan = workspaces.plan("run-keep", repo);

    createGitPort().addWorktree({ repoRoot: repo, worktreePath: plan.worktreePath, branch: plan.branch, baseRef: "HEAD" });
    writeFileSync(resolve(plan.worktreePath, "wip.txt"), "unfinished work", "utf8");

    // Nothing in the lifecycle removes a worktree implicitly; validate() and
    // primaryCheckoutState() are read-only.
    workspaces.validate(plan);
    workspaces.primaryCheckoutState(repo);

    assert.equal(existsSync(plan.worktreePath), true, "the worktree survives for inspection");
    assert.equal(readFileSync(resolve(plan.worktreePath, "wip.txt"), "utf8"), "unfinished work");
  });
});
