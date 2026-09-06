// Memory for a run that outlives its conversation.
//
// Ten iterations in, the session has been compacted at least once, and what
// compaction throws away is the boring middle: which piece of work already
// exists, what was decided in passing, what has already been tried. That is
// precisely the part a worker needs in order not to build it twice.
//
// So the record is kept outside the conversation and restated every turn. Two
// properties matter and both are tested here: it says what happened, and it
// stays small. A digest that grew with the run would eventually cost more
// context than the history it stands in for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { renderRunDigest, MAX_DIGEST_ITERATIONS, MAX_DIGEST_ASSUMPTIONS } from "../src/digest.ts";
import type { IterationRecord, IterationStatus } from "../src/iterations.ts";
import type { AssumptionRecord } from "../src/unattended.ts";
import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";

const iteration = (
  ordinal: number,
  status: IterationStatus,
  summary: string | null,
  checkpointed = status === "VERIFIED"
): IterationRecord => ({
  id: `it-${ordinal}`,
  runId: "run",
  ordinal,
  planItemId: null,
  turnId: `turn-${ordinal}`,
  verificationId: null,
  checkpointId: checkpointed ? `cp-${ordinal}` : null,
  status,
  summary,
  startedAt: "2026-01-01T00:00:00.000Z",
  settledAt: status === "ACTIVE" ? null : "2026-01-01T00:10:00.000Z"
});

const assumption = (index: number, text: string): AssumptionRecord => ({
  id: `as-${index}`,
  runId: "run",
  turnId: `turn-${index}`,
  iterationId: null,
  text,
  createdAt: "2026-01-01T00:00:00.000Z"
});

const done = (count: number) =>
  Array.from({ length: count }, (_, i) => iteration(i + 1, "VERIFIED", `Built part ${i + 1}`));

// --- what it says -----------------------------------------------------------

test("nothing to say before anything has settled", () => {
  assert.equal(renderRunDigest({ iterations: [], assumptions: [] }), "");
  assert.equal(
    renderRunDigest({ iterations: [iteration(1, "ACTIVE", null)], assumptions: [] }),
    "",
    "the piece of work in flight is what the worker is doing now, not history"
  );
});

test("the work in flight is left out of the history", () => {
  const text = renderRunDigest({
    iterations: [...done(2), iteration(3, "ACTIVE", "Building part 3")],
    assumptions: []
  });
  assert.ok(text.includes("2 of 2 piece(s) of work completed"), text);
  assert.equal(text.includes("Building part 3"), false);
});

test("outcomes are named, not just counted", () => {
  const text = renderRunDigest({
    iterations: [
      iteration(1, "VERIFIED", "Added the parser"),
      iteration(2, "FAILED", "Typecheck never passed"),
      iteration(3, "INDETERMINATE", "Verification could not run"),
      iteration(4, "ABANDONED", "Authorization was withdrawn")
    ],
    assumptions: []
  });
  assert.ok(text.includes("1 of 4 piece(s) of work completed, 1 committed"), text);
  assert.ok(text.includes("1. [done] Added the parser"), text);
  assert.ok(text.includes("2. [failed] Typecheck never passed"), text);
  assert.ok(text.includes("3. [inconclusive]"), text);
  assert.ok(text.includes("4. [abandoned]"), text);
});

test("decisions taken without asking are carried forward", () => {
  // These are the ones a transcript loses first and a human most wants back:
  // not what the code does, but why it does it that way.
  const text = renderRunDigest({
    iterations: done(1),
    assumptions: [assumption(1, "Used the existing sqlite helper rather than adding a dependency.")]
  });
  assert.ok(text.includes("Decided along the way, without asking:"), text);
  assert.ok(text.includes("existing sqlite helper"), text);
});

test("the digest is a record, not a description of the code", () => {
  // An agent that trusted a summary over the file in front of it would be
  // worse off than one with no summary at all, so the digest says so itself.
  const text = renderRunDigest({ iterations: done(1), assumptions: [] });
  assert.ok(text.includes("None of this needs redoing"), text);
  assert.ok(text.includes("read the files themselves"), text);
});

// --- and how little of it there is ------------------------------------------

test("iteration 15 is told about 1-14 in under a page", () => {
  const text = renderRunDigest({
    iterations: [...done(14), iteration(15, "ACTIVE", "Working on part 15")],
    assumptions: Array.from({ length: 9 }, (_, i) => assumption(i, `Decision number ${i + 1}.`))
  });

  const lines = text.split("\n");
  assert.ok(lines.length <= 40, `a page at most, got ${lines.length} lines`);
  assert.ok(text.length <= 2500, `got ${text.length} characters`);

  // The count is never lost, only the detail of the oldest work.
  assert.ok(text.includes("14 of 14 piece(s) of work completed, 14 committed"), text);
  assert.ok(text.includes("1-6. 6 completed (older work, rolled up)"), text);
  assert.ok(text.includes("14. [done] Built part 14"), text);
  assert.equal(text.includes("Built part 6"), false, "older detail is rolled up");
  assert.ok(text.includes("(and 3 earlier)"), text);

  const listed = lines.filter(line => /^ {2}\d+\. /.test(line));
  assert.equal(listed.length, MAX_DIGEST_ITERATIONS);
  assert.equal(lines.filter(line => line.startsWith("  - ")).length, MAX_DIGEST_ASSUMPTIONS);
});

test("one runaway summary cannot become the whole prompt", () => {
  const text = renderRunDigest({
    iterations: [iteration(1, "VERIFIED", `${"x".repeat(9000)}\nand a second line`)],
    assumptions: [assumption(1, "y".repeat(9000))]
  });
  assert.ok(text.length < 1200, `got ${text.length} characters`);
  assert.equal(text.includes("and a second line"), false, "one line each");
});

// --- wired into the prompt --------------------------------------------------

test("every prompt after the first carries the record", async (t) => {
  const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
  const step = (index: number, decision: string): LoopPlanStep => ({
    emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
    verify: { typecheck: 0 },
    say: say(decision)
  });

  const root = mkdtempSync(resolve(tmpdir(), "dexnest-digest-"));
  initWorktree(resolve(root, "worktree"), [
    step(0, "decision: CONTINUE\nassignment: Add the second file."),
    step(1, "decision: CONTINUE\nassignment: Add the third file."),
    step(2, "decision: PLAN_COMPLETE\nreason: three is enough")
  ], { typecheck: 1 });
  const h = openLoop(root);
  h.createRun();
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "human" });
  await h.loop.run("loop-run");

  const prompts = new LoopStore(h.ports).turns("loop-run").map(turn => turn.prompt);
  assert.ok(prompts.length >= 3, `expected three turns, got ${prompts.length}`);

  assert.equal(
    prompts[0]!.includes("WHAT HAS ALREADY BEEN DONE"),
    false,
    "the first turn has no history, and inventing one would be noise"
  );
  assert.ok(prompts[1]!.includes("WHAT HAS ALREADY BEEN DONE"), prompts[1]);
  assert.ok(prompts[1]!.includes("1. [done]"), prompts[1]);
  assert.ok(prompts[2]!.includes("2. [done]"), "and it grows with the run");
});
