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
