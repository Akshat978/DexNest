import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeTestPath, createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import {
  createObjectEngine,
  EXPORT_JSON_NAME,
  MAX_FILE_BYTES,
  openObjectStore,
  parseObjectInput,
  parsePurchaseInput,
  type ObjectEngine,
  type ObjectStore,
} from '../index.ts';
import { createTestPort, memoryArchive, sha256Of, type TestPort } from './node-port.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});

let n = 0;
interface World {
  base: string;
  dataRoot: string;
  outside: string;
  db: TestDatabase;
  store: ObjectStore;
  port: TestPort;
  engine: ObjectEngine;
}

function world(): World {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'obj-engine-')));
  const dataRoot = join(base, 'dexnest-data');
  const outside = join(base, 'home');
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const db = createTestDatabase('obj-engine-db-');
  cleanups.push(() => {
    db.dispose();
    rmSync(base, { recursive: true, force: true });
  });
  const store = openObjectStore(db.db, { now: NOW });
  const port = createTestPort(dataRoot);
  let seed = 0;
  const engine = createObjectEngine({
    store,
    files: port,
    newToken: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    // Distinct ids in order: the counter's base-32 digits, least significant last.
    randomBytes: (len) => {
      seed += 1;
      return Array.from({ length: len }, (_, i) => Math.floor(seed / 32 ** (len - 1 - i)) % 32);
    },
  });
  return { base, dataRoot, outside, db, store, port, engine };
}

function withObject(w: World, name = 'Prusa MK4') {
  const id = w.engine.newObjectId();
  const d = parseObjectInput({ name, category: 'printer' });
  if (!d.ok) throw new Error('setup');
  w.store.createObject(id, d.value, NOW);
  return id;
}

function source(w: World, name: string, content: string | Buffer = 'manual contents') {
  const path = join(w.outside, name);
  writeFileSync(path, content);
  return path;
}

describe('attaching a file', () => {
  it('copies it into the object folder, hashes it, records it; the first photo becomes the photo', async () => {
    const w = world();
    const id = withObject(w);
    const src = source(w, 'Front view.jpg', Buffer.alloc(5000, 7));
    const r = await w.engine.attachFile({ objectId: id, sourcePath: src, role: 'photo', now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = join(w.port.folderOf(id), r.value.storedName);
    expect(existsSync(stored)).toBe(true);
    expect(r.value).toMatchObject({ name: 'Front view.jpg', type: 'image/jpeg', sizeBytes: 5000, sha256: sha256Of(src), role: 'photo' });
    expect(w.store.getObject(id)?.photoFileId).toBe(r.value.id);
    // The original stays where it was; ObjectOS keeps a copy.
    expect(existsSync(src)).toBe(true);
  });

  it('a receipt becomes the purchase receipt', async () => {
    const w = world();
    const id = withObject(w);
    const p = parsePurchaseInput({ objectId: id, shop: 'Shop' });
    if (p.ok) w.store.savePurchase(p.value, NOW);
    const r = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'receipt.pdf'), role: 'receipt', now: NOW });
    expect(r.ok && w.store.purchaseOf(id)?.receiptFileId).toBe(r.ok ? r.value.id : null);
  });

  it('refuses a missing file, a folder, an empty file and one over the limit - without copying anything', async () => {
    const w = world();
    const id = withObject(w);
    const big = source(w, 'huge.bin', '');
    truncateSync(big, MAX_FILE_BYTES + 1); // sparse: no real 200 MB written
    const empty = source(w, 'empty.txt', '');
    const cases: [string, RegExp][] = [
      [join(w.outside, 'nope.pdf'), /does not exist/],
      [w.outside, /not a file/],
      [empty, /empty/],
      [big, /larger than 200 MB/],
    ];
    for (const [path, message] of cases) {
      const r = await w.engine.attachFile({ objectId: id, sourcePath: path, role: 'manual', now: NOW });
      expect(r.ok, path).toBe(false);
      expect(r.ok ? '' : r.errors.join(), path).toMatch(message);
    }
    expect(w.port.calls.filter((c) => c.startsWith('copyIn'))).toEqual([]);
    expect(w.store.files(id)).toEqual([]);
  });

  it('a copy that fails half way leaves no file and no row', async () => {
    const w = world();
    const id = withObject(w);
    w.port.failCopyAfterBytes = 100;
    await expect(w.engine.attachFile({ objectId: id, sourcePath: source(w, 'manual.pdf', Buffer.alloc(100_000, 1)), role: 'manual', now: NOW })).rejects.toThrow(/injected/);
    expect(w.store.files(id)).toEqual([]);
    expect(existsSync(w.port.folderOf(id)) ? readdirSync(w.port.folderOf(id)) : []).toEqual([]);
  });

  it('a record that cannot be written removes the copy', async () => {
    const w = world();
    const id = withObject(w);
    const photo = source(w, 'p.jpg', 'x');
    // Another object's photo can never be this one's: make the row write fail after the copy.
    const original = w.store.addFile;
    w.store.addFile = () => {
      throw new Error('database is locked');
    };
    await expect(w.engine.attachFile({ objectId: id, sourcePath: photo, role: 'photo', now: NOW })).rejects.toThrow('database is locked');
    w.store.addFile = original;
    expect(readdirSync(w.port.folderOf(id))).toEqual([]);
  });
});

