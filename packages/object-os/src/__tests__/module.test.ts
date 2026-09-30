import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog, runFoundationMigrations, type EventLog, type ScheduledJob } from '@dexnest/foundation';
import { assertSafeTestPath, createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { seededActions } from '@dexnest/action-registry';
import { AUDIT_SUMMARIES, createObjectOsModule, OBJECT_ACTION_IDS, OBJECT_EVENT_TYPES, OBJECT_OS_MANIFEST, type ObjectOsModule, type Parsed } from '../index.ts';
import { createTestPort, memoryArchive, type TestPort } from './node-port.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const MARK = 'OWNER-TEXT-6b2a';

interface Harness {
  handle: TestDatabase;
  log: EventLog;
  module: ObjectOsModule;
  port: TestPort;
  jobs: Map<string, ScheduledJob>;
  audits: { actionId: string; summary: string; metadata: Record<string, unknown>; status: string }[];
  notes: { title: string; body: string }[];
  home: string;
  types(): string[];
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0)) f();
});

let n = 0;
let seed = 0;

function harness(): Harness {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'obj-module-')));
  const dataRoot = join(base, 'dexnest-data');
  const home = join(base, 'home');
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  const handle = createTestDatabase('obj-module-db-');
  cleanups.push(() => {
    handle.dispose();
    rmSync(base, { recursive: true, force: true });
  });
  runFoundationMigrations(handle.db);
  const log = createEventLog(handle.db);
  const jobs = new Map<string, ScheduledJob>();
  const audits: Harness['audits'] = [];
  const notes: Harness['notes'] = [];
  const port = createTestPort(dataRoot);
  const module = createObjectOsModule({
    database: handle.db,
    events: log,
    scheduler: {
      schedule(job) {
        jobs.set(job.id, job);
        return () => jobs.delete(job.id);
      },
      async runNow() {},
    },
    files: port,
    // As the host does it: an audit line is an event in the shared log.
    audit(actionId, summary, metadata, status) {
      audits.push({ actionId, summary, metadata, status });
      log.append({ type: 'action_executed', stream: 'audit', module: 'object_os', source: 'module_ui', payload: { actionId, summary, status, metadata } });
    },
    notify: (title, body) => notes.push({ title, body }),
    now: () => new Date(NOW),
    newToken: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    randomBytes: (len) => {
      seed += 1;
      return Array.from({ length: len }, (_, i) => Math.floor(seed / 32 ** (len - 1 - i)) % 32);
    },
  });
  return { handle, log, module, port, jobs, audits, notes, home, types: () => log.query({ stream: 'object' }).map((e) => e.type) };
}

function ok<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
}

describe('registration', () => {
  it('the manifest names exactly the registered object_os actions; handlers are their own ids or the view', () => {
    const registered = seededActions.filter((a) => a.moduleId === 'object_os');
    expect(registered.map((a) => a.id).sort()).toEqual(Object.values(OBJECT_ACTION_IDS).sort());
    expect(OBJECT_OS_MANIFEST.actionIds).toEqual(Object.values(OBJECT_ACTION_IDS));
    for (const a of registered) expect(a.handlerRef).toBe(a.id === OBJECT_ACTION_IDS.open ? 'desktop.view.object' : a.id);
  });

  it('only the deleting actions are caution, with a confirmation; nothing is phone- or Deck-exposed', () => {
    const registered = seededActions.filter((a) => a.moduleId === 'object_os');
    expect(registered.filter((a) => a.dangerLevel !== 'safe').map((a) => a.id).sort()).toEqual([OBJECT_ACTION_IDS.fileRemove, OBJECT_ACTION_IDS.objectDelete, OBJECT_ACTION_IDS.recordDelete].sort());
    for (const a of registered.filter((x) => x.dangerLevel !== 'safe')) expect(a.requiresConfirmation && a.confirmationRule).toBeTruthy();
    for (const a of registered) expect(a.allowedTriggers).not.toContain('deck');
  });

  it('every action but open has a fixed audit summary', () => {
    expect(Object.keys(AUDIT_SUMMARIES).sort()).toEqual(Object.values(OBJECT_ACTION_IDS).filter((id) => id !== OBJECT_ACTION_IDS.open).sort());
  });
});

