/**
 * The export: `object-os.json` (this shape) plus each file at
 * `files/<object id>/<stored name>` in the same zip. Import parses the JSON
 * here - all or nothing - before the host touches a single file.
 *
 * Every row is validated as if typed in, and every reference must resolve
 * inside the file: an import never attaches rows to objects it did not bring.
 */

import { MAX_FILE_BYTES, SHA256, sanitizeFileName, storedFileName } from './files.ts';
import { isObjectId, isRecordId } from './ids.ts';
import { normalizeTimestamp } from './time.ts';
import type { FileRecord, MaintenanceEntry, Measurement, Modification, ObjectChange, ObjectRecord, Part, Purchase, Schedule, SettingsSnapshot, StateFact } from './types.ts';
import { FILE_ROLES } from './types.ts';
import {
  parseMaintenanceInput,
  parseMeasurementInput,
  parseModificationInput,
  parseObjectInput,
  parsePartInput,
  parsePurchaseInput,
  parseScheduleInput,
  parseSettingsInput,
  STOCK_REASONS,
  type Parsed,
  type StockReason,
} from './validation.ts';

export const EXPORT_FORMAT = 'dexnest.object_os';
export const EXPORT_VERSION = 1;
export const EXPORT_JSON_NAME = 'object-os.json';

export const IMPORT_LIMITS = {
  /** The zip on disk. */
  maxZipBytes: 4 * 1024 * 1024 * 1024,
  /** Everything inside it, uncompressed. */
  maxUnpackedBytes: 8 * 1024 * 1024 * 1024,
  maxJsonBytes: 256 * 1024 * 1024,
  maxRows: 1_000_000,
  maxErrors: 50,
} as const;

export interface StateLogRow {
  objectId: string;
  key: string;
  value: string;
  at: string;
}

export interface StockLogRow {
  partId: string;
  delta: number;
  reason: StockReason;
  maintenanceId: string | null;
  at: string;
}

export interface ObjectExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  objects: ObjectRecord[];
  changes: ObjectChange[];
  state: StateFact[];
  stateLog: StateLogRow[];
  schedules: Schedule[];
  maintenance: MaintenanceEntry[];
  modifications: Modification[];
  settings: SettingsSnapshot[];
  parts: Part[];
  stockLog: StockLogRow[];
  measurements: Measurement[];
  purchases: Purchase[];
  files: FileRecord[];
}

