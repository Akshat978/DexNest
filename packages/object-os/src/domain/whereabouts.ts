/**
 * Where an object is, for finding it again: the room and the thing it is in,
 * who has it when it is lent, whether it is missing, and when its place was
 * last set. One row per object, kept beside the object record so "where is
 * my passport" is answered by the same record that holds its warranty.
 *
 * An object's `location` stays on the object ("black drawer"); these are the
 * finer facts around it.
 */

import { parseObjectId } from './ids.ts';
import { normalizeTimestamp } from './time.ts';
import type { ObjectRecord } from './types.ts';
import type { Parsed } from './validation.ts';

export interface Whereabouts {
  objectId: string;
  room: string;
  /** The drawer, box or shelf it is in. */
  container: string;
  /** Who has it. Empty unless the object's status is lent_out. */
  lentTo: string;
  /** When it was lent: not moved by later edits, so a loan from March still reads as March. */
  lentAt: string | null;
  /** Looked for and not found. */
  missing: boolean;
  /** When its place was last set or confirmed. */
  locatedAt: string | null;
}

export interface LocatedObject extends ObjectRecord {
  whereabouts: Whereabouts;
}

export const WHEREABOUTS_LIMITS = { room: 80, container: 120, lentTo: 120, query: 200 } as const;

export const emptyWhereabouts = (objectId: string): Whereabouts => ({ objectId, room: '', container: '', lentTo: '', lentAt: null, missing: false, locatedAt: null });

/** "Bedroom · black drawer", "with Alex", "missing": where to look, in a few words. */
export function whereText(object: Pick<ObjectRecord, 'location' | 'status'>, w: Pick<Whereabouts, 'room' | 'container' | 'lentTo' | 'missing'>): string {
  if (w.missing) return 'missing';
  if (object.status === 'lent_out') return w.lentTo ? `with ${w.lentTo}` : 'lent out';
  const parts = [w.room, object.location, w.container].map((p) => p.trim()).filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.length ? unique.join(' · ') : 'no place recorded';
}

/**
 * One change to where an object is. Every field is optional: what is left
 * out stays as it was.
 * - `location`, `room`, `container`: it moved (and is no longer missing).
 * - `lentTo`: lent to someone (status becomes lent_out, the date is kept).
 * - `returned`: it came back (status active, the borrower cleared).
 * - `missing`: marked missing, or found again.
 */
export interface LocateInput {
  objectId: string;
  location?: string;
  room?: string;
  container?: string;
  lentTo?: string;
  lentAt?: string;
  returned?: boolean;
  missing?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function line(v: unknown, field: string, max: number, errors: string[]): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    errors.push(`${field} must be text`);
    return undefined;
  }
  const clean = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (clean.length > max) errors.push(`${field} is longer than ${max} characters`);
  return clean;
}

export function parseLocateInput(input: unknown): Parsed<LocateInput> {
  if (!isObj(input)) return { ok: false, errors: ['locate must be an object'] };
  const errors: string[] = [];
  const objectId = parseObjectId(input.objectId) ?? '';
  if (!objectId) errors.push('objectId is not an object id');
  const value: LocateInput = { objectId };
  const location = line(input.location, 'location', 120, errors);
  const room = line(input.room, 'room', WHEREABOUTS_LIMITS.room, errors);
  const container = line(input.container, 'container', WHEREABOUTS_LIMITS.container, errors);
  const lentTo = line(input.lentTo, 'lentTo', WHEREABOUTS_LIMITS.lentTo, errors);
  if (location !== undefined) value.location = location;
  if (room !== undefined) value.room = room;
  if (container !== undefined) value.container = container;
  if (lentTo !== undefined) {
    if (!lentTo) errors.push('lentTo needs a name');
    value.lentTo = lentTo;
  }
  if (input.lentAt !== undefined && input.lentAt !== null) {
    const at = normalizeTimestamp(input.lentAt);
    if (!at) errors.push('lentAt is not a time');
    else value.lentAt = at;
  }
  if (input.returned === true) value.returned = true;
  if (typeof input.missing === 'boolean') value.missing = input.missing;
  if (value.returned && value.lentTo) errors.push('an object cannot be lent and returned in one change');
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** A search or reverse-lookup phrase: trimmed, clipped, never empty. */
export function parseQuery(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, WHEREABOUTS_LIMITS.query);
  return clean || null;
}
