/**
 * ObjectOS events: stream "object", module "object_os". PLAN.md section 11.
 *
 * Payloads carry ids, types, counts and closed values (a status, a role) -
 * never a name, note, serial, price, key or anything else the owner typed.
 * The payload types below have no field that could hold it.
 */

import type { FileRole, ObjectStatus } from './types.ts';
import type { RecordKind } from './ids.ts';

export const OBJECT_MODULE_ID = 'object_os';
export const OBJECT_EVENT_STREAM = 'object';
export const OBJECT_EVENT_NAMESPACE = 'object';

export const OBJECT_EVENT_TYPES = [
  'object.created',
  'object.updated',
  'object.moved',
  'object.status_changed',
  'object.deleted',
  'object.state_set',
  'object.schedule_saved',
  'object.maintenance_logged',
  'object.modification_saved',
  'object.settings_saved',
  'object.part_saved',
  'object.stock_changed',
  'object.measurement_recorded',
  'object.purchase_saved',
  'object.file_attached',
  'object.file_removed',
  'object.record_deleted',
  'object.reminder_checked',
  'object.export_created',
  'object.import_completed',
] as const;
export type ObjectEventType = (typeof OBJECT_EVENT_TYPES)[number];

export interface AttentionCounts {
  overdue: number;
  dueSoon: number;
  warrantyEnding: number;
  lowStock: number;
}

export interface ObjectEventPayloads {
  'object.created': { hasParent: boolean };
  'object.updated': Record<string, never>;
  'object.moved': { parentId: string | null };
  'object.status_changed': { from: ObjectStatus; to: ObjectStatus };
  'object.deleted': { childrenDetached: number; filesRemoved: number };
  'object.state_set': { removed: boolean };
  'object.schedule_saved': { scheduleId: string; kind: 'time' | 'usage'; created: boolean };
  'object.maintenance_logged': { entryId: string; scheduleId: string | null; partsUsed: number };
  'object.modification_saved': { modificationId: string; created: boolean };
  'object.settings_saved': { snapshotId: string; version: number; keys: number };
  'object.part_saved': { partId: string; created: boolean; fits: number };
  'object.stock_changed': { partId: string; delta: number; reason: 'restocked' | 'used' | 'corrected' };
  'object.measurement_recorded': { measurementId: string };
  'object.purchase_saved': { hasPrice: boolean; hasWarranty: boolean };
  'object.file_attached': { fileId: string; role: FileRole; sizeBytes: number };
  'object.file_removed': { fileId: string };
  'object.record_deleted': { kind: RecordKind; recordId: string };
  'object.reminder_checked': AttentionCounts & { occurrenceId: string };
  'object.export_created': { objects: number; files: number };
  'object.import_completed': { objects: number; skipped: number; files: number };
}

export const reminderKey = (occurrenceId: string) => `${OBJECT_MODULE_ID}:reminder:${occurrenceId}`;

/** Audit summaries are fixed strings per action: they never interpolate the owner's text. */
export const AUDIT_SUMMARIES = {
  'object_os.object.save': 'ObjectOS object saved',
  'object_os.object.set_status': 'ObjectOS object status changed',
  'object_os.object.move': 'ObjectOS object moved',
  'object_os.object.delete': 'ObjectOS object deleted',
  'object_os.state.set': 'ObjectOS state updated',
  'object_os.schedule.save': 'ObjectOS maintenance schedule saved',
  'object_os.maintenance.log': 'ObjectOS maintenance logged',
  'object_os.modification.save': 'ObjectOS modification saved',
  'object_os.settings.save': 'ObjectOS settings snapshot saved',
  'object_os.part.save': 'ObjectOS part saved',
  'object_os.part.adjust_stock': 'ObjectOS part stock changed',
  'object_os.measurement.add': 'ObjectOS measurement recorded',
  'object_os.purchase.save': 'ObjectOS purchase saved',
  'object_os.file.attach': 'ObjectOS file attached',
  'object_os.file.open': 'ObjectOS file opened',
  'object_os.file.remove': 'ObjectOS file removed',
  'object_os.record.delete': 'ObjectOS record deleted',
  'object_os.reminders.enable': 'ObjectOS reminders turned on',
  'object_os.reminders.disable': 'ObjectOS reminders turned off',
  'object_os.export': 'ObjectOS export written',
  'object_os.import': 'ObjectOS import applied',
} as const;

/** The reminder notification: counts only. */
export function reminderText(c: AttentionCounts): string | null {
  const parts: string[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (c.overdue) parts.push(n(c.overdue, 'maintenance task overdue', 'maintenance tasks overdue'));
  if (c.dueSoon) parts.push(n(c.dueSoon, 'maintenance task due soon', 'maintenance tasks due soon'));
  if (c.warrantyEnding) parts.push(n(c.warrantyEnding, 'warranty ending', 'warranties ending'));
  if (c.lowStock) parts.push(n(c.lowStock, 'part low on stock', 'parts low on stock'));
  return parts.length ? parts.join(', ') : null;
}
