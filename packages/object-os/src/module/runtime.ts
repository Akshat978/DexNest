/**
 * ObjectOS as a DexNest module.
 *
 * Everything the desktop host needs behind the foundation's host ports and
 * the file port, so the host file is wiring only.
 *
 * - Off until asked: no job and no timer until the owner turns reminders on.
 *   Everything else works on demand.
 * - The `reminders` job is light and idempotent per slot.
 * - Every user action is validated here, writes through the store, records
 *   its `object.*` event in the same transaction, and writes one audit line
 *   with a fixed summary and ids/counts only.
 */

import type { EventLog, JobOccurrence, ModuleScheduler, SqlDatabase } from '@dexnest/foundation';
import { warrantyState, type AttentionSummary } from '../domain/attention.ts';
import { AUDIT_SUMMARIES, reminderKey } from '../domain/events.ts';
import { dueStatus, type DueStatus } from '../domain/maintenance.ts';
import { isObjectId, isRecordId, newRecordId, parseObjectId, RECORD_KINDS, type RecordKind } from '../domain/ids.ts';
import { REMINDER_INTERVAL_MS } from '../domain/settings.ts';
import { diffSettings, type SettingsDiff } from '../domain/settings-diff.ts';
import type { TimelineItem } from '../domain/timeline.ts';
import { TIMELINE_PAGE } from '../domain/timeline.ts';
import { normalizeTimestamp } from '../domain/time.ts';
import type { FileRecord, MaintenanceEntry, Measurement, Modification, ObjectRecord, ObjectStatus, Part, Purchase, Schedule, SettingsSnapshot, StateFact } from '../domain/types.ts';
import { CATEGORIES, STATUSES } from '../domain/types.ts';
import {
  parseFileRole,
  parseMaintenanceInput,
  parseMeasurementInput,
  parseModificationInput,
  parseObjectInput,
  parsePartInput,
  parsePurchaseInput,
  parseScheduleInput,
  parseSettingsInput,
  parseStateInput,
  parseStatus,
  parseStockAdjustment,
  type Parsed,
} from '../domain/validation.ts';
import { createObjectEngine, type ExportBundle, type ObjectEngine, type OpenDecision, type ReminderOutcome } from '../engine/engine.ts';
import type { ImportArchive, ObjectFilePort } from '../files/port.ts';
import { OBJECT_REMINDER_JOB } from '../manifest.ts';
import { ObjectStoreError, openObjectStore, type DeletedObject, type ImportPlan, type ObjectFilter, type ObjectStore, type RunRecord } from '../store/store.ts';
import { appendObjectEvent } from './events.ts';

export type AuditActionId = keyof typeof AUDIT_SUMMARIES;
export type AuditStatus = 'success' | 'failure';

export interface ObjectOsModuleOptions {
  database: SqlDatabase;
  /** The shared event log: written (object.*). ObjectOS reads nothing from it. */
  events: EventLog;
  scheduler: ModuleScheduler;
  files: ObjectFilePort;
  /** A line in DexNest's audit log. `summary` is always a fixed string. */
  audit?(actionId: AuditActionId, summary: string, metadata: Record<string, string | number | boolean | null>, status: AuditStatus): void;
  /** A light notification. The text is counts only. */
  notify?(title: string, body: string): void;
  now?: () => Date;
  newToken?: () => string;
  randomBytes: (n: number) => ArrayLike<number>;
}

export interface ScheduleView {
  schedule: Schedule;
  status: DueStatus;
}

export interface ObjectDetail {
  object: ObjectRecord;
  parent: Pick<ObjectRecord, 'id' | 'name'> | null;
  components: ObjectRecord[];
  state: StateFact[];
  schedules: ScheduleView[];
  maintenance: MaintenanceEntry[];
  modifications: Modification[];
  settings: SettingsSnapshot[];
  parts: Part[];
  measurements: Measurement[];
  purchase: Purchase | null;
  warranty: ReturnType<typeof warrantyState>;
  files: FileRecord[];
}

/** Attention with names, for the owner's own view only. Never logged or notified. */
export interface AttentionView {
  summary: AttentionSummary;
  names: Record<string, string>;
}

export interface ObjectOsStatus {
  remindersEnabled: boolean;
  lastReminder: RunRecord | null;
  lastError: string | null;
  objects: number;
}

