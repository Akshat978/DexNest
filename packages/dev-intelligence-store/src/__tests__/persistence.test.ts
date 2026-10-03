import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '../testing.ts';
import {
  fingerprintCommitObserved,
  type DeveloperEvent,
} from '@dexnest/dev-intelligence-contracts';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('sqlite persistence', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('a repository\'s baseline is absent until set, set once, and never undone', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dev-store-'));
    const p = await createSqlitePersistence({ dbPath: join(dir, 't.sqlite'), migrationsDir });
    const repo = {
      schemaVersion: 1 as const,
      id: 'repo_b',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      roots: [{ path: '/tmp/b', domain: 'wsl' as const }],
    };

    await p.repositories.upsertRepository(repo);
    expect((await p.repositories.getRepository('repo_b'))!.baselinedAt).toBeUndefined();

    await p.repositories.upsertRepository({ ...repo, baselinedAt: '2026-01-01T00:05:00.000Z' });
    expect((await p.repositories.getRepository('repo_b'))!.baselinedAt).toBe('2026-01-01T00:05:00.000Z');

    // A later scan upserts without it, and another tries to move it: neither changes it.
    await p.repositories.upsertRepository({ ...repo, lastSeenAt: '2026-02-01T00:00:00.000Z' });
    await p.repositories.upsertRepository({ ...repo, baselinedAt: '2026-03-01T00:00:00.000Z' });
    const stored = (await p.repositories.listRepositories()).find((r) => r.id === 'repo_b')!;
    expect(stored.baselinedAt).toBe('2026-01-01T00:05:00.000Z');
    expect(stored.lastSeenAt).toBe('2026-01-01T00:00:00.000Z');
    p.close();
  });

  it('applies migrations and idempotently appends events', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dev-store-'));
    const p = await createSqlitePersistence({
      dbPath: join(dir, 't.sqlite'),
      migrationsDir,
    });

    await p.repositories.upsertRepository({
      schemaVersion: 1,
      id: 'repo_1',
      discoveredAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-01T00:00:00Z',
      roots: [{ path: '/tmp/r', domain: 'wsl' }],
      displayName: 'r',
    });

    const fp = fingerprintCommitObserved('repo_1', 'abc');
    const event: DeveloperEvent = {
      schemaVersion: 1,
      eventId: 'evt_1',
      type: 'dev.commit.observed',
      repositoryId: 'repo_1',
      occurredAt: '2026-01-01T00:00:00Z',
      observedAt: '2026-01-01T00:00:00Z',
      source: 'test',
      sourceIdentity: 't',
      fingerprint: fp,
      payload: { sha: 'abc', subject: 's', authorDate: '2026-01-01T00:00:00Z' },
    };

    expect(await p.events.append(event)).toBe(true);
    expect(
      await p.events.append({ ...event, eventId: 'evt_2' }),
    ).toBe(false);

    const listed = await p.events.listByRepository('repo_1');
    expect(listed).toHaveLength(1);

    await p.scanRuns.create({
      schemaVersion: 1,
      id: 'scan_1',
      state: 'STARTED',
      startedAt: '2026-01-01T00:00:00Z',
      repositoriesAttempted: 0,
      repositoriesSucceeded: 0,
      repositoriesFailed: 0,
    });
    const incomplete = await p.scanRuns.listIncomplete();
    expect(incomplete).toHaveLength(1);

    p.close();
  });
});
