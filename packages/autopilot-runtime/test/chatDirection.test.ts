// Chat-directed mode, and switching between deciders mid-run.
//
// This restores the split the manual workflow had: one conversation holds the
// project and writes assignments, a separate coding agent executes them. The
// point is not that a chat decides better — it is that an expensive coding
// subscription gets spent on coding.
//
// So the tests are about the seam. Who decides is durable, human-set state; it
// can move mid-run without losing anything; the director sees evidence rather
// than the workspace; and a director that cannot be read hands back to a person
// rather than quietly letting the agent decide instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { DirectionAuthorityStore, DirectionStore } from "../src/direction.ts";
import { ChatDirector, directorPrompt } from "../src/chatDirector.ts";
import { IterationStore } from "../src/iterations.ts";
import { LoopStore } from "../src/loopStore.ts";
import { createRunSpec, parsePlanText } from "../src/runSpec.ts";
import { PlanStore } from "../src/plan.ts";
import type { ParsedDirection } from "../src/direction.ts";
import type { WorkerFailure } from "../src/worker.ts";

const green = (index: number, say?: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  ...(say ? { say } : {})
});

const selfBlock = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;

/** A director that answers from a script, without launching anything. */
function scriptedDirector(answers: Array<ParsedDirection | { failure: WorkerFailure }>) {
  const prompts: string[] = [];
  let index = 0;
  return {
    prompts,
    director: {
      provider: "codex" as const,
      session: () => null,
      decide: async (input: { runId: string; prompt: string }) => {
        prompts.push(input.prompt);
        const answer = answers[Math.min(index++, answers.length - 1)]!;
        if ("failure" in answer) {
          return {
            decision: {
              verb: "NEEDS_HUMAN", assignment: null, planItemId: null,
              reason: `The director did not answer (${answer.failure}).`,
              issue: `The director did not answer (${answer.failure}).`
            },
            failure: answer.failure
          };
        }
        return { decision: answer, failure: null };
      }
    } as unknown as ChatDirector
  };
}

const CONTINUE = (assignment: string): ParsedDirection =>
  ({ verb: "CONTINUE", assignment, reason: null, planItemId: null, issue: null });
const STOP: ParsedDirection =
  { verb: "PLAN_COMPLETE", assignment: null, reason: "The plan is done.", planItemId: null, issue: null };

function fixture(
  t: { after(fn: () => void): void },
  plan: LoopPlanStep[],
  options: { director?: ChatDirector | null; maxIterations?: number } = {}
) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-chatdir-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root, { maxConsecutiveFailures: 20, director: options.director ?? null });
  h.createRun();
  h.loop.authorize({ runId: "loop-run", maxTurns: 20, maxIterations: options.maxIterations ?? 6, grantedBy: "human" });
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

// --- who decides ------------------------------------------------------------

test("a run directs itself until a human says otherwise", (t) => {
  const h = fixture(t, [green(0)]);
  const authority = new DirectionAuthorityStore(h.ports);
  assert.equal(authority.current("loop-run"), "self");
  assert.deepEqual(authority.history("loop-run"), [], "the default costs no history");
});

test("switching records who asked, why, and what it replaced", (t) => {
  const h = fixture(t, [green(0)]);
  const authority = new DirectionAuthorityStore(h.ports);

  const moved = authority.switchTo({
    runId: "loop-run", source: "chat",
    reason: "Save Claude capacity for coding.", changedBy: "akshat"
  })!;
  assert.equal(moved.source, "chat");
  assert.equal(authority.current("loop-run"), "chat");

  // The history starts at the beginning, not midway through the story.
  const history = authority.history("loop-run");
  assert.deepEqual(history.map((entry) => [entry.source, entry.status]), [["self", "HISTORICAL"], ["chat", "CURRENT"]]);
  assert.equal(history[1]!.changedBy, "akshat");
  assert.match(history[1]!.reason, /Save Claude capacity/);

  const event = h.store.listEvents("loop-run").find((entry) => entry.type === "DIRECTION_AUTHORITY_CHANGED")!;
  assert.equal((event.payload as { from: string; to: string }).from, "self");
  assert.equal((event.payload as { from: string; to: string }).to, "chat");
});

