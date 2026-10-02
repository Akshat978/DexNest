/**
 * Phase 7: what happens when things go wrong.
 *
 * - a disk fault at every single write of every kind of change: the data is
 *   either untouched or complete, never half-written, no bytes without a row
 *   and no row without bytes - also after a restart;
 * - DexNest stopping in the middle of an attach, a delete and an import;
 * - file copies failing part-way;
 * - the same reminder slot delivered several times at once, and the same
 *   import started twice at once;
 * - deep component trees and cycles, by moving and by importing;
 * - hostile import files;
 * - 5,000 objects and 100,000 measurements.
 *
 * All synthetic, in temp directories.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventLog, runFoundationMigrations, type EventLog, type ScheduledJob, type SqlDatabase, type SqlStatement } from '@dexnest/foundation';
import { assertSafeTestPath, createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import {
  createObjectOsModule,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_COMPONENT_DEPTH,
  type ImportArchive,
  type ObjectExport,
  type ObjectFilePort,
  type ObjectOsModule,
  type Parsed,
} from '../index.ts';
import { createTestPort, memoryArchive, type TestPort } from './node-port.ts';

const NOW = '2026-06-30T12:00:00.000Z';

// --- a database that fails when told to ------------------------------------------------

interface Faults {
  writes: number;
  failAt: number;
  reset(): void;
}

const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;

/** Counts every write statement and COMMIT; throws an I/O error on the chosen one. A failed COMMIT rolls back, as SQLite does. */
function faulty(db: SqlDatabase): { db: SqlDatabase; faults: Faults } {
  const faults: Faults = {
    writes: 0,
    failAt: Number.POSITIVE_INFINITY,
    reset() {
      faults.writes = 0;
      faults.failAt = Number.POSITIVE_INFINITY;
    },
  };
  const hit = () => {
    faults.writes += 1;
    if (faults.writes === faults.failAt) throw new Error('disk I/O error (injected)');
  };
  const wrapped: SqlDatabase = {
    exec(sql) {
      if (/^\s*COMMIT\b/i.test(sql)) {
        try {
          hit();
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!WRITE.test(sql)) return statement;
      const counted: SqlStatement = {
        run(params) {
          hit();
          return statement.run(params);
        },
        get: (params) => statement.get(params),
        all: (params) => statement.all(params),
      };
      return counted;
    },
  };
  return { db: wrapped, faults };
}

// --- a world ----------------------------------------------------------------------------

interface World {
  base: string;
  home: string;
  dataRoot: string;
  handle: TestDatabase;
  faults: Faults;
  log: EventLog;
  port: TestPort;
  files: ObjectFilePort;
  module: ObjectOsModule;
  jobs: Map<string, ScheduledJob>;
  notes: string[];
  ids: { printer: string; hotend: string; part: string; schedule: string; manual: string };
  /** A new module on the same database and folders, as after DexNest restarts. */
  restart(files?: ObjectFilePort): void;
  /** ObjectOS's data, with generated ids replaced by stable names. */
  data(): string;
  /** Every stored file on disk has its row, and every row its file; no temporary files. */
  consistent(): void;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});

