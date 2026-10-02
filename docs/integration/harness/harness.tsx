// Integration harness: the real DexNest renderer in a plain browser.
// Copied from docs/ui-audit/harness and extended for every sidebar view.
//
// Not part of the app. Used only for the states a healthy Electron app can't
// be put into on demand (loading, error); everything else is captured from the
// real app under xvfb (see docs/integration/README.md).
//
//   ?v=<any view id>                          the view to open
//   &s=normal|empty|loading|error|large       the scenario
//
// loading: every bridge read never resolves. error: every bridge read rejects
// with "database is locked". The four modules' own fixtures (below) are kept
// for normal/empty/large. No real data: everything below is made up.
//
// No real data: everything below is made up.

import { fallbackBridge } from "../../../apps/desktop/src/renderer/lib/bridge";

const params = new URLSearchParams(location.search);
const view = params.get("v") ?? "command";
const scenario = params.get("s") ?? "normal";

const T = "2026-06-01T09:00:00.000Z";
const day = (n: number) => new Date(Date.parse("2026-06-30T12:00:00.000Z") - n * 86_400_000).toISOString();
const never = <T,>(): Promise<T> => new Promise<T>(() => {});
const fail = <T,>(): Promise<T> => Promise.reject(new Error("database is locked"));
const ok = <T,>(value: T) => ({ ok: true as const, value });
type AnyFn = (...args: never[]) => Promise<unknown>;

// --- ObjectOS -------------------------------------------------------------------

