/**
 * Bait: files named like private data, planted in a synthetic DexNest data
 * root - Finance receipts, the Vault, captures, the database, the keychain,
 * another object's attachments. Attaching any of them, directly, through a
 * file link or through a folder link (a junction on Windows), is refused
 * before a byte is read, and nothing about them is recorded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeTestPath, createTestDatabase, makeTestLink } from '@dexnest/foundation/testing';
import { createObjectEngine, openObjectStore, parseObjectInput } from '../index.ts';
import { createTestPort } from './node-port.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const MARK = 'BAIT-4c1d';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0)) f();
});

function setup() {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'obj-bait-')));
  const dataRoot = join(base, 'dexnest-data');
  const home = join(base, 'home');
  const bait: Record<string, string> = {
    receipt: join(dataRoot, 'files', 'receipts', `${MARK}-receipt-2026-03.pdf`),
    vault: join(dataRoot, 'files', 'vault', 'documents', `${MARK}-passport.pdf`),
    capture: join(dataRoot, 'files', 'captures', `${MARK}-screen.png`),
    database: join(dataRoot, 'data', 'dexnest.sqlite'),
    keychain: join(dataRoot, 'settings', `${MARK}-integration-keychain.json`),
    otherObject: join(dataRoot, 'files', 'objects', 'OTHER000', `fil_00000001-${MARK}-manual.pdf`),
  };
  for (const path of Object.values(bait)) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${MARK} private contents`);
  }
  mkdirSync(home, { recursive: true });
  // Links from an innocent-looking place into the data root.
  // A file link needs admin rights on Windows; without them it cannot exist there.
  const fileLinked = makeTestLink(bait.receipt as string, join(home, 'receipt.pdf'));
  makeTestLink(join(dataRoot, 'files', 'vault'), join(home, 'Documents')); // a folder link: a junction on Windows
  const db = createTestDatabase('obj-bait-db-');
  cleanups.push(() => {
    db.dispose();
    rmSync(base, { recursive: true, force: true });
  });
  const store = openObjectStore(db.db, { now: NOW });
  const port = createTestPort(dataRoot);
  const engine = createObjectEngine({ store, files: port, newToken: () => `00000000-0000-4000-8000-${Date.now()}${Math.floor(Math.random() * 1e6)}`, randomBytes: (n) => Array.from({ length: n }, (_, i) => i + 3) });
  const d = parseObjectInput({ name: 'Printer' });
  if (!d.ok) throw new Error('setup');
  const id = engine.newObjectId();
  store.createObject(id, d.value, NOW);
  return { base, dataRoot, home, bait, db, store, port, engine, id, fileLinked };
}

describe('bait', () => {
  it('nothing inside the data root can be attached - directly, through a link, or through a linked folder', async () => {
    const s = setup();
    const attempts = [
      ...Object.values(s.bait),
      ...(s.fileLinked ? [join(s.home, 'receipt.pdf')] : []),
      join(s.home, 'Documents', 'documents', `${MARK}-passport.pdf`),
    ];
    for (const path of attempts) {
      const r = await s.engine.attachFile({ objectId: s.id, sourcePath: path, role: 'receipt', now: NOW });
      expect(r.ok, path).toBe(false);
      expect(r.ok ? '' : r.errors.join(), path).toMatch(/inside DexNest's data/);
    }
    expect(s.port.calls.filter((c) => c.startsWith('copyIn'))).toEqual([]);
    expect(s.store.files(s.id)).toEqual([]);
    expect(s.store.purchaseOf(s.id)).toBeUndefined();

    const dump = JSON.stringify(
      s.db.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'obj\\_%' ESCAPE '\\'")
        .all<{ name: string }>()
        .map((t) => s.db.db.prepare(`SELECT * FROM "${t.name}"`).all()),
    );
    expect(dump).not.toContain(MARK);
    expect(dump).not.toMatch(/passport|keychain|dexnest\.sqlite/);
  });

  it('a file outside the data root is attached normally (the check is not just refusing everything)', async () => {
    const s = setup();
    const ok = join(s.home, 'manual.pdf');
    writeFileSync(ok, 'a manual');
    const r = await s.engine.attachFile({ objectId: s.id, sourcePath: ok, role: 'manual', now: NOW });
    expect(r.ok).toBe(true);
  });
});
