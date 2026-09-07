// The durable half of deciding what deserves someone's attention.
//
// The judgement is proved in @dexnest/attention, against pure inputs, and every
// mutation I could invent against its suppression rules was caught by its own
// tests. What is proved HERE is the part that touches durable state and the
// part that translates: that every way a run can stop has a decided meaning,
// that a delivery is remembered so a cooldown survives a restart, and — the
// one with no equivalent anywhere else — that the clock reaches the engine in
// the form its quiet-hours rule actually needs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { AttentionStore, ATTENTION_REASON, DEFAULT_QUIET_HOURS, toLocalIso } from "../src/attention.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";
import { createRunSpec } from "../src/runSpec.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger } from "./helpers/harness.ts";
import { createPlatformPorts } from "./helpers/platform.ts";
import type { RuntimePorts } from "../src/ports.ts";

const NOW = "2026-09-07T12:00:00.000Z";

// Quiet hours are LOCAL wall-clock, so a test that relies on the default
// window would pass or fail depending on the machine's timezone — exactly
// the non-determinism the engine's own conventions forbid. Tests about
// something other than quiet hours pass a window that cannot be in effect.
const NO_QUIET_WINDOW = { start: "23:00", end: "23:01" } as const;

function fixture(t: { after(fn: () => void): void }, now = NOW) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-attention-"));
  const database = createNodeSqliteAdapter(resolve(root, "test.sqlite"));
  const ports: RuntimePorts = {
    db: database.db,
    platform: createPlatformPorts({}),
    clock: createTestClock(now),
    ids: createTestIds(1),
    logger: createTestLogger()
  };
  runAutopilotMigrations(ports.db, now);
  const runs = new AutopilotStore(ports);
  runs.createRun({ spec: { ...createRunSpec({ goal: "g" }, { id: "run-1", now }), id: "run-1" }, executorId: "test" });
  t.after(() => {
    database.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { ports, store: new AttentionStore(ports) };
}

// --- the clock, in the form the engine needs --------------------------------

test("the clock reaches the engine carrying its local offset", () => {
  // The trap this exists to close. Quiet hours read the wall-clock hour
  // straight out of the ISO string — that is what makes "23:00 to 08:00"
  // survive a daylight-saving change. DexNest's clock produces toISOString(),
  // which is always UTC "Z". Passed straight in, the window would silently run
  // on UTC: for anyone not on UTC, the wrong nine hours of the day.
  const local = toLocalIso(NOW);
  assert.equal(/Z$/.test(local), false, "a Z timestamp would put quiet hours on UTC");
  assert.match(local, /[+-]\d{2}:\d{2}$/, "it carries an offset");

  // And it still names the same instant.
  assert.equal(new Date(local).getTime(), new Date(NOW).getTime());
  // The hour it reports is the local one a person would read off a clock.
  assert.equal(Number(/T(\d{2}):/.exec(local)![1]), new Date(NOW).getHours());
});

test("an unreadable timestamp is refused rather than quietly becoming a wrong hour", () => {
  assert.throws(() => toLocalIso("not a time"), /valid timestamp/);
});

// --- what a stop means to a person ------------------------------------------

test("every way a loop can stop has a decided meaning", () => {
  // A reason with no mapping would silently produce no item, and a run would
  // finish or break with nobody told.
  const reasons = [
    "consultant_recommended", "primary_blocked", "completed", "verification_indeterminate",
    "turn_limit", "iteration_limit", "time_limit", "cost_limit", "no_progress",
    "consecutive_failures", "worker_uncertain", "worker_failed", "provider_limit",
    "plan_complete_proposed", "direction_needs_human", "paused", "stopped", "grant_closed"
  ] as const;
  for (const reason of reasons) {
    assert.ok(reason in ATTENTION_REASON, `no attention meaning for stop reason "${reason}"`);
  }
  assert.equal(Object.keys(ATTENTION_REASON).length, reasons.length, "a reason was added without deciding what it means");
});

test("a run a person paused themselves tells them nothing", (t) => {
  // Notifying someone about their own click is the kind of noise that makes
  // people stop reading notifications at all.
  const h = fixture(t);
  for (const reason of ["paused", "stopped", "grant_closed"] as const) {
    assert.equal(ATTENTION_REASON[reason], null, reason);
    assert.deepEqual(h.store.itemsForRun({ runId: "run-1", reason }), [], reason);
  }
});

test("the things that need a person are the things that ask for one", (t) => {
  const h = fixture(t);
  const proposed = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0]!.priority, "ACTION_REQUIRED");
  assert.ok(proposed[0]!.answers.length > 0, "and it offers the answers");

  assert.equal(h.store.itemsForRun({ runId: "run-1", reason: "worker_failed" })[0]!.priority, "ACTION_REQUIRED");
  assert.equal(h.store.itemsForRun({ runId: "run-1", reason: "completed" })[0]!.priority, "INFO");
  assert.equal(h.store.itemsForRun({ runId: "run-1", reason: "turn_limit" })[0]!.priority, "INFO");
  assert.equal(h.store.itemsForRun({ runId: "run-1", reason: "provider_limit" })[0]!.priority, "ATTENTION");
});

test("a run's detail reaches the person, not just its category", (t) => {
  const h = fixture(t);
  const items = h.store.itemsForRun({
    runId: "run-1", reason: "worker_failed",
    detail: "Turn 4 failed: the provider returned no output."
  });
  assert.ok(items[0]!.detail.includes("no output"), items[0]!.detail);
});

