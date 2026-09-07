// Phase 6 — Deciding what to start next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueue, makeRecord, nextAction, progress } from "../src/index.js";

const NOW = "2026-09-07T01:00:00.000Z";
const AT = "2026-09-07T00:30:00.000Z";

function queueOf(...ids) {
  return buildQueue(ids.map((id) => ({ id, projectPath: `/${id}`, goal: "g" })));
}

test("a fresh queue starts the first item", () => {
  const queue = queueOf("a", "b", "c");
  assert.deepEqual(nextAction({ queue, records: [], now: NOW }), {
    kind: "start",
    itemId: "a",
  });
});

test("the lowest-ordinal PENDING item is chosen, skipping settled ones", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "SKIPPED", settledAt: AT }),
  ];
  assert.deepEqual(nextAction({ queue, records, now: NOW }), {
    kind: "start",
    itemId: "c",
  });
});

test("a failed earlier item does not block a later PENDING one", () => {
  const queue = queueOf("a", "b");
  const records = [makeRecord({ itemId: "a", status: "FAILED", settledAt: AT })];
  assert.deepEqual(nextAction({ queue, records, now: NOW }), {
    kind: "start",
    itemId: "b",
  });
});

test("selection follows ordinal, not the order records were supplied", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
  ];
  assert.deepEqual(nextAction({ queue, records, now: NOW }), {
    kind: "start",
    itemId: "c",
  });
});

test("nextAction does not mutate its argument", () => {
  const queue = queueOf("a", "b");
  const records = Object.freeze([
    Object.freeze(makeRecord({ itemId: "a", status: "DONE", settledAt: AT })),
  ]);
  const state = Object.freeze({ queue: Object.freeze(queue), records, now: NOW });
  assert.deepEqual(nextAction(state), { kind: "start", itemId: "b" });
});

test("nextAction refuses a state without a queue", () => {
  assert.throws(
    () => nextAction({ records: [], now: NOW }),
    /Decision state has no queue/,
  );
});

// Phase 7 — Nothing left to do.

test("an all-done queue stops with queue_complete", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "queue_complete");
  assert.match(action.detail, /settled/);
});

test("an all-skipped queue stops with queue_complete", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "SKIPPED", settledAt: AT }),
    makeRecord({ itemId: "b", status: "SKIPPED", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "queue_complete");
});

test("an empty queue stops with queue_complete and a readable detail", () => {
  const action = nextAction({ queue: [], records: [], now: NOW });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "queue_complete");
  assert.match(action.detail, /empty/);
});

test("a queue whose only unsettled item is RUNNING is not queue_complete", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "RUNNING", startedAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.notEqual(action.reason, "queue_complete");
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "b");
});

test("the detail sentence reports how many finished successfully", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "c", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.match(action.detail, /2 finished successfully/);
});

// Phase 8 — One at a time.

test("a RUNNING item makes nextAction busy, not start, with later PENDING items", () => {
  const queue = queueOf("a", "b", "c");
  const records = [makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "a");
});

test("busy names the in-flight item even when it is not first in the queue", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "RUNNING", startedAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "b");
});

test("start is never returned while an item is RUNNING, however many PENDING remain", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [makeRecord({ itemId: "b", status: "RUNNING", startedAt: AT })];
  const action = nextAction({ queue, records, now: NOW });
  assert.notEqual(action.kind, "start");
  assert.equal(action.kind, "busy");
});

// Phase 9 — The deadline, and where it is checked.

const DEADLINE = "2026-09-07T07:00:00.000Z";

test("no deadline means it never stops for one", () => {
  const queue = queueOf("a");
  const action = nextAction({ queue, records: [], budget: {}, now: DEADLINE });
  assert.equal(action.kind, "start");
});

test("before the deadline it starts the next item", () => {
  const queue = queueOf("a");
  const action = nextAction({
    queue,
    records: [],
    budget: { deadline: DEADLINE },
    now: "2026-09-07T06:59:59.000Z",
  });
  assert.equal(action.kind, "start");
});

test("at the deadline, between items, it stops with reason deadline", () => {
  const queue = queueOf("a");
  const action = nextAction({
    queue,
    records: [],
    budget: { deadline: DEADLINE },
    now: DEADLINE,
  });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "deadline");
});

test("past the deadline, between items, it stops", () => {
  const queue = queueOf("a", "b");
  const records = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const action = nextAction({
    queue,
    records,
    budget: { deadline: DEADLINE },
    now: "2026-09-07T08:00:00.000Z",
  });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "deadline");
});

test("past the deadline with an item in flight it reports busy, not stop", () => {
  const queue = queueOf("a", "b");
  const records = [makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })];
  const action = nextAction({
    queue,
    records,
    budget: { deadline: DEADLINE },
    now: "2026-09-07T08:00:00.000Z",
  });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "a");
});

