import assert from "node:assert/strict";
import test from "node:test";

import { canPhoneRun, phoneActions, phoneExposureOf } from "../src/phoneExposure.ts";
import { seededActions } from "../src/index.ts";

const action = (over: Record<string, unknown> = {}) =>
  ({ id: "test.action", enabled: true, ...over }) as Parameters<typeof canPhoneRun>[0];

test("an action that has not opted in is refused", () => {
  const verdict = canPhoneRun(action(), ["read", "control", "drop"]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "not_exposed");
});

test("holding every capability does not substitute for opting in", () => {
  // The failure this guards against is a device being granted control and that
  // silently becoming a key to the whole registry.
  const verdict = canPhoneRun(action({ phone: undefined }), ["read", "control", "drop"]);
  assert.equal(verdict.ok, false);
});

test("a malformed exposure is treated as undeclared, not as close enough", () => {
  for (const value of ["readonly", "READ", true, 1, null, "", "write"]) {
    assert.equal(phoneExposureOf(action({ phone: value })), null, `phone: ${JSON.stringify(value)}`);
    assert.equal(canPhoneRun(action({ phone: value }), ["read", "control"]).ok, false);
  }
});

test("a read action runs for any paired device", () => {
  assert.equal(canPhoneRun(action({ phone: "read" }), ["read"]).ok, true);
});

test("a control action needs the control capability", () => {
  const refused = canPhoneRun(action({ phone: "control" }), ["read", "drop"]);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.reason, "needs_control");

  assert.equal(canPhoneRun(action({ phone: "control" }), ["read", "control"]).ok, true);
});

test("drop does not stand in for control", () => {
  // These are separate grants on purpose; a phone that may receive a photo
  // must not thereby be able to act on the desktop.
  assert.equal(canPhoneRun(action({ phone: "control" }), ["read", "drop"]).ok, false);
});

test("a disabled action is refused even when exposed", () => {
  const verdict = canPhoneRun(action({ phone: "read", enabled: false }), ["read"]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "disabled");
});

test("a refusal names no detail about the action it refused", () => {
  // Otherwise the error messages become a way to enumerate the registry from
  // an unpaired-but-reachable position.
  const verdict = canPhoneRun(action({ id: "vault.secure.copy_username" }), ["read"]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.message.includes("vault"), false);
});

test("the real registry exposes almost nothing, and nothing sensitive", () => {
  // The guard that matters. If a future action arrives carrying `phone`, this
  // fails and someone has to justify it in a review rather than in a diff
  // nobody read.
  const all = seededActions;
  const exposed = phoneActions(all, ["read", "control", "drop"]).map(a => a.id).sort();

  assert.ok(all.length > 100, "sanity: the registry is loaded");
  assert.deepEqual(exposed, ["calendar.nudge.refresh", "command.refresh_stats"]);

  for (const id of exposed) {
    assert.equal(/^(vault|finance)\./.test(id), false, `${id} must never be phone-exposed`);
  }
});

test("dangerLevel is not a proxy for phone-appropriateness", () => {
  // Documents why this is an allowlist rather than a dangerLevel filter: the
  // registry genuinely marks secret-revealing actions as safe.
  const all = seededActions;
  const safeAndSensitive = all.filter(a =>
    a.dangerLevel === "safe" && /^(vault|finance)\./.test(a.id));

  assert.ok(safeAndSensitive.length > 0, "if this ever becomes empty, re-read the assumption");
  for (const a of safeAndSensitive) {
    assert.equal(canPhoneRun(a, ["read", "control", "drop"]).ok, false);
  }
});
