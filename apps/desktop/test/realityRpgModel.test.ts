/** The Reality RPG view's decisions, without React. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AchievementView, AwardView, RealityRpgSnapshot } from "@dexnest/reality-rpg";
import {
  actionMessage,
  dayBefore,
  heroLine,
  nextAchievement,
  questProgressText,
  rankedStats,
  xpByDay,
  awardLabel,
  awardSource,
  awardTitle,
  EMPTY_QUEST_FORM,
  EMPTY_RULE_FORM,
  levelProgress,
  nextTab,
  orderAchievements,
  progressText,
  questFromForm,
  ruleFromForm,
  ruleSentence,
  countsFromLabel,
  shortDate,
  slugId,
  statShare,
  viewState
} from "../src/renderer/views/realityRpgModel.ts";

function snapshot(extra: Partial<RealityRpgSnapshot> = {}): RealityRpgSnapshot {
  return {
    enabled: false,
    sheet: { totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] },
    rules: [], achievements: [], quests: [], recentAwards: [], lastRun: null,
    invalid: { rules: [], achievements: [], quests: [] },
    starter: { rules: [], achievements: [] },
    ...extra
  };
}

test("view states: loading, error, off, ready", () => {
  assert.equal(viewState({ loading: true, error: null, snapshot: null }).kind, "loading");
  assert.deepEqual(viewState({ loading: false, error: "boom", snapshot: snapshot() }), { kind: "error", message: "boom" });
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot() }).kind, "off");
  // Turned on, or anything earned, or any rule: it is a game in progress.
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot({ enabled: true }) }).kind, "ready");
  assert.equal(viewState({ loading: false, error: null, snapshot: snapshot({ sheet: { totalXp: 5, level: 1, xpIntoLevel: 5, xpToNextLevel: 95, stats: [] } }) }).kind, "ready");
});

test("level progress stays within 0-100 and is full at the top of the curve", () => {
  assert.equal(levelProgress({ totalXp: 150, level: 2, xpIntoLevel: 50, xpToNextLevel: 150, stats: [] }), 25);
  assert.equal(levelProgress({ totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] }), 0);
  assert.equal(levelProgress({ totalXp: 9e9, level: 60, xpIntoLevel: 5, xpToNextLevel: null, stats: [] }), 100);
});

test("achievements: unlocked first (newest first), then locked by closeness", () => {
  const a = (id: string, current: number, target: number, unlockedAt?: string): AchievementView => ({
    achievement: { id, name: id, description: "d", condition: { kind: "xp", target } },
    unlocked: unlockedAt ? { achievementId: id, unlockedAt, tippingAwardId: "x" } : null,
    progress: { current, target, met: current >= target }
  });
  const ordered = orderAchievements([a("far", 1, 10), a("old", 10, 10, "2026-01-01"), a("near", 9, 10), a("new", 5, 5, "2026-06-01")]);
  assert.deepEqual(ordered.map((v) => v.achievement.id), ["new", "old", "near", "far"]);
});

test("progress text never overshoots its target", () => {
  assert.equal(progressText(7, 5, "days"), "5 of 5 days");
  assert.equal(progressText(2, 5), "2 of 5");
});

test("the rule form produces the JSON shape the module validates", () => {
  const rule = ruleFromForm({ ...EMPTY_RULE_FORM, name: "Standup done!", types: "action_executed", actionIds: "standup.generate, backup.create", status: "success", xp: "15", stat: " Focus ", dailyCap: "2" });
  assert.deepEqual(rule, {
    id: "standup-done",
    name: "Standup done!",
    enabled: true,
    match: { types: ["action_executed"], actionIds: ["standup.generate", "backup.create"], status: "success" },
    award: { xp: 15, stat: "Focus" },
    dailyCap: 2
  });
  assert.deepEqual(ruleFromForm({ ...EMPTY_RULE_FORM, name: "x", types: "a b", stat: "S" }).match, { types: ["a", "b"] });
  assert.equal(slugId("  Ünïcode & Spaces  "), "n-code-spaces");
});

test("the quest form produces the JSON shape the module validates", () => {
  assert.deepEqual(questFromForm({ ...EMPTY_QUEST_FORM, title: " Ship ", ruleIds: ["commits"], target: "3", window: "daily" }), {
    title: "Ship", condition: { kind: "count", target: 3, ruleIds: ["commits"] }, window: { kind: "daily" }
  });
  assert.deepEqual(questFromForm({ ...EMPTY_QUEST_FORM, title: "XP", kind: "xp", stat: "Craft", target: "100", window: "fixed", from: "2026-06-01", to: "2026-06-30" }), {
    title: "XP", condition: { kind: "xp", target: 100, stat: "Craft" }, window: { kind: "fixed", from: "2026-06-01", to: "2026-06-30" }
  });
});

test("history lines name the rule and action, never event content", () => {
  const award = { ruleName: "Copies", actionId: "clipboard.copy", eventType: "action_executed" } as AwardView;
  assert.equal(awardLabel(award), "Copies · clipboard.copy");
  assert.equal(awardLabel({ ...award, ruleName: null, actionId: null }), "a deleted rule · action_executed");
  assert.equal(shortDate("2026-06-01T23:59:00.000Z"), "1 Jun 2026");
  assert.equal(shortDate("x"), "unknown date");
});

test("action results become notices", () => {
  assert.deepEqual(actionMessage({ ok: true, message: "Rule saved." }), { ok: true, text: "Rule saved." });
  assert.deepEqual(actionMessage({ ok: false, error: "no such rule" }), { ok: false, text: "no such rule" });
  assert.deepEqual(actionMessage({ ok: false }), { ok: false, text: "That did not work." });
  assert.deepEqual(actionMessage(undefined), { ok: true, text: null });
});

test("tabs follow the ARIA keyboard pattern", () => {
  assert.equal(nextTab("character", "ArrowRight"), "quests");
  assert.equal(nextTab("character", "ArrowLeft"), "rules");
  assert.equal(nextTab("rules", "ArrowRight"), "character");
  assert.equal(nextTab("history", "Home"), "character");
  assert.equal(nextTab("quests", "End"), "rules");
  assert.equal(nextTab("quests", "a"), null);
});

test("history rows lead with the rule's name; the event type is the small print", () => {
  const award = { ruleName: "Copies", actionId: "clipboard.copy", eventType: "action_executed" } as Parameters<typeof awardTitle>[0];
  assert.equal(awardTitle(award), "Copies");
  assert.equal(awardSource(award), "clipboard.copy");
  assert.equal(awardTitle({ ...award, ruleName: null }), "A deleted rule");
  assert.equal(awardSource({ ...award, actionId: null }), "action_executed");
});

test("a rule reads as a sentence; stat bars are shares of the strongest stat", () => {
  assert.equal(ruleSentence({ award: { xp: 5, stat: "Craft" }, dailyCap: 20 }), "+5 Craft each time, at most 20 a day");
  assert.equal(ruleSentence({ award: { xp: 1, stat: "Order" } }), "+1 Order each time");
  assert.equal(statShare(30, 120), 25);
  assert.equal(statShare(120, 120), 100);
  assert.equal(statShare(5, 0), 0);
});

test("countsFromLabel: the epoch means all past activity", () => {
  assert.equal(countsFromLabel("1970-01-01T00:00:00.000Z"), "Counts all past activity");
  assert.match(countsFromLabel("2026-06-01T00:00:00.000Z"), /^Counts from 1 Jun 2026/);
});

test("XP by day: oldest first, a slot for every day, and honest about a short page", () => {
  assert.equal(dayBefore("2026-03-01", 1), "2026-02-28");
  const awards = [
    { localDay: "2026-06-03", xp: 5 },
    { localDay: "2026-06-03", xp: 2 },
    { localDay: "2026-06-01", xp: 4 },
    { localDay: "2026-05-01", xp: 99 }
  ];
  const r = xpByDay(awards, 3, "2026-06-03");
  assert.deepEqual(r.data.map((d) => [d.label, d.value]), [["01", 4], ["02", 0], ["03", 7]]);
  assert.equal(r.data[2]!.title, "2026-06-03: 7 XP");
  assert.equal(r.complete, true, "fewer than a page loaded: that is everything");
  const full = Array.from({ length: 50 }, () => ({ localDay: "2026-06-03", xp: 1 }));
  assert.equal(xpByDay(full, 14, "2026-06-03").complete, false, "a full page that doesn't reach the start may be missing days");
  const reaching = [...full.slice(1), { localDay: "2026-05-01", xp: 1 }];
  assert.equal(xpByDay(reaching, 14, "2026-06-03").complete, true, "a full page that reaches past the start covers the range");
});

test("stats strongest first; the next achievement is the closest locked one; the hero line", () => {
  assert.deepEqual(rankedStats([{ stat: "Focus", xp: 30 }, { stat: "Craft", xp: 120 }]).map((s) => [s.stat, s.share]), [["Craft", 100], ["Focus", 25]]);
  const view = (id: string, current: number, target: number, unlocked = false) =>
    ({ achievement: { id, name: id, description: "", condition: { kind: "count", ruleIds: [], target } }, unlocked: unlocked ? { achievementId: id, unlockedAt: "2026-06-01T00:00:00.000Z", tippingAwardId: "x" } : null, progress: { current, target, met: unlocked } }) as unknown as AchievementView;
  assert.equal(nextAchievement([view("far", 1, 10), view("close", 4, 5), view("done", 5, 5, true)])?.achievement.id, "close");
  assert.equal(nextAchievement([view("done", 5, 5, true)]), null);
  const sheet = { totalXp: 150, level: 2, xpIntoLevel: 50, xpToNextLevel: 150, stats: [{ stat: "Craft", xp: 120 }] };
  assert.equal(heroLine({ sheet, achievements: [view("done", 5, 5, true), view("far", 1, 10)] }), "150 XP to level 3 · strongest stat: Craft · 1 of 2 achievements");
  assert.equal(heroLine({ sheet: { ...sheet, xpToNextLevel: null, stats: [] }, achievements: [] }), "Top of the level curve");
});

test("a quest's progress reads as one line, with its window", () => {
  const q = (window: object, condition = { kind: "count" }) => ({ window, condition }) as never;
  assert.equal(questProgressText(q({ kind: "daily" }), { current: 1, target: 2, open: true }), "1 of 2 times today");
  assert.equal(questProgressText(q({ kind: "weekly" }, { kind: "days" }), { current: 3, target: 5, open: true }), "3 of 5 days this week");
  assert.equal(questProgressText(q({ kind: "fixed" }, { kind: "xp" }), { current: 9, target: 5, open: false }), "5 of 5 XP · window closed");
});

test("the hero line groups thousands", () => {
  const sheet = { totalXp: 48210, level: 42, xpIntoLevel: 100, xpToNextLevel: 4300, stats: [] };
  assert.equal(heroLine({ sheet, achievements: [] }), "4,300 XP to level 43");
});