test("an invalid deadline is refused with a message", () => {
  const queue = queueOf("a");
  assert.throws(
    () => nextAction({ queue, records: [], budget: { deadline: "soon" }, now: NOW }),
    /Budget deadline is not a valid ISO time/,
  );
});

// Phase 10 — One spend budget across the whole night.

test("no cap means spend never stops the queue", () => {
  const queue = queueOf("a");
  const action = nextAction({ queue, records: [], budget: {}, spentUsd: 999, now: NOW });
  assert.equal(action.kind, "start");
});

test("below the cap it keeps starting items", () => {
  const queue = queueOf("a");
  const action = nextAction({
    queue,
    records: [],
    budget: { maxCostUsd: 5 },
    spentUsd: 4.5,
    now: NOW,
  });
  assert.equal(action.kind, "start");
});

test("the shared cap stops the queue part-way once earlier items consumed it", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({
    queue,
    records,
    budget: { maxCostUsd: 5 },
    spentUsd: 5,
    now: NOW,
  });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "cost");
  assert.match(action.detail, /budget/);
});

test("spend past the cap also stops", () => {
  const queue = queueOf("a", "b");
  const records = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const action = nextAction({
    queue,
    records,
    budget: { maxCostUsd: 5 },
    spentUsd: 7.25,
    now: NOW,
  });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "cost");
});

test("the cost cap never interrupts a RUNNING item", () => {
  const queue = queueOf("a", "b");
  const records = [makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })];
  const action = nextAction({
    queue,
    records,
    budget: { maxCostUsd: 5 },
    spentUsd: 10,
    now: NOW,
  });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "a");
});

// Phase 14 — Unless everything is failing.

function at(minute) {
  const mm = String(minute).padStart(2, "0");
  return `2026-09-07T01:${mm}:00.000Z`;
}

test("no maxConsecutiveFailures means failures never stop the night", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: at(2) }),
    makeRecord({ itemId: "c", status: "FAILED", settledAt: at(3) }),
  ];
  const action = nextAction({ queue, records, budget: {}, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "d");
});

test("a run of failures reaching the limit stops with reason failing", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: at(2) }),
    makeRecord({ itemId: "c", status: "FAILED", settledAt: at(3) }),
  ];
  const action = nextAction({
    queue,
    records,
    budget: { maxConsecutiveFailures: 3 },
    now: NOW,
  });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "failing");
});

test("below the limit it keeps going", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: at(2) }),
  ];
  const action = nextAction({
    queue,
    records,
    budget: { maxConsecutiveFailures: 3 },
    now: NOW,
  });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "c");
});

test("one success between failures resets the streak", () => {
  const queue = queueOf("a", "b", "c", "d", "e");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: at(2) }),
    makeRecord({ itemId: "c", status: "FAILED", settledAt: at(3) }),
    makeRecord({ itemId: "d", status: "FAILED", settledAt: at(4) }),
  ];
  // Streak since the last DONE is 2, below the limit of 3.
  const action = nextAction({
    queue,
    records,
    budget: { maxConsecutiveFailures: 3 },
    now: NOW,
  });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "e");
});

test("the streak is counted in settle order, not array order", () => {
  const queue = queueOf("a", "b", "c", "d");
  // Supplied out of order; settledAt determines the sequence: fail, fail, done.
  const records = [
    makeRecord({ itemId: "c", status: "DONE", settledAt: at(3) }),
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: at(2) }),
  ];
  // The most recent settle is a DONE, so the streak is 0.
  const action = nextAction({
    queue,
    records,
    budget: { maxConsecutiveFailures: 2 },
    now: NOW,
  });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "d");
});

test("the failing bound never interrupts a RUNNING item", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: at(1) }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: at(2) }),
    makeRecord({ itemId: "c", status: "RUNNING", startedAt: at(3) }),
  ];
  const action = nextAction({
    queue,
    records,
    budget: { maxConsecutiveFailures: 2 },
    now: NOW,
  });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "c");
});

// Phase 13 — A failed project does not end the night.

test("a failed first item does not stop the queue; the second is started", () => {
  const queue = queueOf("a", "b", "c");
  const records = [makeRecord({ itemId: "a", status: "FAILED", settledAt: AT, reason: "build broke" })];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "b");
});

test("progress reports the failure while the night continues", () => {
  const queue = queueOf("a", "b", "c");
  const records = [makeRecord({ itemId: "a", status: "FAILED", settledAt: AT })];
  assert.deepEqual(progress(queue, records), {
    total: 3,
    done: 0,
    failed: 1,
    skipped: 0,
    remaining: 2,
    inFlight: 0,
  });
});

