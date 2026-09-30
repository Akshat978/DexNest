import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, dueStatus, lastCompletion, latestReading } from '../domain/index.ts';
import { done, OBJ, reading, schedule, T0 } from './fixtures.ts';

describe('time schedules', () => {
  const every6 = schedule({ startsAt: '2026-01-31T10:00:00.000Z' });

  it('before the first completion, count from the start', () => {
    const s = dueStatus(every6, [], [], '2026-03-01T00:00:00.000Z');
    expect(s).toMatchObject({ state: 'ok', kind: 'time', dueAt: '2026-07-31T10:00:00.000Z', lastDoneAt: null });
  });

  it('after a completion, count from the last one - not from the start', () => {
    const log = [done('2026-05-10T08:00:00.000Z'), done('2026-03-02T08:00:00.000Z')];
    const s = dueStatus(every6, log, [], '2026-09-01T00:00:00.000Z');
    expect(s).toMatchObject({ state: 'ok', dueAt: '2026-11-10T08:00:00.000Z', lastDoneAt: '2026-05-10T08:00:00.000Z' });
  });

  it('completions of other schedules do not count', () => {
    const s = dueStatus(every6, [done('2026-07-01T00:00:00.000Z', { scheduleId: 'sch_00000099' })], [], '2026-08-01T00:00:00.000Z');
    expect(s.state).toBe('overdue');
  });

  it(`is due soon inside ${DUE_SOON_DAYS} days and overdue from the due moment on`, () => {
    const dueAt = '2026-07-31T10:00:00.000Z';
    const at = (d: string) => dueStatus(every6, [], [], d).state;
    expect(at('2026-07-17T10:00:00.000Z')).toBe('ok'); // exactly 14 days before
    expect(at('2026-07-17T10:00:00.001Z')).toBe('due_soon');
    expect(at('2026-07-31T09:59:59.999Z')).toBe('due_soon');
    expect(at(dueAt)).toBe('overdue');
    expect(at('2027-01-01T00:00:00.000Z')).toBe('overdue');
  });

  it('handles month ends and leap days', () => {
    const leap = schedule({ startsAt: '2028-02-29T00:00:00.000Z', rule: { kind: 'time', every: 1, unit: 'years' } });
    expect(dueStatus(leap, [], [], '2028-03-01T00:00:00.000Z')).toMatchObject({ dueAt: '2029-02-28T00:00:00.000Z' });
    const monthly = schedule({ startsAt: '2026-01-31T00:00:00.000Z', rule: { kind: 'time', every: 1, unit: 'months' } });
    expect(dueStatus(monthly, [], [], '2026-02-20T00:00:00.000Z')).toMatchObject({ dueAt: '2026-02-28T00:00:00.000Z', state: 'due_soon' });
  });

  it('an inactive schedule is never due', () => {
    expect(dueStatus(schedule({ active: false }), [], [], '2099-01-01T00:00:00.000Z')).toEqual({ state: 'inactive' });
  });
});

describe('usage schedules', () => {
  const hours = schedule({ rule: { kind: 'usage', measurementKey: 'print hours', every: 200 } });

  it('without a reading nothing is known: never due', () => {
    expect(dueStatus(hours, [], [], T0)).toEqual({ state: 'no_reading', measurementKey: 'print hours' });
    expect(dueStatus(hours, [], [reading('other', 999, T0)], T0).state).toBe('no_reading');
    expect(dueStatus(hours, [], [reading('print hours', 999, T0, { objectId: 'AAAAAAAA' })], T0).state).toBe('no_reading');
  });

  it('before a completion, count from the start reading, else from the first reading', () => {
    const readings = [reading('print hours', 1000, '2026-02-01T00:00:00.000Z'), reading('print hours', 1150, '2026-03-01T00:00:00.000Z')];
    expect(dueStatus(hours, [], readings, T0)).toMatchObject({ state: 'ok', dueAtReading: 1200, latestReading: 1150, left: 50 });
    expect(dueStatus({ ...hours, startReading: 900 }, [], readings, T0)).toMatchObject({ state: 'overdue', dueAtReading: 1100, left: -50 });
  });

  it('after a completion, count from the reading recorded with it', () => {
    const readings = [reading('print hours', 1000, '2026-02-01T00:00:00.000Z'), reading('print hours', 1390, '2026-04-01T00:00:00.000Z')];
    const log = [done('2026-03-01T00:00:00.000Z', { usageReading: 1200 })];
    expect(dueStatus(hours, log, readings, T0)).toMatchObject({ state: 'due_soon', dueAtReading: 1400, left: 10 });
  });

  it('a completion logged without a reading counts from the last reading taken before it', () => {
    const readings = [reading('print hours', 1000, '2026-02-01T00:00:00.000Z'), reading('print hours', 1100, '2026-02-20T00:00:00.000Z'), reading('print hours', 1250, '2026-04-01T00:00:00.000Z')];
    const log = [done('2026-03-01T00:00:00.000Z')];
    expect(dueStatus(hours, log, readings, T0)).toMatchObject({ dueAtReading: 1300, left: 50 });
    // No reading before it at all: as if just done at the latest reading.
    const late = [reading('print hours', 1250, '2026-04-01T00:00:00.000Z')];
    expect(dueStatus(hours, log, late, T0)).toMatchObject({ dueAtReading: 1450, left: 200, state: 'ok' });
  });

  it('due soon within 10% of the interval; overdue at the interval', () => {
    const at = (value: number) => dueStatus({ ...hours, startReading: 0 }, [], [reading('print hours', value, T0)], T0).state;
    expect(at(179)).toBe('ok');
    expect(at(180)).toBe('due_soon');
    expect(at(199.5)).toBe('due_soon');
    expect(at(200)).toBe('overdue');
  });
});

describe('helpers', () => {
  it('pick the newest completion and reading, ties by id', () => {
    const a = done('2026-01-01T00:00:00.000Z', { id: 'mnt_aaaaaaaa' });
    const b = done('2026-01-01T00:00:00.000Z', { id: 'mnt_bbbbbbbb' });
    expect(lastCompletion('sch_00000001', [b, a])?.id).toBe('mnt_bbbbbbbb');
    expect(lastCompletion('sch_00000002', [a])).toBeNull();
    const r1 = reading('k', 1, T0, { id: 'msr_aaaaaaaa' });
    const r2 = reading('k', 2, T0, { id: 'msr_bbbbbbbb' });
    expect(latestReading(OBJ, 'k', [r2, r1])?.value).toBe(2);
  });
});