function ok<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function walk(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`]))
    .sort();
}

const TABLES = [
  'obj_objects', 'obj_tags', 'obj_changes', 'obj_state', 'obj_state_log', 'obj_schedules', 'obj_maintenance', 'obj_parts', 'obj_part_fits',
  'obj_maintenance_parts', 'obj_stock_log', 'obj_modifications', 'obj_settings', 'obj_measurements', 'obj_purchase', 'obj_files', 'obj_kv',
];

function world(options: { seed?: boolean; label?: string } = {}): World {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), options.label ?? 'obj-hard-')));
  const dataRoot = join(base, 'dexnest-data');
  const home = join(base, 'home');
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  const handle = createTestDatabase('obj-hard-db-');
  cleanups.push(() => {
    handle.dispose();
    rmSync(base, { recursive: true, force: true });
  });
  const { db, faults } = faulty(handle.db);
  runFoundationMigrations(db);
  const log = createEventLog(db);
  const port = createTestPort(dataRoot);
  const jobs = new Map<string, ScheduledJob>();
  const notes: string[] = [];
  let token = 0;
  let seed = 1000;
  const make = (files: ObjectFilePort) =>
    createObjectOsModule({
      database: db,
      events: log,
      scheduler: {
        schedule(job) {
          jobs.set(job.id, job);
          return () => jobs.delete(job.id);
        },
        async runNow() {},
      },
      files,
      notify: (title, body) => notes.push(`${title}: ${body}`),
      now: () => new Date(NOW),
      newToken: () => `00000000-0000-4000-8000-${String(++token).padStart(12, '0')}`,
      randomBytes: (len) => {
        seed += 7;
        return Array.from({ length: len }, (_, i) => Math.floor(seed / 32 ** (len - 1 - i)) % 32);
      },
    });
  const w: World = {
    base,
    home,
    dataRoot,
    handle,
    faults,
    log,
    port,
    files: port,
    module: make(port),
    jobs,
    notes,
    ids: { printer: '', hotend: '', part: '', schedule: '', manual: '' },
    restart(files = port) {
      w.module.stop();
      w.files = files;
      w.module = make(files);
      w.module.start();
    },
    data() {
      const rows: Record<string, unknown[]> = {};
      for (const t of TABLES) rows[t] = handle.db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
      const events = log.query({ stream: 'object' }).map((e) => [e.type, e.subject, e.payload]);
      const onDisk = walk(join(dataRoot, 'files', 'objects')).map((p) => `${p}:${sha(readFileSync(join(dataRoot, 'files', 'objects', p)))}`);
      let text = JSON.stringify({ rows, events, onDisk });
      // Generated ids differ between attempts; names and kinds do not.
      const names = handle.db.prepare('SELECT id, name FROM obj_objects').all() as { id: string; name: string }[];
      for (const n of names) text = text.split(n.id).join(`<obj:${n.name}>`);
      let k = 0;
      const seen = new Map<string, string>();
      text = text.replace(/\b(sch|mnt|mod|set|prt|msr|fil)_[A-Za-z0-9-]{8,64}/g, (id, kind: string) => {
        if (!seen.has(id)) seen.set(id, `<${kind}:${++k}>`);
        return seen.get(id) as string;
      });
      return text;
    },
    consistent() {
      const onDisk = walk(join(dataRoot, 'files', 'objects'));
      expect(onDisk.filter((p) => p.endsWith('.part'))).toEqual([]);
      const rows = (handle.db.prepare('SELECT object_id, stored_name FROM obj_files ORDER BY 1, 2').all() as { object_id: string; stored_name: string }[]).map((r) => `${r.object_id}/${r.stored_name}`);
      expect(onDisk).toEqual(rows.sort());
      expect(handle.db.prepare('SELECT * FROM obj_pending_files').all()).toEqual([]);
    },
  };
  w.module.start();
  if (options.seed !== false) {
    const printer = ok(w.module.saveObject({ name: 'Printer', category: 'printer', serial: 'SN1', location: 'Workshop' }));
    const hotend = ok(w.module.saveObject({ name: 'Hotend', category: 'other', parentId: printer.id }));
    const part = ok(w.module.savePart({ name: 'Nozzle', quantity: 5, lowStockAt: 1, fits: [printer.id] }));
    const schedule = ok(w.module.saveSchedule({ objectId: printer.id, title: 'Nozzle swap', rule: { kind: 'usage', measurementKey: 'hours', every: 200 } }));
    ok(w.module.addMeasurement({ objectId: printer.id, key: 'hours', value: 150, unit: 'h' }));
    ok(w.module.savePurchase({ objectId: printer.id, shop: 'Shop', price: { amount: '300.00', currency: 'EUR' }, warrantyUntil: '2026-07-10' }));
    ok(w.module.saveSettings({ objectId: printer.id, name: 'Slicer', values: { layer: '0.2' } }));
    writeFileSync(join(home, 'manual.pdf'), 'manual bytes');
    writeFileSync(join(home, 'photo.jpg'), Buffer.alloc(3000, 9));
    w.ids = { printer: printer.id, hotend: hotend.id, part: part.id, schedule: schedule.id, manual: '' };
  }
  return w;
}

async function seedFile(w: World): Promise<void> {
  const f = ok(await w.module.attachFile({ objectId: w.ids.printer, sourcePath: join(w.home, 'manual.pdf'), role: 'manual' }));
  w.ids.manual = f.id;
}

/** A zip, as memory: an export of `from`, with its files. */
async function exported(from: World, objectIds: string[] | 'all' = 'all'): Promise<{ entries: Map<string, Buffer>; json: string }> {
  let out: { entries: Map<string, Buffer>; json: string } | null = null;
  ok(
    await from.module.exportObjects({ objectIds }, async (b) => {
      out = { entries: new Map(b.files.map((f) => [f.zipPath, readFileSync(f.sourcePath)])), json: JSON.stringify(b.data) };
    }),
  );
  return out as unknown as { entries: Map<string, Buffer>; json: string };
}

// --- faults at every write ----------------------------------------------------------------

interface Scenario {
  name: string;
  prepare?(w: World): Promise<void>;
  act(w: World): Promise<unknown>;
}

let source: { entries: Map<string, Buffer>; json: string } | null = null;
async function sourceZip(): Promise<{ entries: Map<string, Buffer>; json: string }> {
  if (!source) {
    const s = world({ label: 'obj-hard-src-' });
    await seedFile(s);
    ok(await s.module.attachFile({ objectId: s.ids.hotend, sourcePath: join(s.home, 'photo.jpg'), role: 'photo' }));
    source = await exported(s);
  }
  return source;
}

const SCENARIOS: Scenario[] = [
  { name: 'create an object inside another', act: async (w) => w.module.saveObject({ name: 'Fan', category: 'other', parentId: w.ids.printer }) },
  { name: 'edit an object (status, location and parent change at once)', act: async (w) => w.module.saveObject({ id: w.ids.hotend, name: 'Hotend', category: 'other', status: 'broken', location: 'Drawer', parentId: null }) },
  { name: 'set state', act: async (w) => w.module.setState({ objectId: w.ids.printer, key: 'firmware', value: '6.1' }) },
  { name: 'log maintenance that uses a part', act: async (w) => w.module.logMaintenance({ objectId: w.ids.printer, scheduleId: w.ids.schedule, title: 'Swapped', usageReading: 150, parts: [{ partId: w.ids.part, quantity: 2 }] }) },
  { name: 'change stock', act: async (w) => w.module.adjustStock({ partId: w.ids.part, delta: -4, reason: 'used' }) },
  { name: 'save a part with a new quantity', act: async (w) => w.module.savePart({ id: w.ids.part, name: 'Nozzle', quantity: 9, lowStockAt: 1, fits: [w.ids.printer, w.ids.hotend] }) },
  { name: 'save a new settings version', act: async (w) => w.module.saveSettings({ objectId: w.ids.printer, name: 'Slicer', values: { layer: '0.15' } }) },
  { name: 'record a measurement', act: async (w) => w.module.addMeasurement({ objectId: w.ids.printer, key: 'hours', value: 390, unit: 'h' }) },
  { name: 'delete a record', act: async (w) => w.module.deleteRecord({ kind: 'schedule', id: w.ids.schedule }) },
  { name: 'attach a file (the first photo)', act: async (w) => w.module.attachFile({ objectId: w.ids.printer, sourcePath: join(w.home, 'photo.jpg'), role: 'photo' }) },
  { name: 'remove a file', prepare: seedFile, act: async (w) => w.module.removeFile({ fileId: w.ids.manual }) },
  { name: 'delete an object with files and a component', prepare: seedFile, act: async (w) => w.module.deleteObject({ id: w.ids.printer }) },
  {
    name: 'run the daily reminders',
    prepare: async (w) => {
      w.module.enableReminders();
    },
    act: async (w) => (w.jobs.get('reminders') as ScheduledJob).run({ occurrenceId: 'reminders:2026-06-30', scheduledAt: NOW, trigger: 'scheduled' }),
  },
  {
    name: 'import an export with files',
    act: async (w) => {
      const z = await sourceZip();
      return w.module.importArchive(memoryArchive(w.port, z.entries, z.json));
    },
  },
];

describe('a disk fault at every write', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: untouched or complete, never half-written, and a clean retry completes`, async () => {
      // The clean run: how many writes, and what "complete" looks like.
      const cw = world();
      await scenario.prepare?.(cw);
      cw.faults.reset();
      await scenario.act(cw);
      const writes = cw.faults.writes;
      const complete = cw.data();
      cw.consistent();
      expect(writes).toBeGreaterThan(0);

      for (let k = 1; k <= writes; k++) {
        const w = world();
        await scenario.prepare?.(w);
        const before = w.data();
        w.faults.reset();
        w.faults.failAt = k;
        try {
          await scenario.act(w);
        } catch {
          // A fault may surface as an exception; what matters is what is left.
        }
        w.faults.reset();
        w.restart();
        const after = w.data();
        expect([before, complete], `${scenario.name}, fault at write ${k} of ${writes}`).toContain(after);
        w.consistent();
        if (after === before) {
          await scenario.act(w);
          expect(w.data(), `${scenario.name}, retry after a fault at write ${k}`).toBe(complete);
          w.consistent();
        }
      }
    }, 60_000);
  }
});

