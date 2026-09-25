import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_STREAM,
  ModuleMigrationError,
  inspectModuleMigrations,
  runModuleMigrations,
} from '@dexnest/foundation';
import {
  fingerprintCommitObserved,
  type DeveloperEvent,
} from '@dexnest/dev-intelligence-contracts';
import { createSqlitePersistence, type TestPersistence } from '../testing.ts';
import {
  DEV_INTELLIGENCE_MIGRATIONS,
  DEV_INTELLIGENCE_MODULE,
  STANDUP_MIGRATIONS,
  STANDUP_MODULE,
  manifestProblems,
  runDevIntelligenceMigrations,
} from '../index.ts';

function commitEvent(eventId: string, sha: string, observedAt: string): DeveloperEvent {
  return {
    schemaVersion: 1,
    eventId,
    type: 'dev.commit.observed',
    repositoryId: 'repo_1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    observedAt,
    source: 'test',
    sourceIdentity: 't',
    fingerprint: fingerprintCommitObserved('repo_1', sha),
    payload: { sha, subject: `commit ${sha}`, authorDate: '2026-01-01T00:00:00.000Z' },
  };
}

async function seedRepository(p: TestPersistence): Promise<void> {
  await p.repositories.upsertRepository({
    schemaVersion: 1,
    id: 'repo_1',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    roots: [{ path: '/tmp/r', domain: 'wsl' }],
    displayName: 'r',
  });
}

describe('Developer Intelligence on the shared foundation', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  async function open(): Promise<TestPersistence> {
    if (!dir) dir = await mkdtemp(join(tmpdir(), 'dev-store-'));
    return createSqlitePersistence({ dbPath: join(dir, 'dexnest.sqlite') });
  }

  it('declares manifests that stay inside their prefixes and namespaces', () => {
    expect(manifestProblems()).toEqual([]);
  });

  it('records both modules in the shared ledger and applies nothing twice', async () => {
    const p = await open();
    const dev = inspectModuleMigrations(p.database, DEV_INTELLIGENCE_MODULE, DEV_INTELLIGENCE_MIGRATIONS);
    const standup = inspectModuleMigrations(p.database, STANDUP_MODULE, STANDUP_MIGRATIONS);
    expect(dev.applied).toEqual([1, 2]);
    expect(dev.pending).toEqual([]);
    expect(standup.applied).toEqual([10]);

    const again = runDevIntelligenceMigrations(p.database);
    expect(again.developerIntelligence.applied).toEqual([]);
    expect(again.standup.applied).toEqual([]);
    p.close();

    const reopened = await open();
    const afterRestart = runDevIntelligenceMigrations(reopened.database);
    expect(afterRestart.developerIntelligence.applied).toEqual([]);
    reopened.close();
  });

  it('rolls back a failing migration and leaves it pending', async () => {
    const p = await open();
    const broken = [
      ...DEV_INTELLIGENCE_MIGRATIONS,
      {
        version: 3,
        name: 'broken',
        sql: 'CREATE TABLE dev_half_done (id TEXT); INSERT INTO dev_no_such_table VALUES (1);',
      },
    ];
    expect(() => runModuleMigrations(p.database, DEV_INTELLIGENCE_MODULE, broken)).toThrow(ModuleMigrationError);

    const state = inspectModuleMigrations(p.database, DEV_INTELLIGENCE_MODULE, broken);
    expect(state.applied).not.toContain(3);
    expect(state.pending).toEqual([3]);
    // The table created before the failing statement was rolled back with it.
    const half = p.db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dev_half_done'`);
    expect(half).toBeUndefined();
    p.close();
  });

  it('keeps every module table namespaced in the shared database', async () => {
    const p = await open();
    const tables = p.db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => row.name);
    const stray = tables.filter(
      (name) =>
        !name.startsWith('dev_') &&
        !name.startsWith('standup_') &&
        !name.startsWith('sqlite_') &&
        name !== 'event_log' &&
        name !== 'dexnest_module_migrations',
    );
    expect(stray).toEqual([]);
    expect(tables).not.toContain('developer_events');
    expect(tables).not.toContain('schema_migrations');
    p.close();
  });

  it('writes developer events to the shared log, idempotently, across restarts', async () => {
    const p = await open();
    await seedRepository(p);

    expect(await p.events.append(commitEvent('evt_1', 'abc', '2026-01-02T00:00:00.000Z'))).toBe(true);
    // Same observation under a new event id: a replay, recorded once.
    expect(await p.events.append(commitEvent('evt_2', 'abc', '2026-01-02T00:05:00.000Z'))).toBe(false);

    const stored = p.eventLog.get('evt_1');
    expect(stored?.stream).toBe('dev');
    expect(stored?.module).toBe(DEV_INTELLIGENCE_MODULE);
    expect(stored?.subject).toBe('repo_1');
    expect(p.eventLog.get('evt_2')).toBeUndefined();
    // The audit stream, which the Command home and Heatmap read, is untouched.
    expect(p.eventLog.query({ stream: AUDIT_STREAM })).toEqual([]);
    p.close();

    const reopened = await open();
    expect(await reopened.events.append(commitEvent('evt_3', 'abc', '2026-01-03T00:00:00.000Z'))).toBe(false);
    const found = await reopened.events.findByFingerprint(fingerprintCommitObserved('repo_1', 'abc'));
    expect(found?.eventId).toBe('evt_1');
    expect(found?.observedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(await reopened.events.listByRepository('repo_1')).toHaveLength(1);
    reopened.close();
  });

  it('indexes an observed commit once, with its event', async () => {
    const p = await open();
    await seedRepository(p);
    await p.events.append(commitEvent('evt_1', 'abc', '2026-01-02T00:00:00.000Z'));
    await p.events.append(commitEvent('evt_2', 'abc', '2026-01-02T00:05:00.000Z'));
    await p.events.append(commitEvent('evt_3', 'def', '2026-01-02T00:06:00.000Z'));

    const commits = p.db.all<{ sha: string }>(
      `SELECT sha FROM dev_observed_commits WHERE repository_id = 'repo_1' ORDER BY sha`,
    );
    expect(commits.map((c) => c.sha)).toEqual(['abc', 'def']);
    p.close();
  });

  it('filters "since" on when an event was observed, not when it happened', async () => {
    const p = await open();
    await seedRepository(p);
    // Both commits were authored long ago; only the second was observed after the cut.
    await p.events.append(commitEvent('evt_old', 'abc', '2026-01-02T00:00:00.000Z'));
    await p.events.append(commitEvent('evt_new', 'def', '2026-01-05T00:00:00.000Z'));

    const since = await p.events.listByRepository('repo_1', { since: '2026-01-03T00:00:00.000Z' });
    expect(since.map((e) => e.eventId)).toEqual(['evt_new']);
    const typed = await p.events.listByRepository('repo_1', { type: 'dev.todo.observed' });
    expect(typed).toEqual([]);
    p.close();
  });
});
