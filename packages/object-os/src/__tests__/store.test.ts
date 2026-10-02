import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import {
  createObjectReadApi,
  manifestProblems,
  openObjectStore,
  parseExport,
  parseMaintenanceInput,
  parseMeasurementInput,
  parseModificationInput,
  parseObjectInput,
  parsePartInput,
  parsePurchaseInput,
  parseScheduleInput,
  parseSettingsInput,
  PUBLIC_OBJECT_FIELDS,
  storedFileName,
  type FileRecord,
  type ObjectStore,
  type Parsed,
} from '../index.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const LATER = '2026-07-01T12:00:00.000Z';
const PC = 'PC000000';
const GPU = 'GPX00000';
const FAN = 'FAN00000';
const PRN = 'PRN00000';

const dbs: TestDatabase[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.dispose();
});

function fresh() {
  const t = createTestDatabase('obj-store-');
  dbs.push(t);
  return { t, store: openObjectStore(t.db, { now: NOW }) };
}

function ok<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
}

const obj = (input: Record<string, unknown>) => ok(parseObjectInput(input));
const file = (objectId: string, id: string, role: FileRecord['role'] = 'manual', name = 'manual.pdf'): FileRecord => ({ id, objectId, role, name, storedName: storedFileName(id, name), sizeBytes: 1000, type: 'application/pdf', sha256: 'b'.repeat(64), addedAt: NOW });

/** A PC with a GPU (which has a fan), and a printer with state, maintenance, parts, settings, readings, purchase and files. */
function world(store: ObjectStore) {
  store.createObject(PC, obj({ name: 'Desktop PC', category: 'computer', serial: 'PC-SN-1', location: 'Desk', tags: ['office'] }), NOW);
  store.createObject(GPU, obj({ name: 'RTX GPU', category: 'computer', parentId: PC }), NOW);
  store.createObject(FAN, obj({ name: 'GPU fan', category: 'other', parentId: GPU }), NOW);
  store.createObject(PRN, obj({ name: 'Prusa MK4', category: 'printer', make: 'Prusa', serial: 'SN-PRUSA-42', location: 'garage' }), NOW);
  store.setState(PRN, 'filament', 'PLA white', NOW);
  store.saveSchedule('sch_nozzle01', ok(parseScheduleInput({ objectId: PRN, title: 'Nozzle', rule: { kind: 'usage', measurementKey: 'print hours', every: 200 }, startReading: 0 }, NOW)), NOW);
  store.savePart('prt_nozzle01', ok(parsePartInput({ name: 'Nozzle 0.4', quantity: 3, lowStockAt: 1, fits: [PRN] })), NOW);
  store.addMeasurement('msr_hours001', ok(parseMeasurementInput({ objectId: PRN, key: 'print hours', value: 150, unit: 'h' }, NOW)), NOW);
  store.logMaintenance('mnt_nozzle01', ok(parseMaintenanceInput({ objectId: PRN, scheduleId: 'sch_nozzle01', title: 'Changed nozzle', usageReading: 150, parts: [{ partId: 'prt_nozzle01', quantity: 1 }], cost: { amount: '4.99', currency: 'EUR' } }, NOW)), NOW);
  store.saveModification('mod_fans0001', ok(parseModificationInput({ objectId: PRN, title: 'Quiet fans', reversible: true }, NOW)), NOW);
  store.saveSnapshot('set_slicer01', ok(parseSettingsInput({ objectId: PRN, name: 'Slicer', values: { layer: '0.2' } })), NOW);
  store.savePurchase(ok(parsePurchaseInput({ objectId: PRN, purchasedOn: '2025-06-01', price: { amount: '899', currency: 'EUR' }, shop: 'Prusa', warrantyUntil: '2026-07-15' })), NOW);
  store.addFile(file(PRN, 'fil_manual01'));
  store.addFile(file(PRN, 'fil_photo001', 'photo', 'front.jpg'));
  store.addFile(file(PRN, 'fil_receipt1', 'receipt', 'receipt.pdf'));
  store.setPhoto(PRN, 'fil_photo001', NOW);
  store.setReceipt(PRN, 'fil_receipt1', NOW);
}

