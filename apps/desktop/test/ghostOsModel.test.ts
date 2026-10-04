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
  PICKER_LIMIT,
  pickerKey,
  pickerMessage,
  pickerOptionId,
  pickerState,
  originLabel,
  RELATION_TYPE_LIST,
  relationTypeFromText,
  relationTypeText,
  sourceLabel,
  timelineKind,
  timelineLabel,
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
  const form = formFromDetail({ entity, relations: [], observations: [], derivedFrom: [], repositoryNames: {} });
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
  // The source is named, and a fact read straight from a repository says nothing about sureness.
  assert.equal(sourceLabel({ origin: "adapter", sourceId: "adapter:developer_intelligence", confidence: 1 }), "From your repositories");
  assert.equal(sourceLabel({ origin: "adapter", sourceId: "adapter:developer_intelligence", confidence: 0.6 }), "From your repositories · likely (60% sure)");
  assert.equal(sourceLabel({ origin: "derived", sourceId: "detector:time_of_day", confidence: 0.95 }), "Worked out from your commit times · very likely (95% sure)");
  assert.equal(sourceLabel({ origin: "adapter", sourceId: "adapter:something_new", confidence: 0.3 }), "From another source · a guess (30% sure)");
  assert.equal(originLabel("adapter", 1), "from your repositories");
  assert.equal(originLabel("adapter", 0.6), "from your repositories, likely (60% sure)");
  assert.equal(originLabel("derived", 0.95), "worked out from your commits, very likely (95% sure)");
  assert.equal(originLabel("manual", 1), "entered by you");
});

test("less than certain says why, when there is one reason", async () => {
  const { surenessReason } = await import("../src/renderer/views/ghostOsModel.ts");
  const commit = { kind: "commit" as const, repositoryId: "repo", sha: "abcdef1234", at: NOW };
  assert.match(surenessReason({ origin: "adapter", confidence: 0.6, evidence: [commit] }) ?? "", /^Commits in a repository are counted whoever wrote them/);
  assert.match(surenessReason({ origin: "derived", confidence: 0.75, evidence: [{ kind: "observation", observationId: "obs_1" }] }) ?? "", /more weeks of the same pattern/);
  assert.equal(surenessReason({ origin: "adapter", confidence: 1, evidence: [commit] }), null);
  assert.equal(surenessReason({ origin: "manual", confidence: 0.5, evidence: [{ kind: "manual" }] }), null);
});

test("evidence reads in project names and plain words, never ids", () => {
  const names = { repo_b2a5: "door-crew-website" };
  const tech = (evidencePath: string, evidenceKind: string) => ({ kind: "technology" as const, factId: "f", repositoryId: "repo_b2a5", evidencePath, evidenceKind });
  assert.equal(evidenceLabel(tech("package.json", "package.json#packageManager"), names), "Listed as the package manager in door-crew-website's package.json");
  assert.equal(evidenceLabel(tech("apps/web/package.json", "package.json#dependencies"), names), "Listed as a dependency in door-crew-website's package.json");
  assert.equal(evidenceLabel(tech("apps/web/package.json", "package.json#devDependencies"), names), "Listed as a dependency in door-crew-website's package.json");
  assert.equal(evidenceLabel(tech("src/main.ts", "file-extension"), names), "door-crew-website has files in this language (such as src/main.ts)");
  assert.equal(evidenceLabel(tech("go.mod", "go.mod"), names), "Named in door-crew-website's go.mod");
  assert.equal(evidenceLabel({ kind: "commit", repositoryId: "repo_b2a5", sha: "abcdef1234", at: NOW }, names), "Commit abcdef1 in door-crew-website, 30 Jun 2026, 12:00");
  assert.equal(evidenceLabel({ kind: "repository", repositoryId: "repo_b2a5" }, names), "Used in door-crew-website");
  assert.equal(evidenceLabel({ kind: "repository", repositoryId: "repo_b2a5" }, names, "project"), "A repository found by the repository scan");
  assert.equal(evidenceLabel({ kind: "observation", observationId: "obs_1" }, names), "A day of commits it was worked out from");
  // A repository GhostOS no longer holds has no name to give; its id is still not shown.
  assert.equal(evidenceLabel({ kind: "repository", repositoryId: "repo_gone" }, names), "Used in a repository GhostOS no longer holds");
  for (const line of [evidenceLabel(tech("package.json", "package.json"), names), evidenceLabel({ kind: "commit", repositoryId: "repo_b2a5", sha: "abcdef1234", at: NOW }, {})]) assert.doesNotMatch(line, /repo_b2a5/);
});

