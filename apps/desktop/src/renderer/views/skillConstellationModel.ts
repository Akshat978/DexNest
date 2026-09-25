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
  return `${skill.name}, ${CATEGORY_LABELS[skill.category]}, strength ${percent(skill.strength.score)}, ${evidence} in ${repos}`;
}
