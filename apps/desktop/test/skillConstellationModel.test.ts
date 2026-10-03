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

test("only the strongest stars are labelled, plus whatever the owner is pointing at", () => {
  const many = Array.from({ length: 25 }, (_, i) => skill(`s${String(i).padStart(2, "0")}`, { strength: { volume: 0, recency: 0, variety: 0, score: 1 - i / 50 } }));
  const ids = labelledIds(many);
  assert.equal(ids.size, LABEL_LIMIT);
  assert.ok(ids.has("s00") && ids.has("s14") && !ids.has("s15"));
  const withHover = labelledIds(many, ["s24", null, "s20"]);
  assert.ok(withHover.has("s24") && withHover.has("s20"));
  assert.equal(withHover.size, LABEL_LIMIT + 2);
  assert.equal(labelledIds(many.slice(0, 3)).size, 3);
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
    ({ id, name: id, category, strength: { score }, lastEvidenceAt: last }) as never;
  const skills = [sk("Go", 0.3, "2026-01-01"), sk("TypeScript", 0.9, "2026-03-01"), sk("React", 0.5, "2026-06-01", "framework")];
  const stats = skyStats(skills);
  assert.equal(stats.count, 3);
  assert.equal((stats.strongest as unknown as { id: string }).id, "TypeScript");
  assert.equal((stats.freshest as unknown as { id: string }).id, "React");
  assert.equal(stats.languages, 2);
  assert.deepEqual(brightest(skills, 2).map((s: { id: string }) => s.id), ["TypeScript", "React"]);
  assert.deepEqual(skyStats([]), { count: 0, strongest: null, freshest: null, languages: 0 });
});