test("a connection reads from the entry that is open, and says when it is still going", async () => {
  const { connectionPhrase, relationDates, spanLabel } = await import("../src/renderer/views/ghostOsModel.ts");
  // On DeskNest: "Uses pnpm". On pnpm: "Used by DeskNest" - not "<- uses DeskNest".
  assert.equal(connectionPhrase("uses", "out"), "Uses");
  assert.equal(connectionPhrase("uses", "in"), "Used by");
  assert.equal(connectionPhrase("worked_on", "out"), "Worked on");
  assert.equal(connectionPhrase("worked_on", "in"), "Worked on by");
  assert.equal(connectionPhrase("part_of", "in"), "Includes");
  assert.equal(connectionPhrase("mentored", "in"), "On the other end of “mentored” from");

  assert.equal(spanLabel("2025-10-03T00:00:00.000Z", null), "since 3 Oct 2025 · ongoing");
  assert.equal(spanLabel("2025-10-03T00:00:00.000Z", "2026-03-01T00:00:00.000Z"), "3 Oct 2025 – 1 Mar 2026");
  assert.equal(spanLabel(null, "2026-03-01T00:00:00.000Z"), "until 1 Mar 2026");
  assert.equal(spanLabel(null, null), null);

  assert.deepEqual(relationDates("2025-10-03", "2026-03-01", true), { validFrom: "2025-10-03T00:00:00.000Z" }, "ongoing: no end is saved, whatever the field holds");
  assert.deepEqual(relationDates("2025-10-03", "2026-03-01", false), { validFrom: "2025-10-03T00:00:00.000Z", validTo: "2026-03-01T00:00:00.000Z" });
  assert.deepEqual(relationDates("", "", true), {});
});

