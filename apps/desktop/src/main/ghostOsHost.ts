// GhostOS, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/ghost-os (domain, store, adapter,
// engine, events); this file hands it the shared database, the shared event
// log, DexNest's data boundary, the host scheduler and - read-only, narrowed
// to the fields GhostOS uses - Developer Intelligence's repository and
// technology stores, and exposes reads over IPC. Everything that changes
// something is a registered ghost_os.* action run through runRegisteredAction
// in main.ts, so it is journalled like every other action.
//
// Files: GhostOS opens no file except the import file the owner picks, and
// writes none except the export file the owner picks. Both are refused inside
// DexNest's data, the import is size-capped before it is read, and a file
// reference (a path the owner types) is checked against the same boundary and
// never opened. Action messages are fixed strings with counts: main.ts
// journals them, and they must never carry the owner's text.
// See docs/modules/ghost_os/PLAN.md.

import { realpathSync } from "node:fs";
import { createDataBoundary, type EventLog, type ModuleScheduler, type SqlDatabase } from "@dexnest/foundation";
import {
  IMPORT_LIMITS,
  createGhostOsModule,
  type AuditActionId,
  type DiReader,
  type GhostOsModule
} from "@dexnest/ghost-os";

/** The parts of Electron's ipcMain this host uses. `ipcMain` satisfies it. */
export interface GhostIpcMain {
  handle(channel: string, listener: (event: GhostIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface GhostIpcEvent {
  sender: unknown;
  senderFrame: unknown;
}

/** The parts of a BrowserWindow this host uses. A BrowserWindow satisfies it. */
export interface GhostHostWindow {
  isDestroyed(): boolean;
  webContents: { mainFrame: unknown };
}

/**
 * Developer Intelligence's stores as main.ts has them. Only these two calls
 * are made, and only the listed fields are passed on to GhostOS.
 */
export interface DiStoresLike {
  repositories: { listRepositories(): Promise<readonly { id: string; roots: readonly { path: string }[]; displayName?: string; discoveredAt: string }[]> };
  technologies: {
    listByRepository(repositoryId: string, options?: { status?: string }): Promise<readonly {
      id: string;
      repositoryId: string;
      category: string;
      name: string;
      evidencePath: string;
      evidenceKind: string;
      status: string;
      firstObservedAt: string;
    }[]>;
  };
}

/** The owner picks files; tests pass stand-ins. */
export interface GhostFileDialogs {
  chooseExportPath(defaultName: string): Promise<string | null>;
  chooseImportPath(): Promise<string | null>;
}

export interface GhostFiles {
  writeText(path: string, text: string): void;
  /** Size in bytes, or null when the file does not exist. */
  size(path: string): number | null;
  readText(path: string): string;
}

export interface GhostOsHostOptions {
  database: SqlDatabase;
  events: EventLog;
  /** DexNest's resolved data root. */
  dataRoot: string;
  /** Every other place DexNest data can live (the real root when a scratch one is live). */
  otherDataRoots: readonly string[];
  scheduler: ModuleScheduler;
  /** Absent when Developer Intelligence is not running: GhostOS then has no source to turn on. */
  developerIntelligence?: DiStoresLike | null;
  ipcMain: GhostIpcMain;
  getWindow(): GhostHostWindow | null;
  dialogs: GhostFileDialogs;
  files: GhostFiles;
  audit(summary: string, metadata: Record<string, unknown>, status: "success" | "failure"): void;
  /** Tests only: resolve links. Production uses fs.realpathSync.native. */
  realpath?: (path: string) => string;
  now?: () => Date;
}

export interface GhostOsHost {
  module: GhostOsModule;
  channels: readonly string[];
  isSensitive(path: string): boolean;
  dialogs: GhostFileDialogs;
  files: GhostFiles;
  dispose(): void;
}

export const GHOST_CHANNELS = {
  status: "dexnest:ghost-os-status",
  timeline: "dexnest:ghost-os-timeline",
  search: "dexnest:ghost-os-search",
  entity: "dexnest:ghost-os-entity",
  settings: "dexnest:ghost-os-settings",
  updateSettings: "dexnest:ghost-os-update-settings"
} as const;

/** Only the fields GhostOS reads leave DI: roots are reduced to their paths. */
function narrowDi(stores: DiStoresLike): DiReader {
  return {
    async listRepositories() {
      return (await stores.repositories.listRepositories()).map((r) => ({
        id: r.id,
        roots: r.roots.map((root) => ({ path: root.path })),
        ...(r.displayName !== undefined ? { displayName: r.displayName } : {}),
        discoveredAt: r.discoveredAt
      }));
    },
    async listTechnologies(repositoryId) {
      return (await stores.technologies.listByRepository(repositoryId, { status: "observed" })).map((t) => ({
        id: t.id,
        repositoryId: t.repositoryId,
        category: t.category,
        name: t.name,
        evidencePath: t.evidencePath,
        evidenceKind: t.evidenceKind,
        status: t.status,
        firstObservedAt: t.firstObservedAt
      }));
    }
  };
}

export function createGhostOsHost(options: GhostOsHostOptions): GhostOsHost {
  // realpath resolves junctions: a folder that points into local-data is judged by where it points.
  const boundary = createDataBoundary({
    dataRoot: options.dataRoot,
    extraSensitiveRoots: options.otherDataRoots,
    realpath: options.realpath ?? realpathSync.native
  });
  const isSensitive = (path: string) => boundary.isSensitive(path);

  // Foundation migrations have already run in local-db's initialize(); GhostOS runs its own on open.
  const module = createGhostOsModule({
    database: options.database,
    events: options.events,
    scheduler: options.scheduler,
    isSensitive,
    ...(options.developerIntelligence ? { developerIntelligence: narrowDi(options.developerIntelligence) } : {}),
    audit: (_actionId: AuditActionId, summary, metadata, status) => options.audit(summary, metadata, status),
    ...(options.now ? { now: options.now } : {})
  });

  const channels: string[] = [];
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("GhostOS requires the trusted desktop main frame.");
      }
      return listener(...args);
    });
  };

  handle(GHOST_CHANNELS.status, () => module.status());
  handle(GHOST_CHANNELS.timeline, (query) => module.timeline(query));
  handle(GHOST_CHANNELS.search, (query) => {
    const raw = typeof query === "object" && query !== null ? (query as { text?: unknown; types?: unknown }) : {};
    return module.search(raw.text, raw.types);
  });
  handle(GHOST_CHANNELS.entity, (id) => module.entityDetail(id));
  handle(GHOST_CHANNELS.settings, () => module.getSettings());
  // Turning sources on and off is not a setting here; it is the ghost_os.adapter.* actions.
  handle(GHOST_CHANNELS.updateSettings, (next) => module.updateSettings(next));

  module.start();

  return {
    module,
    channels,
    isSensitive,
    dialogs: options.dialogs,
    files: options.files,
    dispose() {
      module.stop();
      for (const channel of channels) options.ipcMain.removeHandler(channel);
    }
  };
}

