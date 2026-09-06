// Plan intake and progress.
//
// The invariant under test is the ownership split: plan CONTENT is authoritative
// Run Spec data that nothing in the runtime may rewrite, and plan PROGRESS is
// runtime state that changes freely. If those two ever merge, an agent could
// edit its own instructions, so most of what follows is about keeping them apart.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createRunSpec, parsePlanText, authoritativeFingerprint, AUTHORITATIVE_FIELDS,
  RunSpecValidationError, MAX_PLAN_ITEMS, MAX_PLAN_ITEM_DETAIL_CHARS
} from "../src/runSpec.ts";
import { PlanStore, PlanItemError, renderPlanProgress } from "../src/plan.ts";
import { createTestWorkspace } from "./helpers/harness.ts";
import { runAutopilotMigrations } from "../src/migrations.ts";
import { AutopilotStore } from "../src/store.ts";

const PLAN_TEXT = `Some framing text that is not an item.

### Phase 1 — Plan intake
Durable ordered plan items.
Migration and store.

### Phase 2 — Work in the real project
Branch instead of worktree.`;

function spec(planText = PLAN_TEXT) {
  return createRunSpec(
    { goal: "Build the thing", plan: parsePlanText(planText).items },
    { id: "spec-1", now: "2026-09-05T00:00:00.000Z" }
  );
}

function harness(t: { after(fn: () => void): void }, migrations?: never[]) {
  const workspace = createTestWorkspace();
  const opened = workspace.openPorts();
  t.after(() => { opened.close(); workspace.cleanup(); });

  runAutopilotMigrations(opened.ports.db, "2026-09-05T00:00:00.000Z", migrations);
  const runSpec = spec();
  const store = new AutopilotStore(opened.ports);
  const runId = migrations ? "run-x" : store.createRun({ spec: runSpec, executorId: "test" }).id;
  return { ports: opened.ports, store, spec: runSpec, runId, plan: new PlanStore(opened.ports) };
}

// --- intake -----------------------------------------------------------------

test("markdown headings become ordered items and preamble is kept separate", () => {
  const { items, preamble } = parsePlanText(PLAN_TEXT);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => [item.ordinal, item.title]), [
    [1, "Phase 1 — Plan intake"],
    [2, "Phase 2 — Work in the real project"]
  ]);
  assert.equal(items[0]!.detail, "Durable ordered plan items.\nMigration and store.");
  assert.equal(items[1]!.detail, "Branch instead of worktree.");
  // Framing text must not silently become an item, nor silently vanish.
  assert.equal(preamble, "Some framing text that is not an item.");
});

test("numbered and labelled plans parse too", () => {
  assert.deepEqual(parsePlanText("1. First\nbody\n2) Second").items.map((item) => item.title), ["First", "Second"]);
  // Markup is stripped ("#", "1.", "**"); prose the human wrote is kept, so a
  // "Phase 2" label survives in the title exactly as a markdown heading's does.
  assert.deepEqual(parsePlanText("Phase 1 - Alpha\nPhase 2: Beta\nStage 3 Gamma").items.map((item) => item.title),
    ["Phase 1 - Alpha", "Phase 2: Beta", "Stage 3 Gamma"]);
  assert.equal(parsePlanText("**Milestone 1 — Bold**").items[0]!.title, "Milestone 1 — Bold");
  assert.equal(parsePlanText("### **Phase 9 — Bold heading**").items[0]!.title, "Phase 9 — Bold heading");
});

test("text with no headings yields no items rather than one bogus item", () => {
  const parsed = parsePlanText("just a paragraph\nand another line");
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.preamble, "just a paragraph\nand another line");
  assert.deepEqual(parsePlanText("").items, []);
});

test("ordinals come from list position, never from input", () => {
  const built = createRunSpec(
    { goal: "g", plan: [{ id: "b", ordinal: 99, title: "second", detail: "" }, { id: "a", ordinal: 1, title: "first", detail: "" }] },
    { id: "s", now: "2026-09-05T00:00:00.000Z" }
  );
  assert.deepEqual(built.plan.map((item) => [item.id, item.ordinal]), [["b", 1], ["a", 2]]);
});