// --- DexNest stopping part-way ----------------------------------------------------------------

/** A port whose next copy writes its bytes and then never returns - as if DexNest stopped there. */
function stopsAfterCopy(port: TestPort, stopOn: 'copyIn' | 'remove' | 'removeFolder'): ObjectFilePort {
  return {
    ...port,
    inspect: (p) => port.inspect(p),
    resolveStored: (o, s) => port.resolveStored(o, s),
    async copyIn(...args) {
      const r = await port.copyIn(...args);
      if (stopOn === 'copyIn') return new Promise(() => {});
      return r;
    },
    remove(o, s) {
      if (stopOn === 'remove') throw new Error('stopped');
      port.remove(o, s);
    },
    removeFolder(o) {
      if (stopOn === 'removeFolder') throw new Error('stopped');
      port.removeFolder(o);
    },
  };
}

describe('DexNest stopping in the middle', () => {
  it('an attach whose bytes were copied but whose row was never written: the bytes go at the next start', async () => {
    const w = world();
    w.restart(stopsAfterCopy(w.port, 'copyIn'));
    void w.module.attachFile({ objectId: w.ids.printer, sourcePath: join(w.home, 'manual.pdf'), role: 'manual' });
    await new Promise((r) => setTimeout(r, 50));
    expect(walk(join(w.dataRoot, 'files', 'objects'))).toHaveLength(1);
    w.restart(w.port);
    w.consistent();
    expect(walk(join(w.dataRoot, 'files', 'objects'))).toEqual([]);
  });

  it('a removed file whose bytes were not yet deleted: they go at the next start', async () => {
    const w = world();
    await seedFile(w);
    w.restart(stopsAfterCopy(w.port, 'remove'));
    expect(() => w.module.removeFile({ fileId: w.ids.manual })).toThrow('stopped');
    w.restart(w.port);
    w.consistent();
    expect(w.log.query({ stream: 'object' }).filter((e) => e.type === 'object.file_removed')).toHaveLength(1);
  });

  it("a deleted object whose folder was not yet removed: it goes at the next start; the component's files stay", async () => {
    const w = world();
    await seedFile(w);
    ok(await w.module.attachFile({ objectId: w.ids.hotend, sourcePath: join(w.home, 'photo.jpg'), role: 'photo' }));
    w.restart(stopsAfterCopy(w.port, 'removeFolder'));
    expect(() => w.module.deleteObject({ id: w.ids.printer })).toThrow('stopped');
    expect(existsSync(join(w.dataRoot, 'files', 'objects', w.ids.printer))).toBe(true);
    w.restart(w.port);
    expect(existsSync(join(w.dataRoot, 'files', 'objects', w.ids.printer))).toBe(false);
    expect(walk(join(w.dataRoot, 'files', 'objects', w.ids.hotend))).toHaveLength(1);
    w.consistent();
  });

  it('an import that stopped after copying some files: they go at the next start, and importing again works', async () => {
    const z = await sourceZip();
    const w = world({ seed: false });
    const archive = memoryArchive(w.port, z.entries, z.json);
    let copies = 0;
    const stopping: ImportArchive = {
      ...archive,
      async copyEntry(...args) {
        copies += 1;
        await archive.copyEntry(...args);
        // A .part left by a copy that was cut off, as well.
        const [, objectId, storedName] = args;
        writeFileSync(join(w.dataRoot, 'files', 'objects', objectId, `${storedName}x.part`), 'half');
        return new Promise(() => {});
      },
    };
    void w.module.importArchive(stopping);
    await new Promise((r) => setTimeout(r, 50));
    expect(copies).toBe(1);
    expect(walk(join(w.dataRoot, 'files', 'objects')).length).toBeGreaterThan(0);

    w.restart();
    w.consistent();
    expect(walk(join(w.dataRoot, 'files', 'objects'))).toEqual([]);
    expect(w.module.status().objects).toBe(0);

    const r = ok(await w.module.importArchive(memoryArchive(w.port, z.entries, z.json)));
    expect(r.objects).toHaveLength(2);
    w.consistent();
    for (const f of r.files) expect(sha(readFileSync(join(w.dataRoot, 'files', 'objects', f.objectId, f.storedName)))).toBe(f.sha256);
  });

  it("an import never touches the folder of an object that is already here", async () => {
    const z = await sourceZip();
    const w = world({ seed: false });
    ok(await w.module.importArchive(memoryArchive(w.port, z.entries, z.json)));
    const before = w.data();
    const again = ok(await w.module.importArchive(memoryArchive(w.port, z.entries, z.json)));
    expect(again.objects).toEqual([]);
    expect(again.skipped).toHaveLength(2);
    expect(w.data().replace(/"object\.import_completed".*$/, '')).toBe(before.replace(/"object\.import_completed".*$/, ''));
    w.consistent();
  });
});

