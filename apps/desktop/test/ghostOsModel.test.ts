/** GhostOS view model: pure functions, no React, no Electron. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BUILT_IN_RELATION_TYPES, ENTITY_TYPES, parseEntityInput } from "@dexnest/ghost-os";
import {
  actionMessage,
  EMPTY_ENTITY_FORM,
  ENTITY_TYPE_LIST,
  entityFromForm,
  evidenceLabel,
  fieldsFor,
  formFromDetail,
  nextTab,
  originLabel,
  RELATION_TYPE_LIST,
  sourceLabel,
  TYPE_LABELS,
  viewState
} from "../src/renderer/views/ghostOsModel.ts";

const NOW = "2026-06-30T12:00:00.000Z";

test("the view's lists match the package's", () => {
  assert.deepEqual([...ENTITY_TYPE_LIST], [...ENTITY_TYPES]);
  assert.deepEqual([...RELATION_TYPE_LIST], [...BUILT_IN_RELATION_TYPES]);
  assert.deepEqual(Object.keys(TYPE_LABELS).sort(), [...ENTITY_TYPES].sort());
});

test("every form shape is one the module accepts", () => {
  const filled = { ...EMPTY_ENTITY_FORM, title: "t", when: "2026-06-01", text: "x", choice: "c", alternatives: "a\nb\n", path: "/home/me/a.txt", participants: "A, B", tags: "one, two" };
  for (const type of ENTITY_TYPE_LIST) {
    const input = entityFromForm({ ...filled, type });
    const parsed = parseEntityInput(input, NOW);
    assert.equal(parsed.ok, true, `${type}: ${parsed.ok ? "" : parsed.errors.join("; ")}`);
  }
  const decision = entityFromForm({ ...filled, type: "decision" }) as { details: { alternatives: string[] }; tags: string[] };
  assert.deepEqual(decision.details.alternatives, ["a", "b"]);
  assert.deepEqual(decision.tags, ["one", "two"]);
});

test("an edit round-trips through the form", () => {
  const entity = { id: "ent_00000001", type: "decision" as const, title: "Move", notes: "n", tags: ["x"], details: { decidedAt: "2026-05-01T00:00:00.000Z", choice: "go", alternatives: ["stay"], rationale: "why", outcome: null, outcomeAt: null, reviewAt: null }, occurredAt: "2026-05-01T00:00:00.000Z", startedAt: null, endedAt: null, provenance: { origin: "manual" as const, sourceId: null, sourceRef: null, evidence: [{ kind: "manual" as const }], confidence: 1 }, createdAt: NOW, updatedAt: NOW };
  const form = formFromDetail({ entity, relations: [], observations: [], derivedFrom: [] });
  assert.equal(form.id, entity.id);
  assert.equal(form.when, "2026-05-01");
  assert.deepEqual(entityFromForm(form), { id: entity.id, type: "decision", title: "Move", notes: "n", tags: ["x"], details: { decidedAt: "2026-05-01T00:00:00.000Z", choice: "go", alternatives: ["stay"], rationale: "why" } });
});

test("each type shows only its own fields", () => {
  assert.deepEqual(fieldsFor("file"), ["path", "label"]);
  assert.deepEqual(fieldsFor("conversation"), ["text", "participants"]);
  assert.deepEqual(fieldsFor("person"), ["when", "endedAt"]);
});

test("every fact says where it came from and how sure", () => {
  assert.equal(sourceLabel({ origin: "manual", sourceId: null, confidence: 1 }), "Entered by you");
  assert.equal(sourceLabel({ origin: "manual", sourceId: null, confidence: 0.5 }), "Entered by you · you said 50% sure");
  assert.equal(sourceLabel({ origin: "adapter", sourceId: "adapter:developer_intelligence", confidence: 0.6 }), "From Developer Intelligence · 60% sure");
  assert.equal(sourceLabel({ origin: "derived", sourceId: "detector:time_of_day", confidence: 0.95 }), "Derived by GhostOS habit detection (time of day) · 95% sure");
  assert.equal(originLabel("adapter", 0.9), "from a source, 90% sure");
  assert.equal(evidenceLabel({ kind: "commit", repositoryId: "repo", sha: "abcdef1234", at: NOW }), "Commit abcdef1 in repo at 2026-06-30 12:00");
  assert.equal(evidenceLabel({ kind: "technology", factId: "f", repositoryId: "repo", evidencePath: "package.json", evidenceKind: "package.json" }), "Technology fact in repo: package.json (package.json)");
});

test("states, tabs and messages", () => {
  const status = { adapters: [], syncing: false, lastRun: null, lastError: null, searchMode: "fts" as const, counts: { entity: 0, relation: 0, observation: 0 } };
  assert.deepEqual(viewState({ loading: true, error: null, status: null }), { kind: "loading" });
  assert.deepEqual(viewState({ loading: false, error: "x", status }), { kind: "error", message: "x" });
  assert.deepEqual(viewState({ loading: false, error: null, status }), { kind: "empty" });
  assert.deepEqual(viewState({ loading: false, error: null, status: { ...status, counts: { entity: 1, relation: 0, observation: 0 } } }), { kind: "ready" });
  assert.equal(nextTab("timeline", "ArrowRight"), "add");
  assert.equal(nextTab("timeline", "ArrowLeft"), "sources");
  assert.equal(nextTab("add", "Home"), "timeline");
  assert.equal(nextTab("add", "End"), "sources");
  assert.equal(nextTab("add", "a"), null);
  assert.deepEqual(actionMessage({ ok: true, message: "Saved." }), { ok: true, text: "Saved." });
  assert.deepEqual(actionMessage({ ok: false, cancelled: true, error: "Export cancelled." }), { ok: true, text: null });
  assert.deepEqual(actionMessage({ ok: false, error: "no" }), { ok: false, text: "no" });
  assert.deepEqual(actionMessage(undefined), { ok: false, text: "No answer from DexNest." });
});
