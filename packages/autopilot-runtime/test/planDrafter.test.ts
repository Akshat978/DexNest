// Drafting a plan.
//
// The valuable properties are not "it produces text" — they are that it goes
// through the effects gateway like any other send, that it reads nothing, and
// that what comes back is measured by the parser the run will actually use.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PlanDrafter, planDraftPrompt, PHASE_SIZING_RULE, parsePlanText, createRunSpec } from "../src/index.ts";
import type { RunSpec } from "../src/index.ts";

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  ...createRunSpec({ goal: "Add a CSV export" }, { id: "run-1", now: "2026-01-01T00:00:00.000Z" }),
  ...over
}) as RunSpec;

// --- the prompt --------------------------------------------------------------

test("the prompt carries the goal, the bounds and the sizing rule", () => {
  const text = planDraftPrompt(spec({
    goal: "Add a CSV export",
    constraints: ["Keep the public API stable"],
    nonGoals: ["Rewriting the importer"]
  } as Partial<RunSpec>));

  assert.match(text, /Add a CSV export/);
  assert.match(text, /Keep the public API stable/);
  assert.match(text, /Rewriting the importer/);
  assert.ok(text.includes(PHASE_SIZING_RULE), "the sizing rule is the point of asking");
});

test("the prompt tells the drafter it cannot see the repository", () => {
  // Without this it invents filenames, and a plan full of paths that do not
  // exist reads as authoritative while being fiction.
  assert.match(planDraftPrompt(spec()), /cannot see the repository/i);
});

test("the format it asks for is the format the run parses", () => {
  // The two could drift apart silently: the prompt asks for one shape and
  // parsePlanText accepts another, and every draft would come back empty.
  const asked = planDraftPrompt(spec());
  assert.match(asked, /`1\.`/);

  const sample = "1. Read the existing exporter\n   Verified by: test\n2. Add the CSV writer\n   Verified by: test";
  assert.equal(parsePlanText(sample).items.length, 2);
});

// --- drafting ----------------------------------------------------------------

function harness(reply: { ok: boolean; text: string }, authorised = true) {
  const events: Array<{ type: string }> = [];
  const requested: unknown[] = [];
  const ports = {
    ids: { next: (prefix: string) => `${prefix}-1` },
    db: null
  } as never;

  const drafter = new PlanDrafter({
    ports,
    provider: "claude",
    cwd: "C:/nowhere",
    policy: {} as never,
    effects: {
      request: async (input: unknown) => {
        requested.push(input);
        return authorised
          ? { result: { ok: true, stdout: "" } }
          : { status: "DENIED", decision: { reason: "not authorized here" } };
      }
    } as never,
    protocol: {
      prompt: (session: unknown, text: string) => ({ kind: "RUN_COMMAND", session, text }),
      completion: () => ({ ...reply, failure: reply.ok ? null : "protocol" })
    } as never
  });

  // The store is the one dependency that is not injected, so it is replaced on
  // the instance rather than mocked through a port that does not exist.
  (drafter as unknown as { store: unknown }).store = {
    requireRun: () => ({ spec: spec() }),
    appendEvent: (_runId: string, event: { type: string }) => { events.push(event); }
  };
  return { drafter, events, requested };
}

test("a draft goes through the effects gateway, against the run", async () => {
  // The property that keeps a draft accountable: it is a provider send, and a
  // send that skipped this path would be one nobody could later account for.
  const h = harness({ ok: true, text: "1. First phase\n2. Second phase" });
  await h.drafter.draft("run-1");

  assert.equal(h.requested.length, 1);
  assert.equal((h.requested[0] as { runId: string }).runId, "run-1");
  assert.ok((h.requested[0] as { policy: unknown }).policy !== undefined, "and under a policy");
});

test("the phase count is the parser's, not the model's", async () => {
  // A reply can claim five phases and parse to two. The number shown has to be
  // the one the run would get, or the operator is told something untrue at the
  // exact moment they are deciding whether to accept it.
  const h = harness({ ok: true, text: "I have written five phases.\n1. One\n2. Two" });
  const draft = await h.drafter.draft("run-1");

  assert.equal(draft.phases, 2);
  assert.equal(draft.problem, null);
  assert.ok(h.events.some(e => e.type === "PLAN_DRAFTED"));
});

test("a reply with no phases is a failure, not an empty plan", async () => {
  // Returning "" with no problem would let the operator start a run with no
  // plan at all, believing one had been drafted.
  const h = harness({ ok: true, text: "I would need to see the code first." });
  const draft = await h.drafter.draft("run-1");

  assert.equal(draft.phases, 0);
  assert.match(String(draft.problem), /no numbered phases/);
  assert.ok(h.events.some(e => e.type === "PLAN_DRAFT_FAILED"));
});

test("a provider that will not answer is reported, not thrown", async () => {
  const h = harness({ ok: false, text: "" });
  const draft = await h.drafter.draft("run-1");
  assert.equal(draft.text, "");
  assert.match(String(draft.problem), /did not answer/);
});

test("a refused policy decision is reported in the policy's own words", async () => {
  const h = harness({ ok: true, text: "1. One" }, false);
  const draft = await h.drafter.draft("run-1");
  assert.match(String(draft.problem), /not authorized here/);
});

test("two drafts at once for one run is refused", async () => {
  // A caller mistake rather than a provider one, so this is the single case
  // that throws.
  const h = harness({ ok: true, text: "1. One" });
  const first = h.drafter.draft("run-1");
  await assert.rejects(() => h.drafter.draft("run-1"), /already being drafted/);
  await first;
});
