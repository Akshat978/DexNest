/**
 * Two calendars that both changed.
 *
 * One outcome here is deleting something the operator wrote, so every guard on
 * that has a test naming the situation it protects against. None of these can
 * be exercised by using the feature: they need a truncated page, a clock skew,
 * or an event edited in two places within fifteen minutes.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  adopt,
  differs,
  reconcile,
  type LocalEvent,
  type RemoteEvent
} from "../src/main/calendarReconcile.ts";

const ACCOUNT = "acc-1";

const local = (over: Partial<LocalEvent> = {}): LocalEvent => ({
  id: "e1",
  title: "Dentist",
  date: "2026-09-20",
  startTime: "14:00",
  endTime: "15:00",
  allDay: false,
  notes: null,
  sourceModule: "calendar",
  remoteId: "g1",
  remoteAccountId: ACCOUNT,
  remoteSyncedAt: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:00:00.000Z",
  ...over
});

const remote = (over: Partial<RemoteEvent> = {}): RemoteEvent => ({
  remoteId: "g1",
  accountId: ACCOUNT,
  title: "Dentist",
  date: "2026-09-20",
  startTime: "14:00",
  endTime: "15:00",
  allDay: false,
  notes: null,
  ...over
});

const run = (over: Partial<Parameters<typeof reconcile>[0]> = {}) => reconcile({
  local: [local()],
  remote: [remote()],
  accountId: ACCOUNT,
  windowFrom: "2026-09-09",
  windowTo: "2026-11-08",
  complete: true,
  ...over
});

// --- the echo -----------------------------------------------------------------

test("an event we pushed is not shown a second time when it comes back", () => {
  // The whole reason A4 exists: without this every event created in DexNest
  // becomes a duplicate fifteen minutes later.
  assert.deepEqual(run().echoes, ["g1"]);
});

test("a provider event with no local original is not an echo", () => {
  const result = run({ remote: [remote({ remoteId: "g2" })], local: [] });
  assert.deepEqual(result.echoes, []);
});

test("a local event that was never pushed hides nothing", () => {
  const result = run({ local: [local({ remoteId: null, remoteAccountId: null })] });
  assert.deepEqual(result.echoes, []);
});

test("an event linked to a different account is left to that account's sync", () => {
  const result = run({ local: [local({ remoteAccountId: "acc-2" })] });
  assert.deepEqual(result.echoes, []);
  assert.deepEqual(result.deletions, []);
});

// --- deletion, the dangerous half ---------------------------------------------

test("an event deleted on the phone is deleted here", () => {
  const result = run({ remote: [] });
  assert.deepEqual(result.deletions.map(event => event.id), ["e1"]);
});

test("an event DexNest never shared is never deleted by a sync", () => {
  // Typed into DexNest, never pushed. Absent from Google because it was never
  // there - deleting it would destroy something on the strength of a fact
  // about a calendar it was never on.
  const result = run({ local: [local({ remoteId: null, remoteAccountId: null })], remote: [] });
  assert.deepEqual(result.deletions, []);
});

test("a truncated fetch deletes nothing at all", () => {
  // A provider that returned only the first page looks exactly like one whose
  // later events were deleted. This is the case that would quietly remove a
  // month of events from a busy calendar.
  const result = run({ remote: [], complete: false });
  assert.deepEqual(result.deletions, []);
  assert.match(result.heldBack ?? "", /not treated as deleted/);
});

test("an event outside the fetched window is not treated as deleted", () => {
  // Next year's dentist appointment is absent for a reason that has nothing to
  // do with anybody deleting it.
  const result = run({ local: [local({ date: "2027-03-01" })], remote: [] });
  assert.deepEqual(result.deletions, []);
});

test("an event on the last day of the window still counts as inside it", () => {
  const result = run({ local: [local({ date: "2026-11-08" })], remote: [] });
  assert.deepEqual(result.deletions.map(event => event.id), ["e1"]);
});

test("a provider-owned event is not deleted by its own sync", () => {
  // It came from that side. There is no local original, and treating it as one
  // would have the sync fighting itself.
  const result = run({ local: [local({ sourceModule: "google" })], remote: [] });
  assert.deepEqual(result.deletions, []);
});

// --- both sides changed -------------------------------------------------------

test("a change made on the phone is adopted here", () => {
  const result = run({ remote: [remote({ title: "Dentist - moved", startTime: "16:00" })] });
  assert.equal(result.adoptions.length, 1);
  assert.equal(result.adoptions[0]!.from.title, "Dentist - moved");
});

test("a local edit newer than the last push wins", () => {
  // DexNest already holds the newer version and will push it again. Adopting
  // the provider's copy here would silently undo what was just typed.
  const result = run({
    local: [local({ updatedAt: "2026-09-09T12:00:00.000Z", remoteSyncedAt: "2026-09-09T10:00:00.000Z" })],
    remote: [remote({ title: "Stale name from Google" })]
  });
  assert.deepEqual(result.adoptions, []);
});

test("an unchanged event is neither adopted nor deleted", () => {
  const result = run();
  assert.deepEqual(result.adoptions, []);
  assert.deepEqual(result.deletions, []);
});

test("equal timestamps go to the provider", () => {
  // remoteSyncedAt is written at the moment of a successful push, so an equal
  // updatedAt means nothing was edited locally afterwards.
  const result = run({
    local: [local({ updatedAt: "2026-09-09T10:00:00.000Z", remoteSyncedAt: "2026-09-09T10:00:00.000Z" })],
    remote: [remote({ title: "Changed on the phone" })]
  });
  assert.equal(result.adoptions.length, 1);
});

test("adoptions still happen when deletions are held back", () => {
  // A truncated page is a reason not to delete. It is not a reason to ignore a
  // change to an event that did arrive.
  const result = run({ remote: [remote({ title: "Renamed" })], complete: false });
  assert.equal(result.adoptions.length, 1);
  assert.deepEqual(result.deletions, []);
});

// --- what counts as a difference ----------------------------------------------

test("null and absent notes are the same thing", () => {
  // Otherwise every event without notes reports a difference for ever and is
  // rewritten on every sync.
  assert.equal(differs(local({ notes: null }), remote({ notes: null })), false);
  assert.equal(differs(local({ notes: undefined }), remote({ notes: null })), false);
});

test("an all-day event and a timed one differ", () => {
  assert.equal(differs(local({ allDay: false }), remote({ allDay: true })), true);
});

// --- adopting -----------------------------------------------------------------

test("adopting moves the sync stamp forward", () => {
  // Without this the adopted values look like a local edit newer than the last
  // push on the very next sync, and DexNest pushes them straight back - a loop
  // that never settles.
  const adopted = adopt(local(), remote({ title: "New" }), "2026-09-09T13:00:00.000Z");
  assert.equal(adopted.remoteSyncedAt, "2026-09-09T13:00:00.000Z");
  assert.equal(adopted.updatedAt, "2026-09-09T13:00:00.000Z");
  assert.equal(differs(adopted, remote({ title: "New" })), false);
});

test("adopting keeps the local identity and the link", () => {
  const adopted = adopt(local(), remote({ title: "New" }), "2026-09-09T13:00:00.000Z");
  assert.equal(adopted.id, "e1");
  assert.equal(adopted.remoteId, "g1");
  assert.equal(adopted.remoteAccountId, ACCOUNT);
});