const objectNames = [
  ["Workshop printer", "printer", "Prusa", "MK4", "Workshop"], ["Hotend", "other", "E3D", "Revo", "Workshop"], ["Desktop PC", "computer", "Custom", "Ryzen 7 build", "Office"],
  ["Laptop", "computer", "Lenovo", "ThinkPad X1", "Office"], ["Dishwasher", "appliance", "Bosch", "SMS6", "Kitchen"], ["Cordless drill", "tool", "Makita", "DHP485", "Garage"],
  ["Car", "vehicle", "Skoda", "Octavia", "Street"], ["Bike", "vehicle", "Canyon", "Grail", "Garage"], ["Router", "computer", "AVM", "FRITZ!Box 7590", "Hallway"],
  ["Washing machine", "appliance", "Miele", "W1", "Bathroom"], ["Soldering station", "tool", "Pinecil", "V2", "Workshop"], ["NAS", "computer", "Synology", "DS220+", "Office"]
] as const;
const ids = ["7K3F9QXM", "9QXM7K3F", "A1B2C3D4", "B2C3D4E5", "C3D4E5F6", "D4E5F6G7", "E5F6G7H8", "F6G7H8J9", "G7H8J9K0", "H8J9K0M1", "J9K0M1N2", "K0M1N2P3"];
const object = (i: number, over: Record<string, unknown> = {}) => {
  const [name, category, make, model, location] = objectNames[i % objectNames.length] as readonly string[];
  return {
    id: ids[i % ids.length] ?? "7K3F9QXM", name, category, make, model, serial: `SN-${1000 + i}`, location, status: i === 7 ? "lent_out" : i === 9 ? "broken" : "active",
    notes: "", tags: [], parentId: i === 1 ? ids[0] : null, photoFileId: null, createdAt: T, updatedAt: T, ...over
  };
};
const objects = objectNames.map((_, i) => object(i));
const attention = {
  summary: {
    items: [
      { kind: "maintenance", objectId: ids[0], scheduleId: "sch_nozzle001", status: { state: "overdue", kind: "usage", measurementKey: "print hours", dueAtReading: 400, latestReading: 412, left: -12, lastDoneAt: T } },
      { kind: "warranty", objectId: ids[3], state: "ending", daysLeft: 12 },
      { kind: "maintenance", objectId: ids[6], scheduleId: "sch_service01", status: { state: "due_soon", kind: "time", dueAt: day(-9), daysLeft: 9, lastDoneAt: day(356) } },
      { kind: "stock", partId: "prt_nozzle001", quantity: 1, lowStockAt: 2 }
    ],
    counts: { overdue: 1, dueSoon: 1, warrantyEnding: 1, lowStock: 1 }
  },
  names: { [ids[0] as string]: "Workshop printer", [ids[3] as string]: "Laptop", [ids[6] as string]: "Car", sch_nozzle001: "Replace nozzle", sch_service01: "Annual service", prt_nozzle001: "0.4 mm nozzle" }
};
const schedule = { id: "sch_nozzle001", objectId: ids[0], title: "Replace nozzle", rule: { kind: "usage", measurementKey: "print hours", every: 200 }, startsAt: T, startReading: null, active: true, notes: "", createdAt: T, updatedAt: T };
const objectDetail = (large: boolean) => ({
  object: { ...object(0), tags: ["3d", "work"], notes: "Keep the enclosure closed when printing ABS." },
  parent: null,
  components: [object(1)],
  state: [{ objectId: ids[0], key: "firmware", value: "6.1.2", updatedAt: T }, { objectId: ids[0], key: "filament", value: "PETG, black", updatedAt: day(2) }],
  schedules: [
    { schedule, status: { state: "overdue", kind: "usage", measurementKey: "print hours", dueAtReading: 400, latestReading: 412, left: -12, lastDoneAt: T } },
    { schedule: { ...schedule, id: "sch_belt0001", title: "Check belt tension", rule: { kind: "time", every: 3, unit: "months" } }, status: { state: "ok", kind: "time", dueAt: day(-60), daysLeft: 60, lastDoneAt: day(30) } }
  ],
  maintenance: Array.from({ length: large ? 60 : 3 }, (_, i) => ({ id: `mnt_log${String(i).padStart(6, "0")}`, objectId: ids[0], scheduleId: schedule.id, title: i % 2 ? "Cleaned the bed" : "Replaced nozzle", doneAt: day(20 * i + 5), doneBy: "me", cost: i % 3 ? null : { amount: 1250, currency: "EUR" }, notes: "", usageReading: 200 * i, parts: i % 2 ? [] : [{ partId: "prt_nozzle001", quantity: 1 }], createdAt: T })),
  modifications: [{ id: "mod_enclos001", objectId: ids[0], title: "Added an enclosure", doneAt: day(90), reason: "ABS warps in a draught.", before: "open frame", after: "enclosed", reversible: true, revertedAt: null, createdAt: T, updatedAt: T }],
  settings: [
    { id: "set_slicer001", objectId: ids[0], name: "Slicer profile", version: 1, values: { layer_height: "0.2", infill: "15%", nozzle_temp: "215" }, note: "", createdAt: day(60) },
    { id: "set_slicer002", objectId: ids[0], name: "Slicer profile", version: 2, values: { layer_height: "0.15", infill: "15%", nozzle_temp: "220", ironing: "on" }, note: "finer layers", createdAt: day(10) }
  ],
  parts: [{ id: "prt_nozzle001", name: "0.4 mm nozzle", partNumber: "E3D-V6-04", supplier: "E3D", unit: "pcs", quantity: 1, lowStockAt: 2, notes: "", fits: [ids[0]], createdAt: T, updatedAt: T }],
  measurements: Array.from({ length: large ? 200 : 4 }, (_, i) => ({ id: `msr_hours${String(i).padStart(6, "0")}`, objectId: ids[0], key: i % 4 === 3 ? "bed temperature" : "print hours", value: i % 4 === 3 ? 60 : 300 + i * 3, unit: i % 4 === 3 ? "°C" : "h", measuredAt: day(i * 2), note: "", createdAt: T })),
  purchase: { objectId: ids[0], purchasedOn: "2025-06-12", price: { amount: 109900, currency: "EUR" }, shop: "Prusa shop", warrantyUntil: "2026-07-12", receiptFileId: "fil_receip01", updatedAt: T },
  warranty: { state: "ending", daysLeft: 12 },
  files: [
    { id: "fil_manual01", objectId: ids[0], role: "manual", name: "MK4 handbook.pdf", storedName: "fil_manual01-MK4 handbook.pdf", sizeBytes: 8_400_000, type: "pdf", sha256: "a".repeat(64), addedAt: day(300) },
    { id: "fil_receip01", objectId: ids[0], role: "receipt", name: "receipt.pdf", storedName: "fil_receip01-receipt.pdf", sizeBytes: 120_000, type: "pdf", sha256: "b".repeat(64), addedAt: day(300) },
    { id: "fil_setup001", objectId: ids[0], role: "other", name: "firmware-updater.exe", storedName: "fil_setup001-firmware-updater.exe", sizeBytes: 3_200_000, type: "executable", sha256: "c".repeat(64), addedAt: day(40) }
  ]
});
const largeObjects = Array.from({ length: 500 }, (_, i) => object(i, { id: `A${String(i).padStart(7, "0").replace(/[ILOU]/g, "X")}`, name: `${objectNames[i % objectNames.length]?.[0]} ${Math.floor(i / objectNames.length) + 1} - a fairly long descriptive name for wrapping` }));
const largeAttention = {
  summary: {
    items: Array.from({ length: 60 }, (_, i) => ({ kind: "maintenance", objectId: largeObjects[i]?.id, scheduleId: `sch_big${String(i).padStart(6, "0")}`, status: { state: i % 3 ? "due_soon" : "overdue", kind: "time", dueAt: day(-i), daysLeft: i % 3 ? i % 14 : -i, lastDoneAt: null } })),
    counts: { overdue: 20, dueSoon: 40, warrantyEnding: 0, lowStock: 0 }
  },
  names: Object.fromEntries(largeObjects.slice(0, 60).flatMap((o, i) => [[o.id, o.name], [`sch_big${String(i).padStart(6, "0")}`, "Quarterly inspection and cleaning"]]))
};

