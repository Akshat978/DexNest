/**
 * The ObjectOS engine: what happens with files, reminders, and export or
 * import, on top of the store and the host's file port.
 *
 * Attaching a file:
 *   inspect (no read) -> refuse inside the data root, not a file, empty, too
 *   large -> copy in (streamed, hashed, size-capped, temp name + rename) ->
 *   record. A failure after the copy removes the copy: no file without a
 *   row, no row without a file.
 *
 * Opening one: only if the stored file still resolves inside its object's
 * folder; executables are shown in their folder, never run.
 *
 * Reminders: claimed per occurrence, so one slot delivered twice runs once.
 *
 * Import: one at a time. The JSON is validated, every file entry the rows
 * name is checked against the zip, the files are copied (verified) first,
 * then the rows are written in one transaction; if that fails the copied
 * files are removed.
 *
 * Crashes: every copy and every delete of bytes is preceded by a pending
 * marker in the database and followed by its removal (in the same
 * transaction as the rows where there are rows). recoverPending(), run at
 * start, removes what a marker names and no row claims.
 */

import type { AttentionSummary } from '../domain/attention.ts';
import { reminderText } from '../domain/events.ts';
import { EXPORT_JSON_NAME, IMPORT_LIMITS, parseExport, zipPathOf, type ObjectExport } from '../domain/export.ts';
import { ATTACH_REFUSAL_TEXT, attachRefusal, fileTypeOf, isExecutableName, MAX_FILE_BYTES, sanitizeFileName, storedFileName } from '../domain/files.ts';
import { isRecordId, newRecordId, objectIdFromBytes, OBJECT_ID_LENGTH } from '../domain/ids.ts';
import type { FileRecord, FileRole } from '../domain/types.ts';
import type { Parsed } from '../domain/validation.ts';
import type { ImportArchive, ObjectFilePort } from '../files/port.ts';
import type { DeletedObject, ImportPlan, ObjectStore, PendingFile, RunTrigger } from '../store/store.ts';

const fail = <T>(...errors: string[]): Parsed<T> => ({ ok: false, errors });

export interface ObjectEngineOptions {
  store: ObjectStore;
  files: ObjectFilePort;
  /** A unique token for record ids (the runtime passes a UUID). */
  newToken: () => string;
  /** Random bytes for object ids. */
  randomBytes: (n: number) => ArrayLike<number>;
}

export type OpenDecision = { action: 'open' | 'show_in_folder'; path: string; file: FileRecord };

export interface ReminderOutcome {
  status: 'completed' | 'skipped';
  reason: string | null;
  occurrenceId: string;
  counts: AttentionSummary['counts'] | null;
  /** Counts only; null when there is nothing to say. */
  text: string | null;
}

export interface ExportBundle {
  data: ObjectExport;
  /** Each file to put in the zip: where it is now, and where it goes. */
  files: { file: FileRecord; sourcePath: string; zipPath: string }[];
  /** Files whose bytes are missing or no longer inside their folder: left out, and reported. */
  missing: FileRecord[];
}

export interface ObjectEngine {
  /** A new, unused object id. */
  newObjectId(): string;
  attachFile(input: { objectId: string; sourcePath: string; role: FileRole; now: string }, alsoInTransaction?: (record: FileRecord) => void): Promise<Parsed<FileRecord>>;
  decideOpen(fileId: string): Parsed<OpenDecision>;
  removeFile(fileId: string, alsoInTransaction?: (removed: FileRecord) => void): Parsed<FileRecord>;
  /** After a crash: removes bytes that a pending marker names and no row claims. */
  recoverPending(): { removed: number; kept: number; failed: number };
  deleteObject(objectId: string, now: string, alsoInTransaction?: (out: DeletedObject) => void): Parsed<DeletedObject>;
  runReminders(input: { occurrenceId: string; trigger: RunTrigger; now: string; today?: string }): ReminderOutcome;
  exportBundle(objectIds: readonly string[] | 'all', now: string): Parsed<ExportBundle>;
  importArchive(archive: ImportArchive, alsoInTransaction?: (plan: ImportPlan) => void): Promise<Parsed<ImportPlan>>;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

export function createObjectEngine(options: ObjectEngineOptions): ObjectEngine {
  const { store, files } = options;

  function newObjectId(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = objectIdFromBytes(options.randomBytes(OBJECT_ID_LENGTH));
      if (!store.objectIdExists(id)) return id;
    }
    throw new Error('could not find an unused object id');
  }