describe('reminders', () => {
  it('are off by default: starting schedules nothing', () => {
    const h = harness();
    h.module.start();
    expect([...h.jobs.keys()]).toEqual([]);
  });

  it('turning them on schedules one light daily job; off removes it', () => {
    const h = harness();
    h.module.start();
    h.module.enableReminders();
    expect(h.jobs.get('reminders')).toMatchObject({ heavy: false, intervalMs: 24 * 60 * 60 * 1000, runAtStartup: true });
    h.module.disableReminders();
    expect(h.jobs.size).toBe(0);
  });

  it('a slot delivered twice runs once: one event, one notification, counts only', async () => {
    const h = harness();
    const o = ok(h.module.saveObject({ name: `${MARK} printer`, category: 'printer' }));
    ok(h.module.savePurchase({ objectId: o.id, shop: MARK, warrantyUntil: '2026-07-10' }));
    h.module.start();
    h.module.enableReminders();
    const job = h.jobs.get('reminders') as ScheduledJob;
    const slot = { occurrenceId: 'reminders:2026-06-30', scheduledAt: NOW, trigger: 'scheduled' as const };
    await job.run(slot);
    await job.run(slot);
    await job.run({ ...slot, trigger: 'startup' });
    expect(h.types().filter((t) => t === 'object.reminder_checked')).toHaveLength(1);
    expect(h.notes).toEqual([{ title: 'ObjectOS', body: '1 warranty ending' }]);
    expect(h.module.status().lastReminder?.status).toBe('completed');
  });

  it('nothing to say, no notification', async () => {
    const h = harness();
    h.module.start();
    h.module.enableReminders();
    await (h.jobs.get('reminders') as ScheduledJob).run({ occurrenceId: 'reminders:x', scheduledAt: NOW, trigger: 'scheduled' });
    expect(h.notes).toEqual([]);
  });
});