// --- copies failing ---------------------------------------------------------------------------------

describe('file copies failing part-way', () => {
  it('attach: no row, no bytes, no event', async () => {
    const w = world();
    const before = w.data();
    writeFileSync(join(w.home, 'big.bin'), Buffer.alloc(200_000, 3));
    w.port.failCopyAfterBytes = 70_000;
    await expect(w.module.attachFile({ objectId: w.ids.printer, sourcePath: join(w.home, 'big.bin'), role: 'other' })).rejects.toThrow(/injected/);
    expect(w.data()).toBe(before);
    w.consistent();
  });

  it('import: the second file fails; the first is removed; no rows', async () => {
    const z = await sourceZip();
    const w = world({ seed: false });
    const archive = memoryArchive(w.port, z.entries, z.json);
    let n = 0;
    const failing: ImportArchive = {
      ...archive,
      async copyEntry(...args) {
        n += 1;
        if (n === 2) throw new Error('disk full (injected)');
        return archive.copyEntry(...args);
      },
    };
    const r = await w.module.importArchive(failing);
    expect(r.ok).toBe(false);
    expect(w.module.status().objects).toBe(0);
    w.consistent();
    expect(walk(join(w.dataRoot, 'files', 'objects'))).toEqual([]);
    expect(w.log.query({ stream: 'object' })).toEqual([]);
  });
});

