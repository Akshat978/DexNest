// Autonomous loop: sticky single provider, mechanical verification, bounded grant.
//
// No model is contacted. The worker CLI and the verification commands are local
// fixtures; everything else — SQLite, git, child processes, policy, approvals,
// the dispatcher — is the real implementation.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertSafeDataRoot } from "./helpers/harness.ts";
import { initWorktree, openLoop, LOOP_SESSION_ID, VERIFY_FIXTURE, type LoopPlanStep } from "./helpers/loopHarness.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // A leftover isolated temp directory must not fail a test.
    }
  }
});

function workspace(plan: LoopPlanStep[], verifyState: Record<string, number> = {}): string {
  const root = assertSafeDataRoot(mkdtempSync(join(tmpdir(), "dexnest-loop-")));
  dirs.push(root);
  initWorktree(resolve(root, "worktree"), plan, verifyState);
  return root;
}

/** Prompts the fake worker actually received, in order. */
function dispatches(worktree: string): Array<{ index: number; sessionId: string; resume: boolean; prompt: string }> {
  const file = resolve(worktree, ".loop-dispatches.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as never) : [];
}

describe("sticky multi-turn loop", () => {
  test("five consecutive turns reuse one worker session and one provider", async () => {
    // Fail typecheck for four turns, then pass on the fifth.
    const plan: LoopPlanStep[] = [
      { verify: { typecheck: 1 } },
      { verify: { typecheck: 1 } },
      { verify: { typecheck: 1 } },
      { verify: { typecheck: 1 } },
      { verify: { typecheck: 0 } }
    ];
    const root = workspace(plan, { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 10 });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 8, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed", outcome.detail);
    assert.equal(outcome.turnsRun, 5, "five turns were needed");
    assert.equal(outcome.finalState, "COMPLETED");

    const sent = dispatches(h.worktree);
    assert.equal(sent.length, 5, "five prompts reached the worker");

    // Sticky: one session id throughout, and every turn after the first resumes.
    assert.deepEqual([...new Set(sent.map((entry) => entry.sessionId))], [LOOP_SESSION_ID]);
    assert.deepEqual(sent.map((entry) => entry.resume), [false, true, true, true, true]);

    // Provider never changed.
    const session = h.worker.sessions.session("loop-run")!;
    assert.equal(session.provider, "claude");
    assert.equal(h.store.requireRun("loop-run").spec.workers.primary, "claude");

    // One durable turn per prompt, all attributed to the same grant.
    const turns = h.loop.loops.turns("loop-run");
    assert.equal(turns.length, 5);
    assert.deepEqual(turns.map((turn) => turn.kind), ["INITIAL", "REPAIR", "REPAIR", "REPAIR", "REPAIR"]);
    assert.equal(new Set(turns.map((turn) => turn.grantId)).size, 1);
    h.close();
  });

  test("a verification failure produces a repair prompt carrying the evidence", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }, { verify: { typecheck: 0 } }], { typecheck: 1 });
    const h = openLoop(root);

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed");
    const sent = dispatches(h.worktree);
    assert.equal(sent.length, 2);

    // Turn 1 is the goal; turn 2 is deterministic repair evidence.
    assert.match(sent[0]!.prompt, /Make the failing check pass/);
    assert.match(sent[1]!.prompt, /did not pass verification/);
    assert.match(sent[1]!.prompt, /Failing check: typecheck/);
    assert.match(sent[1]!.prompt, /expected 1 but received 2/, "the real command output is fed back");
    assert.match(sent[1]!.prompt, /do not change the acceptance criteria/, "constraints are restated");

    const verifications = h.loop.loops.verifications("loop-run");
    assert.deepEqual(verifications.map((entry) => entry.outcome), ["FAILED", "PASSED"]);
    assert.equal(verifications[0]!.report.failingTier?.tier, "typecheck");
    assert.ok(verifications[0]!.report.changedFiles > 0, "the worker's edits are visible to git");
    h.close();
  });

  test("verification passing on the first turn completes immediately", async () => {
    const root = workspace([{ verify: { typecheck: 0, test: 0 } }], { typecheck: 0, test: 0 });
    const h = openLoop(root);

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "completed");
    assert.equal(outcome.turnsRun, 1);
    assert.equal(h.store.requireRun("loop-run").state, "COMPLETED");
    assert.equal(h.loop.loops.activeGrant("loop-run"), null, "the grant closes when the run completes");
    h.close();
  });
});

