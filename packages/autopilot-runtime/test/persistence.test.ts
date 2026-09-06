import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { AUTOPILOT_MIGRATIONS, runAutopilotMigrations } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec, authoritativeFingerprint, RunSpecValidationError } from "../src/runSpec.ts";
import { IllegalTransitionError } from "../src/states.ts";
import { createTestWorkspace, assertSafeDataRoot, type TestWorkspace } from "./helpers/harness.ts";

const workspaces: TestWorkspace[] = [];

function workspace(): TestWorkspace {
  const created = createTestWorkspace();
  workspaces.push(created);
  return created;
}

afterEach(() => {
  while (workspaces.length) workspaces.pop()!.cleanup();
});

function spec(id: string, goal = "Ship the durable spine") {
  return createRunSpec({ id, goal, constraints: ["do not touch local-data"] }, { id, now: "2026-01-01T00:00:00.000Z" });
}

describe("data-root safety", () => {
  test("refuses the real DexNest data root", () => {
    assert.throws(() => assertSafeDataRoot("D:/DeskNest/local-data"), /Refusing to run a test/);
    assert.throws(() => assertSafeDataRoot("D:/DeskNest/local-data/settings"), /Refusing to run a test/);
    assert.throws(() => assertSafeDataRoot("C:/somewhere/local-data"), /looks like a DexNest data root/);
  });

  test("test workspaces are isolated temp directories and set DEXNEST_DATA_ROOT", () => {
    const space = workspace();
    assert.ok(space.dir.length > 0);
    assert.equal(process.env.DEXNEST_DATA_ROOT, space.dir);
    assert.ok(!space.dir.toLowerCase().includes("desknest\\local-data"));
  });
});

describe("migrations", () => {
  test("later migrations preserve an accepted worker session and uncertain send", () => {
    const space = workspace();
    const opened = space.openPorts();
    const db = opened.ports.db;
    runAutopilotMigrations(db, "2026-01-01T00:00:00.000Z", AUTOPILOT_MIGRATIONS.filter(migration => migration.id <= 3));
    const store = new AutopilotStore(opened.ports);
    store.createRun({ spec: spec("existing-worker"), executorId: "worker-foundation" });
    db.exec(`INSERT INTO autopilot_worker_sessions(run_id,provider,session_id,cwd,established,created_at)
      VALUES('existing-worker','claude','existing-session','D:/Worktrees/existing',1,'2026-01-01');
      INSERT INTO autopilot_worker_sends(id,run_id,prompt_text,status,created_at,updated_at)
      VALUES('existing-send','existing-worker','Original prompt','UNCERTAIN','2026-01-01','2026-01-01');`);
    // Version-agnostic: every migration after 3 must apply and preserve the rows.
    const remaining = AUTOPILOT_MIGRATIONS.filter(migration => migration.id > 3).map(migration => migration.id);
    assert.deepEqual(runAutopilotMigrations(db, "2026-01-02T00:00:00.000Z").applied, remaining);
    assert.deepEqual(db.prepare("SELECT session_id,established FROM autopilot_worker_sessions").get(), { session_id: "existing-session", established: 1 });
    assert.deepEqual(db.prepare("SELECT prompt_text,status,retry_of FROM autopilot_worker_sends").get(), { prompt_text: "Original prompt", status: "UNCERTAIN", retry_of: null });
    // The loop tables are additive and start empty for a pre-existing run.
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS count FROM autopilot_loop_grants").get(), { count: 0 });
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS count FROM autopilot_turns").get(), { count: 0 });
    opened.close();
  });

  test("apply to an empty database and are idempotent", () => {
    const space = workspace();
    const first = space.openPorts();

    const allIds = AUTOPILOT_MIGRATIONS.map((migration) => migration.id);

    const applied = runAutopilotMigrations(first.ports.db, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(applied.applied, allIds);
    assert.deepEqual(applied.alreadyApplied, []);

    const again = runAutopilotMigrations(first.ports.db, "2026-01-01T00:00:01.000Z");
    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.alreadyApplied, allIds);

    first.close();
  });

  test("preserve an existing event_log table and its rows", () => {
    const space = workspace();
    const opened = space.openPorts();

    // Recreate the existing DexNest schema and a real row.
    opened.ports.db.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    opened.ports.db
      .prepare("INSERT INTO event_log (id, type, source, payload_json, created_at) VALUES (:id,:t,:s,:p,:c)")
      .run({ id: "existing-1", t: "action_run", s: "module_ui", p: "{}", c: "2025-12-01T00:00:00.000Z" });

    runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");

    const rows = opened.ports.db.prepare("SELECT id FROM event_log").all<{ id: string }>();
    assert.deepEqual(rows, [{ id: "existing-1" }], "existing user data must survive migration");

    const tables = opened.ports.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all<{ name: string }>()
      .map((row) => row.name);
    assert.ok(tables.includes("event_log"));
    assert.ok(tables.includes("autopilot_runs"));
    assert.ok(tables.includes("autopilot_run_events"));
    assert.ok(tables.includes("autopilot_run_steps"));
    assert.ok(tables.includes("autopilot_operations"));
    assert.ok(tables.includes("autopilot_approvals"));
    assert.ok(tables.includes("autopilot_loop_grants"));
    assert.ok(tables.includes("autopilot_turns"));
    assert.ok(tables.includes("autopilot_verification_runs"));

    opened.close();
  });
});

