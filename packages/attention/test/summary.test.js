// Phase 13: the one line an operator reads. renderSummary turns a whole
// Decision into a plain-English sentence — what is being sent, what is being
// held, and why each held thing waits. The load-bearing test is the mixed
// night: each part must be named in a readable sentence, no held group may be
// silent, and an outstanding answer must surface rather than hide in a count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, renderSummary } from "../src/index.js";

// 02:30 local, inside a 23:00–08:00 quiet window.
const NOW = "2026-09-07T02:30:00-04:00";
const QUIET = { start: "23:00", end: "08:00" };

test("a mixed decision names each part in one readable sentence", () => {
  const items = [
    { id: "b1", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:05:00-04:00" },
    { id: "b2", source: "run", subject: "build-42", priority: "INFO", title: "iteration completed", at: "2026-09-07T02:20:00-04:00" },
    { id: "d1", source: "run", subject: "deploy-9", priority: "ACTION_REQUIRED", title: "approve migration?", at: "2026-09-07T02:10:00-04:00", answers: [{ id: "yes", label: "Approve" }] },
    { id: "m1", source: "run", subject: "monitor-1", priority: "URGENT", title: "disk almost full", at: "2026-09-07T02:15:00-04:00" },
  ];

  const decision = decide({ items, quietHours: QUIET, now: NOW });
  const line = renderSummary(decision);

  // One line, no jargon leaking through.
  assert.equal(line.includes("\n"), false);
  assert.doesNotMatch(line, /ACTION_REQUIRED|cooldown|quiet_hours|groupKey/);

  // The sent part names both piercing subjects.
  assert.match(line, /Sending/);
  assert.match(line, /deploy-9/);
  assert.match(line, /monitor-1/);

  // The held part names the routine subject and why it waits.
  assert.match(line, /Holding/);
  assert.match(line, /build-42/);
  assert.match(line, /quiet hours until 08:00/);
});

test("an outstanding answer surfaces in the sent part, not buried in a count", () => {
  const items = [
    { id: "d1", source: "run", subject: "deploy-9", priority: "ACTION_REQUIRED", title: "approve migration?", at: "2026-09-07T02:10:00-04:00", answers: [{ id: "yes", label: "Approve" }] },
  ];

  const line = renderSummary(decide({ items, quietHours: QUIET, now: NOW }));

  assert.match(line, /deploy-9/);
  assert.match(line, /needs your answer/);
});

test("cooldown holds are named with when they lift", () => {
  const items = [
    { id: "c1", source: "run", subject: "cache-3", priority: "ATTENTION", title: "cache warmed", at: "2026-09-07T09:25:00-04:00" },
  ];
  const delivered = [
    { groupKey: "run:cache-3", priority: "INFO", at: "2026-09-07T09:20:00-04:00" },
  ];
  // 09:30 is outside quiet hours, so only cooldown holds it.
  const line = renderSummary(
    decide({ items, delivered, quietHours: QUIET, now: "2026-09-07T09:30:00-04:00" })
  );

  assert.match(line, /Holding/);
  assert.match(line, /cache-3/);
  assert.match(line, /notified recently/);
});

test("a quiet night with nothing to send still says so out loud", () => {
  const line = renderSummary(decide({ items: [], quietHours: QUIET, now: NOW }));
  assert.equal(line, "Sending nothing right now. Holding nothing back.");
});

test("renderSummary refuses a non-decision", () => {
  assert.throws(() => renderSummary(null), /non-decision/);
});