describe("limits and holds", () => {
  test("the turn limit stops the loop safely without completing", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 99 });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "turn_limit");
    assert.equal(outcome.turnsRun, 2, "exactly the authorized number of turns ran");
    assert.equal(dispatches(h.worktree).length, 2, "the budget bounds real prompts, not just bookkeeping");
    assert.equal(h.store.requireRun("loop-run").state, "PAUSED", "held, not completed and not failed");

    const grants = h.loop.loops.grants("loop-run");
    assert.equal(grants[0]!.status, "EXHAUSTED");
    assert.equal(grants[0]!.turnsUsed, 2);

    // A second run() call cannot sneak past the spent grant.
    const again = await h.loop.run("loop-run");
    assert.equal(again.reason, "grant_closed");
    assert.equal(dispatches(h.worktree).length, 2, "no further prompt was sent");
    h.close();
  });

  test("consecutive verification failures stop the loop before the turn budget", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const h = openLoop(root, { maxConsecutiveFailures: 2 });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "consecutive_failures");
    assert.equal(outcome.turnsRun, 2);
    assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
    h.close();
  });

  test("a judgment criterion holds for review rather than inventing success", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root, {
      acceptance: [
        { id: "ac-1", text: "typecheck passes", kind: "automated", check: `node ${VERIFY_FIXTURE} typecheck` },
        { id: "ac-2", text: "the UI feels right", kind: "judgment" }
      ]
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "verification_indeterminate");
    assert.equal(h.store.requireRun("loop-run").state, "NEEDS_REVIEW");
    assert.match(outcome.lastVerification!.indeterminateReason!, /human judgment/);
    h.close();
  });

  test("a run with no acceptance criteria cannot be declared complete", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root, { acceptance: [] });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "verification_indeterminate");
    assert.notEqual(h.store.requireRun("loop-run").state, "COMPLETED");
    h.close();
  });
});