// --- the same thing twice at once -------------------------------------------------------------------

describe('duplicates', () => {
  it('one reminder slot delivered five times at once: one run, one event, one notification', async () => {
    const w = world();
    w.module.enableReminders();
    const job = w.jobs.get('reminders') as ScheduledJob;
    const slot = { occurrenceId: 'reminders:2026-06-30', scheduledAt: NOW, trigger: 'scheduled' as const };
    await Promise.all([job.run(slot), job.run(slot), job.run({ ...slot, trigger: 'startup' as const }), job.run(slot), job.run(slot)]);
    expect(w.log.query({ stream: 'object' }).filter((e) => e.type === 'object.reminder_checked')).toHaveLength(1);
    expect(w.notes).toHaveLength(1);
    expect(w.handle.db.prepare('SELECT COUNT(*) AS n FROM obj_runs').get()).toEqual({ n: 1 });
  });

  it('the same import started twice at once: one imports, the other skips everything; every file intact', async () => {
    const z = await sourceZip();
    const w = world({ seed: false });
    const [a, b] = await Promise.all([
      w.module.importArchive(memoryArchive(w.port, z.entries, z.json)),
      w.module.importArchive(memoryArchive(w.port, z.entries, z.json)),
    ]);
    const plans = [ok(a), ok(b)];
    expect(plans.map((p) => p.objects.length).sort()).toEqual([0, 2]);
    expect(plans.map((p) => p.skipped.length).sort()).toEqual([0, 2]);
    w.consistent();
    const files = w.handle.db.prepare('SELECT object_id, stored_name, sha256 FROM obj_files').all() as { object_id: string; stored_name: string; sha256: string }[];
    expect(files).toHaveLength(2);
    for (const f of files) expect(sha(readFileSync(join(w.dataRoot, 'files', 'objects', f.object_id, f.stored_name)))).toBe(f.sha256);
  });

  it('deleting the same object twice: the second is refused, nothing else changes', () => {
    const w = world();
    ok(w.module.deleteObject({ id: w.ids.printer }));
    const after = w.data();
    const again = w.module.deleteObject({ id: w.ids.printer });
    expect(again.ok).toBe(false);
    expect(w.data()).toBe(after);
  });
});

