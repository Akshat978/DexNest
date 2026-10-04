/**
 * Reality RPG's main-process host.
 *
 * Real SQLite (node:sqlite) in a temp directory with the foundation's event log,
 * synthetic events only, and stand-ins for ipcMain and the window that behave
 * like Electron's where the host relies on them: handlers get an event with
 * `sender` and `senderFrame`, and only the main window's main frame is trusted.
 */

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createEventLog, createHostScheduler, runFoundationMigrations, type SchedulerTimers } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";
import { seededActions } from "@dexnest/action-registry";
import {
  createRealityRpgHost,
  runRealityRpgAction,
  RPG_CHANNELS,
  type RpgIpcEvent,
  type RpgIpcMain
} from "../src/main/realityRpgHost.ts";

type Listener = (event: RpgIpcEvent, ...args: unknown[]) => unknown;

function fakeIpc(): RpgIpcMain & { handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>();
  return {
    handlers,
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
      handlers.set(channel, listener);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    }
  };
}

function heldTimers(): SchedulerTimers & { count(): number } {
  let next = 0;
  const live = new Set<number>();
  return {
    set: () => { const id = ++next; live.add(id); return id; },
    clear: (id) => { live.delete(id as number); },
    count: () => live.size
  };
}

const mainFrame = { name: "main frame" };
const webContents = { mainFrame };
const window = { destroyed: false, isDestroyed() { return this.destroyed; }, webContents };
const trusted: RpgIpcEvent = { sender: webContents, senderFrame: mainFrame };

let handle: TestDatabase | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
  window.destroyed = false;
});

function setup() {
  handle = createTestDatabase("rpg-host-");
  const database = handle.db;
  runFoundationMigrations(database);
  const events = createEventLog(database);
  const ipc = fakeIpc();
  const timers = heldTimers();
  const audit: string[] = [];
  let settings: unknown = {};
  const host = createRealityRpgHost({
    database,
    events,
    scheduler: createHostScheduler({ timers }),
    readSettings: () => settings,
    writeSettings: (next) => { settings = next; },
    ipcMain: ipc,
    getWindow: () => window,
    audit: (summary) => { audit.push(summary); }
  });
  const call = (channel: string, event: RpgIpcEvent = trusted, ...args: unknown[]) => {
    const listener = ipc.handlers.get(channel);
    assert.ok(listener, `no handler for ${channel}`);
    return listener(event, ...args);
  };
  /** A row as local-db's appendActionEvent writes it. */
  const legacy = (module: string, actionId: string, at: string) =>
    database.prepare("INSERT INTO event_log (id, type, source, payload_json, created_at) VALUES (?, 'action_executed', 'command', ?, ?)").run([
      `legacy-${Math.random()}`, JSON.stringify({ module, actionId, status: "success", summary: "synthetic" }), at
    ]);
  return { host, ipc, timers, audit, call, legacy };
}

test("registers every channel, and dispose removes them all", () => {
  const { host, ipc } = setup();
  assert.deepEqual([...ipc.handlers.keys()].sort(), Object.values(RPG_CHANNELS).sort());
  host.dispose();
  assert.equal(ipc.handlers.size, 0);
});

test("refuses anything but the trusted main frame", () => {
  const { host, call } = setup();
  const refused = /trusted desktop main frame/;
  assert.throws(() => call(RPG_CHANNELS.snapshot, { sender: { other: true }, senderFrame: mainFrame }), refused);
  assert.throws(() => call(RPG_CHANNELS.snapshot, { sender: webContents, senderFrame: { name: "iframe" } }), refused);
  assert.throws(() => call(RPG_CHANNELS.updateSettings, { sender: webContents, senderFrame: null }, { intervalMinutes: 5 }), refused);
  window.destroyed = true;
  assert.throws(() => call(RPG_CHANNELS.status), refused);
  window.destroyed = false;
  assert.equal((call(RPG_CHANNELS.status) as { enabled: boolean }).enabled, false);
  host.dispose();
});

test("is off by default: no timer, nothing processed", () => {
  const { host, timers, call } = setup();
  assert.equal(timers.count(), 0);
  const snapshot = call(RPG_CHANNELS.snapshot) as { enabled: boolean; sheet: { totalXp: number }; lastRun: unknown };
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.sheet.totalXp, 0);
  assert.equal(snapshot.lastRun, null);
  host.dispose();
});

test("settings over IPC are normalised and audited, and cannot switch it on", () => {
  const { host, timers, call, audit } = setup();
  const saved = call(RPG_CHANNELS.updateSettings, trusted, { enabled: true, intervalMinutes: 1 }) as { enabled: boolean; intervalMinutes: number };
  assert.equal(saved.enabled, false);
  assert.equal(saved.intervalMinutes, 5);
  assert.equal(timers.count(), 0);
  assert.deepEqual(audit, ["Reality RPG settings saved"]);
  host.dispose();
});

