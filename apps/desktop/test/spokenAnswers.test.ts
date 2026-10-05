/**
 * The Standup's lines in Search, and the short answers DexNest says aloud to
 * the questions a screen answers.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_SEARCH_SOURCES, standupRecords } from "../src/main/moduleSearch.ts";
import { levelAnswer, needsAnswer, skillsAnswer, SPOKEN_ANSWER_KINDS, spokenAnswer, thingsAnswer } from "../src/renderer/lib/spokenAnswers.ts";
import { viewForSearchSource } from "../src/renderer/lib/searchSources.ts";
import { moduleName } from "../src/renderer/lib/activityLabels.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");
const NOW = "2026-10-05T18:00:00.000Z";

test("the latest Standup's lines are search records that open Today", () => {
  const report = {
    generatedAt: "2026-10-05T14:00:00.000Z",
    sections: [
      { kind: "Continue", items: [{ id: "c1", title: "alpha", summary: "Most recently active repository with 1 new commit." }] },
      { kind: "Changed", items: [{ id: "x1", title: "alpha: add the feature" }, { id: "x2", title: "Pushed to origin/main", summary: "alpha" }] },
      { kind: "NeedsAttention", items: [{ id: "n1", title: "Failing check: lint" }] },
      { kind: "History", items: [{ id: "x1", title: "alpha: add the feature" }] },
      { kind: "SomethingNew", items: [{ id: "z1", title: "A later kind of line" }] }
    ]
  };
  const records = standupRecords(report, NOW);
  assert.deepEqual(records.map((r) => r.entityId), ["c1", "x1", "x2", "n1", "z1"], "a line listed in two sections is one result");
  assert.ok(records.every((r) => r.sourceModule === "today" && r.entityType === "standup_line" && r.filePath === null));
  assert.equal(records[0]!.textPreview, "Standup · Where you left off · Most recently active repository with 1 new commit.");
  assert.equal(records[1]!.textPreview, "Standup · Changed since the last Standup");
  assert.equal(records[3]!.category, "Needs attention");
  assert.equal(records[4]!.category, "SomethingNew", "a section this code does not know keeps its own name");
  // An internal id never reaches a result: that summary is dropped, the title stays.
  const raw = standupRecords({ generatedAt: NOW, sections: [{ kind: "Changed", items: [{ id: "r1", title: "alpha: add the feature", summary: "Commit observed in repo_32e1b0c4d9aa77f0" }] }] }, NOW)[0]!;
  assert.equal(raw.textPreview, "Standup · Changed since the last Standup");
  assert.equal(JSON.stringify(raw).includes("repo_32e"), false);
  assert.equal(records[0]!.updatedAt, "2026-10-05T14:00:00.000Z", "dated when the Standup was made");
  assert.deepEqual(standupRecords(null, NOW), []);
  assert.deepEqual(standupRecords({ generatedAt: NOW, sections: [] }, NOW), []);

  assert.ok(LIVE_SEARCH_SOURCES.includes("today"));
  assert.equal(viewForSearchSource("today"), "today");
  assert.equal(moduleName("today"), "Today");
});

test("the Standup is read when a search is run, kept in memory only, and never put in the index file", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /if \(action\.id === "search\.run_query"\) \{\s*await refreshStandupForSearch\(\);\s*const results = runSearchQuery\(input\);/);
  assert.match(main, /standupForSearch = devIntelligenceHost \? await devIntelligenceHost\.module\.latestStandup\(\) : null;/);
  assert.match(main, /\.\.\.from\(\(\) => standupRecords\(standupForSearch, now\)\),/);
  const build = main.slice(main.indexOf("function buildSearchIndexRecords"), main.indexOf("function reindexSearchIndex"));
  assert.doesNotMatch(build, /standup|Standup/, "nothing of it reaches the index file");
  // Search results never leave through the Deck endpoint: its reply has no results in it.
  const reply = main.slice(main.indexOf("function safeEndpointResponse"), main.indexOf("function safeEndpointResponse") + 1800);
  assert.doesNotMatch(reply, /results|smartResults/);
});

test("what needs you is a count", () => {
  assert.equal(needsAnswer(0), "Nothing needs you right now.");
  assert.equal(needsAnswer(-3), "Nothing needs you right now.");
  assert.equal(needsAnswer(1), "One thing needs you. It is on Today.");
  assert.equal(needsAnswer(4), "4 things need you. They are on Today.");
});

test("your level, and how far the next one is", () => {
  assert.equal(levelAnswer({ enabled: true, sheet: { level: 4, totalXp: 320, xpToNextLevel: 80 } }), "You are level 4, with 320 XP. 80 more to reach level 5.");
  assert.equal(levelAnswer({ enabled: true, sheet: { level: 50, totalXp: 99999, xpToNextLevel: null } }), "You are level 50, with 99999 XP.");
  assert.equal(levelAnswer({ enabled: false, sheet: { level: 1, totalXp: 0, xpToNextLevel: 100 } }), "Reality RPG is turned off.");
  assert.equal(levelAnswer(null), "Reality RPG is not available.");
});

test("your strongest skills, by name, leaving out hidden ones", () => {
  const skill = (name: string, score: number, hidden = false) => ({ name, hidden, strength: { score } });
  assert.equal(skillsAnswer([skill("React", 0.6), skill("TypeScript", 0.9), skill("Python", 0.4), skill("Docker", 0.2)]), "Your strongest skills are TypeScript, React and Python.");
  assert.equal(skillsAnswer([skill("React", 0.6), skill("TypeScript", 0.9)]), "Your strongest skills are TypeScript and React.");
  assert.equal(skillsAnswer([skill("Go", 0.3)]), "Your strongest skill is Go.");
  assert.equal(skillsAnswer([skill("Secret project language", 0.99, true), skill("Go", 0.3)]), "Your strongest skill is Go.", "a skill you hid is not said aloud");
  assert.equal(skillsAnswer([skill("Jest", 0)]), "No skills yet. Run a repository scan, then rebuild Skills.");
  assert.equal(skillsAnswer([]), "No skills yet. Run a repository scan, then rebuild Skills.");
  assert.equal(skillsAnswer(null), "No skills yet. Run a repository scan, then rebuild Skills.");
});

test("your things: counts, never which object", () => {
  assert.equal(thingsAnswer({ overdue: 0, dueSoon: 0, warrantyEnding: 0, lowStock: 0 }), "No maintenance is due and no warranties are ending.");
  assert.equal(thingsAnswer({ overdue: 1, dueSoon: 0, warrantyEnding: 0, lowStock: 0 }), "1 maintenance job is overdue.");
  assert.equal(thingsAnswer({ overdue: 2, dueSoon: 1, warrantyEnding: 1, lowStock: 0 }), "2 maintenance jobs are overdue, 1 is due soon and 1 warranty is ending.");
  assert.equal(thingsAnswer({ overdue: 0, dueSoon: 0, warrantyEnding: 3, lowStock: 2 }), "3 warranties are ending and 2 parts are low on stock.");
  assert.equal(thingsAnswer(null), "ObjectOS is not available.");
});

test("the answer is read through the bridge, and anything that fails is simply not said", async () => {
  const bridge = {
    getTodayAgenda: async () => ({ items: [] }),
    objectOsAttention: async () => ({ summary: { items: [{ kind: "warranty", objectId: "o1", state: "ending", daysLeft: 3 }], counts: { overdue: 0, dueSoon: 0, warrantyEnding: 1, lowStock: 0 } }, names: { o1: "Workshop printer" } }),
    autopilotAttention: async () => null,
    realityRpgSnapshot: async () => ({ enabled: true, sheet: { level: 2, totalXp: 150, xpToNextLevel: 50 } }),
    skillConstellationSnapshot: async () => ({ skills: [{ name: "TypeScript", hidden: false, strength: { score: 0.8 } }] })
  };
  assert.equal(await spokenAnswer("needs", bridge), "One thing needs you. It is on Today.");
  assert.equal(await spokenAnswer("level", bridge), "You are level 2, with 150 XP. 50 more to reach level 3.");
  assert.equal(await spokenAnswer("skills", bridge), "Your strongest skill is TypeScript.");
  const things = await spokenAnswer("things", bridge);
  assert.equal(things, "1 warranty is ending.");
  assert.equal(things!.includes("Workshop printer"), false, "the object's name is not spoken");

  // Not one of DexNest's own kinds: nothing is said, whatever was passed.
  for (const other of [undefined, null, "", "vault", "finance", "journal", "password", { kind: "needs" }, 3]) assert.equal(await spokenAnswer(other, bridge), null, String(other));
  assert.deepEqual([...SPOKEN_ANSWER_KINDS], ["needs", "level", "skills", "things"]);

  // A source that fails or is missing counts as empty; the screen is open either way.
  const broken = { getTodayAgenda: async () => { throw new Error("no"); }, realityRpgSnapshot: async () => { throw new Error("no"); } };
  assert.equal(await spokenAnswer("needs", broken), "Nothing needs you right now.");
  assert.equal(await spokenAnswer("level", broken), "Reality RPG is not available.");
  assert.equal(await spokenAnswer("skills", {}), "No skills yet. Run a repository scan, then rebuild Skills.");
  assert.equal(await spokenAnswer("things", {}), "ObjectOS is not available.");
});

test("nothing private can be spoken this way", () => {
  const source = read("src/renderer/lib/spokenAnswers.ts");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /vault|finance|journal|clipboard|capture|getSearch|smart_lookup/i, "the file reads none of the private modules");
  const bridge = code.slice(code.indexOf("export interface SpokenAnswerBridge"), code.indexOf("/** The answer to say"));
  assert.deepEqual([...bridge.matchAll(/^\s+(\w+)\?\(\)/gm)].map((m) => m[1]), ["getTodayAgenda", "objectOsAttention", "autopilotAttention", "realityRpgSnapshot", "skillConstellationSnapshot"]);
});

test("the questions that get an answer, and the ones that only open a screen", () => {
  const shell = read("src/renderer/main.tsx");
  const table = shell.slice(shell.indexOf("const voiceScreenQuestions"), shell.indexOf("function viewFromAction"));
  const rows = [...table.matchAll(/pattern: (\/.+?\/i), module: "([a-z]+)", actionId: "[a-z_.]+", explanation: "[^"]*"(?:, answer: "([a-z]+)")?/g)].map((m) => ({ pattern: new RegExp(m[1]!.slice(1, -2), "i"), module: m[2]!, answer: m[3] ?? null }));
  const ask = (said: string) => { const row = rows.find((entry) => entry.pattern.test(said)); return row ? `${row.module}:${row.answer}` : null; };
  assert.equal(ask("what needs me"), "today:needs");
  assert.equal(ask("does anything need my attention"), "today:needs");
  assert.equal(ask("what are my top skills"), "skills:skills");
  assert.equal(ask("what's my level"), "rpg:level");
  assert.equal(ask("what is my xp"), "rpg:level");
  assert.equal(ask("which warranties are ending soon"), "object:things");
  // These name projects or personal entries, so they open the screen and say nothing more.
  assert.equal(ask("where did i leave off"), "today:null");
  assert.equal(ask("show my quests"), "rpg:null");
  assert.equal(ask("what's my timeline"), "ghost:null");
  assert.equal(ask("what is my passport number"), null);

  assert.match(shell, /params: screenQuestion\.answer \? \{ answer: screenQuestion\.answer \} : \{\},/);
  assert.match(shell, /const said = result\.ok === false \? null : await spokenAnswer\(route\.params\.answer, getBridge\(\)\)\.catch\(\(\) => null\);/);
  assert.match(shell, /await speakDexNestResponse\(said \?\? spokenTemplate\(route, result\.ok !== false, resultCount, answerText\), \{/);
});
