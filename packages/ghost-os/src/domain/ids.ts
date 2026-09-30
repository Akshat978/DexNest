/**
 * Row ids. Manual rows get an id the runtime generates; adapter and derived
 * rows get a stable id from their source and reference, so a re-sync or a
 * re-detection lands on the same row instead of adding a copy.
 */

import { stableHash } from './hash.ts';
import type { RowKind } from './types.ts';

const PREFIX: Record<RowKind, string> = { entity: 'ent', relation: 'rel', observation: 'obs' };

const ROW_ID = /^(ent|rel|obs)_[A-Za-z0-9-]{8,64}$/;

export function isRowId(kind: RowKind, value: unknown): value is string {
  return typeof value === 'string' && ROW_ID.test(value) && value.startsWith(`${PREFIX[kind]}_`);
}

/** A fresh id from any unique token (the runtime passes a random UUID). */
export function newRowId(kind: RowKind, token: string): string {
  const clean = token.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  if (clean.length < 8) throw new Error('newRowId needs a token of at least 8 letters or digits');
  return `${PREFIX[kind]}_${clean}`;
}

/** The same source fact always maps to the same id. */
export function sourceRowId(kind: RowKind, sourceId: string, sourceRef: string): string {
  return `${PREFIX[kind]}_${stableHash(`${kind}\n${sourceId}\n${sourceRef}`)}`;
}

export const adapterSourceId = (adapterId: string) => `adapter:${adapterId}`;
export const detectorSourceId = (detectorId: string) => `detector:${detectorId}`;