  async function attachFile(input: { objectId: string; sourcePath: string; role: FileRole; now: string }, alsoInTransaction?: (record: FileRecord) => void): Promise<Parsed<FileRecord>> {
    if (!store.getObject(input.objectId)) return fail(`object ${input.objectId} does not exist`);
    const info = files.inspect(input.sourcePath);
    if (!info) return fail('That file does not exist.');
    const refusal = attachRefusal(info);
    if (refusal) return fail(ATTACH_REFUSAL_TEXT[refusal]);

    const name = sanitizeFileName(baseName(input.sourcePath));
    const id = newRecordId('file', options.newToken());
    const storedName = storedFileName(id, name);
    const pending = [{ objectId: input.objectId, storedName }];
    // Written down first: if DexNest stops mid-copy, start() removes the bytes no row claims.
    store.markPending(pending);
    const giveUp = (error: unknown): never => {
      // No file without a row.
      files.remove(input.objectId, storedName);
      settle(pending);
      throw error;
    };
    let copied: { sizeBytes: number; sha256: string };
    try {
      copied = await files.copyIn(input.sourcePath, input.objectId, storedName, MAX_FILE_BYTES);
    } catch (error) {
      return giveUp(error);
    }
    const record: FileRecord = { id, objectId: input.objectId, role: input.role, name, storedName, sizeBytes: copied.sizeBytes, type: fileTypeOf(name), sha256: copied.sha256, addedAt: input.now };
    try {
      store.transaction(() => {
        store.addFile(record);
        const object = store.getObject(input.objectId);
        if (input.role === 'photo' && object && !object.photoFileId) store.setPhoto(input.objectId, id, input.now);
        if (input.role === 'receipt' && !store.purchaseOf(input.objectId)?.receiptFileId) store.setReceipt(input.objectId, id, input.now);
        alsoInTransaction?.(record);
        store.clearPending(pending);
      });
    } catch (error) {
      return giveUp(error);
    }
    return { ok: true, value: record };
  }

  function decideOpen(fileId: string): Parsed<OpenDecision> {
    if (!isRecordId('file', fileId)) return fail('file id is invalid');
    const file = store.getFile(fileId);
    if (!file) return fail('That file is not in ObjectOS.');
    const path = files.resolveStored(file.objectId, file.storedName);
    if (!path) return fail("That file is missing, or is no longer inside ObjectOS's folder, so it was not opened.");
    // Never run anything: an executable is shown in its folder instead.
    return { ok: true, value: { action: isExecutableName(file.name) || isExecutableName(file.storedName) ? 'show_in_folder' : 'open', path, file } };
  }

  function removeFile(fileId: string, alsoInTransaction?: (removed: FileRecord) => void): Parsed<FileRecord> {
    if (!isRecordId('file', fileId)) return fail('file id is invalid');
    const removed = store.transaction(() => {
      const r = store.removeFile(fileId);
      if (r) {
        store.markPending([{ objectId: r.objectId, storedName: r.storedName }]);
        alsoInTransaction?.(r);
      }
      return r;
    });
    if (!removed) return fail('That file is not in ObjectOS.');
    // The row is gone; now the bytes. If this fails or DexNest stops here, start() finishes it.
    files.remove(removed.objectId, removed.storedName);
    settle([{ objectId: removed.objectId, storedName: removed.storedName }]);
    return { ok: true, value: removed };
  }

  function deleteObject(objectId: string, now: string, alsoInTransaction?: (out: DeletedObject) => void): Parsed<DeletedObject> {
    if (!store.getObject(objectId)) return fail(`object ${objectId} does not exist`);
    const folder = [{ objectId, storedName: null }];
    const out = store.transaction(() => {
      const deleted = store.deleteObject(objectId, now);
      store.markPending(folder);
      alsoInTransaction?.(deleted);
      return deleted;
    });
    // The rows are gone; now the bytes. If this fails or DexNest stops here, start() finishes it.
    files.removeFolder(objectId);
    settle(folder);
    return { ok: true, value: out };
  }

  /** Clears pending markers; a failure here only means start() looks again. */
  function settle(entries: readonly PendingFile[]): void {
    try {
      store.clearPending(entries);
    } catch {
      // Left pending: recoverPending() removes whatever no row claims.
    }
  }

  function recoverPending(): { removed: number; kept: number; failed: number } {
    const out = { removed: 0, kept: 0, failed: 0 };
    for (const p of store.pendingFiles()) {
      try {
        if (p.storedName === null) {
          if (store.objectIdExists(p.objectId)) out.kept += 1;
          else {
            files.removeFolder(p.objectId);
            out.removed += 1;
          }
        } else if (store.storedFileExists(p.objectId, p.storedName)) out.kept += 1;
        else {
          files.remove(p.objectId, p.storedName);
          out.removed += 1;
        }
        store.clearPending([p]);
      } catch {
        // Stays pending; tried again next start.
        out.failed += 1;
      }
    }
    return out;
  }

  function runReminders(input: { occurrenceId: string; trigger: RunTrigger; now: string; today?: string }): ReminderOutcome {
    const base: ReminderOutcome = { status: 'skipped', reason: null, occurrenceId: input.occurrenceId, counts: null, text: null };
    if (!store.getModuleSettings().reminders.enabled && input.trigger !== 'manual') return { ...base, reason: 'reminders are off' };
    const run = store.claimRun({ id: `run_${options.newToken()}`, occurrenceId: input.occurrenceId, kind: 'reminders', trigger: input.trigger, now: input.now });
    if (!run) return { ...base, reason: 'this occurrence already ran' };
    const summary = store.attention(input.now, input.today);
    store.finishRun(run.id, 'completed', input.now, { ...summary.counts });
    return { status: 'completed', reason: null, occurrenceId: input.occurrenceId, counts: summary.counts, text: reminderText(summary.counts) };
  }

