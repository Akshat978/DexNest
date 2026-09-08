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

import { AttentionStore, ATTENTION_REASON, DEFAULT_QUIET_HOURS, attentionStands, toLocalIso } from "../src/attention.ts";
import { DeviceStore } from "../src/devices.ts";
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

// --- pairing a phone --------------------------------------------------------
//
// The token never enters the runtime: the host hashes it and passes the hash.
// What is proved here is everything around that — that a code is single use
// and expiring, that pairing grants read and not control, and that control is
// only ever granted separately.

test("a pairing code is single use and expires", (t) => {
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  const opened = devices.openPairing("123456", 10);
  assert.equal(devices.openPairingCode()!.code, "123456");

  devices.completePairing({ code: "123456", tokenHash: "hash-a", label: "phone", pushToken: "push-a" });
  assert.throws(
    () => devices.completePairing({ code: "123456", tokenHash: "hash-b", label: "other", pushToken: "push-b" }),
    /already been used/
  );
  assert.equal(devices.openPairingCode(), null, "a used code is no longer on offer");
  assert.ok(Date.parse(opened.expiresAt) > Date.parse(NOW));
});

test("a code this machine never issued is refused", (t) => {
  const h = fixture(t);
  assert.throws(
    () => new DeviceStore(h.ports).completePairing({ code: "999999", tokenHash: "h", label: "phone" }),
    /not one this machine issued/
  );
});

test("pairing grants read and drop, never control", (t) => {
  // Seeing that a run is blocked is a far smaller thing to hand a phone than
  // being able to stop one, and bundling them would mean deciding both while
  // someone is fumbling with a pairing code.
  //
  // Drop is granted here because exchanging files is the reason most pairings
  // happen at all, and it writes into a folder the operator already treats as
  // an inbox. Control is the one that waits for a second, deliberate decision.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("111111", 10);
  const device = devices.completePairing({ code: "111111", tokenHash: "hash-a", label: "phone", pushToken: "push-a" });

  assert.deepEqual(device.capabilities, ["read", "drop"]);
  assert.equal(device.capabilities.includes("control"), false, "control is never granted by pairing alone");
  assert.equal(device.paired, true);
  assert.equal(devices.byTokenHash("hash-a")!.id, device.id);
  assert.equal(devices.byTokenHash("some-other-hash"), null);
});

test("control is granted separately, and can be taken back", (t) => {
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("222222", 10);
  const device = devices.completePairing({ code: "222222", tokenHash: "hash-b", label: "phone", pushToken: "push-b" });

  assert.deepEqual(devices.setCapabilities(device.id, ["control"])!.capabilities.sort(), ["control", "read"]);
  assert.deepEqual(devices.setCapabilities(device.id, [])!.capabilities, ["read"], "read survives; it is implied by pairing");
});

test("a device record never carries the thing that authenticates it", (t) => {
  // This record reaches the renderer. A value that authenticates has no
  // business being rendered, so only the fact of pairing crosses.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("333333", 10);
  const device = devices.completePairing({ code: "333333", tokenHash: "secret-hash", label: "phone", pushToken: "push-c" });

  assert.equal(JSON.stringify(device).includes("secret-hash"), false);
  assert.equal(device.paired, true, "only that it is paired");
});

test("unpairing revokes the token without forgetting the device", (t) => {
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("444444", 10);
  const device = devices.completePairing({ code: "444444", tokenHash: "hash-d", label: "phone", pushToken: "push-d" });
  devices.setCapabilities(device.id, ["control"]);

  const after = devices.unpair(device.id)!;
  assert.equal(after.paired, false);
  assert.deepEqual(after.capabilities, ["read"], "and control does not survive a re-pair by accident");
  assert.equal(devices.byTokenHash("hash-d"), null, "the old token authenticates nothing");
  assert.equal(devices.get(device.id)!.label, "phone", "what it was sent is still on record");
});

test("a push token can rotate without re-pairing", (t) => {
  // Android reissues these on its own. Making someone re-pair each time would
  // make the whole thing feel broken.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("555555", 10);
  const device = devices.completePairing({ code: "555555", tokenHash: "hash-e", label: "phone", pushToken: "push-old" });

  devices.setPushToken(device.id, "push-new");
  assert.equal(devices.get(device.id)!.pushToken, "push-new");
  assert.equal(devices.byTokenHash("hash-e")!.id, device.id, "identity is the paired token, not the address");
});

test("a pairing lasts until the operator ends it, and nothing else", (t) => {
  // The coupling this pins open. `status` says whether PUSH can reach a
  // device, and it goes DISABLED on its own when FCM rejects a rotated token.
  // If that also revoked authority, a phone would silently stop being able to
  // read or answer because its delivery address went stale — and re-pairing,
  // the apparent fix, would have nothing to do with the cause.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("666666", 10);
  const device = devices.completePairing({ code: "666666", tokenHash: "hash-f", label: "phone", pushToken: "push-f" });

  devices.markFailed(device.id, "UNREGISTERED: the push token is gone");
  assert.equal(devices.get(device.id)!.status, "DISABLED", "push knows it cannot reach it");
  assert.equal(devices.byTokenHash("hash-f")!.id, device.id, "but the phone can still read and answer");

  // And giving it a fresh address brings push back without re-pairing.
  devices.setPushToken(device.id, "push-new");
  assert.equal(devices.get(device.id)!.status, "ACTIVE");
});

