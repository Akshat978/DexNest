import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, EXPORT_VERSION, IMPORT_LIMITS, parseExport, storedFileName, zipPathOf, type ObjectExport } from '../domain/index.ts';
import { OBJ, T0 } from './fixtures.ts';

const CHILD = 'AAAAAAAA';
const SHA = 'a'.repeat(64);

function sample(): ObjectExport {
  const obj = (id: string, parentId: string | null, photoFileId: string | null = null) => ({ id, name: `Object ${id}`, category: 'printer' as const, make: 'Prusa', model: 'MK4', serial: 'SN-1', location: 'desk', status: 'active' as const, notes: '', tags: ['workshop'], parentId, photoFileId, createdAt: T0, updatedAt: T0 });
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: '2026-06-30T12:00:00.000Z',
    objects: [obj(OBJ, null, 'fil_photo001'), obj(CHILD, OBJ)],
    changes: [{ objectId: CHILD, field: 'parent', from: null, to: OBJ, at: T0 }],
    state: [{ objectId: OBJ, key: 'firmware', value: '6.1.0', updatedAt: T0 }],
    stateLog: [{ objectId: OBJ, key: 'firmware', value: '6.1.0', at: T0 }],
    schedules: [{ id: 'sch_00000001', objectId: OBJ, title: 'Nozzle', rule: { kind: 'usage', measurementKey: 'print hours', every: 200 }, startsAt: T0, startReading: 0, active: true, notes: '', createdAt: T0, updatedAt: T0 }],
    maintenance: [{ id: 'mnt_00000001', objectId: OBJ, scheduleId: 'sch_00000001', title: 'Changed nozzle', doneAt: T0, doneBy: 'me', cost: { amount: 1250, currency: 'EUR' }, notes: '', usageReading: 180, parts: [{ partId: 'prt_00000001', quantity: 1 }], createdAt: T0 }],
    modifications: [{ id: 'mod_00000001', objectId: OBJ, title: 'Silent fans', doneAt: T0, reason: 'noise', before: 'stock', after: 'Noctua', reversible: true, revertedAt: null, createdAt: T0, updatedAt: T0 }],
    settings: [{ id: 'set_00000001', objectId: OBJ, name: 'Slicer', version: 1, values: { layer: '0.2' }, note: '', createdAt: T0 }],
    parts: [{ id: 'prt_00000001', name: 'Nozzle 0.4', partNumber: 'N04', supplier: 'Shop', unit: 'pcs', quantity: 2, lowStockAt: 1, notes: '', fits: [OBJ], createdAt: T0, updatedAt: T0 }],
    stockLog: [{ partId: 'prt_00000001', delta: -1, reason: 'used', maintenanceId: 'mnt_00000001', at: T0 }],
    measurements: [{ id: 'msr_00000001', objectId: OBJ, key: 'print hours', value: 180, unit: 'h', measuredAt: T0, note: '', createdAt: T0 }],
    purchases: [{ objectId: OBJ, purchasedOn: '2025-05-01', price: { amount: 89900, currency: 'EUR' }, shop: 'Prusa', warrantyUntil: '2027-05-01', receiptFileId: 'fil_receipt1', updatedAt: T0 }],
    files: [
      { id: 'fil_photo001', objectId: OBJ, role: 'photo', name: 'front.jpg', storedName: storedFileName('fil_photo001', 'front.jpg'), sizeBytes: 2048, type: 'image/jpeg', sha256: SHA, addedAt: T0 },
      { id: 'fil_receipt1', objectId: OBJ, role: 'receipt', name: 'receipt.pdf', storedName: storedFileName('fil_receipt1', 'receipt.pdf'), sizeBytes: 4096, type: 'application/pdf', sha256: SHA, addedAt: T0 },
    ],
  };
}

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r.errors ?? []));
const roundTrip = (v: unknown) => parseExport(JSON.parse(JSON.stringify(v)));

describe('export file', () => {
  it('round-trips unchanged', () => {
    const r = roundTrip(sample());
    expect(errorsOf(r)).toEqual([]);
    expect(r.ok && r.value).toEqual(sample());
    expect(zipPathOf(sample().files[0]!)).toBe('files/7K3F9QXM/fil_photo001-front.jpg');
  });

  it('refuses other formats and versions', () => {
    expect(errorsOf(parseExport({ ...sample(), format: 'x' }))).toEqual(['the file is not an ObjectOS export']);
    expect(errorsOf(parseExport({ ...sample(), version: 2 }))[0]).toMatch(/version is not supported/);
    expect(errorsOf(parseExport({ ...sample(), objects: 'no' }))).toEqual(['objects must be a list']);
  });

  it('refuses references to anything not in the file', () => {
    const s = sample();
    expect(errorsOf(roundTrip({ ...s, objects: [s.objects[1]] })).join()).toMatch(/not in the file/);
    expect(errorsOf(roundTrip({ ...s, maintenance: [{ ...s.maintenance[0], scheduleId: 'sch_00000099' }] })).join()).toMatch(/schedule not in the file/);
    expect(errorsOf(roundTrip({ ...s, parts: [] })).join()).toMatch(/part not in the file/);
    expect(errorsOf(roundTrip({ ...s, files: [s.files[1]] })).join()).toMatch(/photo is not one of its files/);
    expect(errorsOf(roundTrip({ ...s, files: [s.files[0]] })).join()).toMatch(/receipt is not one of the object's files/);
  });

  it('refuses a file whose stored name or hash could point elsewhere', () => {
    const s = sample();
    const f = s.files[0]!;
    expect(errorsOf(roundTrip({ ...s, files: [{ ...f, storedName: '../../evil.exe' }, s.files[1]] })).join()).toMatch(/storedName does not match/);
    expect(errorsOf(roundTrip({ ...s, files: [{ ...f, name: '../x.jpg', storedName: storedFileName(f.id, '../x.jpg') }, s.files[1]] })).join()).toMatch(/name is invalid/);
    expect(errorsOf(roundTrip({ ...s, files: [{ ...f, sha256: 'nothex' }, s.files[1]] })).join()).toMatch(/sha256/);
    expect(errorsOf(roundTrip({ ...s, files: [{ ...f, sizeBytes: 300 * 1024 * 1024 }, s.files[1]] })).join()).toMatch(/sizeBytes/);
  });

  it('refuses duplicates, bad rows and duplicate settings versions - all or nothing', () => {
    const s = sample();
    expect(errorsOf(roundTrip({ ...s, objects: [...s.objects, s.objects[0]] })).join()).toMatch(/duplicate id/);
    expect(errorsOf(roundTrip({ ...s, measurements: [{ ...s.measurements[0], value: 'many' }] })).join()).toMatch(/measurements\[0\]/);
    expect(errorsOf(roundTrip({ ...s, settings: [...s.settings, { ...s.settings[0], id: 'set_00000002' }] })).join()).toMatch(/duplicate version/);
    expect(errorsOf(roundTrip({ ...s, purchases: [...s.purchases, s.purchases[0]] })).join()).toMatch(/one purchase/);
  });

  it('refuses too many rows before looking at any, and caps the error list', () => {
    expect(errorsOf(parseExport({ ...sample(), stateLog: Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, () => ({})) }))[0]).toMatch(/more than/);
    expect(errorsOf(parseExport({ ...sample(), measurements: Array.from({ length: 200 }, () => ({})) })).length).toBe(IMPORT_LIMITS.maxErrors + 1);
  });
});
