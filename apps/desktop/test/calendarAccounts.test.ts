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

import { accountCanWrite, parseGrantedScopes } from "../src/main/calendarAccounts.ts";

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
