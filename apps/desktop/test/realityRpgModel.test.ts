/** The Reality RPG view's decisions, without React. */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AchievementView, AwardView, RealityRpgSnapshot } from "@dexnest/reality-rpg";
import {
  actionMessage,
  awardLabel,
  EMPTY_QUEST_FORM,
  EMPTY_RULE_FORM,
  levelProgress,
  nextTab,
  orderAchievements,
  progressText,
  questFromForm,
  ruleFromForm,
  shortDate,
  slugId,
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
  assert.equal(shortDate("2026-06-01T23:59:00.000Z"), "2026-06-01");
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