/** Where a file lives inside the zip. */
export const zipPathOf = (file: Pick<FileRecord, 'objectId' | 'storedName'>) => `files/${file.objectId}/${file.storedName}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseExport(input: unknown): Parsed<ObjectExport> {
  const errors: string[] = [];
  const push = (msg: string) => {
    if (errors.length < IMPORT_LIMITS.maxErrors) errors.push(msg);
    else if (errors.length === IMPORT_LIMITS.maxErrors) errors.push('... more errors not shown');
  };
  if (!isObj(input) || input.format !== EXPORT_FORMAT) return { ok: false, errors: ['the file is not an ObjectOS export'] };
  if (input.version !== EXPORT_VERSION) return { ok: false, errors: [`this export's version is not supported (ObjectOS reads version ${EXPORT_VERSION})`] };
  const exportedAt = normalizeTimestamp(input.exportedAt);
  if (!exportedAt) return { ok: false, errors: ['exportedAt is invalid'] };

  const lists = ['objects', 'changes', 'state', 'stateLog', 'schedules', 'maintenance', 'modifications', 'settings', 'parts', 'stockLog', 'measurements', 'purchases', 'files'] as const;
  const raw = {} as Record<(typeof lists)[number], unknown[]>;
  let total = 0;
  for (const key of lists) {
    const v = input[key];
    if (!Array.isArray(v)) return { ok: false, errors: [`${key} must be a list`] };
    raw[key] = v;
    total += v.length;
  }
  if (total > IMPORT_LIMITS.maxRows) return { ok: false, errors: [`the file has more than ${IMPORT_LIMITS.maxRows} rows`] };

  const ts = (v: unknown, where: string, field: string) => {
    const t = normalizeTimestamp(v);
    if (!t) push(`${where}: ${field} is invalid`);
    return t ?? '';
  };
  const fromParsed = <T>(r: Parsed<T>, where: string): T | null => {
    if (r.ok) return r.value;
    push(`${where}: ${r.errors.join('; ')}`);
    return null;
  };

  // Objects first: every other row must point at one of these.
  const objects: ObjectRecord[] = [];
  const objectIds = new Set<string>();
  raw.objects.forEach((row, i) => {
    const where = `objects[${i}]`;
    if (!isObj(row) || !isObjectId(row.id)) return push(`${where}: id is invalid`);
    const d = fromParsed(parseObjectInput(row), where);
    if (!d) return;
    if (objectIds.has(row.id)) return push(`${where}: duplicate id`);
    if (row.photoFileId !== null && row.photoFileId !== undefined && !isRecordId('file', row.photoFileId)) return push(`${where}: photoFileId is invalid`);
    objectIds.add(row.id);
    objects.push({ ...d, id: row.id, photoFileId: (row.photoFileId as string | null | undefined) ?? null, createdAt: ts(row.createdAt, where, 'createdAt'), updatedAt: ts(row.updatedAt, where, 'updatedAt') });
  });
  const known = (id: unknown, where: string) => {
    if (typeof id !== 'string' || !objectIds.has(id)) push(`${where}: refers to an object not in the file`);
  };
  for (const o of objects) if (o.parentId) known(o.parentId, `object ${o.id} parent`);

  const withIds = <T extends { id: string }>(rows: unknown[], label: string, kind: Parameters<typeof isRecordId>[0], build: (row: Obj, where: string) => T | null): T[] => {
    const out: T[] = [];
    const ids = new Set<string>();
    rows.forEach((row, i) => {
      const where = `${label}[${i}]`;
      if (!isObj(row) || !isRecordId(kind, row.id)) return push(`${where}: id is invalid`);
      if (ids.has(row.id)) return push(`${where}: duplicate id`);
      const value = build(row, where);
      if (!value) return;
      ids.add(row.id);
      out.push(value);
    });
    return out;
  };

  const changes: ObjectChange[] = [];
  raw.changes.forEach((row, i) => {
    const where = `changes[${i}]`;
    if (!isObj(row) || (row.field !== 'status' && row.field !== 'location' && row.field !== 'parent')) return push(`${where}: invalid`);
    const str = (v: unknown) => (v === null || (typeof v === 'string' && v.length <= 200) ? (v as string | null) : undefined);
    const from = str(row.from);
    const to = str(row.to);
    if (from === undefined || to === undefined) return push(`${where}: from/to are text or null`);
    known(row.objectId, where);
    changes.push({ objectId: String(row.objectId), field: row.field, from, to, at: ts(row.at, where, 'at') });
  });

  const state: StateFact[] = [];
  const stateLog: StateLogRow[] = [];
  const stateRow = (row: unknown, where: string, allowEmpty: boolean): { objectId: string; key: string; value: string; at: unknown } | null => {
    if (!isObj(row) || typeof row.key !== 'string' || !row.key.trim() || row.key.length > 60 || typeof row.value !== 'string' || row.value.length > 500 || (!allowEmpty && !row.value)) {
      push(`${where}: invalid`);
      return null;
    }
    known(row.objectId, where);
    return { objectId: String(row.objectId), key: row.key, value: row.value, at: row.updatedAt ?? row.at };
  };
  raw.state.forEach((row, i) => {
    const r = stateRow(row, `state[${i}]`, false);
    if (r) state.push({ objectId: r.objectId, key: r.key, value: r.value, updatedAt: ts(r.at, `state[${i}]`, 'updatedAt') });
  });
  raw.stateLog.forEach((row, i) => {
    const r = stateRow(row, `stateLog[${i}]`, true);
    if (r) stateLog.push({ objectId: r.objectId, key: r.key, value: r.value, at: ts(r.at, `stateLog[${i}]`, 'at') });
  });

  const schedules = withIds<Schedule>(raw.schedules, 'schedules', 'schedule', (row, where) => {
    const d = fromParsed(parseScheduleInput(row, exportedAt), where);
    if (!d) return null;
    known(d.objectId, where);
    return { ...d, id: String(row.id), createdAt: ts(row.createdAt, where, 'createdAt'), updatedAt: ts(row.updatedAt, where, 'updatedAt') };
  });
  const scheduleIds = new Set(schedules.map((s) => s.id));

  const files = withIds<FileRecord>(raw.files, 'files', 'file', (row, where) => {
    known(row.objectId, where);
    const name = typeof row.name === 'string' ? row.name : '';
    const size = row.sizeBytes;
    if (!name || sanitizeFileName(name) !== name) return (push(`${where}: name is invalid`), null);
    if (row.storedName !== storedFileName(String(row.id), name)) return (push(`${where}: storedName does not match`), null);
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return (push(`${where}: sizeBytes is invalid`), null);
    if (typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) return (push(`${where}: sha256 is invalid`), null);
    if (typeof row.type !== 'string' || row.type.length > 120) return (push(`${where}: type is invalid`), null);
    if (typeof row.role !== 'string' || !(FILE_ROLES as readonly string[]).includes(row.role)) return (push(`${where}: role is invalid`), null);
    return { id: String(row.id), objectId: String(row.objectId), role: row.role as FileRecord['role'], name, storedName: String(row.storedName), sizeBytes: size, type: row.type, sha256: row.sha256, addedAt: ts(row.addedAt, where, 'addedAt') };
  });
  const fileIds = new Map(files.map((f) => [f.id, f]));
  for (const o of objects) if (o.photoFileId && fileIds.get(o.photoFileId)?.objectId !== o.id) push(`object ${o.id}: photo is not one of its files`);

  const parts = withIds<Part>(raw.parts, 'parts', 'part', (row, where) => {
    const d = fromParsed(parsePartInput(row), where);
    if (!d) return null;
    for (const f of d.fits) known(f, where);
    return { ...d, id: String(row.id), createdAt: ts(row.createdAt, where, 'createdAt'), updatedAt: ts(row.updatedAt, where, 'updatedAt') };
  });
  const partIds = new Set(parts.map((p) => p.id));

  const maintenance = withIds<MaintenanceEntry>(raw.maintenance, 'maintenance', 'maintenance', (row, where) => {
    const d = fromParsed(parseMaintenanceInput(row, exportedAt), where);
    if (!d) return null;
    known(d.objectId, where);
    if (d.scheduleId && !scheduleIds.has(d.scheduleId)) push(`${where}: refers to a schedule not in the file`);
    for (const p of d.parts) if (!partIds.has(p.partId)) push(`${where}: refers to a part not in the file`);
    return { ...d, id: String(row.id), createdAt: ts(row.createdAt, where, 'createdAt') };
  });
  const maintenanceIds = new Set(maintenance.map((m) => m.id));

  const modifications = withIds<Modification>(raw.modifications, 'modifications', 'modification', (row, where) => {
    const d = fromParsed(parseModificationInput(row, exportedAt), where);
    if (!d) return null;
    known(d.objectId, where);
    return { ...d, id: String(row.id), createdAt: ts(row.createdAt, where, 'createdAt'), updatedAt: ts(row.updatedAt, where, 'updatedAt') };
  });

  const settings = withIds<SettingsSnapshot>(raw.settings, 'settings', 'settings', (row, where) => {
    const d = fromParsed(parseSettingsInput(row), where);
    if (!d) return null;
    known(d.objectId, where);
    if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1) return (push(`${where}: version is invalid`), null);
    return { ...d, id: String(row.id), version: row.version, createdAt: ts(row.createdAt, where, 'createdAt') };
  });
  const versions = new Set<string>();
  for (const s of settings) {
    const key = `${s.objectId}\n${s.name}\n${s.version}`;
    if (versions.has(key)) push(`settings ${s.id}: duplicate version`);
    versions.add(key);
  }

  const stockLog: StockLogRow[] = [];
  raw.stockLog.forEach((row, i) => {
    const where = `stockLog[${i}]`;
    if (!isObj(row) || !isRecordId('part', row.partId) || !partIds.has(row.partId)) return push(`${where}: refers to a part not in the file`);
    if (typeof row.delta !== 'number' || !Number.isFinite(row.delta) || row.delta === 0) return push(`${where}: delta is invalid`);
    if (typeof row.reason !== 'string' || !(STOCK_REASONS as readonly string[]).includes(row.reason)) return push(`${where}: reason is invalid`);
    const mId = row.maintenanceId === null || row.maintenanceId === undefined ? null : String(row.maintenanceId);
    if (mId && !maintenanceIds.has(mId)) return push(`${where}: refers to maintenance not in the file`);
    stockLog.push({ partId: row.partId, delta: row.delta, reason: row.reason as StockReason, maintenanceId: mId, at: ts(row.at, where, 'at') });
  });

  const measurements = withIds<Measurement>(raw.measurements, 'measurements', 'measurement', (row, where) => {
    const d = fromParsed(parseMeasurementInput(row, exportedAt), where);
    if (!d) return null;
    known(d.objectId, where);
    return { ...d, id: String(row.id), createdAt: ts(row.createdAt, where, 'createdAt') };
  });

  const purchases: Purchase[] = [];
  const purchased = new Set<string>();
  raw.purchases.forEach((row, i) => {
    const where = `purchases[${i}]`;
    const d = fromParsed(parsePurchaseInput(row), where);
    if (!d || !isObj(row)) return;
    known(d.objectId, where);
    if (purchased.has(d.objectId)) return push(`${where}: an object has one purchase`);
    purchased.add(d.objectId);
    const receipt = row.receiptFileId === null || row.receiptFileId === undefined ? null : String(row.receiptFileId);
    if (receipt && fileIds.get(receipt)?.objectId !== d.objectId) push(`${where}: receipt is not one of the object's files`);
    purchases.push({ ...d, receiptFileId: receipt, updatedAt: ts(row.updatedAt, where, 'updatedAt') });
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt, objects, changes, state, stateLog, schedules, maintenance, modifications, settings, parts, stockLog, measurements, purchases, files },
  };
}