test("invalid plans are rejected, not repaired", () => {
  const at = { id: "s", now: "2026-09-05T00:00:00.000Z" };
  assert.throws(() => createRunSpec({ goal: "g", plan: [{ title: "  " }] as never }, at), RunSpecValidationError);
  assert.throws(() => createRunSpec({ goal: "g", plan: "nope" as never }, at), /plan must be an array/);
  assert.throws(
    () => createRunSpec({ goal: "g", plan: [{ id: "x", title: "a" }, { id: "x", title: "b" }] as never }, at),
    /duplicate plan item id "x"/
  );
  assert.throws(
    () => createRunSpec({ goal: "g", plan: [{ title: "a", detail: "d".repeat(MAX_PLAN_ITEM_DETAIL_CHARS + 1) }] as never }, at),
    new RegExp(`exceeds ${MAX_PLAN_ITEM_DETAIL_CHARS}`)
  );
  assert.throws(
    () => createRunSpec({ goal: "g", plan: Array.from({ length: MAX_PLAN_ITEMS + 1 }, (_, i) => ({ title: `t${i}` })) as never }, at),
    new RegExp(`maximum is ${MAX_PLAN_ITEMS}`)
  );
});

test("an absent plan is legal and normalizes to an empty list", () => {
  assert.deepEqual(createRunSpec({ goal: "g" }, { id: "s", now: "2026-09-05T00:00:00.000Z" }).plan, []);
});

// --- authority --------------------------------------------------------------

test("the plan is authoritative: changing it changes the fingerprint", () => {
  assert.ok(AUTHORITATIVE_FIELDS.includes("plan" as never));
  const before = authoritativeFingerprint(spec());
  const after = authoritativeFingerprint(spec(PLAN_TEXT + "\n\n### Phase 3 — Extra\n"));
  assert.notEqual(before, after, "an agent quietly adding a phase must be detectable");

  // Title and detail both count; a reworded instruction is a changed instruction.
  const reworded = spec(PLAN_TEXT.replace("Branch instead of worktree.", "Worktree is fine actually."));
  assert.notEqual(before, authoritativeFingerprint(reworded));
});

test("runs created before plans existed keep the fingerprint already stored for them", () => {
  // Captured from the implementation as it stood before plans existed. Runs
  // created then hold this value in autopilot_runs.spec_fingerprint, so if an
  // empty plan started contributing to the hash every one of them would look
  // like it had drifted. Pinned rather than recomputed, because a test that
  // asks the new code to agree with itself would not notice.
  const planless = createRunSpec({ goal: "Build the thing" }, { id: "spec-1", now: "2026-09-05T00:00:00.000Z" });
  assert.deepEqual(planless.plan, []);
  assert.equal(authoritativeFingerprint(planless), "fnv1a-f3ffbda5");

  // A spec that does carry a plan must hash differently, or the field is
  // present in the type and absent from the guarantee.
  assert.notEqual(authoritativeFingerprint(spec()), "fnv1a-f3ffbda5");
});

// --- progress ---------------------------------------------------------------

test("every item starts PENDING with no stored row", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  const view = plan.view(runId, runSpec);
  assert.deepEqual(view.items.map((item) => item.status), ["PENDING", "PENDING"]);
  assert.equal(view.counts.PENDING, 2);
  assert.deepEqual(view.orphans, []);
  assert.equal(plan.next(runId, runSpec)?.id, "plan-1");
  assert.equal(plan.active(runId, runSpec), null);
  assert.equal(plan.settled(runId, runSpec), false);
});

test("a full lifecycle records status, note and timestamps", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  assert.equal(plan.active(runId, runSpec)?.id, "plan-1");

  const done = plan.complete(runId, runSpec, "plan-1", "shipped");
  assert.equal(done.status, "DONE");
  assert.equal(done.note, "shipped");
  assert.ok(done.startedAt && done.settledAt);
  assert.equal(plan.active(runId, runSpec), null);
  assert.equal(plan.next(runId, runSpec)?.id, "plan-2");
});

test("only one item may be in flight at a time", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  assert.throws(() => plan.start(runId, runSpec, "plan-2"), /already in progress/);
  // Restarting the same item is a no-op rather than an error.
  assert.equal(plan.start(runId, runSpec, "plan-1").status, "ACTIVE");
});

test("DONE requires the item to have been started; BLOCKED and SKIPPED do not", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  assert.throws(() => plan.complete(runId, runSpec, "plan-1"), /never started/);
  assert.equal(plan.skip(runId, runSpec, "plan-1", "not needed").status, "SKIPPED");
  assert.equal(plan.block(runId, runSpec, "plan-2", "waiting on an API key").status, "BLOCKED");
  assert.equal(plan.settled(runId, runSpec), true);
});