function objectBridge(): Record<string, AnyFn> {
  if (scenario === "loading") return { objectOsStatus: never, objectOsList: never, objectOsAttention: never, objectOsLocations: never };
  if (scenario === "error") return { objectOsStatus: fail, objectOsList: fail, objectOsAttention: fail, objectOsLocations: fail };
  if (scenario === "empty") return {};
  const large = scenario === "large";
  const list = large ? largeObjects : objects;
  return {
    objectOsStatus: async () => ({ remindersEnabled: large, lastReminder: large ? { id: "r", occurrenceId: "o", kind: "reminders", trigger: "scheduled", status: "completed", startedAt: day(0), finishedAt: day(0), summary: {}, error: null } : null, lastError: null, objects: large ? 5000 : list.length }),
    objectOsList: async () => ok(list),
    objectOsAttention: async () => (large ? largeAttention : attention),
    objectOsLocations: async () => ["Bathroom", "Garage", "Hallway", "Kitchen", "Office", "Street", "Workshop"],
    objectOsDetail: async () => ok(objectDetail(large)),
    objectOsTimeline: async () => ok(Array.from({ length: large ? 50 : 6 }, (_, i) => ({ kind: ["maintenance", "measurement", "state", "file", "settings", "created"][i % 6], refId: `r${i}`, at: day(i * 3), title: ["Replaced nozzle", "print hours", "firmware", "MK4 handbook.pdf", "Slicer profile v2", "Added"][i % 6], detail: ["me", "412 h", "6.1.2", "Manual", "4 values", ""][i % 6] }))),
    objectOsSettingsDiff: async () => ok({ added: [{ key: "ironing", value: "on" }], removed: [], changed: [{ key: "layer_height", from: "0.2", to: "0.15" }], unchanged: 1 }),
    objectOsPhoto: async () => null
  };
}

