// The morning: reading what happened, and answering it.
//
// Two things a person does after an overnight run, neither of which had
// anywhere to live before this. They say something ("the error handling is the
// wrong shape") before letting it carry on, and they answer the run's own
// claim to be finished.
//
// Both are the same shape of problem: the agent must not be able to settle
// them, and the person must not have to leave DexNest to settle them either.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openLoop, initWorktree, type LoopPlanStep } from "./helpers/loopHarness.ts";
import { LoopStore } from "../src/loopStore.ts";
import { OperatorNoteStore, renderOperatorNote, MAX_OPERATOR_NOTE_CHARS } from "../src/operatorNote.ts";

const say = (body: string) => `<<<DEXNEST_NEXT>>>\n${body}\n<<<END_DEXNEST_NEXT>>>`;
const CONTINUE = say("decision: CONTINUE\nassignment: Add the next file.");
const COMPLETE = say("decision: PLAN_COMPLETE\nreason: everything asked for is there");

const step = (index: number, tail: string): LoopPlanStep => ({
  emitFiles: [{ path: `file-${index}.txt`, contents: `${index}\n` }],
  verify: { typecheck: 0 },
  say: tail
});

function fixture(t: { after(fn: () => void): void }, plan: LoopPlanStep[]) {
  const root = mkdtempSync(resolve(tmpdir(), "dexnest-morning-"));
  initWorktree(resolve(root, "worktree"), plan, { typecheck: 1 });
  const h = openLoop(root);
  h.createRun();
  t.after(() => {
    try { h.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return h;
}

const prompts = (h: ReturnType<typeof openLoop>) =>
  new LoopStore(h.ports).turns("loop-run").map(turn => turn.prompt);

// --- the note ---------------------------------------------------------------

test("a note reaches the next prompt, attributed", async (t) => {
  const h = fixture(t, [step(0, CONTINUE), step(1, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" });
  await h.loop.run("loop-run");

  h.loop.notes.add({ runId: "loop-run", text: "Use the existing logger; do not add a second one.", author: "akshat" });
  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  await h.loop.run("loop-run");

  const [first, second] = prompts(h);
  assert.equal(first!.includes("A NOTE FROM THE PERSON RUNNING THIS"), false, "no note existed yet");
  assert.ok(second!.includes("A NOTE FROM THE PERSON RUNNING THIS"), second);
  assert.ok(second!.includes("Written by akshat at"), "attributed, or it is indistinguishable from the agent's own note");
  assert.ok(second!.includes("do not add a second one"), second);

  // Behind the goal, ahead of everything else: it outranks the agent's own
  // plan for the turn, and nothing else in the prompt.
  assert.ok(second!.indexOf("A NOTE FROM") < second!.indexOf("WHAT HAS ALREADY BEEN DONE"));
});

test("a note is acted on once, not until midnight", async (t) => {
  const h = fixture(t, [step(0, CONTINUE), step(1, CONTINUE), step(2, COMPLETE)]);
  h.loop.notes.add({ runId: "loop-run", text: "Prefer small commits.", author: "akshat" });
  h.loop.authorize({ runId: "loop-run", maxTurns: 4, grantedBy: "human" });
  await h.loop.run("loop-run");

  const carried = prompts(h).filter(prompt => prompt.includes("Prefer small commits."));
  assert.equal(carried.length, 1, "one sentence at breakfast is not a standing instruction");

  const notes = new OperatorNoteStore(h.ports).list("loop-run");
  assert.equal(notes.length, 1);
  assert.ok(notes[0]!.consumedTurnId, "bound to the turn that carried it");
  assert.equal(h.loop.notes.pending("loop-run"), null);
});

test("the later of two notes is the one meant, and the earlier is not erased", async (t) => {
  const h = fixture(t, [step(0, COMPLETE)]);
  const first = h.loop.notes.add({ runId: "loop-run", text: "Start with the parser.", author: "akshat" });
  h.loop.notes.add({ runId: "loop-run", text: "Actually, start with the tests.", author: "akshat" });

  assert.equal(h.loop.notes.pending("loop-run")!.text, "Actually, start with the tests.");

  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  await h.loop.run("loop-run");

  const prompt = prompts(h)[0]!;
  assert.ok(prompt.includes("Actually, start with the tests."), prompt);
  assert.equal(prompt.includes("Start with the parser."), false, "the correction replaced it");

  const kept = new OperatorNoteStore(h.ports).list("loop-run").find(note => note.id === first.id)!;
  assert.equal(kept.consumedTurnId, null, "still in the journal, visibly unused");
});

test("a note has to say something, and cannot be a pasted document", (t) => {
  const h = fixture(t, [step(0, COMPLETE)]);
  assert.throws(() => h.loop.notes.add({ runId: "loop-run", text: "   " }), /needs something in it/);
  assert.throws(
    () => h.loop.notes.add({ runId: "loop-run", text: "x".repeat(MAX_OPERATOR_NOTE_CHARS + 1) }),
    /at most 4000 characters/
  );
  // No account system exists, and inventing an identity would be worse than
  // admitting there is none.
  assert.equal(h.loop.notes.add({ runId: "loop-run", text: "Anonymous." }).author, "operator");
});

test("the rendered note says what it may and may not change", () => {
  const text = renderOperatorNote({
    id: "n1", runId: "r", text: "Drop the caching layer.", author: "akshat",
    createdAt: "2026-09-06T08:00:00.000Z", consumedTurnId: null
  });
  assert.ok(text.includes("takes precedence over the next step"), text);
  assert.ok(text.includes("does not change the goal"), text);
  assert.ok(text.includes("say so rather than quietly picking one"), text);
});

// --- accepting and rejecting a proposed completion --------------------------

test("accepting is what finishes a run the agent only proposed finishing", async (t) => {
  const h = fixture(t, [step(0, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "human" });

  const outcome = await h.loop.run("loop-run");
  assert.equal(outcome.reason, "plan_complete_proposed");
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED", "proposed, not finished");

  const proposal = h.loop.planCompleteProposal("loop-run");
  assert.ok(proposal, "the proposal is readable, so a UI can offer the two answers");
  assert.ok(proposal!.reason!.includes("everything asked for is there"));

  h.loop.acceptPlanComplete("loop-run", { by: "akshat" });
  assert.equal(h.store.requireRun("loop-run").state, "COMPLETED");
  assert.equal(new LoopStore(h.ports).activeGrant("loop-run"), null, "the authorization is spent, not left open");

  const accepted = h.store.listEvents("loop-run").find(event => event.type === "PLAN_COMPLETE_ACCEPTED");
  assert.ok(accepted, "who accepted it is part of the record");
  assert.equal((accepted!.payload as { by: string }).by, "akshat");
});

test("rejecting needs a reason, because the reason is the answer", async (t) => {
  const h = fixture(t, [step(0, COMPLETE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 3, grantedBy: "human" });
  await h.loop.run("loop-run");

  // Handing back the same evidence that produced "I am finished" would produce
  // "I am finished" again.
  assert.throws(() => h.loop.rejectPlanComplete("loop-run", { reason: "  " }), /Say what is still missing/);
});

test("a rejection becomes the instruction for the next turn", async (t) => {
  const h = fixture(t, [step(0, COMPLETE), step(1, COMPLETE)]);
  // One authorization throughout: a proposed completion holds the run but
  // leaves the grant open, because the turns were never spent.
  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  await h.loop.run("loop-run");

  const note = h.loop.rejectPlanComplete("loop-run", { reason: "The error paths have no tests.", by: "akshat" });
  assert.equal(note.text, "The error paths have no tests.");
  assert.equal(h.store.requireRun("loop-run").state, "PAUSED", "rejecting decides; starting is still separate");

  await h.loop.run("loop-run");

  const prompt = prompts(h)[1]!;
  assert.ok(prompt.includes("The error paths have no tests."), prompt);
  assert.ok(prompt.includes("Written by akshat at"), prompt);
});

test("neither answer applies to a run that is not waiting on a proposal", async (t) => {
  const h = fixture(t, [step(0, CONTINUE), step(1, COMPLETE)]);
  assert.equal(h.loop.planCompleteProposal("loop-run"), null, "nothing has run yet");
  assert.throws(() => h.loop.acceptPlanComplete("loop-run"), /not waiting on a proposed completion/);

  h.loop.authorize({ runId: "loop-run", maxTurns: 1, grantedBy: "human" });
  await h.loop.run("loop-run");
  assert.equal(h.loop.planCompleteProposal("loop-run"), null, "it said CONTINUE, not that it was done");
  assert.throws(() => h.loop.rejectPlanComplete("loop-run", { reason: "no" }), /not waiting on a proposed completion/);
});

test("a proposal a later turn has moved past can no longer be accepted", async (t) => {
  // The last hold being plan_complete_proposed is not enough on its own: a
  // later turn can run and stop for some other reason, leaving that stale hold
  // as the most recent one of its kind. Accepting then would complete a run
  // sitting somewhere else entirely.
  const h = fixture(t, [step(0, COMPLETE), step(1, CONTINUE)]);
  h.loop.authorize({ runId: "loop-run", maxTurns: 2, grantedBy: "human" });
  await h.loop.run("loop-run");
  assert.ok(h.loop.planCompleteProposal("loop-run"));

  await h.loop.run("loop-run");

  assert.equal(h.loop.planCompleteProposal("loop-run"), null, "the run has moved on");
  assert.throws(() => h.loop.acceptPlanComplete("loop-run"), /not waiting on a proposed completion/);
  assert.notEqual(h.store.requireRun("loop-run").state, "COMPLETED");
});

// --- older databases --------------------------------------------------------

test("a database from before notes existed simply has none", (t) => {
  const h = fixture(t, [step(0, COMPLETE)]);
  h.ports.db.exec("DROP TABLE autopilot_operator_notes");
  const notes = new OperatorNoteStore(h.ports);

  assert.deepEqual(notes.list("loop-run"), []);
  assert.equal(notes.pending("loop-run"), null);
  notes.consume("whatever", "turn-1");
  assert.throws(() => notes.add({ runId: "loop-run", text: "hello" }), /too old to record notes/);
});