describe('opening, removing, deleting', () => {
  it('opens a stored file; an executable is only shown in its folder', async () => {
    const w = world();
    const id = withObject(w);
    const pdf = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'manual.pdf'), role: 'manual', now: NOW });
    const exe = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'Firmware Updater.EXE'), role: 'other', now: NOW });
    if (!pdf.ok || !exe.ok) throw new Error('setup');
    expect(w.engine.decideOpen(pdf.value.id)).toMatchObject({ ok: true, value: { action: 'open' } });
    expect(w.engine.decideOpen(exe.value.id)).toMatchObject({ ok: true, value: { action: 'show_in_folder' } });
  });

  it('refuses to open a file that went missing or was replaced by a link out of the folder', async () => {
    const w = world();
    const id = withObject(w);
    const r = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'manual.pdf'), role: 'manual', now: NOW });
    if (!r.ok) throw new Error('setup');
    const stored = join(w.port.folderOf(id), r.value.storedName);
    unlinkSync(stored);
    symlinkSync(source(w, 'elsewhere.pdf'), stored);
    expect(w.engine.decideOpen(r.value.id)).toMatchObject({ ok: false });
    unlinkSync(stored);
    expect(w.engine.decideOpen(r.value.id).ok).toBe(false);
    expect(w.engine.decideOpen('not-an-id').ok).toBe(false);
  });

  it('removing a file deletes its bytes; deleting an object deletes its folder and detaches its components', async () => {
    const w = world();
    const id = withObject(w);
    const child = w.engine.newObjectId();
    const d = parseObjectInput({ name: 'Hotend', parentId: id });
    if (!d.ok) throw new Error('setup');
    w.store.createObject(child, d.value, NOW);
    const a = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'a.pdf'), role: 'manual', now: NOW });
    const b = await w.engine.attachFile({ objectId: id, sourcePath: source(w, 'b.pdf'), role: 'manual', now: NOW });
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(w.engine.removeFile(a.value.id).ok).toBe(true);
    expect(existsSync(join(w.port.folderOf(id), a.value.storedName))).toBe(false);
    const out = w.engine.deleteObject(id, NOW);
    expect(out.ok && out.value.childrenDetached).toEqual([child]);
    expect(existsSync(w.port.folderOf(id))).toBe(false);
    expect(w.store.getObject(child)?.parentId).toBeNull();
  });
});

describe('reminders', () => {
  it('are off by default: nothing is claimed or computed', () => {
    const w = world();
    expect(w.engine.runReminders({ occurrenceId: 'reminders:2026-06-30', trigger: 'scheduled', now: NOW })).toMatchObject({ status: 'skipped', reason: 'reminders are off' });
    expect(w.store.getRunByOccurrence('reminders:2026-06-30')).toBeUndefined();
  });

  it('when on, a slot delivered twice runs once, and says counts only', () => {
    const w = world();
    const id = withObject(w, 'SECRET printer');
    const p = parsePurchaseInput({ objectId: id, shop: 'SECRET shop', warrantyUntil: '2026-07-10' });
    if (p.ok) w.store.savePurchase(p.value, NOW);
    w.store.saveModuleSettings({ schemaVersion: 1, reminders: { enabled: true } }, NOW);
    const first = w.engine.runReminders({ occurrenceId: 'reminders:2026-06-30', trigger: 'scheduled', now: NOW });
    expect(first).toMatchObject({ status: 'completed', counts: { warrantyEnding: 1 }, text: '1 warranty ending' });
    expect(JSON.stringify(first)).not.toContain('SECRET');
    expect(w.engine.runReminders({ occurrenceId: 'reminders:2026-06-30', trigger: 'scheduled', now: NOW })).toMatchObject({ status: 'skipped', reason: 'this occurrence already ran' });
  });
});

