/**
 * ObjectOS persistence on the shared SqlDatabase.
 *
 * The runtime parses what the owner typed (domain/validation.ts) and hands
 * the store drafts; the store keeps the model whole:
 * - every row belongs to an object that exists (foreign keys);
 * - a component can never end up inside itself (checked on every move);
 * - deleting an object deletes its own rows and detaches its components -
 *   children are never deleted with a parent;
 * - stock never goes below zero, and a maintenance entry and the stock it
 *   uses commit together;
 * - an import is one transaction: all of it lands, or none.
 *
 * Files are rows here; the bytes are the host's (see files/).
 */

import { runModuleMigrations, withTransaction, type SqlDatabase } from '@dexnest/foundation';
import { attention, type AttentionSummary } from '../domain/attention.ts';
import { MAX_COMPONENT_DEPTH, wouldCreateCycle } from '../domain/components.ts';
import { EXPORT_FORMAT, EXPORT_VERSION, type ObjectExport, type StockLogRow } from '../domain/export.ts';
import type { RecordKind } from '../domain/ids.ts';
import { toPublicObject, type PublicObject } from '../domain/read-api.ts';
import { defaultObjectOsSettings, normalizeObjectOsSettings, type ObjectOsSettings } from '../domain/settings.ts';
import { TIMELINE_PAGE, type TimelineItem } from '../domain/timeline.ts';
import type {
  Category,
  FileRecord,
  MaintenanceEntry,
  Measurement,
  Modification,
  ObjectChange,
  ObjectRecord,
  ObjectStatus,
  Part,
  Purchase,
  Schedule,
  ScheduleRule,
  SettingsSnapshot,
  StateFact,
} from '../domain/types.ts';
import {
  applyStock,
  unitConflict,
  type MaintenanceDraft,
  type MeasurementDraft,
  type ModificationDraft,
  type ObjectDraft,
  type PartDraft,
  type PurchaseDraft,
  type ScheduleDraft,
  type SettingsDraft,
  type StockAdjustment,
} from '../domain/validation.ts';
import { OBJECT_OS_MIGRATIONS } from './migrations.ts';

export const OBJECT_MIGRATION_MODULE = 'object_os';

export class ObjectStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectStoreError';
  }
}

export interface ObjectFilter {
  /** Matches name, make, model, serial, location and tags. */
  search?: string;
  category?: Category;
  status?: ObjectStatus;
  location?: string;
  /** Only the components of this object; null = only top-level objects. */
  parentId?: string | null;
  limit?: number;
}

export interface DeletedObject {
  childrenDetached: string[];
  /** The files whose bytes the host must now delete. */
  files: FileRecord[];
}

export type RunTrigger = 'scheduled' | 'startup' | 'manual';
export interface RunRecord {
  id: string;
  occurrenceId: string;
  kind: string;
  trigger: RunTrigger;
  status: 'running' | 'completed' | 'skipped' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface ImportPlan {
  /** Objects written. */
  objects: string[];
  /** Objects already here: left as they are, with everything they brought. */
  skipped: string[];
  /** The files the host must now copy in from the zip. */
  files: FileRecord[];
}

/** How many objects one list read returns unless asked for more (up to 5,000). */
export const OBJECT_LIST_PAGE = 500;

/** Bytes that may exist without a row: a file, or (storedName null) an object's whole folder. */
export interface PendingFile {
  objectId: string;
  storedName: string | null;
}

export interface ObjectStore {
  objectIdExists(id: string): boolean;
  countObjects(): number;
  /** Recorded before bytes are written or deleted; cleared when the work is done (see migration 2). */
  markPending(entries: readonly PendingFile[]): void;
  clearPending(entries: readonly PendingFile[]): void;
  pendingFiles(): PendingFile[];
  /** Whether a file row claims this stored name in this object's folder. */
  storedFileExists(objectId: string, storedName: string): boolean;
  createObject(id: string, draft: ObjectDraft, now: string): ObjectRecord;
  updateObject(id: string, draft: ObjectDraft, now: string): ObjectRecord;
  setStatus(id: string, status: ObjectStatus, now: string): { from: ObjectStatus; object: ObjectRecord };
  moveObject(id: string, parentId: string | null, now: string): ObjectRecord;
  deleteObject(id: string, now: string): DeletedObject;
  getObject(id: string): ObjectRecord | undefined;
  listObjects(filter?: ObjectFilter): ObjectRecord[];
  components(id: string): ObjectRecord[];
  locations(): string[];
  changes(objectId: string): ObjectChange[];

  setState(objectId: string, key: string, value: string, now: string): { removed: boolean };
  stateOf(objectId: string): StateFact[];

  saveSchedule(id: string, draft: ScheduleDraft, now: string): { schedule: Schedule; created: boolean };
  schedules(objectId?: string): Schedule[];
  logMaintenance(id: string, draft: MaintenanceDraft, now: string): MaintenanceEntry;
  maintenance(objectId?: string): MaintenanceEntry[];

  saveModification(id: string, draft: ModificationDraft, now: string): { modification: Modification; created: boolean };
  modifications(objectId: string): Modification[];

  /** A new version, or the latest one unchanged when the values are the same. */
  saveSnapshot(id: string, draft: SettingsDraft, now: string): { snapshot: SettingsSnapshot; created: boolean };
  snapshots(objectId: string): SettingsSnapshot[];

  savePart(id: string, draft: PartDraft, now: string): { part: Part; created: boolean };
  adjustStock(adjustment: StockAdjustment, now: string): Part;
  parts(objectId?: string): Part[];
  getPart(id: string): Part | undefined;
  stockLog(partId: string): StockLogRow[];

  addMeasurement(id: string, draft: MeasurementDraft, now: string): Measurement;
  measurements(objectId: string, key?: string): Measurement[];

  savePurchase(draft: PurchaseDraft, now: string): Purchase;
  purchaseOf(objectId: string): Purchase | undefined;

  addFile(file: FileRecord): FileRecord;
  getFile(id: string): FileRecord | undefined;
  files(objectId: string): FileRecord[];
  /** Removes the row and clears it as photo or receipt; the host deletes the bytes. */
  removeFile(id: string): FileRecord | undefined;
  setPhoto(objectId: string, fileId: string | null, now: string): void;
  setReceipt(objectId: string, fileId: string | null, now: string): void;

  deleteRecord(kind: Exclude<RecordKind, 'file'>, id: string): { objectId: string | null } | undefined;

  timeline(objectId: string, options?: { limit?: number; before?: { at: string; refId: string } | null }): TimelineItem[];
  attention(now: string): AttentionSummary;

  exportRows(objectIds: readonly string[] | 'all', now: string): ObjectExport;
  importRows(data: ObjectExport, alsoInTransaction?: (plan: ImportPlan) => void): ImportPlan;

