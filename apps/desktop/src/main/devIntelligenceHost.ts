// Developer Intelligence and Standup, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/dev-intelligence (scan, Standup,
// settings, boundary enforcement) over @dexnest/dev-intelligence-store; this
// file hands it the shared database, the shared event log, DexNest's data
// boundary and the host scheduler, and exposes it over IPC. See
// docs/DEXNEST_FOUNDATION_ARCHITECTURE.md.

import { realpathSync } from "node:fs";
import type { BrowserWindow, IpcMain } from "electron";
import {
  createDataBoundary,
  type EventLog,
  type ModuleScheduler,
  type SqlDatabase
} from "@dexnest/foundation";
import { runDevIntelligenceMigrations } from "@dexnest/dev-intelligence-store";
import {
  createDevIntelligenceModule,
  normalizeDevIntelligenceSettings,
  type DevIntelligenceModule,
  type DevIntelligenceSettings
} from "@dexnest/dev-intelligence";

export interface DevIntelligenceHostOptions {
  database: SqlDatabase;
  events: EventLog;
  /** DexNest's resolved data root. Never scanned, never read. */
  dataRoot: string;
  /**
   * Every other place DexNest data can live. With DEXNEST_DATA_ROOT pointing a
   * test instance at scratch, the real D:\DeskNest\local-data is still the
   * user's data; it stays off limits whichever root is live.
   */
  otherDataRoots: readonly string[];
  scheduler: ModuleScheduler;
  readSettings(): unknown;
  writeSettings(settings: DevIntelligenceSettings): void;
  ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  audit(summary: string, metadata: Record<string, unknown>, status: "success" | "failure"): void;
}

export interface DevIntelligenceHost {
  module: DevIntelligenceModule;
  dispose(): void;
}

export function createDevIntelligenceHost(options: DevIntelligenceHostOptions): DevIntelligenceHost {
  // Foundation migrations have already run in local-db's initialize().
  runDevIntelligenceMigrations(options.database);

  const module = createDevIntelligenceModule({
    database: options.database,
    events: options.events,
    // realpath resolves junctions: a folder that points into local-data is
    // judged by where it points, not by its name.
    boundary: createDataBoundary({
      dataRoot: options.dataRoot,
      extraSensitiveRoots: options.otherDataRoots,
      realpath: realpathSync.native
    }),
    scheduler: options.scheduler,
    settings: {
      read: () => normalizeDevIntelligenceSettings(options.readSettings()),
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
        throw new Error("Developer Intelligence requires the trusted desktop main frame.");
      }
      return listener(...args);
    });
  };

  handle("dexnest:dev-intelligence-status", () => module.status());
  handle("dexnest:dev-intelligence-settings", () => module.getSettings());
  handle("dexnest:dev-intelligence-update-settings", (next) => module.updateSettings(next));
  handle("dexnest:dev-intelligence-scan", () => module.scanNow());
  handle("dexnest:dev-intelligence-repositories", () => module.listRepositories());
  handle("dexnest:standup-generate", (input) =>
    module.generateStandup({ forceNew: Boolean((input as { forceNew?: unknown } | undefined)?.forceNew) })
  );
  handle("dexnest:standup-latest", () => module.latestStandup());
  handle("dexnest:standup-list", (limit) => module.listStandups(typeof limit === "number" ? limit : 20));

  return {
    module,
    dispose() {
      module.stop();
      for (const channel of channels) options.ipcMain.removeHandler(channel);
    }
  };
}
