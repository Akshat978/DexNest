/** The Skill Constellation view's decisions, without React. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ConstellationSkill, ConstellationSnapshot, EvidenceView } from "@dexnest/skill-constellation";
import {
  groupEvidence,
  linkOpacity,
  nextStar,
  percent,
  shortDate,
  starLabel,
  starRadius,
  STAR_MAX_RADIUS,
  STAR_MIN_RADIUS,
  viewState,
  visibleSkills
} from "../src/renderer/views/skillConstellationModel.ts";

const staleness = { hasBuild: true, devChanged: false, settingsChanged: false, stale: false, devCursorSeq: 3, latestDevSeq: 3 };

function skill(id: string, extra: Partial<ConstellationSkill> = {}): ConstellationSkill {
  return {
    id, name: id.toUpperCase(), category: "language", evidenceCount: 3, repositoryCount: 2, evidenceKinds: 2,
    firstEvidenceAt: "2026-01-01T00:00:00.000Z", lastEvidenceAt: "2026-05-01T00:00:00.000Z", lastActivityAt: null,
    strength: { volume: 0.1, recency: 0.8, variety: 0.4, score: 0.42 }, hidden: false, ...extra
  };
}

function snapshot(extra: Partial<ConstellationSnapshot> = {}): ConstellationSnapshot {
  return { enabled: false, skills: [], links: [], layout: [], lastBuild: null, staleness, countsAllCommits: true, ...extra };
}

const build = {
  id: "b1", occurrenceId: "o", trigger: "manual" as const, status: "completed" as const, startedAt: "2026-06-01T00:00:00.000Z",
  finishedAt: "2026-06-01T00:00:01.000Z", devCursorSeq: 3, settingsFingerprint: "f", skills: 1, evidence: 3, links: 0,
  added: 1, lost: 0, refusedPrivate: 0, othersCommits: 0, error: null
};

test("view states: loading, error, off, empty, ready", () => {
  assert.equal(viewState({ loading: true, error: null, snapshot: null }).kind, "loading");
  assert.equal(viewState({ loading: false, error: null, snapshot: null }).kind, "loading");
  assert.deepEqual(viewState({ loading: false, error: "boom", snapshot: snapshot() }), { kind: "error", message: "boom" });
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot() }).kind, "off");
  // On but never built yet: nothing to draw, so it is the empty state, not "off".
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot({ enabled: true }) }).kind, "empty");
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot({ lastBuild: build }) }).kind, "empty");
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot({ lastBuild: build, skills: [skill("go")] }) }).kind, "ready");
});

test("hidden skills are left out unless asked for", () => {
  const skills = [skill("rust"), skill("go", { hidden: true })];
  assert.deepEqual(visibleSkills(skills, false).map((s) => s.id), ["rust"]);
  assert.deepEqual(visibleSkills(skills, true).map((s) => s.id), ["go", "rust"]);
});

test("star size and link opacity stay in bounds for any score", () => {
  assert.equal(starRadius(0), STAR_MIN_RADIUS);
  assert.equal(starRadius(1), STAR_MAX_RADIUS);
  assert.equal(starRadius(5), STAR_MAX_RADIUS);
  assert.equal(starRadius(Number.NaN), STAR_MIN_RADIUS);
  assert.ok(starRadius(0.6) > starRadius(0.3));
  assert.equal(linkOpacity(-1), 0.2);
  assert.equal(linkOpacity(1), 0.7);
});

test("arrow keys move to the nearest star in that direction", () => {
  //        n(500,100)
  // w(100,500)   c(500,500)   e(900,500)
  //        s(500,900)       far-e(950,520)
  const points = [
    { skillId: "c", x: 500, y: 500 }, { skillId: "n", x: 500, y: 100 }, { skillId: "s", x: 500, y: 900 },
    { skillId: "w", x: 100, y: 500 }, { skillId: "e", x: 900, y: 500 }, { skillId: "far-e", x: 950, y: 520 }
  ];
  assert.equal(nextStar(points, "c", "ArrowUp"), "n");
  assert.equal(nextStar(points, "c", "ArrowDown"), "s");
  assert.equal(nextStar(points, "c", "ArrowLeft"), "w");
  assert.equal(nextStar(points, "c", "ArrowRight"), "e");
  // Nothing further up from the top star: stay put rather than wrap somewhere surprising.
  assert.equal(nextStar(points, "n", "ArrowUp"), "n");
  assert.equal(nextStar(points, "c", "Home"), "n");
  assert.equal(nextStar(points, "c", "End"), "s");
  // No current star (first key press): start at the first in reading order.
  assert.equal(nextStar(points, null, "ArrowRight"), "n");
  assert.equal(nextStar([], "c", "ArrowRight"), null);
});

test("evidence groups by repository, busiest first, newest first inside", () => {
  const ev = (id: string, repo: string, at: string): EvidenceView => ({
    id, skillId: "go", kind: "commit", repositoryId: repo, repositoryName: repo === "r1" ? "app" : null, path: null, at,
    sourceRef: id, detail: null, todoText: null
  });
  const groups = groupEvidence([ev("a", "r1", "2026-01-01"), ev("b", "r2", "2026-02-01"), ev("c", "r1", "2026-03-01")]);
  assert.deepEqual(groups.map((g) => [g.repositoryName, g.items.map((i) => i.id), g.firstAt, g.lastAt]), [
    ["app", ["c", "a"], "2026-01-01", "2026-03-01"],
    ["r2", ["b"], "2026-02-01", "2026-02-01"]
  ]);
});

test("labels say what the numbers are, not a level", () => {
  assert.equal(percent(0.4249), "42%");
  assert.equal(percent(Number.NaN), "0%");
  assert.equal(shortDate("2026-05-01T12:30:00.000Z"), "2026-05-01");
  assert.equal(shortDate("never"), "unknown date");
  assert.equal(starLabel(skill("go")), "GO, language, strength 42%, 3 pieces of evidence in 2 repositories");
  assert.equal(starLabel(skill("go", { evidenceCount: 1, repositoryCount: 1 })), "GO, language, strength 42%, 1 piece of evidence in 1 repository");
  assert.match(starLabel(skill("pnpm", { category: "packageManager" })), /^PNPM, package manager,/);
});
