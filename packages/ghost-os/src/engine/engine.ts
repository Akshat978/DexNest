/**
 * The GhostOS engine: adapter sync, withdrawal, and habit detection.
 *
 * A sync is claimed per occurrence (ghost_runs.occurrence_id is unique), so
 * the same scheduled slot fired twice does the work once. The adapter reads
 * outside any transaction; everything it leads to - entities, relations,
 * observations, withdrawals, habits, the cursor and the run record - is
 * written in ONE transaction, together with whatever the caller adds (its
 * events). A failure writes none of it and records the run as failed.
 */

import type { SourceAdapter } from '../adapters/types.ts';
import type { RowCounts } from '../domain/events.ts';
import { detectHabits, habitSourceRef, type DetectedHabit } from '../domain/habits.ts';
import { detectorSourceId, sourceRowId } from '../domain/ids.ts';
import { HABIT_DETECTORS, HABIT_LOOKBACK_DAYS } from '../domain/habits.ts';
import type { AdapterId } from '../domain/settings.ts';
import type { Entity, RowRef } from '../domain/types.ts';
import { LIMITS } from '../domain/validation.ts';
import type { AdapterState, GhostStore, PutStatus, RunTrigger } from '../store/store.ts';

export interface HabitOutcome {
  id: string;
  detectorId: string;
  periodKey: string;
  confidence: number;
  evidenceCount: number;
  status: PutStatus;
}

export interface SyncOutcome {
  status: 'completed' | 'skipped' | 'failed';
  reason: string | null;
  adapterId: AdapterId;
  occurrenceId: string;
  runId: string | null;
  added: RowCounts;
  updated: RowCounts;
  withdrawn: RowCounts;
  skippedForgotten: number;
  skippedSource: number;
  habits: HabitOutcome[];
  /** Detected habits that no longer hold and were removed. */
  habitsLapsed: number;
}

export interface WithdrawOutcome {
  adapterId: AdapterId;
  removed: RowCounts;
}

export interface GhostEngineOptions {
  store: GhostStore;
  adapters: readonly SourceAdapter[];
  now: () => string;
  timeZone: () => string;
  newId: () => string;
}

export interface SyncRequest {
  occurrenceId: string;
  trigger: RunTrigger;
  /** More writes that must commit with the sync (its events). Throwing rolls the sync back. */
  withinTransaction?: (outcome: SyncOutcome) => void;
}

export interface GhostEngine {
  sync(adapterId: AdapterId, request: SyncRequest): Promise<SyncOutcome>;
  enable(adapterId: AdapterId): AdapterState;
  /** Turns the adapter off and removes everything it contributed, and everything derived from that. */
  disable(adapterId: AdapterId, withinTransaction?: (outcome: WithdrawOutcome) => void): WithdrawOutcome;
}

const zero = (): RowCounts => ({ entity: 0, relation: 0, observation: 0 });
const addCounts = (a: RowCounts, b: RowCounts) => {
  a.entity += b.entity;
  a.relation += b.relation;
  a.observation += b.observation;
};