test("drop can be revoked without unpairing, and control stays its own decision", (t) => {
  // The two grants have to move independently or the operator is forced to
  // choose between a phone that can do everything and one that can do nothing.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("777777", 10);
  const device = devices.completePairing({ code: "777777", tokenHash: "hash-g", label: "phone", pushToken: "push-g" });

  devices.setCapabilities(device.id, []);
  assert.deepEqual(devices.get(device.id)!.capabilities, ["read"], "drop is gone, the pairing is not");
  assert.equal(devices.byTokenHash("hash-g")!.id, device.id, "still paired, still able to read");

  devices.setCapabilities(device.id, ["control", "drop"]);
  assert.deepEqual(devices.get(device.id)!.capabilities.sort(), ["control", "drop", "read"]);
});

test("a device paired before Drop had a capability still gets one", (t) => {
  // The bug this pins: Drop became its own capability after devices had
  // already paired, so an existing phone held only "read". The Drop gate found
  // no "drop", fell through to the localhost-only rule, and told the operator
  // to enable LAN exposure — advice that would have widened their network
  // exposure to fix something that was never a network problem.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  devices.openPairing("424242", 10);
  const device = devices.completePairing({ code: "424242", tokenHash: "hash-old", label: "phone", pushToken: "push-old" });

  // Put the row back the way a pre-migration pairing looked.
  h.ports.db.prepare("UPDATE autopilot_devices SET capabilities='read' WHERE id=:id").run({ id: device.id });
  assert.equal(devices.get(device.id)!.capabilities.includes("drop"), false, "precondition: the old shape");

  h.ports.db.exec(`
    UPDATE autopilot_devices
       SET capabilities = capabilities || ',drop'
     WHERE token_hash IS NOT NULL
       AND capabilities NOT LIKE '%drop%';
  `);

  assert.deepEqual(devices.get(device.id)!.capabilities, ["read", "drop"]);
});

test("the backfill does not confer authority on a device that never paired", (t) => {
  // A row with no token is a push target, not a paired device. Granting it a
  // capability would be inventing authority nobody conferred.
  const h = fixture(t);
  const devices = new DeviceStore(h.ports);
  const pushOnly = devices.register({ label: "push only", pushToken: "push-x" });

  h.ports.db.exec(`
    UPDATE autopilot_devices
       SET capabilities = capabilities || ',drop'
     WHERE token_hash IS NOT NULL
       AND capabilities NOT LIKE '%drop%';
  `);

  assert.equal(devices.get(pushOnly.id)!.capabilities.includes("drop"), false);
});

test("a held question stops standing once the run moves on", () => {
  // The bug: attention items are derived from the last LOOP_HELD event, and
  // that event is never retracted. Stopping a run writes no second LOOP_HELD,
  // so "Run proposes it is done" went on being asked about runs the operator
  // had already stopped — and the one list meant to say "these need you"
  // filled with things that did not.
  for (const state of ["STOPPED", "COMPLETED", "FAILED"] as const) {
    assert.equal(attentionStands(state), false, state);
  }

  // Resumed is an answer too: carrying on is how you say "no, keep going".
  assert.equal(attentionStands("RUNNING"), false);
});

test("a run that is genuinely waiting still asks", () => {
  // The other half. Being wrong here means withholding something that matters,
  // so anything not demonstrably finished or running keeps its question.
  for (const state of ["PAUSED", "AWAITING_APPROVAL", "NEEDS_REVIEW", "PAUSE_REQUESTED"] as const) {
    assert.equal(attentionStands(state), true, state);
  }
});

// --- snoozing ---------------------------------------------------------------

test("a snoozed group leaves the decision until its time is up", (t) => {
  const h = fixture(t);
  const items = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  const key = items[0]!.groupKey;

  assert.equal(h.store.decide(items, { quietHours: NO_QUIET_WINDOW }).deliver.length, 1, "precondition: it would go out");

  h.store.snooze({ groupKey: key, question: items[0]!.title, until: "2026-09-07T13:00:00.000Z", runId: "run-1" });
  const during = h.store.decide(items, { quietHours: NO_QUIET_WINDOW });
  assert.equal(during.deliver.length + during.hold.length, 0, "while snoozed it is neither sent nor held — it is simply not asked");

  // Snoozing does not survive its own deadline.
  const later = fixture(t, "2026-09-07T13:00:01.000Z");
  later.store.snooze({ groupKey: key, question: items[0]!.title, until: "2026-09-07T13:00:00.000Z" });
  assert.equal(later.store.decide(later.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" }), { quietHours: NO_QUIET_WINDOW }).deliver.length, 1);
});

test("snoozing again replaces the deadline rather than stacking", (t) => {
  // "Snooze an hour" pressed twice means an hour from the second press.
  const h = fixture(t);
  h.store.snooze({ groupKey: "g", question: "q", until: "2026-09-07T14:00:00.000Z" });
  h.store.snooze({ groupKey: "g", question: "q", until: "2026-09-07T12:30:00.000Z" });
  assert.equal(h.store.snoozed("2026-09-07T12:45:00.000Z").size, 0, "the later, shorter snooze won");
});

test("a snooze does not silence a different question on the same run", (t) => {
  // The hazard this pins. A group key is one per run, so keyed on it alone a
  // "not now" to a completion proposal would also swallow a worker failure an
  // hour later — a different question the operator never heard. The question
  // is part of the key; only the one that was heard and put off stays quiet.
  const h = fixture(t);
  const proposed = h.store.itemsForRun({ runId: "run-1", reason: "plan_complete_proposed" });
  h.store.snooze({ groupKey: proposed[0]!.groupKey, question: proposed[0]!.title, until: "2026-09-07T20:00:00.000Z" });
  const failed = h.store.itemsForRun({ runId: "run-1", reason: "worker_failed" });
  assert.equal(h.store.decide(failed, { quietHours: NO_QUIET_WINDOW }).deliver.length, 1);
});
