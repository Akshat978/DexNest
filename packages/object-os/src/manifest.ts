/**
 * What ObjectOS brings to DexNest, declared so the host file can be written
 * and reviewed against it (docs/DEXNEST_FOUNDATION_ARCHITECTURE.md, section 5).
 * Actions, the view and the job are wired in Phases 4-6.
 */

import { validateManifest, type DexNestModuleManifest } from '@dexnest/foundation';
import { OBJECT_EVENT_NAMESPACE, OBJECT_EVENT_STREAM, OBJECT_EVENT_TYPES, OBJECT_MODULE_ID } from './domain/events.ts';
import { REMINDER_INTERVAL_MS } from './domain/settings.ts';
import { OBJECT_OS_MIGRATIONS } from './store/migrations.ts';

export const OBJECT_VIEW_ID = 'object';
export const OBJECT_REMINDER_JOB = 'reminders';

export const OBJECT_ACTION_IDS = {
  open: 'object_os.open',
  objectSave: 'object_os.object.save',
  objectSetStatus: 'object_os.object.set_status',
  objectMove: 'object_os.object.move',
  objectLocate: 'object_os.object.locate',
  objectDelete: 'object_os.object.delete',
  stateSet: 'object_os.state.set',
  scheduleSave: 'object_os.schedule.save',
  maintenanceLog: 'object_os.maintenance.log',
  modificationSave: 'object_os.modification.save',
  settingsSave: 'object_os.settings.save',
  partSave: 'object_os.part.save',
  partAdjustStock: 'object_os.part.adjust_stock',
  measurementAdd: 'object_os.measurement.add',
  purchaseSave: 'object_os.purchase.save',
  fileAttach: 'object_os.file.attach',
  fileOpen: 'object_os.file.open',
  fileRemove: 'object_os.file.remove',
  recordDelete: 'object_os.record.delete',
  remindersEnable: 'object_os.reminders.enable',
  remindersDisable: 'object_os.reminders.disable',
  export: 'object_os.export',
  import: 'object_os.import',
} as const;

export const OBJECT_OS_MANIFEST: DexNestModuleManifest = {
  id: OBJECT_MODULE_ID,
  title: 'ObjectOS',
  tablePrefix: 'obj_',
  migrations: OBJECT_OS_MIGRATIONS,
  eventStreams: [OBJECT_EVENT_STREAM],
  eventTypes: OBJECT_EVENT_TYPES,
  actionIds: Object.values(OBJECT_ACTION_IDS),
  views: [{ id: OBJECT_VIEW_ID, title: 'ObjectOS' }],
  // Light: it reads ObjectOS's own tables once a day. Scheduled only while reminders are on.
  jobs: [{ id: OBJECT_REMINDER_JOB, defaultIntervalMs: REMINDER_INTERVAL_MS, heavy: false }],
};

export function manifestProblems(): string[] {
  return validateManifest(OBJECT_OS_MANIFEST, OBJECT_EVENT_NAMESPACE);
}
