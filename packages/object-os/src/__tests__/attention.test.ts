import { describe, expect, it } from 'vitest';
import { attention, isLowStock, localDay, reminderText, warrantyState, type Part, type Purchase } from '../domain/index.ts';
import { OBJ, schedule, T0 } from './fixtures.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const purchase = (until: string | null, objectId = OBJ): Purchase => ({ objectId, purchasedOn: '2025-01-01', price: { amount: 10000, currency: 'EUR' }, shop: 'Shop', warrantyUntil: until, receiptFileId: null, updatedAt: T0 });
const part = (quantity: number, lowStockAt: number | null, id = 'prt_00000001'): Part => ({ id, name: 'Nozzle', partNumber: 'N1', supplier: 'S', unit: 'pcs', quantity, lowStockAt, notes: '', fits: [OBJ], createdAt: T0, updatedAt: T0 });

describe('warranty', () => {
  it('is ending within 30 days, the last day included, and expired after', () => {
    expect(warrantyState(null, NOW)).toEqual({ state: 'none', daysLeft: null });
    expect(warrantyState('2026-07-31', NOW)).toEqual({ state: 'active', daysLeft: 31 });
    expect(warrantyState('2026-07-30', NOW)).toEqual({ state: 'ending', daysLeft: 30 });
    expect(warrantyState('2026-06-30', NOW)).toEqual({ state: 'ending', daysLeft: 0 });
    expect(warrantyState('2026-06-29', NOW)).toEqual({ state: 'expired', daysLeft: -1 });
  });
});

describe('stock', () => {
  it('is low at or below the threshold; no threshold never is', () => {
    expect(isLowStock({ quantity: 2, lowStockAt: 2 })).toBe(true);
    expect(isLowStock({ quantity: 3, lowStockAt: 2 })).toBe(false);
    expect(isLowStock({ quantity: 0, lowStockAt: null })).toBe(false);
  });
});

describe('needs attention', () => {
  const objects = [{ id: OBJ, status: 'active' as const }, { id: 'SOLD0000', status: 'sold' as const }];

  it('collects overdue and due-soon maintenance, warranties ending or just ended, and low stock - overdue first', () => {
    const s = attention({
      objects,
      schedules: [
        schedule({ id: 'sch_00000001', startsAt: '2025-01-01T00:00:00.000Z' }), // long overdue
        schedule({ id: 'sch_00000002', startsAt: '2026-01-05T00:00:00.000Z' }), // due 2026-07-05: soon
        schedule({ id: 'sch_00000003', startsAt: '2026-06-01T00:00:00.000Z' }), // fine
      ],
      log: [],
      readings: [],
      purchases: [purchase('2026-07-10'), purchase('2026-06-20', 'AAAAAAAA'), purchase('2025-01-01', 'BBBBBBBB')],
      parts: [part(1, 2), part(5, 2, 'prt_00000002')],
      now: NOW,
    });
    expect(s.counts).toEqual({ overdue: 1, dueSoon: 1, warrantyEnding: 1, lowStock: 1 });
    expect(s.items.map((i) => i.kind)).toEqual(['maintenance', 'warranty', 'maintenance', 'stock']);
  });

  it('leaves out objects that were sold or disposed', () => {
    const s = attention({ objects, schedules: [schedule({ objectId: 'SOLD0000', startsAt: '2020-01-01T00:00:00.000Z' })], log: [], readings: [], purchases: [purchase('2026-07-01', 'SOLD0000')], parts: [], now: NOW });
    expect(s.items).toEqual([]);
  });

  it('carries ids and states only - nothing an owner typed', () => {
    const s = attention({ objects, schedules: [schedule({ title: 'SECRET title', startsAt: '2020-01-01T00:00:00.000Z' })], log: [], readings: [], purchases: [{ ...purchase('2026-07-01'), shop: 'SECRET shop' }], parts: [{ ...part(0, 1), name: 'SECRET part', notes: 'SECRET' }], now: NOW });
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });

  it('turns into a counts-only reminder, or nothing', () => {
    expect(reminderText({ overdue: 2, dueSoon: 1, warrantyEnding: 0, lowStock: 1 })).toBe('2 maintenance tasks overdue, 1 maintenance task due soon, 1 part low on stock');
    expect(reminderText({ overdue: 0, dueSoon: 0, warrantyEnding: 0, lowStock: 0 })).toBeNull();
  });
});

describe('the owner\'s day', () => {
  // Ten at night on 30 June in Saskatchewan (UTC-6) is already 1 July in UTC.
  const LATE = '2026-07-01T04:00:00.000Z';

  it('is the calendar day where the owner is, not the UTC day', () => {
    expect(localDay(LATE, 'America/Regina')).toBe('2026-06-30');
    expect(localDay(LATE, 'UTC')).toBe('2026-07-01');
    expect(localDay('2026-06-30T13:00:00.000Z', 'Pacific/Auckland')).toBe('2026-07-01');
    expect(localDay('2026-06-30T19:00:00.000Z', 'Asia/Kolkata')).toBe('2026-07-01');
    expect(localDay('not a time', 'UTC')).toBeNull();
  });

  it('counts the days left on a warranty from that day', () => {
    // Without a day, the UTC one is used, as before.
    expect(warrantyState('2026-07-01', LATE)).toEqual({ state: 'ending', daysLeft: 0 });
    // For the owner it is still the 30th: a day is left.
    expect(warrantyState('2026-07-01', LATE, '2026-06-30')).toEqual({ state: 'ending', daysLeft: 1 });
    // A warranty whose last day is today has not expired tonight.
    expect(warrantyState('2026-06-30', LATE)).toEqual({ state: 'expired', daysLeft: -1 });
    expect(warrantyState('2026-06-30', LATE, '2026-06-30')).toEqual({ state: 'ending', daysLeft: 0 });
  });

  it('is what "needs attention" counts from', () => {
    const input = { objects: [{ id: OBJ, status: 'active' as const }], schedules: [], log: [], readings: [], purchases: [purchase('2026-07-30')], parts: [], now: LATE };
    // 29 days in UTC, 30 for the owner: ending either way, with the owner's count.
    expect(attention(input).items).toEqual([{ kind: 'warranty', objectId: OBJ, state: 'ending', daysLeft: 29 }]);
    expect(attention({ ...input, today: '2026-06-30' }).items).toEqual([{ kind: 'warranty', objectId: OBJ, state: 'ending', daysLeft: 30 }]);
    // 31 days out for the owner is not yet "ending", though UTC would say it is.
    const edge = { ...input, purchases: [purchase('2026-07-31')] };
    expect(attention(edge).items).toHaveLength(1);
    expect(attention({ ...edge, today: '2026-06-30' }).items).toEqual([]);
  });
});