const countFor = (t: TestDatabase, table: string, objectId: string) => Number(t.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE object_id = ?`).get<{ n: number }>([objectId])?.n);

describe('migrations and manifest', () => {
  it('the manifest validates', () => {
    expect(manifestProblems()).toEqual([]);
  });

  it('everything survives closing and reopening', () => {
    const { t, store } = fresh();
    world(store);
    const before = store.exportRows('all', NOW);
    t.close();
    const t2 = t.reopen();
    dbs.push(t2);
    const again = openObjectStore(t2.db, { now: NOW });
    expect(again.exportRows('all', NOW)).toEqual(before);
    expect(t2.db.prepare("SELECT version FROM dexnest_module_migrations WHERE module = 'object_os' ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }]);
  });
});

describe('objects and components', () => {
  it('lists, searches and filters', () => {
    const { store } = fresh();
    world(store);
    expect(store.listObjects().map((o) => o.name)).toEqual(['Desktop PC', 'GPU fan', 'Prusa MK4', 'RTX GPU']);
    expect(store.listObjects({ search: 'prusa' }).map((o) => o.id)).toEqual([PRN]);
    expect(store.listObjects({ search: 'office' }).map((o) => o.id)).toEqual([PC]); // tag
    expect(store.listObjects({ search: 'sn-prusa' }).map((o) => o.id)).toEqual([PRN]); // serial, searched locally
    expect(store.listObjects({ search: 'prn0-0000' }).map((o) => o.id)).toEqual([PRN]); // id as printed
    expect(store.listObjects({ search: '100%' })).toEqual([]);
    expect(store.listObjects({ category: 'computer' }).map((o) => o.id).sort()).toEqual([GPU, PC].sort());
    expect(store.listObjects({ location: 'GARAGE' }).map((o) => o.id)).toEqual([PRN]);
    expect(store.listObjects({ parentId: null }).map((o) => o.id).sort()).toEqual([PC, PRN].sort());
    expect(store.components(PC).map((o) => o.id)).toEqual([GPU]);
    expect(store.locations()).toEqual(['Desk', 'garage']);
  });

  it('records status, location and parent changes as history', () => {
    const { store } = fresh();
    world(store);
    store.setStatus(PRN, 'lent_out', LATER);
    store.updateObject(PRN, obj({ ...store.getObject(PRN), status: 'lent_out', location: 'friend' }), LATER);
    store.moveObject(FAN, PC, LATER);
    expect(store.changes(PRN).map((c) => [c.field, c.from, c.to])).toEqual([
      ['status', 'active', 'lent_out'],
      ['location', 'garage', 'friend'],
    ]);
    expect(store.changes(FAN).map((c) => [c.field, c.from, c.to])).toEqual([['parent', GPU, PC]]);
  });

  it('refuses a component inside itself or its own components, and parents that do not exist', () => {
    const { store } = fresh();
    world(store);
    expect(() => store.moveObject(PC, FAN, LATER)).toThrow(/inside itself/);
    expect(() => store.moveObject(GPU, GPU, LATER)).toThrow(/inside itself/);
    expect(() => store.moveObject(GPU, 'NOPE0000', LATER)).toThrow(/does not exist/);
    expect(() => store.createObject(PC, obj({ name: 'dup' }), NOW)).toThrow(/already exists/);
    expect(store.getObject(PC)?.parentId).toBeNull();
  });

  it('deleting an object removes its own rows and files, and detaches its components - never deletes them', () => {
    const { t, store } = fresh();
    world(store);
    store.setState(GPU, 'driver', '555.1', NOW);
    const out = store.deleteObject(GPU, LATER);
    expect(out.childrenDetached).toEqual([FAN]);
    expect(store.getObject(GPU)).toBeUndefined();
    expect(store.getObject(FAN)?.parentId).toBeNull();
    expect(store.changes(FAN).map((c) => [c.field, c.from, c.to])).toEqual([['parent', GPU, null]]);
    expect(store.getObject(PC)).toBeDefined();
    expect(countFor(t, 'obj_state', GPU)).toBe(0);

    const printer = store.deleteObject(PRN, LATER);
    expect(printer.files.map((f) => f.id).sort()).toEqual(['fil_manual01', 'fil_photo001', 'fil_receipt1']);
    for (const table of ['obj_state', 'obj_state_log', 'obj_schedules', 'obj_maintenance', 'obj_modifications', 'obj_settings', 'obj_measurements', 'obj_purchase', 'obj_files', 'obj_changes', 'obj_tags', 'obj_part_fits']) {
      expect(countFor(t, table, PRN), table).toBe(0);
    }
    // The part stays (it may fit other things); it just no longer fits this.
    expect(store.getPart('prt_nozzle01')?.fits).toEqual([]);
  });
});

describe('records', () => {
  it('state keeps its history; an empty value removes the fact', () => {
    const { store } = fresh();
    world(store);
    store.setState(PRN, 'filament', 'PETG black', LATER);
    expect(store.stateOf(PRN)).toEqual([{ objectId: PRN, key: 'filament', value: 'PETG black', updatedAt: LATER }]);
    expect(store.setState(PRN, 'filament', '', LATER)).toEqual({ removed: true });
    expect(store.stateOf(PRN)).toEqual([]);
    expect(store.timeline(PRN).filter((i) => i.kind === 'state').map((i) => i.detail)).toEqual(['', 'PETG black', 'PLA white']);
  });

  it('maintenance takes its parts from stock in the same transaction; not enough stock writes nothing', () => {
    const { store } = fresh();
    world(store);
    expect(store.getPart('prt_nozzle01')?.quantity).toBe(2);
    expect(store.stockLog('prt_nozzle01').map((s) => [s.delta, s.reason])).toEqual([
      [3, 'restocked'],
      [-1, 'used'],
    ]);
    const tooMany = ok(parseMaintenanceInput({ objectId: PRN, title: 'x', parts: [{ partId: 'prt_nozzle01', quantity: 5 }] }, NOW));
    expect(() => store.logMaintenance('mnt_toomany1', tooMany, NOW)).toThrow(/not enough in stock/);
    expect(store.maintenance(PRN).map((m) => m.id)).toEqual(['mnt_nozzle01']);
    expect(store.getPart('prt_nozzle01')?.quantity).toBe(2);
    expect(store.maintenance(PRN)[0]).toMatchObject({ cost: { amount: 499, currency: 'EUR' }, parts: [{ partId: 'prt_nozzle01', quantity: 1 }] });
  });

  it('a schedule and its log belong to one object', () => {
    const { store } = fresh();
    world(store);
    const entry = ok(parseMaintenanceInput({ objectId: PC, scheduleId: 'sch_nozzle01', title: 'x' }, NOW));
    expect(() => store.logMaintenance('mnt_wrong001', entry, NOW)).toThrow(/not one of this object/);
  });

  it('settings get a new version only when the values change', () => {
    const { store } = fresh();
    world(store);
    expect(store.saveSnapshot('set_slicer02', ok(parseSettingsInput({ objectId: PRN, name: 'Slicer', values: { layer: '0.2' } })), LATER).created).toBe(false);
    const v2 = store.saveSnapshot('set_slicer03', ok(parseSettingsInput({ objectId: PRN, name: 'Slicer', values: { layer: '0.15', speed: '120' } })), LATER);
    expect(v2).toMatchObject({ created: true, snapshot: { version: 2 } });
    expect(store.snapshots(PRN).map((s) => s.version)).toEqual([2, 1]);
  });

  it('parts: edits to quantity go through the stock log; stock never goes negative', () => {
    const { store } = fresh();
    world(store);
    store.savePart('prt_nozzle01', ok(parsePartInput({ name: 'Nozzle 0.4 brass', quantity: 5, lowStockAt: 1, fits: [PRN, PC] })), LATER);
    expect(store.getPart('prt_nozzle01')).toMatchObject({ name: 'Nozzle 0.4 brass', quantity: 5, fits: [PC, PRN].sort() });
    expect(store.stockLog('prt_nozzle01').at(-1)).toMatchObject({ delta: 3, reason: 'corrected' });
    expect(() => store.adjustStock({ partId: 'prt_nozzle01', delta: -6, reason: 'used' }, LATER)).toThrow(/not enough/);
    expect(store.adjustStock({ partId: 'prt_nozzle01', delta: -5, reason: 'used' }, LATER).quantity).toBe(0);
    expect(store.parts(PC).map((p) => p.id)).toEqual(['prt_nozzle01']);
    expect(() => store.savePart('prt_x0000001', ok(parsePartInput({ name: 'x', fits: ['NOPE0000'] })), NOW)).toThrow(/does not exist/);
  });

  it('a measurement key keeps one unit', () => {
    const { store } = fresh();
    world(store);
    expect(() => store.addMeasurement('msr_hours002', ok(parseMeasurementInput({ objectId: PRN, key: 'print hours', value: 160, unit: 'min' }, NOW)), NOW)).toThrow(/recorded in "h"/);
    store.addMeasurement('msr_hours002', ok(parseMeasurementInput({ objectId: PRN, key: 'print hours', value: 160, unit: 'h' }, NOW)), LATER);
    expect(store.measurements(PRN, 'print hours').map((m) => m.value)).toEqual([150, 160]);
  });

  it('purchase keeps its receipt when edited; removing a file clears it as photo or receipt', () => {
    const { store } = fresh();
    world(store);
    store.savePurchase(ok(parsePurchaseInput({ objectId: PRN, shop: 'Prusa store', warrantyUntil: '2027-06-01' })), LATER);
    expect(store.purchaseOf(PRN)).toMatchObject({ shop: 'Prusa store', receiptFileId: 'fil_receipt1', price: null });
    store.removeFile('fil_receipt1');
    store.removeFile('fil_photo001');
    expect(store.purchaseOf(PRN)?.receiptFileId).toBeNull();
    expect(store.getObject(PRN)?.photoFileId).toBeNull();
    expect(() => store.setPhoto(PRN, 'fil_notmine1', NOW)).toThrow(/not one of this object/);
    store.addFile(file(PC, 'fil_pcphoto1', 'photo', 'pc.jpg'));
    expect(() => store.setPhoto(PRN, 'fil_pcphoto1', NOW)).toThrow(/not one of this object/);
  });

  it('deleting records: a schedule keeps its log; a part leaves maintenance history', () => {
    const { store } = fresh();
    world(store);
    expect(store.deleteRecord('schedule', 'sch_nozzle01')).toEqual({ objectId: PRN });
    expect(store.maintenance(PRN)[0]?.scheduleId).toBeNull();
    expect(store.deleteRecord('part', 'prt_nozzle01')).toEqual({ objectId: null });
    expect(store.maintenance(PRN)[0]?.parts).toEqual([]);
    expect(store.deleteRecord('measurement', 'msr_missing1')).toBeUndefined();
  });
});

describe('history', () => {
  it('one timeline per object, newest first, paged without gaps', () => {
    const { store } = fresh();
    world(store);
    store.setStatus(PRN, 'broken', LATER);
    const items = store.timeline(PRN);
    expect(items[0]).toMatchObject({ kind: 'change', title: 'status', detail: 'active → broken', at: LATER });
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['created', 'change', 'state', 'schedule', 'maintenance', 'modification', 'settings', 'measurement', 'file', 'purchase']));
    const seen: string[] = [];
    let before: { at: string; refId: string } | null = null;
    for (;;) {
      const page = store.timeline(PRN, { limit: 3, before });
      if (!page.length) break;
      seen.push(...page.map((i) => `${i.kind}:${i.refId}`));
      const last = page[page.length - 1]!;
      before = { at: last.at, refId: last.refId };
    }
    expect(seen.length).toBe(items.length);
    expect(new Set(seen).size).toBe(items.length);
    // A component keeps its own history.
    expect(store.timeline(GPU).map((i) => i.kind)).toEqual(['created']);
  });
});

describe('attention and the read API', () => {
  it('computes needs-attention from stored rows', () => {
    const { store } = fresh();
    world(store);
    store.addMeasurement('msr_hours003', ok(parseMeasurementInput({ objectId: PRN, key: 'print hours', value: 340, unit: 'h' }, NOW)), NOW);
    store.adjustStock({ partId: 'prt_nozzle01', delta: -1, reason: 'used' }, NOW);
    const a = store.attention(NOW);
    expect(a.counts).toEqual({ overdue: 0, dueSoon: 1, warrantyEnding: 1, lowStock: 1 });
  });

  it('the read API gives other modules public fields only', () => {
    const { store } = fresh();
    world(store);
    const api = createObjectReadApi(store);
    const all = api.listObjects();
    expect(all).toHaveLength(4);
    for (const o of all) expect(Object.keys(o).sort()).toEqual([...PUBLIC_OBJECT_FIELDS].sort());
    const text = JSON.stringify([all, api.getObject(PRN), api.components(PC), api.attention(NOW)]);
    for (const secret of ['SN-PRUSA-42', 'PC-SN-1', 'fil_', '899', 'Prusa store']) expect(text, secret).not.toContain(secret);
  });
});

describe('export and import', () => {
  const parsed = (store: ObjectStore, ids: string[] | 'all') => {
    const r = parseExport(JSON.parse(JSON.stringify(store.exportRows(ids, NOW))));
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  };

  it('round-trips everything into an empty ObjectOS', () => {
    const { store } = fresh();
    world(store);
    const data = parsed(store, 'all');
    const { store: target } = fresh();
    const plan = target.importRows(data);
    expect(plan.objects.sort()).toEqual([FAN, GPU, PC, PRN].sort());
    expect(plan.files.map((f) => f.id).sort()).toEqual(['fil_manual01', 'fil_photo001', 'fil_receipt1']);
    expect(target.exportRows('all', NOW)).toEqual(store.exportRows('all', NOW));
  });

  it('exports one object with only its own rows and fits', () => {
    const { store } = fresh();
    world(store);
    store.savePart('prt_nozzle01', ok(parsePartInput({ name: 'Nozzle 0.4', quantity: 2, lowStockAt: 1, fits: [PRN, PC] })), NOW);
    const data = parsed(store, [GPU]);
    expect(data.objects.map((o) => [o.id, o.parentId])).toEqual([[GPU, null]]);
    expect(data.parts).toEqual([]);
    const printer = parsed(store, [PRN]);
    expect(printer.parts[0]?.fits).toEqual([PRN]);
  });

  it('merges: objects already here are skipped with everything they bring', () => {
    const { store } = fresh();
    world(store);
    const data = parsed(store, 'all');
    const plan = store.importRows(data);
    expect(plan.objects).toEqual([]);
    expect(plan.skipped.sort()).toEqual([FAN, GPU, PC, PRN].sort());
    expect(plan.files).toEqual([]);
    expect(store.maintenance(PRN)).toHaveLength(1);
  });

  it('is all or nothing', () => {
    const { store } = fresh();
    world(store);
    const data = parsed(store, 'all');
    const { store: target } = fresh();
    expect(() =>
      target.importRows(data, () => {
        throw new Error('disk full');
      }),
    ).toThrow('disk full');
    expect(target.listObjects()).toEqual([]);
  });
});

describe('runs and settings', () => {
  it('an occurrence is claimed once; interrupted runs are closed', () => {
    const { store } = fresh();
    expect(store.claimRun({ id: 'run-1', occurrenceId: 'reminders:2026-06-30', kind: 'reminders', trigger: 'scheduled', now: NOW })?.status).toBe('running');
    expect(store.claimRun({ id: 'run-2', occurrenceId: 'reminders:2026-06-30', kind: 'reminders', trigger: 'scheduled', now: NOW })).toBeNull();
    expect(store.recoverInterruptedRuns(LATER)).toBe(1);
    expect(store.getRunByOccurrence('reminders:2026-06-30')).toMatchObject({ status: 'failed', error: 'interrupted' });
  });

  it('reminders are off until turned on, and that survives a restart', () => {
    const { t, store } = fresh();
    expect(store.getModuleSettings().reminders.enabled).toBe(false);
    store.saveModuleSettings({ schemaVersion: 1, reminders: { enabled: true } }, NOW);
    t.close();
    const t2 = t.reopen();
    dbs.push(t2);
    expect(openObjectStore(t2.db, { now: NOW }).getModuleSettings().reminders.enabled).toBe(true);
  });
});
