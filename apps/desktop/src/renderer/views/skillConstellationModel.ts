// What the Skill Constellation view decides, kept out of React so it can be
// tested directly: which state to show, where arrow keys move focus, how big a
// star is, and how a skill's evidence reads. No DOM, no bridge, no I/O.

import type {
  ConstellationSkill,
  SkillCategory,
  ConstellationSnapshot,
  EvidenceKind,
  EvidenceView,
  SkillLayoutPoint
} from "@dexnest/skill-constellation";

export type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** Never built, and off: explain what it is and offer to turn it on. */
  | { kind: "off" }
  /** Built, but Developer Intelligence has recorded nothing that evidences a skill. */
  | { kind: "empty"; snapshot: ConstellationSnapshot }
  | { kind: "ready"; snapshot: ConstellationSnapshot };

export function viewState(input: { loading: boolean; error: string | null; snapshot: ConstellationSnapshot | null }): ViewState {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading || !input.snapshot) return { kind: "loading" };
  const snapshot = input.snapshot;
  if (!snapshot.lastBuild && !snapshot.enabled) return { kind: "off" };
  if (snapshot.skills.length === 0) return { kind: "empty", snapshot };
  return { kind: "ready", snapshot };
}

/** Skills to draw: hidden ones only when asked, in a stable order. */
export function visibleSkills(skills: readonly ConstellationSkill[], showHidden: boolean): ConstellationSkill[] {
  return skills.filter((s) => showHidden || !s.hidden).sort((a, b) => a.id.localeCompare(b.id));
}

export const STAR_MIN_RADIUS = 5;
export const STAR_MAX_RADIUS = 16;

export function starRadius(score: number): number {
  const s = Number.isFinite(score) ? Math.min(Math.max(score, 0), 1) : 0;
  return Math.round((STAR_MIN_RADIUS + s * (STAR_MAX_RADIUS - STAR_MIN_RADIUS)) * 10) / 10;
}

/** Link opacity: faint for weak overlap, never invisible, never louder than a star. */
export function linkOpacity(weight: number): number {
  const w = Number.isFinite(weight) ? Math.min(Math.max(weight, 0), 1) : 0;
  return Math.round((0.2 + w * 0.5) * 100) / 100;
}

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

const NAV_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

export function isNavKey(key: string): key is NavKey {
  return NAV_KEYS.has(key);
}

/**
 * The star an arrow key moves to: the nearest star whose direction from the
 * current one is within 60 degrees of the arrow, preferring stars straight
 * ahead. Nothing in that direction: stay put. Home and End go to the first and
 * last star in reading order (top to bottom, left to right).
 */
export function nextStar(points: readonly SkillLayoutPoint[], currentId: string | null, key: NavKey): string | null {
  if (points.length === 0) return null;
  const reading = [...points].sort((a, b) => a.y - b.y || a.x - b.x || a.skillId.localeCompare(b.skillId));
  if (key === "Home") return reading[0]!.skillId;
  if (key === "End") return reading[reading.length - 1]!.skillId;
  const current = points.find((p) => p.skillId === currentId);
  if (!current) return reading[0]!.skillId;

  const [dx, dy] = key === "ArrowUp" ? [0, -1] : key === "ArrowDown" ? [0, 1] : key === "ArrowLeft" ? [-1, 0] : [1, 0];
  let best: { id: string; cost: number } | null = null;
  for (const p of points) {
    if (p.skillId === current.skillId) continue;
    const vx = p.x - current.x;
    const vy = p.y - current.y;
    const distance = Math.hypot(vx, vy);
    if (distance === 0) continue;
    const along = (vx * dx + vy * dy) / distance;
    if (along < 0.5) continue; // outside the 60-degree cone
    // Distance, plus a penalty for drifting sideways from the arrow.
    const cost = distance * (2 - along);
    if (!best || cost < best.cost || (cost === best.cost && p.skillId < best.id)) best = { id: p.skillId, cost };
  }
  return best ? best.id : current.skillId;
}

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  "technology.manifest": "Named in a manifest",
  "technology.extension": "Files in this language",
  "technology.removed": "Was used, since removed",
  "todo.open": "Open TODO",
  "todo.resolved": "Resolved TODO",
  commit: "Commit"
};

export interface EvidenceGroup {
  repositoryId: string;
  repositoryName: string;
  items: EvidenceView[];
  firstAt: string;
  lastAt: string;
}

