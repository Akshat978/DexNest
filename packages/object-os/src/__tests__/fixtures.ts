/** Synthetic rows for tests. Nothing real, nothing read from disk. */

import type { MaintenanceEntry, Measurement, Schedule } from '../domain/index.ts';

export const OBJ = '7K3F9QXM';
export const T0 = '2026-01-15T10:00:00.000Z';

export function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch_00000001',
    objectId: OBJ,
    title: 'Clean the nozzle',
    rule: { kind: 'time', every: 6, unit: 'months' },
    startsAt: T0,
    startReading: null,
    active: true,
    notes: '',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

let n = 0;
export function done(at: string, over: Partial<MaintenanceEntry> = {}): MaintenanceEntry {
  return {
    id: `mnt_${String(++n).padStart(8, '0')}`,
    objectId: OBJ,
    scheduleId: 'sch_00000001',
    title: 'Cleaned',
    doneAt: at,
    doneBy: '',
    cost: null,
    notes: '',
    usageReading: null,
    parts: [],
    createdAt: at,
    ...over,
  };
}

export function reading(key: string, value: number, at: string, over: Partial<Measurement> = {}): Measurement {
  return { id: `msr_${String(++n).padStart(8, '0')}`, objectId: OBJ, key, value, unit: 'h', measuredAt: at, note: '', createdAt: at, ...over };
}
