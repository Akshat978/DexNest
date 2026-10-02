/**
 * Object ids: 8 characters of Crockford base32 - digits and letters without
 * I, L, O and U - shown as `7K3F-9QXM`. About 10^12 values: short enough
 * for a QR label, and a collision (retried by the store) is rare.
 *
 * Input is forgiving the Crockford way: lower case is accepted, I and L
 * read as 1, O as 0, and dashes and spaces are ignored.
 */

export const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const OBJECT_ID_LENGTH = 8;

/** A new id from random bytes (the caller supplies them: the domain has no I/O). */
export function objectIdFromBytes(bytes: ArrayLike<number>): string {
  if (bytes.length < OBJECT_ID_LENGTH) throw new Error(`objectIdFromBytes needs ${OBJECT_ID_LENGTH} bytes`);
  let id = '';
  for (let i = 0; i < OBJECT_ID_LENGTH; i++) id += ID_ALPHABET[(bytes[i] as number) & 31];
  return id;
}

/** The canonical id for anything the owner typed or scanned, or null. */
export function parseObjectId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== OBJECT_ID_LENGTH) return null;
  for (const c of cleaned) if (!ID_ALPHABET.includes(c)) return null;
  return cleaned;
}

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && value.length === OBJECT_ID_LENGTH && parseObjectId(value) === value;
}

/** `7K3F9QXM` -> `7K3F-9QXM`. */
export function formatObjectId(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

export const RECORD_KINDS = ['schedule', 'maintenance', 'modification', 'settings', 'part', 'measurement', 'file'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

const RECORD_PREFIX: Record<RecordKind, string> = {
  schedule: 'sch',
  maintenance: 'mnt',
  modification: 'mod',
  settings: 'set',
  part: 'prt',
  measurement: 'msr',
  file: 'fil',
};

const RECORD_ID = /^(sch|mnt|mod|set|prt|msr|fil)_[A-Za-z0-9-]{8,64}$/;

export function newRecordId(kind: RecordKind, token: string): string {
  const clean = token.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  if (clean.length < 8) throw new Error('newRecordId needs a token of at least 8 letters or digits');
  return `${RECORD_PREFIX[kind]}_${clean}`;
}

export function isRecordId(kind: RecordKind, value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID.test(value) && value.startsWith(`${RECORD_PREFIX[kind]}_`);
}
