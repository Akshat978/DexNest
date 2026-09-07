// Phase 12: answers. The engine validates an answer; it never performs one.
// The load-bearing tests are the refusals: answering an item that asked
// nothing, and answering with an id it never offered, must each throw a message
// that names the offending value — proving that when the engine withholds, it
// still says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeItem, answersFor, validateAnswer } from "../src/index.js";

const AT = "2026-09-07T03:00:00.000Z";

/** An answerable item offering the given { id, label } options. */
function answerable(answers) {
  return makeItem({
    id: "run-7:continue",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: "run-7 is waiting for a decision",
    detail: "The proposed completion needs a yes or no.",
    at: AT,
    answers,
  });
}

test("answersFor returns every option an item offered, in order", () => {
  const item = answerable([
    { id: "accept", label: "Accept" },
    { id: "reject", label: "Reject" },
  ]);
  assert.deepEqual(answersFor(item), [
    { id: "accept", label: "Accept" },
    { id: "reject", label: "Reject" },
  ]);
});

test("answersFor a single-option item returns that one option", () => {
  const item = answerable([{ id: "ok", label: "OK" }]);
  assert.deepEqual(answersFor(item), [{ id: "ok", label: "OK" }]);
});

test("answersFor an item that offered nothing is an empty list, not a throw", () => {
  const item = makeItem({
    id: "run-7:done",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "run-7 finished cleanly",
    at: AT,
  });
  assert.deepEqual(answersFor(item), []);
});

test("answersFor does not mutate the item's answers", () => {
  const item = answerable([{ id: "accept", label: "Accept" }]);
  const out = answersFor(item);
  out.push({ id: "sneaky", label: "Sneaky" });
  assert.equal(item.answers.length, 1);
  assert.deepEqual(answersFor(item), [{ id: "accept", label: "Accept" }]);
});

test("validateAnswer returns the offered option for an id it offered", () => {
  const item = answerable([
    { id: "accept", label: "Accept" },
    { id: "reject", label: "Reject" },
  ]);
  assert.deepEqual(validateAnswer(item, "reject"), {
    id: "reject",
    label: "Reject",
  });
});

test("validateAnswer accepts a two-option shape by either id", () => {
  const item = answerable([
    { id: "retry", label: "Retry" },
    { id: "abort", label: "Abort" },
  ]);
  assert.equal(validateAnswer(item, "retry").label, "Retry");
  assert.equal(validateAnswer(item, "abort").label, "Abort");
});

test("answering an item that offered nothing is refused, naming the item", () => {
  const item = makeItem({
    id: "run-7:done",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "run-7 finished cleanly",
    at: AT,
  });
  assert.throws(() => validateAnswer(item, "accept"), (err) => {
    assert.match(err.message, /offers no answers/);
    assert.match(err.message, /"run-7:done"/);
    return true;
  });
});

test("answering with an id the item never offered is refused, naming the id", () => {
  const item = answerable([
    { id: "accept", label: "Accept" },
    { id: "reject", label: "Reject" },
  ]);
  assert.throws(() => validateAnswer(item, "maybe"), (err) => {
    assert.match(err.message, /never offered/);
    assert.match(err.message, /"maybe"/);
    assert.match(err.message, /accept, reject/);
    return true;
  });
});

test("answering with a blank id is refused, listing the real options", () => {
  const item = answerable([{ id: "ok", label: "OK" }]);
  assert.throws(() => validateAnswer(item, "  "), (err) => {
    assert.match(err.message, /has no id/);
    assert.match(err.message, /ok/);
    return true;
  });
});

test("validateAnswer refuses a non-item rather than reading through it", () => {
  assert.throws(() => validateAnswer(null, "accept"), /non-item/);
});