// --- GhostOS ---------------------------------------------------------------------

const zero = { entity: 0, relation: 0, observation: 0 };
const di = (enabled: boolean) => ({ id: "developer_intelligence", enabled, cursor: null, lastSyncAt: enabled ? day(0) : null, counts: enabled ? { entity: 14, relation: 22, observation: 96 } : zero, installed: true });
const ghostStatus = (counts: typeof zero, enabled: boolean) => ({ adapters: [di(enabled)], syncing: false, lastRun: null, lastError: null, searchMode: "fts", counts });
const manual = { origin: "manual", sourceId: null, sourceRef: null, evidence: [{ kind: "manual" }], confidence: 1 };
const fromDi = (ref: string, evidence: unknown[], confidence: number) => ({ origin: "adapter", sourceId: "adapter:developer_intelligence", sourceRef: ref, evidence, confidence });
const project = { id: "ent_proj0001", type: "project", title: "Zephyr app", notes: "The habit tracker.", tags: ["work"], details: {}, occurredAt: null, startedAt: null, endedAt: null, provenance: fromDi("repo:r1", [{ kind: "repository", repositoryId: "repo-app" }], 1), createdAt: T, updatedAt: T };
const ghostDetail = {
  entity: project,
  relations: [
    { relation: { id: "rel_uses0001", fromId: project.id, toId: "ent_skill001", type: "uses", strength: 1, validFrom: T, validTo: null, notes: "", provenance: fromDi("uses:r1:ts", [{ kind: "technology", factId: "f1", repositoryId: "repo-app", evidencePath: "package.json", evidenceKind: "package.json" }], 0.9), createdAt: T, updatedAt: T }, direction: "out", other: { id: "ent_skill001", type: "skill", title: "TypeScript" } },
    { relation: { id: "rel_mine0001", fromId: "ent_me000001", toId: project.id, type: "worked_on", strength: 1, validFrom: null, validTo: "2026-05-01T00:00:00.000Z", notes: "", provenance: manual, createdAt: T, updatedAt: T }, direction: "in", other: { id: "ent_me000001", type: "person", title: "Me" } }
  ],
  observations: [
    { id: "obs_day00001", entityId: project.id, statement: "2 commits observed", observedAt: T, provenance: fromDi("day:r1:2026-06-01", [{ kind: "commit", repositoryId: "repo-app", sha: "abcdef1234", at: T }, { kind: "commit", repositoryId: "repo-app", sha: "1234567abc", at: T }], 0.6), createdAt: T },
    { id: "obs_note0001", entityId: project.id, statement: "shipped v1", observedAt: T, provenance: manual, createdAt: T }
  ],
  derivedFrom: []
};
const ghostItems = (n: number) => Array.from({ length: n }, (_, i) => [
  { kind: "observation", id: `obs_day${String(i).padStart(5, "0")}`, at: day(i), entityId: project.id, entityType: "project", title: "Zephyr app", statement: `${(i % 5) + 1} commits observed`, origin: "adapter", confidence: 0.6 },
  { kind: "entity", id: `ent_person${i}`, at: day(i), entityId: `ent_person${i}`, entityType: "person", title: ["Ana", "Ben", "Chloe", "Dev"][i % 4], statement: null, origin: "manual", confidence: 1 },
  { kind: "relation", id: `rel_ended${i}`, at: day(i + 1), entityId: project.id, entityType: "project", title: "Zephyr app", statement: "uses Go", origin: "adapter", confidence: 0.9 }
][i % 3]);

