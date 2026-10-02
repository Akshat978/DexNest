/**
 * ObjectOS's events in the shared log. Every append goes through here, with
 * one of the typed payloads in domain/events.ts: ids, counts and closed
 * values. None has a field that could hold the owner's text.
 */

import type { AppendEventInput, EventLog } from '@dexnest/foundation';
import { OBJECT_EVENT_STREAM, OBJECT_MODULE_ID, type ObjectEventPayloads, type ObjectEventType } from '../domain/events.ts';

export function appendObjectEvent<T extends ObjectEventType>(
  events: Pick<EventLog, 'append'>,
  type: T,
  input: { subject: string | null; payload: ObjectEventPayloads[T]; at: string; idempotencyKey?: string },
): void {
  const { payload } = input;
  const event: AppendEventInput<ObjectEventPayloads[T]> = {
    type,
    stream: OBJECT_EVENT_STREAM,
    module: OBJECT_MODULE_ID,
    subject: input.subject,
    source: OBJECT_MODULE_ID,
    occurredAt: input.at,
    recordedAt: input.at,
    schemaVersion: 1,
    idempotencyKey: input.idempotencyKey ?? null,
    payload,
  };
  events.append(event);
}
