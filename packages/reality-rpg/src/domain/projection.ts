/**
 * The one place an event's payload is touched.
 *
 * Everything the game knows about an event comes through `projectEvent`. It
 * keeps an allow-listed envelope and, for legacy audit rows, three named
 * payload fields (`module`, `actionId`, `status`) - short identifiers, never
 * free text. `summary`, `metadataJson`, `errorMessage`, commit subjects, paths
 * and every other field are not copied.
 *
 * Events from denied modules and the game's own events are dropped here, so
 * nothing downstream can see them even by mistake.
 */

import { isDeniedModule, isDeniedName, isSelfFeeding } from './privacy.ts';
import type { ObservedEvent, RawEvent } from './types.ts';

export type Projection =
  | { kept: true; event: ObservedEvent }
  | { kept: false; reason: 'denied' | 'self' | 'malformed' };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;

/** A payload field, only if it is a short identifier. Text never passes. */
function identifier(payload: unknown, field: 'module' | 'actionId' | 'status'): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : null;
}

export function projectEvent(raw: RawEvent): Projection {
  if (typeof raw.id !== 'string' || raw.id.length === 0 || !Number.isFinite(raw.seq) || typeof raw.type !== 'string') {
    return { kept: false, reason: 'malformed' };
  }
  if (isSelfFeeding(raw.stream, raw.type)) return { kept: false, reason: 'self' };

  // Legacy audit rows carry their module and action inside the payload.
  const module = raw.module ?? identifier(raw.payload, 'module');
  const actionId = raw.module === null ? identifier(raw.payload, 'actionId') : null;
  const status = raw.module === null ? identifier(raw.payload, 'status') : null;

  if (isDeniedModule(module) || isDeniedName(module) || isDeniedName(actionId) || isDeniedName(raw.type)) {
    return { kept: false, reason: 'denied' };
  }

  return {
    kept: true,
    event: {
      id: raw.id,
      seq: raw.seq,
      type: raw.type,
      stream: raw.stream,
      module,
      actionId,
      status,
      occurredAt: raw.occurredAt,
    },
  };
}
