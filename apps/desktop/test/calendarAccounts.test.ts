/**
 * Whether DexNest may write to a connected calendar.
 *
 * The interesting cases are all disagreements between what the current build
 * asks for and what a stored account was actually granted. Those two agree
 * only for an account connected since the request last changed, and every bug
 * this predicate can have lives in the gap between them.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { accountCanWrite, googleEventBody, parseGrantedScopes } from "../src/main/calendarAccounts.ts";

const google = (grantedScopes?: string[]) => ({ provider: "google" as const, grantedScopes });

test("a Google account granted calendar.events can be written to", () => {
  assert.equal(accountCanWrite(google(["https://www.googleapis.com/auth/calendar.events", "openid"])), true);
});

test("the broader calendar scope also counts", () => {
  assert.equal(accountCanWrite(google(["https://www.googleapis.com/auth/calendar"])), true);
});

test("a read-only grant cannot be written to", () => {
  assert.equal(accountCanWrite(google(["https://www.googleapis.com/auth/calendar.readonly", "email"])), false);
});

test("an account recorded before scopes were stored is treated as read-only", () => {
  // The case that actually exists on this machine right now: connected under
  // the old read-only request, so the field is simply absent. Guessing from
  // what the build currently asks for would offer an Edit that cannot save.
  assert.equal(accountCanWrite(google(undefined)), false);
});

test("Outlook is never writable, whatever it granted", () => {
  // No write path exists for Graph. A granted scope would not conjure one, and
  // reporting otherwise would put an Edit button on an event nothing can save.
  assert.equal(accountCanWrite({ provider: "microsoft", grantedScopes: ["https://graph.microsoft.com/Calendars.ReadWrite"] }), false);
});

test("a missing scope in a token response is silence, not a revocation", () => {
  // Refreshes may omit `scope` entirely. Reading that as an empty grant would
  // strip write access from a working account on its next refresh.
  assert.equal(parseGrantedScopes(undefined), null);
  assert.equal(parseGrantedScopes(null), null);
  assert.equal(parseGrantedScopes(""), null);
  assert.equal(parseGrantedScopes("   "), null);
});

test("a reported scope string is split on whitespace", () => {
  assert.deepEqual(
    parseGrantedScopes("https://www.googleapis.com/auth/calendar.events openid email"),
    ["https://www.googleapis.com/auth/calendar.events", "openid", "email"]
  );
});


// --- what gets sent to Google -------------------------------------------------
//
// DexNest stores a local date and a wall-clock time with no zone. Google wants
// either an all-day date pair or a pair of instants. Every case below is one
// where a plausible-looking mapping is rejected outright or lands on the wrong
// day, and neither is visible without an account to try it against.

const TZ = "America/Regina";

test("an all-day event ends on the following day", () => {
  // Google's all-day end is exclusive. Sending the same date for both is
  // rejected, so a one-day event has to say it ends tomorrow.
  const body = googleEventBody({ title: "Holiday", date: "2026-09-09", allDay: true }, TZ);
  assert.deepEqual(body.start, { date: "2026-09-09" });
  assert.deepEqual(body.end, { date: "2026-09-10" });
});

test("an all-day event at a month boundary rolls the month", () => {
  const body = googleEventBody({ title: "Month end", date: "2026-09-30", allDay: true }, TZ);
  assert.deepEqual(body.end, { date: "2026-10-01" });
});

test("a timed event sends wall clock plus a zone, not a guessed offset", () => {
  // Resolving the offset here would be an hour wrong twice a year. Google can
  // do it correctly given the zone.
  const body = googleEventBody({ title: "Call", date: "2026-09-09", startTime: "14:00", endTime: "15:00", allDay: false }, TZ);
  assert.deepEqual(body.start, { dateTime: "2026-09-09T14:00:00", timeZone: TZ });
  assert.deepEqual(body.end, { dateTime: "2026-09-09T15:00:00", timeZone: TZ });
});

test("an event with no end time gets an hour", () => {
  // A point in time to DexNest, an error to Google.
  const body = googleEventBody({ title: "Reminder", date: "2026-09-09", startTime: "09:30", allDay: false }, TZ);
  assert.deepEqual(body.end, { dateTime: "2026-09-09T10:30:00", timeZone: TZ });
});

test("an end at or before the start is corrected rather than sent and refused", () => {
  const body = googleEventBody({ title: "Odd", date: "2026-09-09", startTime: "16:00", endTime: "16:00", allDay: false }, TZ);
  assert.deepEqual(body.end, { dateTime: "2026-09-09T17:00:00", timeZone: TZ });
});

test("an event near midnight is clamped to its own day, not rolled into the next", () => {
  // A DexNest event has no end date, so an end past midnight cannot be
  // expressed. 23:59 on the right day is a smaller lie than 00:30 on the wrong
  // one, which would move the event a whole day in the grid.
  const body = googleEventBody({ title: "Late", date: "2026-09-09", startTime: "23:30", allDay: false }, TZ);
  assert.deepEqual(body.end, { dateTime: "2026-09-09T23:59:00", timeZone: TZ });
});

test("notes go to location, where the reader expects to find them", () => {
  // fetchEvents reads notes back out of location. Sending them anywhere else
  // would lose them on the very next sync.
  const body = googleEventBody({ title: "Dentist", date: "2026-09-09", allDay: true, notes: "Room 4" }, TZ);
  assert.equal(body.location, "Room 4");
});

test("an event with no notes sends an empty location, not undefined", () => {
  const body = googleEventBody({ title: "Plain", date: "2026-09-09", allDay: true }, TZ);
  assert.equal(body.location, "");
});