  function exportBundle(objectIds: readonly string[] | 'all', now: string): Parsed<ExportBundle> {
    const ids = objectIds === 'all' ? 'all' : [...objectIds];
    if (ids !== 'all') for (const id of ids) if (!store.getObject(id)) return fail(`object ${id} does not exist`);
    // One object's export includes its components, all the way down.
    let wanted: readonly string[] | 'all' = ids;
    if (ids !== 'all') {
      const all = new Set<string>();
      const walk = (id: string, depth: number) => {
        if (all.has(id) || depth > 64) return;
        all.add(id);
        for (const c of store.components(id)) walk(c.id, depth + 1);
      };
      for (const id of ids) walk(id, 0);
      wanted = [...all];
    }
    const data = store.exportRows(wanted, now);
    const out: ExportBundle = { data, files: [], missing: [] };
    for (const file of data.files) {
      const sourcePath = files.resolveStored(file.objectId, file.storedName);
      if (sourcePath) out.files.push({ file, sourcePath, zipPath: zipPathOf(file) });
      else out.missing.push(file);
    }
    if (out.missing.length) {
      // The export must be importable: rows for files that are not in it go too.
      const gone = new Set(out.missing.map((f) => f.id));
      data.files = data.files.filter((f) => !gone.has(f.id));
      data.objects = data.objects.map((o) => (o.photoFileId && gone.has(o.photoFileId) ? { ...o, photoFileId: null } : o));
      data.purchases = data.purchases.map((p) => (p.receiptFileId && gone.has(p.receiptFileId) ? { ...p, receiptFileId: null } : p));
    }
    return { ok: true, value: out };
  }

  // One import at a time: two at once would both copy the same files, and one's clean-up would remove the other's.
  let importing: Promise<unknown> = Promise.resolve();
  function importArchive(archive: ImportArchive, alsoInTransaction?: (plan: ImportPlan) => void): Promise<Parsed<ImportPlan>> {
    const next = importing.then(() => importOne(archive, alsoInTransaction));
    importing = next.catch(() => undefined);
    return next;
  }

  async function importOne(archive: ImportArchive, alsoInTransaction?: (plan: ImportPlan) => void): Promise<Parsed<ImportPlan>> {
    const text = archive.manifestText();
    if (text === null) return fail(`That zip has no ${EXPORT_JSON_NAME}; it is not an ObjectOS export.`);
    if (text.length > IMPORT_LIMITS.maxJsonBytes) return fail(`${EXPORT_JSON_NAME} is too large.`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(`${EXPORT_JSON_NAME} is not JSON.`);
    }
    const parsed = parseExport(json);
    if (!parsed.ok) return parsed;
    const data = parsed.value;

    // Every file the rows name must be in the zip, at its exact name and size.
    let total = 0;
    for (const f of data.files) {
      const size = archive.entrySize(zipPathOf(f));
      if (size === null) return fail(`The zip is missing a file the export lists (${f.id}).`);
      if (size !== f.sizeBytes) return fail(`A file in the zip does not match the export (${f.id}).`);
      total += size;
    }
    if (total > IMPORT_LIMITS.maxUnpackedBytes) return fail('The files in that zip are too large to import.');

    // Objects already here are skipped with everything they bring - their files are not copied, their folders not touched.
    const skipped = new Set(data.objects.filter((o) => store.objectIdExists(o.id)).map((o) => o.id));
    const toCopy = data.files.filter((f) => !skipped.has(f.objectId));
    // The folders of the objects being imported: none of these objects is here, so anything
    // in those folders is left over from an import that stopped, and goes.
    const folders: PendingFile[] = data.objects.filter((o) => !skipped.has(o.id)).map((o) => ({ objectId: o.id, storedName: null }));
    store.markPending(folders);
    const undo = () => {
      for (const f of folders) files.removeFolder(f.objectId);
      settle(folders);
    };
    try {
      for (const f of folders) files.removeFolder(f.objectId);
      for (const f of toCopy) await archive.copyEntry(zipPathOf(f), f.objectId, f.storedName, { sizeBytes: f.sizeBytes, sha256: f.sha256 });
    } catch (error) {
      undo();
      return fail(`A file in the zip could not be imported: ${error instanceof Error ? error.message : String(error)}. Nothing was imported.`);
    }
    try {
      const plan = store.importRows(data, (p) => {
        alsoInTransaction?.(p);
        // Committed with the rows: from here the files belong to them.
        store.clearPending(folders);
      });
      return { ok: true, value: plan };
    } catch (error) {
      undo();
      throw error;
    }
  }

  return { newObjectId, attachFile, decideOpen, removeFile, recoverPending, deleteObject, runReminders, exportBundle, importArchive };
}