test("one broken repository does not cost the others: run continues past it", () => {
  const queue = queueOf("a", "b", "c", "d", "e", "f");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "c");
});

// Phase 12 — A ceiling on how many projects one night touches.

test("no maxItems means the queue length alone governs", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, budget: {}, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "c");
});

test("below maxItems it keeps starting", () => {
  const queue = queueOf("a", "b", "c");
  const records = [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })];
  const action = nextAction({ queue, records, budget: { maxItems: 3 }, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "b");
});

test("stops once maxItems have been started", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "c", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, budget: { maxItems: 3 }, now: NOW });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "max_items");
});

test("failures count against maxItems, not just completions", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "b", status: "FAILED", settledAt: AT }),
    makeRecord({ itemId: "c", status: "DONE", settledAt: AT }),
  ];
  const action = nextAction({ queue, records, budget: { maxItems: 3 }, now: NOW });
  assert.equal(action.kind, "stop");
  assert.equal(action.reason, "max_items");
});

test("skipped items do not count as started against maxItems", () => {
  const queue = queueOf("a", "b", "c", "d");
  const records = [
    makeRecord({ itemId: "a", status: "SKIPPED", settledAt: AT }),
    makeRecord({ itemId: "b", status: "SKIPPED", settledAt: AT }),
    makeRecord({ itemId: "c", status: "DONE", settledAt: AT }),
  ];
  // Only one item (c) was actually started, so a cap of 3 is not reached.
  const action = nextAction({ queue, records, budget: { maxItems: 3 }, now: NOW });
  assert.equal(action.kind, "start");
  assert.equal(action.itemId, "d");
});

test("maxItems never interrupts a RUNNING item", () => {
  const queue = queueOf("a", "b", "c");
  const records = [
    makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
    makeRecord({ itemId: "c", status: "RUNNING", startedAt: AT }),
  ];
  const action = nextAction({ queue, records, budget: { maxItems: 2 }, now: NOW });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "c");
});

// Phase 11 — No bound may interrupt work in flight.
//
// For every stop reason that exists, the same state must report `busy` while
// an item is RUNNING and `stop` once it settles. Each case is expressed as a
// pair that differs only in the running item's status, so a regression that
// lets a bound pre-empt a run flips exactly one assertion.

const PAST_DEADLINE = "2026-09-07T08:00:00.000Z";

const invariantCases = [
  {
    reason: "queue_complete",
    // The running item is the only unsettled one; settling it empties the queue.
    queue: () => queueOf("a"),
    budget: {},
    spentUsd: 0,
    now: NOW,
    runningId: "a",
    settledRecordsBefore: [],
  },
  {
    reason: "deadline",
    // A PENDING item remains after the running one settles, so the deadline —
    // not queue_complete — is the reason.
    queue: () => queueOf("a", "b"),
    budget: { deadline: DEADLINE },
    spentUsd: 0,
    now: PAST_DEADLINE,
    runningId: "a",
    settledRecordsBefore: [],
  },
  {
    reason: "cost",
    queue: () => queueOf("a", "b"),
    budget: { maxCostUsd: 5 },
    spentUsd: 7,
    now: NOW,
    runningId: "a",
    settledRecordsBefore: [],
  },
];

for (const testCase of invariantCases) {
  test(`while RUNNING, the ${testCase.reason} bound reports busy not stop`, () => {
    const queue = testCase.queue();
    const records = [
      ...testCase.settledRecordsBefore,
      makeRecord({ itemId: testCase.runningId, status: "RUNNING", startedAt: AT }),
    ];
    const action = nextAction({
      queue,
      records,
      budget: testCase.budget,
      spentUsd: testCase.spentUsd,
      now: testCase.now,
    });
    assert.equal(action.kind, "busy");
    assert.equal(action.itemId, testCase.runningId);
  });

  test(`once the item settles, the same state produces stop:${testCase.reason}`, () => {
    const queue = testCase.queue();
    const records = [
      ...testCase.settledRecordsBefore,
      makeRecord({ itemId: testCase.runningId, status: "DONE", settledAt: AT }),
    ];
    const action = nextAction({
      queue,
      records,
      budget: testCase.budget,
      spentUsd: testCase.spentUsd,
      now: testCase.now,
    });
    assert.equal(action.kind, "stop");
    assert.equal(action.reason, testCase.reason);
  });
}

// Phase 16 — The same state always decides the same thing.