test("switching to what is already in force changes nothing", (t) => {
  const h = fixture(t, [green(0)]);
  const authority = new DirectionAuthorityStore(h.ports);
  authority.switchTo({ runId: "loop-run", source: "chat", reason: "first", changedBy: "akshat" });
  authority.switchTo({ runId: "loop-run", source: "chat", reason: "again", changedBy: "akshat" });
  assert.equal(authority.history("loop-run").length, 2, "no second entry for a no-op switch");
});

test("a switch is a human act and says so", (t) => {
  const h = fixture(t, [green(0)]);
  const authority = new DirectionAuthorityStore(h.ports);
  assert.throws(() => authority.switchTo({ runId: "loop-run", source: "chat", reason: "  ", changedBy: "akshat" }), /requires a reason/);
  assert.throws(() => authority.switchTo({ runId: "loop-run", source: "chat", reason: "why", changedBy: " " }), /who asked/);
});

// --- the director in the loop -----------------------------------------------

test("with a chat directing, the assignments come from the chat and not the agent", async (t) => {
  const scripted = scriptedDirector([CONTINUE("Add the second file, as the chat decided."), STOP]);
  // The worker also proposes something, and must be ignored.
  const h = fixture(t, [
    green(0, selfBlock("decision: CONTINUE\nassignment: The agent's own idea, which must not be used.")),
    green(1, selfBlock("decision: CONTINUE\nassignment: Another idea of the agent's."))
  ], { director: scripted.director });

  new DirectionAuthorityStore(h.ports).switchTo({
    runId: "loop-run", source: "chat", reason: "the chat plans", changedBy: "akshat"
  });
  const outcome = await h.loop.run("loop-run");

  const turns = new LoopStore(h.ports).turns("loop-run");
  assert.match(turns[1]!.prompt, /Add the second file, as the chat decided/);
  assert.equal(/The agent's own idea/.test(turns[1]!.prompt), false, "the worker does not direct a chat-directed run");

  const decisions = new DirectionStore(h.ports).list("loop-run");
  assert.deepEqual(decisions.map((decision) => decision.source), ["chat", "chat"]);
  assert.equal(outcome.reason, "plan_complete_proposed");
});

test("the director is asked once per completed piece of work, and sees evidence", async (t) => {
  const scripted = scriptedDirector([CONTINUE("Second piece."), STOP]);
  const h = fixture(t, [green(0), green(1)], { director: scripted.director });
  new DirectionAuthorityStore(h.ports).switchTo({ runId: "loop-run", source: "chat", reason: "x", changedBy: "akshat" });
  await h.loop.run("loop-run");

  assert.equal(scripted.prompts.length, 2, "one question per verified iteration, not per turn");
  const [first, second] = scripted.prompts;
  assert.match(first!, /GOAL \(set by the human, unchanged\)/);
  assert.match(first!, /WHAT DEXNEST'S OWN VERIFICATION FOUND/);
  assert.match(first!, /the fact of record/);
  // Its own previous assignment comes back to it, so it can see what it asked.
  assert.match(second!, /THE ASSIGNMENT YOU GAVE LAST TIME:\nSecond piece\./);
});

test("switching mid-run takes effect at the next boundary, keeping everything else", async (t) => {
  const scripted = scriptedDirector([STOP]);
  const h = fixture(t, [
    green(0, selfBlock("decision: CONTINUE\nassignment: The agent's own second step.")),
    green(1)
  ], { director: scripted.director });

  // Start self-directed: the first iteration's assignment is the agent's.
  const authority = new DirectionAuthorityStore(h.ports);
  const iterations = h.loop.iterations;
  const open = iterations.open.bind(iterations);
  iterations.open = (input) => {
    const record = open(input);
    if (record?.ordinal === 2) {
      authority.switchTo({ runId: "loop-run", source: "chat", reason: "handing planning to the chat", changedBy: "akshat" });
    }
    return record;
  };

  await h.loop.run("loop-run");

  // Turn 2 still ran the agent's own assignment — the switch happened after it
  // was decided — and the NEXT decision came from the chat.
  const turns = new LoopStore(h.ports).turns("loop-run");
  assert.match(turns[1]!.prompt, /The agent's own second step/);
  const decisions = new DirectionStore(h.ports).list("loop-run");
  assert.deepEqual(decisions.map((decision) => decision.source), ["self", "chat"]);

  // Nothing was lost across the switch: same iteration numbering, and the same
  // authorization still standing with its budget intact, so the operator can
  // review and resume rather than re-authorize.
  assert.deepEqual(new IterationStore(h.ports).list("loop-run").map((entry) => entry.ordinal), [1, 2]);
  const grant = new LoopStore(h.ports).activeGrant("loop-run")!;
  assert.equal(grant.iterationsUsed, 2);
  assert.equal(grant.status, "ACTIVE");
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED");
});

test("a chat-directed run with no chat configured asks for a human", async (t) => {
  const h = fixture(t, [green(0, selfBlock("decision: CONTINUE\nassignment: Carry on regardless."))]);
  new DirectionAuthorityStore(h.ports).switchTo({ runId: "loop-run", source: "chat", reason: "x", changedBy: "akshat" });

  const outcome = await h.loop.run("loop-run");
  // Never a silent fall back to the agent: the operator chose who decides.
  assert.equal(outcome.reason, "direction_needs_human");
  assert.match(outcome.detail, /no chat session is configured/);
  assert.equal(new DirectionStore(h.ports).list("loop-run")[0]!.verb, "NEEDS_HUMAN");
});

// --- what the director is told ----------------------------------------------

test("the director sees the plan and its progress, and never the workspace", (t) => {
  const spec = createRunSpec(
    {
      goal: "Finish notifications",
      constraints: ["keep the public API"],
      plan: parsePlanText("### Phase 1 — Backend\n### Phase 2 — UI").items
    },
    { id: "spec-1", now: "2026-09-06T00:00:00.000Z" }
  );
  const h = fixture(t, [green(0)]);
  const view = new PlanStore(h.ports).view("loop-run", spec);

  const prompt = directorPrompt({
    spec, plan: view, iteration: 3, iterationsRemaining: 2,
    lastAssignment: "Build the queue.",
    workerReport: "Queue built and wired up.",
    verification: { outcome: "PASSED", summary: "typecheck ok", tiers: [] } as never
  });

  assert.match(prompt, /You do not write\ncode and you cannot see the repository/);
  assert.match(prompt, /Finish notifications/);
  assert.match(prompt, /keep the public API/);
  assert.match(prompt, /\[PENDING\] plan-1: Phase 1 — Backend/);
  assert.match(prompt, /THIS IS ITERATION 3/);
  assert.match(prompt, /2 further iteration\(s\) are authorized/);
  assert.match(prompt, /prefer finishing something over starting something/);
  assert.match(prompt, /<<<DEXNEST_NEXT>>>/);
});

test("the last authorized iteration is said plainly", (t) => {
  const h = fixture(t, [green(0)]);
  const spec = createRunSpec({ goal: "g" }, { id: "s", now: "2026-09-06T00:00:00.000Z" });
  const prompt = directorPrompt({
    spec, plan: new PlanStore(h.ports).view("loop-run", spec), iteration: 6, iterationsRemaining: 0,
    lastAssignment: null, workerReport: "done", verification: null
  });
  assert.match(prompt, /This is the last authorized iteration/);
});
