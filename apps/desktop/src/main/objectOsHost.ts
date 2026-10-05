// ObjectOS, hosted in the main process.
//
// Wiring only. The module lives in @dexnest/object-os (domain, store, engine,
// events); this file hands it the shared database, the shared event log, the
// host scheduler and the real file store (objectOsFiles.ts), and exposes
// reads over IPC to the trusted main frame. Everything that changes something
// is a registered object_os.* action run through runRegisteredAction in
// main.ts, so it is journalled like every other action - and only when it
// comes from DexNest's own window: ObjectOS is not reachable from a phone or
// the Stream Deck endpoint in this build.
//
// Files come in only through a file dialog the owner answers (never a path
// in an action's params), are refused inside DexNest's data, and are opened
// only by handing them to the system: executables are shown in their folder.
// Action messages are fixed strings with counts: main.ts journals them, and
// they must never carry the owner's text.
// See docs/modules/object_os/PLAN.md.

import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { EventLog, ModuleScheduler, SqlDatabase } from "@dexnest/foundation";
import {
  EXPORT_JSON_NAME,
  IMPORT_LIMITS,
  OBJECT_ACTION_IDS,
  createObjectOsModule,
  type AuditActionId,
  type ObjectOsModule
} from "@dexnest/object-os";
import { createObjectFileStore, type ObjectFileStore } from "./objectOsFiles.ts";
import { openZip, writeZip, ZipRefused, type ZipSource } from "./objectOsZip.ts";
import { isHeicFile } from "./heic.ts";

/** The parts of Electron's ipcMain this host uses. `ipcMain` satisfies it. */
export interface ObjectIpcMain {
  handle(channel: string, listener: (event: ObjectIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface ObjectIpcEvent {
  sender: unknown;
  senderFrame: unknown;
}

/** The parts of a BrowserWindow this host uses. A BrowserWindow satisfies it. */
export interface ObjectHostWindow {
  isDestroyed(): boolean;
  webContents: { mainFrame: unknown };
}

/** The owner picks files; tests pass stand-ins. */
export interface ObjectDialogs {
  chooseAttachSource(role: string): Promise<string | null>;
  chooseExportPath(defaultName: string): Promise<string | null>;
  chooseImportPath(): Promise<string | null>;
}

/** Handing a stored file to the system. Electron's shell satisfies the shape. */
export interface ObjectShell {
  /** Resolves to an error message, or "" on success (shell.openPath). */
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

export interface ObjectOsHostOptions {
  database: SqlDatabase;
  events: EventLog;
  /** DexNest's resolved data root. Stored files go under files/objects/ here. */
  dataRoot: string;
  /** Every other place DexNest data can live (the real root when a scratch one is live). */
  otherDataRoots: readonly string[];
  scheduler: ModuleScheduler;
  ipcMain: ObjectIpcMain;
  getWindow(): ObjectHostWindow | null;
  dialogs: ObjectDialogs;
  shell: ObjectShell;
  audit(summary: string, metadata: Record<string, unknown>, status: "success" | "failure"): void;
  /** A light notification (counts only). */
  notify(title: string, body: string): void;
  /**
   * Turns a HEIC or HEIF photo into a JPEG data URL the view can show.
   * Without it, such a photo is attached and opened like any file but not
   * shown inline. Given the stored file's path; returns null when it cannot.
   */
  heicPhoto?(path: string): Promise<string | null>;
  /** Tests only: resolve links. Production uses fs.realpathSync.native. */
  realpath?: (path: string) => string;
  now?: () => Date;
}

export interface ObjectOsHost {
  module: ObjectOsModule;
  files: ObjectFileStore;
  channels: readonly string[];
  dialogs: ObjectDialogs;
  shell: ObjectShell;
  dispose(): void;
}

export const OBJECT_CHANNELS = {
  status: "dexnest:object-os-status",
  list: "dexnest:object-os-list",
  detail: "dexnest:object-os-detail",
  timeline: "dexnest:object-os-timeline",
  attention: "dexnest:object-os-attention",
  settingsDiff: "dexnest:object-os-settings-diff",
  locations: "dexnest:object-os-locations",
  find: "dexnest:object-os-find",
  whatIsIn: "dexnest:object-os-what-is-in",
  recentlyLocated: "dexnest:object-os-recently-located",
  rooms: "dexnest:object-os-rooms",
  whereabouts: "dexnest:object-os-whereabouts",
  photo: "dexnest:object-os-photo"
} as const;

/** Images the view may show inline, by extension. No SVG: it is a document, not a picture. */
const INLINE_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};
export const MAX_INLINE_PHOTO_BYTES = 8 * 1024 * 1024;

export function createObjectOsHost(options: ObjectOsHostOptions): ObjectOsHost {
  const files = createObjectFileStore({
    dataRoot: options.dataRoot,
    otherDataRoots: options.otherDataRoots,
    ...(options.realpath ? { realpath: options.realpath } : {})
  });

  // Foundation migrations have already run in local-db's initialize(); ObjectOS runs its own on open.
  const module = createObjectOsModule({
    database: options.database,
    events: options.events,
    scheduler: options.scheduler,
    files,
    audit: (_actionId: AuditActionId, summary, metadata, status) => options.audit(summary, metadata, status),
    notify: (title, body) => options.notify(title, body),
    randomBytes: (n) => randomBytes(n),
    ...(options.now ? { now: options.now } : {})
  });

  const channels: string[] = [];
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => {
    channels.push(channel);
    options.ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("ObjectOS requires the trusted desktop main frame.");
      }
      return listener(...args);
    });
  };

