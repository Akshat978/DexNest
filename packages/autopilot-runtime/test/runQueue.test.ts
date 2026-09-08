// Several projects in one night, on one budget.
//
// The decision logic is proved in @dexnest/run-queue, against pure inputs.
// What is proved HERE is the half that touches durable state: that records are
// derived from rows rather than stored twice, that a status can only move the
// way the engine's matrix permits even when SQLite would happily accept
// anything, that spend is summed across the whole queue, and that how a run
// ended becomes the right thing having happened to its item.
//
// That last one is the piece with no equivalent anywhere else. A run stopping
// because it ran out of turns is not a broken project, and treating it as one
// would trip the consecutive-failure bound and end a night that was going fine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { RunQueueStore, QUEUE_OUTCOME } from "../src/runQueue.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./helpers/harness.ts";
import { createPlatformPorts } from "./helpers/platform.ts";
import type { RuntimePorts } from "../src/ports.ts";

const NOW = "2026-09-07T00:00:00.000Z";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-queue-"));
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  const ports: RuntimePorts = {
    db: database.db,
    platform: createPlatformPorts({}),
    clock: createTestClock(NOW),
    ids: createTestIds(1),
    logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, NOW);
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const runs = new AutopilotStore(ports);
  const makeRun = (id: string) => {
    runs.createRun({ spec: { ...createRunSpec({ goal: "maintain" }, { id, now: NOW }), id }, executorId: "test" });
    return id;
  };
  return { ports, store: new RunQueueStore(ports), runs, makeRun };
}

const THREE = [
  { projectPath: "D:/astro-yogi", goal: "Update dependencies and fix breakage", label: "astro-yogi" },
  { projectPath: "D:/portfolio-v2", goal: "Update dependencies and fix breakage", label: "portfolio-v2" },
  { projectPath: "D:/darshan-port", goal: "Update dependencies and fix breakage", label: "darshan port" }
];

// --- what a queue is --------------------------------------------------------

test("a queue orders its projects and starts them one at a time", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const items = h.store.items(queue.id);

  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => item.ordinal), [0, 1, 2], "ordinals come from the engine, not the caller");
  assert.deepEqual(items.map(item => item.status), ["PENDING", "PENDING", "PENDING"]);

  const first = h.store.decide(queue.id);
  assert.deepEqual(first, { kind: "start", itemId: items[0]!.id });

  h.store.start(items[0]!.id, h.makeRun("run-1"));
  const second = h.store.decide(queue.id);
  assert.equal(second.kind, "busy", "a second project must never start beside the first");
});

test("the engine's refusals reach the operator, not a SQLite constraint", (t) => {
  const h = fixture(t);
  assert.throws(() => h.store.create({ items: [{ projectPath: "D:/a", goal: "   " }] }), /goal/i);
  assert.throws(() => h.store.create({ items: [{ projectPath: "relative/path", goal: "g" }] }), /path/i);
  assert.throws(() => h.store.create({ items: [] }), /at least one project/);
});

test("only one queue is active at a time", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  assert.equal(h.store.active()!.id, queue.id);
  assert.throws(() => h.store.create({ items: THREE }), /already active/);

  h.store.close(queue.id, "done for tonight");
  assert.equal(h.store.active(), null);
  assert.doesNotThrow(() => h.store.create({ items: THREE }));
});

// --- the part SQLite would otherwise let through -----------------------------

test("a status can only move the way the engine permits", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const [first] = h.store.items(queue.id);

  h.store.start(first!.id, h.makeRun("run-1"));
  h.store.settle(first!.id, "DONE", "tests green");

  // The column would accept any of these; the transition matrix does not.
  assert.throws(() => h.store.settle(first!.id, "FAILED", "changed my mind"), /DONE/);
  assert.throws(() => h.store.start(first!.id, h.makeRun("run-2")), /DONE/);
});

test("records are derived from the item rows, never stored twice", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const [first] = h.store.items(queue.id);
  h.store.start(first!.id, h.makeRun("run-1"));
  h.store.settle(first!.id, "DONE", "tests green");

  const view = h.store.view(queue.id);
  const item = h.store.items(queue.id)[0]!;
  const record = view.records.find(entry => entry.itemId === item.id)!;

  assert.equal(record.status, item.status, "one truth, read two ways");
  assert.equal(record.settledAt, item.settledAt);
  assert.equal(record.reason, item.reason);
});

