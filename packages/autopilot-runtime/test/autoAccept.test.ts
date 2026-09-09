// Whether a finished run may finish itself.
//
// The property under test is not "does it accept" but "does it refuse for the
// right reason". Auto-accept is the one place DexNest ends a run with nobody
// watching, so every condition that holds it back matters more than the one
// path that lets it through.

import { test } from "node:test";
import assert from "node:assert/strict";

import { canAutoAccept, type AutoAcceptFacts } from "../src/index.ts";

const done = (count: number) => Array.from({ length: count }, () => ({ status: "DONE" as const }));

const facts = (over: Partial<AutoAcceptFacts> = {}): AutoAcceptFacts => ({
  enabled: true,
  verification: "PASSED",
  planItems: done(3),
  assumptions: 0,
  ...over
});

test("a clean run accepts, and says what made it clean", () => {
  const verdict = canAutoAccept(facts());
  assert.equal(verdict.accept, true);
  assert.match(verdict.reason, /3 phases are done/);
});

test("off by default is the whole point", () => {
  // A run completing with nobody looking is a decision, not a convenience.
  const verdict = canAutoAccept(facts({ enabled: false }));
  assert.equal(verdict.accept, false);
  assert.match(verdict.reason, /off for this run/);
});

test("anything but a green verification holds", () => {
  for (const outcome of ["FAILED", "PARTIAL", "SKIPPED", null]) {
    const verdict = canAutoAccept(facts({ verification: outcome }));
    assert.equal(verdict.accept, false, String(outcome));
    assert.match(verdict.reason, /not PASSED/);
  }
});

test("skipped and blocked work holds, because settled is not finished", () => {
  // PlanStore.settled counts SKIPPED and BLOCKED as settled and says outright
  // that it never implies success. Using it here would end a night on work
  // that did not happen.
  for (const status of ["SKIPPED", "BLOCKED", "PENDING", "ACTIVE"] as const) {
    const verdict = canAutoAccept(facts({ planItems: [...done(2), { status }] }));
    assert.equal(verdict.accept, false, status);
    assert.match(verdict.reason, /plan is not finished/);
  }
});

test("the refusal counts what is unfinished, so it can be read at a glance", () => {
  const verdict = canAutoAccept(facts({
    planItems: [...done(4), { status: "SKIPPED" }, { status: "SKIPPED" }, { status: "BLOCKED" }]
  }));
  assert.match(verdict.reason, /2 skipped/);
  assert.match(verdict.reason, /1 blocked/);
});

test("an assumption holds the run, because that is exactly when a person should look", () => {
  const one = canAutoAccept(facts({ assumptions: 1 }));
  assert.equal(one.accept, false);
  assert.match(one.reason, /recorded an assumption/);

  const many = canAutoAccept(facts({ assumptions: 4 }));
  assert.match(many.reason, /recorded 4 assumptions/);
});

test("a run with no plan holds, however green it is", () => {
  // The old trap: one passing check ending a night that had barely started.
  const verdict = canAutoAccept(facts({ planItems: [] }));
  assert.equal(verdict.accept, false);
  assert.match(verdict.reason, /no plan/);
});

test("the checks are ordered so the most fundamental reason is the one reported", () => {
  // A run that is off, unverified, unplanned and full of assumptions should
  // say it is off — not lead with the fourth-most-relevant fact.
  const verdict = canAutoAccept({ enabled: false, verification: "FAILED", planItems: [], assumptions: 9 });
  assert.match(verdict.reason, /off for this run/);
});

test("nothing about the agent's own claim reaches the decision", () => {
  // The property that makes this different from trusting the model: there is
  // no field for what the agent said, so there is no way for it to matter.
  assert.deepEqual(
    Object.keys(facts()).sort(),
    ["assumptions", "enabled", "planItems", "verification"]
  );
});
