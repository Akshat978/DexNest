// Phase 11: rendering for a notification. A notification is read where nothing
// else is available — no network, no app to open. The load-bearing tests are
// the last two: an answerable item must name every option it offers, and
// truncation must never cut the question (or an option) in half. A half-asked
// question that woke someone at 3am is worse than not asking.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeItem,
  renderNotification,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATION_BODY_MAX,
} from "../src/index.js";

const AT = "2026-09-07T03:00:00.000Z";

test("a routine item renders a title and body within the limits", () => {
  const item = makeItem({
    id: "run-7:done",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "run finished",
    detail: "run-7 finished cleanly after 6 iterations",
    at: AT,
  });

  const note = renderNotification(item);

  assert.ok(note.title.length <= NOTIFICATION_TITLE_MAX);
  assert.ok(note.body.length <= NOTIFICATION_BODY_MAX);
  assert.equal(note.answerable, false);
  assert.deepEqual(note.options, []);
  assert.ok(note.body.includes("finished cleanly"));
});

test("a long routine body is shortened at a word boundary, never mid-word", () => {
  const detail = "iteration ".repeat(60).trim(); // well over the body limit
  const item = makeItem({
    id: "run-7:spam",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "many iterations",
    detail,
    at: AT,
  });

  const note = renderNotification(item);

  assert.ok(note.body.length <= NOTIFICATION_BODY_MAX);
  assert.equal(note.truncated, true);
  assert.ok(note.body.endsWith("…"));
  // No word was split: dropping the ellipsis leaves only whole words.
  const withoutEllipsis = note.body.slice(0, -1).trimEnd();
  assert.ok(detail.startsWith(withoutEllipsis));
  assert.ok(detail[withoutEllipsis.length] === " " || detail[withoutEllipsis.length] === undefined);
});

test("an answerable item names every option it offers", () => {
  const item = makeItem({
    id: "run-7:approve",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: "Approve the proposed completion of run-7?",
    detail: "The worker proposes it is done.",
    at: AT,
    answers: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
      { id: "more", label: "Ask for more work" },
    ],
  });

  const note = renderNotification(item);

  assert.equal(note.answerable, true);
  assert.deepEqual(note.options, ["Approve", "Reject", "Ask for more work"]);
  for (const label of ["Approve", "Reject", "Ask for more work"]) {
    assert.ok(note.body.includes(label), `body should name option ${label}`);
  }
});

test("truncation never cuts an answerable question or its options in half", () => {
  const question = "Approve the proposed completion of run-7 after it ran for a very long time and produced a very large diff that nobody has yet read?";
  const detail = "context ".repeat(80).trim(); // huge, must be sacrificed first
  const item = makeItem({
    id: "run-7:big",
    source: "run",
    subject: "run-7",
    priority: "ACTION_REQUIRED",
    title: question,
    detail,
    at: AT,
    answers: [
      { id: "approve", label: "Approve and merge" },
      { id: "reject", label: "Reject and stop" },
    ],
  });

  const note = renderNotification(item);

  // The question and every option survive in full, however long they are.
  assert.ok(note.body.includes(question), "question must appear whole");
  assert.ok(note.body.includes("Approve and merge"));
  assert.ok(note.body.includes("Reject and stop"));
  assert.equal(note.truncated, true);
});

test("an answerable item with no detail still carries its question and options", () => {
  const item = makeItem({
    id: "q:only",
    source: "run",
    subject: "run-9",
    priority: "ACTION_REQUIRED",
    title: "Continue?",
    at: AT,
    answers: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  });

  const note = renderNotification(item);

  assert.ok(note.body.includes("Continue?"));
  assert.ok(note.body.includes("Yes"));
  assert.ok(note.body.includes("No"));
  assert.equal(note.truncated, false);
});

test("rendering does not mutate the item and refuses a non-item", () => {
  const item = makeItem({
    id: "run-7:done",
    source: "run",
    subject: "run-7",
    priority: "INFO",
    title: "run finished",
    at: AT,
  });
  const before = JSON.stringify(item);
  renderNotification(item);
  assert.equal(JSON.stringify(item), before);

  assert.throws(() => renderNotification(null), /non-item/);
});
