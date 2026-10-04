/**
 * The source-adapter interface. Developer Intelligence implements it now;
 * Skill Constellation, Standup and Reality RPG can later, without changing
 * the engine.
 *
 * An adapter only reads its own source, through readers the host narrows
 * for it, and returns facts. It never writes: the engine decides what is
 * written, what is withdrawn and what stays forgotten.
 */

import type { ActivitySample } from '../domain/habits.ts';
import type { AdapterId } from '../domain/settings.ts';
import type { Entity, Observation, Relation } from '../domain/types.ts';

export interface AdapterContext {
  now: string;
  timeZone: string;
  /** Where the last sync stopped, as the adapter wrote it; null the first time. */
  cursor: string | null;
  /** Read-only views of what GhostOS holds, for merging. */
  getObservation(id: string): Observation | undefined;
  entityExists(id: string): boolean;
  /** When an entry GhostOS holds began, if it says; for keeping the earliest date seen. */
  entityStartedAt?(id: string): string | null;
}

export interface AdapterContribution {
  /** Every entity and relation the source supports now. One GhostOS holds from this source and is not listed here is withdrawn. */
  entities: Entity[];
  relations: Relation[];
  /** Observations to write, already merged with what exists. Never withdrawn by being left out. */
  observations: Observation[];
  cursor: string | null;
  /** Source records left out on purpose (e.g. inside DexNest's data), for the report. */
  skipped: number;
}

export interface SourceAdapter {
  readonly id: AdapterId;
  /** `adapter:<id>`: the provenance source of everything it contributes. */
  readonly sourceId: string;
  /** What habits from its activity are about ("commits"); null for no habits. */
  readonly habitSubject: string | null;
  collect(ctx: AdapterContext): Promise<AdapterContribution>;
  /** Activity samples for habit detection, from this adapter's own observations. */
  activity(observations: readonly Observation[]): ActivitySample[];
}
