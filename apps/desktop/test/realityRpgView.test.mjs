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
  starter: {
    rules: [
      { ...rule, id: "commit-observed", name: "Made a commit", enabled: false },
      { ...rule, id: "push-observed", name: "Pushed your work", enabled: false, match: { types: ["dev.push.observed"], stream: "dev" }, award: { xp: 8, stat: "Craft" }, dailyCap: 10 },
      { ...rule, id: "backup-completed", name: "Made a backup", enabled: false, match: { types: ["backup_created"], stream: "audit", actionIds: ["backup.create"], status: "success" }, award: { xp: 15, stat: "Order" }, dailyCap: 1 },
      { ...rule, id: "block-done", name: "Finished a timetable block", enabled: false, match: { types: ["timetable_mark_done"], stream: "audit", actionIds: ["timetable.mark_done"], status: "success" }, award: { xp: 5, stat: "Focus" }, dailyCap: 12 }
    ],
    achievements: [
      { id: "level-5", name: "Level 5", description: "Reach level 5 (1,000 XP).", condition: { kind: "xp", target: 1000 } },
      { id: "backups-5", name: "Five backups", description: "Make 5 backups.", condition: { kind: "count", ruleIds: ["backup-completed"], target: 5 } },
      { id: "commits-10", name: "Ten commits", description: "Make 10 commits.", condition: { kind: "count", ruleIds: ["commits"], target: 10 } }
    ],
    quests: [
      { id: "commit-5-days", title: "Commit on 5 days this week", needs: "commit-observed", recommended: true, condition: { kind: "days", ruleIds: ["commit-observed"], target: 5 }, window: { kind: "weekly" } },
      { id: "blocks-3-day", title: "Finish 3 timetable blocks today", needs: "block-done", recommended: true, condition: { kind: "count", ruleIds: ["block-done"], target: 3 }, window: { kind: "daily" } }
    ],
    info: {
      "commit-observed": { group: "projects", groupLabel: "Your projects", when: "you make a commit in a project the scan follows", recommended: true },
      "push-observed": { group: "projects", groupLabel: "Your projects", when: "you push, from DexNest, an editor or the command line", recommended: true },
      "backup-completed": { group: "dexnest", groupLabel: "Things done in DexNest", when: "you make a backup", recommended: true },
      "block-done": { group: "life", groupLabel: "Day to day", when: "you mark a timetable block done", recommended: false }
    }
  }
};
const off = { ...base, enabled: false, sheet: { totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] }, rules: [], achievements: [], quests: [], recentAwards: [], lastRun: null };

const render = (props) => renderToStaticMarkup(createElement(View, { bridge, onAction, ...props }));

test("loading: a status, busy, no actions yet", () => {
  const html = render({});
  assert.match(html, /role="status"[^>]*>(?:<[^>]+>)*Loading your character…/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, />Refresh</);
});

test("error: an alert with the reason and a retry", () => {
  const html = render({ initial: { snapshot: null, error: "database is locked" } });
  assert.match(html, /role="alert"/);
  assert.match(html, /database is locked/);
  assert.match(html, />Try again</);
});