test("spend is summed across the whole queue, not per project", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE, budget: { maxCostUsd: 5 } });
  const items = h.store.items(queue.id);

  for (const [index, item] of items.slice(0, 2).entries()) {
    const runId = h.makeRun(`run-${index + 1}`);
    h.store.start(item.id, runId);
    h.store.settle(item.id, "DONE", "green");
    h.ports.db
      .prepare(
        `INSERT INTO autopilot_turns
           (id, run_id, grant_id, ordinal, kind, prompt_text, status, created_at, updated_at, cost_usd)
         VALUES (:id, :runId, 'g', 1, 'INITIAL', 'p', 'VERIFIED', :now, :now, 3)`
      )
      .run({ id: `turn-${index}`, runId, now: NOW });
  }

  assert.equal(h.store.spentUsd(queue.id), 6, "two runs at 3 each, shared across the queue");
  const action = h.store.decide(queue.id);
  assert.equal(action.kind, "stop");
  assert.equal((action as { reason: string }).reason, "cost", "the third project is not started");
});

// --- how a run ending becomes what happened to a project ---------------------

test("every way a loop can stop has a decided meaning for the queue", () => {
  // A stop reason with no mapping would silently leave an item RUNNING for
  // ever, and the queue would report busy until someone noticed.
  const reasons = [
    "consultant_recommended", "primary_blocked", "completed", "verification_indeterminate",
    "turn_limit", "iteration_limit", "time_limit", "cost_limit", "no_progress",
    "consecutive_failures", "worker_uncertain", "worker_failed", "provider_limit",
    "plan_complete_proposed", "direction_needs_human", "paused", "stopped", "grant_closed"
  ] as const;
  for (const reason of reasons) {
    assert.ok(QUEUE_OUTCOME[reason], `no queue meaning for stop reason "${reason}"`);
  }
  assert.equal(Object.keys(QUEUE_OUTCOME).length, reasons.length, "a reason was added without deciding what it means");
});

test("running out of budget is not a broken project", (t) => {
  // The distinction that matters: maxConsecutiveFailures counts failures, and
  // three projects that ran out of turns are not three broken projects.
  for (const reason of ["turn_limit", "iteration_limit", "time_limit", "cost_limit", "no_progress"] as const) {
    assert.equal(QUEUE_OUTCOME[reason], "ABANDONED", reason);
  }
  for (const reason of ["worker_failed", "consecutive_failures", "verification_indeterminate"] as const) {
    assert.equal(QUEUE_OUTCOME[reason], "FAILED", reason);
  }

  const h = fixture(t);
  const queue = h.store.create({ items: THREE, budget: { maxConsecutiveFailures: 2 } });
  const items = h.store.items(queue.id);
  for (const [index, item] of items.slice(0, 2).entries()) {
    h.store.start(item.id, h.makeRun(`run-${index + 1}`));
    h.store.settle(item.id, "ABANDONED", "turn limit reached");
  }
  assert.equal(h.store.decide(queue.id).kind, "start", "two spent budgets do not end the night");
});

test("a run nobody should override does not advance the queue", () => {
  // provider_limit already has a scheduled retry; the rest mean a person
  // intervened, and marching on would override the decision they just made.
  for (const reason of ["provider_limit", "paused", "stopped", "grant_closed"] as const) {
    assert.equal(QUEUE_OUTCOME[reason], "hold", reason);
  }
});

test("a proposed completion settles the project but still asks you about the run", () => {
  // The queue must not wait for a human at 3am — that is its whole purpose —
  // but PLAN_COMPLETE remains a proposal the operator accepts or rejects.
  assert.equal(QUEUE_OUTCOME.plan_complete_proposed, "DONE");
});

// --- reading it in the morning ----------------------------------------------

test("a run knows which queue item it belongs to, and a standalone run does not", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const [first] = h.store.items(queue.id);
  h.store.start(first!.id, h.makeRun("run-1"));

  assert.equal(h.store.itemForRun("run-1")!.id, first!.id);
  assert.equal(h.store.itemForRun(h.makeRun("run-alone")), null, "an ordinary run is not part of any queue");
});

test("the morning summary names each project and how the night ended", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const items = h.store.items(queue.id);

  h.store.start(items[0]!.id, h.makeRun("run-1"));
  h.store.settle(items[0]!.id, "DONE", "tests green");
  h.store.start(items[1]!.id, h.makeRun("run-2"));
  h.store.settle(items[1]!.id, "FAILED", "build broke");

  const summary = h.store.summary(queue.id, "deadline");
  assert.ok(summary.includes("astro-yogi"), summary);
  assert.ok(summary.includes("portfolio-v2"), summary);
  assert.ok(summary.includes("darshan port"), summary);
  assert.ok(summary.includes("build broke"), "a failure without its reason is not a report");
  assert.ok(/cut-off time/i.test(summary), summary);
});

// --- older databases --------------------------------------------------------