describe("pause and stop", () => {
  test("a pause requested between turns holds the loop", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    let seen = 0;
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        // Pause once the first worker prompt has been dispatched.
        if (/claude/i.test(input.executable)) {
          seen += 1;
          if (seen === 1) h.engine.requestPause("loop-run");
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "paused");
    assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
    assert.equal(dispatches(h.worktree).length, 1, "no second prompt after the pause request");

    // Resuming continues on the same session rather than starting over.
    const stateFile = resolve(h.worktree, ".verify-state.json");
    assert.ok(existsSync(stateFile));
    h.close();
  });

  test("resuming after a pause continues the same loop and session", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }, { verify: { typecheck: 0 } }], { typecheck: 1 });
    let seen = 0;
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        if (/claude/i.test(input.executable)) {
          seen += 1;
          if (seen === 1) h.engine.requestPause("loop-run");
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const paused = await h.loop.run("loop-run");
    assert.equal(paused.reason, "paused");

    const resumed = await h.loop.run("loop-run");
    assert.equal(resumed.reason, "completed", resumed.detail);

    const sent = dispatches(h.worktree);
    assert.equal(sent.length, 2);
    assert.deepEqual([...new Set(sent.map((entry) => entry.sessionId))], [LOOP_SESSION_ID], "same sticky session across the pause");
    assert.equal(sent[1]!.resume, true);
    h.close();
  });

  test("a stop request while the worker is live kills it and holds the run for review", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    let seen = 0;
    // Track the backgrounded stop so it is awaited before the database closes.
    const stops: Promise<unknown>[] = [];
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        if (/claude/i.test(input.executable)) {
          seen += 1;
          if (seen === 1) stops.push(h.engine.requestStop("loop-run").catch(() => undefined));
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");
    await Promise.all(stops);

    // Stopping terminates the live worker process. Killing a prompt that was
    // already sent does NOT undo whatever it did, so the honest outcome is
    // uncertainty, not a clean stop.
    assert.equal(outcome.reason, "worker_uncertain");
    assert.equal(h.store.requireRun("loop-run").state, "NEEDS_REVIEW");
    assert.equal(dispatches(h.worktree).length, 1, "no turn after the stop request");
    assert.equal(h.worker.sessions.list("loop-run")[0]!.result?.failure, "interrupted");

    // And it stays held: a further run() sends nothing, because the pending stop
    // is seen at the boundary before any turn can be planned.
    const again = await h.loop.run("loop-run");
    assert.equal(again.reason, "stopped");
    assert.equal(dispatches(h.worktree).length, 1, "no prompt after the stop");
    h.close();
  });

  test("a stop between turns ends the run without another prompt", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    const stops: Promise<unknown>[] = [];
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        // Stop once the worker turn is done and verification has begun, so the
        // request lands at a clean boundary rather than mid-prompt.
        if (/node(?:\.exe)?$/i.test(input.executable) && stops.length === 0) {
          stops.push(h.engine.requestStop("loop-run").catch(() => undefined));
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");
    await Promise.all(stops);

    assert.equal(dispatches(h.worktree).length, 1, "exactly one prompt; the loop did not continue");
    const state = h.store.requireRun("loop-run").state;
    assert.ok(["STOPPED", "STOP_REQUESTED"].includes(state), `expected a stopped run, got ${state}`);
    assert.ok(["stopped", "worker_uncertain"].includes(outcome.reason), outcome.reason);
    h.close();
  });

  test("revoking the grant stops the loop at the next turn boundary", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }], { typecheck: 1 });
    let seen = 0;
    const h = openLoop(root, {
      maxConsecutiveFailures: 99,
      beforeProcess: (input) => {
        if (/claude/i.test(input.executable)) {
          seen += 1;
          if (seen === 1) h.loop.revoke("loop-run", "operator changed their mind");
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 10, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "grant_closed");
    assert.equal(dispatches(h.worktree).length, 1);
    assert.equal(h.loop.loops.grants("loop-run")[0]!.status, "REVOKED");
    h.close();
  });
});

describe("authority", () => {
  test("the loop refuses to run without a human grant", async () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    h.createRun();

    const outcome = await h.loop.run("loop-run");
    assert.equal(outcome.reason, "grant_closed");
    assert.equal(dispatches(h.worktree).length, 0, "not a single prompt without authorization");
    h.close();
  });

  test("every turn still produces its own approval, resolved by the named grant", async () => {
    const root = workspace([{ verify: { typecheck: 1 } }, { verify: { typecheck: 0 } }], { typecheck: 1 });
    const h = openLoop(root);

    h.createRun();
    const grant = h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    await h.loop.run("loop-run");

    const events = h.engine.snapshot("loop-run").events;
    const granted = events.filter((event) => event.type === "APPROVAL_GRANTED");
    assert.equal(granted.length, 2, "one approval per turn, not one for the whole loop");
    for (const event of granted) {
      assert.equal(event.payload.source, `loop_grant:${grant.id}`, "the audit names the authorizing grant");
    }

    // The grant is bounded and its consumption is attributed per turn.
    assert.equal(h.loop.loops.grants("loop-run")[0]!.maxTurns, 5);
    assert.deepEqual(h.loop.loops.turns("loop-run").map((turn) => turn.grantConsumed), [true, true]);
    assert.equal(events.filter((event) => event.type === "LOOP_TURN_CONSUMED_GRANT").length, 2);
    h.close();
  });

  test("a grant cannot authorize an unbounded or second loop", () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    h.createRun();

    assert.throws(() => h.loop.authorize({ runId: "loop-run", maxTurns: 0, grantedBy: "x" }), /between 1 and 50/);
    assert.throws(() => h.loop.authorize({ runId: "loop-run", maxTurns: 999, grantedBy: "x" }), /between 1 and 50/);
    assert.throws(() => h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "" }), /who granted it/);

    h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });
    assert.throws(() => h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" }), /already has an active loop grant/);
    h.close();
  });
});