describe('export and import', () => {
  async function exported(w: World) {
    const printer = withObject(w, 'Printer');
    const hotend = w.engine.newObjectId();
    const d = parseObjectInput({ name: 'Hotend', parentId: printer });
    if (!d.ok) throw new Error('setup');
    w.store.createObject(hotend, d.value, NOW);
    await w.engine.attachFile({ objectId: printer, sourcePath: source(w, 'manual.pdf', Buffer.alloc(3000, 2)), role: 'manual', now: NOW });
    await w.engine.attachFile({ objectId: hotend, sourcePath: source(w, 'hotend.stl', Buffer.alloc(2000, 3)), role: 'model', now: NOW });
    const b = w.engine.exportBundle([printer], NOW);
    if (!b.ok) throw new Error(b.errors.join());
    const entries = new Map(b.value.files.map((f) => [f.zipPath, readFileSync(f.sourcePath)]));
    return { printer, hotend, bundle: b.value, entries, json: JSON.stringify(b.value.data) };
  }

  it('exports an object with its components and their files', async () => {
    const w = world();
    const { printer, hotend, bundle } = await exported(w);
    expect(bundle.data.objects.map((o) => o.id).sort()).toEqual([hotend, printer].sort());
    expect(bundle.files.map((f) => f.zipPath).sort()).toEqual(bundle.data.files.map((f) => `files/${f.objectId}/${f.storedName}`).sort());
    expect(bundle.missing).toEqual([]);
  });

  it('leaves out, and reports, a file whose bytes are gone - the export stays importable', async () => {
    const w = world();
    const { printer } = await exported(w);
    const f = w.store.files(printer)[0]!;
    rmSync(join(w.port.folderOf(printer), f.storedName));
    const b = w.engine.exportBundle([printer], NOW);
    expect(b.ok && b.value.missing.map((m) => m.id)).toEqual([f.id]);
    expect(b.ok && b.value.data.files.some((x) => x.id === f.id)).toBe(false);
  });

  it('imports rows and files into another ObjectOS, verifying every file', async () => {
    const w = world();
    const { entries, json, printer, hotend } = await exported(w);
    const target = world();
    const r = await target.engine.importArchive(memoryArchive(target.port, entries, json));
    expect(r.ok && r.value.objects.sort()).toEqual([hotend, printer].sort());
    for (const f of target.store.files(printer)) expect(sha256Of(join(target.port.folderOf(printer), f.storedName))).toBe(f.sha256);
    expect(target.store.getObject(hotend)?.parentId).toBe(printer);
  });

  it('refuses a zip with no manifest, bad JSON, a missing or wrong-sized file - writing nothing', async () => {
    const w = world();
    const { entries, json } = await exported(w);
    const target = world();
    const first = [...entries.keys()][0]!;
    const cases: [Map<string, Buffer>, string | null, RegExp][] = [
      [entries, null, new RegExp(EXPORT_JSON_NAME)],
      [entries, '{ nope', /not JSON/],
      [new Map([...entries].filter(([k]) => k !== first)), json, /missing a file/],
      [new Map([...entries].map(([k, v]) => [k, k === first ? Buffer.concat([v, Buffer.from('x')]) : v])), json, /does not match/],
    ];
    for (const [e, j, message] of cases) {
      const r = await target.engine.importArchive(memoryArchive(target.port, e, j));
      expect(r.ok ? '' : r.errors.join()).toMatch(message);
    }
    expect(target.store.listObjects()).toEqual([]);
  });

  it('a file whose bytes do not match its hash stops the import and removes what was copied', async () => {
    const w = world();
    const { entries, json, printer, hotend } = await exported(w);
    const target = world();
    const keys = [...entries.keys()].sort();
    const tampered = new Map(entries);
    tampered.set(keys[1]!, Buffer.alloc(entries.get(keys[1]!)!.length, 9)); // same size, other bytes
    const r = await target.engine.importArchive(memoryArchive(target.port, tampered, json));
    expect(r.ok).toBe(false);
    expect(target.store.listObjects()).toEqual([]);
    for (const id of [printer, hotend]) expect(existsSync(target.port.folderOf(id)) ? readdirSync(target.port.folderOf(id)) : [], id).toEqual([]);
  });

  it('a failure writing the rows removes the copied files', async () => {
    const w = world();
    const { entries, json, printer } = await exported(w);
    const target = world();
    await expect(
      target.engine.importArchive(memoryArchive(target.port, entries, json), () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(target.store.listObjects()).toEqual([]);
    expect(existsSync(target.port.folderOf(printer)) ? readdirSync(target.port.folderOf(printer)) : []).toEqual([]);
  });

  it('objects already here are skipped, and their files are not copied again', async () => {
    const w = world();
    const { entries, json } = await exported(w);
    const copies: string[] = [];
    const archive = memoryArchive(w.port, entries, json);
    const original = archive.copyEntry;
    archive.copyEntry = async (...args) => {
      copies.push(args[0]);
      return original(...args);
    };
    const r = await w.engine.importArchive(archive);
    expect(r.ok && r.value.objects).toEqual([]);
    expect(copies).toEqual([]);
  });
});
