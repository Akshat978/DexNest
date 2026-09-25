/**
 * Skill Constellation's main-process host.
 *
 * Real SQLite (node:sqlite) in a temp directory, Developer Intelligence's real
 * stores seeded with synthetic facts, and stand-ins for ipcMain and the window
 * that behave like Electron's where the host depends on them: a handler gets an
 * event with `sender` and `senderFrame`, and only the main window's main frame
 * is trusted.
 */

import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEventLog, createHostScheduler, runFoundationMigrations, type SchedulerTimers } from "@dexnest/foundation";
import { createTestDatabase, type TestDatabase } from "@dexnest/foundation/testing";
import { seededActions } from "@dexnest/action-registry";
import type { Repository, TechnologyFact, TodoMarker } from "@dexnest/dev-intelligence-contracts";
import type { DevIntelligenceReader } from "@dexnest/skill-constellation";
import {
  createSkillConstellationHost,
  SKILL_CHANNELS,
  type SkillIpcEvent,
  type SkillIpcMain
} from "../src/main/skillConstellationHost.ts";

type Listener = (event: SkillIpcEvent, ...args: unknown[]) => unknown;

function fakeIpc(): SkillIpcMain & { handlers: Map<string, Listener> } {
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

/**
 * Developer Intelligence's stores, in memory. The host only reads through this
 * interface; DI's real stores are exercised against it in the package's tests.
 */
function memoryReader() {
  const repositories: Repository[] = [];
  const technologies: TechnologyFact[] = [];
  const todos: TodoMarker[] = [];
  const reader: DevIntelligenceReader = {
    repositories: { listRepositories: async () => [...repositories] },
    technologies: { listByRepository: async (id) => technologies.filter((t) => t.repositoryId === id) },
    todos: {
      listByRepository: async (id) => todos.filter((t) => t.repositoryId === id),
      get: async (id) => todos.find((t) => t.id === id)
    }
  };
  return { reader, repositories, technologies, todos };
}

const mainFrame = { name: "main frame" };
const webContents = { mainFrame };
const window = { destroyed: false, isDestroyed() { return this.destroyed; }, webContents };
const trusted: SkillIpcEvent = { sender: webContents, senderFrame: mainFrame };

let handle: TestDatabase | undefined;
afterEach(() => {
  handle?.dispose();
  handle = undefined;
  window.destroyed = false;
});

async function setup(options: { dataRoot?: string; otherDataRoots?: string[] } = {}) {
  handle = createTestDatabase("skill-host-");
  const database = handle.db;
  runFoundationMigrations(database);
  const events = createEventLog(database);
  const memory = memoryReader();
  const reader = memory.reader;
  const ipc = fakeIpc();
  const timers = heldTimers();
  const audit: string[] = [];
  let settings: unknown = {};
  const dir = handle.path.replace(/[\\/][^\\/]+$/, "");
  const host = createSkillConstellationHost({
    database,
    events,
    dataRoot: options.dataRoot ?? join(dir, "data-root"),
    otherDataRoots: options.otherDataRoots ?? [],
    scheduler: createHostScheduler({ timers }),
    reader,
    readSettings: () => settings,
    writeSettings: (next) => { settings = next; },
    ipcMain: ipc,
    getWindow: () => window,
    audit: (summary) => { audit.push(summary); },
    realpath: (path) => path
  });
  const call = (channel: string, event: SkillIpcEvent = trusted, ...args: unknown[]) => {
    const listener = ipc.handlers.get(channel);
    assert.ok(listener, `no handler for ${channel}`);
    return listener(event, ...args);
  };
  return { host, ipc, timers, audit, memory, dir, call, settings: () => settings };
}

test("registers every channel, and dispose removes them all", async () => {
  const { host, ipc } = await setup();
  assert.deepEqual([...ipc.handlers.keys()].sort(), Object.values(SKILL_CHANNELS).sort());
  host.dispose();
  assert.equal(ipc.handlers.size, 0);
});

test("refuses anything but the trusted main frame", async () => {
  const { host, call } = await setup();
  const refused = /trusted desktop main frame/;
  assert.throws(() => call(SKILL_CHANNELS.status, { sender: { other: true }, senderFrame: mainFrame }), refused);
  assert.throws(() => call(SKILL_CHANNELS.status, { sender: webContents, senderFrame: { name: "iframe" } }), refused);
  assert.throws(() => call(SKILL_CHANNELS.updateSettings, { sender: webContents, senderFrame: null }, { myEmails: ["x@y.z"] }), refused);
  window.destroyed = true;
  assert.throws(() => call(SKILL_CHANNELS.status), refused);
  window.destroyed = false;
  const status = call(SKILL_CHANNELS.status) as { enabled: boolean };
  assert.equal(status.enabled, false);
  host.dispose();
});

test("is off by default: no timer, no build", async () => {
  const { host, timers, call } = await setup();
  assert.equal(timers.count(), 0);
  const snapshot = call(SKILL_CHANNELS.snapshot) as { enabled: boolean; skills: unknown[]; lastBuild: unknown };
  assert.equal(snapshot.enabled, false);
  assert.deepEqual(snapshot.skills, []);
  assert.equal(snapshot.lastBuild, null);
  host.dispose();
});

test("turning on schedules exactly one timer; turning off clears it", async () => {
  const { host, timers } = await setup();
  host.module.enable();
  assert.equal(timers.count(), 1);
  host.module.disable();
  assert.equal(timers.count(), 0);
  host.dispose();
});

test("settings over IPC are normalised, audited without the emails, and cannot switch it on", async () => {
  const { host, timers, call, audit } = await setup();
  const saved = await call(SKILL_CHANNELS.updateSettings, trusted, { enabled: true, myEmails: ["Me@Example.com", "junk"] }) as { enabled: boolean; myEmails: string[] };
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.myEmails, ["me@example.com"]);
  assert.equal(timers.count(), 0);
  assert.deepEqual(audit, ["Skill Constellation settings saved"]);
  host.dispose();
});

