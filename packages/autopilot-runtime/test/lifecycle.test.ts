import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { AutopilotEngine } from "../src/engine.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { ScriptedExecutor, type ScriptedStep } from "../src/scriptedExecutor.ts";
import { createTestWorkspace, type TestWorkspace } from "./helpers/harness.ts";

const workspaces: TestWorkspace[] = [];

afterEach(() => {
  while (workspaces.length) workspaces.pop()!.cleanup();
});

function setup(steps: ScriptedStep[]) {
  const space = createTestWorkspace();
  workspaces.push(space);
  const opened = space.openPorts();
  runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");
  const executor = new ScriptedExecutor({ steps, ledger: space.ledger });
  const engine = new AutopilotEngine({ ports: opened.ports, executor });
  return { space, opened, executor, engine };
}

const threeGoodSteps: ScriptedStep[] = [
  { key: "step-1", behaviour: { kind: "succeed" } },
  { key: "step-2", behaviour: { kind: "succeed" } },
  { key: "step-3", behaviour: { kind: "succeed" } }
];

describe("run lifecycle", () => {
  test("a run completes and journals an ordered history", async () => {
    const { engine, opened, space } = setup(threeGoodSteps);

    const run = engine.createRun({ id: "run-1", goal: "complete three steps" });
    assert.equal(run.state, "READY");

    const finished = await engine.start("run-1");
    assert.equal(finished.state, "COMPLETED");

    const snapshot = engine.snapshot("run-1");
    assert.deepEqual(snapshot.steps.map((step) => step.status), ["COMPLETED", "COMPLETED", "COMPLETED"]);
    assert.deepEqual(snapshot.events.map((event) => event.seq), [...Array(snapshot.events.length).keys()].map((n) => n + 1));

    const types = snapshot.events.map((event) => event.type);
    assert.deepEqual(types.slice(0, 6), [
      "RUN_CREATED",
      "RUN_READY",
      "RUN_STARTED",
      "STEP_INTENT_RECORDED",
      "STEP_STARTED",
      "STEP_COMPLETED"
    ]);
    assert.equal(types.at(-1), "RUN_COMPLETED");

    // Intent is always journaled before the step starts.
    for (const stepKey of ["step-1", "step-2", "step-3"]) {
      const intentSeq = snapshot.events.find((e) => e.type === "STEP_INTENT_RECORDED" && e.stepKey === stepKey)!.seq;
      const startedSeq = snapshot.events.find((e) => e.type === "STEP_STARTED" && e.stepKey === stepKey)!.seq;
      assert.ok(intentSeq < startedSeq, `intent must precede execution for ${stepKey}`);
    }

    assert.equal(space.ledger.size(), 3, "exactly one side effect per step");
    opened.close();
  });

  test("a failing step fails the run and stops further work", async () => {
    const { engine, opened, executor } = setup([
      { key: "step-1", behaviour: { kind: "succeed" } },
      { key: "step-2", behaviour: { kind: "fail", summary: "boom" } },
      { key: "step-3", behaviour: { kind: "succeed" } }
    ]);

    engine.createRun({ id: "run-2", goal: "fail at step two" });
    const finished = await engine.start("run-2");

    assert.equal(finished.state, "FAILED");
    assert.match(finished.failureReason ?? "", /step-2/);
    assert.deepEqual(executor.executed, ["step-1", "step-2"], "step-3 must never run");
    opened.close();
  });
});

