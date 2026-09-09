/**
 * Deciding what a timetable change should do.
 *
 * The cases that matter are the ones where the schedule is unremarkable and
 * the surrounding circumstances are not: a restart mid-block, a day rolling
 * over, two blocks touching at the same minute, a block deleted while it was
 * running. Each of those produces effects that fire when they should not, or
 * silently fail to fire, and none of it is visible by watching a normal day.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  activeBlockIds,
  hasEffects,
  minutesOf,
  resolveTransitions,
  type EffectBlock
} from "../src/main/blockEffects.ts";

const block = (over: Partial<EffectBlock> = {}): EffectBlock => ({
  id: "b1",
  day: "monday",
  startTime: "09:00",
  endTime: "11:00",
  title: "Focus",
  effects: [
    { id: "e1", when: "enter", actionId: "system.performance.set_enabled", params: { enabled: true } },
    { id: "e2", when: "exit", actionId: "system.performance.set_enabled", params: { enabled: false } }
  ],
  ...over
});

// --- when a block is running --------------------------------------------------

test("a block runs from its start up to but not including its end", () => {
  const blocks = [block()];
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("09:00")!), ["b1"]);
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("10:59")!), ["b1"]);
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("11:00")!), []);
});

test("touching blocks do not overlap at the shared minute", () => {
  // Otherwise the first block's exit and the second's enter both apply at
  // 11:00 in an order nothing decides.
  const blocks = [block(), block({ id: "b2", startTime: "11:00", endTime: "12:00" })];
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("11:00")!), ["b2"]);
});

test("a block on another day is not running", () => {
  assert.deepEqual(activeBlockIds([block()], "tuesday", minutesOf("10:00")!), []);
});

test("a block that ends before it starts is ignored, not wrapped past midnight", () => {
  // Nothing else in the timetable wraps, and a block quietly running until the
  // next morning would be a surprising way to discover that this one does.
  const blocks = [block({ startTime: "23:00", endTime: "01:00" })];
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("23:30")!), []);
  assert.deepEqual(activeBlockIds(blocks, "monday", minutesOf("00:30")!), []);
});

test("a malformed time makes a block inert rather than throwing", () => {
  assert.deepEqual(activeBlockIds([block({ startTime: "9am" })], "monday", 600), []);
  assert.equal(minutesOf("24:00"), null);
  assert.equal(minutesOf("10:60"), null);
  assert.equal(minutesOf(""), null);
});

// --- what to run --------------------------------------------------------------

test("entering a block runs its enter effects", () => {
  const planned = resolveTransitions(
    { day: "monday", activeIds: [] },
    { day: "monday", activeIds: ["b1"] },
    [block()]
  );
  assert.equal(planned.length, 1);
  assert.equal(planned[0]!.when, "enter");
  assert.deepEqual(planned[0]!.params, { enabled: true });
});

test("leaving a block runs its exit effects", () => {
  const planned = resolveTransitions(
    { day: "monday", activeIds: ["b1"] },
    { day: "monday", activeIds: [] },
    [block()]
  );
  assert.equal(planned.length, 1);
  assert.equal(planned[0]!.when, "exit");
});

test("nothing fires on the first observation", () => {
  // The restart case. Opening DexNest at 14:30 inside a block that began at
  // 14:00 is not an entry, and treating it as one would re-apply the block's
  // effects every time the app is reopened - resetting lights someone had
  // since changed by hand.
  assert.deepEqual(resolveTransitions(null, { day: "monday", activeIds: ["b1"] }, [block()]), []);
});

test("a block still running fires nothing", () => {
  // The timer ticks far more often than blocks change, so this is the ordinary
  // case and firing here would mean applying effects every minute.
  assert.deepEqual(
    resolveTransitions({ day: "monday", activeIds: ["b1"] }, { day: "monday", activeIds: ["b1"] }, [block()]),
    []
  );
});

test("exits run before entries", () => {
  // Leaving a block that dimmed the lights and entering one that brightens
  // them has an obvious intended result, and the other order gives the
  // opposite one.
  const blocks = [block(), block({ id: "b2", title: "Study", startTime: "11:00", endTime: "12:00" })];
  const planned = resolveTransitions(
    { day: "monday", activeIds: ["b1"] },
    { day: "monday", activeIds: ["b2"] },
    blocks
  );
  assert.equal(planned[0]!.when, "exit");
  assert.equal(planned[0]!.blockId, "b1");
  assert.equal(planned[1]!.when, "enter");
  assert.equal(planned[1]!.blockId, "b2");
});

test("a block deleted while running exits quietly", () => {
  // Its id is in the previous moment and there is no block behind it. There is
  // nothing to run and nothing to report: it is gone because that was asked for.
  assert.deepEqual(
    resolveTransitions({ day: "monday", activeIds: ["gone"] }, { day: "monday", activeIds: [] }, [block()]),
    []
  );
});

test("a day rollover exits yesterday's block and enters today's", () => {
  const blocks = [block(), block({ id: "b2", day: "tuesday", title: "Standup" })];
  const planned = resolveTransitions(
    { day: "monday", activeIds: ["b1"] },
    { day: "tuesday", activeIds: ["b2"] },
    blocks
  );
  assert.deepEqual(planned.map(item => `${item.when}:${item.blockId}`), ["exit:b1", "enter:b2"]);
});

test("overlapping blocks each contribute their own effects", () => {
  const blocks = [
    block({ id: "b1", effects: [{ id: "e1", when: "enter", actionId: "a.one" }] }),
    block({ id: "b2", effects: [{ id: "e2", when: "enter", actionId: "a.two" }] })
  ];
  const planned = resolveTransitions(
    { day: "monday", activeIds: [] },
    { day: "monday", activeIds: ["b1", "b2"] },
    blocks
  );
  assert.deepEqual(planned.map(item => item.actionId), ["a.one", "a.two"]);
});

test("an effect with no action is skipped rather than run as an empty id", () => {
  const blocks = [block({ effects: [{ id: "e1", when: "enter", actionId: "" }] })];
  assert.deepEqual(resolveTransitions({ day: "monday", activeIds: [] }, { day: "monday", activeIds: ["b1"] }, blocks), []);
});

test("planned params are copied, not shared with the stored block", () => {
  // A runner that adds confirmedDangerous to what it was handed must not be
  // writing into the saved timetable.
  const source = block();
  const planned = resolveTransitions({ day: "monday", activeIds: [] }, { day: "monday", activeIds: ["b1"] }, [source]);
  planned[0]!.params.enabled = "tampered";
  assert.equal(source.effects![0]!.params!.enabled, true);
});

test("a block with no usable effect does not claim to act", () => {
  assert.equal(hasEffects(block({ effects: [] })), false);
  assert.equal(hasEffects(block({ effects: undefined })), false);
  assert.equal(hasEffects(block({ effects: [{ id: "e", when: "enter", actionId: "" }] })), false);
  assert.equal(hasEffects(block()), true);
});
