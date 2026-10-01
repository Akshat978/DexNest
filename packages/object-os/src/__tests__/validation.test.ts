import { describe, expect, it } from 'vitest';
import {
  applyStock,
  parseMaintenanceInput,
  parseMeasurementInput,
  parseModificationInput,
  parseObjectInput,
  parsePartInput,
  parsePurchaseInput,
  parseScheduleInput,
  parseSettingsInput,
  parseStateInput,
  parseStatus,
  parseStockAdjustment,
  unitConflict,
} from '../domain/index.ts';
import { OBJ, T0 } from './fixtures.ts';

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []));

describe('objects', () => {
  it('parse with defaults and a forgiving id', () => {
    const r = parseObjectInput({ name: ' Prusa MK4 ', category: 'printer', make: 'Prusa', tags: ['Workshop', 'workshop'], parentId: '7k3f-9qxm' });
    expect(r.ok && r.value).toMatchObject({ id: null, name: 'Prusa MK4', category: 'printer', status: 'active', tags: ['workshop'], parentId: OBJ, serial: '' });
  });

  it('refuse a missing name, unknown category or status, multi-line fields, and being inside itself', () => {
    expect(errorsOf(parseObjectInput({ name: '' }))).toContain('name is required');
    expect(errorsOf(parseObjectInput({ name: 'x', category: 'boat' })).join()).toMatch(/category/);
    expect(errorsOf(parseObjectInput({ name: 'x', status: 'lost' })).join()).toMatch(/status/);
    expect(errorsOf(parseObjectInput({ name: 'a\nb' }))).toContain('name must be one line');
    expect(errorsOf(parseObjectInput({ id: OBJ, name: 'x', parentId: OBJ }))).toContain('an object cannot be inside itself');
    expect(errorsOf(parseObjectInput({ name: 'x', serial: 'S'.repeat(81) })).join()).toMatch(/serial is longer/);
    expect(parseStatus('lent_out')).toEqual({ ok: true, value: 'lent_out' });
    expect(parseStatus(undefined).ok).toBe(false);
  });
});

describe('state', () => {
  it('is one-line key and value; an empty value means remove', () => {
    expect(parseStateInput({ objectId: OBJ, key: 'firmware', value: '2.3.1' })).toEqual({ ok: true, value: { objectId: OBJ, key: 'firmware', value: '2.3.1' } });
    expect(parseStateInput({ objectId: OBJ, key: 'firmware', value: '' }).ok).toBe(true);
    expect(parseStateInput({ objectId: OBJ, key: '', value: 'x' }).ok).toBe(false);
    expect(parseStateInput({ objectId: 'nope', key: 'k', value: 'x' }).ok).toBe(false);
  });
});

describe('maintenance', () => {
  it('schedules by time or by a usage counter', () => {
    expect(parseScheduleInput({ objectId: OBJ, title: 'Oil', rule: { kind: 'time', every: 6, unit: 'months' } }, T0)).toMatchObject({ ok: true, value: { startsAt: T0, active: true, startReading: null } });
    expect(parseScheduleInput({ objectId: OBJ, title: 'Nozzle', rule: { kind: 'usage', measurementKey: 'print hours', every: 200 }, startReading: '1000' }, T0)).toMatchObject({ ok: true, value: { startReading: 1000 } });
    expect(errorsOf(parseScheduleInput({ objectId: OBJ, title: 'x', rule: { kind: 'time', every: 1.5, unit: 'months' } }, T0)).join()).toMatch(/whole number/);
    expect(errorsOf(parseScheduleInput({ objectId: OBJ, title: 'x', rule: { kind: 'time', every: 0, unit: 'months' } }, T0)).join()).toMatch(/every/);
    expect(errorsOf(parseScheduleInput({ objectId: OBJ, title: 'x', rule: { kind: 'usage', every: 10 } }, T0)).join()).toMatch(/measurementKey/);
    expect(errorsOf(parseScheduleInput({ objectId: OBJ, title: 'x', rule: { kind: 'magic' } }, T0)).join()).toMatch(/time or usage/);
  });

  it('log entries with parts, cost, and no future dates', () => {
    const r = parseMaintenanceInput({ objectId: OBJ, title: 'Changed nozzle', cost: { amount: '12.50', currency: 'eur' }, parts: [{ partId: 'prt_00000001', quantity: 1 }] }, T0);
    expect(r.ok && r.value).toMatchObject({ doneAt: T0, cost: { amount: 1250, currency: 'EUR' }, parts: [{ partId: 'prt_00000001', quantity: 1 }] });
    expect(errorsOf(parseMaintenanceInput({ objectId: OBJ, title: 'x', doneAt: '2099-01-01T00:00:00Z' }, T0))).toContain('doneAt is in the future');
    expect(errorsOf(parseMaintenanceInput({ objectId: OBJ, title: 'x', parts: [{ partId: 'prt_00000001', quantity: 1 }, { partId: 'prt_00000001', quantity: 2 }] }, T0))).toContain('parts: a part is listed twice');
    expect(errorsOf(parseMaintenanceInput({ objectId: OBJ, title: 'x', parts: [{ partId: 'prt_00000001', quantity: 0 }] }, T0)).join()).toMatch(/quantity/);
    expect(errorsOf(parseMaintenanceInput({ objectId: OBJ, title: 'x', cost: { amount: 'lots', currency: 'EUR' } }, T0)).join()).toMatch(/cost/);
  });
});