/** Evidence by repository, busiest first; items newest first. */
export function groupEvidence(evidence: readonly EvidenceView[]): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  for (const item of evidence) {
    let group = groups.get(item.repositoryId);
    if (!group) {
      group = { repositoryId: item.repositoryId, repositoryName: item.repositoryName ?? item.repositoryId, items: [], firstAt: item.at, lastAt: item.at };
      groups.set(item.repositoryId, group);
    }
    group.items.push(item);
    if (item.at < group.firstAt) group.firstAt = item.at;
    if (item.at > group.lastAt) group.lastAt = item.at;
  }
  for (const group of groups.values()) group.items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.repositoryName.localeCompare(b.repositoryName));
}

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  language: "language",
  framework: "framework",
  library: "library",
  runtime: "runtime",
  tooling: "tooling",
  packageManager: "package manager"
};

/** "72%" - strength shown as the number it is, not a level. */
export function percent(value: number): string {
  return `${Math.round((Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0) * 100)}%`;
}

/** A calendar date for evidence; the full time is in the title attribute. */
export function shortDate(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "unknown date";
}

export function starLabel(skill: ConstellationSkill): string {
  const repos = skill.repositoryCount === 1 ? "1 repository" : `${skill.repositoryCount} repositories`;
  const evidence = skill.evidenceCount === 1 ? "1 piece of evidence" : `${skill.evidenceCount} pieces of evidence`;
  return `${skill.name}, ${CATEGORY_LABELS[skill.category]}, strength ${percent(skill.strength.score)}, ${evidence} in ${repos}${skill.hidden ? ", hidden" : ""}`;
}

/** How many stars carry a written label; the rest show theirs on hover, focus or selection. */
export const LABEL_LIMIT = 15;

/**
 * Which stars are labelled: the LABEL_LIMIT strongest (ties by name), plus any
 * star the owner is pointing at, has focused or has selected. With dozens of
 * skills, labelling every star made them unreadable.
 */
export function labelledIds(skills: readonly Pick<ConstellationSkill, "id" | "name" | "strength">[], always: readonly (string | null)[] = []): Set<string> {
  const top = [...skills]
    .sort((a, b) => b.strength.score - a.strength.score || a.name.localeCompare(b.name))
    .slice(0, LABEL_LIMIT)
    .map((s) => s.id);
  return new Set([...top, ...always.filter((id): id is string => id !== null)]);
}

/** Approximate width of a label at the 22-unit label font. */
const LABEL_CHAR_WIDTH = 12;

export interface LabelStar {
  id: string;
  name: string;
  x: number;
  y: number;
  /** The star's radius. */
  r: number;
}

export type LabelSide = "below" | "above" | "right" | "left";

/** Where a label sits relative to its star's centre: baseline offset, sideways offset, and anchor. */
export function labelPlacement(r: number, side: LabelSide, scale = 1): { dx: number; dy: number; anchor: "middle" | "start" | "end" } {
  switch (side) {
    case "below":
      return { dx: 0, dy: r + 18 * scale, anchor: "middle" };
    case "above":
      return { dx: 0, dy: -(r + 10 * scale), anchor: "middle" };
    case "right":
      return { dx: r + 8 * scale, dy: 7 * scale, anchor: "start" };
    case "left":
      return { dx: -(r + 8 * scale), dy: 7 * scale, anchor: "end" };
  }
}

/** The label's baseline, relative to the star's centre (below or above). */
export const labelOffset = (r: number, side: "above" | "below", scale = 1): number => labelPlacement(r, side, scale).dy;

/**
 * The label's box for a side. `scale` is the sky's zoom (see skyScale):
 * labels shrink with it so they keep one size on screen however tightly the
 * view is fitted.
 */
function labelBox(star: LabelStar, side: LabelSide, scale = 1) {
  const width = star.name.length * LABEL_CHAR_WIDTH * scale;
  const { dx, dy, anchor } = labelPlacement(star.r, side, scale);
  const x = star.x + dx;
  const left = anchor === "middle" ? x - width / 2 : anchor === "start" ? x : x - width;
  const baseline = star.y + dy;
  return { left: left - 4 * scale, right: left + width + 4 * scale, top: baseline - 20 * scale, bottom: baseline + 6 * scale };
}

/**
 * Which side of its star each label goes: below by default, then above,
 * right or left - the first that overlaps neither a label already placed nor
 * another star. Two or three close stars ("PostgreSQL", "Python", "Go") never
 * write their names over each other or over each other's stars. Stars are
 * placed top to bottom, left to right, so the result is deterministic.
 */