function ghostBridge(): Record<string, AnyFn> {
  if (scenario === "loading") return { ghostOsStatus: never, ghostOsTimeline: never };
  if (scenario === "error") return { ghostOsStatus: fail, ghostOsTimeline: fail };
  if (scenario === "empty") return { ghostOsStatus: async () => ghostStatus(zero, false), ghostOsTimeline: async () => ok([]) };
  const large = scenario === "large";
  return {
    ghostOsStatus: async () => ghostStatus(large ? { entity: 4200, relation: 9100, observation: 51000 } : { entity: 14, relation: 22, observation: 96 }, true),
    ghostOsTimeline: async () => ok(ghostItems(large ? 50 : 8)),
    ghostOsEntity: async () => ok(ghostDetail),
    ghostOsSearch: async () => ok([{ id: project.id, type: "project", title: "Zephyr app", timelineAt: T }]),
    ghostOsSettings: async () => ({ schemaVersion: 1, adapters: { developer_intelligence: { enabled: true } }, syncIntervalMinutes: 60 })
  };
}

// --- Reality RPG ------------------------------------------------------------------

const rule = { id: "commits", version: 2, name: "Commit observed", enabled: true, match: { types: ["dev.commit.observed"], stream: "dev" }, award: { xp: 5, stat: "Craft" }, dailyCap: 20, effectiveFrom: "2026-06-01T00:00:00.000Z" };
const rpgBase = {
  enabled: true,
  sheet: { totalXp: 1450, level: 6, xpIntoLevel: 150, xpToNextLevel: 400, stats: [{ stat: "Craft", xp: 820 }, { stat: "Focus", xp: 410 }, { stat: "Order", xp: 220 }] },
  rules: [rule, { ...rule, id: "standup", name: "Standup generated", enabled: false, match: { types: ["action_executed"], actionIds: ["standup.generate"] }, award: { xp: 3, stat: "Focus" } }],
  achievements: [
    { achievement: { id: "first", name: "First steps", description: "Earn your first XP.", condition: { kind: "xp", target: 1 } }, unlocked: { achievementId: "first", unlockedAt: day(20), tippingAwardId: "aw" }, progress: { current: 1450, target: 1, met: true } },
    { achievement: { id: "week", name: "Committed week", description: "Commits on 7 days.", condition: { kind: "days", ruleIds: ["commits"], target: 7 } }, unlocked: null, progress: { current: 3, target: 7, met: false } }
  ],
  quests: [{ quest: { id: "daily", title: "Commit today", condition: { kind: "count", ruleIds: ["commits"], target: 2 }, window: { kind: "daily" }, status: "active", createdAt: T }, progress: { current: 1, target: 2, met: false, periodKey: "2026-06-30", open: true }, completions: 4 }],
  recentAwards: Array.from({ length: 6 }, (_, i) => ({ id: `aw${i}`, ruleId: "commits", ruleVersion: 2, eventId: `e${i}`, eventSeq: 100 - i, eventType: "dev.commit.observed", actionId: null, occurredAt: day(i), localDay: day(i).slice(0, 10), xp: 5, stat: "Craft", awardedAt: day(i), runId: "r", ruleName: "Commit observed" })),
  lastRun: { id: "r", occurrenceId: "o", trigger: "scheduled", status: "completed", startedAt: day(0), finishedAt: day(0), fromSeq: 0, toSeq: 9, awards: 1, xp: 5, error: null },
  invalid: { rules: [], achievements: [], quests: [] },
  starter: { rules: [{ ...rule, id: "backup-completed", name: "Backup completed", enabled: false }], achievements: [] }
};
const rpgLarge = {
  ...rpgBase,
  sheet: { totalXp: 48210, level: 42, xpIntoLevel: 1210, xpToNextLevel: 4300, stats: ["Craft", "Focus", "Order", "Vitality", "Lore", "Care", "Grit", "Wit"].map((stat, i) => ({ stat, xp: 9000 - i * 900 })) },
  rules: Array.from({ length: 40 }, (_, i) => ({ ...rule, id: `rule${i}`, name: `Rule number ${i + 1} with a longer descriptive name`, enabled: i % 3 !== 0 })),
  achievements: Array.from({ length: 30 }, (_, i) => ({ achievement: { id: `a${i}`, name: `Achievement ${i + 1}`, description: "Do the thing many times over a long stretch.", condition: { kind: "xp", target: 1000 * (i + 1) } }, unlocked: i < 12 ? { achievementId: `a${i}`, unlockedAt: day(i), tippingAwardId: "x" } : null, progress: { current: Math.min(48210, 1000 * (i + 1)), target: 1000 * (i + 1), met: i < 12 } })),
  quests: Array.from({ length: 20 }, (_, i) => ({ quest: { id: `q${i}`, title: `Quest ${i + 1}: keep the streak going`, condition: { kind: "count", ruleIds: ["rule1"], target: 5 }, window: { kind: i % 2 ? "weekly" : "daily" }, status: "active", createdAt: T }, progress: { current: i % 5, target: 5, met: false, periodKey: "2026-06-30", open: true }, completions: i })),
  recentAwards: Array.from({ length: 50 }, (_, i) => ({ ...rpgBase.recentAwards[0], id: `awl${i}`, eventSeq: 5000 - i, occurredAt: day(i / 4), awardedAt: day(i / 4) }))
};
const rpgOff = { ...rpgBase, enabled: false, sheet: { totalXp: 0, level: 1, xpIntoLevel: 0, xpToNextLevel: 100, stats: [] }, rules: [], achievements: [], quests: [], recentAwards: [], lastRun: null };