test("history takes only a well-formed page request, and caps its size", async () => {
  const { host, call, legacy } = setup();
  for (const bad of ["x", 42, [], { beforeSeq: -1 }, { beforeSeq: 1.5 }, { limit: 0 }, { limit: "10" }]) {
    assert.throws(() => call(RPG_CHANNELS.history, trusted, bad), /Reality RPG:/, JSON.stringify(bad));
  }
  assert.deepEqual(call(RPG_CHANNELS.history), []);
  // A ledger bigger than one page: a huge limit still returns at most 200.
  await runRealityRpgAction(host.module, "reality_rpg.rule.save", {
    rule: { id: "copies", name: "Copies", enabled: true, match: { types: ["action_executed"], actionIds: ["clipboard.copy"] }, award: { xp: 1, stat: "Order" } }
  });
  const later = new Date(Date.now() + 1000).toISOString();
  for (let i = 0; i < 250; i++) legacy("clipboard", "clipboard.copy", later);
  await runRealityRpgAction(host.module, "reality_rpg.refresh", {});
  assert.equal((call(RPG_CHANNELS.history, trusted, { limit: 100000 }) as unknown[]).length, 200);
  assert.equal((call(RPG_CHANNELS.history) as unknown[]).length, 50);
  host.dispose();
});

test("every registered reality_rpg action but open is handled, and they work end to end", async () => {
  const { host, legacy, timers } = setup();
  const m = host.module;
  const ours = seededActions.filter((a) => a.moduleId === "reality_rpg").map((a) => a.id).filter((id) => id !== "reality_rpg.open");
  assert.equal(ours.length, 11);

  const rule = { id: "copies", name: "Clipboard copies", enabled: true, match: { types: ["action_executed"], actionIds: ["clipboard.copy"] }, award: { xp: 10, stat: "Order" } };
  assert.deepEqual(await runRealityRpgAction(m, "reality_rpg.rule.save", { rule }), { ok: true, message: "Rule saved: Clipboard copies.", value: m.store.getRule("copies") });
  legacy("clipboard", "clipboard.copy", new Date(Date.now() + 1000).toISOString());
  legacy("vault", "vault.secure.copy_secret", new Date(Date.now() + 1000).toISOString());
  const refreshed = await runRealityRpgAction(m, "reality_rpg.refresh", {});
  assert.deepEqual(refreshed, { ok: true, message: "+10 XP from 1 thing you did.", status: "completed" });

  const bad = await runRealityRpgAction(m, "reality_rpg.rule.save", { rule: { ...rule, id: "bad", match: { types: ["action_executed"], module: "finance" } } });
  assert.deepEqual(bad, { ok: false, error: "rules may not name vault, finance or journal activity" });

  const results = new Map<string, unknown>();
  const params: Record<string, Record<string, unknown>> = {
    "reality_rpg.rule.set_enabled": { ruleId: "copies", enabled: false },
    "reality_rpg.quest.create": { quest: { id: "tidy", title: "Tidy up", condition: { kind: "xp", target: 50 } } },
    "reality_rpg.quest.abandon": { questId: "tidy" },
    "reality_rpg.achievement.save": { achievement: { id: "ten", name: "Ten", description: "Earn 10 XP", condition: { kind: "xp", target: 10 } } },
    "reality_rpg.achievement.delete": { achievementId: "ten" },
    "reality_rpg.backfill": { ruleId: "copies" },
    "reality_rpg.rule.delete": { ruleId: "copies" }
  };
  for (const id of ["reality_rpg.enable", "reality_rpg.disable", ...Object.keys(params)]) {
    const result = await runRealityRpgAction(m, id, params[id] ?? {});
    assert.ok(result, `${id} is not handled`);
    results.set(id, result);
  }
  for (const id of ours) assert.ok(results.has(id) || id === "reality_rpg.refresh" || id === "reality_rpg.rule.save", `${id} was not exercised`);
  // Backfill needs the rule on; it was switched off above, so it is refused with a reason.
  assert.deepEqual(results.get("reality_rpg.backfill"), { ok: false, error: "switch the rule on before applying it to past activity" });
  assert.equal((results.get("reality_rpg.rule.delete") as { ok: boolean }).ok, true);
  assert.equal(await runRealityRpgAction(m, "reality_rpg.unknown", {}), null);
  // enable then disable leaves no timer behind.
  assert.equal(timers.count(), 0);
  assert.equal(m.store.totals().totalXp, 10);
  host.dispose();
});

test("preload exposes every channel, and main.ts starts, routes and disposes the host", () => {
  const preload = readFileSync(new URL("../src/main/preload.ts", import.meta.url), "utf8");
  for (const channel of Object.values(RPG_CHANNELS)) assert.ok(preload.includes(`"${channel}"`), `preload is missing ${channel}`);
  const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.ok(main.includes('"reality_rpg.open": { view: "rpg"'), "reality_rpg.open opens the rpg view");
  assert.ok(main.includes('actionId.startsWith("reality_rpg.")') && main.includes("runRealityRpgAction(realityRpgHost.module, actionId, params)"));
  assert.ok(main.includes("startRealityRpgHost();") && main.includes("realityRpgHost?.dispose();"));
});

test("the host can be disposed and created again on the same connection without leaking handlers", () => {
  const { host, ipc, call } = setup();
  host.module.enable();
  host.dispose();
  assert.equal(ipc.handlers.size, 0);
  const again = createRealityRpgHost({
    database: handle!.db,
    events: createEventLog(handle!.db),
    scheduler: createHostScheduler({ timers: heldTimers() }),
    readSettings: () => ({ enabled: true }),
    writeSettings: () => undefined,
    ipcMain: ipc,
    getWindow: () => window,
    audit: () => undefined
  });
  assert.equal(ipc.handlers.size, Object.keys(RPG_CHANNELS).length);
  assert.equal((call(RPG_CHANNELS.status) as { enabled: boolean }).enabled, true);
  again.dispose();
});