export function labelSides(stars: readonly LabelStar[], scale = 1, obstacles: readonly LabelStar[] = stars): Map<string, LabelSide> {
  type Box = ReturnType<typeof labelBox>;
  const placed: Box[] = [];
  const hit = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const starBoxes = obstacles.map((o) => ({ id: o.id, box: { left: o.x - o.r, right: o.x + o.r, top: o.y - o.r, bottom: o.y + o.r } }));
  const clear = (star: LabelStar, box: Box) => !placed.some((p) => hit(box, p)) && !starBoxes.some((o) => o.id !== star.id && hit(box, o.box));
  const sides = new Map<string, LabelSide>();
  for (const star of [...stars].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))) {
    const order: LabelSide[] = ["below", "above", "right", "left"];
    const side = order.find((s) => clear(star, labelBox(star, s, scale))) ?? "below";
    sides.set(star.id, side);
    placed.push(labelBox(star, side, scale));
  }
  return sides;
}

/** "1 repository", "3 repositories". */
export const countOf = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// --- The night sky (docs/DESIGN_LANGUAGE.md, Skill Constellation) ------------------------------

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The sky's shape: wider than tall, like the panel it fills. */
export const SKY_ASPECT = 16 / 10;

/**
 * The part of the 1000x1000 layout the stars actually use, padded for labels
 * and widened to the sky's aspect, so a constellation fills its frame instead
 * of sitting small in one corner. Never zooms past `minSize`, so two close
 * stars don't become two giant ones.
 */
export function fitViewBox(points: readonly Pick<SkillLayoutPoint, "x" | "y">[], pad = 90, minSize = 420): ViewBox {
  if (points.length === 0) return { x: 0, y: 0, width: 1000, height: 1000 / SKY_ASPECT };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let minX = Math.min(...xs) - pad;
  let maxX = Math.max(...xs) + pad;
  let minY = Math.min(...ys) - pad;
  let maxY = Math.max(...ys) + pad;
  // At least minSize tall, and the sky's aspect wide.
  let height = Math.max(maxY - minY, minSize / SKY_ASPECT);
  let width = Math.max(maxX - minX, height * SKY_ASPECT, minSize);
  height = Math.max(height, width / SKY_ASPECT);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  minX = cx - width / 2;
  minY = cy - height / 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { x: round(minX), y: round(minY), width: round(width), height: round(height) };
}

export const viewBoxString = (box: ViewBox): string => `${box.x} ${box.y} ${box.width} ${box.height}`;

/** How brightly a star glows: recent evidence glows, old evidence is a dim point. */
export function starGlow(recency: number): number {
  const r = Number.isFinite(recency) ? Math.min(Math.max(recency, 0), 1) : 0;
  return Math.round((0.12 + r * 0.5) * 100) / 100;
}

/**
 * Faint background stars, for depth. Deterministic (the same box always gets
 * the same dust) and drawn once - the sky never twinkles, so an open
 * constellation costs no CPU.
 */
export function starDust(box: ViewBox, count = 70, seed = 7): { x: number; y: number; r: number; o: number }[] {
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32: small, fast, deterministic.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
  return Array.from({ length: count }, () => ({
    x: Math.round((box.x + next() * box.width) * 10) / 10,
    y: Math.round((box.y + next() * box.height) * 10) / 10,
    r: Math.round((0.8 + next() * 1.6) * 10) / 10,
    o: Math.round((0.08 + next() * 0.22) * 100) / 100
  }));
}

/** The brightest stars, strongest first: what to look at when nothing is selected. */
export function brightest(skills: readonly ConstellationSkill[], n = 5): ConstellationSkill[] {
  return [...skills].sort((a, b) => b.strength.score - a.strength.score || a.name.localeCompare(b.name)).slice(0, n);
}

export interface SkyStats {
  count: number;
  strongest: ConstellationSkill | null;
  freshest: ConstellationSkill | null;
  languages: number;
}

/** The numbers above the sky. */
export function skyStats(skills: readonly ConstellationSkill[]): SkyStats {
  const freshest = [...skills].sort((a, b) => b.lastEvidenceAt.localeCompare(a.lastEvidenceAt) || a.name.localeCompare(b.name))[0] ?? null;
  return {
    count: skills.length,
    strongest: brightest(skills, 1)[0] ?? null,
    freshest,
    languages: skills.filter((s) => s.category === "language").length
  };
}

/**
 * How far the fitted sky is zoomed in, as a factor for drawing sizes. The
 * layout is 1000 units across; a sky fitted to 600 of them is zoomed 1.67x,
 * so stars and labels are drawn at 0.6 to stay the size they were. Never
 * below 0.45, so a tight cluster stays legible.
 */
export function skyScale(box: Pick<ViewBox, "width">): number {
  return Math.round(Math.max(0.45, Math.min(1, box.width / 1000)) * 1000) / 1000;
}

/** A category's label; one the view doesn't know shows as itself. */
export function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}
