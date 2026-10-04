// What the Reality RPG view decides, kept out of React so it can be tested
// directly: which state to show, level progress, turning form fields into the
// JSON the module validates, and how history reads. No DOM, no bridge, no I/O.
// The module re-validates everything; these builders only shape input.

import type { AchievementView, AwardView, QuestView, RealityRpgSnapshot, Rule } from "@dexnest/reality-rpg";
import { dayLabel } from "../lib/dates.ts";

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

/** What a history row leads with: the rule's name, as people named it. */
export function awardTitle(award: AwardView): string {
  return award.ruleName ?? "A deleted rule";
}

/** The technical source of an award, shown small under its title. */
export function awardSource(award: AwardView): string {
  return award.actionId ?? award.eventType;
}

/** A rule as a sentence: "+5 Craft each time, at most 20 a day". */
export function ruleSentence(rule: Pick<Rule, "award" | "dailyCap">): string {
  return `+${rule.award.xp} ${rule.award.stat} each time${rule.dailyCap ? `, at most ${rule.dailyCap} a day` : ""}`;
}

/** A stat's share of the strongest stat, 0-100, for its bar. */
export function statShare(xp: number, topXp: number): number {
  return topXp <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((xp / topXp) * 100)));
}

/** A calendar date, "3 Oct 2026"; the full time goes in the title attribute. */
export function shortDate(iso: string): string {
  return dayLabel(iso);
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

/** "Applying a rule to past activity" sets it to count from the epoch: say that, not "1970-01-01". */
export function countsFromLabel(effectiveFrom: string): string {
  return Date.parse(effectiveFrom) <= 0 ? "Counts all past activity" : `Counts from ${shortDate(effectiveFrom)}`;
}

// --- Character sheet presentation (docs/DESIGN_LANGUAGE.md, Reality RPG) -------------

/** A local calendar day, YYYY-MM-DD, n days before `today` (also YYYY-MM-DD). */
export function dayBefore(today: string, n: number): string {
  const t = Date.parse(`${today}T12:00:00.000Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * XP per local day for the last `days` days, oldest first, from the awards the
 * view has. Those are only the most recent ones (the snapshot carries 50), so
 * `complete` says whether they reach back far enough to cover the whole range -
 * the chart says so when they don't, rather than showing a quiet week that
 * wasn't.
 */
export function xpByDay(
  awards: readonly Pick<AwardView, "localDay" | "xp">[],
  days: number,
  today: string,
  pageSize = 50
): { data: { label: string; value: number; title: string }[]; complete: boolean } {
  const first = dayBefore(today, days - 1);
  const totals = new Map<string, number>();
  for (const a of awards) if (a.localDay >= first && a.localDay <= today) totals.set(a.localDay, (totals.get(a.localDay) ?? 0) + a.xp);
  const oldest = awards.reduce<string | null>((min, a) => (min === null || a.localDay < min ? a.localDay : min), null);
  const complete = awards.length < pageSize || (oldest !== null && oldest < first);
  const data = Array.from({ length: days }, (_, i) => {
    const day = dayBefore(today, days - 1 - i);
    const value = totals.get(day) ?? 0;
    return { label: day.slice(8), value, title: `${day}: ${value} XP` };
  });
  return { data, complete };
}

/** The locked achievement closest to done: what to aim for next. */
export function nextAchievement(views: readonly AchievementView[]): AchievementView | null {
  const locked = views.filter((v) => !v.unlocked && v.progress.target > 0);
  if (locked.length === 0) return null;
  return [...locked].sort((a, b) => b.progress.current / b.progress.target - a.progress.current / a.progress.target || a.achievement.name.localeCompare(b.achievement.name))[0] ?? null;
}

/** Stats strongest first, with each one's share of the strongest. */
export function rankedStats(stats: readonly { stat: string; xp: number }[]): { stat: string; xp: number; share: number }[] {
  const top = Math.max(0, ...stats.map((s) => s.xp));
  return [...stats].sort((a, b) => b.xp - a.xp || a.stat.localeCompare(b.stat)).map((s) => ({ ...s, share: statShare(s.xp, top) }));
}

/** The hero's line under the XP total. */
export function heroLine(snapshot: Pick<RealityRpgSnapshot, "sheet" | "achievements">): string {
  const { sheet } = snapshot;
  const parts = [sheet.xpToNextLevel === null ? "Top of the level curve" : `${sheet.xpToNextLevel.toLocaleString("en")} XP to level ${sheet.level + 1}`];
  const top = rankedStats(sheet.stats)[0];
  if (top) parts.push(`strongest stat: ${top.stat}`);
  const unlocked = snapshot.achievements.filter((a) => a.unlocked).length;
  if (snapshot.achievements.length > 0) parts.push(`${unlocked} of ${snapshot.achievements.length} achievements`);
  return parts.join(" · ");
}

/** Today as a local calendar day, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A quest's progress as one line: "1 of 2 times today", "3 of 5 days · window closed". */
export function questProgressText(quest: Pick<QuestView["quest"], "condition" | "window">, progress: Pick<QuestView["progress"], "current" | "target" | "open">): string {
  const window = quest.window.kind === "daily" ? " today" : quest.window.kind === "weekly" ? " this week" : "";
  const closed = quest.window.kind === "fixed" && !progress.open ? " · window closed" : "";
  return `${progressText(progress.current, progress.target, conditionUnit(quest.condition.kind))}${window}${closed}`;
}

// --- the built-in set, in plain words ------------------------------------------------

type Starter = RealityRpgSnapshot["starter"];

export interface StarterGroupView {
  id: string;
  label: string;
  rules: { rule: Rule; when: string; recommended: boolean }[];
}

/** The built-in rules under their group headings, in the order the set lists them. */
export function starterGroups(starter: Starter): StarterGroupView[] {
  const groups: StarterGroupView[] = [];
  for (const rule of starter.rules) {
    const info = starter.info[rule.id];
    if (!info) continue;
    let group = groups.find((g) => g.id === info.group);
    if (!group) groups.push((group = { id: info.group, label: info.groupLabel, rules: [] }));
    group.rules.push({ rule, when: info.when, recommended: info.recommended });
  }
  return groups;
}

/** What is ticked when the game is first turned on: the recommended rules, and the recommended quests they make possible. */
export function defaultStarterPicks(starter: Starter): { ruleIds: string[]; questIds: string[] } {
  const ruleIds = starter.rules.filter((r) => starter.info[r.id]?.recommended).map((r) => r.id);
  return { ruleIds, questIds: starter.quests.filter((q) => q.recommended && ruleIds.includes(q.needs)).map((q) => q.id) };
}

/** The turn-on button: "Turn on with 8 rules and 4 quests". */
export function starterSummary(rules: number, quests: number): string {
  if (rules === 0) return "Pick at least one thing";
  const r = `${rules} ${rules === 1 ? "rule" : "rules"}`;
  return quests > 0 ? `Turn on with ${r} and ${quests} ${quests === 1 ? "quest" : "quests"}` : `Turn on with ${r}`;
}

export function questWindowText(kind: "none" | "fixed" | "daily" | "weekly"): string {
  return kind === "daily" ? "every day" : kind === "weekly" ? "every week" : kind === "fixed" ? "between two dates" : "until done";
}

export interface FirstXpStep {
  id: string;
  title: string;
  when: string;
  reward: string;
}

/** The rules that are on, as things to go and do, biggest reward first. */
export function firstXpSteps(snapshot: Pick<RealityRpgSnapshot, "rules" | "starter">): FirstXpStep[] {
  return snapshot.rules
    .filter((r) => r.enabled)
    .sort((a, b) => b.award.xp - a.award.xp || a.name.localeCompare(b.name))
    .map((rule) => {
      const info = snapshot.starter.info[rule.id];
      return { id: rule.id, title: rule.name, when: info ? `When ${info.when}` : "When the events this rule names happen", reward: `+${rule.award.xp} ${rule.award.stat}` };
    });
}

/** A rule form filled from a built-in rule: picking "what earns it" from a list, not typing event names. */
export function formFromTemplate(form: RuleForm, template: Rule | undefined): RuleForm {
  if (!template) return form;
  return {
    ...form,
    name: form.name.trim() ? form.name : template.name,
    types: template.match.types.join(", "),
    stream: template.match.stream ?? "",
    actionIds: (template.match.actionIds ?? []).join(", "),
    status: template.match.status ?? "",
    stat: form.stat.trim() ? form.stat : template.award.stat,
    xp: form.xp.trim() && form.xp !== EMPTY_RULE_FORM.xp ? form.xp : String(template.award.xp)
  };
}
