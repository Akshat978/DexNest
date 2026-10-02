/**
 * Bait: private-looking data planted everywhere GhostOS must not look -
 * other modules' events, audit rows, DI's other event types, commit
 * subject lines and author emails, a repository inside DexNest's data and a
 * file under it. After GhostOS is turned on, synced and has detected its
 * habits, no marker may appear in any ghost_ table, and every read of the
 * event log must have been the one allowed query.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataBoundary } from '@dexnest/foundation';
import { assertSafeTestPath } from '@dexnest/foundation/testing';
import { createAllowedEventReader, NEVER_READ, refuseEventRead, RefusedReadError } from '../index.ts';
import { createWorld, daysBefore, repo, tech, type World } from './world.ts';

const MARK = 'BAIT-7f3a';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

function baited(): { w: World; dataRoot: string } {
  const base = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'ghost-bait-')));
  const dataRoot = join(base, 'dexnest-data');
  for (const dir of ['files/vault', 'files/receipts', 'files/captures', 'data']) mkdirSync(join(dataRoot, dir), { recursive: true });
  writeFileSync(join(dataRoot, 'files/vault', 'secret.txt'), `${MARK} vault file`);
  writeFileSync(join(dataRoot, 'files/receipts', 'r.txt'), `${MARK} receipt`);
  const insideRepo = join(dataRoot, 'files', 'captures', 'repo');
  mkdirSync(insideRepo, { recursive: true });

  const boundary = createDataBoundary({ dataRoot });
  const w = createWorld({ isSensitive: (p) => boundary.isSensitive(p) });
  cleanup.push(() => {
    w.dispose();
    rmSync(base, { recursive: true, force: true });
  });

  // Other modules' private events, with the marker in every field that can carry text.
  for (const name of NEVER_READ) {
    w.log.append({ type: `${name}.item.saved`, stream: name, module: name, subject: `${MARK}-${name}`, source: name, payload: { text: `${MARK} ${name}`, title: MARK } });
  }
  w.log.append({ type: 'action_executed', stream: 'audit', module: 'vault', source: 'module_ui', payload: { summary: `${MARK} audit`, metadataJson: { note: MARK } } });
  // DI's other event types, in the right stream and module.
  for (const type of ['dev.todo.observed', 'dev.branch.changed', 'dev.working_tree.changed', 'dev.technology.observed']) {
    w.log.append({ type, stream: 'dev', module: 'developer_intelligence', subject: 'repo-app', source: 'developer_intelligence', payload: { text: MARK, path: `/home/dev/app/${MARK}` } });
  }
  // A commit type in another stream, and one claiming another module.
  w.log.append({ type: 'dev.commit.observed', stream: 'vault', module: 'developer_intelligence', subject: 'repo-app', source: 'x', payload: { sha: 'eeeeeee', authorDate: '2026-06-01T00:00:00Z', subject: MARK } });
  w.log.append({ type: 'dev.commit.observed', stream: 'dev', module: 'finance', subject: 'repo-app', source: 'x', payload: { sha: 'fffffff', authorDate: '2026-06-01T00:00:00Z', subject: MARK } });

  // DI data: one ordinary repository, one inside DexNest's data.
  w.repos.push(repo('repo-app', '/home/dev/app', 'app'), repo('repo-hidden', insideRepo, `${MARK} hidden`));
  w.techs.push(tech('repo-app', 'TypeScript'), tech('repo-hidden', `${MARK}lang`));
  for (let i = 0; i < 12; i++) {
    w.commit('repo-app', `abc${String(i).padStart(4, '0')}`, daysBefore(w.clock.now, i, '19:00'), { subject: `${MARK} subject ${i}`, authorEmail: `${MARK}@example.test`, body: MARK, branch: MARK });
    w.commit('repo-hidden', `def${String(i).padStart(4, '0')}`, daysBefore(w.clock.now, i, '08:00'), { subject: MARK });
  }
  return { w, dataRoot };
}

describe('bait', () => {
  it('nothing GhostOS must not read ends up in GhostOS', async () => {
    const { w } = baited();
    w.engine.enable('developer_intelligence');
    const out = await w.sync();
    expect(out.status).toBe('completed');
    expect(out.habits.length).toBeGreaterThan(0);
    expect(out.skippedSource).toBe(1);

    const dump = w.dump();
    expect(dump).toContain('abc0000'); // it did record the allowed facts
    expect(dump).not.toContain(MARK);
    expect(dump).not.toContain('example.test');
    expect(dump).not.toContain('eeeeeee');
    expect(dump).not.toContain('fffffff');
    expect(dump).not.toContain('def0000');
    expect(JSON.stringify(w.store.exportAll(w.clock.now))).not.toContain(MARK);
  });

  it('every event-log read was the allowed one', async () => {
    const { w } = baited();
    w.engine.enable('developer_intelligence');
    await w.sync();
    await w.sync();
    expect(w.queries.length).toBeGreaterThan(0);
    for (const q of w.queries) {
      expect(refuseEventRead(q), JSON.stringify(q)).toBeNull();
      expect(q).toMatchObject({ stream: 'dev', module: 'developer_intelligence', types: ['dev.commit.observed'] });
    }
  });

  it('the repository inside DexNest\'s data is not read past its record', async () => {
    const { w } = baited();
    w.engine.enable('developer_intelligence');
    await w.sync();
    expect(w.techRequests).toEqual(['repo-app']);
    expect(w.queries.some((q) => q.subject === 'repo-hidden')).toBe(false);
  });
});

describe('the allowed event reader', () => {
  it('refuses any other query before touching the log', () => {
    const calls: unknown[] = [];
    const reader = createAllowedEventReader({
      query(filter) {
        calls.push(filter);
        return [];
      },
    });
    const refused = [
      { stream: 'dev', module: 'developer_intelligence', types: ['dev.todo.observed'], limit: 10 },
      { stream: 'vault', module: 'vault', types: ['vault.item.saved'], limit: 10 },
      { stream: 'dev', module: 'developer_intelligence', types: [], limit: 10 },
      { stream: 'dev', module: 'developer_intelligence', limit: 10 },
      { stream: 'audit', module: 'developer_intelligence', types: ['dev.commit.observed'], limit: 10 },
    ];
    for (const q of refused) expect(() => reader.query(q), JSON.stringify(q)).toThrow(RefusedReadError);
    expect(() => reader.latestSeq({ stream: 'finance', module: 'finance', types: ['finance.entry.saved'] })).toThrow(RefusedReadError);
    expect(calls).toEqual([]);
    expect(reader.query({ stream: 'dev', module: 'developer_intelligence', types: ['dev.commit.observed'], limit: 10 })).toEqual({ commits: [], lastSeq: null, rows: 0 });
    expect(calls.length).toBe(1);
  });
});
