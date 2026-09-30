/**
 * What GhostOS brings to DexNest, declared so the host file can be written
 * and reviewed against it (docs/DEXNEST_FOUNDATION_ARCHITECTURE.md, section 5).
 * Actions, the view and the job are wired in Phases 4-6.
 */

import { validateManifest, type DexNestModuleManifest } from '@dexnest/foundation';
import { GHOST_EVENT_NAMESPACE, GHOST_EVENT_STREAM, GHOST_EVENT_TYPES, GHOST_MODULE_ID } from './domain/events.ts';
import { DEFAULT_SYNC_INTERVAL_MINUTES } from './domain/settings.ts';
import { GHOST_OS_MIGRATIONS, GHOST_OS_SEARCH_MIGRATIONS } from './store/migrations.ts';

export const GHOST_VIEW_ID = 'ghost';
export const GHOST_SYNC_JOB = 'sync';

export const GHOST_ACTION_IDS = {
  open: 'ghost_os.open',
  entitySave: 'ghost_os.entity.save',
  relationSave: 'ghost_os.relation.save',
  observationAdd: 'ghost_os.observation.add',
  decisionRecordOutcome: 'ghost_os.decision.record_outcome',
  forget: 'ghost_os.forget',
  adapterEnable: 'ghost_os.adapter.enable',
  adapterDisable: 'ghost_os.adapter.disable',
  adapterSync: 'ghost_os.adapter.sync',
  export: 'ghost_os.export',
  import: 'ghost_os.import',
} as const;

export const GHOST_OS_MANIFEST: DexNestModuleManifest = {
  id: GHOST_MODULE_ID,
  title: 'GhostOS',
  tablePrefix: 'ghost_',
  migrations: GHOST_OS_MIGRATIONS,
  eventStreams: [GHOST_EVENT_STREAM],
  eventTypes: GHOST_EVENT_TYPES,
  actionIds: Object.values(GHOST_ACTION_IDS),
  views: [{ id: GHOST_VIEW_ID, title: 'GhostOS' }],
  // Heavy: it walks Developer Intelligence's records and commit history. Scheduled only while an adapter is on.
  jobs: [{ id: GHOST_SYNC_JOB, defaultIntervalMs: DEFAULT_SYNC_INTERVAL_MINUTES * 60_000, heavy: true }],
};

/** Problems with the manifest, and with the optional search migrations under the same prefix. */
export function manifestProblems(): string[] {
  return [
    ...validateManifest(GHOST_OS_MANIFEST, GHOST_EVENT_NAMESPACE),
    ...validateManifest({ ...GHOST_OS_MANIFEST, migrations: GHOST_OS_SEARCH_MIGRATIONS }, GHOST_EVENT_NAMESPACE),
  ];
}