test("off: one screen and one step - what counts is ticked from the built-in set, and one button turns it on", () => {
  const html = render({ initial: { snapshot: off } });
  assert.match(html, /<section class="rpg-start" aria-labelledby="rpg-start-title">/);
  assert.match(html, /<h2 id="rpg-start-title">Turn what you already do into XP<\/h2>/);
  assert.match(html, /nothing you did before counts\./);
  assert.match(html, /never vault, finance or journal activity, and never the content of anything/);
  // Grouped, in plain words, with what each is worth; recommended ones ticked.
  assert.match(html, /<legend>Your projects<\/legend>/);
  assert.match(html, /<legend>Things done in DexNest<\/legend>/);
  assert.match(html, /<legend>Day to day<\/legend>/);
  assert.match(html, /<input type="checkbox" checked=""\/><span class="rpg-pick__text"><span class="rpg-pick__name">Made a commit<\/span><span class="rpg-hint">When you make a commit in a project the scan follows\.<\/span><\/span><span class="rpg-pick__xp technical">\+5 Craft each time, at most 20 a day<\/span>/);
  assert.match(html, /<input type="checkbox"\/><span class="rpg-pick__text"><span class="rpg-pick__name">Finished a timetable block<\/span>/, "not recommended: offered, not ticked");
  assert.doesNotMatch(html, /dev\.commit\.observed|backup_created/, "no event names on the first screen");
  // Quests: one whose rule is ticked is ticked; one whose rule is not is offered but waits for it.
  assert.match(html, /<legend>Quests to start with<\/legend>/);
  assert.match(html, /<label class="rpg-pick"><input type="checkbox" checked=""\/><span class="rpg-pick__text"><span class="rpg-pick__name">Commit on 5 days this week<\/span><\/span><span class="rpg-pick__xp">every week<\/span>/);
  assert.match(html, /<label class="rpg-pick rpg-pick--off"><input type="checkbox" disabled=""\/><span class="rpg-pick__text"><span class="rpg-pick__name">Finish 3 timetable blocks today<\/span><span class="rpg-hint">Needs “Finished a timetable block” ticked above\.<\/span>/);
  assert.match(html, /<button type="button" class="kit-button kit-button--primary kit-button--md">Turn on with 3 rules and 1 quest<\/button>/);
  // Said once: no second "is off" card, no empty character sheet, no tabs to wander into.
  assert.doesNotMatch(html, /Reality RPG is off|Nothing earned yet|role="tablist"|kit-hero/);
  assert.equal(html.split(">Turn on").length - 1, 1, "one way to turn it on");
});

test("on with nothing earned yet: how to earn the first XP, from the rules that are on", () => {
  const fresh = { ...base, sheet: { totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] }, recentAwards: [], rules: [{ ...rule, id: "commit-observed", name: "Made a commit" }, { ...rule, id: "backup-completed", name: "Made a backup", award: { xp: 15, stat: "Order" } }, offRule] };
  const html = render({ initial: { snapshot: fresh, today: "2026-06-03" } });
  assert.match(html, /How to earn your first XP/);
  // Biggest reward first; a rule that is off is not a way to earn.
  assert.ok(html.indexOf("Made a backup") < html.indexOf("Made a commit"));
  assert.match(html, /When you make a backup/);
  assert.match(html, /\+15 Order/);
  assert.doesNotMatch(html.slice(html.indexOf("How to earn"), html.indexOf("XP · last 14 days")), /Standup generated/);
  assert.match(html, /Project activity is seen at the next repository scan\./);
  const none = render({ initial: { snapshot: { ...fresh, rules: [offRule] }, today: "2026-06-03" } });
  assert.match(none, /No rule is switched on, so nothing can earn yet\./);
});

