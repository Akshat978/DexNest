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
  /** Set to move the module's clock. */
  clock: { now: Date };
  types(): string[];
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0)) f();
});

let n = 0;
let seed = 0;

// The zone is named so "today" is the same on every machine that runs these.
function harness(timeZone = 'UTC'): Harness {
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
  const clock = { now: new Date(NOW) };
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
    now: () => clock.now,
    timeZone,
    newToken: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    randomBytes: (len) => {
      seed += 1;
      return Array.from({ length: len }, (_, i) => Math.floor(seed / 32 ** (len - 1 - i)) % 32);
    },
  });
  return { handle, log, module, port, jobs, audits, notes, home, clock, types: () => log.query({ stream: 'object' }).map((e) => e.type) };
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

  it('only the deleting actions are caution, with a confirmation; nothing but opening the screen is on the Deck', () => {
    // The owner allowed the open action on the Stream Deck on 5 October 2026: it shows the screen and sends nothing back.
    const registered = seededActions.filter((a) => a.moduleId === 'object_os');
    expect(registered.filter((a) => a.dangerLevel !== 'safe').map((a) => a.id).sort()).toEqual([OBJECT_ACTION_IDS.fileRemove, OBJECT_ACTION_IDS.objectDelete, OBJECT_ACTION_IDS.recordDelete].sort());
    for (const a of registered.filter((x) => x.dangerLevel !== 'safe')) expect(a.requiresConfirmation && a.confirmationRule).toBeTruthy();
    for (const a of registered) expect(a.allowedTriggers.includes('deck'), a.id).toBe(a.id === OBJECT_ACTION_IDS.open);
    for (const a of registered) expect('phone' in a && (a as { phone?: unknown }).phone !== undefined, a.id).toBe(false);
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
    ok(h.module.locateObject({ objectId: hotend.id, room: 'Workshop', container: 'parts bin' }));
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
      'object.located',
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

describe('where things are (what Finder did)', () => {
  it('quick add: a name and a place make an object that can be found by either', () => {
    const h = harness();
    const passport = ok(h.module.quickAdd({ name: 'Passport', location: 'black drawer', room: 'Bedroom' }));
    expect(passport).toMatchObject({ name: 'Passport', category: 'other', status: 'active', location: 'black drawer', whereabouts: { room: 'Bedroom', missing: false } });
    expect(passport.whereabouts.locatedAt).toBeTruthy();
    ok(h.module.quickAdd({ name: 'Charger', location: 'nightstand', room: 'Bedroom', tags: ['electronics'] }));
    ok(h.module.quickAdd({ name: 'Keys', location: 'kitchen drawer', room: 'Kitchen' }));
    expect(h.module.quickAdd({ name: '', location: 'x' }).ok).toBe(false);

    const names = (r: ReturnType<typeof h.module.findObjects>) => ok(r).map((o) => o.name);
    expect(names(h.module.findObjects('passport'))).toEqual(['Passport']);
    expect(names(h.module.findObjects('PASS'))).toEqual(['Passport']);
    expect(names(h.module.findObjects('electronics'))).toEqual(['Charger']);
    expect(names(h.module.findObjects('bedroom drawer')), 'every word must match').toEqual(['Passport']);
    expect(names(h.module.findObjects('100%')), 'wildcards in what was typed are literal').toEqual([]);
    expect(h.module.findObjects('   ').ok).toBe(false);

    // Reverse lookup: what is in a place.
    expect(names(h.module.whatIsIn('bedroom'))).toEqual(['Charger', 'Passport']);
    expect(names(h.module.whatIsIn('drawer'))).toEqual(['Keys', 'Passport']);
    expect(h.module.rooms()).toEqual(['Bedroom', 'Kitchen']);
    expect(h.types()).toEqual(['object.created', 'object.located', 'object.created', 'object.located', 'object.created', 'object.located']);
  });

  it('what is in: the components of an object count as being in it', () => {
    const h = harness();
    const box = ok(h.module.saveObject({ name: 'Camera bag' }));
    ok(h.module.saveObject({ name: 'Lens cap', parentId: box.id }));
    expect(ok(h.module.whatIsIn('camera bag')).map((o) => o.name)).toEqual(['Lens cap']);
  });

  it('moved, lent, returned, missing and found, each keeping what it should', () => {
    const h = harness();
    const drill = ok(h.module.quickAdd({ name: 'Drill', location: 'garage shelf', room: 'Garage' }));

    h.clock.now = new Date('2026-03-01T10:00:00.000Z');
    const lent = ok(h.module.locateObject({ objectId: drill.id, lentTo: 'Alex' }));
    expect(lent).toMatchObject({ status: 'lent_out', whereabouts: { lentTo: 'Alex', lentAt: '2026-03-01T10:00:00.000Z' } });

    // Correcting something else later does not restart the loan.
    h.clock.now = new Date('2026-06-01T10:00:00.000Z');
    ok(h.module.saveObject({ id: drill.id, name: 'Cordless drill', location: 'garage shelf', status: 'lent_out' }));
    expect(ok(h.module.locateObject({ objectId: drill.id, lentTo: 'Alex' })).whereabouts.lentAt).toBe('2026-03-01T10:00:00.000Z');

    const back = ok(h.module.locateObject({ objectId: drill.id, returned: true }));
    expect(back).toMatchObject({ status: 'active', location: 'garage shelf', whereabouts: { lentTo: '', lentAt: null, room: 'Garage' } });

    expect(ok(h.module.locateObject({ objectId: drill.id, missing: true })).whereabouts.missing).toBe(true);
    // Putting it somewhere means it was found.
    const moved = ok(h.module.locateObject({ objectId: drill.id, location: 'hall cupboard', room: 'Hall' }));
    expect(moved).toMatchObject({ location: 'hall cupboard', whereabouts: { room: 'Hall', missing: false, locatedAt: '2026-06-01T10:00:00.000Z' } });
    expect(h.module.store.changes(drill.id).filter((c) => c.field === 'location').map((c) => [c.from, c.to])).toEqual([['garage shelf', 'hall cupboard']]);

    expect(h.module.locateObject({ objectId: drill.id, lentTo: 'Sam', returned: true }).ok).toBe(false);
    expect(h.module.locateObject({ objectId: 'AAAAAAAA', missing: true }).ok).toBe(false);
    expect(h.module.recentlyLocated(5).map((o) => o.name)).toEqual(['Cordless drill']);
  });

  it('deleting an object removes where it was; an export carries it and an import restores it', async () => {
    const h = harness();
    const keys = ok(h.module.quickAdd({ name: 'Keys', location: 'bowl', room: 'Hall', lentTo: 'Sam' }));
    expect(keys.status).toBe('lent_out');
    let json = '';
    ok(await h.module.exportObjects({ objectIds: 'all' }, async (b) => { json = JSON.stringify(b.data); }));
    const target = harness();
    ok(await target.module.importArchive(memoryArchive(target.port, new Map(), json)));
    expect(ok(target.module.findObjects('keys'))[0]).toMatchObject({ name: 'Keys', whereabouts: { room: 'Hall', lentTo: 'Sam' } });

    ok(h.module.deleteObject({ id: keys.id }));
    expect(ok(h.module.findObjects('keys'))).toEqual([]);
    expect(h.handle.db.prepare('SELECT count(*) AS n FROM obj_whereabouts').get<{ n: number }>()?.n).toBe(0);
  });

  it('a place, a room and a borrower never reach the event log', () => {
    const h = harness();
    const o = ok(h.module.quickAdd({ name: `${MARK} thing`, location: `${MARK} drawer`, room: `${MARK} room`, container: `${MARK} box`, lentTo: `${MARK} person` }));
    ok(h.module.locateObject({ objectId: o.id, location: `${MARK} shelf`, room: `${MARK} attic` }));
    const logged = JSON.stringify(h.handle.db.prepare("SELECT * FROM event_log WHERE stream IN ('object', 'audit')").all());
    expect(logged.toLowerCase()).not.toContain(MARK.toLowerCase());
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
    // Prices must not appear. Random event ids and wall-clock timestamps are removed first, so their digits cannot match by chance.
    const scrubbed = logged
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z/g, '<time>');
    const hit = scrubbed.match(/.{0,60}(999|12\.34|1234).{0,60}/);
    expect(hit?.[0] ?? null).toBeNull();
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

describe('the owner\'s day', () => {
  it('a warranty that ends today has not expired late in the evening west of UTC', () => {
    // 22:00 on 30 June in Saskatchewan; 04:00 on 1 July in UTC.
    const late = new Date('2026-07-01T04:00:00.000Z');
    const there = harness('America/Regina');
    there.clock.now = late;
    const o = ok(there.module.saveObject({ name: 'Printer', category: 'tool' }));
    ok(there.module.savePurchase({ objectId: o.id, shop: 'Shop', warrantyUntil: '2026-06-30' }));
    expect(ok(there.module.objectDetail(o.id)).warranty).toEqual({ state: 'ending', daysLeft: 0 });
    expect(there.module.attentionView().summary.items).toEqual([{ kind: 'warranty', objectId: o.id, state: 'ending', daysLeft: 0 }]);

    // The same moment read in UTC, which is what every owner used to get.
    const utc = harness('UTC');
    utc.clock.now = late;
    const p = ok(utc.module.saveObject({ name: 'Printer', category: 'tool' }));
    ok(utc.module.savePurchase({ objectId: p.id, shop: 'Shop', warrantyUntil: '2026-06-30' }));
    expect(ok(utc.module.objectDetail(p.id)).warranty).toEqual({ state: 'expired', daysLeft: -1 });
  });
});