  handle(OBJECT_CHANNELS.status, () => module.status());
  handle(OBJECT_CHANNELS.list, (filter) => module.listObjects(filter));
  handle(OBJECT_CHANNELS.detail, (id) => module.objectDetail(id));
  handle(OBJECT_CHANNELS.timeline, (query) => module.timeline(query));
  handle(OBJECT_CHANNELS.attention, () => module.attentionView());
  handle(OBJECT_CHANNELS.settingsDiff, (query) => module.settingsDiff(query));
  handle(OBJECT_CHANNELS.locations, () => module.locations());
  // Where things are: "where is my…", "what is in…", what was placed lately.
  handle(OBJECT_CHANNELS.find, (query) => module.findObjects(query));
  handle(OBJECT_CHANNELS.whatIsIn, (place) => module.whatIsIn(place));
  handle(OBJECT_CHANNELS.recentlyLocated, () => module.recentlyLocated(8));
  handle(OBJECT_CHANNELS.rooms, () => module.rooms());
  handle(OBJECT_CHANNELS.whereabouts, (id) => module.whereabouts(id));
  // A photo for the view: only a stored image of a known type, still inside its folder, and small enough to inline.
  handle(OBJECT_CHANNELS.photo, (fileId) => photoDataUrl(module, files, fileId, options.heicPhoto));

  module.start();

  return {
    module,
    files,
    channels,
    dialogs: options.dialogs,
    shell: options.shell,
    dispose() {
      module.stop();
      for (const channel of channels) options.ipcMain.removeHandler(channel);
    }
  };
}