// --- trees ----------------------------------------------------------------------------------------------

describe('component trees', () => {
  it(`a chain can be ${MAX_COMPONENT_DEPTH} levels deep and no deeper; moving never makes a loop`, () => {
    const w = world({ seed: false });
    const chain = [ok(w.module.saveObject({ name: 'L0', category: 'other' }))];
    for (let i = 1; i <= MAX_COMPONENT_DEPTH; i++) chain.push(ok(w.module.saveObject({ name: `L${i}`, category: 'other', parentId: chain[i - 1]?.id })));
    const deepest = chain[chain.length - 1];
    const tooDeep = w.module.saveObject({ name: 'too deep', category: 'other', parentId: deepest?.id });
    expect(tooDeep.ok).toBe(false);

    // Moving the root under its own descendant, or anything under itself, is refused.
    const top = chain[0]?.id as string;
    for (const target of [chain[1], chain[10], deepest]) {
      const r = w.module.moveObject({ id: top, parentId: target?.id });
      expect(r.ok, `move under ${target?.name}`).toBe(false);
    }
    expect(w.module.moveObject({ id: chain[5]?.id, parentId: chain[5]?.id }).ok).toBe(false);
    expect(w.module.saveObject({ id: chain[3]?.id, name: 'L3', category: 'other', parentId: chain[20]?.id }).ok).toBe(false);
    // Unchanged.
    expect(w.module.objectDetail(top).ok && ok(w.module.objectDetail(top)).parent).toBeNull();

    // A legal move still works: the tail of the chain onto the root.
    ok(w.module.moveObject({ id: chain[30]?.id, parentId: top }));
    expect(ok(w.module.objectDetail(chain[30]?.id)).parent?.id).toBe(top);

    // Export walks the whole tree from the root, and deleting the root keeps every component.
    const z = { n: 0 };
    return w.module
      .exportObjects({ objectIds: [top] }, async (b) => {
        z.n = b.data.objects.length;
      })
      .then(() => {
        expect(z.n).toBe(MAX_COMPONENT_DEPTH + 1);
        ok(w.module.deleteObject({ id: top }));
        expect(w.module.status().objects).toBe(MAX_COMPONENT_DEPTH);
      });
  });

  const exportOf = (objects: { id: string; parentId: string | null }[]): ObjectExport => ({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: NOW,
    objects: objects.map((o, i) => ({
      id: o.id, name: `O${i}`, category: 'other', make: '', model: '', serial: '', location: '', status: 'active', notes: '', tags: [],
      parentId: o.parentId, photoFileId: null, createdAt: NOW, updatedAt: NOW,
    })),
    changes: [], state: [], stateLog: [], schedules: [], maintenance: [], modifications: [], settings: [], parts: [], stockLog: [], measurements: [], purchases: [], files: [],
  }) as ObjectExport;

  const idOf = (i: number) => `A${String(i).padStart(7, '0').replace(/[ILOU]/g, 'X')}`;

  it('an import whose part-of links loop is refused, and nothing is written', async () => {
    const w = world({ seed: false });
    const loop = exportOf([{ id: idOf(1), parentId: idOf(2) }, { id: idOf(2), parentId: idOf(3) }, { id: idOf(3), parentId: idOf(1) }]);
    const r = await w.module.importArchive(memoryArchive(w.port, new Map(), JSON.stringify(loop)));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join(' ')).toMatch(/loops or is deeper/);
    expect(w.module.status().objects).toBe(0);
  });

  it(`an import deeper than ${MAX_COMPONENT_DEPTH} levels is refused, in the file or under an object already here`, async () => {
    const w = world({ seed: false });
    const deep = Array.from({ length: MAX_COMPONENT_DEPTH + 2 }, (_, i) => ({ id: idOf(i + 1), parentId: i === 0 ? null : idOf(i) }));
    const r1 = await w.module.importArchive(memoryArchive(w.port, new Map(), JSON.stringify(exportOf(deep))));
    expect(r1.ok).toBe(false);
    expect(w.module.status().objects).toBe(0);

    // A legal chain of 20 here.
    const here = Array.from({ length: 20 }, (_, i) => ({ id: idOf(100 + i), parentId: i === 0 ? null : idOf(99 + i) }));
    ok(await w.module.importArchive(memoryArchive(w.port, new Map(), JSON.stringify(exportOf(here)))));
    // The file carries the end of that chain as a root (it is here, so it is skipped) and a chain of 15 under it:
    // fine inside the file, 35 deep once hung under the chain already here.
    const file = Array.from({ length: 16 }, (_, i) => ({ id: i === 0 ? idOf(119) : idOf(200 + i), parentId: i === 0 ? null : i === 1 ? idOf(119) : idOf(199 + i) }));
    const r2 = await w.module.importArchive(memoryArchive(w.port, new Map(), JSON.stringify(exportOf(file))));
    expect(r2.ok).toBe(false);
    expect(r2.ok ? '' : r2.errors.join(' ')).toMatch(/more than 32 levels deep/);
    expect(w.module.status().objects).toBe(20);
    w.consistent();
  });
});