describe('modifications and settings', () => {
  it('only a reversible modification can be reverted, and not before it was made', () => {
    expect(parseModificationInput({ objectId: OBJ, title: 'Silent fans', reversible: true, revertedAt: '2026-01-10T00:00:00Z', doneAt: '2026-01-01T00:00:00Z' }, T0).ok).toBe(true);
    expect(errorsOf(parseModificationInput({ objectId: OBJ, title: 'Silent fans', reversible: true, revertedAt: '2026-02-01T00:00:00Z', doneAt: '2026-01-01T00:00:00Z' }, T0))).toContain('revertedAt is in the future');
    expect(errorsOf(parseModificationInput({ objectId: OBJ, title: 'x', revertedAt: '2026-01-01T00:00:00Z', doneAt: '2025-12-01T00:00:00Z' }, T0))).toContain('only a reversible modification can be reverted');
    expect(errorsOf(parseModificationInput({ objectId: OBJ, title: 'x', reversible: true, doneAt: '2026-01-10T00:00:00Z', revertedAt: '2026-01-01T00:00:00Z' }, T0))).toContain('revertedAt is before doneAt');
  });

  it('settings values become sorted text; dangerous keys are refused', () => {
    const r = parseSettingsInput({ objectId: OBJ, name: 'Slicer profile', values: { speed: 120, retract: true, layer: '0.2' } });
    expect(r.ok && r.value.values).toEqual({ layer: '0.2', retract: 'true', speed: '120' });
    expect(r.ok && Object.keys(r.value.values)).toEqual(['layer', 'retract', 'speed']);
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": "x", "ok": "1"}') as unknown;
    const h = parseSettingsInput({ objectId: OBJ, name: 'x', values: hostile });
    expect(h.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parseSettingsInput({ objectId: OBJ, name: 'x', values: { nested: { a: 1 } } }).ok).toBe(false);
  });
});

describe('parts', () => {
  it('parse with fits as object ids, and stock never goes below zero', () => {
    const r = parsePartInput({ name: 'Nozzle 0.4', quantity: 3, lowStockAt: 1, fits: ['7k3f-9qxm', OBJ] });
    expect(r.ok && r.value).toMatchObject({ unit: 'pcs', quantity: 3, lowStockAt: 1, fits: [OBJ] });
    expect(parsePartInput({ name: 'x', quantity: -1 }).ok).toBe(false);
    expect(parsePartInput({ name: 'x', fits: ['nope'] }).ok).toBe(false);
    expect(applyStock(3, -1)).toEqual({ ok: true, value: 2 });
    expect(applyStock(0.3, -0.1)).toEqual({ ok: true, value: 0.2 });
    expect(applyStock(1, -2)).toEqual({ ok: false, errors: ['not enough in stock'] });
    expect(parseStockAdjustment({ partId: 'prt_00000001', delta: 0 }).ok).toBe(false);
    expect(parseStockAdjustment({ partId: 'prt_00000001', delta: 5, reason: 'restocked' })).toEqual({ ok: true, value: { partId: 'prt_00000001', delta: 5, reason: 'restocked' } });
  });
});

describe('measurements and purchase', () => {
  it('measurements are numbers with a unit; a key keeps its unit', () => {
    expect(parseMeasurementInput({ objectId: OBJ, key: 'tyre pressure', value: '2.4', unit: 'bar' }, T0)).toMatchObject({ ok: true, value: { value: 2.4, measuredAt: T0 } });
    expect(parseMeasurementInput({ objectId: OBJ, key: 'x', value: 'high' }, T0).ok).toBe(false);
    expect(unitConflict('bar', 'psi')).toMatch(/bar/);
    expect(unitConflict(null, 'psi')).toBeNull();
    expect(unitConflict('bar', 'bar')).toBeNull();
  });

  it('purchase dates are real dates; the warranty cannot end before the purchase', () => {
    expect(parsePurchaseInput({ objectId: OBJ, purchasedOn: '2025-05-01', price: { amount: '899', currency: 'EUR' }, warrantyUntil: '2027-05-01' })).toMatchObject({ ok: true, value: { price: { amount: 89900, currency: 'EUR' } } });
    expect(parsePurchaseInput({ objectId: OBJ, purchasedOn: '2025-02-30' }).ok).toBe(false);
    expect(errorsOf(parsePurchaseInput({ objectId: OBJ, purchasedOn: '2025-05-01', warrantyUntil: '2025-04-01' }))).toContain('warrantyUntil is before purchasedOn');
  });
});
