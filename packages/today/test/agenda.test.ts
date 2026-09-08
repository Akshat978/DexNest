import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgenda, localDate, weekdayOf,
  type AgendaRequest, type BlockInput, type EventInput, type NudgeInput
} from "../src/index.ts";

const DATE = "2026-09-08";
const NOW = "2026-09-08T08:00:00-06:00";

const req = (over: Partial<AgendaRequest> = {}): AgendaRequest => ({
  date: DATE,
  weekday: "tuesday",
  events: [],
  blocks: [],
  nudges: [],
  now: NOW,
  ...over
});

const event = (over: Partial<EventInput> = {}): EventInput => ({
  id: "e1", title: "Dentist", date: DATE, startTime: "14:30", endTime: "15:00",
  allDay: false, sourceModule: "calendar", ...over
});

const block = (over: Partial<BlockInput> = {}): BlockInput => ({
  id: "b1", day: "tuesday", startTime: "09:00", endTime: "10:30", title: "Deep work", ...over
});

const nudge = (over: Partial<NudgeInput> = {}): NudgeInput => ({
  id: "n1", title: "Renew passport", message: "Expires in a month",
  date: DATE, priority: "normal", status: "open", ...over
});

test("only today's things are in today", () => {
  const agenda = buildAgenda(req({
    events: [event(), event({ id: "e2", date: "2026-09-09", title: "Tomorrow" })],
    blocks: [block(), block({ id: "b2", day: "friday", title: "Friday only" })],
    nudges: [nudge(), nudge({ id: "n2", date: "2026-09-01", title: "Last week" })]
  }));

  // Deep work 09:00, Dentist 14:30, then the untimed nudge — which sorts last
  // because it has no time, not because it matters least.
  assert.deepEqual(agenda.items.map(i => i.title), ["Deep work", "Dentist", "Renew passport"]);
  assert.deepEqual(agenda.counts, { events: 1, blocks: 1, nudges: 1, needsAction: 1 });
});

test("all-day frames the day, untimed cannot claim a slot", () => {
  const agenda = buildAgenda(req({
    events: [
      event({ id: "e1", title: "Timed", startTime: "11:00" }),
      event({ id: "e2", title: "All day", allDay: true })
    ],
    nudges: [nudge({ id: "n1", title: "Whenever", time: null })]
  }));

  // All-day first; untimed last. Putting an untimed item at 00:00 would state
  // something the data does not say.
  assert.deepEqual(agenda.items.map(i => i.title), ["All day", "Timed", "Whenever"]);
});

test("an all-day event carries no time even if one was recorded", () => {
  const agenda = buildAgenda(req({ events: [event({ allDay: true, startTime: "09:00", endTime: "17:00" })] }));
  assert.equal(agenda.items[0]!.startTime, null);
  assert.equal(agenda.items[0]!.endTime, null);
});

test("yesterday's done mark does not carry into today", () => {
  // Otherwise a repeating weekly block would show as already finished on a
  // morning it has not been started.
  const agenda = buildAgenda(req({
    blocks: [block({ status: "done", statusDate: "2026-09-07" })]
  }));
  assert.equal(agenda.items[0]!.status, "planned");

  const same = buildAgenda(req({ blocks: [block({ status: "done", statusDate: DATE })] }));
  assert.equal(same.items[0]!.status, "done");
});

test("a snoozed nudge stays out until its snooze has passed", () => {
  const later = buildAgenda(req({ nudges: [nudge({ snoozeUntil: "2026-09-08T18:00:00-06:00" })] }));
  assert.equal(later.items.length, 0, "snoozed to this evening, so not now");

  const expired = buildAgenda(req({ nudges: [nudge({ snoozeUntil: "2026-09-08T07:00:00-06:00" })] }));
  assert.equal(expired.items.length, 1, "the snooze has run out");
});

test("finished nudges are not part of today", () => {
  for (const status of ["done", "completed", "dismissed"]) {
    assert.equal(buildAgenda(req({ nudges: [nudge({ status })] })).items.length, 0, status);
  }
});

test("only nudges need action", () => {
  const agenda = buildAgenda(req({ events: [event()], blocks: [block()], nudges: [nudge()] }));
  assert.deepEqual(
    agenda.items.filter(i => i.needsAction).map(i => i.kind),
    ["nudge"]
  );
});

test("a malformed time becomes no time rather than a wrong one", () => {
  for (const value of ["25:00", "9", "noon", "", "12:99", "abc"]) {
    const agenda = buildAgenda(req({ events: [event({ startTime: value })] }));
    assert.equal(agenda.items[0]!.startTime, null, `startTime: ${JSON.stringify(value)}`);
  }
  // And a valid one is normalised rather than passed through.
  assert.equal(buildAgenda(req({ events: [event({ startTime: "9:05" })] })).items[0]!.startTime, "09:05");
});

test("the model carries no provider vocabulary", () => {
  // The guard that keeps Google and Outlook from rewriting this shape. If a
  // field like htmlLink or organizer ever reaches an item, this fails.
  const agenda = buildAgenda(req({ events: [event()], blocks: [block()], nudges: [nudge()] }));
  const allowed = new Set([
    "id", "kind", "title", "startTime", "endTime", "allDay",
    "source", "detail", "needsAction", "status", "accent"
  ]);

  for (const item of agenda.items) {
    for (const key of Object.keys(item)) {
      assert.ok(allowed.has(key), `unexpected field on an agenda item: ${key}`);
    }
    assert.deepEqual(Object.keys(item.source).sort(), ["id", "label"]);
  }
});

test("a source other than the local calendar becomes a label, not a field", () => {
  const agenda = buildAgenda(req({ events: [event({ sourceModule: "journal" })] }));
  assert.deepEqual(agenda.items[0]!.source, { id: "dexnest.journal", label: "Journal" });
});

test("ids are namespaced so two sources cannot collide", () => {
  const agenda = buildAgenda(req({
    events: [event({ id: "same" })],
    blocks: [block({ id: "same" })],
    nudges: [nudge({ id: "same" })]
  }));
  assert.equal(new Set(agenda.items.map(i => i.id)).size, 3);
});

test("the same input twice gives the same order", () => {
  // A screen that reshuffles on refresh looks broken even when it is correct.
  const input = req({
    events: [event({ id: "a", title: "Beta", startTime: "10:00" }), event({ id: "b", title: "Alpha", startTime: "10:00" })],
    blocks: [block({ startTime: "10:00", title: "Gamma" })]
  });
  assert.deepEqual(
    buildAgenda(input).items.map(i => i.title),
    buildAgenda(input).items.map(i => i.title)
  );
});

test("localDate names the local day, not the UTC one", () => {
  // toISOString() would name yesterday for anyone west of Greenwich all
  // evening — the same trap quiet hours had.
  const evening = new Date(2026, 8, 8, 23, 30);
  assert.equal(localDate(evening), "2026-09-08");
  assert.equal(weekdayOf(evening), "tuesday");
});