function rpgBridge(): Record<string, AnyFn> {
  if (scenario === "loading") return { realityRpgSnapshot: never, realityRpgStatus: never };
  if (scenario === "error") return { realityRpgSnapshot: fail, realityRpgStatus: fail };
  const snap = scenario === "empty" ? rpgOff : scenario === "large" ? rpgLarge : rpgBase;
  return {
    realityRpgSnapshot: async () => snap,
    realityRpgStatus: async () => ({ enabled: snap.enabled, processing: false, lastRun: snap.lastRun, lastError: null }),
    realityRpgHistory: async () => snap.recentAwards,
    realityRpgSettings: async () => ({ schemaVersion: 1, enabled: snap.enabled, intervalMinutes: 15 })
  };
}

// --- Skill Constellation --------------------------------------------------------------

const skillNames = ["TypeScript", "React", "Go", "SQL", "Docker", "Rust", "Python", "CSS", "Vite", "Node.js", "PostgreSQL", "Electron", "Tailwind", "GraphQL", "Kubernetes", "Bash"];
const skill = (i: number, n: number) => ({
  id: `s${i}`, name: n > skillNames.length ? `${skillNames[i % skillNames.length]} ${Math.floor(i / skillNames.length) || ""}`.trim() : skillNames[i], category: ["language", "framework", "tool", "platform"][i % 4],
  evidenceCount: 30 - (i % 30), repositoryCount: 1 + (i % 6), evidenceKinds: 1 + (i % 4), firstEvidenceAt: day(400 - i), lastEvidenceAt: day(i * 3), lastActivityAt: null,
  strength: { volume: 0.2, recency: 0.8 - (i % 8) / 10, variety: 0.4, score: Math.max(0.05, 0.9 - (i % 18) / 20) }, hidden: i === 5
});
const constellation = (n: number) => {
  const skills = Array.from({ length: n }, (_, i) => skill(i, n));
  return {
    enabled: true,
    skills,
    links: skills.slice(1).map((s, i) => ({ a: skills[i % Math.max(1, Math.floor(n / 3))]?.id ?? "s0", b: s.id, source: "evidence", sharedRepositoryIds: ["r1"], weight: 0.3 + (i % 5) / 10 })),
    layout: skills.map((s, i) => ({ skillId: s.id, x: 120 + ((i * 197) % 760), y: 100 + ((i * 131) % 560) })),
    lastBuild: { id: "b1", occurrenceId: "o", trigger: "manual", status: "completed", startedAt: day(0), finishedAt: day(0), devCursorSeq: 3, settingsFingerprint: "f", skills: n, evidence: n * 12, links: n - 1, added: 2, lost: 0, refusedPrivate: 0, othersCommits: 0, error: null },
    staleness: { hasBuild: true, devChanged: false, settingsChanged: false, stale: false, devCursorSeq: 3, latestDevSeq: 3 },
    countsAllCommits: true
  };
};
const skillsOff = { enabled: false, skills: [], links: [], layout: [], lastBuild: null, staleness: { hasBuild: false, devChanged: false, settingsChanged: false, stale: true, devCursorSeq: 0, latestDevSeq: 0 }, countsAllCommits: true };