  getModuleSettings(): ObjectOsSettings;
  saveModuleSettings(settings: ObjectOsSettings, now: string): ObjectOsSettings;

  claimRun(input: { id: string; occurrenceId: string; kind: string; trigger: RunTrigger; now: string }): RunRecord | null;
  finishRun(id: string, status: 'completed' | 'skipped' | 'failed', now: string, summary: Record<string, unknown>, error?: string | null): RunRecord;
  getRunByOccurrence(occurrenceId: string): RunRecord | undefined;
  lastRun(kind: string): RunRecord | undefined;
  recoverInterruptedRuns(now: string): number;

  transaction<T>(work: () => T): T;
}

/** Read-only access for other modules: public fields only. */
export interface ObjectReadApi {
  listObjects(filter?: Omit<ObjectFilter, 'search'>): PublicObject[];
  getObject(id: string): PublicObject | undefined;
  components(id: string): PublicObject[];
  /** Ids and states only. */
  attention(now: string): AttentionSummary;
}

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toObject(row: Row, tags: string[]): ObjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as Category,
    make: String(row.make),
    model: String(row.model),
    serial: String(row.serial),
    location: String(row.location),
    status: row.status as ObjectStatus,
    notes: String(row.notes),
    tags,
    parentId: str(row.parent_id),
    photoFileId: str(row.photo_file_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const toSchedule = (r: Row): Schedule => ({
  id: String(r.id),
  objectId: String(r.object_id),
  title: String(r.title),
  rule: JSON.parse(String(r.rule_json)) as ScheduleRule,
  startsAt: String(r.starts_at),
  startReading: numOrNull(r.start_reading),
  active: Number(r.active) === 1,
  notes: String(r.notes),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toModification = (r: Row): Modification => ({
  id: String(r.id),
  objectId: String(r.object_id),
  title: String(r.title),
  doneAt: String(r.done_at),
  reason: String(r.reason),
  before: String(r.before),
  after: String(r.after),
  reversible: Number(r.reversible) === 1,
  revertedAt: str(r.reverted_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toSettings = (r: Row): SettingsSnapshot => ({
  id: String(r.id),
  objectId: String(r.object_id),
  name: String(r.name),
  version: Number(r.version),
  values: JSON.parse(String(r.values_json)) as Record<string, string>,
  note: String(r.note),
  createdAt: String(r.created_at),
});

const toMeasurement = (r: Row): Measurement => ({
  id: String(r.id),
  objectId: String(r.object_id),
  key: String(r.key),
  value: Number(r.value),
  unit: String(r.unit),
  measuredAt: String(r.measured_at),
  note: String(r.note),
  createdAt: String(r.created_at),
});

const toFile = (r: Row): FileRecord => ({
  id: String(r.id),
  objectId: String(r.object_id),
  role: r.role as FileRecord['role'],
  name: String(r.name),
  storedName: String(r.stored_name),
  sizeBytes: Number(r.size_bytes),
  type: String(r.type),
  sha256: String(r.sha256),
  addedAt: String(r.added_at),
});

const toPurchase = (r: Row): Purchase => ({
  objectId: String(r.object_id),
  purchasedOn: str(r.purchased_on),
  price: r.price_amount === null || r.price_amount === undefined ? null : { amount: Number(r.price_amount), currency: String(r.price_currency) },
  shop: String(r.shop),
  warrantyUntil: str(r.warranty_until),
  receiptFileId: str(r.receipt_file_id),
  updatedAt: String(r.updated_at),
});

const toRun = (r: Row): RunRecord => ({
  id: String(r.id),
  occurrenceId: String(r.occurrence_id),
  kind: String(r.kind),
  trigger: r.trigger as RunTrigger,
  status: r.status as RunRecord['status'],
  startedAt: String(r.started_at),
  finishedAt: str(r.finished_at),
  summary: JSON.parse(String(r.summary_json)) as Record<string, unknown>,
  error: str(r.error),
});

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function runObjectOsMigrations(db: SqlDatabase, now?: string) {
  return runModuleMigrations(db, OBJECT_MIGRATION_MODULE, OBJECT_OS_MIGRATIONS, now);
}

export function openObjectStore(db: SqlDatabase, options: { now?: string } = {}): ObjectStore {
  runObjectOsMigrations(db, options.now ?? new Date().toISOString());

  const one = <T = Row>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).get<T>(params);
  const all = <T = Row>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).all<T>(params);
  const run = (sql: string, params: readonly unknown[] = []) => db.prepare(sql).run(params);
  const tx = <T>(work: () => T) => withTransaction(db, work);

  const tagsOf = (id: string) => all<{ tag: string }>('SELECT tag FROM obj_tags WHERE object_id = ? ORDER BY tag', [id]).map((r) => r.tag);
  const exists = (id: string) => one('SELECT 1 AS ok FROM obj_objects WHERE id = ?', [id]) !== undefined;
  const need = (id: string) => {
    if (!exists(id)) throw new ObjectStoreError(`object ${id} does not exist`);
  };
  const getObject = (id: string) => {
    const row = one('SELECT * FROM obj_objects WHERE id = ?', [id]);
    return row ? toObject(row, tagsOf(id)) : undefined;
  };
  const parentOf = (id: string) => str(one('SELECT parent_id FROM obj_objects WHERE id = ?', [id])?.parent_id);

  const change = (objectId: string, field: ObjectChange['field'], from: string | null, to: string | null, at: string) => {
    if (from !== to) run('INSERT INTO obj_changes (object_id, field, from_value, to_value, at) VALUES (?, ?, ?, ?, ?)', [objectId, field, from, to, at]);
  };

  const checkParent = (id: string, parentId: string | null) => {
    if (parentId === null) return;
    need(parentId);
    if (wouldCreateCycle(id, parentId, parentOf)) throw new ObjectStoreError('an object cannot be inside itself or one of its own components');
  };

  const writeTags = (id: string, tags: readonly string[]) => {
    run('DELETE FROM obj_tags WHERE object_id = ?', [id]);
    for (const t of tags) run('INSERT INTO obj_tags (object_id, tag) VALUES (?, ?)', [id, t]);
  };

  // --- objects -----------------------------------------------------------------

  function createObject(id: string, d: ObjectDraft, now: string): ObjectRecord {
    return tx(() => {
      if (exists(id)) throw new ObjectStoreError(`object ${id} already exists`);
      checkParent(id, d.parentId);
      run(
        `INSERT INTO obj_objects (id, name, category, make, model, serial, location, status, notes, parent_id, photo_file_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [id, d.name, d.category, d.make, d.model, d.serial, d.location, d.status, d.notes, d.parentId, now, now],
      );
      writeTags(id, d.tags);
      return getObject(id) as ObjectRecord;
    });
  }

  function updateObject(id: string, d: ObjectDraft, now: string): ObjectRecord {
    return tx(() => {
      const before = getObject(id);
      if (!before) throw new ObjectStoreError(`object ${id} does not exist`);
      checkParent(id, d.parentId);
      run('UPDATE obj_objects SET name = ?, category = ?, make = ?, model = ?, serial = ?, location = ?, status = ?, notes = ?, parent_id = ?, updated_at = ? WHERE id = ?', [
        d.name, d.category, d.make, d.model, d.serial, d.location, d.status, d.notes, d.parentId, now, id,
      ]);
      writeTags(id, d.tags);
      change(id, 'status', before.status, d.status, now);
      change(id, 'location', before.location || null, d.location || null, now);
      change(id, 'parent', before.parentId, d.parentId, now);
      return getObject(id) as ObjectRecord;
    });
  }

  function setStatus(id: string, status: ObjectStatus, now: string) {
    return tx(() => {
      const before = getObject(id);
      if (!before) throw new ObjectStoreError(`object ${id} does not exist`);
      run('UPDATE obj_objects SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
      change(id, 'status', before.status, status, now);
      return { from: before.status, object: getObject(id) as ObjectRecord };
    });
  }

  function moveObject(id: string, parentId: string | null, now: string): ObjectRecord {
    return tx(() => {
      const before = getObject(id);
      if (!before) throw new ObjectStoreError(`object ${id} does not exist`);
      checkParent(id, parentId);
      run('UPDATE obj_objects SET parent_id = ?, updated_at = ? WHERE id = ?', [parentId, now, id]);
      change(id, 'parent', before.parentId, parentId, now);
      return getObject(id) as ObjectRecord;
    });
  }

  function deleteObject(id: string, now: string): DeletedObject {
    return tx(() => {
      if (!exists(id)) throw new ObjectStoreError(`object ${id} does not exist`);
      // Components are detached, never deleted: each keeps its own history.
      const children = all<{ id: string }>('SELECT id FROM obj_objects WHERE parent_id = ? ORDER BY id', [id]).map((r) => r.id);
      for (const child of children) {
        run('UPDATE obj_objects SET parent_id = NULL, updated_at = ? WHERE id = ?', [now, child]);
        change(child, 'parent', id, null, now);
      }
      const files = all('SELECT * FROM obj_files WHERE object_id = ? ORDER BY id', [id]).map(toFile);
      run('DELETE FROM obj_maintenance_parts WHERE maintenance_id IN (SELECT id FROM obj_maintenance WHERE object_id = ?)', [id]);
      run('UPDATE obj_stock_log SET maintenance_id = NULL WHERE maintenance_id IN (SELECT id FROM obj_maintenance WHERE object_id = ?)', [id]);
      for (const table of ['obj_maintenance', 'obj_schedules', 'obj_modifications', 'obj_settings', 'obj_measurements', 'obj_purchase', 'obj_files', 'obj_state', 'obj_state_log', 'obj_changes', 'obj_tags', 'obj_part_fits']) {
        run(`DELETE FROM ${table} WHERE object_id = ?`, [id]);
      }
      run('DELETE FROM obj_objects WHERE id = ?', [id]);
      return { childrenDetached: children, files };
    });
  }

  function listObjects(filter: ObjectFilter = {}): ObjectRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.category) {
      where.push('o.category = ?');
      params.push(filter.category);
    }
    if (filter.status) {
      where.push('o.status = ?');
      params.push(filter.status);
    }
    if (filter.location !== undefined) {
      where.push('o.location = ? COLLATE NOCASE');
      params.push(filter.location);
    }
    if (filter.parentId !== undefined) {
      if (filter.parentId === null) where.push('o.parent_id IS NULL');
      else {
        where.push('o.parent_id = ?');
        params.push(filter.parentId);
      }
    }
    for (const term of (filter.search ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push(
        "(o.name LIKE ? ESCAPE '\\' OR o.make LIKE ? ESCAPE '\\' OR o.model LIKE ? ESCAPE '\\' OR o.serial LIKE ? ESCAPE '\\' OR o.location LIKE ? ESCAPE '\\' OR o.id LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM obj_tags t WHERE t.object_id = o.id AND t.tag LIKE ? ESCAPE '\\'))",
      );
      const p = likeEscape(term);
      params.push(p, p, p, p, p, likeEscape(term.replace(/-/g, '').toUpperCase()), p);
    }
    const limit = Math.max(1, Math.min(filter.limit ?? OBJECT_LIST_PAGE, 5000));
    return all(`SELECT * FROM obj_objects o ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.name COLLATE NOCASE, o.id LIMIT ?`, [...params, limit]).map((r) =>
      toObject(r, tagsOf(String(r.id))),
    );
  }

  // --- state ---------------------------------------------------------------------

  function setState(objectId: string, key: string, value: string, now: string) {
    return tx(() => {
      need(objectId);
      run('INSERT INTO obj_state_log (object_id, key, value, at) VALUES (?, ?, ?, ?)', [objectId, key, value, now]);
      if (value === '') {
        run('DELETE FROM obj_state WHERE object_id = ? AND key = ?', [objectId, key]);
        return { removed: true };
      }
      run(
        `INSERT INTO obj_state (object_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (object_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [objectId, key, value, now],
      );
      return { removed: false };
    });
  }

  // --- maintenance ---------------------------------------------------------------------

  function saveSchedule(id: string, d: ScheduleDraft, now: string) {
    return tx(() => {
      need(d.objectId);
      const existing = one('SELECT * FROM obj_schedules WHERE id = ?', [id]);
      if (existing && String(existing.object_id) !== d.objectId) throw new ObjectStoreError('a schedule stays with its object');
      if (existing) {
        run('UPDATE obj_schedules SET title = ?, rule_json = ?, starts_at = ?, start_reading = ?, active = ?, notes = ?, updated_at = ? WHERE id = ?', [
          d.title, JSON.stringify(d.rule), d.startsAt, d.startReading, d.active ? 1 : 0, d.notes, now, id,
        ]);
      } else {
        run('INSERT INTO obj_schedules (id, object_id, title, rule_json, starts_at, start_reading, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          id, d.objectId, d.title, JSON.stringify(d.rule), d.startsAt, d.startReading, d.active ? 1 : 0, d.notes, now, now,
        ]);
      }
      return { schedule: toSchedule(one('SELECT * FROM obj_schedules WHERE id = ?', [id]) as Row), created: !existing };
    });
  }

  const partsUsed = (maintenanceId: string) =>
    all<{ part_id: string; quantity: number }>('SELECT part_id, quantity FROM obj_maintenance_parts WHERE maintenance_id = ? ORDER BY part_id', [maintenanceId]).map((r) => ({
      partId: r.part_id,
      quantity: Number(r.quantity),
    }));

  const toEntry = (r: Row): MaintenanceEntry => ({
    id: String(r.id),
    objectId: String(r.object_id),
    scheduleId: str(r.schedule_id),
    title: String(r.title),
    doneAt: String(r.done_at),
    doneBy: String(r.done_by),
    cost: r.cost_amount === null || r.cost_amount === undefined ? null : { amount: Number(r.cost_amount), currency: String(r.cost_currency) },
    notes: String(r.notes),
    usageReading: numOrNull(r.usage_reading),
    parts: partsUsed(String(r.id)),
    createdAt: String(r.created_at),
  });

  function changeStock(partId: string, delta: number, reason: StockAdjustment['reason'], maintenanceId: string | null, now: string) {
    const row = one<{ quantity: number }>('SELECT quantity FROM obj_parts WHERE id = ?', [partId]);
    if (!row) throw new ObjectStoreError(`part ${partId} does not exist`);
    const next = applyStock(Number(row.quantity), delta);
    if (!next.ok) throw new ObjectStoreError(`${next.errors.join('; ')} (part ${partId})`);
    run('UPDATE obj_parts SET quantity = ?, updated_at = ? WHERE id = ?', [next.value, now, partId]);
    run('INSERT INTO obj_stock_log (part_id, delta, reason, maintenance_id, at) VALUES (?, ?, ?, ?, ?)', [partId, delta, reason, maintenanceId, now]);
  }

  function logMaintenance(id: string, d: MaintenanceDraft, now: string): MaintenanceEntry {
    return tx(() => {
      need(d.objectId);
      if (d.scheduleId) {
        const s = one<{ object_id: string }>('SELECT object_id FROM obj_schedules WHERE id = ?', [d.scheduleId]);
        if (!s || s.object_id !== d.objectId) throw new ObjectStoreError('that schedule is not one of this object’s');
      }
      run(
        `INSERT INTO obj_maintenance (id, object_id, schedule_id, title, done_at, done_by, cost_amount, cost_currency, notes, usage_reading, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, d.objectId, d.scheduleId, d.title, d.doneAt, d.doneBy, d.cost?.amount ?? null, d.cost?.currency ?? null, d.notes, d.usageReading, now],
      );
      // The parts it used come out of stock in the same transaction; not enough stock fails the whole entry.
      for (const p of d.parts) {
        run('INSERT INTO obj_maintenance_parts (maintenance_id, part_id, quantity) VALUES (?, ?, ?)', [id, p.partId, p.quantity]);
        changeStock(p.partId, -p.quantity, 'used', id, now);
      }
      return toEntry(one('SELECT * FROM obj_maintenance WHERE id = ?', [id]) as Row);
    });
  }

  // --- modifications, settings -----------------------------------------------------------

  function saveModification(id: string, d: ModificationDraft, now: string) {
    return tx(() => {
      need(d.objectId);
      const existing = one('SELECT object_id FROM obj_modifications WHERE id = ?', [id]);
      if (existing && String(existing.object_id) !== d.objectId) throw new ObjectStoreError('a modification stays with its object');
      if (existing) {
        run('UPDATE obj_modifications SET title = ?, done_at = ?, reason = ?, before = ?, after = ?, reversible = ?, reverted_at = ?, updated_at = ? WHERE id = ?', [
          d.title, d.doneAt, d.reason, d.before, d.after, d.reversible ? 1 : 0, d.revertedAt, now, id,
        ]);
      } else {
        run('INSERT INTO obj_modifications (id, object_id, title, done_at, reason, before, after, reversible, reverted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          id, d.objectId, d.title, d.doneAt, d.reason, d.before, d.after, d.reversible ? 1 : 0, d.revertedAt, now, now,
        ]);
      }
      return { modification: toModification(one('SELECT * FROM obj_modifications WHERE id = ?', [id]) as Row), created: !existing };
    });
  }

  function saveSnapshot(id: string, d: SettingsDraft, now: string) {
    return tx(() => {
      need(d.objectId);
      const latest = one('SELECT * FROM obj_settings WHERE object_id = ? AND name = ? ORDER BY version DESC LIMIT 1', [d.objectId, d.name]);
      const values = JSON.stringify(d.values);
      if (latest && String(latest.values_json) === values) return { snapshot: toSettings(latest), created: false };
      const version = latest ? Number(latest.version) + 1 : 1;
      run('INSERT INTO obj_settings (id, object_id, name, version, values_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, d.objectId, d.name, version, values, d.note, now]);
      return { snapshot: toSettings(one('SELECT * FROM obj_settings WHERE id = ?', [id]) as Row), created: true };
    });
  }

  // --- parts ----------------------------------------------------------------------------------

  const fitsOf = (partId: string) => all<{ object_id: string }>('SELECT object_id FROM obj_part_fits WHERE part_id = ? ORDER BY object_id', [partId]).map((r) => r.object_id);
  const toPart = (r: Row): Part => ({
    id: String(r.id),
    name: String(r.name),
    partNumber: String(r.part_number),
    supplier: String(r.supplier),
    unit: String(r.unit),
    quantity: Number(r.quantity),
    lowStockAt: numOrNull(r.low_stock_at),
    notes: String(r.notes),
    fits: fitsOf(String(r.id)),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  function savePart(id: string, d: PartDraft, now: string) {
    return tx(() => {
      for (const f of d.fits) need(f);
      const existing = one<{ quantity: number }>('SELECT quantity FROM obj_parts WHERE id = ?', [id]);
      if (existing) {
        // Quantity changes go through the stock log, so an edit that changes it is a correction.
        const delta = Math.round((d.quantity - Number(existing.quantity)) * 1000) / 1000;
        run('UPDATE obj_parts SET name = ?, part_number = ?, supplier = ?, unit = ?, low_stock_at = ?, notes = ?, updated_at = ? WHERE id = ?', [d.name, d.partNumber, d.supplier, d.unit, d.lowStockAt, d.notes, now, id]);
        if (delta !== 0) changeStock(id, delta, 'corrected', null, now);
      } else {
        run('INSERT INTO obj_parts (id, name, part_number, supplier, unit, quantity, low_stock_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)', [
          id, d.name, d.partNumber, d.supplier, d.unit, d.lowStockAt, d.notes, now, now,
        ]);
        if (d.quantity > 0) changeStock(id, d.quantity, 'restocked', null, now);
      }
      run('DELETE FROM obj_part_fits WHERE part_id = ?', [id]);
      for (const f of d.fits) run('INSERT INTO obj_part_fits (part_id, object_id) VALUES (?, ?)', [id, f]);
      return { part: toPart(one('SELECT * FROM obj_parts WHERE id = ?', [id]) as Row), created: !existing };
    });
  }

  // --- measurements, purchase, files ---------------------------------------------------------

  function addMeasurement(id: string, d: MeasurementDraft, now: string): Measurement {
    return tx(() => {
      need(d.objectId);
      const unit = str(one('SELECT unit FROM obj_measurements WHERE object_id = ? AND key = ? LIMIT 1', [d.objectId, d.key])?.unit);
      const conflict = unitConflict(unit, d.unit);
      if (conflict) throw new ObjectStoreError(conflict);
      run('INSERT INTO obj_measurements (id, object_id, key, value, unit, measured_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, d.objectId, d.key, d.value, d.unit, d.measuredAt, d.note, now]);
      return toMeasurement(one('SELECT * FROM obj_measurements WHERE id = ?', [id]) as Row);
    });
  }

  function savePurchase(d: PurchaseDraft, now: string): Purchase {
    return tx(() => {
      need(d.objectId);
      run(
        `INSERT INTO obj_purchase (object_id, purchased_on, price_amount, price_currency, shop, warranty_until, receipt_file_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT (object_id) DO UPDATE SET purchased_on = excluded.purchased_on, price_amount = excluded.price_amount, price_currency = excluded.price_currency,
           shop = excluded.shop, warranty_until = excluded.warranty_until, updated_at = excluded.updated_at`,
        [d.objectId, d.purchasedOn, d.price?.amount ?? null, d.price?.currency ?? null, d.shop, d.warrantyUntil, now],
      );
      return toPurchase(one('SELECT * FROM obj_purchase WHERE object_id = ?', [d.objectId]) as Row);
    });
  }

  const fileOf = (objectId: string, fileId: string | null) => {
    if (fileId === null) return;
    const f = one<{ object_id: string }>('SELECT object_id FROM obj_files WHERE id = ?', [fileId]);
    if (!f || f.object_id !== objectId) throw new ObjectStoreError('that file is not one of this object’s');
  };

  function addFile(file: FileRecord): FileRecord {
    return tx(() => {
      need(file.objectId);
      run('INSERT INTO obj_files (id, object_id, role, name, stored_name, size_bytes, type, sha256, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        file.id, file.objectId, file.role, file.name, file.storedName, file.sizeBytes, file.type, file.sha256, file.addedAt,
      ]);
      return toFile(one('SELECT * FROM obj_files WHERE id = ?', [file.id]) as Row);
    });
  }

  function removeFile(id: string): FileRecord | undefined {
    return tx(() => {
      const row = one('SELECT * FROM obj_files WHERE id = ?', [id]);
      if (!row) return undefined;
      run('UPDATE obj_objects SET photo_file_id = NULL WHERE photo_file_id = ?', [id]);
      run('UPDATE obj_purchase SET receipt_file_id = NULL WHERE receipt_file_id = ?', [id]);
      run('DELETE FROM obj_files WHERE id = ?', [id]);
      return toFile(row);
    });
  }

  // --- deleting a record ---------------------------------------------------------------------

  function deleteRecord(kind: Exclude<RecordKind, 'file'>, id: string) {
    return tx(() => {
      const table = { schedule: 'obj_schedules', maintenance: 'obj_maintenance', modification: 'obj_modifications', settings: 'obj_settings', part: 'obj_parts', measurement: 'obj_measurements' }[kind];
      const row = one(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!row) return undefined;
      const objectId = kind === 'part' ? null : String(row.object_id);
      if (kind === 'schedule') run('UPDATE obj_maintenance SET schedule_id = NULL WHERE schedule_id = ?', [id]);
      if (kind === 'maintenance') {
        // Stock already used stays used: the stock log keeps the history, without the link.
        run('DELETE FROM obj_maintenance_parts WHERE maintenance_id = ?', [id]);
        run('UPDATE obj_stock_log SET maintenance_id = NULL WHERE maintenance_id = ?', [id]);
      }
      if (kind === 'part') {
        run('DELETE FROM obj_part_fits WHERE part_id = ?', [id]);
        run('DELETE FROM obj_maintenance_parts WHERE part_id = ?', [id]);
        run('DELETE FROM obj_stock_log WHERE part_id = ?', [id]);
      }
      run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      return { objectId };
    });
  }

  // --- history ---------------------------------------------------------------------------------

  function timeline(objectId: string, options: { limit?: number; before?: { at: string; refId: string } | null } = {}): TimelineItem[] {
    const limit = Math.max(1, Math.min(options.limit ?? TIMELINE_PAGE.defaultLimit, TIMELINE_PAGE.maxLimit));
    const parts = [
      `SELECT 'created' AS kind, id AS ref_id, created_at AS at, name AS title, '' AS detail FROM obj_objects WHERE id = ?`,
      `SELECT 'change', 'chg-' || seq, at, field, coalesce(from_value, '') || ' → ' || coalesce(to_value, '') FROM obj_changes WHERE object_id = ?`,
      `SELECT 'state', 'st-' || seq, at, key, value FROM obj_state_log WHERE object_id = ?`,
      `SELECT 'schedule', id, created_at, title, '' FROM obj_schedules WHERE object_id = ?`,
      `SELECT 'maintenance', id, done_at, title, notes FROM obj_maintenance WHERE object_id = ?`,
      `SELECT 'modification', id, done_at, title, reason FROM obj_modifications WHERE object_id = ?`,
      `SELECT 'settings', id, created_at, name, 'v' || version FROM obj_settings WHERE object_id = ?`,
      `SELECT 'measurement', id, measured_at, key, value || ' ' || unit FROM obj_measurements WHERE object_id = ?`,
      `SELECT 'file', id, added_at, name, role FROM obj_files WHERE object_id = ?`,
      `SELECT 'purchase', object_id, updated_at, shop, coalesce(purchased_on, '') FROM obj_purchase WHERE object_id = ?`,
    ];
    const params: unknown[] = parts.map(() => objectId);
    let sql = `SELECT * FROM (${parts.join(' UNION ALL ')})`;
    if (options.before) {
      sql += ' WHERE (at < ? OR (at = ? AND ref_id < ?))';
      params.push(options.before.at, options.before.at, options.before.refId);
    }
    sql += ' ORDER BY at DESC, ref_id DESC LIMIT ?';
    params.push(limit);
    return all(sql, params).map((r) => ({ kind: r.kind as TimelineItem['kind'], refId: String(r.ref_id), at: String(r.at), title: String(r.title), detail: String(r.detail) }));
  }

  const allSchedules = (objectId?: string) =>
    (objectId ? all('SELECT * FROM obj_schedules WHERE object_id = ? ORDER BY created_at, id', [objectId]) : all('SELECT * FROM obj_schedules ORDER BY created_at, id')).map(toSchedule);
  const allMaintenance = (objectId?: string) =>
    (objectId ? all('SELECT * FROM obj_maintenance WHERE object_id = ? ORDER BY done_at DESC, id DESC', [objectId]) : all('SELECT * FROM obj_maintenance ORDER BY done_at DESC, id DESC')).map(toEntry);
  const allParts = (objectId?: string) =>
    (objectId
      ? all('SELECT p.* FROM obj_parts p JOIN obj_part_fits f ON f.part_id = p.id WHERE f.object_id = ? ORDER BY p.name COLLATE NOCASE, p.id', [objectId])
      : all('SELECT * FROM obj_parts ORDER BY name COLLATE NOCASE, id')
    ).map(toPart);

  function computeAttention(now: string): AttentionSummary {
    // Only what a schedule can use: the latest reading per usage key, and the readings around completions.
    const schedules = allSchedules();
    const pairs = new Map<string, [string, string]>();
    for (const s of schedules) if (s.rule.kind === 'usage') pairs.set(`${s.objectId}\n${s.rule.measurementKey}`, [s.objectId, s.rule.measurementKey]);
    const readings: Measurement[] = [];
    for (const [objectId, key] of pairs.values()) {
      for (const r of all('SELECT * FROM obj_measurements WHERE object_id = ? AND key = ? ORDER BY measured_at', [objectId, key])) readings.push(toMeasurement(r));
    }
    return attention({
      objects: all<{ id: string; status: ObjectStatus }>('SELECT id, status FROM obj_objects'),
      schedules,
      log: all('SELECT * FROM obj_maintenance WHERE schedule_id IS NOT NULL').map(toEntry),
      readings,
      purchases: all('SELECT * FROM obj_purchase WHERE warranty_until IS NOT NULL').map(toPurchase),
      parts: all('SELECT * FROM obj_parts WHERE low_stock_at IS NOT NULL').map(toPart),
      now,
    });
  }

  // --- export and import ------------------------------------------------------------------------

  function exportRows(objectIds: readonly string[] | 'all', now: string): ObjectExport {
    const ids = objectIds === 'all' ? all<{ id: string }>('SELECT id FROM obj_objects ORDER BY id').map((r) => r.id) : [...new Set(objectIds)].sort();
    for (const id of ids) need(id);
    const set = new Set(ids);
    const objects = ids.map((id) => getObject(id) as ObjectRecord).map((o) => ({ ...o, parentId: o.parentId && set.has(o.parentId) ? o.parentId : null }));
    const inIds = (sql: string) => ids.flatMap((id) => all(sql, [id]));
    const parts = allParts().filter((p) => p.fits.some((f) => set.has(f))).map((p) => ({ ...p, fits: p.fits.filter((f) => set.has(f)) }));
    const partIds = new Set(parts.map((p) => p.id));
    const maintenance = inIds('SELECT * FROM obj_maintenance WHERE object_id = ? ORDER BY id')
      .map(toEntry)
      .map((m) => ({ ...m, parts: m.parts.filter((p) => partIds.has(p.partId)) }));
    const maintenanceIds = new Set(maintenance.map((m) => m.id));
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now,
      objects,
      changes: inIds('SELECT * FROM obj_changes WHERE object_id = ? ORDER BY seq').map((r) => ({ objectId: String(r.object_id), field: r.field as ObjectChange['field'], from: str(r.from_value), to: str(r.to_value), at: String(r.at) })),
      state: inIds('SELECT * FROM obj_state WHERE object_id = ? ORDER BY key').map((r) => ({ objectId: String(r.object_id), key: String(r.key), value: String(r.value), updatedAt: String(r.updated_at) })),
      stateLog: inIds('SELECT * FROM obj_state_log WHERE object_id = ? ORDER BY seq').map((r) => ({ objectId: String(r.object_id), key: String(r.key), value: String(r.value), at: String(r.at) })),
      schedules: inIds('SELECT * FROM obj_schedules WHERE object_id = ? ORDER BY id').map(toSchedule),
      maintenance,
      modifications: inIds('SELECT * FROM obj_modifications WHERE object_id = ? ORDER BY id').map(toModification),
      settings: inIds('SELECT * FROM obj_settings WHERE object_id = ? ORDER BY id').map(toSettings),
      parts,
      stockLog: [...partIds].sort().flatMap((pid) =>
        all('SELECT * FROM obj_stock_log WHERE part_id = ? ORDER BY seq', [pid]).map((r) => ({
          partId: String(r.part_id),
          delta: Number(r.delta),
          reason: r.reason as StockLogRow['reason'],
          maintenanceId: r.maintenance_id && maintenanceIds.has(String(r.maintenance_id)) ? String(r.maintenance_id) : null,
          at: String(r.at),
        })),
      ),
      measurements: inIds('SELECT * FROM obj_measurements WHERE object_id = ? ORDER BY id').map(toMeasurement),
      purchases: inIds('SELECT * FROM obj_purchase WHERE object_id = ?').map(toPurchase),
      files: inIds('SELECT * FROM obj_files WHERE object_id = ? ORDER BY id').map(toFile),
    };
  }

  /**
   * Merge: an object already here is skipped with everything the file brings
   * for it. A part already here (by id) is kept as it is; its fits to the
   * new objects are added. Everything else lands exactly as exported.
   */
  function importRows(data: ObjectExport, alsoInTransaction?: (plan: ImportPlan) => void): ImportPlan {
    return tx(() => {
      const skipped = data.objects.filter((o) => exists(o.id)).map((o) => o.id);
      const skip = new Set(skipped);
      const take = <T extends { objectId: string }>(rows: readonly T[]) => rows.filter((r) => !skip.has(r.objectId));
      const objects = data.objects.filter((o) => !skip.has(o.id));
      const written = new Set(objects.map((o) => o.id));
      // Parents first, so every parent_id points at a row that exists.
      const ordered: ObjectRecord[] = [];
      const placed = new Set<string>();
      const place = (o: ObjectRecord, depth = 0) => {
        if (placed.has(o.id) || depth > 64) return;
        const parent = o.parentId && written.has(o.parentId) ? objects.find((x) => x.id === o.parentId) : undefined;
        if (parent) place(parent, depth + 1);
        placed.add(o.id);
        ordered.push(o);
      };
      for (const o of objects) place(o);
      for (const o of ordered) {
        const parentId = o.parentId && (written.has(o.parentId) || exists(o.parentId)) ? o.parentId : null;
        run(
          `INSERT INTO obj_objects (id, name, category, make, model, serial, location, status, notes, parent_id, photo_file_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [o.id, o.name, o.category, o.make, o.model, o.serial, o.location, o.status, o.notes, parentId, o.createdAt, o.updatedAt],
        );
        writeTags(o.id, o.tags);
      }
      for (const c of take(data.changes)) run('INSERT INTO obj_changes (object_id, field, from_value, to_value, at) VALUES (?, ?, ?, ?, ?)', [c.objectId, c.field, c.from, c.to, c.at]);
      for (const s of take(data.state)) run('INSERT INTO obj_state (object_id, key, value, updated_at) VALUES (?, ?, ?, ?)', [s.objectId, s.key, s.value, s.updatedAt]);
      for (const s of take(data.stateLog)) run('INSERT INTO obj_state_log (object_id, key, value, at) VALUES (?, ?, ?, ?)', [s.objectId, s.key, s.value, s.at]);
      for (const s of take(data.schedules)) {
        run('INSERT INTO obj_schedules (id, object_id, title, rule_json, starts_at, start_reading, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          s.id, s.objectId, s.title, JSON.stringify(s.rule), s.startsAt, s.startReading, s.active ? 1 : 0, s.notes, s.createdAt, s.updatedAt,
        ]);
      }
      const newParts = new Set<string>();
      for (const p of data.parts) {
        if (!one('SELECT 1 AS ok FROM obj_parts WHERE id = ?', [p.id])) {
          newParts.add(p.id);
          run('INSERT INTO obj_parts (id, name, part_number, supplier, unit, quantity, low_stock_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            p.id, p.name, p.partNumber, p.supplier, p.unit, p.quantity, p.lowStockAt, p.notes, p.createdAt, p.updatedAt,
          ]);
        }
        for (const f of p.fits) if (written.has(f)) run('INSERT OR IGNORE INTO obj_part_fits (part_id, object_id) VALUES (?, ?)', [p.id, f]);
      }
      const maintenance = take(data.maintenance);
      for (const m of maintenance) {
        run(
          `INSERT INTO obj_maintenance (id, object_id, schedule_id, title, done_at, done_by, cost_amount, cost_currency, notes, usage_reading, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.id, m.objectId, m.scheduleId, m.title, m.doneAt, m.doneBy, m.cost?.amount ?? null, m.cost?.currency ?? null, m.notes, m.usageReading, m.createdAt],
        );
        // Parts used are recorded; stock is not taken again - the file's quantities already reflect it.
        for (const p of m.parts) run('INSERT INTO obj_maintenance_parts (maintenance_id, part_id, quantity) VALUES (?, ?, ?)', [m.id, p.partId, p.quantity]);
      }
      const importedMaintenance = new Set(maintenance.map((m) => m.id));
      for (const s of data.stockLog) {
        if (!newParts.has(s.partId)) continue;
        run('INSERT INTO obj_stock_log (part_id, delta, reason, maintenance_id, at) VALUES (?, ?, ?, ?, ?)', [s.partId, s.delta, s.reason, s.maintenanceId && importedMaintenance.has(s.maintenanceId) ? s.maintenanceId : null, s.at]);
      }
      for (const m of take(data.modifications)) {
        run('INSERT INTO obj_modifications (id, object_id, title, done_at, reason, before, after, reversible, reverted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          m.id, m.objectId, m.title, m.doneAt, m.reason, m.before, m.after, m.reversible ? 1 : 0, m.revertedAt, m.createdAt, m.updatedAt,
        ]);
      }
      for (const s of take(data.settings)) {
        run('INSERT INTO obj_settings (id, object_id, name, version, values_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [s.id, s.objectId, s.name, s.version, JSON.stringify(s.values), s.note, s.createdAt]);
      }
      for (const m of take(data.measurements)) {
        run('INSERT INTO obj_measurements (id, object_id, key, value, unit, measured_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [m.id, m.objectId, m.key, m.value, m.unit, m.measuredAt, m.note, m.createdAt]);
      }
      const files = take(data.files);
      for (const f of files) {
        run('INSERT INTO obj_files (id, object_id, role, name, stored_name, size_bytes, type, sha256, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          f.id, f.objectId, f.role, f.name, f.storedName, f.sizeBytes, f.type, f.sha256, f.addedAt,
        ]);
      }
      for (const p of take(data.purchases)) {
        run('INSERT INTO obj_purchase (object_id, purchased_on, price_amount, price_currency, shop, warranty_until, receipt_file_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          p.objectId, p.purchasedOn, p.price?.amount ?? null, p.price?.currency ?? null, p.shop, p.warrantyUntil, p.receiptFileId, p.updatedAt,
        ]);
      }
      for (const o of objects) if (o.photoFileId) run('UPDATE obj_objects SET photo_file_id = ? WHERE id = ?', [o.photoFileId, o.id]);
      // An imported object may hang under one already here: the whole chain must stay within the limit and never loop.
      for (const o of ordered) {
        const seen = new Set<string>([o.id]);
        let current = parentOf(o.id);
        for (let depth = 1; current !== null; depth++) {
          if (seen.has(current) || depth > MAX_COMPONENT_DEPTH) throw new ObjectStoreError(`importing would put object ${o.id} inside itself or more than ${MAX_COMPONENT_DEPTH} levels deep`);
          seen.add(current);
          current = parentOf(current);
        }
      }
      const plan: ImportPlan = { objects: objects.map((o) => o.id), skipped, files };
      alsoInTransaction?.(plan);
      return plan;
    });
  }

  // --- settings, runs ---------------------------------------------------------------------------

  function getModuleSettings(): ObjectOsSettings {
    const row = one<{ value_json: string }>("SELECT value_json FROM obj_kv WHERE key = 'settings'");
    return row ? normalizeObjectOsSettings(JSON.parse(row.value_json)) : defaultObjectOsSettings();
  }

  const pendingKey = (e: PendingFile) => [e.objectId, e.storedName ?? ''];

  return {
    objectIdExists: exists,
    countObjects: () => Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM obj_objects')?.n ?? 0),
    markPending: (entries) =>
      tx(() => {
        for (const e of entries) run('INSERT OR IGNORE INTO obj_pending_files (object_id, stored_name) VALUES (?, ?)', pendingKey(e));
      }),
    clearPending: (entries) =>
      tx(() => {
        for (const e of entries) run('DELETE FROM obj_pending_files WHERE object_id = ? AND stored_name = ?', pendingKey(e));
      }),
    pendingFiles: () =>
      all<{ object_id: string; stored_name: string }>('SELECT object_id, stored_name FROM obj_pending_files ORDER BY object_id, stored_name').map((r) => ({
        objectId: String(r.object_id),
        storedName: r.stored_name ? String(r.stored_name) : null,
      })),
    storedFileExists: (objectId, storedName) => one('SELECT 1 AS ok FROM obj_files WHERE object_id = ? AND stored_name = ?', [objectId, storedName]) !== undefined,
    createObject,
    updateObject,
    setStatus,
    moveObject,
    deleteObject,
    getObject,
    listObjects,
    components: (id) => listObjects({ parentId: id }),
    locations: () => all<{ location: string }>("SELECT DISTINCT location FROM obj_objects WHERE location <> '' ORDER BY location COLLATE NOCASE").map((r) => r.location),
    changes: (objectId) => all('SELECT * FROM obj_changes WHERE object_id = ? ORDER BY seq', [objectId]).map((r) => ({ objectId, field: r.field as ObjectChange['field'], from: str(r.from_value), to: str(r.to_value), at: String(r.at) })),

    setState,
    stateOf: (objectId) => all('SELECT * FROM obj_state WHERE object_id = ? ORDER BY key', [objectId]).map((r) => ({ objectId, key: String(r.key), value: String(r.value), updatedAt: String(r.updated_at) })),

    saveSchedule,
    schedules: allSchedules,
    logMaintenance,
    maintenance: allMaintenance,

    saveModification,
    modifications: (objectId) => all('SELECT * FROM obj_modifications WHERE object_id = ? ORDER BY done_at DESC, id DESC', [objectId]).map(toModification),

    saveSnapshot,
    snapshots: (objectId) => all('SELECT * FROM obj_settings WHERE object_id = ? ORDER BY name COLLATE NOCASE, version DESC', [objectId]).map(toSettings),

    savePart,
    adjustStock: (a, now) =>
      tx(() => {
        changeStock(a.partId, a.delta, a.reason, null, now);
        return toPart(one('SELECT * FROM obj_parts WHERE id = ?', [a.partId]) as Row);
      }),
    parts: allParts,
    getPart: (id) => {
      const row = one('SELECT * FROM obj_parts WHERE id = ?', [id]);
      return row ? toPart(row) : undefined;
    },
    stockLog: (partId) =>
      all('SELECT * FROM obj_stock_log WHERE part_id = ? ORDER BY seq', [partId]).map((r) => ({ partId, delta: Number(r.delta), reason: r.reason as StockLogRow['reason'], maintenanceId: str(r.maintenance_id), at: String(r.at) })),

    addMeasurement,
    measurements: (objectId, key) =>
      (key ? all('SELECT * FROM obj_measurements WHERE object_id = ? AND key = ? ORDER BY measured_at, id', [objectId, key]) : all('SELECT * FROM obj_measurements WHERE object_id = ? ORDER BY key, measured_at, id', [objectId])).map(toMeasurement),

    savePurchase,
    purchaseOf: (objectId) => {
      const row = one('SELECT * FROM obj_purchase WHERE object_id = ?', [objectId]);
      return row ? toPurchase(row) : undefined;
    },

    addFile,
    getFile: (id) => {
      const row = one('SELECT * FROM obj_files WHERE id = ?', [id]);
      return row ? toFile(row) : undefined;
    },
    files: (objectId) => all('SELECT * FROM obj_files WHERE object_id = ? ORDER BY added_at DESC, id', [objectId]).map(toFile),
    removeFile,
    setPhoto: (objectId, fileId, now) =>
      tx(() => {
        need(objectId);
        fileOf(objectId, fileId);
        run('UPDATE obj_objects SET photo_file_id = ?, updated_at = ? WHERE id = ?', [fileId, now, objectId]);
      }),
    setReceipt: (objectId, fileId, now) =>
      tx(() => {
        need(objectId);
        fileOf(objectId, fileId);
        if (!one('SELECT 1 AS ok FROM obj_purchase WHERE object_id = ?', [objectId])) {
          run("INSERT INTO obj_purchase (object_id, purchased_on, price_amount, price_currency, shop, warranty_until, receipt_file_id, updated_at) VALUES (?, NULL, NULL, NULL, '', NULL, ?, ?)", [objectId, fileId, now]);
        } else run('UPDATE obj_purchase SET receipt_file_id = ?, updated_at = ? WHERE object_id = ?', [fileId, now, objectId]);
      }),

    deleteRecord,
    timeline,
    attention: computeAttention,
    exportRows,
    importRows,

    getModuleSettings,
    saveModuleSettings: (settings, now) => {
      const s = normalizeObjectOsSettings(settings);
      run(
        `INSERT INTO obj_kv (key, value_json, updated_at) VALUES ('settings', ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        [JSON.stringify(s), now],
      );
      return getModuleSettings();
    },

    claimRun: (input) => {
      const res = run("INSERT OR IGNORE INTO obj_runs (id, occurrence_id, kind, trigger, status, started_at, finished_at, summary_json, error) VALUES (?, ?, ?, ?, 'running', ?, NULL, '{}', NULL)", [
        input.id, input.occurrenceId, input.kind, input.trigger, input.now,
      ]);
      return Number(res.changes) === 0 ? null : toRun(one('SELECT * FROM obj_runs WHERE id = ?', [input.id]) as Row);
    },
    finishRun: (id, status, now, summary, error = null) => {
      run('UPDATE obj_runs SET status = ?, finished_at = ?, summary_json = ?, error = ? WHERE id = ?', [status, now, JSON.stringify(summary), error, id]);
      const row = one('SELECT * FROM obj_runs WHERE id = ?', [id]);
      if (!row) throw new ObjectStoreError(`run ${id} does not exist`);
      return toRun(row);
    },
    getRunByOccurrence: (occurrenceId) => {
      const row = one('SELECT * FROM obj_runs WHERE occurrence_id = ?', [occurrenceId]);
      return row ? toRun(row) : undefined;
    },
    lastRun: (kind) => {
      const row = one('SELECT * FROM obj_runs WHERE kind = ? ORDER BY started_at DESC, id DESC LIMIT 1', [kind]);
      return row ? toRun(row) : undefined;
    },
    recoverInterruptedRuns: (now) => Number(run("UPDATE obj_runs SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE status = 'running'", [now]).changes),

    transaction: tx,
  };
}

/** Read-only access for other modules (GhostOS, RoomCompiler, Reality RPG): public fields only, never writes. */
export function createObjectReadApi(store: Pick<ObjectStore, 'listObjects' | 'getObject' | 'components' | 'attention'>): ObjectReadApi {
  return {
    listObjects: (filter = {}) => store.listObjects(filter).map(toPublicObject),
    getObject: (id) => {
      const o = store.getObject(id);
      return o ? toPublicObject(o) : undefined;
    },
    components: (id) => store.components(id).map(toPublicObject),
    attention: (now) => store.attention(now),
  };
}
