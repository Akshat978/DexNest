/**
 * Search and timeline queries, built from owner input without trusting it.
 *
 * Search uses SQLite FTS5 where it exists and LIKE where it does not
 * (PLAN.md section 8). Either way the owner's words are data, never syntax:
 * every term is a quoted FTS string (quotes doubled), and LIKE patterns
 * escape %, _ and the escape character itself.
 */

import { ENTITY_TYPES, ORIGINS, type EntityType, type Origin } from './types.ts';
import { normalizeTimestamp } from './time.ts';
import type { Parsed } from './validation.ts';

export const SEARCH_LIMITS = { maxTerms: 8, maxTermLength: 64, maxInput: 256, maxResults: 200 } as const;

/** Words of the query: letters and digits, lowercased, deduplicated, capped. */
export function searchTerms(input: string): string[] {
  const words = input
    .slice(0, SEARCH_LIMITS.maxInput)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.slice(0, SEARCH_LIMITS.maxTermLength));
  return [...new Set(words)].slice(0, SEARCH_LIMITS.maxTerms);
}

/**
 * An FTS5 MATCH expression: every term must appear, as a prefix.
 * `"term"*` - quoted, so AND/OR/NEAR/column filters in the input are words.
 * Null when there is nothing to search for.
 */
export function toFtsQuery(input: string): string | null {
  const terms = searchTerms(input);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

/** A LIKE pattern for one term, to be used with `ESCAPE '\'`. */
export function toLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface TimelineQuery {
  from: string | null;
  to: string | null;
  types: EntityType[];
  origins: Origin[];
  /** Include observations alongside entities. */
  observations: boolean;
  /** Include relations that ended, at the time they ended. */
  relations: boolean;
  limit: number;
  /** Continue after this position (the last item's time and id). */
  before: { at: string; id: string } | null;
}

export const TIMELINE_LIMITS = { defaultLimit: 50, maxLimit: 200 } as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function subset<T extends string>(v: unknown, all: readonly T[], field: string, errors: string[]): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !(all as readonly string[]).includes(x))) {
    errors.push(`${field} must list only: ${all.join(', ')}`);
    return [];
  }
  return [...new Set(v as T[])];
}

export function parseTimelineQuery(input: unknown): Parsed<TimelineQuery> {
  const errors: string[] = [];
  const q: Obj = input === undefined || input === null ? {} : isObj(input) ? input : (errors.push('query must be an object'), {});
  const stamp = (v: unknown, field: string) => {
    if (v === undefined || v === null || v === '') return null;
    const t = normalizeTimestamp(v);
    if (t === null) errors.push(`${field} must be a date and time`);
    return t;
  };
  const from = stamp(q.from, 'from');
  const to = stamp(q.to, 'to');
  if (from && to && to < from) errors.push('to is before from');
  let limit: number = TIMELINE_LIMITS.defaultLimit;
  if (q.limit !== undefined) {
    if (typeof q.limit !== 'number' || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > TIMELINE_LIMITS.maxLimit) errors.push(`limit must be 1-${TIMELINE_LIMITS.maxLimit}`);
    else limit = q.limit;
  }
  let before: TimelineQuery['before'] = null;
  if (q.before !== undefined && q.before !== null) {
    const at = isObj(q.before) ? normalizeTimestamp(q.before.at) : null;
    const id = isObj(q.before) && typeof q.before.id === 'string' && /^(ent|obs|rel)_[A-Za-z0-9-]{8,64}$/.test(q.before.id) ? q.before.id : null;
    if (!at || !id) errors.push('before must be { at, id } of a timeline item');
    else before = { at, id };
  }
  const value: TimelineQuery = {
    from,
    to,
    types: subset(q.types, ENTITY_TYPES, 'types', errors),
    origins: subset(q.origins, ORIGINS, 'origins', errors),
    observations: q.observations !== false,
    relations: q.relations !== false,
    limit,
    before,
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