export function createGhostEngine(options: GhostEngineOptions): GhostEngine {
  const { store } = options;
  const adapters = new Map(options.adapters.map((a) => [a.id, a]));

  const adapterFor = (id: AdapterId) => {
    const a = adapters.get(id);
    if (!a) throw new Error(`No adapter ${id} is installed`);
    return a;
  };

  function habitEntity(h: DetectedHabit, now: string): Entity {
    const sourceId = detectorSourceId(h.detectorId);
    const sourceRef = habitSourceRef(h);
    return {
      id: sourceRowId('entity', sourceId, sourceRef),
      type: 'habit',
      title: h.title,
      notes: '',
      tags: [],
      details: { cadence: h.cadence, mode: 'detected', detectorId: h.detectorId, parameters: h.parameters },
      occurredAt: null,
      startedAt: null,
      endedAt: null,
      provenance: {
        origin: 'derived',
        sourceId,
        sourceRef,
        evidence: h.derivedFrom.slice(0, LIMITS.evidence).map((observationId) => ({ kind: 'observation', observationId })),
        confidence: h.confidence,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Detect habits from this adapter's observations; update what holds, remove what lapsed. */
  function runHabits(adapter: SourceAdapter, now: string, outcome: SyncOutcome) {
    if (!adapter.habitSubject) return;
    // Detectors look back at most HABIT_LOOKBACK_DAYS: older observations cannot change what they find.
    const since = new Date(Date.parse(now) - HABIT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const samples = adapter.activity(store.observationsFromSource(adapter.sourceId, since));
    const found = detectHabits(samples, { now, timeZone: options.timeZone(), subject: adapter.habitSubject });
    const foundIds = new Set<string>();
    for (const h of found) {
      const entity = habitEntity(h, now);
      foundIds.add(entity.id);
      const status = store.putEntity(entity, { derivedFrom: h.derivedFrom.map((id): RowRef => ({ kind: 'observation', id })) });
      outcome.habits.push({ id: entity.id, detectorId: h.detectorId, periodKey: h.periodKey, confidence: h.confidence, evidenceCount: h.derivedFrom.length, status });
    }
    const lapsed: RowRef[] = [];
    for (const detectorId of HABIT_DETECTORS) {
      const id = store.findBySource('entity', detectorSourceId(detectorId), habitSourceRef({ detectorId, subject: adapter.habitSubject }));
      if (id && !foundIds.has(id)) lapsed.push({ kind: 'entity', id });
    }
    if (lapsed.length) outcome.habitsLapsed = store.removeRows(lapsed).counts.entity;
  }

  async function sync(adapterId: AdapterId, request: SyncRequest): Promise<SyncOutcome> {
    const adapter = adapterFor(adapterId);
    const outcome: SyncOutcome = {
      status: 'skipped',
      reason: null,
      adapterId,
      occurrenceId: request.occurrenceId,
      runId: null,
      added: zero(),
      updated: zero(),
      withdrawn: zero(),
      skippedForgotten: 0,
      skippedSource: 0,
      habits: [],
      habitsLapsed: 0,
    };
    if (!store.getAdapter(adapterId).enabled) return { ...outcome, reason: 'adapter is off' };

    const startedAt = options.now();
    const run = store.claimRun({ id: options.newId(), occurrenceId: request.occurrenceId, kind: 'sync', trigger: request.trigger, now: startedAt });
    if (!run) return { ...outcome, reason: 'this occurrence already ran' };
    outcome.runId = run.id;

    try {
      const contribution = await adapter.collect({
        now: startedAt,
        timeZone: options.timeZone(),
        cursor: store.getAdapter(adapterId).cursor,
        getObservation: (id) => store.getObservation(id),
        entityExists: (id) => store.getEntity(id) !== undefined,
      });

      return store.transaction(() => {
        // Turned off while it was reading: write nothing.
        if (!store.getAdapter(adapterId).enabled) {
          store.finishRun(run.id, 'skipped', options.now(), { reason: 'adapter turned off during sync' });
          return { ...outcome, reason: 'adapter turned off during sync' };
        }
        const now = options.now();
        const count = (kind: keyof RowCounts, status: PutStatus) => {
          if (status === 'created') outcome.added[kind] += 1;
          else if (status === 'updated') outcome.updated[kind] += 1;
          else if (status === 'forgotten') outcome.skippedForgotten += 1;
        };
        const exists = (id: string) => store.getEntity(id) !== undefined;

        const heldEntities = new Set(store.sourceRowIds('entity', adapter.sourceId));
        const heldRelations = new Set(store.sourceRowIds('relation', adapter.sourceId));
        for (const e of contribution.entities) {
          heldEntities.delete(e.id);
          count('entity', store.putEntity(e));
        }
        for (const r of contribution.relations) {
          heldRelations.delete(r.id);
          // An end the owner forgot stays forgotten; so does the relation.
          if (!exists(r.fromId) || !exists(r.toId)) outcome.skippedForgotten += 1;
          else count('relation', store.putRelation(r));
        }
        // What the source no longer supports goes, with what depended on it. No tombstones: it may come back.
        const gone: RowRef[] = [...[...heldRelations].map((id): RowRef => ({ kind: 'relation', id })), ...[...heldEntities].map((id): RowRef => ({ kind: 'entity', id }))];
        if (gone.length) addCounts(outcome.withdrawn, store.removeRows(gone).counts);

        for (const o of contribution.observations) {
          if (!exists(o.entityId)) outcome.skippedForgotten += 1;
          else count('observation', store.putObservation(o));
        }
        outcome.skippedSource = contribution.skipped;

        runHabits(adapter, now, outcome);

        const totals = { entity: store.sourceRowIds('entity', adapter.sourceId).length, relation: store.sourceRowIds('relation', adapter.sourceId).length, observation: store.sourceRowIds('observation', adapter.sourceId).length };
        store.recordAdapterSync(adapterId, contribution.cursor, totals, now);
        const done: SyncOutcome = { ...outcome, status: 'completed' };
        store.finishRun(run.id, 'completed', now, {
          added: done.added,
          updated: done.updated,
          withdrawn: done.withdrawn,
          skippedForgotten: done.skippedForgotten,
          skippedSource: done.skippedSource,
          habits: done.habits.length,
          habitsLapsed: done.habitsLapsed,
        });
        request.withinTransaction?.(done);
        return done;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.finishRun(run.id, 'failed', options.now(), {}, message.slice(0, 500));
      return { ...outcome, status: 'failed', reason: message.slice(0, 500) };
    }
  }

  return {
    sync,
    enable(adapterId) {
      adapterFor(adapterId);
      return store.setAdapterEnabled(adapterId, true, options.now());
    },
    disable(adapterId, withinTransaction) {
      const adapter = adapterFor(adapterId);
      return store.transaction(() => {
        const plan = store.withdrawSource(adapter.sourceId);
        store.resetAdapter(adapterId, options.now());
        const outcome: WithdrawOutcome = { adapterId, removed: plan.counts };
        withinTransaction?.(outcome);
        return outcome;
      });
    },
  };
}
