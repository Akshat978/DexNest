// What a run changed, phase by phase.
//
// The assembly is a join across three stores plus git, so the tests that matter
// are the ones where a piece is missing: a phase that never checkpointed, a
// commit that no longer exists, a file counted twice.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRunChanges, totalsOf } from "../src/index.ts";
import type { FileChange, GitPort } from "../src/index.ts";

const iteration = (over: Record<string, unknown> = {}) => ({
  id: "it-1", runId: "run-1", ordinal: 1, planItemId: "plan-1",
  turnId: "turn-1", verificationId: "v-1", checkpointId: "cp-1",
  status: "VERIFIED", summary: null, startedAt: "", settledAt: null, ...over
}) as never;

const checkpoint = (over: Record<string, unknown> = {}) => ({
  id: "cp-1", runId: "run-1", turnId: "turn-1", verificationId: "v-1",
  marker: "", status: "COMMITTED", commitSha: "bbb", headBefore: "aaa",
  message: "", detail: null, createdAt: "", settledAt: null, ...over
}) as never;

const item = (over: Record<string, unknown> = {}) => ({
  id: "plan-1", ordinal: 1, title: "The lexer", status: "DONE", detail: "", ...over
}) as never;

function fakeGit(files: FileChange[], onCall?: (input: unknown) => void): GitPort {
  return {
    diffStat: (input: { dir: string; from: string; to: string }) => { onCall?.(input); return files; }
  } as unknown as GitPort;
}

test("a phase reports the files its checkpoint introduced", () => {
  const asked: unknown[] = [];
  const changes = buildRunChanges({
    git: fakeGit([{ path: "src/lexer.ts", insertions: 120, deletions: 4 }], input => asked.push(input)),
    workspaceRoot: "D:/project",
    iterations: [iteration()],
    checkpoints: [checkpoint()],
    planItems: [item()]
  });

  assert.equal(changes.phases[0]!.title, "The lexer");
  assert.equal(changes.phases[0]!.insertions, 120);
  assert.equal(changes.phases[0]!.deletions, 4);
  // The range is the checkpoint's own before and after, not a guess.
  assert.deepEqual(asked, [{ dir: "D:/project", from: "aaa", to: "bbb" }]);
});

test("a phase that never checkpointed is listed with nothing, not omitted", () => {
  // A failed phase earns no checkpoint. Dropping it would make the operator
  // notice a gap in the numbering to learn that it existed at all.
  let called = false;
  const changes = buildRunChanges({
    git: fakeGit([], () => { called = true; }),
    workspaceRoot: "D:/project",
    iterations: [iteration({ id: "it-2", checkpointId: null, status: "FAILED" })],
    checkpoints: [],
    planItems: [item()]
  });

  assert.equal(changes.phases.length, 1);
  assert.equal(changes.phases[0]!.status, "FAILED");
  assert.equal(changes.phases[0]!.commitSha, null);
  assert.deepEqual(changes.phases[0]!.files, []);
  assert.equal(called, false, "git is not asked about a phase with no commits");
});

test("a checkpoint with no starting point is not diffed against a guess", () => {
  let called = false;
  const changes = buildRunChanges({
    git: fakeGit([{ path: "x", insertions: 1, deletions: 0 }], () => { called = true; }),
    workspaceRoot: "D:/project",
    iterations: [iteration()],
    checkpoints: [checkpoint({ headBefore: null })],
    planItems: [item()]
  });

  assert.equal(called, false);
  assert.deepEqual(changes.phases[0]!.files, []);
});

test("a run with no workspace asks git nothing", () => {
  let called = false;
  buildRunChanges({
    git: fakeGit([], () => { called = true; }),
    workspaceRoot: null,
    iterations: [iteration()],
    checkpoints: [checkpoint()],
    planItems: [item()]
  });
  assert.equal(called, false);
});

test("a file touched by two phases is one file changed", () => {
  // Summing per-phase file counts would say two, and "6 files changed" is a
  // number an operator uses to decide whether to look.
  const changes = buildRunChanges({
    git: fakeGit([{ path: "src/shared.ts", insertions: 10, deletions: 2 }]),
    workspaceRoot: "D:/project",
    iterations: [iteration(), iteration({ id: "it-2", ordinal: 2, planItemId: "plan-2", checkpointId: "cp-2" })],
    checkpoints: [checkpoint(), checkpoint({ id: "cp-2", commitSha: "ccc", headBefore: "bbb" })],
    planItems: [item(), item({ id: "plan-2", ordinal: 2, title: "The parser" })]
  });

  assert.equal(changes.files, 1, "one file, touched twice");
  assert.equal(changes.insertions, 20, "but the lines are the work done in both");
});

test("binary files are counted, not summed", () => {
  // git reports "-" for them, and adding null as though it were zero would
  // silently claim a phase that replaced an image changed nothing.
  const totals = totalsOf([
    { path: "logo.png", insertions: null, deletions: null },
    { path: "src/a.ts", insertions: 5, deletions: 1 }
  ]);
  assert.deepEqual(totals, { insertions: 5, deletions: 1, binaryFiles: 1 });
});

test("an iteration with no plan item still has a name", () => {
  // Runs without a plan produce iterations with no item to borrow a title
  // from, and a row labelled "null" is not a row anyone can read.
  const changes = buildRunChanges({
    git: fakeGit([]),
    workspaceRoot: "D:/project",
    iterations: [iteration({ planItemId: null, summary: "Fixed the importer" })],
    checkpoints: [checkpoint()],
    planItems: []
  });
  assert.equal(changes.phases[0]!.title, "Fixed the importer");
});
