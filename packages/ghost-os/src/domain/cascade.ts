/**
 * Forget and withdraw, planned without touching the database.
 *
 * The store answers four questions through `CascadeReader`; this walks the
 * graph and returns every row to delete. The rules:
 * - deleting an entity deletes every relation touching it and every
 *   observation about it;
 * - deleting any row deletes every row derived from it (ghost_derivations),
 *   transitively - one forgotten parent is enough, "nothing it produced
 *   remains";
 * - cycles in the derivation graph end the walk, they do not loop it.
 *
 * Forget also returns tombstones for the non-manual rows it removes, so a
 * source cannot bring them back. Withdrawing an adapter does not: turning it
 * on again may re-add what it finds.
 */

import type { Origin, RowKind, RowRef } from './types.ts';

export interface CascadeRowInfo {
  origin: Origin;
  sourceId: string | null;
  sourceRef: string | null;
}

export interface CascadeReader {
  /** null when the row does not exist. */
  info(ref: RowRef): CascadeRowInfo | null;
  relationsTouching(entityId: string): string[];
  observationsOf(entityId: string): string[];
  derivedFrom(ref: RowRef): RowRef[];
}

export interface CascadePlan {
  /** Every row to delete, the roots first, each once. */
  rows: RowRef[];
  /** Non-manual rows the source may not bring back (forget only). */
  tombstones: { sourceId: string; sourceRef: string }[];
  counts: Record<RowKind, number>;
}

export const refKey = (ref: RowRef) => `${ref.kind}:${ref.id}`;

/**
 * A walk that visits this many queue entries has stopped converging: fail
 * loudly rather than loop. Far above any real graph (the walk dedupes, so a
 * healthy one visits each edge once).
 */
export const CASCADE_STEP_LIMIT = 1_000_000;

export class CascadeLimitError extends Error {
  constructor(limit: number) {
    super(`forget did not converge within ${limit} steps; nothing was removed`);
    this.name = 'CascadeLimitError';
  }
}

export function planCascade(reader: CascadeReader, roots: RowRef[], mode: 'forget' | 'withdraw', stepLimit: number = CASCADE_STEP_LIMIT): CascadePlan {
  const seen = new Set<string>();
  const rows: RowRef[] = [];
  const tombstones: CascadePlan['tombstones'] = [];
  const tombstoned = new Set<string>();
  const counts: Record<RowKind, number> = { entity: 0, relation: 0, observation: 0 };
  const queue: RowRef[] = [...roots];

  for (let i = 0; i < queue.length; i++) {
    if (i >= stepLimit) throw new CascadeLimitError(stepLimit);
    const next = queue[i] as RowRef;
    const key = refKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    const info = reader.info(next);
    if (!info) continue;
    rows.push(next);
    counts[next.kind] += 1;

    if (mode === 'forget' && info.origin !== 'manual' && info.sourceId && info.sourceRef) {
      const t = `${info.sourceId}\n${info.sourceRef}`;
      if (!tombstoned.has(t)) {
        tombstoned.add(t);
        tombstones.push({ sourceId: info.sourceId, sourceRef: info.sourceRef });
      }
    }

    if (next.kind === 'entity') {
      for (const id of reader.relationsTouching(next.id)) queue.push({ kind: 'relation', id });
      for (const id of reader.observationsOf(next.id)) queue.push({ kind: 'observation', id });
    }
    for (const child of reader.derivedFrom(next)) queue.push(child);
  }

  return { rows, tombstones, counts };
}