// --- hostile imports ---------------------------------------------------------------------------------------

describe('hostile import files', () => {
  it('each is refused with a reason, and nothing is written', async () => {
    const z = await sourceZip();
    const good = JSON.parse(z.json) as ObjectExport;
    const firstFile = good.files[0];
    if (!firstFile) throw new Error('the source export has no files');
    const variants: [string, string | null, Map<string, Buffer>][] = [
      ['no manifest', null, z.entries],
      ['not JSON', '{ nope', z.entries],
      ['JSON, not an export', JSON.stringify({ hello: 'world' }), z.entries],
      ['a future version', JSON.stringify({ ...good, version: 99 }), z.entries],
      ['a stored name pointing outside', JSON.stringify({ ...good, files: [{ ...firstFile, storedName: '../../escape.txt' }, ...good.files.slice(1)] }), z.entries],
      ['a file row with no bytes in the zip', z.json, new Map([...z.entries].slice(1))],
      ['bytes that do not match their hash', z.json, new Map([...z.entries].map(([k, v], i) => [k, i === 0 ? Buffer.concat([v.subarray(1), Buffer.from('x')]) : v]))],
      ['a size that does not match', z.json, new Map([...z.entries].map(([k, v], i) => [k, i === 0 ? Buffer.concat([v, Buffer.from('x')]) : v]))],
      ['a row for an object not in the file', JSON.stringify({ ...good, state: [{ objectId: 'ZZZZZZZZ', key: 'k', value: 'v', updatedAt: NOW }] }), z.entries],
      ['a negative stock', JSON.stringify({ ...good, parts: [{ id: 'prt_hostile01', name: 'x', partNumber: '', supplier: '', unit: 'pcs', quantity: -5, lowStockAt: null, notes: '', fits: [], createdAt: NOW, updatedAt: NOW }] }), z.entries],
      ['a prototype-polluting settings key', JSON.stringify({ ...good, settings: [{ id: 'set_hostile01', objectId: good.objects[0]?.id, name: 'p', version: 1, values: JSON.parse('{"__proto__":"x"}'), note: '', createdAt: NOW }] }), z.entries],
    ];
    for (const [label, json, entries] of variants) {
      const w = world({ seed: false });
      const r = await w.module.importArchive(memoryArchive(w.port, entries, json));
      expect(r.ok, label).toBe(false);
      expect(w.module.status().objects, label).toBe(0);
      w.consistent();
      expect(walk(w.base).filter((p) => p.includes('escape')), label).toEqual([]);
      expect(({} as Record<string, unknown>).x, label).toBeUndefined();
    }
  }, 60_000);
});

