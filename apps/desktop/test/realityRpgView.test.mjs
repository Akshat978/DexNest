// Reality RPG view, rendered.
//
// The real RealityRpgView.tsx is bundled with the app's own Vite (SSR build,
// React external) and rendered with react-dom/server, once per state, from
// synthetic data. No Electron, no main process, no data root. Effects do not
// run under server rendering, which lets the `initial` prop pin each state.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const desktop = fileURLToPath(new URL("..", import.meta.url));
let scratch = "";
let View;

before(async () => {
  // Inside the app's node_modules so the bundle resolves the app's React.
  const cache = join(desktop, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  scratch = mkdtempSync(join(cache, "rpg-view-"));
  await build({
    configFile: false,
    logLevel: "silent",
    root: desktop,
    build: {
      ssr: join(desktop, "src/renderer/views/RealityRpgView.tsx"),
      outDir: scratch,
      emptyOutDir: true,
      rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"], output: { format: "es", entryFileNames: "view.mjs" } }
    }
  });
  ({ RealityRpgView: View } = await import(pathToFileURL(join(scratch, "view.mjs")).href));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const never = () => new Promise(() => {});
const bridge = { realityRpgStatus: never, realityRpgSnapshot: never, realityRpgHistory: never, realityRpgSettings: never, realityRpgUpdateSettings: never };
const onAction = async () => ({ ok: true });

const rule = { id: "commits", version: 2, name: "Commit observed", enabled: true, match: { types: ["dev.commit.observed"], stream: "dev" }, award: { xp: 5, stat: "Craft" }, dailyCap: 20, effectiveFrom: "2026-06-01T00:00:00.000Z" };
const offRule = { ...rule, id: "standup", name: "Standup generated", enabled: false, match: { types: ["action_executed"], actionIds: ["standup.generate"] } };
const base = {
  enabled: true,
  sheet: { totalXp: 150, level: 2, xpIntoLevel: 50, xpToNextLevel: 150, stats: [{ stat: "Craft", xp: 120 }, { stat: "Focus", xp: 30 }] },
  rules: [rule, offRule],
  achievements: [
    { achievement: { id: "first", name: "First steps", description: "Earn your first XP.", condition: { kind: "xp", target: 1 } }, unlocked: { achievementId: "first", unlockedAt: "2026-06-02T10:00:00.000Z", tippingAwardId: "aw" }, progress: { current: 150, target: 1, met: true } },
    { achievement: { id: "week", name: "Committed week", description: "Commits on 7 days.", condition: { kind: "days", ruleIds: ["commits"], target: 7 } }, unlocked: null, progress: { current: 3, target: 7, met: false } }
  ],
  quests: [
    { quest: { id: "daily", title: "Commit today", condition: { kind: "count", ruleIds: ["commits"], target: 2 }, window: { kind: "daily" }, status: "active", createdAt: "2026-06-01T00:00:00.000Z" }, progress: { current: 1, target: 2, met: false, periodKey: "2026-06-03", open: true }, completions: 4 }
  ],
  recentAwards: [
    { id: "aw1", ruleId: "commits", ruleVersion: 2, eventId: "e1", eventSeq: 9, eventType: "dev.commit.observed", actionId: null, occurredAt: "2026-06-03T09:00:00.000Z", localDay: "2026-06-03", xp: 5, stat: "Craft", awardedAt: "2026-06-03T09:05:00.000Z", runId: "r", ruleName: "Commit observed" },
    { id: "aw2", ruleId: "gone", ruleVersion: 1, eventId: "e2", eventSeq: 8, eventType: "action_executed", actionId: "clipboard.copy", occurredAt: "2026-06-02T09:00:00.000Z", localDay: "2026-06-02", xp: 1, stat: "Order", awardedAt: "2026-06-02T09:05:00.000Z", runId: "r", ruleName: null }
  ],
  lastRun: { id: "r", occurrenceId: "o", trigger: "scheduled", status: "completed", startedAt: "2026-06-03T09:05:00.000Z", finishedAt: "2026-06-03T09:05:01.000Z", fromSeq: 0, toSeq: 9, awards: 1, xp: 5, error: null },
  invalid: { rules: [], achievements: [], quests: [] },
  starter: { rules: [{ ...rule, id: "backup-completed", name: "Backup completed", enabled: false }], achievements: [] }
};
const off = { ...base, enabled: false, sheet: { totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] }, rules: [], achievements: [], quests: [], recentAwards: [], lastRun: null };

const render = (props) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...props }));

test("loading: a status, busy, no actions yet", () => {
  const html = render({});
  assert.match(html, /role="status"[^>]*>Loading your character/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, />Refresh</);
});

test("error: an alert with the reason and a retry", () => {
  const html = render({ initial: { snapshot: null, error: "database is locked" } });
  assert.match(html, /role="alert"/);
  assert.match(html, /database is locked/);
  assert.match(html, />Try again</);
});

test("off: explains what it reads and what it never reads, and offers to turn on", () => {
  const html = render({ initial: { snapshot: off } });
  assert.match(html, /never vault, finance or journal activity, and never the content of an event/);
  assert.match(html, />Turn on</);
  assert.match(html, /role="tablist"/);
});

