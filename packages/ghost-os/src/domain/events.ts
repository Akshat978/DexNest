/**
 * GhostOS events: stream "ghost", module "ghost_os". PLAN.md section 11.
 *
 * Payloads carry ids, types and counts. Never a title, note, tag, path,
 * statement or any other text the owner wrote - the payload types below
 * have no field that could hold it.
 */

import type { EntityType, Origin, RowKind } from './types.ts';

export const GHOST_MODULE_ID = 'ghost_os';
export const GHOST_EVENT_STREAM = 'ghost';
export const GHOST_EVENT_NAMESPACE = 'ghost';

export const GHOST_EVENT_TYPES = [
  'ghost.entity.saved',
  'ghost.relation.saved',
  'ghost.observation.recorded',
  'ghost.forgotten',
  'ghost.adapter.synced',
  'ghost.adapter.withdrawn',
  'ghost.habit.detected',
  'ghost.export.created',
  'ghost.import.completed',
] as const;
export type GhostEventType = (typeof GHOST_EVENT_TYPES)[number];

export type RowCounts = Record<RowKind, number>;

export interface EntitySavedPayload { entityType: EntityType; origin: Origin; created: boolean }
export interface RelationSavedPayload { relationType: string; created: boolean }
export interface ObservationRecordedPayload { entityId: string }
export interface ForgottenPayload { kind: RowKind; removed: RowCounts; tombstones: number }
export interface AdapterSyncedPayload { adapterId: string; occurrenceId: string; added: RowCounts; updated: RowCounts; withdrawn: RowCounts; ended: number; skippedForgotten: number }
export interface AdapterWithdrawnPayload { adapterId: string; removed: RowCounts }
export interface HabitDetectedPayload { detectorId: string; periodKey: string; confidence: number; evidenceCount: number }
export interface ExportCreatedPayload { rows: RowCounts; derivations: number; tombstones: number }
export interface ImportCompletedPayload { added: RowCounts; skippedExisting: RowCounts; derivations: number; tombstones: number }

export interface GhostEventPayloads {
  'ghost.entity.saved': EntitySavedPayload;
  'ghost.relation.saved': RelationSavedPayload;
  'ghost.observation.recorded': ObservationRecordedPayload;
  'ghost.forgotten': ForgottenPayload;
  'ghost.adapter.synced': AdapterSyncedPayload;
  'ghost.adapter.withdrawn': AdapterWithdrawnPayload;
  'ghost.habit.detected': HabitDetectedPayload;
  'ghost.export.created': ExportCreatedPayload;
  'ghost.import.completed': ImportCompletedPayload;
}

export const syncKey = (occurrenceId: string) => `${GHOST_MODULE_ID}:sync:${occurrenceId}`;
export const habitKey = (habitId: string, periodKey: string) => `${GHOST_MODULE_ID}:habit:${habitId}:${periodKey}`;

/** Audit summaries are fixed strings per action: they never interpolate owner text. */
export const AUDIT_SUMMARIES = {
  'ghost_os.entity.save': 'GhostOS entity saved',
  'ghost_os.relation.save': 'GhostOS relation saved',
  'ghost_os.observation.add': 'GhostOS observation recorded',
  'ghost_os.decision.record_outcome': 'GhostOS decision outcome recorded',
  'ghost_os.forget': 'GhostOS forgot a record',
  'ghost_os.adapter.enable': 'GhostOS adapter turned on',
  'ghost_os.adapter.disable': 'GhostOS adapter turned off',
  'ghost_os.adapter.sync': 'GhostOS adapter synced',
  'ghost_os.export': 'GhostOS export written',
  'ghost_os.import': 'GhostOS import applied',
} as const;