test("character sheet: a hero with the level ring, stat tiles strongest first, XP by day, quests, recent XP, next achievement", () => {
  const html = render({ initial: { snapshot: base, today: "2026-06-03" } });
  // The hero: the level as a ring a screen reader can read, the XP total, what's next.
  assert.match(html, /<section class="kit-hero">/);
  assert.match(html, /kit-hero__eyebrow">Level 2</);
  assert.match(html, /kit-hero__title">150 XP</);
  assert.match(html, /role="img" aria-label="Level 2, 25% of the way to level 3"/);
  assert.match(html, /150 XP to level 3 · strongest stat: Craft · 1 of 2 achievements/);
  // Stat tiles, strongest first, each against the strongest.
  assert.match(html, /kit-stat__label">Craft<\/p><\/div><p class="kit-stat__value">120 XP<\/p><p class="kit-stat__foot"><span class="kit-stat__hint">strongest</);
  assert.match(html, /kit-stat__label">Focus<\/p><\/div><p class="kit-stat__value">30 XP<\/p><p class="kit-stat__foot"><span class="kit-stat__hint">25% of Craft</);
  // XP by day, with a text version; both awards fall in the window and fewer than 50 are loaded, so no caveat.
  assert.match(html, /XP earned per day over the last 14 days: [^<]*02 1, 03 5/);
  assert.doesNotMatch(html, /latest 50 awards/);
  // Active quest as a meter; recent XP as rows; the next achievement with its progress.
  assert.match(html, /kit-meter__label">Commit today<\/span><span class="kit-meter__value">1 of 2 times today</);
  assert.match(html, /kit-row__title">Commit observed<\/span>/);
  assert.match(html, /\+5 Craft/);
  assert.match(html, /kit-row__title">Committed week</);
  assert.match(html, /aria-valuenow="43"/, "3 of 7 days");
  assert.match(html, />Turn off</);
  assert.match(html, />Refresh</);
});

test("character sheet: with 50 awards loaded that don't reach back two weeks, the chart says it may be short", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...base.recentAwards[0], id: `a${i}`, localDay: "2026-06-03" }));
  const html = render({ initial: { snapshot: { ...base, recentAwards: many }, today: "2026-06-03" } });
  assert.match(html, /From your latest 50 awards; earlier days may have more\./);
});

test("tabs: one tab stop, the selected tab controls a labelled panel", () => {
  const html = render({ initial: { snapshot: base, tab: "quests" } });
  assert.equal(html.split('role="tab"').length - 1, 5);
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /id="rpg-tab-quests" aria-selected="true" aria-controls="rpg-panel-quests" tabindex="0"/);
  assert.match(html, /role="tabpanel" id="rpg-panel-quests" aria-labelledby="rpg-tab-quests"/);
});

test("quests: cards with a progress meter, completions, abandon, and a labelled form", () => {
  const html = render({ initial: { snapshot: base, tab: "quests" } });
  assert.match(html, /<li class="rpg-quest">/);
  assert.match(html, /rpg-item__title">Commit today</);
  assert.match(html, /kit-meter__label">1 of 2 times today</);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="50"/);
  assert.match(html, /Completed 4 times/);
  assert.match(html, /aria-label="Abandon Commit today"/);
  assert.match(html, /<form class="rpg-form" aria-label="New quest">/);
});

test("achievements: medallions - earned ones lit with a date, locked ones dim with progress; the state is read out", () => {
  const html = render({ initial: { snapshot: base, tab: "achievements" } });
  assert.match(html, /1 of 2 unlocked/);
  assert.match(html, /<li class="rpg-medal rpg-medal--done">[\s\S]*?First steps<span class="kit-visually-hidden"> · unlocked<\/span>/);
  assert.match(html, /datetime="2026-06-02T10:00:00.000Z"/i);
  assert.match(html, /<li class="rpg-medal">[\s\S]*?Committed week<span class="kit-visually-hidden"> · locked<\/span>[\s\S]*?3 of 7 days/);
});

test("history: what earned the XP, never what the event said; deleted rules say so", () => {
  const html = render({ initial: { snapshot: base, tab: "history" } });
  assert.match(html, /kit-row__title">Commit observed<\/span><span class="kit-row__meta"><span class="technical">dev.commit.observed<\/span>/);
  assert.match(html, /kit-row__title">A deleted rule<\/span><span class="kit-row__meta"><span class="technical">clipboard.copy<\/span>/);
  assert.match(html, /rpg-history__xp">\+5 Craft</);
});

test("off: no Refresh while processing is off", () => {
  const html = render({ initial: { snapshot: off } });
  assert.doesNotMatch(html, />Refresh</);
  assert.match(html, />Turn on with /);
});

test("deleting a rule and abandoning a quest ask first, in a modal", () => {
  const rules = render({ initial: { snapshot: base, tab: "rules" } });
  assert.match(rules, /aria-label="Delete Commit observed">Delete…<\/button>/);
  assert.match(rules, /<p>\+5 Craft each time, at most 20 a day<\/p><p class="rpg-hint technical">dev.commit.observed<\/p>/);
  const quests = render({ initial: { snapshot: base, tab: "quests" } });
  assert.match(quests, /aria-label="Abandon Commit today">Abandon…<\/button>/);
  const confirm = { actionId: "reality_rpg.rule.delete", params: { ruleId: "commits" }, title: "Delete the rule \"Commit observed\"?", detail: "XP it already awarded stays.", confirmLabel: "Delete" };
  const html = render({ initial: { snapshot: base, tab: "rules", confirm } });
  assert.match(html, /<div class="kit-backdrop" style="--kit-accent:var\(--accent-rpg\)"><div class="kit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)">/);
  assert.match(html, /<h2 id="[^"]+" class="kit-dialog__title">Delete the rule &quot;Commit observed&quot;\?<\/h2><p id="[^"]+" class="kit-dialog__description">XP it already awarded stays\.<\/p>/);
  assert.match(html, /class="kit-button kit-button--ghost kit-button--md kit-confirm__cancel">Cancel<\/button><button type="button" class="kit-button kit-button--danger kit-button--md kit-confirm__ok">Delete<\/button>/);
});
test("rules: a rule applied to past activity says so, not \"Counts from 1970-01-01\" (Integration QA F12)", () => {
  const backfilled = { ...rule, id: "backfilled", name: "Backfilled", effectiveFrom: "1970-01-01T00:00:00.000Z" };
  const html = render({ initial: { snapshot: { ...base, rules: [backfilled, rule] }, tab: "rules" } });
  assert.match(html, /Counts all past activity/);
  assert.doesNotMatch(html, /1970-01-01/);
  assert.match(html, /Counts from <time class="technical" dateTime="2026-06-01T00:00:00.000Z">/);
});


test("rules: on/off, backfill only for rules that are on, delete, starter set, invalid warning", () => {
  const html = render({ initial: { snapshot: { ...base, invalid: { rules: [{ id: "x", errors: ["bad"] }], achievements: [], quests: [] } }, tab: "rules" } });
  assert.match(html, /aria-label="Switch off Commit observed"/);
  assert.match(html, /aria-label="Switch on Standup generated"/);
  assert.match(html, /aria-label="Apply Commit observed to past activity"/);
  assert.doesNotMatch(html, /Apply Standup generated to past activity/);
  assert.match(html, /1 saved definition is no longer valid/);
  assert.match(html, /can never count vault, finance or journal activity/);
  // The built-in set: grouped, in plain words, with no event names.
  assert.match(html, /<h3 id="rpg-starter">Built-in rules, quests and achievements<\/h3>/);
  assert.match(html, /<h4>Things done in DexNest<\/h4><ul class="rpg-list"><li class="rpg-item"><p class="rpg-item__title">Made a backup<\/p><p class="rpg-hint">When you make a backup\. \+15 Order each time, at most 1 a day\.<\/p><button[^>]*aria-label="Add rule Made a backup">Add<\/button>/);
  // An achievement is offered when a rule it counts is there, or it is about XP; a quest when its rule is there.
  assert.match(html, /aria-label="Add achievement Level 5"/);
  assert.match(html, /aria-label="Add achievement Ten commits"/);
  assert.doesNotMatch(html, /aria-label="Add achievement Five backups"/, "its rule has not been added");
  assert.doesNotMatch(html, /aria-label="Start quest /, "no quest until its rule is added");
});

test("a rule of your own: what earns it is picked from a list in plain words; event names are tucked away", () => {
  const html = render({ initial: { snapshot: base, tab: "rules" } });
  assert.match(html, /<h3>A rule of your own<\/h3>/);
  assert.match(html, /What earns it/);
  assert.match(html, /<optgroup label="Your projects"><option value="commit-observed">When you make a commit in a project the scan follows<\/option><option value="push-observed">When you push, from DexNest, an editor or the command line<\/option><\/optgroup>/);
  assert.match(html, /<option value="custom">Something else \(name the events yourself\)<\/option>/);
  // The event names are still there for whoever wants them, closed until asked for.
  assert.match(html, /<details class="rpg-advanced"><summary>The event names behind it<\/summary>/);
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
  assert.match(css, /var\(--accent-rpg\)/);
});

test("character sheet: a quiet fortnight says so instead of an empty chart; off shows no empty sheet", () => {
  const quiet = render({ initial: { snapshot: base, today: "2026-07-30" } });
  assert.match(quiet, /No XP in the last 14 days\./);
  assert.doesNotMatch(quiet, /class="kit-bars"/);
  const html = render({ initial: { snapshot: off } });
  assert.doesNotMatch(html, /kit-hero/);
});
