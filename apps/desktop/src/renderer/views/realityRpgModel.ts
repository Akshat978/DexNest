// What the Reality RPG view decides, kept out of React so it can be tested
// directly: which state to show, level progress, turning form fields into the
// JSON the module validates, and how history reads. No DOM, no bridge, no I/O.
// The module re-validates everything; these builders only shape input.

import type { AchievementView, AwardView, RealityRpgSnapshot } from "@dexnest/reality-rpg";

export type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** Off and nothing earned yet: explain what it is and offer to start. */
  | { kind: "off" }
  | { kind: "ready"; snapshot: RealityRpgSnapshot };

export function viewState(input: { loading: boolean; error: string | null; snapshot: RealityRpgSnapshot | null }): ViewState {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading || !input.snapshot) return { kind: "loading" };
  const s = input.snapshot;
  if (!s.enabled && s.rules.length === 0 && s.sheet.totalXp === 0) return { kind: "off" };
  return { kind: "ready", snapshot: s };
}

/** Percent of the way to the next level, 0-100; 100 at the top of the curve. */
export function levelProgress(sheet: RealityRpgSnapshot["sheet"]): number {
  if (sheet.xpToNextLevel === null) return 100;
  const span = sheet.xpIntoLevel + sheet.xpToNextLevel;
  return span <= 0 ? 0 : Math.max(0, Math.min(100, Math.floor((sheet.xpIntoLevel / span) * 100)));
}

/** Unlocked first (newest first), then locked by how close they are. */
export function orderAchievements(views: readonly AchievementView[]): AchievementView[] {
  return [...views].sort((a, b) => {
    if (a.unlocked && b.unlocked) return b.unlocked.unlockedAt.localeCompare(a.unlocked.unlockedAt);
    if (a.unlocked) return -1;
    if (b.unlocked) return 1;
    const ra = a.progress.current / a.progress.target;
    const rb = b.progress.current / b.progress.target;
    return rb - ra || a.achievement.name.localeCompare(b.achievement.name);
  });
}

/** "3 of 5" - progress as the numbers it is. */
export function progressText(current: number, target: number, unit = ""): string {
  const shown = Math.min(current, target);
  return `${shown} of ${target}${unit ? ` ${unit}` : ""}`;
}

export function conditionUnit(kind: "count" | "xp" | "days"): string {
  return kind === "xp" ? "XP" : kind === "days" ? "days" : "times";
}

function list(text: string): string[] {
  return text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

export interface RuleForm {
  id: string;
  name: string;
  types: string;
  stream: string;
  actionIds: string;
  status: "" | "success" | "failed";
  xp: string;
  stat: string;
  dailyCap: string;
  enabled: boolean;
}

export const EMPTY_RULE_FORM: RuleForm = { id: "", name: "", types: "", stream: "", actionIds: "", status: "", xp: "10", stat: "", dailyCap: "", enabled: true };

export function slugId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Form fields -> the rule JSON the module validates. Blank optional fields are left out. */
export function ruleFromForm(form: RuleForm): Record<string, unknown> {
  const match: Record<string, unknown> = { types: list(form.types) };
  if (form.stream.trim()) match.stream = form.stream.trim();
  const actionIds = list(form.actionIds);
  if (actionIds.length > 0) match.actionIds = actionIds;
  if (form.status) match.status = form.status;
  const rule: Record<string, unknown> = {
    id: form.id.trim() || slugId(form.name),
    name: form.name.trim(),
    enabled: form.enabled,
    match,
    award: { xp: Number(form.xp), stat: form.stat.trim() }
  };
  if (form.dailyCap.trim()) rule.dailyCap = Number(form.dailyCap);
  return rule;
}

export interface QuestForm {
  title: string;
  kind: "count" | "xp" | "days";
  ruleIds: string[];
  stat: string;
  target: string;
  window: "none" | "daily" | "weekly" | "fixed";
  from: string;
  to: string;
}

export const EMPTY_QUEST_FORM: QuestForm = { title: "", kind: "count", ruleIds: [], stat: "", target: "1", window: "none", from: "", to: "" };

export function questFromForm(form: QuestForm): Record<string, unknown> {
  const condition: Record<string, unknown> = { kind: form.kind, target: Number(form.target) };
  if (form.kind === "xp") {
    if (form.stat.trim()) condition.stat = form.stat.trim();
  } else {
    condition.ruleIds = form.ruleIds;
  }
  const window: Record<string, unknown> = { kind: form.window };
  if (form.window === "fixed") {
    window.from = form.from;
    window.to = form.to;
  }
  return { title: form.title.trim(), condition, window };
}

/** One history line: what earned it, never what the event said. */
export function awardLabel(award: AwardView): string {
  const rule = award.ruleName ?? "a deleted rule";
  const what = award.actionId ?? award.eventType;
  return `${rule} · ${what}`;
}

/** A calendar date; the full time goes in the title attribute. */
export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "unknown date";
}

/** The outcome text an action returned, or its error. */
export function actionMessage(result: unknown): { ok: boolean; text: string | null } {
  if (!result || typeof result !== "object") return { ok: true, text: null };
  const r = result as { ok?: unknown; message?: unknown; error?: unknown };
  if (r.ok === false) return { ok: false, text: typeof r.error === "string" ? r.error : "That did not work." };
  return { ok: true, text: typeof r.message === "string" ? r.message : null };
}

export const TABS = ["character", "quests", "achievements", "history", "rules"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_LABELS: Record<Tab, string> = { character: "Character", quests: "Quests", achievements: "Achievements", history: "History", rules: "Rules" };

/** ARIA tabs keyboard pattern: arrows wrap, Home/End jump; other keys do nothing. */
export function nextTab(current: Tab, key: string): Tab | null {
  const i = TABS.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return TABS[(i + 1) % TABS.length]!;
    case "ArrowLeft":
      return TABS[(i - 1 + TABS.length) % TABS.length]!;
    case "Home":
      return TABS[0];
    case "End":
      return TABS[TABS.length - 1]!;
    default:
      return null;
  }
}
