// Path resolution at a drive root.
//
// From the first real dogfood run. The worktree for a project at D:\DeskNest is
// derived as D:\dexnest-worktrees\<runId> — its parent is the drive root. The
// filesystem port resolves a not-yet-existing path by walking up to the nearest
// existing ancestor and re-appending the segments it skipped, and it computed
// those segments with `current.slice(parent.length + 1)`.
//
// dirname("D:\\x") is "D:\\" WITH a trailing separator, so that arithmetic ate
// one character too many: D:\dexnest-worktrees resolved to D:\exnest-worktrees.
// Policy then correctly refused a path outside every write root, and workspace
// preparation failed with an error that looked like a policy problem.
//
// The corruption is silent, so this is asserted against the real port.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, parse, join } from "node:path";

import { createFileSystemPort } from "./helpers/platform.ts";
import { defaultCapabilityPolicy, evaluatePathAccess } from "../src/policy.ts";

const fs = createFileSystemPort();

test("a path whose nearest existing ancestor is a drive root keeps every character", () => {
  const root = parse(process.cwd()).root;
  const target = resolve(root, "dexnest-worktrees", "coding-run-abc123", "src", "index.ts");

  // The whole chain below the drive root is missing, which is the failing case.
  assert.equal(fs.exists(resolve(root, "dexnest-worktrees")), false, "precondition: the parent does not exist");
  assert.equal(fs.realPath(target), target, "realPath must not rewrite a non-existent path");

  // The specific corruption: the first segment losing its leading character.
  assert.equal(fs.realPath(target).includes("exnest-worktrees"), true);
  assert.equal(/[\\/]exnest-worktrees/.test(fs.realPath(target)), false, "the leading 'd' must survive");
});

test("the drive-root worktree a D:\\DeskNest-style project derives is writable under policy", () => {
  const root = parse(process.cwd()).root;
  const worktree = resolve(root, "dexnest-worktrees", "coding-run-abc123");

  const policy = defaultCapabilityPolicy();
  policy.workspaceRoot = worktree;
  policy.readRoots = [resolve(root, "DeskNest")];

  // This is exactly the check that rejected the real run.
  const resolved = fs.realPath(join(worktree, "src", "report.ts"));
  const decision = evaluatePathAccess(policy, { path: resolved, mode: "write" });
  assert.equal(decision.decision, "ALLOW", `expected the worktree to be writable, got ${decision.decision} (${decision.rule}) for ${resolved}`);
});

test("ancestors below the drive root still resolve, and existing ones are still followed", () => {
  const base = mkdtempSync(join(tmpdir(), "dexnest-realpath-"));
  try {
    const existing = join(base, "present");
    mkdirSync(existing, { recursive: true });

    // A deep missing chain under an ordinary directory.
    const missing = join(existing, "a", "b", "c.txt");
    assert.equal(fs.realPath(missing), resolve(realpathSync.native(existing), "a", "b", "c.txt"));

    // An existing directory resolves to its canonical form.
    assert.equal(fs.realPath(existing), realpathSync.native(existing));

    // Every segment survives, including single-character ones.
    const single = join(existing, "d", "e");
    assert.equal(fs.realPath(single), resolve(realpathSync.native(existing), "d", "e"));
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