test("settling twice, and settling an unknown item, are refused", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  plan.complete(runId, runSpec, "plan-1");
  assert.throws(() => plan.complete(runId, runSpec, "plan-1"), /already DONE/);
  assert.throws(() => plan.start(runId, runSpec, "plan-1"), /already DONE/);
  assert.throws(() => plan.start(runId, runSpec, "plan-404"), PlanItemError);
  assert.throws(() => plan.block(runId, runSpec, "plan-2", "   "), /requires a reason/);
});

test("reset returns an item to PENDING and keeps the journal intact", (t) => {
  const { plan, runId, spec: runSpec, store } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  plan.complete(runId, runSpec, "plan-1");
  assert.equal(plan.reset(runId, runSpec, "plan-1", "verification was wrong").status, "PENDING");
  assert.equal(plan.next(runId, runSpec)?.id, "plan-1");

  const types = store.listEvents(runId).map((event) => event.type);
  assert.deepEqual(
    types.filter((type) => type.startsWith("PLAN_ITEM_")),
    ["PLAN_ITEM_STARTED", "PLAN_ITEM_COMPLETED", "PLAN_ITEM_RESET"],
    "resetting must not erase the record that the item was once completed"
  );
});

test("progress for an item removed from the spec is reported, not deleted", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  plan.start(runId, runSpec, "plan-2");
  plan.complete(runId, runSpec, "plan-2", "done early");

  const revised = { ...runSpec, plan: runSpec.plan.filter((item) => item.id !== "plan-2") };
  const view = plan.view(runId, revised);
  assert.equal(view.items.length, 1);
  assert.equal(view.orphans.length, 1);
  assert.equal(view.orphans[0]!.itemId, "plan-2");
  assert.equal(view.orphans[0]!.status, "DONE");
});

test("progress survives a restart and is readable from a fresh store", (t) => {
  const { plan, runId, spec: runSpec, ports } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  plan.complete(runId, runSpec, "plan-1", "kept");

  const reopened = new PlanStore(ports).view(runId, runSpec);
  assert.equal(reopened.items[0]!.status, "DONE");
  assert.equal(reopened.items[0]!.note, "kept");
});

test("the plan store tolerates a database without migration 15", (t) => {
  const { plan, runId, spec: runSpec } = harness(t, []);
  assert.deepEqual(plan.view(runId, runSpec).items.map((item) => item.status), ["PENDING", "PENDING"]);
  assert.throws(() => plan.start(runId, runSpec, "plan-1"), /migration 15/);
});

test("rendering shows one line per item and flags orphans", (t) => {
  const { plan, runId, spec: runSpec } = harness(t);
  plan.start(runId, runSpec, "plan-1");
  const text = renderPlanProgress(plan.view(runId, runSpec));
  assert.match(text, /\[>\] 1\. Phase 1 — Plan intake/);
  assert.match(text, /\[ \] 2\. Phase 2 — Work in the real project/);
  assert.equal(renderPlanProgress({ items: [], orphans: [], counts: { PENDING: 0, ACTIVE: 0, DONE: 0, BLOCKED: 0, SKIPPED: 0 } }), "No plan items.");
});

test("a document title above the first phase is a title, not work", () => {
  // The first real PLAN.md began "# Plan: Twenty (working name)" and the
  // parser made that item 1 — so the run's opening assignment was to "do" the
  // title of the document. A title above numbered work folds into the
  // preamble, detail and all; a closing non-phase item someone wrote after the
  // phases is still theirs.
  const { items, preamble } = parsePlanText([
    "# Plan: Twenty (working name)",
    "",
    "A tree-walking interpreter.",
    "",
    "### Phase 1 — Lexer",
    "Tokens.",
    "### Phase 2 — Parser",
    "Trees.",
    "### Wrap-up",
    "Docs."
  ].join("\n"));

  assert.equal(items.length, 3);
  assert.equal(items[0]!.title, "Phase 1 — Lexer");
  assert.equal(items[0]!.ordinal, 1, "ordinals are renumbered after the fold");
  assert.equal(items[0]!.id, "plan-1");
  assert.equal(items.at(-1)!.title, "Wrap-up", "trailing items are kept");
  assert.ok(preamble.includes("Plan: Twenty (working name)"));
  assert.ok(preamble.includes("A tree-walking interpreter."), "the title's body survives too");
});

test("a plan with no phase-numbered items keeps every heading as work", () => {
  // The fold is only justified when the author explicitly numbered their work.
  // In a plan of plain headings there is no signal separating a title from a
  // task, and guessing would silently delete someone's first item.
  const { items } = parsePlanText("# Set up the repo\n\n# Write the tests\n");
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, "Set up the repo");
});