function skillsBridge(): Record<string, AnyFn> {
  if (scenario === "loading") return { skillConstellationSnapshot: never };
  if (scenario === "error") return { skillConstellationSnapshot: fail };
  if (scenario === "empty") return { skillConstellationSnapshot: async () => skillsOff };
  return {
    skillConstellationSnapshot: async () => constellation(scenario === "large" ? 80 : 12),
    skillConstellationEvidence: async () => [
      { id: "e1", skillId: "s0", kind: "technology.extension", repositoryId: "r1", repositoryName: "zephyr-app", path: "src/main.ts", at: day(2), sourceRef: "tech_1", detail: "file-extension", todoText: null },
      { id: "e2", skillId: "s0", kind: "todo.open", repositoryId: "r1", repositoryName: "zephyr-app", path: "src/router.ts", at: day(30), sourceRef: "todo_1", detail: "TODO line 7", todoText: "TODO: tidy the router" },
      { id: "e3", skillId: "s0", kind: "commit", repositoryId: "r2", repositoryName: "zephyr-api", path: null, at: day(60), sourceRef: "abcdef1234567890", detail: null, todoText: null }
    ],
    skillConstellationHistory: async () => Array.from({ length: 6 }, (_, i) => ({ buildId: `b${i}`, skillId: "s0", at: day(i * 30), evidenceCount: 30 - i * 4, volume: 0.2, recency: 0.8, variety: 0.4, score: 0.9 - i * 0.1 }))
  };
}

// --- mount ------------------------------------------------------------------------------------

const overrides: Record<string, AnyFn> =
  view === "object" ? objectBridge() : view === "ghost" ? ghostBridge() : view === "rpg" ? rpgBridge() : view === "skills" ? skillsBridge() : {};

// Every read the shell or a view makes. The shell starts normally; the shoot
// script then sets window.__harnessMode to "loading" or "error" and opens the
// view, so only reads made from then on hang or fail (the view's own load).
const isRead = (name: string) => !/^on[A-Z]/.test(name) && !/^(runAction|logUiEvent|voiceOverlay|projectsPathForFile)$/.test(name);
const base: Record<string, unknown> = { ...fallbackBridge, ...overrides };
// Projects reads through its own bridge, found on window.dexNest by projectsList.
const projectsReads = ["projectsList", "projectsGet", "projectsSettings", "projectsGroups", "projectsRepoState", "projectsRepoStates", "projectsHistory", "projectsDiffStat", "projectsOperations", "projectsLeftOff", "projectsSuggestions", "projectsLegacyChanged"];
const harness = window as unknown as { __harnessMode?: string };
for (const name of [...new Set([...Object.keys(base), ...projectsReads])]) {
  if (!isRead(name)) continue;
  const original = base[name];
  base[name] = (...args: unknown[]) => {
    if (harness.__harnessMode === "loading") return never();
    if (harness.__harnessMode === "error") return fail();
    return typeof original === "function" ? (original as (...a: unknown[]) => unknown)(...args) : Promise.resolve(undefined);
  };
}
base.onProjectsOutput = () => () => undefined;
(window as unknown as { dexNest: unknown }).dexNest = base;
try {
  sessionStorage.setItem("dexnest:lastActiveView", view);
} catch {
  // the view falls back to Command
}
void import("../../../apps/desktop/src/renderer/main.tsx");
