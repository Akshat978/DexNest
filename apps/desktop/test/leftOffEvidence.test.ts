// Integration QA P10: "Where you left off" says what each piece of evidence was.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { evidenceLine } from "../src/main/leftOffEvidence.ts";

const events = [
  { eventId: "e1", type: "dev.commit.observed", payload: { sha: "abcdef1234567", subject: "fix cart" } },
  { eventId: "e2", type: "dev.working_tree.changed", payload: {} },
  { eventId: "e3", type: "dev.something.new", payload: {} }
];

test("each ref says what it was and the day it was seen", () => {
  assert.equal(evidenceLine({ kind: "snapshot", id: "s1", observedAt: "2026-10-02T09:00:00.000Z" }, events), "Working tree scanned · 2026-10-02");
  assert.equal(evidenceLine({ kind: "event", id: "e1", observedAt: "2026-10-01T09:00:00.000Z" }, events), "Commit abcdef1 · 2026-10-01");
  assert.equal(evidenceLine({ kind: "event", id: "e2", observedAt: "2026-10-02T10:00:00.000Z" }, events), "Uncommitted changes · 2026-10-02");
});

test("an unknown event type or a missing event still reads as words, never a raw kind", () => {
  assert.equal(evidenceLine({ kind: "event", id: "e3" }, events), "Activity");
  assert.equal(evidenceLine({ kind: "event", id: "gone", observedAt: "2026-10-02T00:00:00.000Z" }, events), "Activity · 2026-10-02");
  assert.equal(evidenceLine({ kind: "working_tree", id: "w" }, []), "Working tree");
});

test("a commit never shows its subject, only a short sha", () => {
  assert.doesNotMatch(evidenceLine({ kind: "event", id: "e1" }, events), /fix cart/);
});