// --- remembering what was said ----------------------------------------------

test("a delivery is remembered, so a cooldown survives a restart", (t) => {
  const h = fixture(t);
  assert.deepEqual(h.store.deliveries(), []);

  h.store.recordDelivery({ groupKey: "run-1:info", priority: "INFO", runId: "run-1" });
  const after = h.store.deliveries();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.groupKey, "run-1:info");
  assert.equal(after[0]!.priority, "INFO");

  // A different process reading the same database sees it too — which is the
  // whole point of storing it rather than keeping it in memory.
  assert.equal(new AttentionStore(h.ports).deliveries().length, 1);
});

test("delivering is journalled against the run it was about", (t) => {
  const h = fixture(t);
  h.store.recordDelivery({ groupKey: "run-1:action", priority: "ACTION_REQUIRED", runId: "run-1" });
  const event = new AutopilotStore(h.ports).listEvents("run-1").find(entry => entry.type === "ATTENTION_DELIVERED");
  assert.ok(event, "who was told what, and when, is part of the record");
});

// --- deciding ---------------------------------------------------------------

test("deciding says what to send and what waits, and why each waits", (t) => {
  const h = fixture(t);
  const items = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  const decision = h.store.decide(items);

  assert.equal(decision.deliver.length, 1, "an action-required item goes out");
  assert.equal(decision.deliver[0]!.priority, "ACTION_REQUIRED");
  assert.equal(decision.hold.length, decision.reason.length, "nothing waits without a stated reason");
  assert.ok(h.store.summarise(decision).length > 0);
});

test("deciding records nothing, so a failed send has not claimed it arrived", (t) => {
  const h = fixture(t);
  h.store.decide(h.store.itemsForRun({ runId: "run-1", reason: "completed" }));
  assert.deepEqual(h.store.deliveries(), [], "deciding and delivering are separate acts");
});

test("what was already said is what holds the next one back", (t) => {
  // The store's real job: feeding the engine a memory it does not keep itself.
  const h = fixture(t);
  const items = h.store.itemsForRun({ runId: "run-1", reason: "completed" });

  const first = h.store.decide(items, { quietHours: NO_QUIET_WINDOW });
  assert.equal(first.deliver.length, 1, "nothing said yet");
  for (const group of first.deliver) {
    h.store.recordDelivery({ groupKey: group.groupKey, priority: group.priority });
  }
  const second = h.store.decide(items, { quietHours: NO_QUIET_WINDOW });
  assert.equal(second.deliver.length, 0, "it was just said");
  assert.equal(second.hold.length, 1);
  assert.match(second.reason[0]!.reason, /cooling_down/);
});

test("an action-required item is not silenced by a routine one just sent", (t) => {
  // The rule the whole engine is built around, checked through the store where
  // the delivery record is real rather than handed in by a test.
  const h = fixture(t);
  const routine = h.store.itemsForRun({ runId: "run-1", reason: "completed" });
  for (const group of h.store.decide(routine, { quietHours: NO_QUIET_WINDOW }).deliver) {
    h.store.recordDelivery({ groupKey: group.groupKey, priority: group.priority });
  }

  const urgent = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  assert.equal(h.store.decide(urgent, { quietHours: NO_QUIET_WINDOW }).deliver.length, 1, "it still gets through");
});

test("quiet hours default to something a person would choose", () => {
  assert.deepEqual(DEFAULT_QUIET_HOURS, { start: "23:00", end: "08:00" });
});

test("the converted clock is what quiet hours actually act on", (t) => {
  // End to end, and independent of the machine's timezone: build a window
  // around whatever local hour the store's clock converts to, and assert an
  // INFO item is held inside it and delivered outside. Before the conversion
  // this test would have compared against the UTC hour and been wrong by
  // however many hours the machine is offset.
  const h = fixture(t);
  const localHour = Number(/T(\d{2}):/.exec(toLocalIso(NOW))![1]);
  const pad = (value: number) => String((value + 24) % 24).padStart(2, "0");
  const around = { start: `${pad(localHour)}:00`, end: `${pad(localHour + 1)}:00` };
  const elsewhere = { start: `${pad(localHour + 2)}:00`, end: `${pad(localHour + 3)}:00` };

  const routine = h.store.itemsForRun({ runId: "run-1", reason: "completed" });
  assert.equal(h.store.decide(routine, { quietHours: around }).deliver.length, 0, "held inside the window");
  assert.equal(h.store.decide(routine, { quietHours: elsewhere }).deliver.length, 1, "delivered outside it");

  // And the rule that keeps quiet from becoming silent.
  const urgent = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  assert.equal(h.store.decide(urgent, { quietHours: around }).deliver.length, 1, "an answer is still asked for at 3am");
});

// --- older databases --------------------------------------------------------

test("a database from before the delivery log simply has no memory", (t) => {
  const h = fixture(t);
  h.ports.db.exec("DROP TABLE autopilot_attention_deliveries");

  assert.equal(h.store.available(), false);
  assert.deepEqual(h.store.deliveries(), []);
  h.store.recordDelivery({ groupKey: "g", priority: "INFO" });
  assert.deepEqual(h.store.deliveries(), [], "recording is a no-op rather than a crash");
  assert.equal(
    h.store.decide(h.store.itemsForRun({ runId: "run-1", reason: "completed" }), { quietHours: NO_QUIET_WINDOW }).deliver.length,
    1
  );
});
