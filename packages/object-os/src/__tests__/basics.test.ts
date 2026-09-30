import { describe, expect, it } from 'vitest';
import {
  addInterval,
  daysBetween,
  diffSettings,
  formatMoney,
  formatObjectId,
  ID_ALPHABET,
  isObjectId,
  isRecordId,
  newRecordId,
  normalizeDate,
  normalizeTimestamp,
  objectIdFromBytes,
  parseMoney,
  parseObjectId,
  wouldCreateCycle,
} from '../domain/index.ts';

describe('object ids', () => {
  it('are 8 Crockford base32 characters, shown with a dash', () => {
    const id = objectIdFromBytes([0, 1, 2, 3, 29, 30, 31, 255]);
    expect(id).toBe('0123XYZZ');
    expect(formatObjectId(id)).toBe('0123-XYZZ');
    expect(ID_ALPHABET).not.toMatch(/[ILOU]/);
    expect(isObjectId(id)).toBe(true);
  });

  it('parse forgivingly: case, dashes, spaces, I/L as 1, O as 0', () => {
    expect(parseObjectId('7k3f-9qxm')).toBe('7K3F9QXM');
    expect(parseObjectId(' 7K3F 9QXM ')).toBe('7K3F9QXM');
    expect(parseObjectId('7K3F-9QXO')).toBe('7K3F9QX0');
    expect(parseObjectId('iL3F-9QXM')).toBe('113F9QXM');
    for (const bad of ['7K3F-9QX', '7K3F-9QXMM', '7K3F-9QXU', '', 42, null]) expect(parseObjectId(bad), String(bad)).toBeNull();
    expect(isObjectId('7k3f9qxm')).toBe(false); // canonical form only
  });

  it('every byte maps into the alphabet evenly', () => {
    const counts = new Map<string, number>();
    for (let b = 0; b < 256; b++) {
      const c = objectIdFromBytes([b, 0, 0, 0, 0, 0, 0, 0])[0] as string;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    expect(new Set(counts.values())).toEqual(new Set([8]));
  });

  it('record ids carry their kind', () => {
    const id = newRecordId('part', '0b6e3f0e-1c2d-4c1e-9a7a-6f1c0d2e3b4a');
    expect(isRecordId('part', id)).toBe(true);
    expect(isRecordId('schedule', id)).toBe(false);
    expect(() => newRecordId('file', 'short')).toThrow();
  });
});

describe('time', () => {
  it('normalises timestamps and real dates only', () => {
    expect(normalizeTimestamp('2026-06-01T12:00:00+02:00')).toBe('2026-06-01T10:00:00.000Z');
    expect(normalizeTimestamp('yesterday')).toBeNull();
    expect(normalizeDate('2026-02-28')).toBe('2026-02-28');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('2028-02-29')).toBe('2028-02-29');
    expect(normalizeDate('2026-2-3')).toBeNull();
  });

  it('adds months and years keeping the day, or landing on the month end', () => {
    expect(addInterval('2026-01-31T09:00:00.000Z', 1, 'months')).toBe('2026-02-28T09:00:00.000Z');
    expect(addInterval('2028-01-31T09:00:00.000Z', 1, 'months')).toBe('2028-02-29T09:00:00.000Z');
    expect(addInterval('2026-08-31T09:00:00.000Z', 6, 'months')).toBe('2027-02-28T09:00:00.000Z');
    expect(addInterval('2028-02-29T09:00:00.000Z', 1, 'years')).toBe('2029-02-28T09:00:00.000Z');
    expect(addInterval('2026-12-15T00:00:00.000Z', 1, 'months')).toBe('2027-01-15T00:00:00.000Z');
    expect(addInterval('2026-03-01T00:00:00.000Z', 2, 'weeks')).toBe('2026-03-15T00:00:00.000Z');
    expect(addInterval('2026-12-31T00:00:00.000Z', 1, 'days')).toBe('2027-01-01T00:00:00.000Z');
    expect(daysBetween('2026-01-01T00:00:00.000Z', '2026-01-03T12:00:00.000Z')).toBe(2);
    expect(daysBetween('2026-01-03T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(-2);
  });
});

describe('money', () => {
  it('keeps minor units in the currency paid', () => {
    expect(parseMoney('12.50', 'eur')).toEqual({ amount: 1250, currency: 'EUR' });
    expect(parseMoney('1,299', 'USD')).toEqual({ amount: 129900, currency: 'USD' });
    expect(parseMoney('4500', 'JPY')).toEqual({ amount: 4500, currency: 'JPY' });
    expect(parseMoney('1.5', 'JPY')).toBeNull();
    expect(parseMoney('1.234', 'EUR')).toBeNull();
    expect(parseMoney('1.234', 'KWD')).toEqual({ amount: 1234, currency: 'KWD' });
    expect(parseMoney('-3', 'EUR')).toBeNull();
    expect(parseMoney('3', 'EURO')).toBeNull();
    expect(formatMoney({ amount: 1250, currency: 'EUR' })).toBe('12.50 EUR');
    expect(formatMoney({ amount: 5, currency: 'EUR' })).toBe('0.05 EUR');
    expect(formatMoney({ amount: 4500, currency: 'JPY' })).toBe('4500 JPY');
  });
});

describe('settings diff', () => {
  it('lists added, removed and changed keys, and counts the rest', () => {
    expect(diffSettings({ a: '1', b: '2', c: '3' }, { a: '1', b: '20', d: '4' })).toEqual({
      added: [{ key: 'd', value: '4' }],
      removed: [{ key: 'c', value: '3' }],
      changed: [{ key: 'b', from: '2', to: '20' }],
      unchanged: 1,
    });
    expect(diffSettings({}, {})).toEqual({ added: [], removed: [], changed: [], unchanged: 0 });
  });

  it('is not fooled by inherited keys', () => {
    expect(diffSettings({ toString: 'x' }, {}).removed).toEqual([{ key: 'toString', value: 'x' }]);
    expect(diffSettings({}, { constructor: 'y' }).added).toEqual([{ key: 'constructor', value: 'y' }]);
  });
});

describe('components', () => {
  const tree: Record<string, string | null> = { PC: null, GPU: 'PC', FAN: 'GPU', CAR: null };
  const parentOf = (id: string) => tree[id] ?? null;

  it('refuses an object inside itself or inside one of its own components', () => {
    expect(wouldCreateCycle('PC', 'PC', parentOf)).toBe(true);
    expect(wouldCreateCycle('PC', 'FAN', parentOf)).toBe(true);
    expect(wouldCreateCycle('GPU', 'FAN', parentOf)).toBe(true);
  });

  it('allows moves elsewhere and detaching', () => {
    expect(wouldCreateCycle('FAN', 'CAR', parentOf)).toBe(false);
    expect(wouldCreateCycle('GPU', null, parentOf)).toBe(false);
    expect(wouldCreateCycle('CAR', 'FAN', parentOf)).toBe(false);
  });

  it('stops on a corrupted tree and on absurd depth', () => {
    const loop: Record<string, string> = { A: 'B', B: 'A' };
    expect(wouldCreateCycle('X', 'A', (id) => loop[id] ?? null)).toBe(true);
    const deep = (id: string) => (Number(id) < 100 ? String(Number(id) + 1) : null);
    expect(wouldCreateCycle('X', '0', deep)).toBe(true);
  });
});
