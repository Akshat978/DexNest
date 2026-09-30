/**
 * GhostOS as a DexNest module.
 *
 * Everything the desktop host needs behind the foundation's host ports, so
 * the host file is wiring only (modelled on Developer Intelligence's runtime).
 *
 * - Off until asked: no job and no timer exist until a source adapter is
 *   turned on. Manual entry, search, timeline and export need no job.
 * - The `sync` job is heavy and idempotent per occurrence: a slot delivered
 *   twice runs once.
 * - Every user action is validated here, writes through the store, records
 *   its `ghost.*` event in the same transaction, and writes one audit line.
 *   Events and audit lines carry ids, types and counts - never the owner's
 *   text: audit summaries are fixed strings (AUDIT_SUMMARIES).
 */

import type { EventLog, JobOccurrence, ModuleScheduler, SqlDatabase } from '@dexnest/foundation';
import { createDeveloperIntelligenceAdapter, type DiReader } from '../adapters/developer-intelligence.ts';
import { createAllowedEventReader } from '../adapters/event-reader.ts';
import type { SourceAdapter } from '../adapters/types.ts';
import { AUDIT_SUMMARIES, GHOST_EVENT_STREAM, GHOST_MODULE_ID, type RowCounts } from '../domain/events.ts';
import { eventCutoff, RETENTION } from '../domain/retention.ts';
import { parseExport, type GhostExport } from '../domain/export.ts';
import { isRowId, newRowId } from '../domain/ids.ts';
import { parseTimelineQuery, toFtsQuery } from '../domain/search.ts';
import { ADAPTER_IDS, anyAdapterEnabled, isAdapterId, type AdapterId, type GhostOsSettings } from '../domain/settings.ts';
import type { ConversationDetails, DecisionDetails, Entity, EntityType, FileDetails, Observation, Relation, RowKind, RowRef } from '../domain/types.ts';
import { ENTITY_TYPES, ROW_KINDS } from '../domain/types.ts';
import { manualProvenance, parseDecisionOutcome, parseEntityInput, parseObservationInput, parseRelationInput, withOutcome, type Parsed } from '../domain/validation.ts';
import { createGhostEngine, type GhostEngine, type SyncOutcome, type WithdrawOutcome } from '../engine/engine.ts';
import { GHOST_SYNC_JOB } from '../manifest.ts';
import { GhostStoreError, openGhostStore, type AdapterState, type GhostStore, type ImportResult, type RunRecord, type SearchHit, type TimelineItem } from '../store/store.ts';
import { appendGhostEvent, appendSyncEvents, appendWithdrawEvent } from './events.ts';

export type AuditStatus = 'success' | 'failure';
export type AuditActionId = keyof typeof AUDIT_SUMMARIES;

export interface GhostOsModuleOptions {
  database: SqlDatabase;
  /** The shared event log: written (ghost.*), and read only through the allowlisted reader. */
  events: EventLog;
  scheduler: ModuleScheduler;
  /** The host's data boundary: file references and DI repositories inside it are refused. */
  isSensitive(path: string): boolean;
  /** Developer Intelligence's stores, narrowed. Absent: the adapter is not installed. */
  developerIntelligence?: DiReader;
  /** A line in DexNest's audit log. `summary` is always a fixed string. */
  audit?(actionId: AuditActionId, summary: string, metadata: Record<string, string | number | boolean | null>, status: AuditStatus): void;
  timeZone?: string;
  now?: () => Date;
  newId?: () => string;
  /** Tests only: observe or fault event-log reads. Defaults to `events`. */
  eventReader?: Pick<EventLog, 'query'>;
  search?: 'auto' | 'off';
}

export interface EntityDetail {
  entity: Entity;
  relations: { relation: Relation; direction: 'out' | 'in'; other: { id: string; type: EntityType; title: string } | null }[];
  observations: Observation[];
  /** What a derived entity was derived from. */
  derivedFrom: RowRef[];
}

export interface GhostOsStatus {
  adapters: (AdapterState & { installed: boolean })[];
  syncing: boolean;
  lastRun: RunRecord | null;
  lastError: string | null;
  searchMode: 'fts' | 'like';
  counts: RowCounts;
}

export interface GhostOsModule {
  readonly store: GhostStore;
  readonly engine: GhostEngine;
  start(): void;
  stop(): void;
  status(): GhostOsStatus;
  getSettings(): GhostOsSettings;
  updateSettings(input: unknown): Parsed<GhostOsSettings>;