async function photoDataUrl(module: ObjectOsModule, files: ObjectFileStore, fileId: unknown, heicPhoto?: (path: string) => Promise<string | null>): Promise<string | null> {
  if (typeof fileId !== "string") return null;
  const file = module.store.getFile(fileId);
  if (!file) return null;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const named = extension === "heic" || extension === "heif";
  const mime = INLINE_IMAGE_TYPES[extension];
  if (!mime && !(named && heicPhoto)) return null;
  const path = files.resolveStored(file.objectId, file.storedName);
  if (!path) return null;
  // A phone photo attached under a .jpg name is still HEIC inside: sent as it is, it would show as a broken picture.
  const heic = named || isHeicFile(path);
  if (statSync(path).size > MAX_INLINE_PHOTO_BYTES) return null;
  // A phone photo is decoded on the way out; the stored file stays as it was attached.
  if (heic && heicPhoto) return heicPhoto(path).catch(() => null);
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

/** What an object_os.* action returns to the action runner. `message` is journalled: fixed text and counts only. */
export interface ObjectActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  cancelled?: boolean;
  [key: string]: unknown;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Object deleted.", "Object deleted with 2 files.", "Object deleted; 1 component kept." - no zero counts. */
export function deletedMessage(files: number, componentsKept: number): string {
  return `Object deleted${files > 0 ? ` with ${plural(files, "file")}` : ""}${componentsKept > 0 ? `; ${plural(componentsKept, "component")} kept` : ""}.`;
}

/**
 * The line main.ts journals for a result. Success messages are fixed text
 * with counts; a refusal's reason can quote what the owner typed (a unit, a
 * file system message with a path), so it goes back to the window only and
 * the journal gets fixed text.
 */
export function objectJournalLine(result: ObjectActionResult): { summary: string; error: string | null } {
  if (result.ok) return { summary: result.message ?? "ObjectOS finished.", error: null };
  if (result.cancelled) return { summary: "Cancelled by the owner.", error: null };
  return { summary: "ObjectOS did not make the change.", error: "Refused; the reason was shown in ObjectOS." };
}

/**
 * Where an action may come from: DexNest's own window (a view, or the command
 * palette), and only where the action's registry entry allows it. The Stream
 * Deck endpoint, the phone and anything else are refused.
 */
export const OBJECT_WINDOW_SOURCES: readonly string[] = ["module_ui", "command"];

export interface ObjectActionOrigin {
  /** The trigger runRegisteredAction was called with. */
  source: string;
  /** The action's registry entry's allowedTriggers. */
  allowedTriggers: readonly string[];
}

/**
 * Runs one of the module's registered actions with the params the renderer
 * sent. Kept here, not in main.ts, so every action has one small, tested
 * mapping from params to the module. Unknown ids return null.
 */
export async function runObjectOsAction(host: ObjectOsHost, actionId: string, params: Record<string, unknown>, origin: ObjectActionOrigin): Promise<ObjectActionResult | null> {
  const known = (Object.values(OBJECT_ACTION_IDS) as string[]).includes(actionId);
  if (!known || actionId === OBJECT_ACTION_IDS.open) return null;
  if (!OBJECT_WINDOW_SOURCES.includes(origin.source) || !origin.allowedTriggers.includes(origin.source)) return { ok: false, error: "ObjectOS can only be changed from DexNest's own window." };

  const { module } = host;
  const input = params.input;
  const parsed = <T>(result: { ok: true; value: T } | { ok: false; errors: string[] }, message: string): ObjectActionResult =>
    result.ok ? { ok: true, message, value: result.value } : { ok: false, error: result.errors.join("; ") };

  switch (actionId) {
    case OBJECT_ACTION_IDS.objectSave:
      return parsed(module.saveObject(input), "Object saved.");
    case OBJECT_ACTION_IDS.objectSetStatus:
      return parsed(module.setStatus(input), "Status changed.");
    case OBJECT_ACTION_IDS.objectMove:
      return parsed(module.moveObject(input), "Object moved.");
    case OBJECT_ACTION_IDS.objectLocate: {
      // With a name and no object: a new thing and where it is. Otherwise a change to where one is.
      const quick = typeof input === "object" && input !== null && !("objectId" in input);
      return quick ? parsed(module.quickAdd(input), "Saved, with where it is.") : parsed(module.locateObject(input), "Where it is has been updated.");
    }
    case OBJECT_ACTION_IDS.objectDelete: {
      const r = module.deleteObject(input);
      if (!r.ok) return { ok: false, error: r.errors.join("; ") };
      return { ok: true, message: deletedMessage(r.value.files.length, r.value.childrenDetached.length), value: r.value };
    }
    case OBJECT_ACTION_IDS.stateSet:
      return parsed(module.setState(input), "State updated.");
    case OBJECT_ACTION_IDS.scheduleSave:
      return parsed(module.saveSchedule(input), "Schedule saved.");
    case OBJECT_ACTION_IDS.maintenanceLog:
      return parsed(module.logMaintenance(input), "Maintenance logged.");
    case OBJECT_ACTION_IDS.modificationSave:
      return parsed(module.saveModification(input), "Modification saved.");
    case OBJECT_ACTION_IDS.settingsSave:
      return parsed(module.saveSettings(input), "Settings saved.");
    case OBJECT_ACTION_IDS.partSave:
      return parsed(module.savePart(input), "Part saved.");
    case OBJECT_ACTION_IDS.partAdjustStock:
      return parsed(module.adjustStock(input), "Stock updated.");
    case OBJECT_ACTION_IDS.measurementAdd:
      return parsed(module.addMeasurement(input), "Measurement recorded.");
    case OBJECT_ACTION_IDS.purchaseSave:
      return parsed(module.savePurchase(input), "Purchase saved.");
    case OBJECT_ACTION_IDS.fileAttach: {
      // The source is always one the owner picks now; a path in params is ignored.
      const objectId = typeof params.objectId === "string" ? params.objectId : "";
      const role = typeof params.role === "string" ? params.role : "other";
      if (!module.store.getObject(objectId)) return { ok: false, error: "That object is not in ObjectOS." };
      const sourcePath = await host.dialogs.chooseAttachSource(role);
      if (!sourcePath) return { ok: false, cancelled: true, error: "Attach cancelled." };
      return parsed(await module.attachFile({ objectId, role, sourcePath }), "File attached.");
    }
    case OBJECT_ACTION_IDS.fileOpen: {
      const r = module.openFile({ fileId: params.fileId });
      if (!r.ok) return { ok: false, error: r.errors.join("; ") };
      if (r.value.action === "show_in_folder") {
        host.shell.showItemInFolder(r.value.path);
        return { ok: true, message: "That file could run a program, so it was shown in its folder instead of opened." };
      }
      const problem = await host.shell.openPath(r.value.path);
      if (problem) return { ok: false, error: "The system could not open that file." };
      return { ok: true, message: "File opened." };
    }
    case OBJECT_ACTION_IDS.fileRemove:
      return parsed(module.removeFile({ fileId: params.fileId }), "File removed.");
    case OBJECT_ACTION_IDS.recordDelete:
      return parsed(module.deleteRecord({ kind: params.kind, id: params.id }), "Record deleted.");
    case OBJECT_ACTION_IDS.remindersEnable:
      module.enableReminders();
      return { ok: true, message: "Daily reminders are on." };
    case OBJECT_ACTION_IDS.remindersDisable:
      module.disableReminders();
      return { ok: true, message: "Daily reminders are off." };
    case OBJECT_ACTION_IDS.export: {
      const objectIds = params.objectIds === undefined ? "all" : params.objectIds;
      const name = `objectos-export-${new Date().toISOString().slice(0, 10)}.zip`;
      const path = await host.dialogs.chooseExportPath(name);
      if (!path) return { ok: false, cancelled: true, error: "Export cancelled." };
      if (host.files.isSensitive(path)) return { ok: false, error: "Choose a place outside DexNest's data for the export." };
      const r = await module.exportObjects({ objectIds }, async (bundle) => {
        const sources: ZipSource[] = [{ name: EXPORT_JSON_NAME, data: Buffer.from(`${JSON.stringify(bundle.data, null, 2)}\n`, "utf8") }];
        for (const f of bundle.files) sources.push({ name: f.zipPath, data: { path: f.sourcePath, sizeBytes: f.file.sizeBytes, sha256: f.file.sha256 } });
        await writeZip(path, sources);
      });
      if (!r.ok) return { ok: false, error: r.errors.join("; ") };
      const missing = r.value.missing ? `; ${plural(r.value.missing, "missing file")} left out` : "";
      return { ok: true, message: `Exported ${plural(r.value.objects, "object")} and ${plural(r.value.files, "file")}${missing}.`, value: r.value };
    }
    case OBJECT_ACTION_IDS.import: {
      const path = await host.dialogs.chooseImportPath();
      if (!path) return { ok: false, cancelled: true, error: "Import cancelled." };
      if (host.files.isSensitive(path)) return { ok: false, error: "ObjectOS does not read files inside DexNest's data." };
      let zip: ReturnType<typeof openZip>;
      try {
        zip = openZip(path, host.files, IMPORT_LIMITS.maxZipBytes);
      } catch (error) {
        if (error instanceof ZipRefused) return { ok: false, error: error.message };
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ok: false, error: "That file does not exist." };
        throw error;
      }
      try {
        const jsonSize = zip.entrySize(EXPORT_JSON_NAME);
        if (jsonSize !== null && jsonSize > IMPORT_LIMITS.maxJsonBytes) return { ok: false, error: `${EXPORT_JSON_NAME} is too large.` };
        const r = await module.importArchive(zip);
        if (!r.ok) return { ok: false, error: r.errors.join("; ") };
        const skipped = r.value.skipped.length;
        return {
          ok: true,
          message: `Imported ${plural(r.value.objects.length, "object")} and ${plural(r.value.files.length, "file")}${skipped ? `; ${skipped} already here, skipped` : ""}.`,
          value: r.value
        };
      } catch (error) {
        if (error instanceof ZipRefused) return { ok: false, error: error.message };
        throw error;
      } finally {
        zip.close();
      }
    }
    default:
      return null;
  }
}