describe("run spec", () => {
  test("rejects an empty goal", () => {
    assert.throws(
      () => createRunSpec({ goal: "   " }, { id: "r1", now: "2026-01-01T00:00:00.000Z" }),
      RunSpecValidationError
    );
  });

  test("rejects duplicate acceptance criterion ids", () => {
    assert.throws(
      () =>
        createRunSpec(
          {
            goal: "g",
            acceptanceCriteria: [
              { id: "same", text: "a", kind: "automated" },
              { id: "same", text: "b", kind: "automated" }
            ]
          },
          { id: "r1", now: "2026-01-01T00:00:00.000Z" }
        ),
      RunSpecValidationError
    );
  });

  test("defaults forbid local-data", () => {
    const created = spec("r1");
    assert.ok(created.capabilities.forbiddenPaths.includes("local-data"));
  });

  test("fingerprint is order-independent but content-sensitive", () => {
    const a = createRunSpec(
      { goal: "g", constraints: ["one", "two"], nonGoals: ["x"] },
      { id: "r1", now: "2026-01-01T00:00:00.000Z" }
    );
    const b = createRunSpec(
      { goal: "g", constraints: ["two", "one"], nonGoals: ["x"] },
      { id: "r1", now: "2026-01-01T00:00:00.000Z" }
    );
    assert.equal(authoritativeFingerprint(a), authoritativeFingerprint(b));

    const c = createRunSpec({ goal: "different goal" }, { id: "r1", now: "2026-01-01T00:00:00.000Z" });
    assert.notEqual(authoritativeFingerprint(a), authoritativeFingerprint(c));
  });
});

describe("store", () => {
  test("creates a run, persists it, and reloads it from a fresh connection", () => {
    const space = workspace();
    const first = space.openPorts();
    runAutopilotMigrations(first.ports.db, "2026-01-01T00:00:00.000Z");

    const store = new AutopilotStore(first.ports);
    const created = store.createRun({ spec: spec("run-a"), executorId: "scripted" });
    assert.equal(created.state, "CREATED");
    assert.equal(created.goal, "Ship the durable spine");
    first.close();

    // Fresh process-equivalent: new connection, no in-memory knowledge.
    const second = space.openPorts();
    const reloaded = new AutopilotStore(second.ports).requireRun("run-a");
    assert.equal(reloaded.state, "CREATED");
    assert.equal(reloaded.spec.goal, "Ship the durable spine");
    assert.deepEqual(reloaded.spec.constraints, ["do not touch local-data"]);
    assert.equal(reloaded.specFingerprint, created.specFingerprint);
    second.close();
  });

  test("event sequence is gapless, ordered and deterministic", () => {
    const space = workspace();
    const opened = space.openPorts();
    runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");
    const store = new AutopilotStore(opened.ports);

    store.createRun({ spec: spec("run-b"), executorId: "scripted" });
    store.appendEvent("run-b", { type: "RUN_READY", toState: "READY" });
    store.appendEvent("run-b", { type: "RUN_STARTED", toState: "RUNNING" });
    store.appendEvent("run-b", { type: "PAUSE_REQUESTED", toState: "PAUSE_REQUESTED", pauseRequested: true });

    const events = store.listEvents("run-b");
    assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4]);
    assert.deepEqual(events.map((event) => event.type), [
      "RUN_CREATED",
      "RUN_READY",
      "RUN_STARTED",
      "PAUSE_REQUESTED"
    ]);
    assert.deepEqual(
      events.map((event) => [event.fromState, event.toState]),
      [
        ["CREATED", null],
        ["CREATED", "READY"],
        ["READY", "RUNNING"],
        ["RUNNING", "PAUSE_REQUESTED"]
      ]
    );
    assert.equal(store.requireRun("run-b").pauseRequested, true);
    opened.close();
  });

  test("an illegal transition writes neither state nor event", () => {
    const space = workspace();
    const opened = space.openPorts();
    runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");
    const store = new AutopilotStore(opened.ports);

    store.createRun({ spec: spec("run-c"), executorId: "scripted" });
    const before = store.listEvents("run-c").length;

    assert.throws(() => store.appendEvent("run-c", { type: "RUN_COMPLETED", toState: "COMPLETED" }), IllegalTransitionError);

    assert.equal(store.listEvents("run-c").length, before, "rolled back: no event written");
    assert.equal(store.requireRun("run-c").state, "CREATED", "rolled back: state unchanged");
    opened.close();
  });

  test("step intent is unique per logical step", () => {
    const space = workspace();
    const opened = space.openPorts();
    runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");
    const store = new AutopilotStore(opened.ports);
    store.createRun({ spec: spec("run-d"), executorId: "scripted" });

    const first = store.recordStepIntent({ runId: "run-d", stepKey: "step-1", ordinal: 0, idempotencyKey: "key-1" });
    assert.ok(first);
    assert.equal(first.status, "INTENT");

    const second = store.recordStepIntent({ runId: "run-d", stepKey: "step-1", ordinal: 0, idempotencyKey: "key-2" });
    assert.equal(second, null, "a second intent for the same logical step must be refused");

    assert.equal(store.listSteps("run-d").length, 1);
    opened.close();
  });

  test("unfinished runs exclude terminal states", () => {
    const space = workspace();
    const opened = space.openPorts();
    runAutopilotMigrations(opened.ports.db, "2026-01-01T00:00:00.000Z");
    const store = new AutopilotStore(opened.ports);

    store.createRun({ spec: spec("run-live"), executorId: "scripted" });
    store.appendEvent("run-live", { type: "RUN_READY", toState: "READY" });

    store.createRun({ spec: spec("run-done"), executorId: "scripted" });
    store.appendEvent("run-done", { type: "RUN_READY", toState: "READY" });
    store.appendEvent("run-done", { type: "STOP_REQUESTED", toState: "STOP_REQUESTED" });
    store.appendEvent("run-done", { type: "RUN_STOPPED", toState: "STOPPED" });

    const unfinished = store.listUnfinishedRuns().map((run) => run.id);
    assert.deepEqual(unfinished, ["run-live"]);
    opened.close();
  });
});