  saveEntity(input: unknown): Parsed<Entity>;
  saveRelation(input: unknown): Parsed<Relation>;
  addObservation(input: unknown): Parsed<Observation>;
  recordDecisionOutcome(input: unknown): Parsed<Entity>;
  forget(input: unknown): Parsed<{ kind: RowKind; id: string; removed: RowCounts; tombstones: number }>;

  enableAdapter(id: unknown): Parsed<AdapterState>;
  disableAdapter(id: unknown): Parsed<WithdrawOutcome>;
  syncNow(): Promise<SyncOutcome[]>;

  /** Everything, as one export. `write` (the host's file write) runs inside the same transaction as the event: if it throws, no export is recorded. */
  exportData(write?: (data: GhostExport) => void): GhostExport;
  importData(input: unknown): Parsed<ImportResult>;

  search(text: unknown, types?: unknown): Parsed<SearchHit[]>;
  timeline(query: unknown): Parsed<TimelineItem[]>;
  entityDetail(id: unknown): Parsed<EntityDetail>;
}

const fail = <T>(...errors: string[]): Parsed<T> => ({ ok: false, errors });

export function createGhostOsModule(options: GhostOsModuleOptions): GhostOsModule {
  const now = options.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const token = options.newId ?? (() => globalThis.crypto.randomUUID());
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const store = openGhostStore(options.database, { now: iso(), search: options.search });

  const adapters: SourceAdapter[] = [];
  if (options.developerIntelligence) {
    adapters.push(
      createDeveloperIntelligenceAdapter({
        reader: options.developerIntelligence,
        events: createAllowedEventReader(options.eventReader ?? options.events),
        isSensitive: (p) => options.isSensitive(p),
      }),
    );
  }
  const installed = new Set(adapters.map((a) => a.id));
  const engine = createGhostEngine({ store, adapters, now: iso, timeZone: () => timeZone, newId: () => `run_${token()}` });

  let unschedule: (() => void) | undefined;
  let syncing = 0;
  let lastError: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const audit = (actionId: AuditActionId, metadata: Record<string, string | number | boolean | null> = {}, status: AuditStatus = 'success') =>
    options.audit?.(actionId, AUDIT_SUMMARIES[actionId], metadata, status);

  /** Runs `work`; a store refusal becomes a Parsed failure instead of an exception. */
  function guarded<T>(work: () => Parsed<T>): Parsed<T> {
    try {
      return work();
    } catch (error) {
      if (error instanceof GhostStoreError) return fail(error.message);
      throw error;
    }
  }

  // --- sync -------------------------------------------------------------------

  async function syncAll(occurrence: Pick<JobOccurrence, 'occurrenceId' | 'trigger'>): Promise<SyncOutcome[]> {
    const run = async () => {
      syncing += 1;
      try {
        const outcomes: SyncOutcome[] = [];
        for (const adapter of adapters) {
          if (!store.getAdapter(adapter.id).enabled) continue;
          const outcome = await engine.sync(adapter.id, {
            occurrenceId: `${occurrence.occurrenceId}:${adapter.id}`,
            trigger: occurrence.trigger,
            withinTransaction: (o) => appendSyncEvents(options.events, o, iso()),
          });
          outcomes.push(outcome);
          if (outcome.status === 'failed') {
            lastError = outcome.reason;
            audit('ghost_os.adapter.sync', { adapterId: adapter.id, trigger: occurrence.trigger }, 'failure');
          } else if (outcome.status === 'completed') {
            lastError = null;
            if (occurrence.trigger === 'manual') audit('ghost_os.adapter.sync', { adapterId: adapter.id, trigger: occurrence.trigger, habits: outcome.habits.length });
          }
        }
        return outcomes;
      } finally {
        syncing -= 1;
      }
    };
    // One sync at a time: a manual "Sync now" waits behind a scheduled one instead of racing it.
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  function reschedule(): void {
    unschedule?.();
    unschedule = undefined;
    const settings = store.getSettings();
    if (!anyAdapterEnabled(settings)) return;
    unschedule = options.scheduler.schedule({
      id: GHOST_SYNC_JOB,
      intervalMs: settings.syncIntervalMinutes * 60_000,
      heavy: true,
      // Developer Intelligence scans at startup; GhostOS follows on its interval.
      runAtStartup: false,
      run: async (occurrence) => {
        await syncAll(occurrence);
        // Housekeeping rides on the sync job: no timer of its own.
        applyRetention();
      },
    });
  }

  /**
   * Keeps GhostOS's bookkeeping bounded: the newest RETENTION.maxRuns runs,
   * and `ghost`-stream events from ghost_os younger than RETENTION.eventDays.
   * Uses the event log's stream-scoped prune, so no other stream or module is
   * touched. The owner's entities, relations and observations are never pruned.
   * A failure here never fails the sync that ran before it.
   */
  function applyRetention(): { runs: number; events: number } {
    try {
      const runs = store.pruneRuns(RETENTION.maxRuns);
      const events = options.events.prune({ stream: GHOST_EVENT_STREAM, module: GHOST_MODULE_ID, occurredBefore: eventCutoff(iso()) });
      return { runs, events };
    } catch (error) {
      lastError = `retention: ${error instanceof Error ? error.message : String(error)}`;
      return { runs: 0, events: 0 };
    }
  }

  // --- helpers ----------------------------------------------------------------

  function refuseSensitiveFile(entity: { type: EntityType; details: unknown }): string | null {
    if (entity.type !== 'file') return null;
    return options.isSensitive((entity.details as FileDetails).path) ? "that file is inside DexNest's data; GhostOS does not refer to it" : null;
  }

  function editableManual(kind: RowKind, id: string): string | null {
    const row = kind === 'entity' ? store.getEntity(id) : kind === 'relation' ? store.getRelation(id) : store.getObservation(id);
    if (!row) return `${kind} ${id} does not exist`;
    if (row.provenance.origin !== 'manual') return `${kind} ${id} comes from ${row.provenance.sourceId}; forget it instead of editing it`;
    return null;
  }

  // --- actions ----------------------------------------------------------------

  function saveEntity(input: unknown): Parsed<Entity> {
    const at = iso();
    const parsed = parseEntityInput(input, at);
    if (!parsed.ok) return parsed;
    const draft = parsed.value;
    const sensitive = refuseSensitiveFile(draft);
    if (sensitive) return fail(sensitive);

    let existing: Entity | undefined;
    if (draft.id) {
      const refusal = editableManual('entity', draft.id);
      if (refusal) return fail(refusal);
      existing = store.getEntity(draft.id);
      if (existing && existing.type !== draft.type) return fail('an entry keeps its type; create a new one instead');
    }
    let details = draft.details;
    let occurredAt = draft.occurredAt;
    if (existing && draft.type === 'conversation') {
      // A pasted conversation keeps when it was pasted.
      const importedAt = (existing.details as ConversationDetails).importedAt;
      details = { ...(draft.details as ConversationDetails), importedAt };
      occurredAt = importedAt;
    }
    if (existing && draft.type === 'decision') {
      // The outcome is recorded by its own action; an edit of the decision keeps it.
      const prev = existing.details as DecisionDetails;
      const next = draft.details as DecisionDetails;
      details = {
        ...next,
        outcome: next.outcome ?? prev.outcome,
        outcomeAt: next.outcomeAt ?? prev.outcomeAt,
        reviewAt: next.reviewAt ?? prev.reviewAt,
      };
    }
    const entity: Entity = {
      ...draft,
      id: draft.id ?? newRowId('entity', token()),
      details,
      occurredAt,
      provenance: manualProvenance(),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    return guarded(() => {
      const status = store.transaction(() => {
        const s = store.putEntity(entity);
        if (s === 'created' || s === 'updated') {
          appendGhostEvent(options.events, 'ghost.entity.saved', { subject: entity.id, at, payload: { entityType: entity.type, origin: 'manual', created: s === 'created' } });
        }
        return s;
      });
      audit('ghost_os.entity.save', { entityId: entity.id, entityType: entity.type, created: status === 'created' });
      return { ok: true, value: store.getEntity(entity.id) as Entity };
    });
  }

  function saveRelation(input: unknown): Parsed<Relation> {
    const at = iso();
    const parsed = parseRelationInput(input);
    if (!parsed.ok) return parsed;
    const draft = parsed.value;
    let existing: Relation | undefined;
    if (draft.id) {
      const refusal = editableManual('relation', draft.id);
      if (refusal) return fail(refusal);
      existing = store.getRelation(draft.id);
    }
    const relation: Relation = { ...draft, id: draft.id ?? newRowId('relation', token()), provenance: manualProvenance(), createdAt: existing?.createdAt ?? at, updatedAt: at };
    return guarded(() => {
      const status = store.transaction(() => {
        const s = store.putRelation(relation);
        if (s === 'created' || s === 'updated') appendGhostEvent(options.events, 'ghost.relation.saved', { subject: relation.id, at, payload: { relationType: relation.type, created: s === 'created' } });
        return s;
      });
      audit('ghost_os.relation.save', { relationId: relation.id, created: status === 'created' });
      return { ok: true, value: store.getRelation(relation.id) as Relation };
    });
  }

  function addObservation(input: unknown): Parsed<Observation> {
    const at = iso();
    const parsed = parseObservationInput(input, at);
    if (!parsed.ok) return parsed;
    const d = parsed.value;
    const observation: Observation = { id: newRowId('observation', token()), entityId: d.entityId, statement: d.statement, observedAt: d.observedAt, provenance: manualProvenance(d.confidence), createdAt: at };
    return guarded(() => {
      store.transaction(() => {
        store.putObservation(observation);
        appendGhostEvent(options.events, 'ghost.observation.recorded', { subject: observation.id, at, payload: { entityId: observation.entityId } });
      });
      audit('ghost_os.observation.add', { observationId: observation.id, entityId: observation.entityId });
      return { ok: true, value: observation };
    });
  }

  function recordDecisionOutcome(input: unknown): Parsed<Entity> {
    const at = iso();
    const parsed = parseDecisionOutcome(input, at);
    if (!parsed.ok) return parsed;
    const refusal = editableManual('entity', parsed.value.id);
    if (refusal) return fail(refusal);
    const decision = store.getEntity(parsed.value.id) as Entity;
    if (decision.type !== 'decision') return fail(`${decision.id} is not a decision`);
    const details = withOutcome(decision.details as DecisionDetails, parsed.value);
    if (!details.ok) return details;
    const next: Entity = { ...decision, details: details.value, updatedAt: at };
    return guarded(() => {
      store.transaction(() => {
        store.putEntity(next);
        appendGhostEvent(options.events, 'ghost.entity.saved', { subject: next.id, at, payload: { entityType: 'decision', origin: 'manual', created: false } });
      });
      audit('ghost_os.decision.record_outcome', { entityId: next.id });
      return { ok: true, value: store.getEntity(next.id) as Entity };
    });
  }

  function forget(input: unknown): Parsed<{ kind: RowKind; id: string; removed: RowCounts; tombstones: number }> {
    const raw = typeof input === 'object' && input !== null ? (input as { kind?: unknown; id?: unknown }) : {};
    const kind = raw.kind;
    if (typeof kind !== 'string' || !(ROW_KINDS as readonly string[]).includes(kind) || !isRowId(kind as RowKind, raw.id)) return fail('forget needs { kind, id } of an entity, relation or observation');
    const ref: RowRef = { kind: kind as RowKind, id: raw.id as string };
    const at = iso();
    const plan = store.forget(ref, at, (p) => {
      if (p.rows.length === 0) return;
      appendGhostEvent(options.events, 'ghost.forgotten', { subject: ref.id, at, payload: { kind: ref.kind, removed: p.counts, tombstones: p.tombstones.length } });
    });
    if (plan.rows.length === 0) return fail(`${ref.kind} ${ref.id} does not exist`);
    audit('ghost_os.forget', { kind: ref.kind, id: ref.id, entities: plan.counts.entity, relations: plan.counts.relation, observations: plan.counts.observation });
    return { ok: true, value: { ...ref, removed: plan.counts, tombstones: plan.tombstones.length } };
  }

  function adapterArg(id: unknown): Parsed<AdapterId> {
    if (!isAdapterId(id)) return fail(`unknown source; GhostOS has: ${ADAPTER_IDS.join(', ')}`);
    if (!installed.has(id)) return fail(`${id} is not available in this DexNest`);
    return { ok: true, value: id };
  }

  function importData(input: unknown): Parsed<ImportResult> {
    const parsed = parseExport(input);
    if (!parsed.ok) {
      audit('ghost_os.import', { rows: 0 }, 'failure');
      return parsed;
    }
    // A file reference in the file is checked like one typed in.
    if (parsed.value.filePaths.some((p) => options.isSensitive(p))) {
      audit('ghost_os.import', { rows: 0 }, 'failure');
      return fail("the file refers to a path inside DexNest's data; nothing was imported");
    }
    const at = iso();
    return guarded(() => {
      const result = store.importAll(parsed.value, (r) =>
        appendGhostEvent(options.events, 'ghost.import.completed', { subject: null, at, payload: { added: r.added, skippedExisting: r.skippedExisting, derivations: r.derivations, tombstones: r.tombstones } }),
      );
      audit('ghost_os.import', { entities: result.added.entity, relations: result.added.relation, observations: result.added.observation });
      return { ok: true, value: result };
    });
  }

  function entityDetail(id: unknown): Parsed<EntityDetail> {
    if (!isRowId('entity', id)) return fail('id is invalid');
    const entity = store.getEntity(id);
    if (!entity) return fail(`entity ${id} does not exist`);
    const relations = store.relationsOf(id).map((relation) => {
      const direction: 'out' | 'in' = relation.fromId === id ? 'out' : 'in';
      const other = store.getEntity(direction === 'out' ? relation.toId : relation.fromId);
      return { relation, direction, other: other ? { id: other.id, type: other.type, title: other.title } : null };
    });
    return { ok: true, value: { entity, relations, observations: store.observationsOf(id), derivedFrom: store.derivationsOf({ kind: 'entity', id }) } };
  }

  return {
    store,
    engine,

    start() {
      store.recoverInterruptedRuns(iso());
      reschedule();
    },

    stop() {
      unschedule?.();
      unschedule = undefined;
    },

    status() {
      const [lastRun] = store.listRuns(1);
      return {
        adapters: ADAPTER_IDS.map((id) => ({ ...store.getAdapter(id), installed: installed.has(id) })),
        syncing: syncing > 0,
        lastRun: lastRun ?? null,
        lastError,
        searchMode: store.searchMode,
        counts: store.counts(),
      };
    },

    getSettings: () => store.getSettings(),

    updateSettings(input) {
      if (typeof input !== 'object' || input === null) return fail('settings must be an object');
      const interval = (input as { syncIntervalMinutes?: unknown }).syncIntervalMinutes;
      if (typeof interval !== 'number' || !Number.isFinite(interval)) return fail('syncIntervalMinutes must be a number');
      const saved = store.saveSettings({ ...store.getSettings(), syncIntervalMinutes: interval }, iso());
      reschedule();
      return { ok: true, value: saved };
    },

    saveEntity,
    saveRelation,
    addObservation,
    recordDecisionOutcome,
    forget,

    enableAdapter(id) {
      const a = adapterArg(id);
      if (!a.ok) return a;
      const state = engine.enable(a.value);
      reschedule();
      audit('ghost_os.adapter.enable', { adapterId: a.value });
      return { ok: true, value: state };
    },

    disableAdapter(id) {
      const a = adapterArg(id);
      if (!a.ok) return a;
      const outcome = engine.disable(a.value, (o) => appendWithdrawEvent(options.events, o, iso()));
      reschedule();
      audit('ghost_os.adapter.disable', { adapterId: a.value, entities: outcome.removed.entity, relations: outcome.removed.relation, observations: outcome.removed.observation });
      return { ok: true, value: outcome };
    },

    syncNow: () => syncAll({ occurrenceId: `${GHOST_SYNC_JOB}:manual:${iso()}`, trigger: 'manual' }),

    exportData(write) {
      const at = iso();
      const data = store.transaction(() => {
        const exported = store.exportAll(at);
        write?.(exported);
        appendGhostEvent(options.events, 'ghost.export.created', {
          subject: null,
          at,
          payload: { rows: { entity: exported.entities.length, relation: exported.relations.length, observation: exported.observations.length }, derivations: exported.derivations.length, tombstones: exported.tombstones.length },
        });
        return exported;
      });
      audit('ghost_os.export', { entities: data.entities.length, relations: data.relations.length, observations: data.observations.length });
      return data;
    },

    importData,

    search(text, types) {
      if (typeof text !== 'string') return fail('search text must be text');
      const list = types === undefined ? [] : types;
      if (!Array.isArray(list) || list.some((t) => !(ENTITY_TYPES as readonly unknown[]).includes(t))) return fail('types must list entity types');
      if (toFtsQuery(text) === null) return { ok: true, value: [] };
      return { ok: true, value: store.search(text, { types: list as EntityType[] }) };
    },

    timeline(query) {
      const q = parseTimelineQuery(query);
      return q.ok ? { ok: true, value: store.timeline(q.value) } : q;
    },

    entityDetail,
  };
}