test("a database from before queues existed simply has none", (t) => {
  const h = fixture(t);
  h.ports.db.exec("DROP TABLE autopilot_run_queue_items");
  h.ports.db.exec("DROP TABLE autopilot_run_queues");

  assert.equal(h.store.available(), false);
  assert.equal(h.store.active(), null);
  assert.equal(h.store.itemForRun("run-1"), null);
  assert.deepEqual(h.store.items("whatever"), []);
  assert.throws(() => h.store.create({ items: THREE }), /too old/);
});

// --- a whole night ----------------------------------------------------------

test("a night of three projects, driven the way the host drives it", (t) => {
  // The host's loop in miniature: settle the item by how its run stopped, ask
  // the engine what is next, start that. Nothing here is Electron, but every
  // decision the host makes is.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE, budget: { maxConsecutiveFailures: 3 } });
  const settleAs = (reason: keyof typeof QUEUE_OUTCOME) => QUEUE_OUTCOME[reason];

  const started: string[] = [];
  let action = h.store.decide(queue.id);
  const outcomes = ["completed", "turn_limit", "worker_failed"] as const;

  for (const reason of outcomes) {
    assert.equal(action.kind, "start", `expected another project, got ${action.kind}`);
    const itemId = (action as { itemId: string }).itemId;
    const runId = h.makeRun(`run-${started.length + 1}`);
    h.store.start(itemId, runId);
    started.push(itemId);

    const meaning = settleAs(reason);
    assert.notEqual(meaning, "hold");
    h.store.settle(itemId, meaning as Exclude<typeof meaning, "hold">, reason);
    action = h.store.decide(queue.id);
  }

  assert.equal(started.length, 3, "every project was reached");
  assert.equal(action.kind, "stop");
  assert.equal((action as { reason: string }).reason, "queue_complete");

  const counts = h.store.progress(queue.id);
  assert.deepEqual(
    { done: counts.done, failed: counts.failed, remaining: counts.remaining },
    { done: 1, failed: 1, remaining: 0 },
    "one green, one broken, one out of turns — and the last is not counted a failure"
  );

  const summary = h.store.summary(queue.id, "queue_complete");
  assert.ok(summary.includes("astro-yogi"), summary);
  assert.ok(summary.includes("darshan port"), summary);
});

test("a project that cannot even start does not stall the rest of the night", (t) => {
  // The host settles such an item FAILED with the reason and asks again. If it
  // did not, one bad project path would end the night at the first item.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const items = h.store.items(queue.id);

  // SKIPPED, not FAILED: nothing was attempted. The engine refuses
  // PENDING to FAILED, and it is right to — no run existed, no worker was
  // asked, and counting it a failure would end the night over a bad path.
  assert.throws(
    () => h.store.settle(items[0]!.id, "FAILED", "Could not start"),
    /PENDING to FAILED/,
    "the matrix refuses it, which is what sent the host to SKIPPED"
  );
  h.store.settle(items[0]!.id, "SKIPPED", "Could not start: repository has uncommitted changes");
  const next = h.store.decide(queue.id);
  assert.deepEqual(next, { kind: "start", itemId: items[1]!.id });
  assert.ok(h.store.summary(queue.id, null).includes("uncommitted changes"));
});

// --- coming back on its own -------------------------------------------------

test("a scheduled queue is due again after it closes, not after it was made", (t) => {
  // The mistake this pins: computing the next firing from "now" instead of
  // from when the queue closed puts the answer permanently in the future, so a
  // nightly queue is never once due and the schedule silently does nothing.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE, schedule: "nightly at 01:00" });
  assert.equal(h.store.nextFireAt(queue.id, NOW), null, "still running, so not due");

  h.store.close(queue.id, "finished");
  const at = h.store.nextFireAt(queue.id, NOW)!;
  assert.ok(at, "a closed scheduled queue knows when it comes back");
  assert.ok(Date.parse(at) > Date.parse(h.store.get(queue.id)!.closedAt!), "strictly after it closed");
  assert.match(at, /T\d\d:00/, "at the hour it was asked for");
});

test("a schedule nobody can read is refused while the operator is still looking", (t) => {
  const h = fixture(t);
  assert.throws(() => h.store.create({ items: THREE, schedule: "every other tuesday" }), /Schedule not recognised/i);
  assert.equal(h.store.active(), null, "and nothing was written");
});

test("a queue with no schedule runs once and never comes back", (t) => {
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  h.store.close(queue.id, "finished");
  assert.equal(h.store.nextFireAt(queue.id, NOW), null);
  assert.deepEqual(h.store.due("2099-01-01T02:00:00.000Z"), []);
});