/** What a ghost_os.* action returns to the action runner. `message` is journalled: fixed text and counts only. */
export interface GhostActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  cancelled?: boolean;
  [key: string]: unknown;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Runs one of the module's registered actions with the params the renderer
 * sent. Kept here, not in main.ts, so every action has one small, tested
 * mapping from params to the module. Unknown ids return null.
 */
export async function runGhostOsAction(host: GhostOsHost, actionId: string, params: Record<string, unknown>): Promise<GhostActionResult | null> {
  const { module } = host;
  const parsed = <T>(result: { ok: true; value: T } | { ok: false; errors: string[] }, message: string): GhostActionResult =>
    result.ok ? { ok: true, message, value: result.value } : { ok: false, error: result.errors.join("; ") };

  switch (actionId) {
    case "ghost_os.entity.save":
      return parsed(module.saveEntity(params.entity), "Saved to GhostOS.");
    case "ghost_os.relation.save":
      return parsed(module.saveRelation(params.relation), "Connection saved.");
    case "ghost_os.observation.add":
      return parsed(module.addObservation(params.observation), "Observation recorded.");
    case "ghost_os.decision.record_outcome":
      return parsed(module.recordDecisionOutcome(params.outcome), "Decision outcome recorded.");
    case "ghost_os.forget": {
      const result = module.forget({ kind: params.kind, id: params.id });
      if (!result.ok) return { ok: false, error: result.errors.join("; ") };
      const { removed } = result.value;
      const total = removed.entity + removed.relation + removed.observation;
      return { ok: true, message: `Forgotten, with ${plural(total - 1, "dependent record")}.`, value: result.value };
    }
    case "ghost_os.adapter.enable":
      return parsed(module.enableAdapter(params.adapterId), "Source turned on. GhostOS reads it on its next sync.");
    case "ghost_os.adapter.disable": {
      const result = module.disableAdapter(params.adapterId);
      if (!result.ok) return { ok: false, error: result.errors.join("; ") };
      const { removed } = result.value;
      return { ok: true, message: `Source turned off. Removed ${plural(removed.entity, "entry")}, ${plural(removed.relation, "connection")} and ${plural(removed.observation, "observation")}.`, value: result.value };
    }
    case "ghost_os.adapter.sync": {
      const outcomes = await module.syncNow();
      if (outcomes.length === 0) return { ok: true, message: "No source is turned on, so nothing was read." };
      const failed = outcomes.filter((o) => o.status === "failed");
      if (failed.length) return { ok: false, error: "A GhostOS source could not be read. See GhostOS status." };
      const added = outcomes.reduce((n, o) => n + o.added.entity + o.added.relation + o.added.observation, 0);
      const updated = outcomes.reduce((n, o) => n + o.updated.entity + o.updated.relation + o.updated.observation, 0);
      return { ok: true, message: `Synced: ${added} new, ${updated} updated.` };
    }
    case "ghost_os.export": {
      const path = await host.dialogs.chooseExportPath(`ghostos-export-${new Date().toISOString().slice(0, 10)}.json`);
      if (!path) return { ok: false, cancelled: true, error: "Export cancelled." };
      if (host.isSensitive(path)) return { ok: false, error: "Choose a place outside DexNest's data for the export." };
      const data = module.exportData((d) => host.files.writeText(path, `${JSON.stringify(d, null, 2)}\n`));
      return { ok: true, message: `Exported ${plural(data.entities.length, "entry")}, ${plural(data.relations.length, "connection")} and ${plural(data.observations.length, "observation")}.` };
    }
    case "ghost_os.import": {
      const path = await host.dialogs.chooseImportPath();
      if (!path) return { ok: false, cancelled: true, error: "Import cancelled." };
      if (host.isSensitive(path)) return { ok: false, error: "GhostOS does not read files inside DexNest's data." };
      const size = host.files.size(path);
      if (size === null) return { ok: false, error: "That file does not exist." };
      if (size > IMPORT_LIMITS.maxBytes) return { ok: false, error: `That file is larger than ${Math.round(IMPORT_LIMITS.maxBytes / 1024 / 1024)} MB.` };
      let json: unknown;
      try {
        json = JSON.parse(host.files.readText(path));
      } catch {
        return { ok: false, error: "That file is not JSON." };
      }
      const result = module.importData(json);
      if (!result.ok) return { ok: false, error: result.errors.join("; ") };
      const { added, skippedExisting, skippedForgotten } = result.value;
      const skipped = skippedExisting.entity + skippedExisting.relation + skippedExisting.observation;
      const forgotten = skippedForgotten.entity + skippedForgotten.relation + skippedForgotten.observation;
      return {
        ok: true,
        message: `Imported ${plural(added.entity, "entry")}, ${plural(added.relation, "connection")} and ${plural(added.observation, "observation")}; ${skipped} already here, ${forgotten} forgotten.`,
        value: result.value
      };
    }
    default:
      return null;
  }
}