test("Present / ongoing: an entry that has not ended saves no end date", () => {
  const base = { ...EMPTY_ENTITY_FORM, title: "Day job", type: "project" as const, when: "2024-01-08", endedAt: "2026-01-01" };
  assert.equal(EMPTY_ENTITY_FORM.ongoing, true, "ongoing unless the owner says it ended");
  assert.deepEqual(entityFromForm({ ...base, ongoing: true }), { type: "project", title: "Day job", notes: "", tags: [], startedAt: "2024-01-08T00:00:00.000Z", endedAt: undefined });
  assert.deepEqual(entityFromForm({ ...base, ongoing: false }), { type: "project", title: "Day job", notes: "", tags: [], startedAt: "2024-01-08T00:00:00.000Z", endedAt: "2026-01-01T00:00:00.000Z" });
  const event = entityFromForm({ ...base, type: "event", ongoing: true }) as { details: { endedAt?: string } };
  assert.equal(event.details.endedAt, undefined);
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

test("an ended connection reads as history on the timeline", () => {
  const item = { kind: "relation" as const, id: "rel_00000001", at: NOW, entityId: "ent_00000001", entityType: "project" as const, title: "cli", statement: "uses TypeScript", origin: "adapter" as const, confidence: 0.9, ongoing: false };
  assert.equal(timelineLabel(item), "cli stopped: uses TypeScript");
  assert.equal(timelineKind(item), "Connection ended");
  assert.equal(timelineKind({ ...item, kind: "entity" }), "Project");
  assert.equal(timelineKind({ ...item, kind: "observation" }), "Observation");
});

const hit = (id: string, title: string, type: "person" | "project" | "skill" = "project") => ({ id, type, title, timelineAt: NOW, origin: "manual" as const });

test("picker: nothing typed, searching, error, no results, results", () => {
  const base = { query: "", results: null, searching: false, error: null, excludeId: "ent_self0001" };
  assert.deepEqual(pickerState(base), { kind: "empty" });
  assert.deepEqual(pickerState({ ...base, query: "   " }), { kind: "empty" });
  assert.deepEqual(pickerState({ ...base, query: "ty", searching: true }), { kind: "searching" });
  assert.deepEqual(pickerState({ ...base, query: "ty" }), { kind: "searching" });
  assert.deepEqual(pickerState({ ...base, query: "ty", error: "locked" }), { kind: "error", message: "locked" });
  assert.deepEqual(pickerState({ ...base, query: " zz ", results: [] }), { kind: "no-results", query: "zz" });
  // The entry itself is never offered; if it was the only match, that is no results.
  assert.deepEqual(pickerState({ ...base, query: "self", results: [hit("ent_self0001", "Me")] }), { kind: "no-results", query: "self" });
  assert.deepEqual(pickerState({ ...base, query: "ty", results: [hit("ent_self0001", "Me"), hit("ent_ts000001", "TypeScript", "skill")] }), {
    kind: "results",
    options: [{ id: "ent_ts000001", title: "TypeScript", typeLabel: "Skill" }]
  });
  const many = Array.from({ length: 50 }, (_, i) => hit(`ent_many${String(i).padStart(4, "0")}`, `P${i}`));
  const capped = pickerState({ ...base, query: "p", results: many });
  assert.equal(capped.kind === "results" && capped.options.length, PICKER_LIMIT);
});

test("picker: what the live region says", () => {
  assert.equal(pickerMessage({ kind: "empty" }), "Type to search your entries.");
  assert.equal(pickerMessage({ kind: "searching" }), "Searching…");
  assert.equal(pickerMessage({ kind: "error", message: "locked" }), "Search failed: locked");
  assert.equal(pickerMessage({ kind: "no-results", query: "zz" }), "Nothing matches “zz”.");
  assert.equal(pickerMessage({ kind: "results", options: [{ id: "a", title: "A", typeLabel: "Person" }] }), "1 entry found. Use the arrow keys to choose.");
  assert.equal(pickerMessage({ kind: "results", options: [{ id: "a", title: "A", typeLabel: "Person" }, { id: "b", title: "B", typeLabel: "Person" }] }), "2 entries found. Use the arrow keys to choose.");
});

test("picker: keyboard - arrows wrap, Home/End, Enter chooses only a highlighted option, Escape closes", () => {
  assert.deepEqual(pickerKey("ArrowDown", -1, 3), { active: 0, action: "move" });
  assert.deepEqual(pickerKey("ArrowDown", 2, 3), { active: 0, action: "move" });
  assert.deepEqual(pickerKey("ArrowUp", 0, 3), { active: 2, action: "move" });
  assert.deepEqual(pickerKey("ArrowUp", -1, 3), { active: 2, action: "move" });
  assert.deepEqual(pickerKey("Home", 2, 3), { active: 0, action: "move" });
  assert.deepEqual(pickerKey("End", 0, 3), { active: 2, action: "move" });
  assert.deepEqual(pickerKey("Enter", 1, 3), { active: 1, action: "choose" });
  assert.equal(pickerKey("Enter", -1, 3), null, "Enter with nothing highlighted is not a choice");
  assert.deepEqual(pickerKey("Escape", 1, 3), { active: -1, action: "close" });
  assert.deepEqual(pickerKey("Escape", -1, 0), { active: -1, action: "close" });
  assert.equal(pickerKey("ArrowDown", -1, 0), null, "no options, nothing to move to");
  assert.equal(pickerKey("a", 0, 3), null, "typing goes to the input");
  assert.equal(pickerOptionId("ent_ts000001"), "ghost-pick-ent_ts000001");
});

test("relation types read as words and are stored as ids, round trip for every built-in type", () => {
  assert.equal(relationTypeText("learned_from"), "learned from");
  assert.equal(relationTypeFromText("  Learned From "), "learned_from");
  assert.equal(relationTypeFromText("part-of"), "part_of");
  for (const t of RELATION_TYPE_LIST) assert.equal(relationTypeFromText(relationTypeText(t)), t);
});

test("timeline rows group by day in their own order; headings say Today and Yesterday", async () => {
  const { groupByDay, dayHeading, sourcesOn } = await import("../src/renderer/views/ghostOsModel.ts");
  const rows = [{ at: "2026-06-03T09:00:00.000Z", id: "a" }, { at: "2026-06-03T01:00:00.000Z", id: "b" }, { at: "2026-06-01T09:00:00.000Z", id: "c" }];
  assert.deepEqual(groupByDay(rows).map((g) => [g.day, g.items.map((i) => i.id)]), [["2026-06-03", ["a", "b"]], ["2026-06-01", ["c"]]]);
  assert.deepEqual(groupByDay([]), []);
  assert.equal(dayHeading("2026-06-03", "2026-06-03"), "Today");
  assert.equal(dayHeading("2026-06-02", "2026-06-03"), "Yesterday");
  assert.equal(dayHeading("2026-02-28", "2026-03-01"), "Yesterday", "across a month end");
  assert.equal(dayHeading("2026-05-30", "2026-06-03"), "30 May 2026");
  assert.deepEqual(sourcesOn({ adapters: [{ enabled: true, installed: true }, { enabled: false, installed: true }, { enabled: false, installed: false }] } as never), { on: 1, installed: 2 });
});
