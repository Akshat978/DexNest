/**
 * Search over the newer modules, the screens voice and the Deck can open, and
 * the links kept between records that one module sent to another.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ghostRecords, LIVE_SEARCH_SOURCES, objectRecords, reminderRecords, rpgRecords, skillRecords, timetableRecords } from "../src/main/moduleSearch.ts";
import { addLink, chipsFor, normalizeLinks, pruneLinks, type RecordLink } from "../src/main/recordLinks.ts";
import { viewForSearchSource } from "../src/renderer/lib/searchSources.ts";
import { moduleName } from "../src/renderer/lib/activityLabels.ts";
import { seededActions as actionCatalog, createStreamDeckActionCatalog, streamDeckCatalogItems } from "../../../packages/action-registry/src/index.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");
const NOW = "2026-10-05T12:00:00.000Z";

test("skills, quests, achievements, timetable blocks and reminders become search records", () => {
  const skills = skillRecords([
    { id: "typescript", name: "TypeScript", category: "language", repositoryCount: 3, lastActivityAt: "2026-10-01T00:00:00.000Z", lastEvidenceAt: "2026-10-03T00:00:00.000Z", strength: { score: 0.82 }, hidden: false },
    { id: "jest", name: "Jest", category: "tooling", repositoryCount: 1, lastActivityAt: null, lastEvidenceAt: "2026-10-03T00:00:00.000Z", strength: { score: 0.1 }, hidden: true }
  ], NOW);
  assert.equal(skills.length, 1, "a skill the user hid is not offered");
  assert.equal(skills[0]!.sourceModule, "skills");
  assert.equal(skills[0]!.updatedAt, "2026-10-01T00:00:00.000Z", "dated by the work, not the scan");
  assert.match(skills[0]!.textPreview, /strength 82% · 3 repositories/);

  const game = rpgRecords(
    [{ quest: { id: "q1", title: "Commit on 5 days", status: "active", createdAt: NOW } }],
    [{ achievement: { id: "a1", name: "First commit", description: "Make one commit." }, unlocked: null }],
    NOW
  );
  assert.deepEqual(game.map((r) => [r.sourceModule, r.entityType, r.title]), [["rpg", "quest", "Commit on 5 days"], ["rpg", "achievement", "First commit"]]);
  assert.match(game[1]!.textPreview, /not yet unlocked/);

  const blocks = timetableRecords([{ id: "b1", day: "monday", startTime: "09:00", endTime: "10:00", title: "Gym", category: "health", notes: "", createdAt: NOW, updatedAt: NOW }], NOW);
  assert.equal(blocks[0]!.sourceModule, "timetable");
  assert.match(blocks[0]!.textPreview, /monday 09:00 to 10:00/);

  const nudge = { id: "n1", title: "Renew permit", message: "Expires soon.", sourceModule: "vault", date: "2026-10-09", priority: "urgent", createdAt: NOW, updatedAt: NOW };
  const reminders = reminderRecords([{ ...nudge, status: "active" }, { ...nudge, id: "n2", status: "dismissed" }, { ...nudge, id: "n3", status: "snoozed" }], NOW);
  assert.deepEqual(reminders.map((r) => r.entityId), ["n1", "n3"], "a dismissed reminder is not offered again");
});

test("a GhostOS hit keeps the words searched for, and none of the entry's text", () => {
  const records = ghostRecords([{ id: "e1", type: "decision", title: "Moved to pnpm", timelineAt: "2026-09-01T00:00:00.000Z", origin: "manual" }], "faster installs", NOW);
  assert.equal(records[0]!.sourceModule, "ghost");
  assert.equal(records[0]!.searchableText, "faster installs");
  assert.match(records[0]!.textPreview, /decision · entered by you/);
  assert.deepEqual(Object.keys(records[0]!).includes("description"), false);
});

test("the newer modules are searched live and never written to the index file", () => {
  const main = read("src/main/main.ts");
  assert.deepEqual([...LIVE_SEARCH_SOURCES], ["object", "skills", "ghost", "rpg", "timetable", "reminders"]);
  const drill = objectRecords([{ id: "7K3F9QXM", itemName: "Cordless drill", location: "shed", room: "garage", container: null, notes: "", tags: ["tool"], status: "at_home", createdAt: NOW, updatedAt: NOW }], NOW)[0]!;
  assert.deepEqual([drill.sourceModule, drill.title, drill.textPreview, drill.category], ["object", "Cordless drill", "shed · garage", "garage"]);
  assert.match(main, /records: SearchIndexRecord\[\] = \[\.\.\.loadSearchIndex\(\), \.\.\.liveModuleRecords\(queryInput\.query \?\? ""\)\]/);
  const build = main.slice(main.indexOf("function buildSearchIndexRecords"), main.indexOf("function reindexSearchIndex"));
  assert.doesNotMatch(build, /liveModuleRecords|skillConstellationHost|ghostOsHost|realityRpgHost|loadFinderItems/, "nothing of theirs reaches saveSearchIndex");
  assert.match(main, /if \(!ghostOsHost \|\| !query\.trim\(\)\) return \[\];/, "GhostOS is asked only when something is searched for");
  assert.match(main, /return game\.enabled \? rpgRecords/, "a game that is off adds nothing");
});

test("every search source has a screen to open and one name", () => {
  for (const source of ["vault", "tools", "drop", "clipboard", "dev", "object", "finance", "capture", "journal", "calendar", "skills", "ghost", "rpg", "timetable"]) {
    assert.equal(viewForSearchSource(source), source);
  }
  assert.equal(viewForSearchSource("tools_ocr"), "tools");
  assert.equal(viewForSearchSource("reminders"), "today");
  assert.deepEqual(["skills", "ghost", "rpg", "object", "reminders", "dev", "tools_ocr"].map(moduleName), ["Skills", "GhostOS", "Reality RPG", "ObjectOS", "Reminders", "Projects", "Tools (OCR)"]);
  const shell = read("src/renderer/main.tsx");
  assert.match(shell, /onClick=\{\(\) => onNavigate\(viewForSearchSource\(result\.sourceModule\) as ViewId\)\}/);
});

test("voice opens the newer screens by name and by question", () => {
  const shell = read("src/renderer/main.tsx");
  for (const [alias, actionId] of [["skills", "skill_constellation.open"], ["\"reality rpg\"", "reality_rpg.open"], ["ghostos", "ghost_os.open"], ["objectos", "object_os.open"], ["projects", "dev.open_dashboard"], ["autopilot", "autopilot.open"], ["today", "standup.open"], ["\"activity log\"", "audit.open_history"]] as const) {
    assert.ok(shell.includes(`${alias}: { module:`) && shell.includes(`actionId: "${actionId}" }`), alias);
  }
  const table = shell.slice(shell.indexOf("const voiceScreenQuestions"), shell.indexOf("function viewFromAction"));
  const patterns = [...table.matchAll(/pattern: (\/.+?\/i), module: "([a-z]+)"/g)].map((m) => ({ pattern: new RegExp(m[1]!.slice(1, -2), "i"), module: m[2]! }));
  const answer = (said: string) => patterns.find((entry) => entry.pattern.test(said))?.module ?? null;
  assert.equal(answer("what needs me today"), "today");
  assert.equal(answer("does anything need my attention"), "today");
  assert.equal(answer("where did i leave off"), "today");
  assert.equal(answer("what are my top skills"), "skills");
  assert.equal(answer("what's my level"), "rpg");
  assert.equal(answer("show my quests"), "rpg");
  assert.equal(answer("which warranties are ending soon"), "object");
  assert.equal(answer("what is my passport number"), null, "a private lookup is not mistaken for a screen");
  assert.equal(answer("where is my charger"), null);
  // The local intent model is told the same screens exist.
  assert.match(read("src/main/main.ts"), /targetModule must be one of: .*Today, Projects, Skills, Reality RPG, GhostOS, ObjectOS, Autopilot, Unknown\./);
});

test("the Deck gets buttons for the older screens, and the newer modules stay off it", () => {
  // Today, Skills, Reality RPG, GhostOS and ObjectOS were built not to be
  // offered to the Deck, and each module's own tests hold that. Voice opens
  // them from the desktop without it.
  const opens = ["standup.open", "skill_constellation.open", "reality_rpg.open", "ghost_os.open", "object_os.open"];
  for (const id of opens) {
    const action = actionCatalog.find((item) => item.id === id);
    assert.ok(action, id);
    assert.deepEqual(action.allowedTriggers, ["command", "module_ui"], id);
  }
  const prefixes = ["skill_constellation.", "reality_rpg.", "ghost_os.", "object_os."];
  assert.deepEqual(actionCatalog.filter((item) => prefixes.some((p) => item.id.startsWith(p)) && item.allowedTriggers.includes("deck")).map((item) => item.id), []);

  const buttons = streamDeckCatalogItems(createStreamDeckActionCatalog([], []));
  const screens = buttons.filter((button) => button.category === "Screens");
  assert.deepEqual(screens.map((button) => button.actionId), ["dev.open_dashboard", "vault.open", "capture.open", "tools.open", "audit.open_history"]);
  for (const button of screens) assert.ok(actionCatalog.find((item) => item.id === button.actionId)?.allowedTriggers.includes("deck"), button.actionId);
  assert.equal(buttons.some((button) => opens.includes(button.actionId ?? "")), false, "no Deck button for a module that is not offered to it");
});

const ids = () => { let n = 0; return () => `link-${++n}`; };
const capture = { module: "capture", id: "c1", title: "Drill receipt" };
const entry = { module: "finance", id: "f1", title: "Hardware store" };

test("a link is recorded once, read from both ends, and dropped when an end is deleted", () => {
  const newId = ids();
  let links: RecordLink[] = addLink([], capture, entry, NOW, newId);
  links = addLink(links, capture, entry, NOW, newId);
  assert.equal(links.length, 1, "the same pair is not recorded twice");
  links = addLink(links, capture, capture, NOW, newId);
  links = addLink(links, capture, { module: "clipboard", id: "x", title: "" }, NOW, newId);
  links = addLink(links, capture, { module: "vault", id: "", title: "" }, NOW, newId);
  assert.equal(links.length, 1, "a record is not linked to itself, to an unknown module, or to nothing");
  links = addLink(links, { module: "object", id: "o1", title: "Drill" }, { module: "calendar", id: "e1", title: "Warranty ends: Drill" }, NOW, newId);

  assert.deepEqual(chipsFor(links, "capture").map((c) => [c.recordId, c.direction, c.other.module, c.other.title]), [["c1", "to", "finance", "Hardware store"]]);
  assert.deepEqual(chipsFor(links, "finance").map((c) => [c.recordId, c.recordTitle, c.direction, c.other.module]), [["f1", "Hardware store", "from", "capture"]]);
  assert.deepEqual(chipsFor(links, "calendar").map((c) => [c.direction, c.other.title]), [["from", "Drill"]]);
  assert.deepEqual(chipsFor(links, "journal"), []);

  const afterDelete = pruneLinks(links, (ref) => !(ref.module === "finance" && ref.id === "f1"));
  assert.deepEqual(afterDelete.map((link) => link.to.module), ["calendar"]);
  assert.deepEqual(normalizeLinks([links[0], { id: "x", from: capture }, "junk", null]), [links[0]]);
  assert.deepEqual(normalizeLinks("nope"), []);
});

test("links are made where one module sends to another, and nowhere reads the other module", () => {
  const main = read("src/main/main.ts");
  for (const target of ["journal", "calendar", "vault", "finance", "object"]) {
    assert.match(main, new RegExp(`linkRecords\\(captureRef\\(item\\), \\{ module: "${target}"`), `capture to ${target}`);
  }
  assert.match(main, /if \(!existing && nextEvent\.sourceId && nextEvent\.sourceModule !== "calendar"\)/, "an event that names where it came from");
  assert.match(main, /if \(origin\) linkRecords\(origin, \{ module: "finance", id: nextTransaction\.id/);
  assert.match(main, /const recordLinksPath = join\(settingsRoot, "record-links\.json"\);/, "kept under the data root");
  assert.match(main, /if \(live\.length !== links\.length\) writeJsonFile\(recordLinksPath, live\);/);
  assert.match(read("src/renderer/views/objectOsModel.ts"), /return \{ sourceModule: "object", sourceId: o\.id, date: purchase\.purchasedOn/);
  const shell = read("src/renderer/main.tsx");
  for (const module of ["vault", "journal", "calendar", "finance", "capture"]) assert.match(shell, new RegExp(`useRecordLinks\\(getBridge\\(\\), "${module}"`), module);
});

test("ObjectOS sends one file to the Vault, on a click, from DexNest's own window", () => {
  const action = actionCatalog.find((item) => item.id === "vault.import_from_object");
  assert.ok(action);
  assert.deepEqual(action.allowedTriggers, ["command", "module_ui"]);
  const main = read("src/main/main.ts");
  const handler = main.slice(main.indexOf('if (action.id === "vault.import_from_object")'), main.indexOf('if (action.id === "vault.edit_document_metadata")'));
  assert.match(handler, /if \(source !== "module_ui" && source !== "command"\) throw new Error/);
  assert.match(handler, /objectOsHost\.module\.openFile\(\{ fileId: String\(params\.fileId \?\? ""\) \}\)/, "the path comes from ObjectOS, never from the request");
  assert.doesNotMatch(handler, /params\.path/);
  assert.match(handler, /linkRecords\(\{ module: "object", id: owner\.id/);
  assert.match(read("src/renderer/views/ObjectOsView.tsx"), /<SendTo label="Send to Vault" done="Copied to the Vault" actionId="vault\.import_from_object" params=\{\{ fileId: f\.id \}\}/);
});