// --- scale ----------------------------------------------------------------------------------------------------

describe('scale', () => {
  it('5,000 objects and 100,000 measurements: every read stays quick', () => {
    const w = world({ seed: false });
    const store = w.module.store;
    const ids: string[] = [];
    store.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        const id = w.module.engine.newObjectId();
        store.createObject(id, { id: null, name: `Thing ${String(i).padStart(4, '0')}`, category: 'tool', make: '', model: '', serial: '', location: `Shelf ${i % 50}`, status: 'active', notes: '', tags: [], parentId: null }, NOW);
        ids.push(id);
        store.saveSchedule(`sch_scale${String(i).padStart(8, '0')}`, { id: null, objectId: id, title: 'Service', rule: { kind: 'usage', measurementKey: 'hours', every: 100 }, startsAt: NOW, startReading: 0, active: true, notes: '' }, NOW);
        store.saveSchedule(`sch_timed${String(i).padStart(8, '0')}`, { id: null, objectId: id, title: 'Check', rule: { kind: 'time', every: 6, unit: 'months' }, startsAt: '2026-01-01T00:00:00.000Z', startReading: null, active: true, notes: '' }, NOW);
        for (let m = 0; m < 20; m++) {
          store.addMeasurement(`msr_s${String(i).padStart(5, '0')}${String(m).padStart(3, '0')}`, { objectId: id, key: 'hours', value: m * 5 + (i % 7), unit: 'h', measuredAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + m * 86_400_000).toISOString(), note: '' }, NOW);
        }
      }
    });
    expect(w.module.status().objects).toBe(5000);

    const time = <T>(label: string, budgetMs: number, work: () => T): T => {
      const started = performance.now();
      const out = work();
      const took = performance.now() - started;
      expect(took, `${label} took ${Math.round(took)} ms`).toBeLessThan(budgetMs);
      return out;
    };
    const summary = time('attention', 3000, () => w.module.attentionView());
    expect(summary.summary.counts.overdue + summary.summary.counts.dueSoon).toBeGreaterThan(0);
    time('status', 300, () => w.module.status());
    const first = time('list', 1000, () => ok(w.module.listObjects({})));
    expect(first).toHaveLength(500);
    time('search', 1000, () => ok(w.module.listObjects({ search: 'Thing 4999' })));
    time('filter', 1000, () => ok(w.module.listObjects({ location: 'Shelf 7' })));
    const detail = time('detail', 300, () => ok(w.module.objectDetail(ids[4321])));
    expect(detail.measurements).toHaveLength(20);
    time('history', 300, () => ok(w.module.timeline({ objectId: ids[4321] })));
    time('locations', 300, () => w.module.locations());
  }, 120_000);
});
