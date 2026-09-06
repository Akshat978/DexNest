import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RUN_STATES,
  TERMINAL_STATES,
  assertTransition,
  canTransition,
  isTerminal,
  legalTargets,
  IllegalTransitionError,
  type RunState
} from "../src/states.ts";

describe("run state machine", () => {
  test("every legal transition is accepted", () => {
    for (const from of RUN_STATES) {
      for (const to of legalTargets(from)) {
        assert.doesNotThrow(() => assertTransition(from, to), `${from} -> ${to} should be legal`);
      }
    }
  });

  test("terminal states have no outgoing transitions", () => {
    for (const state of TERMINAL_STATES) {
      assert.equal(legalTargets(state).length, 0, `${state} must be terminal`);
      assert.ok(isTerminal(state));
    }
  });

  test("representative illegal transitions are rejected", () => {
    const illegal: Array<[RunState, RunState]> = [
      ["CREATED", "RUNNING"],
      ["CREATED", "COMPLETED"],
      ["READY", "PAUSED"],
      ["READY", "COMPLETED"],
      ["PAUSED", "COMPLETED"],
      ["PAUSE_REQUESTED", "RUNNING"],
      ["STOPPED", "RUNNING"],
      ["COMPLETED", "RUNNING"],
      ["FAILED", "RUNNING"],
      ["STOP_REQUESTED", "RUNNING"],
      ["STOP_REQUESTED", "PAUSED"],
      ["NEEDS_REVIEW", "COMPLETED"]
    ];

    for (const [from, to] of illegal) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`);
      assert.throws(() => assertTransition(from, to), IllegalTransitionError, `${from} -> ${to} must throw`);
    }
  });

  test("a stopped run can never be resumed", () => {
    for (const state of RUN_STATES) {
      assert.equal(canTransition("STOPPED", state), false, `STOPPED must not reach ${state}`);
    }
  });

  test("pause cannot skip PAUSE_REQUESTED", () => {
    assert.equal(canTransition("RUNNING", "PAUSED"), false);
    assert.equal(canTransition("RUNNING", "PAUSE_REQUESTED"), true);
    assert.equal(canTransition("PAUSE_REQUESTED", "PAUSED"), true);
  });

  test("stop wins from every interruptible state", () => {
    for (const state of ["READY", "RUNNING", "PAUSE_REQUESTED", "PAUSED", "NEEDS_REVIEW"] as RunState[]) {
      assert.ok(
        canTransition(state, "STOP_REQUESTED") || canTransition(state, "STOPPED"),
        `${state} must be stoppable`
      );
    }
  });

  test("the error message names the legal targets", () => {
    try {
      assertTransition("STOPPED", "RUNNING");
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof IllegalTransitionError);
      assert.match(error.message, /terminal state/);
    }
  });
});
