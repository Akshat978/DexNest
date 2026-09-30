/**
 * What Reality RPG brings to DexNest, declared so the host file can be written
 * and reviewed against it (docs/DEXNEST_FOUNDATION_ARCHITECTURE.md, section 5).
 * Actions, the view and the job are wired in Phases 4-6.
 */

import { validateManifest, type DexNestModuleManifest } from '@dexnest/foundation';
import { RPG_EVENT_NAMESPACE, RPG_EVENT_STREAM, RPG_EVENT_TYPES, RPG_MODULE_ID } from './domain/events.ts';
import { DEFAULT_INTERVAL_MINUTES } from './domain/settings.ts';
import { REALITY_RPG_MIGRATIONS } from './store/migrations.ts';

export const RPG_VIEW_ID = 'rpg';
export const RPG_PROCESS_JOB = 'process';

export const RPG_ACTION_IDS = {
  open: 'reality_rpg.open',
  refresh: 'reality_rpg.refresh',
  enable: 'reality_rpg.enable',
  disable: 'reality_rpg.disable',
  ruleSave: 'reality_rpg.rule.save',
  ruleSetEnabled: 'reality_rpg.rule.set_enabled',
  ruleDelete: 'reality_rpg.rule.delete',
  questCreate: 'reality_rpg.quest.create',
  questAbandon: 'reality_rpg.quest.abandon',
  achievementSave: 'reality_rpg.achievement.save',
  achievementDelete: 'reality_rpg.achievement.delete',
  backfill: 'reality_rpg.backfill',
} as const;

export const REALITY_RPG_MANIFEST: DexNestModuleManifest = {
  id: RPG_MODULE_ID,
  title: 'Reality RPG',
  tablePrefix: 'rpg_',
  migrations: REALITY_RPG_MIGRATIONS,
  eventStreams: [RPG_EVENT_STREAM],
  eventTypes: RPG_EVENT_TYPES,
  actionIds: Object.values(RPG_ACTION_IDS),
  views: [{ id: RPG_VIEW_ID, title: 'Reality RPG' }],
  // Light: it reads only new rows of the types enabled rules name.
  jobs: [{ id: RPG_PROCESS_JOB, defaultIntervalMs: DEFAULT_INTERVAL_MINUTES * 60_000, heavy: false }],
};

export function manifestProblems(): string[] {
  return validateManifest(REALITY_RPG_MANIFEST, RPG_EVENT_NAMESPACE);
}
