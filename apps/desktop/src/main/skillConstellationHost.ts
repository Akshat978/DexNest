// Skill Constellation, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/skill-constellation (engine, store,
// events, settings, scheduling); this file hands it the shared database, the
// shared event log, DexNest's data boundary, the host scheduler and Developer
// Intelligence's persistence (read-only), and exposes reads over IPC. Actions
// that change something - rebuild, turn on, turn off - go through the action
// registry in main.ts so they are journalled like every other action.
// See docs/modules/skill_constellation/PLAN.md.

import { realpathSync } from "node:fs";
import {
  createDataBoundary,
  type EventLog,
  type ModuleScheduler,
  type SqlDatabase
} from "@dexnest/foundation";
import {
  createSkillConstellationModule,
  normalizeSkillConstellationSettings,
  runSkillConstellationMigrations,
  type DevIntelligenceReader,
  type SkillConstellationModule,
  type SkillConstellationSettings
} from "@dexnest/skill-constellation";

/** The parts of Electron's ipcMain this host uses. `ipcMain` satisfies it. */
export interface SkillIpcMain {
  handle(channel: string, listener: (event: SkillIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface SkillIpcEvent {
  sender: unknown;
  senderFrame: unknown;
}

/** The parts of a BrowserWindow this host uses. A BrowserWindow satisfies it. */
export interface SkillHostWindow {
  isDestroyed(): boolean;
  webContents: { mainFrame: unknown };
}

export interface SkillConstellationHostOptions {
  database: SqlDatabase;
  events: EventLog;
  /** DexNest's resolved data root. Never recorded as evidence. */
  dataRoot: string;
  /** Every other place DexNest data can live (the real root when a scratch one is live). */
  otherDataRoots: readonly string[];
  scheduler: ModuleScheduler;
  /** Developer Intelligence's stores. Read, never written. */
  reader: DevIntelligenceReader;
  readSettings(): unknown;
  writeSettings(settings: SkillConstellationSettings): void;
  ipcMain: SkillIpcMain;
  getWindow(): SkillHostWindow | null;
  audit(summary: string, metadata: Record<string, unknown>, status: "success" | "failure"): void;
  /** Tests only: resolve links. Production uses fs.realpathSync.native. */
  realpath?: (path: string) => string;
}

export interface SkillConstellationHost {
  module: SkillConstellationModule;
  channels: readonly string[];
  dispose(): void;
}

export const SKILL_CHANNELS = {
  status: "dexnest:skill-constellation-status",
  snapshot: "dexnest:skill-constellation-snapshot",
  evidence: "dexnest:skill-constellation-evidence",
  history: "dexnest:skill-constellation-history",
  settings: "dexnest:skill-constellation-settings",
  updateSettings: "dexnest:skill-constellation-update-settings"
} as const;

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

function skillIdArgument(value: unknown): string {
  if (typeof value !== "string" || !SKILL_ID.test(value)) {
    throw new Error("Skill Constellation: that is not a skill id.");
  }
  return value;
}

export function createSkillConstellationHost(options: SkillConstellationHostOptions): SkillConstellationHost {
  // Foundation migrations have already run in local-db's initialize().
  runSkillConstellationMigrations(options.database);

  const module = createSkillConstellationModule({
    database: options.database,
    events: options.events,
    // realpath resolves junctions: a repository reached through a link into
    // local-data is judged by where it points.
    boundary: createDataBoundary({
      dataRoot: options.dataRoot,
      extraSensitiveRoots: options.otherDataRoots,
      realpath: options.realpath ?? realpathSync.native
    }),
    scheduler: options.scheduler,
    settings: {
      read: () => normalizeSkillConstellationSettings(options.readSettings()),
      write: (settings) => options.writeSettings(settings)
    },
    reader: options.reader,
    audit: options.audit
  });

  const channels: string[] = [];
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("Skill Constellation requires the trusted desktop main frame.");
      }
      return listener(...args);
    });
  };

  handle(SKILL_CHANNELS.status, () => module.status());
  handle(SKILL_CHANNELS.snapshot, () => module.constellation());
  handle(SKILL_CHANNELS.evidence, (skillId) => module.describeEvidence(skillIdArgument(skillId), { limit: 200 }));
  handle(SKILL_CHANNELS.history, (skillId) => module.strengthHistory(skillIdArgument(skillId)));
  handle(SKILL_CHANNELS.settings, () => module.getSettings());
  // On/off is not a setting here: it goes through the skill_constellation.enable
  // and .disable actions, so it is journalled like every other action.
  handle(SKILL_CHANNELS.updateSettings, (next) => {
    const incoming = next !== null && typeof next === "object" ? next : {};
    const saved = module.updateSettings({ ...incoming, enabled: module.getSettings().enabled });
    // Counts only: the emails themselves stay out of the audit log.
    options.audit("Skill Constellation settings saved", {
      myEmails: saved.myEmails.length,
      hiddenSkills: saved.hiddenSkills.length,
      includeUnmappedLibraries: saved.includeUnmappedLibraries,
      rebuildIntervalMinutes: saved.rebuildIntervalMinutes
    }, "success");
    return saved;
  });

  module.start();

  return {
    module,
    channels,
    dispose() {
      module.stop();
      for (const channel of channels) options.ipcMain.removeHandler(channel);
    }
  };
}
