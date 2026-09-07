// Where a night's usage actually went.
//
// The provider's per-turn figure has been stored since the cost budget
// existed and surfaced nowhere, so "which phase was expensive" had no answer.
// These tests are about that answer being correct rather than merely present:
// a phase owns its repairs, an unreported turn is excluded rather than counted
// as zero, and the growth signal only fires on real growth.
//
// The point of measuring at all is a specific claim: that one session resumed
// across every phase makes each phase pay for every phase before it. If the
// cost curve turns out flat, the claim is wrong and rotating sessions would
// buy nothing. So the test that matters most is the one that would notice.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUsageReport, renderUsageReport } from "../src/usage.ts";
import type { TurnRecord } from "../src/loopStore.ts";
import type { IterationRecord } from "../src/iterations.ts";

const turn = (ordinal: number, costUsd: number | null, prompt = "p"): TurnRecord => ({
  id: `turn-${ordinal}`,
  runId: "run",
  grantId: "grant",
  ordinal,
  kind: "INITIAL",
  prompt,
  sendId: null,
  status: "VERIFIED",
  grantConsumed: true,
  verificationId: null,
  costUsd,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z"
});

const iteration = (ordinal: number, turnOrdinal: number, status = "VERIFIED"): IterationRecord => ({
  id: `it-${ordinal}`,
  runId: "run",
  ordinal,
  planItemId: null,
  turnId: `turn-${turnOrdinal}`,
  verificationId: null,
  checkpointId: null,
  status: status as IterationRecord["status"],
  summary: `phase ${ordinal}`,
  startedAt: "2026-09-07T00:00:00.000Z",
  settledAt: "2026-09-07T00:10:00.000Z"
});

// --- the totals -------------------------------------------------------------

test("cost accumulates across turns and is derived, never stored", () => {
  const usage = buildUsageReport({
    turns: [turn(1, 0.5), turn(2, 1.5), turn(3, 2)],
    iterations: []
  });
  assert.equal(usage.totalUsd, 4);
  assert.deepEqual(usage.turns.map(entry => entry.cumulativeUsd), [0.5, 2, 4]);
});

test("a turn the provider said nothing about is excluded, not counted as free", () => {
  // Counting silence as zero would quietly understate a night, and the
  // understatement would grow with however many turns went unreported.
  const usage = buildUsageReport({ turns: [turn(1, 1), turn(2, null), turn(3, 2)], iterations: [] });
  assert.equal(usage.totalUsd, 3);
  assert.equal(usage.unreportedTurns, 1);
  assert.match(renderUsageReport(usage), /1 turn\(s\) reported no cost and are not counted/);
});

// --- per phase --------------------------------------------------------------

test("a phase owns its repairs, so three attempts do not look like one", () => {
  // An iteration spans the turns that repaired it. Attributing only the
  // opening turn would make a phase that needed three goes look as cheap as
  // one that worked first time — exactly backwards for deciding what to fix.
  const usage = buildUsageReport({
    turns: [turn(1, 1), turn(2, 2), turn(3, 4), turn(4, 8)],
    iterations: [iteration(1, 1), iteration(2, 4)]
  });

  assert.deepEqual(
    usage.phases.map(phase => ({ ordinal: phase.ordinal, turns: phase.turns, costUsd: phase.costUsd })),
    [
      { ordinal: 1, turns: 3, costUsd: 7 },
      { ordinal: 2, turns: 1, costUsd: 8 }
    ]
  );
});

test("a phase whose turns all went unreported has no cost, rather than zero", () => {
  const usage = buildUsageReport({
    turns: [turn(1, null), turn(2, 3)],
    iterations: [iteration(1, 1), iteration(2, 2)]
  });
  assert.equal(usage.phases[0]!.costUsd, null, "unknown is not the same as free");
  assert.equal(usage.phases[1]!.costUsd, 3);
});

// --- the question this exists to answer -------------------------------------

test("a run whose turns get dearer says so", () => {
  // The claim under test: one session resumed across every phase makes each
  // phase re-send every phase before it. If that is happening, cost per turn
  // climbs, and this is what would show it.
  const usage = buildUsageReport({
    turns: [turn(1, 0.4), turn(2, 0.9), turn(3, 1.8), turn(4, 3.6)],
    iterations: []
  });
  assert.ok(usage.growth);
  assert.equal(usage.growth!.first, 0.4);
  assert.equal(usage.growth!.last, 3.6);
  assert.equal(Math.round(usage.growth!.ratio), 9);
  assert.match(renderUsageReport(usage), /9\.0x the first/);
  assert.match(renderUsageReport(usage), /paying for its own history/);
});

test("a run whose turns stay level says that instead", () => {
  // The measurement has to be able to disagree with the theory, or it is not
  // a measurement.
  const usage = buildUsageReport({
    turns: [turn(1, 1), turn(2, 1.05), turn(3, 0.95), turn(4, 1.02)],
    iterations: []
  });
  assert.ok(usage.growth!.ratio < 1.5);
  assert.match(renderUsageReport(usage), /stayed roughly level/);
  assert.equal(/paying for its own history/.test(renderUsageReport(usage)), false);
});

test("growth needs at least two reported turns to mean anything", () => {
  assert.equal(buildUsageReport({ turns: [turn(1, 1)], iterations: [] }).growth, null);
  assert.equal(buildUsageReport({ turns: [turn(1, null)], iterations: [] }).growth, null);
  assert.equal(buildUsageReport({ turns: [], iterations: [] }).growth, null);
});

// --- how it reads -----------------------------------------------------------

test("the figure is never presented as a bill or a percentage of a plan", () => {
  // Inventing "38% of your plan used" from a dollar figure would be making up
  // the one number no provider gives us.
  const text = renderUsageReport(buildUsageReport({ turns: [turn(1, 1), turn(2, 2)], iterations: [] }));
  assert.match(text, /as the provider reports it/);
  assert.match(text, /usage proxy, not a bill/);
  assert.equal(/%/.test(text), false);
});

test("nothing spent yet reads as nothing spent yet", () => {
  assert.match(renderUsageReport(buildUsageReport({ turns: [], iterations: [] })), /No turns yet/);
});

test("DexNest's own prompt is carried beside the cost, for comparison", () => {
  // The obvious explanation for an expensive night is "we send too much
  // context". Putting the prompt's size next to the turn's cost is what lets
  // an operator see that the two are not related.
  const usage = buildUsageReport({ turns: [turn(1, 5, "x".repeat(4273))], iterations: [] });
  assert.equal(usage.turns[0]!.promptChars, 4273);
});