export interface ObjectOsModule {
  readonly store: ObjectStore;
  readonly engine: ObjectEngine;
  start(): void;
  stop(): void;
  status(): ObjectOsStatus;

  saveObject(input: unknown): Parsed<ObjectRecord>;
  setStatus(input: unknown): Parsed<ObjectRecord>;
  moveObject(input: unknown): Parsed<ObjectRecord>;
  deleteObject(input: unknown): Parsed<DeletedObject>;
  setState(input: unknown): Parsed<{ removed: boolean }>;
  saveSchedule(input: unknown): Parsed<Schedule>;
  logMaintenance(input: unknown): Parsed<MaintenanceEntry>;
  saveModification(input: unknown): Parsed<Modification>;
  saveSettings(input: unknown): Parsed<SettingsSnapshot>;
  savePart(input: unknown): Parsed<Part>;
  adjustStock(input: unknown): Parsed<Part>;
  addMeasurement(input: unknown): Parsed<Measurement>;
  savePurchase(input: unknown): Parsed<Purchase>;
  attachFile(input: unknown): Promise<Parsed<FileRecord>>;
  openFile(input: unknown): Parsed<OpenDecision>;
  removeFile(input: unknown): Parsed<FileRecord>;
  deleteRecord(input: unknown): Parsed<{ kind: RecordKind; id: string }>;
  enableReminders(): ObjectOsStatus;
  disableReminders(): ObjectOsStatus;
  checkRemindersNow(): ReminderOutcome;
  /** Builds the export and hands it to `write` (the host's zip writer); the event is recorded after a successful write. */
  exportObjects(input: unknown, write: (bundle: ExportBundle) => Promise<void>): Promise<Parsed<{ objects: number; files: number; missing: number }>>;
  importArchive(archive: ImportArchive): Promise<Parsed<ImportPlan>>;

  listObjects(filter?: unknown): Parsed<ObjectRecord[]>;
  objectDetail(id: unknown): Parsed<ObjectDetail>;
  timeline(input: unknown): Parsed<TimelineItem[]>;
  attentionView(): AttentionView;
  settingsDiff(input: unknown): Parsed<SettingsDiff>;
  locations(): string[];
}