test("character sheet: level, XP to next, progress, stats", () => {
  const html = render({ initial: { snapshot: base } });
  assert.match(html, /Level <span class="technical">2<\/span>/);
  assert.match(html, /150 XP to level 3/);
  assert.match(html, /<progress class="rpg-bar" max="100" value="25" aria-label="Progress to level 3">/);
  // Stats are cards with a bar against the strongest stat (Craft 120 is the top, Focus 30 a quarter of it).
  assert.match(html, /<span class="rpg-stat__name">Craft<\/span><span class="technical">120 XP<\/span><span class="rpg-stat__bar" aria-hidden="true"><span style="width:100%"><\/span><\/span>/);
  assert.match(html, /<span class="rpg-stat__name">Focus<\/span><span class="technical">30 XP<\/span><span class="rpg-stat__bar" aria-hidden="true"><span style="width:25%"><\/span><\/span>/);
  assert.match(html, />Turn off</);
  assert.match(html, />Refresh</);
});

test("tabs: one tab stop, the selected tab controls a labelled panel", () => {
  const html = render({ initial: { snapshot: base, tab: "quests" } });
  assert.equal(html.split('role="tab"').length - 1, 5);
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /id="rpg-tab-quests" aria-selected="true" aria-controls="rpg-panel-quests" tabindex="0"/);
  assert.match(html, /role="tabpanel" id="rpg-panel-quests" aria-labelledby="rpg-tab-quests"/);
});

test("quests: progress as numbers, completions, abandon, and a labelled form", () => {
  const html = render({ initial: { snapshot: base, tab: "quests" } });
  assert.match(html, /Commit today/);
  assert.match(html, /1 of 2 times today/);
  assert.match(html, /Completed 4 times/);
  assert.match(html, /aria-label="Abandon Commit today"/);
  assert.match(html, /<form class="rpg-form" aria-label="New quest">/);
});

test("achievements: unlocked with a date, locked with progress", () => {
  const html = render({ initial: { snapshot: base, tab: "achievements" } });
  assert.match(html, /First steps · unlocked/);
  assert.match(html, /datetime="2026-06-02T10:00:00.000Z"/i);
  assert.match(html, /3 of 7 days/);
});

test("history: what earned the XP, never what the event said; deleted rules say so", () => {
  const html = render({ initial: { snapshot: base, tab: "history" } });
  assert.match(html, /<span class="rpg-history__what"><span>Commit observed<\/span><span class="rpg-hint technical">dev.commit.observed<\/span><\/span>/);
  assert.match(html, /<span>A deleted rule<\/span><span class="rpg-hint technical">clipboard.copy<\/span>/);
  assert.match(html, /\+5 Craft/);
});

test("off: no Refresh while processing is off", () => {
  const html = render({ initial: { snapshot: off } });
  assert.doesNotMatch(html, />Refresh</);
  assert.match(html, />Turn on</);
});

test("deleting a rule and abandoning a quest ask first, in a modal", () => {
  const rules = render({ initial: { snapshot: base, tab: "rules" } });
  assert.match(rules, /aria-label="Delete Commit observed">Delete…<\/button>/);
  assert.match(rules, /<p>\+5 Craft each time, at most 20 a day<\/p><p class="rpg-hint technical">dev.commit.observed<\/p>/);
  const quests = render({ initial: { snapshot: base, tab: "quests" } });
  assert.match(quests, /aria-label="Abandon Commit today">Abandon…<\/button>/);
  const confirm = { actionId: "reality_rpg.rule.delete", params: { ruleId: "commits" }, question: "Delete the rule \"Commit observed\"? XP it already awarded stays.", confirmLabel: "Delete" };
  const html = render({ initial: { snapshot: base, tab: "rules", confirm } });
  assert.match(html, /<div class="rpg-backdrop"><div class="rpg-confirm" role="alertdialog" aria-labelledby="rpg-confirm-text" aria-modal="true">/);
  assert.match(html, /<button type="button" class="rpg-danger">Delete<\/button><button type="button">Cancel<\/button>/);
});

test("rules: on/off, backfill only for rules that are on, delete, starter set, invalid warning", () => {
  const html = render({ initial: { snapshot: { ...base, invalid: { rules: [{ id: "x", errors: ["bad"] }], achievements: [], quests: [] } }, tab: "rules" } });
  assert.match(html, /aria-label="Switch off Commit observed"/);
  assert.match(html, /aria-label="Switch on Standup generated"/);
  assert.match(html, /aria-label="Apply Commit observed to past activity"/);
  assert.doesNotMatch(html, /Apply Standup generated to past activity/);
  assert.match(html, /aria-label="Add rule Backup completed"/);
  assert.match(html, /1 saved definition is no longer valid/);
  assert.match(html, /can never name vault, finance or journal activity/);
});

test("design tokens only: no literal colours; fonts from tokens; the module accent", () => {
  const files = ["RealityRpgView.tsx", "RealityRpg.css", "realityRpgModel.ts"].map((f) => readFileSync(join(desktop, "src/renderer/views", f), "utf8"));
  for (const text of files) {
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, "no hex colours");
    assert.doesNotMatch(text, /\b(rgb|rgba|hsl|hsla)\s*\(/i, "no rgb/hsl colours");
    assert.doesNotMatch(text, /\b(white|black|red|blue|green|gray|grey|gold|yellow)\b\s*[;"'}]/i, "no named colours");
  }
  const css = files[1];
  for (const [, family] of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(family.trim(), /^var\(--font-(ui|tech)\)$/, family);
  assert.match(css, /var\(--accent-loop\)/);
});
