/** The Skill Constellation view's decisions, without React. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ConstellationSkill, ConstellationSnapshot, EvidenceView } from "@dexnest/skill-constellation";
import {
  labelOffset,
  labelSides,
  countOf,
  groupEvidence,
  LABEL_LIMIT,
  labelledIds,
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
    firstEvidenceAt: "2026-01-01T00:00:00.000Z", lastEvidenceAt: "2026-05-01T00:00:00.000Z",
    activityCount: 12, firstActivityAt: "2025-11-03T00:00:00.000Z", lastActivityAt: "2026-03-03T00:00:00.000Z", basis: "work",
    strength: { volume: 0.1, recency: 0.8, variety: 0.4, score: 0.42 }, hidden: false, ...extra
  };
}

function snapshot(extra: Partial<ConstellationSnapshot> = {}): ConstellationSnapshot {
  return { enabled: false, skills: [], links: [], layout: [], repositoryActivity: [], lastBuild: null, staleness, countsAllCommits: true, ...extra };
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
  assert.equal(shortDate("2026-05-01T12:30:00.000Z"), "1 May 2026");
  assert.equal(shortDate("never"), "unknown date");
  assert.equal(starLabel(skill("go")), "GO, language, strength 42%, 3 pieces of evidence in 2 repositories");
  assert.equal(starLabel(skill("go", { evidenceCount: 1, repositoryCount: 1 })), "GO, language, strength 42%, 1 piece of evidence in 1 repository");
  assert.match(starLabel(skill("pnpm", { category: "packageManager" })), /^PNPM, package manager,/);
});

test("every star in a real constellation is named; past the limit, the strongest and whatever the owner is pointing at", () => {
  const star = (i: number) => skill(`s${String(i).padStart(2, "0")}`, { strength: { volume: 0, recency: 0, variety: 0, score: 1 - i / 100 } });
  // Seventeen skills, as on the day two of them had no name.
  assert.equal(labelledIds(Array.from({ length: 17 }, (_, i) => star(i))).size, 17);
  const many = Array.from({ length: 50 }, (_, i) => star(i));
  const ids = labelledIds(many);
  assert.equal(ids.size, LABEL_LIMIT);
  assert.ok(LABEL_LIMIT >= 40);
  assert.ok(ids.has("s00") && ids.has("s39") && !ids.has("s40"));
  const withHover = labelledIds(many, ["s49", null, "s45"]);
  assert.ok(withHover.has("s49") && withHover.has("s45"));
  assert.equal(withHover.size, LABEL_LIMIT + 2);
});

test("a repository's evidence reads as one line from the whole counts, work first and TODOs last", async () => {
  const { countsFromEvidence, orderEvidence, summariseRepositories } = await import("../src/renderer/views/skillConstellationModel.ts");
  const count = (repositoryId: string, kind: EvidenceView["kind"], n: number, repositoryName: string | null = repositoryId) => ({ repositoryId, repositoryName, kind, count: n });
  const summaries = summariseRepositories([
    count("r1", "todo.open", 123, "DeskNest"),
    count("r1", "commit", 1204, "DeskNest"),
    count("r1", "technology.extension", 1, "DeskNest"),
    count("r1", "technology.manifest", 2, "DeskNest"),
    count("r2", "commit", 1, null),
    count("r2", "todo.resolved", 1, null)
  ]);
  assert.deepEqual(summaries, [
    { repositoryId: "r1", repositoryName: "DeskNest", total: 1330, line: "1204 commits · named in 2 manifests · files in this language · 123 open TODOs" },
    { repositoryId: "r2", repositoryName: "r2", total: 2, line: "1 commit · 1 resolved TODO" }
  ]);

  const ev = (id: string, kind: EvidenceView["kind"], at: string): EvidenceView => ({
    id, skillId: "go", kind, repositoryId: "r1", repositoryName: "app", path: null, at, sourceRef: id, detail: null, todoText: null
  });
  const rows = [ev("t", "todo.open", "2026-09-01"), ev("c1", "commit", "2026-01-01"), ev("m", "technology.manifest", "2026-10-01"), ev("c2", "commit", "2026-03-01")];
  assert.deepEqual(orderEvidence(rows).map((r) => r.id), ["c2", "c1", "m", "t"], "the newest TODO no longer leads the list");
  assert.deepEqual(summariseRepositories(countsFromEvidence(rows)).map((s) => s.line), ["2 commits · named in a manifest · 1 open TODO"]);
});

test("a hidden star says so in its accessible name; counts read as words", () => {
  assert.match(starLabel(skill("go", { hidden: true })), /, hidden$/);
  assert.doesNotMatch(starLabel(skill("go")), /hidden/);
  assert.equal(countOf(1, "repository", "repositories"), "1 repository");
  assert.equal(countOf(3, "kind", "kinds"), "3 kinds");
});

test("labels: two close stars never write their names over each other, or over each other's star", () => {
  // Next.js and React as laid out on the seeded data, side by side. Below its
  // star, "Next.js" would run across the React star, so it goes above, and
  // React keeps the default.
  const sides = labelSides([
    { id: "react", name: "React", x: 740, y: 609, r: 9 },
    { id: "next", name: "Next.js", x: 706, y: 603, r: 9 }
  ]);
  assert.equal(sides.get("next"), "above");
  assert.equal(sides.get("react"), "below");
  assert.equal(labelOffset(9, "below"), 27);
  assert.equal(labelOffset(9, "above"), -19);
});

test("labels: three stacked stars use the sides too, and every placement clears the others", async () => {
  const { labelPlacement } = await import("../src/renderer/views/skillConstellationModel.ts");
  // PostgreSQL, Python and Go as in the harness: a diagonal stack ~40 units apart.
  const stars = [
    { id: "pg", name: "PostgreSQL", x: 922, y: 660, r: 9 },
    { id: "py", name: "Python", x: 897, y: 693, r: 9 },
    { id: "go", name: "Go", x: 871, y: 725, r: 14 }
  ];
  const sides = labelSides(stars);
  assert.equal(new Set(sides.values()).size, 3, "no two labels share a side here");
  // Each label's box clears every other star and every other label.
  const box = (s: (typeof stars)[number]) => {
    const p = labelPlacement(s.r, sides.get(s.id)!);
    const w = s.name.length * 12;
    const left = p.anchor === "middle" ? s.x + p.dx - w / 2 : p.anchor === "start" ? s.x + p.dx : s.x + p.dx - w;
    return { left, right: left + w, top: s.y + p.dy - 20, bottom: s.y + p.dy + 6 };
  };
  const hit = (a: ReturnType<typeof box>, b: { left: number; right: number; top: number; bottom: number }) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const a of stars) {
    for (const b of stars) {
      if (a === b) continue;
      assert.equal(hit(box(a), { left: b.x - b.r, right: b.x + b.r, top: b.y - b.r, bottom: b.y + b.r }), false, `${a.name}'s label clears ${b.name}'s star`);
      assert.equal(hit(box(a), box(b)), false, `${a.name} and ${b.name} labels don't overlap`);
    }
  }
  assert.deepEqual(labelPlacement(10, "right"), { dx: 18, dy: 7, anchor: "start" });
  assert.deepEqual(labelPlacement(10, "left", 0.5), { dx: -14, dy: 3.5, anchor: "end" });
});

test("labels: stars far apart keep every label below; the result does not depend on input order", () => {
  const stars = [
    { id: "a", name: "TypeScript", x: 100, y: 100, r: 10 },
    { id: "b", name: "Rust", x: 600, y: 100, r: 8 },
    { id: "c", name: "Zod", x: 100, y: 600, r: 8 }
  ];
  assert.deepEqual([...labelSides(stars).values()], ["below", "below", "below"]);
  const close = [
    { id: "x", name: "Vitest", x: 300, y: 500, r: 8 },
    { id: "y", name: "Vite", x: 340, y: 505, r: 8 }
  ];
  assert.deepEqual(Object.fromEntries(labelSides(close)), Object.fromEntries(labelSides([...close].reverse())));
});

test("the sky fits its stars: padded, at least a minimum size, always 16:10", async () => {
  const { fitViewBox, viewBoxString, SKY_ASPECT } = await import("../src/renderer/views/skillConstellationModel.ts");
  const box = fitViewBox([{ x: 300, y: 200 }, { x: 500, y: 500 }]);
  assert.ok(Math.abs(box.width / box.height - SKY_ASPECT) < 0.01, "16:10");
  assert.ok(box.x <= 300 - 90 && box.x + box.width >= 500 + 90, "every star with room for its label, across");
  assert.ok(box.y <= 200 - 90 && box.y + box.height >= 500 + 90, "and down");
  const tight = fitViewBox([{ x: 500, y: 500 }, { x: 510, y: 505 }]);
  assert.ok(tight.width >= 420, "two close stars don't become giants");
  assert.equal(viewBoxString(fitViewBox([])), "0 0 1000 625");
});

test("glow follows recency; dust is deterministic and stays inside the sky", async () => {
  const { starGlow, starDust } = await import("../src/renderer/views/skillConstellationModel.ts");
  assert.equal(starGlow(0), 0.12);
  assert.equal(starGlow(1), 0.62);
  assert.equal(starGlow(Number.NaN), 0.12);
  const box = { x: -100, y: 50, width: 800, height: 500 };
  const a = starDust(box, 40);
  assert.deepEqual(a, starDust(box, 40), "the same sky every time");
  assert.equal(a.length, 40);
  assert.ok(a.every((d) => d.x >= box.x && d.x <= box.x + box.width && d.y >= box.y && d.y <= box.y + box.height));
  assert.ok(a.every((d) => d.o > 0 && d.o < 0.31), "faint");
});

test("stats and the brightest stars", async () => {
  const { skyStats, brightest } = await import("../src/renderer/views/skillConstellationModel.ts");
  const sk = (id: string, score: number, last: string, category = "language") =>
    ({ id, name: id, category, strength: { score }, lastEvidenceAt: "2026-09-09", lastActivityAt: last }) as never;
  const skills = [sk("Go", 0.3, "2026-01-01"), sk("TypeScript", 0.9, "2026-03-01"), sk("React", 0.5, "2026-06-01", "framework")];
  const stats = skyStats(skills);
  assert.equal(stats.count, 3);
  assert.equal((stats.strongest as unknown as { id: string }).id, "TypeScript");
  assert.equal((stats.freshest as unknown as { id: string }).id, "React");
  assert.equal(stats.languages, 2);
  assert.deepEqual(brightest(skills, 2).map((s: { id: string }) => s.id), ["TypeScript", "React"]);
  assert.deepEqual(skyStats([]), { count: 0, strongest: null, freshest: null, languages: 0 });

  // Everything in one repository shares its last commit: the strongest of them is named, not the linter.
  const oneRepo = [sk("ESLint", 0.2, "2026-06-01", "tooling"), sk("TypeScript", 0.9, "2026-06-01"), sk("npm", 0.3, "2026-06-01", "packageManager")];
  assert.equal((skyStats(oneRepo).freshest as unknown as { id: string }).id, "TypeScript");
  // A scan date is not work: a skill nothing dates is never the freshest.
  const undated = [sk("Jest", 0.9, null as never, "tooling"), sk("Go", 0.1, "2025-01-01")];
  assert.equal((skyStats(undated).freshest as unknown as { id: string }).id, "Go");
  assert.equal(skyStats([sk("Jest", 0.9, null as never, "tooling")]).freshest, null);
});

test("the numbers say what was counted and when the work was, never when a scan ran", async () => {
  const { basisNote, basisOf, recencyNote, repositoryRange, volumeNote } = await import("../src/renderer/views/skillConstellationModel.ts");
  assert.equal(volumeNote(skill("go")), "12 changes in 2 repositories");
  assert.equal(volumeNote(skill("go", { activityCount: 1, repositoryCount: 1 })), "1 change in 1 repository");
  assert.equal(volumeNote(skill("go", { activityCount: 0 })), "present in 2 repositories");
  assert.equal(volumeNote(skill("jest", { category: "tooling", repositoryCount: 1 })), "named in 1 repository");

  assert.equal(recencyNote(skill("go")), "last work 3 Mar 2026");
  assert.equal(recencyNote(skill("react", { category: "framework" })), "last work 3 Mar 2026");
  assert.equal(recencyNote(skill("jest", { lastActivityAt: null })), "no dated work");

  assert.equal(basisOf(skill("go")), "work");
  assert.equal(basisOf({ category: "framework", lastActivityAt: "2026-03-03" }), "project", "worked out when the snapshot does not say");
  assert.equal(basisOf({ category: "tooling", lastActivityAt: null }), "declared");
  assert.match(basisNote(skill("react", { category: "framework", basis: "project", repositoryCount: 3 })), /^Named in the manifest of 3 repositories with commits, and dated by the last commit there\./);
  assert.match(basisNote(skill("jest", { category: "tooling", basis: "declared", lastActivityAt: null })), /^Named or present only/);
  assert.equal(starLabel(skill("jest", { category: "tooling", basis: "declared", lastActivityAt: null })), "JEST, tooling, strength 42%, 3 pieces of evidence in 2 repositories, named only, no dated work");

  const activity = [
    { repositoryId: "r1", count: 240, firstAt: "2024-02-10T08:00:00.000Z", lastAt: "2026-10-02T19:00:00.000Z" },
    { repositoryId: "r2", count: 1, firstAt: "2026-05-01T00:00:00.000Z", lastAt: "2026-05-01T00:00:00.000Z" }
  ];
  assert.equal(repositoryRange("r1", activity), "10 Feb 2024 – 2 Oct 2026 · 240 commits counted");
  assert.equal(repositoryRange("r2", activity), "1 May 2026 · 1 commit counted");
  assert.equal(repositoryRange("r3", activity), "no commits counted");
  assert.equal(repositoryRange("r1", undefined), "no commits counted");
});
