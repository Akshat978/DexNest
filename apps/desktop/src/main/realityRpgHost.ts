// Reality RPG, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/reality-rpg (rules, engine, ledger,
// events, scheduling); this file hands it the shared database, the shared event
// log, the host scheduler and a settings file, and exposes reads over IPC.
// Everything that changes something - refresh, on/off, rules, quests,
// achievements, backfill - is a registered reality_rpg.* action run through
// runRegisteredAction in main.ts, so it is journalled like every other action.
//
// Reality RPG reads no files and no module's tables: only event_log rows of the
// types its enabled rules name. So unlike Developer Intelligence it needs no
// data boundary; its privacy rules (no vault, finance or journal; content never
// kept) live in the package. See docs/modules/reality_rpg/PLAN.md.

import type { EventLog, ModuleScheduler, SqlDatabase } from "@dexnest/foundation";
import {
  createRealityRpgModule,
  normalizeRealityRpgSettings,
  runRealityRpgMigrations,
  type RealityRpgModule,
  type RealityRpgSettings
} from "@dexnest/reality-rpg";

/** The parts of Electron's ipcMain this host uses. `ipcMain` satisfies it. */
export interface RpgIpcMain {
  handle(channel: string, listener: (event: RpgIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface RpgIpcEvent {
  sender: unknown;
  senderFrame: unknown;
}

/** The parts of a BrowserWindow this host uses. A BrowserWindow satisfies it. */
export interface RpgHostWindow {
  isDestroyed(): boolean;
  webContents: { mainFrame: unknown };
}

export interface RealityRpgHostOptions {
  database: SqlDatabase;
  events: EventLog;
  scheduler: ModuleScheduler;
  readSettings(): unknown;
  writeSettings(settings: RealityRpgSettings): void;
  ipcMain: RpgIpcMain;
  getWindow(): RpgHostWindow | null;
  audit(summary: string, metadata: Record<string, unknown>, status: "success" | "failure"): void;
}

export interface RealityRpgHost {
  module: RealityRpgModule;
  channels: readonly string[];
  dispose(): void;
}

export const RPG_CHANNELS = {
  status: "dexnest:reality-rpg-status",
  snapshot: "dexnest:reality-rpg-snapshot",
  history: "dexnest:reality-rpg-history",
  settings: "dexnest:reality-rpg-settings",
  updateSettings: "dexnest:reality-rpg-update-settings"
} as const;

const MAX_HISTORY_PAGE = 200;

function historyArgument(value: unknown): { beforeSeq?: number; limit: number } {
  if (value === undefined || value === null) return { limit: 50 };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Reality RPG: history takes { beforeSeq?, limit? }.");
  const raw = value as { beforeSeq?: unknown; limit?: unknown };
  const out: { beforeSeq?: number; limit: number } = { limit: 50 };
  if (raw.beforeSeq !== undefined) {
    if (typeof raw.beforeSeq !== "number" || !Number.isInteger(raw.beforeSeq) || raw.beforeSeq < 0) throw new Error("Reality RPG: beforeSeq must be a whole number.");
    out.beforeSeq = raw.beforeSeq;
  }
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isInteger(raw.limit) || raw.limit < 1) throw new Error("Reality RPG: limit must be a positive whole number.");
    out.limit = Math.min(raw.limit, MAX_HISTORY_PAGE);
  }
  return out;
}

export function createRealityRpgHost(options: RealityRpgHostOptions): RealityRpgHost {
  // Foundation migrations have already run in local-db's initialize().
  runRealityRpgMigrations(options.database);

  const module = createRealityRpgModule({
    database: options.database,
    events: options.events,
    scheduler: options.scheduler,
    settings: {
      read: () => normalizeRealityRpgSettings(options.readSettings()),
      write: (settings) => options.writeSettings(settings)
    },
    audit: options.audit
  });

  const channels: string[] = [];
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("Reality RPG requires the trusted desktop main frame.");
      }
      return listener(...args);
    });
  };

  handle(RPG_CHANNELS.status, () => module.status());
  handle(RPG_CHANNELS.snapshot, () => module.snapshot());
  handle(RPG_CHANNELS.history, (query) => {
    const { beforeSeq, limit } = historyArgument(query);
    return module.store.listAwards({ limit, ...(beforeSeq !== undefined ? { beforeSeq } : {}) });
  });
  handle(RPG_CHANNELS.settings, () => module.getSettings());
  // On/off is not a setting here (updateSettings keeps it); it is the
  // reality_rpg.enable / .disable actions, journalled like every other action.
  handle(RPG_CHANNELS.updateSettings, (next) => {
    const saved = module.updateSettings(next);
    options.audit("Reality RPG settings saved", { intervalMinutes: saved.intervalMinutes }, "success");
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

/** What a reality_rpg.* action returns to the action runner. */
export interface RpgActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Runs one of the module's registered actions with the params the renderer
 * sent. Kept here, not in main.ts, so every action has one small, tested
 * mapping from params to the module. Unknown ids return null.
 */
export async function runRealityRpgAction(module: RealityRpgModule, actionId: string, params: Record<string, unknown>): Promise<RpgActionResult | null> {
  const parsed = <T>(result: { ok: true; value: T } | { ok: false; errors: string[] }, message: (value: T) => string): RpgActionResult =>
    result.ok ? { ok: true, message: message(result.value), value: result.value } : { ok: false, error: result.errors.join("; ") };

  switch (actionId) {
    case "reality_rpg.refresh": {
      const outcome = await module.refresh();
      const message = outcome.status === "completed"
        ? `+${outcome.run.xp} XP from ${outcome.committed.inserted.length} event(s).`
        : outcome.status === "skipped" && outcome.reason === "no_rules"
          ? "No rule is switched on, so nothing was read."
          : "Nothing new since the last refresh.";
      return { ok: true, message, status: outcome.status };
    }
    case "reality_rpg.enable":
      module.enable();
      return { ok: true, message: "Reality RPG is on. New activity is processed every few minutes." };
    case "reality_rpg.disable":
      module.disable();
      return { ok: true, message: "Reality RPG is off. Your character, awards and quests are kept." };
    case "reality_rpg.rule.save":
      return parsed(module.saveRule(params.rule), (rule) => `Rule saved: ${rule.name}.`);
    case "reality_rpg.rule.set_enabled":
      return parsed(module.setRuleEnabled(params.ruleId, params.enabled), (rule) => `${rule.name} is ${rule.enabled ? "on" : "off"}.`);
    case "reality_rpg.rule.delete":
      return parsed(module.deleteRule(params.ruleId), () => "Rule deleted. XP it awarded is kept.");
    case "reality_rpg.quest.create":
      return parsed(module.createQuest(params.quest), (quest) => `Quest created: ${quest.title}.`);
    case "reality_rpg.quest.abandon":
      return parsed(module.abandonQuest(params.questId), (quest) => `Quest abandoned: ${quest.title}.`);
    case "reality_rpg.achievement.save":
      return parsed(module.saveAchievement(params.achievement), (a) => `Achievement saved: ${a.name}.`);
    case "reality_rpg.achievement.delete":
      return parsed(module.deleteAchievement(params.achievementId), () => "Achievement deleted. An unlock already earned is kept.");
    case "reality_rpg.backfill": {
      const result = await module.backfill(params.ruleId);
      if (!result.ok) return { ok: false, error: result.errors.join("; ") };
      const outcome = result.value;
      return { ok: true, message: outcome.status === "completed" ? `Applied to past activity: +${outcome.run.xp} XP.` : "Applied to past activity: nothing new." };
    }
    default:
      return null;
  }
}
