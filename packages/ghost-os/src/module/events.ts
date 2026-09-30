/**
 * GhostOS's events in the shared log. Every append goes through here, and
 * every payload is one of the typed shapes in domain/events.ts: ids, types,
 * counts and dates. None has a field that could carry the owner's text.
 */

import type { AppendEventInput, EventLog } from '@dexnest/foundation';
import { GHOST_EVENT_STREAM, GHOST_MODULE_ID, habitKey, syncKey, type GhostEventPayloads, type GhostEventType } from '../domain/events.ts';
import type { SyncOutcome, WithdrawOutcome } from '../engine/engine.ts';

export function appendGhostEvent<T extends GhostEventType>(
  events: Pick<EventLog, 'append'>,
  type: T,
  input: { subject: string | null; payload: GhostEventPayloads[T]; at: string; idempotencyKey?: string; sourceIdentity?: string },
): void {
  const { payload } = input;
  const event: AppendEventInput<GhostEventPayloads[T]> = {
    type,
    stream: GHOST_EVENT_STREAM,
    module: GHOST_MODULE_ID,
    subject: input.subject,
    source: GHOST_MODULE_ID,
    sourceIdentity: input.sourceIdentity ?? null,
    occurredAt: input.at,
    recordedAt: input.at,
    schemaVersion: 1,
    idempotencyKey: input.idempotencyKey ?? null,
    payload,
  };
  events.append(event);
}

const changed = (o: SyncOutcome) =>
  [o.added, o.updated, o.withdrawn].some((c) => c.entity + c.relation + c.observation > 0) || o.habitsLapsed > 0;

/** A sync's events: one per occurrence when anything changed, one per habit per detection period. */
export function appendSyncEvents(events: Pick<EventLog, 'append'>, outcome: SyncOutcome, at: string): void {
  if (changed(outcome)) {
    appendGhostEvent(events, 'ghost.adapter.synced', {
      subject: outcome.adapterId,
      at,
      idempotencyKey: syncKey(outcome.occurrenceId),
      sourceIdentity: outcome.occurrenceId,
      payload: {
        adapterId: outcome.adapterId,
        occurrenceId: outcome.occurrenceId,
        added: outcome.added,
        updated: outcome.updated,
        withdrawn: outcome.withdrawn,
        skippedForgotten: outcome.skippedForgotten,
      },
    });
  }
  for (const h of outcome.habits) {
    if (h.status === 'forgotten') continue;
    appendGhostEvent(events, 'ghost.habit.detected', {
      subject: h.id,
      at,
      idempotencyKey: habitKey(h.id, h.periodKey),
      payload: { detectorId: h.detectorId, periodKey: h.periodKey, confidence: h.confidence, evidenceCount: h.evidenceCount },
    });
  }
}

export function appendWithdrawEvent(events: Pick<EventLog, 'append'>, outcome: WithdrawOutcome, at: string): void {
  appendGhostEvent(events, 'ghost.adapter.withdrawn', { subject: outcome.adapterId, at, payload: { adapterId: outcome.adapterId, removed: outcome.removed } });
}