const fail = <T>(...errors: string[]): Parsed<T> => ({ ok: false, errors });
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createObjectOsModule(options: ObjectOsModuleOptions): ObjectOsModule {
  const now = options.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const token = options.newToken ?? (() => globalThis.crypto.randomUUID());
  const store = openObjectStore(options.database, { now: iso() });
  const engine = createObjectEngine({ store, files: options.files, newToken: token, randomBytes: options.randomBytes });
  const ev = options.events;

  let unschedule: (() => void) | undefined;
  let lastError: string | null = null;

  // The object.* event is written with the change; the audit line comes after it, and a
  // failure to write it must not turn a committed change into an error.
  const audit = (actionId: AuditActionId, metadata: Record<string, string | number | boolean | null> = {}, status: AuditStatus = 'success') => {
    try {
      options.audit?.(actionId, AUDIT_SUMMARIES[actionId], metadata, status);
    } catch {
      // The change stands; its object.* event is in the shared log.
    }
  };

  /** A store refusal becomes a Parsed failure instead of an exception. */
  function guarded<T>(work: () => Parsed<T>): Parsed<T> {
    try {
      return work();
    } catch (error) {
      if (error instanceof ObjectStoreError) return fail(error.message);
      throw error;
    }
  }

  const objectIdArg = (v: unknown): string | null => parseObjectId(v);

  // --- reminders --------------------------------------------------------------

  function reminders(occurrence: Pick<JobOccurrence, 'occurrenceId' | 'trigger'>): ReminderOutcome {
    const at = iso();
    const outcome = store.transaction(() => {
      const o = engine.runReminders({ occurrenceId: occurrence.occurrenceId, trigger: occurrence.trigger, now: at });
      if (o.status === 'completed' && o.counts) {
        appendObjectEvent(ev, 'object.reminder_checked', { subject: null, at, idempotencyKey: reminderKey(o.occurrenceId), payload: { ...o.counts, occurrenceId: o.occurrenceId } });
      }
      return o;
    });
    if (outcome.status === 'completed' && outcome.text && options.notify) {
      try {
        options.notify('ObjectOS', outcome.text);
      } catch {
        // A notification is not worth a failure.
      }
    }
    return outcome;
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = undefined;
    if (!store.getModuleSettings().reminders.enabled) return;
    unschedule = options.scheduler.schedule({
      id: OBJECT_REMINDER_JOB,
      intervalMs: REMINDER_INTERVAL_MS,
      heavy: false,
      // One daily slot; after time away, catch up once (the slot's id keeps it to once).
      runAtStartup: true,
      run: (occurrence) => {
        try {
          reminders(occurrence);
          lastError = null;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      },
    });
  }

  function setReminders(enabled: boolean): ObjectOsStatus {
    store.saveModuleSettings({ schemaVersion: 1, reminders: { enabled } }, iso());
    reschedule();
    audit(enabled ? 'object_os.reminders.enable' : 'object_os.reminders.disable');
    return status();
  }

  function status(): ObjectOsStatus {
    const lastReminder = store.lastRun('reminders') ?? null;
    return { remindersEnabled: store.getModuleSettings().reminders.enabled, lastReminder, lastError, objects: store.countObjects() };
  }

  // --- objects ----------------------------------------------------------------

  function saveObject(input: unknown): Parsed<ObjectRecord> {
    const parsed = parseObjectInput(input);
    if (!parsed.ok) return parsed;
    const d = parsed.value;
    const at = iso();
    return guarded(() => {
      if (d.id) {
        const before = store.getObject(d.id);
        if (!before) return fail(`object ${d.id} does not exist`);
        const object = store.transaction(() => {
          const o = store.updateObject(d.id as string, d, at);
          appendObjectEvent(ev, 'object.updated', { subject: o.id, at, payload: {} });
          if (before.status !== o.status) appendObjectEvent(ev, 'object.status_changed', { subject: o.id, at, payload: { from: before.status, to: o.status } });
          if (before.parentId !== o.parentId) appendObjectEvent(ev, 'object.moved', { subject: o.id, at, payload: { parentId: o.parentId } });
          return o;
        });
        audit('object_os.object.save', { objectId: object.id, created: false });
        return { ok: true, value: object };
      }
      const object = store.transaction(() => {
        const o = store.createObject(engine.newObjectId(), d, at);
        appendObjectEvent(ev, 'object.created', { subject: o.id, at, payload: { hasParent: o.parentId !== null } });
        return o;
      });
      audit('object_os.object.save', { objectId: object.id, created: true });
      return { ok: true, value: object };
    });
  }

  function setStatus(input: unknown): Parsed<ObjectRecord> {
    const id = isObj(input) ? objectIdArg(input.id) : null;
    if (!id) return fail('id is not an object id');
    const s = parseStatus(isObj(input) ? input.status : undefined);
    if (!s.ok) return s;
    const at = iso();
    return guarded(() => {
      const out = store.transaction(() => {
        const r = store.setStatus(id, s.value, at);
        if (r.from !== s.value) appendObjectEvent(ev, 'object.status_changed', { subject: id, at, payload: { from: r.from, to: s.value } });
        return r;
      });
      audit('object_os.object.set_status', { objectId: id, status: s.value });
      return { ok: true, value: out.object };
    });
  }

  function moveObject(input: unknown): Parsed<ObjectRecord> {
    const id = isObj(input) ? objectIdArg(input.id) : null;
    if (!id) return fail('id is not an object id');
    const raw = isObj(input) ? input.parentId : undefined;
    const parentId = raw === null || raw === undefined || raw === '' ? null : objectIdArg(raw);
    if (raw && !parentId) return fail('parentId is not an object id');
    const at = iso();
    return guarded(() => {
      const o = store.transaction(() => {
        const moved = store.moveObject(id, parentId, at);
        appendObjectEvent(ev, 'object.moved', { subject: id, at, payload: { parentId } });
        return moved;
      });
      audit('object_os.object.move', { objectId: id, parentId });
      return { ok: true, value: o };
    });
  }

  function deleteObject(input: unknown): Parsed<DeletedObject> {
    const id = isObj(input) ? objectIdArg(input.id) : null;
    if (!id) return fail('id is not an object id');
    const at = iso();
    return guarded(() => {
      const r = engine.deleteObject(id, at, (out) =>
        appendObjectEvent(ev, 'object.deleted', { subject: id, at, payload: { childrenDetached: out.childrenDetached.length, filesRemoved: out.files.length } }),
      );
      if (r.ok) audit('object_os.object.delete', { objectId: id, childrenDetached: r.value.childrenDetached.length, filesRemoved: r.value.files.length });
      return r;
    });
  }

  // --- records ------------------------------------------------------------------

  function setState(input: unknown): Parsed<{ removed: boolean }> {
    const p = parseStateInput(input);
    if (!p.ok) return p;
    const at = iso();
    return guarded(() => {
      const r = store.transaction(() => {
        const out = store.setState(p.value.objectId, p.value.key, p.value.value, at);
        appendObjectEvent(ev, 'object.state_set', { subject: p.value.objectId, at, payload: { removed: out.removed } });
        return out;
      });
      audit('object_os.state.set', { objectId: p.value.objectId, removed: r.removed });
      return { ok: true, value: r };
    });
  }

  function saveSchedule(input: unknown): Parsed<Schedule> {
    const at = iso();
    const p = parseScheduleInput(input, at);
    if (!p.ok) return p;
    return guarded(() => {
      const id = p.value.id ?? newRecordId('schedule', token());
      const r = store.transaction(() => {
        const out = store.saveSchedule(id, p.value, at);
        appendObjectEvent(ev, 'object.schedule_saved', { subject: p.value.objectId, at, payload: { scheduleId: id, kind: p.value.rule.kind, created: out.created } });
        return out;
      });
      audit('object_os.schedule.save', { objectId: p.value.objectId, scheduleId: id, created: r.created });
      return { ok: true, value: r.schedule };
    });
  }

  function logMaintenance(input: unknown): Parsed<MaintenanceEntry> {
    const at = iso();
    const p = parseMaintenanceInput(input, at);
    if (!p.ok) return p;
    return guarded(() => {
      const id = newRecordId('maintenance', token());
      const entry = store.transaction(() => {
        const e = store.logMaintenance(id, p.value, at);
        appendObjectEvent(ev, 'object.maintenance_logged', { subject: e.objectId, at, payload: { entryId: id, scheduleId: e.scheduleId, partsUsed: e.parts.length } });
        for (const part of e.parts) appendObjectEvent(ev, 'object.stock_changed', { subject: e.objectId, at, payload: { partId: part.partId, delta: -part.quantity, reason: 'used' } });
        return e;
      });
      audit('object_os.maintenance.log', { objectId: entry.objectId, entryId: id, partsUsed: entry.parts.length });
      return { ok: true, value: entry };
    });
  }

  function saveModification(input: unknown): Parsed<Modification> {
    const at = iso();
    const p = parseModificationInput(input, at);
    if (!p.ok) return p;
    return guarded(() => {
      const id = p.value.id ?? newRecordId('modification', token());
      const r = store.transaction(() => {
        const out = store.saveModification(id, p.value, at);
        appendObjectEvent(ev, 'object.modification_saved', { subject: p.value.objectId, at, payload: { modificationId: id, created: out.created } });
        return out;
      });
      audit('object_os.modification.save', { objectId: p.value.objectId, modificationId: id, created: r.created });
      return { ok: true, value: r.modification };
    });
  }

  function saveSettings(input: unknown): Parsed<SettingsSnapshot> {
    const p = parseSettingsInput(input);
    if (!p.ok) return p;
    const at = iso();
    return guarded(() => {
      const r = store.transaction(() => {
        const out = store.saveSnapshot(newRecordId('settings', token()), p.value, at);
        if (out.created) appendObjectEvent(ev, 'object.settings_saved', { subject: p.value.objectId, at, payload: { snapshotId: out.snapshot.id, version: out.snapshot.version, keys: Object.keys(out.snapshot.values).length } });
        return out;
      });
      audit('object_os.settings.save', { objectId: p.value.objectId, version: r.snapshot.version, created: r.created });
      return { ok: true, value: r.snapshot };
    });
  }

  function savePart(input: unknown): Parsed<Part> {
    const p = parsePartInput(input);
    if (!p.ok) return p;
    const at = iso();
    return guarded(() => {
      const id = p.value.id ?? newRecordId('part', token());
      const before = store.getPart(id)?.quantity ?? 0;
      const r = store.transaction(() => {
        const out = store.savePart(id, p.value, at);
        appendObjectEvent(ev, 'object.part_saved', { subject: null, at, payload: { partId: id, created: out.created, fits: out.part.fits.length } });
        const delta = Math.round((out.part.quantity - before) * 1000) / 1000;
        if (delta !== 0) appendObjectEvent(ev, 'object.stock_changed', { subject: null, at, payload: { partId: id, delta, reason: out.created ? 'restocked' : 'corrected' } });
        return out;
      });
      audit('object_os.part.save', { partId: id, created: r.created });
      return { ok: true, value: r.part };
    });
  }

  function adjustStock(input: unknown): Parsed<Part> {
    const p = parseStockAdjustment(input);
    if (!p.ok) return p;
    const at = iso();
    return guarded(() => {
      const part = store.transaction(() => {
        const out = store.adjustStock(p.value, at);
        appendObjectEvent(ev, 'object.stock_changed', { subject: null, at, payload: { partId: p.value.partId, delta: p.value.delta, reason: p.value.reason } });
        return out;
      });
      audit('object_os.part.adjust_stock', { partId: p.value.partId, delta: p.value.delta });
      return { ok: true, value: part };
    });
  }

  function addMeasurement(input: unknown): Parsed<Measurement> {
    const at = iso();
    const p = parseMeasurementInput(input, at);
    if (!p.ok) return p;
    return guarded(() => {
      const m = store.transaction(() => {
        const out = store.addMeasurement(newRecordId('measurement', token()), p.value, at);
        appendObjectEvent(ev, 'object.measurement_recorded', { subject: p.value.objectId, at, payload: { measurementId: out.id } });
        return out;
      });
      audit('object_os.measurement.add', { objectId: p.value.objectId, measurementId: m.id });
      return { ok: true, value: m };
    });
  }

  function savePurchase(input: unknown): Parsed<Purchase> {
    const p = parsePurchaseInput(input);
    if (!p.ok) return p;
    const at = iso();
    return guarded(() => {
      const purchase = store.transaction(() => {
        const out = store.savePurchase(p.value, at);
        appendObjectEvent(ev, 'object.purchase_saved', { subject: p.value.objectId, at, payload: { hasPrice: out.price !== null, hasWarranty: out.warrantyUntil !== null } });
        return out;
      });
      audit('object_os.purchase.save', { objectId: p.value.objectId });
      return { ok: true, value: purchase };
    });
  }

  // --- files ----------------------------------------------------------------------

  async function attachFile(input: unknown): Promise<Parsed<FileRecord>> {
    if (!isObj(input)) return fail('attach needs { objectId, sourcePath, role }');
    const objectId = objectIdArg(input.objectId);
    if (!objectId) return fail('objectId is not an object id');
    if (typeof input.sourcePath !== 'string' || !input.sourcePath) return fail('sourcePath is required');
    const role = parseFileRole(input.role);
    if (!role.ok) return role;
    const at = iso();
    const r = await engine.attachFile({ objectId, sourcePath: input.sourcePath, role: role.value, now: at }, (f) =>
      appendObjectEvent(ev, 'object.file_attached', { subject: objectId, at, payload: { fileId: f.id, role: f.role, sizeBytes: f.sizeBytes } }),
    );
    if (!r.ok) {
      audit('object_os.file.attach', { objectId }, 'failure');
      return r;
    }
    audit('object_os.file.attach', { objectId, fileId: r.value.id, sizeBytes: r.value.sizeBytes });
    return r;
  }

  function openFile(input: unknown): Parsed<OpenDecision> {
    const fileId = isObj(input) ? input.fileId : undefined;
    const r = engine.decideOpen(String(fileId ?? ''));
    audit('object_os.file.open', { fileId: typeof fileId === 'string' && isRecordId('file', fileId) ? fileId : null, action: r.ok ? r.value.action : null }, r.ok ? 'success' : 'failure');
    return r;
  }

  function removeFile(input: unknown): Parsed<FileRecord> {
    const fileId = isObj(input) ? input.fileId : undefined;
    if (!isRecordId('file', fileId)) return fail('fileId is invalid');
    const at = iso();
    const r = engine.removeFile(fileId, (removed) => appendObjectEvent(ev, 'object.file_removed', { subject: removed.objectId, at, payload: { fileId } }));
    if (!r.ok) return r;
    audit('object_os.file.remove', { objectId: r.value.objectId, fileId });
    return r;
  }

  function deleteRecord(input: unknown): Parsed<{ kind: RecordKind; id: string }> {
    const kind = isObj(input) ? input.kind : undefined;
    const id = isObj(input) ? input.id : undefined;
    if (typeof kind !== 'string' || kind === 'file' || !(RECORD_KINDS as readonly string[]).includes(kind)) return fail('kind must be schedule, maintenance, modification, settings, part or measurement');
    if (!isRecordId(kind as RecordKind, id)) return fail('id is invalid');
    const at = iso();
    return guarded(() => {
      const r = store.transaction(() => {
        const out = store.deleteRecord(kind as Exclude<RecordKind, 'file'>, id);
        if (out) appendObjectEvent(ev, 'object.record_deleted', { subject: out.objectId, at, payload: { kind: kind as RecordKind, recordId: id } });
        return out;
      });
      if (!r) return fail(`${kind} ${id} does not exist`);
      audit('object_os.record.delete', { kind, id });
      return { ok: true, value: { kind: kind as RecordKind, id } };
    });
  }

  // --- export and import ------------------------------------------------------------

  async function exportObjects(input: unknown, write: (bundle: ExportBundle) => Promise<void>) {
    const raw = isObj(input) ? input.objectIds : undefined;
    let ids: string[] | 'all' = 'all';
    if (raw !== undefined && raw !== 'all') {
      if (!Array.isArray(raw) || raw.length === 0 || raw.some((x) => !isObjectId(x))) return fail<{ objects: number; files: number; missing: number }>('objectIds must be a list of object ids, or "all"');
      ids = raw as string[];
    }
    const b = engine.exportBundle(ids, iso());
    if (!b.ok) return b;
    await write(b.value);
    const counts = { objects: b.value.data.objects.length, files: b.value.files.length, missing: b.value.missing.length };
    appendObjectEvent(ev, 'object.export_created', { subject: null, at: iso(), payload: { objects: counts.objects, files: counts.files } });
    audit('object_os.export', counts);
    return { ok: true as const, value: counts };
  }

  async function importArchive(archive: ImportArchive): Promise<Parsed<ImportPlan>> {
    const at = iso();
    let r: Parsed<ImportPlan>;
    try {
      r = await engine.importArchive(archive, (plan) =>
        appendObjectEvent(ev, 'object.import_completed', { subject: null, at, payload: { objects: plan.objects.length, skipped: plan.skipped.length, files: plan.files.length } }),
      );
    } catch (error) {
      // A refusal from the store (a chain too deep under an object already here) is a refusal, not a crash.
      if (!(error instanceof ObjectStoreError)) throw error;
      r = fail(error.message);
    }
    audit('object_os.import', r.ok ? { objects: r.value.objects.length, skipped: r.value.skipped.length, files: r.value.files.length } : {}, r.ok ? 'success' : 'failure');
    return r;
  }

  // --- reads ---------------------------------------------------------------------------

  function listObjects(filter: unknown): Parsed<ObjectRecord[]> {
    const f: ObjectFilter = {};
    if (filter !== undefined && filter !== null) {
      if (!isObj(filter)) return fail('filter must be an object');
      if (typeof filter.search === 'string') f.search = filter.search.slice(0, 200);
      if (filter.category !== undefined) {
        if (!(CATEGORIES as readonly unknown[]).includes(filter.category)) return fail('unknown category');
        f.category = filter.category as ObjectFilter['category'];
      }
      if (filter.status !== undefined) {
        if (!(STATUSES as readonly unknown[]).includes(filter.status)) return fail('unknown status');
        f.status = filter.status as ObjectStatus;
      }
      if (typeof filter.location === 'string' && filter.location) f.location = filter.location.slice(0, 120);
    }
    return { ok: true, value: store.listObjects(f) };
  }

  function objectDetail(raw: unknown): Parsed<ObjectDetail> {
    const id = objectIdArg(raw);
    if (!id) return fail('id is not an object id');
    const object = store.getObject(id);
    if (!object) return fail(`object ${id} does not exist`);
    const at = iso();
    const maintenance = store.maintenance(id);
    const measurements = store.measurements(id);
    const parent = object.parentId ? store.getObject(object.parentId) : undefined;
    const purchase = store.purchaseOf(id) ?? null;
    return {
      ok: true,
      value: {
        object,
        parent: parent ? { id: parent.id, name: parent.name } : null,
        components: store.components(id),
        state: store.stateOf(id),
        schedules: store.schedules(id).map((schedule) => ({ schedule, status: dueStatus(schedule, maintenance, measurements, at) })),
        maintenance,
        modifications: store.modifications(id),
        settings: store.snapshots(id),
        parts: store.parts(id),
        measurements,
        purchase,
        warranty: warrantyState(purchase?.warrantyUntil ?? null, at),
        files: store.files(id),
      },
    };
  }

  function timeline(input: unknown): Parsed<TimelineItem[]> {
    if (!isObj(input)) return fail('timeline needs { objectId }');
    const id = objectIdArg(input.objectId);
    if (!id) return fail('objectId is not an object id');
    const limit = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, TIMELINE_PAGE.maxLimit) : TIMELINE_PAGE.defaultLimit;
    let before: { at: string; refId: string } | null = null;
    if (isObj(input.before)) {
      const at = normalizeTimestamp(input.before.at);
      if (!at || typeof input.before.refId !== 'string' || input.before.refId.length > 80) return fail('before must be { at, refId } of a history item');
      before = { at, refId: input.before.refId };
    }
    return { ok: true, value: store.timeline(id, { limit, before }) };
  }

  function attentionView(): AttentionView {
    const summary = store.attention(iso());
    const names: Record<string, string> = {};
    // Each object, part and object's schedules read once, however many items name them.
    const scheduleTitles = new Map<string, Map<string, string>>();
    for (const item of summary.items) {
      if (item.kind === 'stock') {
        if (!(item.partId in names)) names[item.partId] = store.getPart(item.partId)?.name ?? '';
        continue;
      }
      if (!(item.objectId in names)) names[item.objectId] = store.getObject(item.objectId)?.name ?? '';
      if (item.kind === 'maintenance') {
        let titles = scheduleTitles.get(item.objectId);
        if (!titles) {
          titles = new Map(store.schedules(item.objectId).map((s) => [s.id, s.title]));
          scheduleTitles.set(item.objectId, titles);
        }
        names[item.scheduleId] = titles.get(item.scheduleId) ?? '';
      }
    }
    return { summary, names };
  }

  function settingsDiff(input: unknown): Parsed<SettingsDiff> {
    if (!isObj(input) || !isRecordId('settings', input.from) || !isRecordId('settings', input.to)) return fail('settingsDiff needs { from, to } snapshot ids');
    const id = objectIdArg(input.objectId);
    if (!id) return fail('objectId is not an object id');
    const snaps = store.snapshots(id);
    const a = snaps.find((s) => s.id === input.from);
    const b = snaps.find((s) => s.id === input.to);
    if (!a || !b) return fail('both snapshots must belong to this object');
    if (a.name !== b.name) return fail('compare two versions of the same settings');
    return { ok: true, value: diffSettings(a.values, b.values) };
  }

  return {
    store,
    engine,
    start() {
      store.recoverInterruptedRuns(iso());
      // Bytes left by a copy or delete that DexNest stopped in the middle of.
      try {
        engine.recoverPending();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      reschedule();
    },
    stop() {
      unschedule?.();
      unschedule = undefined;
    },
    status,
    saveObject,
    setStatus,
    moveObject,
    deleteObject,
    setState,
    saveSchedule,
    logMaintenance,
    saveModification,
    saveSettings,
    savePart,
    adjustStock,
    addMeasurement,
    savePurchase,
    attachFile,
    openFile,
    removeFile,
    deleteRecord,
    enableReminders: () => setReminders(true),
    disableReminders: () => setReminders(false),
    checkRemindersNow: () => reminders({ occurrenceId: `${OBJECT_REMINDER_JOB}:manual:${iso()}`, trigger: 'manual' }),
    exportObjects,
    importArchive,
    listObjects,
    objectDetail,
    timeline,
    attentionView,
    settingsDiff,
    locations: () => store.locations(),
  };
}
