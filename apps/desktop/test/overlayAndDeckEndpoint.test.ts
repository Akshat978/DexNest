/**
 * The Heatmap's "done in DexNest" grid, and the Stream Deck endpoint running
 * only what is marked for the Deck.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildActivityOverlay, isByHand, OVERLAY_DAYS, OVERLAY_READ_LIMIT, type OverlayEvent } from "../src/main/activityOverlay.ts";
import { createStreamDeckActionCatalog, seededActions, streamDeckCatalogItems } from "../../../packages/action-registry/src/index.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

// A fixed clock and a fixed reading of weekday and hour (UTC), so this reads the same on every machine.
const NOW = new Date("2026-10-05T18:00:00.000Z"); // a Monday
const utcSlot = (iso: string) => { const d = new Date(iso); return { day: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() }; };
const event = (at: string, source: string | null = "module_ui", module: string | null = "capture"): OverlayEvent => ({ at, source, module });
const overlay = (events: OverlayEvent[], extra: { days?: number; limit?: number } = {}) => buildActivityOverlay(events, NOW, { slot: utcSlot, ...extra });

test("what you did is counted by weekday and hour, Monday first", () => {
  const o = overlay([
    event("2026-10-05T14:10:00.000Z"),
    event("2026-10-05T14:50:00.000Z"),
    event("2026-10-04T09:00:00.000Z", "voice", "calendar"),
    event("2026-09-30T23:30:00.000Z", "command", "capture")
  ]);
  assert.equal(o.grid.length, 7);
  assert.ok(o.grid.every((row) => row.length === 24));
  assert.equal(o.grid[0]![14], 2, "Monday, two o'clock");
  assert.equal(o.grid[6]![9], 1, "Sunday morning");
  assert.equal(o.grid[2]![23], 1, "Wednesday, late");
  assert.equal(o.total, 4);
  assert.deepEqual(o.byModule, [{ module: "capture", count: 3 }, { module: "calendar", count: 1 }]);
  assert.equal(o.days, OVERLAY_DAYS);
  assert.equal(o.partial, false);
});

test("only what was set off by hand counts, and only in the period", () => {
  assert.equal(isByHand("module_ui"), true);
  for (const source of ["command", "voice", "keyboard_shortcut", "deck", "stream_deck_http", "routine"]) assert.equal(isByHand(source), true, source);
  for (const source of ["system", "scheduler", "tray", "", null, undefined]) assert.equal(isByHand(source), false, String(source));
  const o = overlay([
    event("2026-10-05T10:00:00.000Z", "system", "dev"), // a scan: DexNest's doing, not yours
    event("2026-10-05T10:00:00.000Z", null),
    event("2026-08-01T10:00:00.000Z"), // before the period
    event("2026-10-06T10:00:00.000Z"), // after now: a clock set wrong
    event("not a date"),
    event("2026-10-05T11:00:00.000Z", "module_ui", null),
    event("2026-10-05T11:30:00.000Z", "module_ui", "  ")
  ]);
  assert.equal(o.total, 2);
  assert.deepEqual(o.byModule, [{ module: "DexNest", count: 2 }], "an event with no module is counted under DexNest");
  assert.equal(overlay([]).total, 0);
  assert.equal(overlay([event("2026-10-05T10:00:00.000Z")], { days: 0 }).total, 0);
});

test("a reading that was cut off says so; one that reached the end of the period does not", () => {
  const recent = Array.from({ length: 50 }, (_, i) => event(new Date(NOW.getTime() - i * 60_000).toISOString()));
  assert.equal(overlay(recent, { limit: 50 }).partial, true, "fifty asked for, fifty came back, all inside the period: there were more");
  assert.equal(overlay(recent, { limit: 500 }).partial, false);
  assert.equal(overlay([...recent.slice(0, 49), event("2026-07-01T00:00:00.000Z")], { limit: 50 }).partial, false, "the oldest read is before the period, so the period is whole");
  assert.equal(overlay(recent).partial, false);
  assert.ok(OVERLAY_READ_LIMIT >= 1000);
  assert.equal(overlay(Array.from({ length: 12 }, (_, i) => event("2026-10-05T10:00:00.000Z", "module_ui", `m${i}`))).byModule.length, 6, "the six busiest modules");
});

test("the overlay is counted when the Heatmap asks, sends counts only, and keeps nothing", () => {
  const main = read("src/main/main.ts");
  const handler = main.slice(main.indexOf('ipcMain.handle("dexnest:heatmap-activity"'), main.indexOf('ipcMain.handle("dexnest:list-activity"'));
  assert.match(handler, /return buildActivityOverlay\(events, new Date\(\), \{ limit: OVERLAY_READ_LIMIT \}\);/);
  assert.match(handler, /at: event\.recordedAt, source: .*, module: /);
  assert.doesNotMatch(handler, /summary|actionId|writeJsonFile|writeFileSync/, "what an event was about is not read out, and nothing is saved");
  const view = read("src/renderer/views/HeatmapView.tsx");
  assert.match(view, /void \(bridge\.getHeatmapActivity\?\.\(\) \?\? Promise\.resolve\(null\)\)\.then\(/);
  assert.doesNotMatch(view, /setInterval\(/, "no timer polls for it");
  assert.match(view, /Done in DexNest · last \{overlay\.days\} days/);
  assert.match(view, /The grid above is which windows were in front\. This one is what you set off in DexNest itself/);
  assert.match(read("src/renderer/styles.css"), /\.heatmap-overlay__cell\[data-on="true"\] \{\s*background: var\(--accent-heatmap, var\(--accent\)\);/);
});

// --- the Stream Deck endpoint -------------------------------------------------------

test("the Deck endpoint runs only what is marked for the Deck, and is refused before any confirmation is read", () => {
  const main = read("src/main/main.ts");
  assert.match(main, /function deckEndpointMayRun\(action: Pick<DexNestActionDefinition, "allowedTriggers">, source: DexNestActionTrigger\): boolean \{\s*return source !== "stream_deck_http" \|\| action\.allowedTriggers\.includes\("deck"\);/);
  const runner = main.slice(main.indexOf("async function runRegisteredAction"), main.indexOf("async function runRegisteredAction") + 2600);
  const refused = runner.indexOf("if (!deckEndpointMayRun(action, source))");
  assert.ok(refused > 0);
  assert.ok(refused < runner.indexOf("const needsConfirmation"), "a request that says it is confirmed is refused all the same");
  assert.match(runner, /eventType: "action_rejected",[\s\S]{0,200}reason: "not_marked_for_deck"/, "and the refusal is logged");
  assert.match(main, /\.filter\(\(action\) => deckEndpointMayRun\(action, "stream_deck_http"\)\)\.map\(deckActionSummary\)/, "the endpoint does not offer what it would refuse");
});

test("nothing destructive that is kept off the Deck can be reached through its endpoint", () => {
  const offDeck = seededActions.filter((a) => !a.allowedTriggers.includes("deck"));
  const ids = offDeck.map((a) => a.id);
  for (const id of ["system.data.execute_delete", "backup.delete_file", "projects.remove", "projects.git.discard", "projects.git.delete_branch", "tools.delete_output_file", "outside_ai.update_settings", "outside_ai.clear_key", "vault.import_from_object", "object_os.object.save", "ghost_os.forget"]) {
    assert.ok(ids.includes(id), `${id} is not marked for the Deck`);
  }
  // Of these modules only "open the screen" is on the Deck (the owner said yes on 5 October 2026); Outside AI has nothing there.
  for (const [prefix, open] of [["skill_constellation.", "skill_constellation.open"], ["reality_rpg.", "reality_rpg.open"], ["ghost_os.", "ghost_os.open"], ["object_os.", "object_os.open"], ["outside_ai.", null]] as const) {
    assert.deepEqual(seededActions.filter((a) => a.id.startsWith(prefix) && a.allowedTriggers.includes("deck")).map((a) => a.id), open ? [open] : [], prefix);
  }
  for (const id of ["standup.open", "skill_constellation.open", "reality_rpg.open", "ghost_os.open", "object_os.open"]) {
    assert.match(seededActions.find((a) => a.id === id)!.handlerRef, /^desktop\.view\./, `${id} only changes the screen`);
  }
  // Projects offers the Deck a few things that open something (an editor, a folder); nothing that changes a repository.
  const projectsOnDeck = seededActions.filter((a) => a.id.startsWith("projects.") && a.allowedTriggers.includes("deck"));
  assert.ok(projectsOnDeck.length > 0);
  for (const action of projectsOnDeck) assert.ok(action.dangerLevel !== "danger" && action.dangerLevel !== "critical", `${action.id} is ${action.dangerLevel}`);
});

test("every button DexNest exports for the Deck still runs", () => {
  const buttons = streamDeckCatalogItems(createStreamDeckActionCatalog([], [{ id: "s1", title: "Snippet" }]));
  const byId = new Map(seededActions.map((a) => [a.id, a]));
  const withAction = buttons.filter((b) => b.actionId && byId.has(b.actionId));
  assert.ok(withAction.length >= 40, `${withAction.length} buttons`);
  for (const button of withAction) assert.ok(byId.get(button.actionId!)!.allowedTriggers.includes("deck"), `${button.title} (${button.actionId})`);
  // The routes the endpoint itself calls by name.
  for (const id of ["deck.routine.run", "drop.send_clipboard_to_drop"]) assert.ok(byId.get(id)!.allowedTriggers.includes("deck"), id);
  // Per-project buttons are built at run time, marked for the Deck where they are made.
  assert.match(read("src/main/main.ts"), /allowedTriggers: \["command", "deck", "module_ui"\] as DexNestActionTrigger\[\],/);
});
