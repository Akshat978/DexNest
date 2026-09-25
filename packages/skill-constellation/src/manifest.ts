/**
 * What Skill Constellation brings to DexNest, declared so the host file can be
 * written and reviewed against it (docs/DEXNEST_FOUNDATION_ARCHITECTURE.md §5).
 *
 * Actions, the view and the job are declared now and wired in Phases 4-6.
 */

import { validateManifest, type DexNestModuleManifest } from '@dexnest/foundation';
import { SKILL_EVENT_NAMESPACE, SKILL_EVENT_STREAM, SKILL_EVENT_TYPES, SKILL_MODULE_ID } from './domain/events.ts';
import { DEFAULT_REBUILD_INTERVAL_MINUTES } from './domain/settings.ts';
import { SKILL_CONSTELLATION_MIGRATIONS } from './store/migrations.ts';

export const SKILL_VIEW_ID = 'skills';
export const SKILL_REBUILD_JOB = 'rebuild';

export const SKILL_ACTION_IDS = {
  open: 'skill_constellation.open',
  rebuild: 'skill_constellation.rebuild',
  enable: 'skill_constellation.enable',
  disable: 'skill_constellation.disable',
} as const;

export const SKILL_CONSTELLATION_MANIFEST: DexNestModuleManifest = {
  id: SKILL_MODULE_ID,
  title: 'Skill Constellation',
  tablePrefix: 'skill_',
  migrations: SKILL_CONSTELLATION_MIGRATIONS,
  eventStreams: [SKILL_EVENT_STREAM],
  eventTypes: SKILL_EVENT_TYPES,
  actionIds: Object.values(SKILL_ACTION_IDS),
  views: [{ id: SKILL_VIEW_ID, title: 'Skill Constellation' }],
  jobs: [{ id: SKILL_REBUILD_JOB, defaultIntervalMs: DEFAULT_REBUILD_INTERVAL_MINUTES * 60_000, heavy: true }],
};

/** Problems with the manifest; empty when it is sound. */
export function manifestProblems(): string[] {
  return validateManifest(SKILL_CONSTELLATION_MANIFEST, SKILL_EVENT_NAMESPACE);
}