test("tonight's run is a new queue, so last night stays readable", (t) => {
  // A reset would leave the morning summary describing work nobody can go back
  // and read, and the cost report with nothing to compare against.
  const h = fixture(t);
  const first = h.store.create({ items: THREE, schedule: "nightly at 01:00", budget: { maxCostUsd: 9 } });
  h.store.start(h.store.items(first.id)[0]!.id, h.makeRun("run-1"));
  h.store.settle(h.store.items(first.id)[0]!.id, "DONE", "green");
  h.store.close(first.id, "finished");

  const second = h.store.repeat(first.id);
  assert.notEqual(second.id, first.id);
  assert.equal(second.repeatsQueueId, first.id, "the chain is recorded");
  assert.equal(second.schedule, "nightly at 01:00", "and it keeps coming back");
  assert.equal(second.budget.maxCostUsd, 9, "on the same budget");
  assert.deepEqual(h.store.items(second.id).map(item => item.status), ["PENDING", "PENDING", "PENDING"]);

  // Last night is untouched.
  assert.equal(h.store.items(first.id)[0]!.status, "DONE");
  assert.equal(h.store.get(first.id)!.status, "CLOSED");
});

test("only the newest queue in a chain is the live one", (t) => {
  // Otherwise every night would spawn one more queue than the night before.
  const h = fixture(t);
  const first = h.store.create({ items: THREE, schedule: "nightly at 01:00" });
  h.store.close(first.id, "finished");
  const second = h.store.repeat(first.id);
  h.store.close(second.id, "finished");

  assert.equal(h.store.nextFireAt(first.id, NOW), null, "superseded, so it does not fire again");
  assert.ok(h.store.nextFireAt(second.id, NOW), "the newest one does");
});

test("nothing is due while a queue is still working", (t) => {
  const h = fixture(t);
  const first = h.store.create({ items: THREE, schedule: "nightly at 01:00" });
  h.store.close(first.id, "finished");
  assert.equal(h.store.due("2099-01-01T02:00:00.000Z").length, 1, "due once the time has passed");

  h.store.create({ items: THREE });
  assert.deepEqual(h.store.due("2099-01-01T02:00:00.000Z"), [], "but never beside a queue that is running");
  assert.equal(h.store.soonestFire("2099-01-01T02:00:00.000Z"), null);
});

// --- appending to a queue that is already open --------------------------------

test("a project can be added to an open queue, after everything already in it", (t) => {
  // The case this exists for: the operator is away, thinks of something, and
  // wants tonight's run to include it.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const before = h.store.items(queue.id);

  const added = h.store.addItem(queue.id, { projectPath: "D:/late-idea", goal: "Fix the importer", label: "late" });

  // Ordinals are 0-based and assigned by the engine, so the appended item's is
  // the count of what was already there.
  assert.equal(added.ordinal, before.length, "appended, never inserted");
  assert.equal(added.status, "PENDING");
  const after = h.store.items(queue.id);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(
    after.slice(0, before.length).map(item => item.id),
    before.map(item => item.id),
    "nothing already in the queue moved"
  );
});

test("appending does not disturb an item that has already run", (t) => {
  // Ordinals are the order work was authorised in, not a priority. Reordering
  // around a running queue would change which item the budget stops at.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  const first = h.store.items(queue.id)[0]!;
  h.store.start(first.id, h.makeRun("run-a"));
  h.store.settle(first.id, "DONE", null);

  h.store.addItem(queue.id, { projectPath: "D:/late-idea", goal: "Fix the importer" });

  const settled = h.store.items(queue.id).find(item => item.id === first.id)!;
  assert.equal(settled.status, "DONE", "the finished item is untouched");
  assert.equal(settled.ordinal, first.ordinal);
});

test("a closed queue refuses new work rather than swallowing it", (t) => {
  // Its items will never start, so accepting one would be discarding it while
  // telling the operator it was queued.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  h.store.close(queue.id, "done for tonight");

  assert.throws(() => h.store.addItem(queue.id, { projectPath: "D:/late", goal: "too late" }), /closed/);
});

test("a queue that does not exist is refused", (t) => {
  const h = fixture(t);
  assert.throws(() => h.store.addItem("queue-nope", { projectPath: "D:/x", goal: "y" }), /does not exist/);
});

test("an added item is validated the way the queue validates its own", (t) => {
  // The same builder create() uses, so a goal this queue would have refused at
  // the desk is refused here too.
  const h = fixture(t);
  const queue = h.store.create({ items: THREE });
  assert.throws(() => h.store.addItem(queue.id, { projectPath: "", goal: "no project" }));
  assert.throws(() => h.store.addItem(queue.id, { projectPath: "D:/x", goal: "" }));
});
