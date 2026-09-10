/**
 * Placing a day on a grid.
 *
 * Overlap is the whole difficulty. Getting it wrong draws events on top of one
 * another, and a hidden event reads as a missing appointment rather than as a
 * layout bug - so it is the kind of mistake that gets noticed by missing a
 * meeting.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  dragToSpan,
  layoutDay,
  MIN_EVENT_MINUTES,
  minutesAt,
  spanOf,
  timeOf,
  type TimedEvent
} from "../src/renderer/lib/dayLayout.ts";

const event = (id: string, startTime: string | null, endTime: string | null = null, allDay = false): TimedEvent =>
  ({ id, startTime, endTime, allDay });

const DAY = 24 * 60;
const at = (time: string) => {
  const [h = "0", m = "0"] = time.split(":");
  return (Number(h) * 60 + Number(m)) / DAY;
};

// --- how long an event is -----------------------------------------------------

test("an event with no end gets an hour", () => {
  // Matching what is sent to Google, so the grid and the provider agree.
  assert.deepEqual(spanOf(event("a", "09:00")), { start: 540, end: 600 });
});

test("an end at or before the start is treated as missing", () => {
  // Otherwise it draws as a zero-height sliver that cannot be clicked.
  assert.deepEqual(spanOf(event("a", "09:00", "09:00")), { start: 540, end: 600 });
  assert.deepEqual(spanOf(event("a", "09:00", "08:00")), { start: 540, end: 600 });
});

test("an event without a start time has no place on a time axis", () => {
  assert.equal(spanOf(event("a", null)), null);
});

// --- overlap ------------------------------------------------------------------

test("events that do not overlap each take the full width", () => {
  const placed = layoutDay([event("a", "09:00", "10:00"), event("b", "11:00", "12:00")]);
  assert.deepEqual(placed.map(item => item.width), [1, 1]);
  assert.deepEqual(placed.map(item => item.left), [0, 0]);
});

test("two overlapping events split the width", () => {
  const placed = layoutDay([event("a", "09:00", "10:00"), event("b", "09:30", "10:30")]);
  assert.deepEqual(placed.map(item => item.width), [0.5, 0.5]);
  assert.deepEqual(placed.map(item => item.left).sort(), [0, 0.5]);
});

test("events that only touch share a column rather than splitting", () => {
  // One ending at 10:00 and one starting at 10:00 do not overlap, and drawing
  // them at half width would waste half the grid on a day of back-to-back
  // meetings.
  const placed = layoutDay([event("a", "09:00", "10:00"), event("b", "10:00", "11:00")]);
  assert.deepEqual(placed.map(item => item.width), [1, 1]);
});

test("a busy hour does not narrow the rest of the day", () => {
  // The share is computed per cluster of overlapping events, not for the day
  // as a whole.
  const placed = layoutDay([
    event("a", "09:00", "10:00"),
    event("b", "09:00", "10:00"),
    event("c", "09:00", "10:00"),
    event("afternoon", "15:00", "16:00")
  ]);
  assert.equal(placed.find(item => item.event.id === "afternoon")!.width, 1);
  assert.equal(placed.find(item => item.event.id === "a")!.width, 1 / 3);
});

test("a chain of overlaps is treated as one cluster", () => {
  // A 9-11, B 9:30-10, C 10:30-11:30: B ends before C starts, but all three
  // are bound together by A. Comparing only against the previous event's end
  // would split them and overlap C onto A.
  const placed = layoutDay([
    event("a", "09:00", "11:00"),
    event("b", "09:30", "10:00"),
    event("c", "10:30", "11:30")
  ]);
  const byId = new Map(placed.map(item => [item.event.id, item]));
  assert.equal(byId.get("a")!.left, 0);
  assert.notEqual(byId.get("b")!.left, byId.get("a")!.left);
  // C can reuse B's column, since B has finished by the time C starts.
  assert.equal(byId.get("c")!.left, byId.get("b")!.left);
});

test("the longer event of two starting together takes the left column", () => {
  // A containing block reads as the thing the shorter events sit inside.
  const placed = layoutDay([event("short", "09:00", "09:30"), event("long", "09:00", "11:00")]);
  assert.equal(placed.find(item => item.event.id === "long")!.left, 0);
});

// --- geometry -----------------------------------------------------------------

test("an event is positioned by its start", () => {
  const placed = layoutDay([event("a", "06:00", "07:00")]);
  assert.equal(placed[0]!.top, at("06:00"));
  assert.equal(placed[0]!.height, 60 / DAY);
});

test("a very short event is drawn tall enough to read", () => {
  // A fifteen-minute standup at its true height is a line too thin to hit.
  const placed = layoutDay([event("a", "09:00", "09:05")]);
  assert.equal(placed[0]!.height, MIN_EVENT_MINUTES / DAY);
});

test("an event late at night does not extend past the end of the day", () => {
  const placed = layoutDay([event("a", "23:50", "23:55")]);
  assert.ok(placed[0]!.top + placed[0]!.height <= 1);
});

test("all-day events are not placed on the time axis", () => {
  // They have no position on it, and stretching one over the column would
  // claim it fills the day.
  assert.deepEqual(layoutDay([event("a", null, null, true)]), []);
});

// --- pointing at the grid -----------------------------------------------------

test("a pointer position snaps to a quarter hour", () => {
  assert.equal(minutesAt(at("09:07")), 540);
  assert.equal(minutesAt(at("09:08")), 555);
});

test("a drag released at the very bottom does not produce 24:00", () => {
  // Not a time DexNest can store.
  assert.equal(timeOf(minutesAt(1)), "23:45");
});

test("a pointer above the grid is clamped to midnight", () => {
  assert.equal(minutesAt(-0.5), 0);
});

test("dragging upward makes the same event as dragging down", () => {
  const down = dragToSpan(at("09:00"), at("10:00"));
  const up = dragToSpan(at("10:00"), at("09:00"));
  assert.deepEqual(up, down);
  assert.deepEqual(down, { startTime: "09:00", endTime: "10:00" });
});

test("a click that barely moves still makes an event of usable length", () => {
  // Otherwise clicking an empty slot creates something with no duration.
  const span = dragToSpan(at("09:00"), at("09:00"));
  assert.equal(span.startTime, "09:00");
  assert.equal(span.endTime, "09:30");
});

test("a drag near midnight is clamped rather than wrapping into the next day", () => {
  const span = dragToSpan(at("23:30"), 1);
  assert.equal(span.startTime, "23:30");
  assert.ok(span.endTime > span.startTime);
  assert.ok(span.endTime <= "23:59");
});