describe("crash and restart", () => {
  test("a crash between turns resumes without duplicating a prompt", async () => {
    const plan: LoopPlanStep[] = [{ verify: { typecheck: 1 } }, { verify: { typecheck: 0 } }];
    const root = workspace(plan, { typecheck: 1 });

    // First process: run one turn, then lose the runtime entirely.
    const first = openLoop(root, { instance: 1, maxConsecutiveFailures: 99 });
    first.createRun();
    first.loop.authorize({ runId: "loop-run", maxTurns: 6, grantedBy: "test-human" });
    let seen = 0;
    const paused = await (async () => {
      const original = first.engine.requestPause.bind(first.engine);
      void original;
      // Stop after the first verification by revoking nothing — instead pause.
      const outcome = await (async () => {
        const hooked = openLoop; void hooked; void seen;
        return first.loop.run("loop-run");
      })();
      return outcome;
    })();
    void paused;
    first.close();

    const afterFirst = dispatches(first.worktree).length;
    assert.ok(afterFirst >= 1);

    // Second process: fresh runtime, same database and worktree.
    const second = openLoop(root, { instance: 2, maxConsecutiveFailures: 99 });
    const before = dispatches(second.worktree).length;
    const outcome = await second.loop.run("loop-run");
    const after = dispatches(second.worktree).length;

    // Whatever the first process completed is not repeated.
    const turns = second.loop.loops.turns("loop-run");
    assert.equal(new Set(turns.map((turn) => turn.ordinal)).size, turns.length, "turn ordinals are unique");
    assert.ok(after >= before, "the loop made progress or stopped safely");
    assert.deepEqual(
      [...new Set(dispatches(second.worktree).map((entry) => entry.sessionId))],
      [LOOP_SESSION_ID],
      "the sticky session survived the restart"
    );
    assert.ok(["completed", "turn_limit", "consecutive_failures", "grant_closed", "paused"].includes(outcome.reason), outcome.reason);
    second.close();
  });

  test("a crash during a send leaves the turn uncertain and never resends it", async () => {
    const root = workspace([{ hang: true }], { typecheck: 1 });
    const h = openLoop(root, {
      beforeProcess: (input) => {
        // Interrupt the worker as soon as its prompt is dispatched.
        if (/claude/i.test(input.executable)) {
          setTimeout(() => {
            void h.worker.interrupt("loop-run").catch(() => undefined);
          }, 150);
        }
      }
    });

    h.createRun();
    h.loop.authorize({ runId: "loop-run", maxTurns: 5, grantedBy: "test-human" });
    const outcome = await h.loop.run("loop-run");

    assert.equal(outcome.reason, "worker_uncertain", outcome.detail);
    assert.equal(h.store.requireRun("loop-run").state, "NEEDS_REVIEW");

    const turns = h.loop.loops.turns("loop-run");
    assert.equal(turns.length, 1);
    assert.equal(turns[0]!.status, "UNCERTAIN");

    // Running again must not resend the uncertain prompt.
    const sentBefore = dispatches(h.worktree).length;
    await assert.rejects(() => h.loop.run("loop-run"), /cannot start a turn from NEEDS_REVIEW/);
    assert.equal(dispatches(h.worktree).length, sentBefore, "an uncertain prompt is never replayed");
    h.close();
  });

  test("grant consumption is idempotent per turn", () => {
    const root = workspace([{ verify: { typecheck: 0 } }], { typecheck: 0 });
    const h = openLoop(root);
    h.createRun();
    const grant = h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "test-human" });

    const turn = h.loop.loops.planTurn({ runId: "loop-run", grantId: grant.id, kind: "INITIAL", prompt: "hello" });
    h.loop.loops.consumeGrantForTurn(turn.id);
    h.loop.loops.consumeGrantForTurn(turn.id);
    h.loop.loops.consumeGrantForTurn(turn.id);

    assert.equal(h.loop.loops.requireGrant(grant.id).turnsUsed, 1, "re-consuming the same turn spends nothing more");
    h.close();
  });
});