describe("pause", () => {
  test("pause is durable, stops at a safe boundary, and does not abandon in-flight work", async () => {
    const { engine, opened, executor, space } = setup([
      { key: "step-1", behaviour: { kind: "block" } },
      { key: "step-2", behaviour: { kind: "succeed" } }
    ]);

    engine.createRun({ id: "run-3", goal: "pause mid-run" });
    const loop = engine.start("run-3");

    // Wait for step-1 to be genuinely in flight.
    while (!executor.isBlocked("step-1")) await new Promise((resolve) => setImmediate(resolve));

    const paused = engine.requestPause("run-3");
    assert.equal(paused.state, "PAUSE_REQUESTED", "the request is durable immediately");
    assert.equal(paused.pauseRequested, true);
    assert.equal(engine.snapshot("run-3").steps[0]!.status, "RUNNING", "in-flight work is not abandoned");

    // Let the in-flight step finish; the loop must then stop at the boundary.
    executor.release("step-1");
    await loop;

    const settled = engine.store.requireRun("run-3");
    assert.equal(settled.state, "PAUSED");
    assert.deepEqual(executor.executed, ["step-1"], "no new work starts while paused");
    assert.equal(engine.snapshot("run-3").steps[0]!.status, "COMPLETED", "the in-flight step completed normally");
    assert.equal(space.ledger.size(), 1);
    opened.close();
  });

  test("resume continues from the boundary without repeating completed work", async () => {
    const { engine, opened, executor, space } = setup([
      { key: "step-1", behaviour: { kind: "block" } },
      { key: "step-2", behaviour: { kind: "succeed" } },
      { key: "step-3", behaviour: { kind: "succeed" } }
    ]);

    engine.createRun({ id: "run-4", goal: "pause then resume" });
    const loop = engine.start("run-4");
    while (!executor.isBlocked("step-1")) await new Promise((resolve) => setImmediate(resolve));
    engine.requestPause("run-4");
    executor.release("step-1");
    await loop;

    assert.equal(engine.store.requireRun("run-4").state, "PAUSED");

    const resumed = await engine.resume("run-4");
    assert.equal(resumed.state, "COMPLETED");
    assert.equal(resumed.pauseRequested, false);
    assert.deepEqual(executor.executed, ["step-1", "step-2", "step-3"]);
    assert.equal(space.ledger.size(), 3, "step-1 must not run a second time");

    const types = engine.snapshot("run-4").events.map((event) => event.type);
    assert.ok(types.includes("PAUSE_REQUESTED"));
    assert.ok(types.includes("RUN_PAUSED"));
    assert.ok(types.includes("RUN_RESUMED"));
    opened.close();
  });
});

describe("stop", () => {
  test("stop persists intent, cancels in-flight work and prevents new work", async () => {
    const { engine, opened, executor, space } = setup([
      { key: "step-1", behaviour: { kind: "block" } },
      { key: "step-2", behaviour: { kind: "succeed" } }
    ]);

    engine.createRun({ id: "run-5", goal: "stop mid-run" });
    const loop = engine.start("run-5");
    while (!executor.isBlocked("step-1")) await new Promise((resolve) => setImmediate(resolve));

    const stopped = await engine.requestStop("run-5");
    await loop;

    assert.equal(stopped.state, "STOPPED");
    assert.deepEqual(executor.executed, ["step-1"], "step-2 must never start");

    const types = engine.snapshot("run-5").events.map((event) => event.type);
    assert.ok(types.indexOf("STOP_REQUESTED") < types.indexOf("RUN_STOPPED"), "stop intent is journaled first");
    assert.ok(space.ledger.size() <= 1);
    opened.close();
  });

  test("a stopped run cannot be started again", async () => {
    const { engine, opened } = setup(threeGoodSteps);
    engine.createRun({ id: "run-6", goal: "stop before starting" });

    const stopped = await engine.requestStop("run-6");
    assert.equal(stopped.state, "STOPPED");

    await assert.rejects(() => engine.start("run-6"), /cannot start from state STOPPED/);
    assert.equal(engine.store.requireRun("run-6").state, "STOPPED");
    opened.close();
  });

  test("stop wins over a pending pause", async () => {
    const { engine, opened, executor } = setup([
      { key: "step-1", behaviour: { kind: "block" } },
      { key: "step-2", behaviour: { kind: "succeed" } }
    ]);

    engine.createRun({ id: "run-7", goal: "pause then stop" });
    const loop = engine.start("run-7");
    while (!executor.isBlocked("step-1")) await new Promise((resolve) => setImmediate(resolve));

    engine.requestPause("run-7");
    const stopPromise = engine.requestStop("run-7");
    executor.release("step-1");
    await loop;
    await stopPromise;

    assert.equal(engine.store.requireRun("run-7").state, "STOPPED");
    opened.close();
  });
});