test("evidence and history take only a skill id", async () => {
  const { host, call } = await setup();
  for (const bad of [undefined, 42, "", "../etc", "React", "a".repeat(81), { id: "react" }]) {
    assert.throws(() => call(SKILL_CHANNELS.evidence, trusted, bad), /not a skill id/);
    assert.throws(() => call(SKILL_CHANNELS.history, trusted, bad), /not a skill id/);
  }
  assert.deepEqual(await call(SKILL_CHANNELS.evidence, trusted, "react"), []);
  host.dispose();
});

test("the other data roots are off limits too, not just the live one", async () => {
  handle = undefined;
  const probe = createTestDatabase("skill-host-probe-");
  const realRoot = join(probe.path.replace(/[\\/][^\\/]+$/, ""), "real-user-data");
  probe.dispose();
  const { host, memory } = await setup({ otherDataRoots: [realRoot] });
  memory.repositories.push({
    schemaVersion: 1, id: "r-real", roots: [{ path: join(realRoot, "files", "repo"), domain: "windows" }],
    displayName: "hidden", discoveredAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z"
  });
  memory.technologies.push({
    schemaVersion: 1, id: "t1", repositoryId: "r-real", category: "language", name: "Go", evidencePath: "main.go",
    evidenceKind: "file-extension", fingerprint: "f1", status: "observed", firstObservedAt: "2026-01-01T00:00:00.000Z",
    lastObservedAt: "2026-01-01T00:00:00.000Z", observedAt: "2026-01-01T00:00:00.000Z"
  });
  const outcome = await host.module.rebuildNow();
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.build.skills, 0);
  assert.equal(outcome.build.refusedPrivate, 1);
  host.dispose();
});

test("preload exposes every channel, and main handles every registered action", () => {
  const preload = readFileSync(new URL("../src/main/preload.ts", import.meta.url), "utf8");
  for (const channel of Object.values(SKILL_CHANNELS)) assert.ok(preload.includes(`"${channel}"`), `preload is missing ${channel}`);
  const main = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  const ours = seededActions.filter((a) => a.moduleId === "skill_constellation");
  assert.equal(ours.length, 4);
  for (const action of ours) assert.ok(main.includes(`"${action.id}"`), `main.ts does not handle ${action.id}`);
  assert.ok(main.includes("startSkillConstellationHost();") && main.includes("skillConstellationHost?.dispose();"));
});
