// The iteration: one durable cycle of assignment, work, verification, checkpoint.
//
// Two things are being asserted here. First, that the row genuinely joins what
// was previously three tables correlated by hand, and survives a restart in the
// middle. Second — and this is the design decision, not an oversight — that it
// stores pointers rather than content: DexNest orchestrates, and the place to
// read what was actually said is the agent's own session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { IterationStore, renderIterationStatus, renderWhereToWatch } from "../src/iterations.ts";
import { LoopStore } from "../src/loopStore.ts";
import { CheckpointStore } from "../src/checkpoints.ts";

const PASSES: LoopPlanStep = { emitFiles: [{ path: "one.txt", contents: "one\n" }], verify: { typecheck: 0 } };
const FAILS: LoopPlanStep = { emitFiles: [{ path: "two.txt", contents: "two\n" }], verify: { typecheck: 1 } };
const ASKS: LoopPlanStep = { requestFiles: ["README.md"], verify: { typecheck: 1 } };

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[], turns = 3) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-iteration-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  let handle = openLoop(root, { maxConsecutiveFailures: 20 });
  handle.createRun();
  handle.loop.authorize({ runId: "loop-run", maxTurns: turns, grantedBy: "human" });
  t.after(() => {
    try { handle.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return {
    get h() { return handle; },
    restart() { handle.close(); handle = openLoop(root, { instance: 2, maxConsecutiveFailures: 20 }); return handle; }
  };
}

test("a verified turn produces one iteration joined to its verification and checkpoint", async (t) => {
  const f = fixture(t, [PASSES]);
  await f.h.loop.run("loop-run");

  const iterations = new IterationStore(f.h.ports).list("loop-run");
  assert.equal(iterations.length, 1);
  const [iteration] = iterations;
  assert.equal(iteration!.ordinal, 1);
  assert.equal(iteration!.status, "VERIFIED");
  assert.ok(iteration!.settledAt);

  // The join is the point: each pointer must resolve to the real row.
  const turn = new LoopStore(f.h.ports).turns("loop-run")[0]!;
  assert.equal(iteration!.turnId, turn.id);
  assert.equal(iteration!.verificationId, turn.verificationId);
  const checkpoint = new CheckpointStore(f.h.ports).list("loop-run")[0]!;
  assert.equal(iteration!.checkpointId, checkpoint.id);
});

test("a repair belongs to the assignment it repairs, not to a new iteration", async (t) => {
  // An iteration is one PIECE OF WORK, not one turn. Charging a fresh
  // iteration for every failed attempt would make the operator's budget mean
  // something they did not choose.
  const f = fixture(t, [FAILS, PASSES]);
  await f.h.loop.run("loop-run");

  assert.equal(new LoopStore(f.h.ports).turns("loop-run").length, 2, "two turns: the attempt and its repair");
  const iterations = new IterationStore(f.h.ports).list("loop-run");
  assert.equal(iterations.length, 1, "but one iteration");
  assert.equal(iterations[0]!.status, "VERIFIED");
  assert.ok(iterations[0]!.checkpointId, "the checkpoint is the one from the turn that finally passed");
});

test("a context round-trip does not cost an iteration either", async (t) => {
  const f = fixture(t, [ASKS, PASSES]);
  await f.h.loop.run("loop-run");

  assert.equal(new LoopStore(f.h.ports).turns("loop-run").length, 2);
  const iterations = new IterationStore(f.h.ports).list("loop-run");
  assert.equal(iterations.length, 1, "asking for a file is part of doing the work, not a second piece of work");
  assert.equal(iterations[0]!.status, "VERIFIED");
});

test("only one iteration is open at a time, and it is idempotent per turn", async (t) => {
  const f = fixture(t, [PASSES]);
  const iterations = new IterationStore(f.h.ports);

  const first = iterations.open({ runId: "loop-run", turnId: "turn-a" })!;
  assert.equal(first.status, "ACTIVE");
  // Reopening the same turn rejoins rather than creating a second row: this is
  // what makes resuming mid-iteration safe.
  assert.deepEqual(iterations.open({ runId: "loop-run", turnId: "turn-a" }), first);

  iterations.settle({ runId: "loop-run", turnId: "turn-a", status: "VERIFIED" });
  assert.equal(iterations.active("loop-run"), null);
  assert.equal(iterations.open({ runId: "loop-run", turnId: "turn-b" })?.ordinal, 2);
});

test("an iteration left open by a stopped run is closed when the next turn begins", async (t) => {
  // A run can stop between a turn starting and its outcome — paused, held for a
  // consultation, a worker failure, a crash. Work then resumes as a NEW turn,
  // so the old iteration is over whatever happened to it. Refusing here would
  // wedge the run permanently, which is exactly what it did before this case
  // was handled: two real loop tests deadlocked on the second turn.
  const f = fixture(t, [PASSES]);
  const iterations = new IterationStore(f.h.ports);
  iterations.open({ runId: "loop-run", turnId: "turn-a" });

  const next = iterations.open({ runId: "loop-run", turnId: "turn-b" })!;
  assert.equal(next.ordinal, 2);
  assert.equal(next.status, "ACTIVE");

  const abandoned = iterations.list("loop-run")[0]!;
  assert.equal(abandoned.status, "ABANDONED");
  assert.match(abandoned.summary ?? "", /before the next turn began/);
  // The attempt is kept, not deleted, and still points at the turn whose own
  // row records what actually happened to it.
  assert.equal(abandoned.turnId, "turn-a");
  assert.ok(abandoned.settledAt);
});

test("a settled iteration is history and is never rewritten", async (t) => {
  const f = fixture(t, [PASSES]);
  const iterations = new IterationStore(f.h.ports);
  iterations.open({ runId: "loop-run", turnId: "turn-a" });
  iterations.settle({ runId: "loop-run", turnId: "turn-a", status: "VERIFIED", summary: "first outcome" });

  const after = iterations.settle({ runId: "loop-run", turnId: "turn-a", status: "FAILED", summary: "rewritten" });
  assert.equal(after!.status, "VERIFIED");
  assert.equal(after!.summary, "first outcome");

  const settled = f.h.store.listEvents("loop-run").filter((event) => event.type === "ITERATION_SETTLED");
  assert.equal(settled.length, 1, "re-settling must not journal a second outcome");
});

test("a restart rejoins the open iteration rather than starting a second", async (t) => {
  const f = fixture(t, [PASSES]);
  new IterationStore(f.h.ports).open({ runId: "loop-run", turnId: "turn-a" });

  const h = f.restart();
  const iterations = new IterationStore(h.ports);
  assert.equal(iterations.active("loop-run")?.turnId, "turn-a");
  assert.deepEqual(iterations.open({ runId: "loop-run", turnId: "turn-a" })?.ordinal, 1);
  assert.equal(iterations.count("loop-run"), 1);
});

test("iterations hold pointers, never the conversation", async (t) => {
  const f = fixture(t, [PASSES]);
  await f.h.loop.run("loop-run");

  const [iteration] = new IterationStore(f.h.ports).list("loop-run");
  const prompt = new LoopStore(f.h.ports).turns("loop-run")[0]!.prompt;
  const stored = JSON.stringify(iteration);
  // The prompt is long and already durable on the turn. Copying it here would
  // make DexNest a second, worse transcript store.
  assert.equal(stored.includes(prompt.slice(0, 80)), false);
  assert.ok((iteration!.summary ?? "").length < 2000);
});

test("the run tells the operator where to read what actually happened", () => {
  const idle = renderWhereToWatch({ provider: "claude", sessionId: "abc-123", cwd: "D:/MyApp", runActive: false });
  assert.match(idle, /claude --resume abc-123/);
  assert.match(idle, /D:\/MyApp/);
  assert.equal(/one writer/.test(idle), false);

  // A conversation has one writer; opening it mid-run is the hazard Phase 3
  // refuses to create, so the pointer says so while the run is working.
  const busy = renderWhereToWatch({ provider: "claude", sessionId: "abc-123", cwd: "D:/MyApp", runActive: true });
  assert.match(busy, /one writer/);
  assert.match(busy, /Wait until it pauses/);

  assert.equal(
    renderWhereToWatch({ provider: "claude", sessionId: null, cwd: null, runActive: false }),
    "This run has no agent session yet."
  );
});

test("the status line stays a status line", () => {
  const at = "2026-09-06T00:00:00.000Z";
  const text = renderIterationStatus([
    { id: "i1", runId: "r", ordinal: 1, planItemId: null, turnId: "t1", verificationId: null, checkpointId: null,
      status: "FAILED", summary: "typecheck failed", startedAt: at, settledAt: at },
    { id: "i2", runId: "r", ordinal: 2, planItemId: null, turnId: "t2", verificationId: null, checkpointId: "c1",
      status: "VERIFIED", summary: "all green", startedAt: at, settledAt: at }
  ]);
  assert.match(text, /\[!\] iteration 1 — typecheck failed/);
  assert.match(text, /\[x\] iteration 2 — all green/);
  assert.equal(text.split("\n").length, 2, "one line per iteration, not a report");
  assert.equal(renderIterationStatus([]), "No iterations yet.");
});

test("iteration tracking tolerates a database without migration 18", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-iteration-nomig-"));
  initWorktree(resolve(root, "worktree"), [PASSES], { typecheck: 1 });
  const h = openLoop(root, {});
  t.after(() => { h.close(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  h.ports.db.exec("DROP INDEX IF EXISTS idx_autopilot_iterations_active; DROP TABLE IF EXISTS autopilot_iterations");

  const iterations = new IterationStore(h.ports);
  assert.deepEqual(iterations.list("loop-run"), []);
  assert.equal(iterations.active("loop-run"), null);
  assert.equal(iterations.open({ runId: "loop-run", turnId: "turn-a" }), null);
  assert.equal(iterations.settle({ runId: "loop-run", turnId: "turn-a", status: "VERIFIED" }), null);
});