/**
 * Recursively freeze an object graph so any accidental write throws in strict
 * mode (ES modules are strict). Arrays and plain objects are walked.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// A spread of state shapes, one per decision branch, each frozen and decided
// twice. If nextAction wrote to any input, the second call (or the freeze)
// would throw; if it were non-deterministic, the two results would differ.
const purityStates = [
  {
    name: "start",
    state: {
      queue: queueOf("a", "b"),
      records: [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })],
      budget: {},
      spentUsd: 0,
      now: NOW,
    },
  },
  {
    name: "busy",
    state: {
      queue: queueOf("a", "b"),
      records: [makeRecord({ itemId: "a", status: "RUNNING", startedAt: AT })],
      budget: {},
      spentUsd: 0,
      now: NOW,
    },
  },
  {
    name: "queue_complete",
    state: {
      queue: queueOf("a"),
      records: [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })],
      budget: {},
      spentUsd: 0,
      now: NOW,
    },
  },
  {
    name: "deadline",
    state: {
      queue: queueOf("a", "b"),
      records: [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })],
      budget: { deadline: "2026-09-07T07:00:00.000Z" },
      spentUsd: 0,
      now: "2026-09-07T08:00:00.000Z",
    },
  },
  {
    name: "cost",
    state: {
      queue: queueOf("a", "b"),
      records: [makeRecord({ itemId: "a", status: "DONE", settledAt: AT })],
      budget: { maxCostUsd: 5 },
      spentUsd: 6,
      now: NOW,
    },
  },
  {
    name: "max_items",
    state: {
      queue: queueOf("a", "b", "c"),
      records: [
        makeRecord({ itemId: "a", status: "DONE", settledAt: AT }),
        makeRecord({ itemId: "b", status: "DONE", settledAt: AT }),
      ],
      budget: { maxItems: 2 },
      spentUsd: 0,
      now: NOW,
    },
  },
];

for (const { name, state } of purityStates) {
  test(`nextAction is pure and deterministic on frozen ${name} state`, () => {
    const frozen = deepFreeze(state);
    const first = nextAction(frozen);
    const second = nextAction(frozen);
    assert.deepEqual(first, second);
    // The inputs must be untouched.
    assert.ok(Object.isFrozen(frozen.queue));
    assert.ok(Object.isFrozen(frozen.records));
  });
}

// Phase 17 — An item left RUNNING by a crash.

const HOUR_MS = 60 * 60 * 1000;

test("without a staleness threshold, a RUNNING item is always busy", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2020-01-01T00:00:00.000Z" }),
  ];
  const action = nextAction({ queue, records, now: NOW });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "a");
});

test("a fresh RUNNING item reports busy", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2026-09-07T00:45:00.000Z" }),
  ];
  const action = nextAction({
    queue,
    records,
    runningStaleAfterMs: HOUR_MS,
    now: NOW, // 01:00, 15 minutes after start — under the hour
  });
  assert.equal(action.kind, "busy");
  assert.equal(action.itemId, "a");
});

test("a stale RUNNING item reports reconcile, not busy", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2026-09-06T23:00:00.000Z" }),
  ];
  const action = nextAction({
    queue,
    records,
    runningStaleAfterMs: HOUR_MS,
    now: NOW, // 01:00, two hours after start — over the hour
  });
  assert.equal(action.kind, "reconcile");
  assert.equal(action.itemId, "a");
  assert.match(action.detail, /abandoned/);
});

test("reconcile never silently restarts or skips: the item is not started", () => {
  const queue = queueOf("a", "b");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2026-09-06T20:00:00.000Z" }),
  ];
  const action = nextAction({
    queue,
    records,
    runningStaleAfterMs: HOUR_MS,
    now: NOW,
  });
  assert.notEqual(action.kind, "start");
  assert.equal(action.kind, "reconcile");
});

test("exactly at the staleness threshold counts as stale", () => {
  const queue = queueOf("a");
  const records = [
    makeRecord({ itemId: "a", status: "RUNNING", startedAt: "2026-09-07T00:00:00.000Z" }),
  ];
  const action = nextAction({
    queue,
    records,
    runningStaleAfterMs: HOUR_MS,
    now: NOW, // exactly one hour later
  });
  assert.equal(action.kind, "reconcile");
});

test("a RUNNING record with no startedAt is treated as stale under a threshold", () => {
  const queue = queueOf("a");
  const records = [makeRecord({ itemId: "a", status: "RUNNING" })];
  const action = nextAction({
    queue,
    records,
    runningStaleAfterMs: HOUR_MS,
    now: NOW,
  });
  assert.equal(action.kind, "reconcile");
});

test("a negative staleness threshold is refused", () => {
  const queue = queueOf("a");
  const records = [makeRecord({ itemId: "a", status: "RUNNING", startedAt: NOW })];
  assert.throws(
    () => nextAction({ queue, records, runningStaleAfterMs: -1, now: NOW }),
    /runningStaleAfterMs is not a non-negative number/,
  );
});