describe('every action writes the log', () => {
  it('each user action records its object event and one audit line', async () => {
    const h = harness();
    const printer = ok(h.module.saveObject({ name: 'Printer', category: 'printer' }));
    const hotend = ok(h.module.saveObject({ name: 'Hotend', parentId: printer.id }));
    ok(h.module.saveObject({ id: printer.id, name: 'Printer', category: 'printer', location: 'garage' }));
    ok(h.module.setStatus({ id: printer.id, status: 'broken' }));
    ok(h.module.moveObject({ id: hotend.id, parentId: null }));
    ok(h.module.setState({ objectId: printer.id, key: 'firmware', value: '6.1' }));
    const schedule = ok(h.module.saveSchedule({ objectId: printer.id, title: 'Nozzle', rule: { kind: 'usage', measurementKey: 'hours', every: 200 } }));
    const part = ok(h.module.savePart({ name: 'Nozzle', quantity: 2, fits: [printer.id] }));
    ok(h.module.logMaintenance({ objectId: printer.id, scheduleId: schedule.id, title: 'Changed', parts: [{ partId: part.id, quantity: 1 }] }));
    ok(h.module.adjustStock({ partId: part.id, delta: 3, reason: 'restocked' }));
    ok(h.module.saveModification({ objectId: printer.id, title: 'Fans', reversible: true }));
    ok(h.module.saveSettings({ objectId: printer.id, name: 'Slicer', values: { layer: '0.2' } }));
    ok(h.module.addMeasurement({ objectId: printer.id, key: 'hours', value: 10, unit: 'h' }));
    ok(h.module.savePurchase({ objectId: printer.id, shop: 'Shop' }));
    writeFileSync(join(h.home, 'manual.pdf'), 'manual');
    const file = ok(await h.module.attachFile({ objectId: printer.id, sourcePath: join(h.home, 'manual.pdf'), role: 'manual' }));
    ok(h.module.openFile({ fileId: file.id }));
    ok(h.module.removeFile({ fileId: file.id }));
    const m = ok(h.module.addMeasurement({ objectId: printer.id, key: 'hours', value: 12, unit: 'h' }));
    ok(h.module.deleteRecord({ kind: 'measurement', id: m.id }));
    h.module.enableReminders();
    h.module.checkRemindersNow();
    h.module.disableReminders();
    let zip: { entries: Map<string, Buffer>; json: string } | null = null;
    ok(
      await h.module.exportObjects({ objectIds: 'all' }, async (b) => {
        zip = { entries: new Map(b.files.map((f) => [f.zipPath, readFileSync(f.sourcePath)])), json: JSON.stringify(b.data) };
      }),
    );
    ok(h.module.deleteObject({ id: hotend.id }));
    const target = harness();
    const z = zip as unknown as { entries: Map<string, Buffer>; json: string };
    ok(await target.module.importArchive(memoryArchive(target.port, z.entries, z.json)));

    expect(h.types()).toEqual([
      'object.created',
      'object.created',
      'object.updated',
      'object.status_changed',
      'object.moved',
      'object.state_set',
      'object.schedule_saved',
      'object.part_saved',
      'object.stock_changed',
      'object.maintenance_logged',
      'object.stock_changed',
      'object.stock_changed',
      'object.modification_saved',
      'object.settings_saved',
      'object.measurement_recorded',
      'object.purchase_saved',
      'object.file_attached',
      'object.file_removed',
      'object.measurement_recorded',
      'object.record_deleted',
      'object.reminder_checked',
      'object.export_created',
      'object.deleted',
    ]);
    expect(target.types()).toEqual(['object.import_completed']);
    const audited = new Set([...h.audits, ...target.audits].map((a) => a.actionId));
    expect([...audited].sort()).toEqual(Object.keys(AUDIT_SUMMARIES).sort());
    for (const a of [...h.audits, ...target.audits]) expect(a.summary).toBe(AUDIT_SUMMARIES[a.actionId as keyof typeof AUDIT_SUMMARIES]);
    expect(new Set(h.types()).size).toBeLessThanOrEqual(OBJECT_EVENT_TYPES.length);
  });

  it('a refused action writes no object event', async () => {
    const h = harness();
    expect(h.module.saveObject({ name: '' }).ok).toBe(false);
    expect(h.module.setStatus({ id: 'nope', status: 'sold' }).ok).toBe(false);
    expect(h.module.moveObject({ id: 'AAAAAAAA', parentId: null }).ok).toBe(false);
    expect(h.module.deleteRecord({ kind: 'file', id: 'fil_00000001' }).ok).toBe(false);
    expect(h.module.adjustStock({ partId: 'prt_00000001', delta: 1 }).ok).toBe(false);
    expect((await h.module.attachFile({ objectId: 'AAAAAAAA', sourcePath: '/x', role: 'manual' })).ok).toBe(false);
    expect(h.types()).toEqual([]);
  });
});

describe('the owner\'s text never reaches the event log or a notification', () => {
  it('a marker in every text field appears nowhere in object or audit events', async () => {
    const h = harness();
    const m = (f: string) => `${MARK} ${f}`;
    const printer = ok(h.module.saveObject({ name: m('name'), category: 'printer', make: m('make'), model: m('model'), serial: m('serial'), location: m('location'), notes: m('notes'), tags: [MARK.toLowerCase()] }));
    ok(h.module.saveObject({ id: printer.id, name: m('renamed'), location: m('garage'), status: 'lent_out' }));
    ok(h.module.setState({ objectId: printer.id, key: m('key'), value: m('value') }));
    const schedule = ok(h.module.saveSchedule({ objectId: printer.id, title: m('title'), notes: m('notes'), rule: { kind: 'usage', measurementKey: m('hours'), every: 5 } }));
    const part = ok(h.module.savePart({ name: m('part'), partNumber: m('pn'), supplier: m('supplier'), notes: m('notes'), unit: 'pcs', quantity: 3, lowStockAt: 5, fits: [printer.id] }));
    ok(h.module.logMaintenance({ objectId: printer.id, scheduleId: schedule.id, title: m('done'), doneBy: m('me'), notes: m('notes'), cost: { amount: '12.34', currency: 'EUR' }, parts: [{ partId: part.id, quantity: 1 }] }));
    ok(h.module.saveModification({ objectId: printer.id, title: m('mod'), reason: m('why'), before: m('before'), after: m('after') }));
    ok(h.module.saveSettings({ objectId: printer.id, name: m('settings'), values: { [m('k')]: m('v') }, note: m('note') }));
    ok(h.module.addMeasurement({ objectId: printer.id, key: m('hours'), value: 10, unit: 'h', note: m('note') }));
    ok(h.module.savePurchase({ objectId: printer.id, shop: m('shop'), price: { amount: '999.99', currency: 'EUR' }, warrantyUntil: '2026-07-01' }));
    writeFileSync(join(h.home, `${MARK} manual.pdf`), MARK);
    const file = ok(await h.module.attachFile({ objectId: printer.id, sourcePath: join(h.home, `${MARK} manual.pdf`), role: 'manual' }));
    ok(h.module.openFile({ fileId: file.id }));
    h.module.enableReminders();
    h.module.checkRemindersNow();
    ok(await h.module.exportObjects({ objectIds: [printer.id] }, async () => {}));
    ok(h.module.removeFile({ fileId: file.id }));
    ok(h.module.deleteObject({ id: printer.id }));

    expect(h.types().length).toBeGreaterThan(12);
    const logged = JSON.stringify(h.handle.db.prepare("SELECT * FROM event_log WHERE stream IN ('object', 'audit')").all());
    expect(logged.toLowerCase()).not.toContain(MARK.toLowerCase());
    expect(logged).not.toMatch(/999|12\.34|1234/);
    expect(h.notes.length).toBe(1);
    expect(JSON.stringify(h.notes).toLowerCase()).not.toContain(MARK.toLowerCase());
  });
});

describe('reads', () => {
  it('detail, timeline, attention with names for the view, and settings diff', () => {
    const h = harness();
    const p = ok(h.module.saveObject({ name: 'Printer', category: 'printer' }));
    ok(h.module.saveSchedule({ objectId: p.id, title: 'Service', rule: { kind: 'time', every: 1, unit: 'days' }, startsAt: '2026-06-01T00:00:00Z' }));
    const v1 = ok(h.module.saveSettings({ objectId: p.id, name: 'Slicer', values: { a: '1', b: '2' } }));
    const v2 = ok(h.module.saveSettings({ objectId: p.id, name: 'Slicer', values: { a: '1', b: '3', c: '4' } }));
    const d = ok(h.module.objectDetail(p.id));
    expect(d.schedules[0]?.status.state).toBe('overdue');
    expect(ok(h.module.timeline({ objectId: p.id })).length).toBeGreaterThan(2);
    const a = h.module.attentionView();
    expect(a.summary.counts.overdue).toBe(1);
    expect(Object.values(a.names)).toContain('Printer');
    expect(ok(h.module.settingsDiff({ objectId: p.id, from: v1.id, to: v2.id }))).toMatchObject({ changed: [{ key: 'b', from: '2', to: '3' }], added: [{ key: 'c', value: '4' }] });
    expect(ok(h.module.listObjects({ search: 'print' })).map((o) => o.id)).toEqual([p.id]);
    expect(h.module.listObjects({ category: 'boat' }).ok).toBe(false);
    expect(h.module.objectDetail('nope').ok).toBe(false);
  });
});
