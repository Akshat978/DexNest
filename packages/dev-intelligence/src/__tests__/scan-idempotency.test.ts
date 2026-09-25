import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('scan idempotency', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('repeated unchanged scan does not duplicate commit/events', async () => {
    workspace = await createTempWorkspace();
    const repo = await createGitRepo(workspace, 'alpha', { commits: 2 });

    const dbPath = resolve(workspace, 'di.sqlite');
    const persistence = await createSqlitePersistence({
      dbPath,
      migrationsDir,
    });

    const domains = createDomainRegistry();
    const discovery = defaultDiscoveryConfig({
      roots: [],
      manualRepositories: [{ path: repo.path, domain: domains.defaultDomain() }],
      maxDepth: 2,
    });

    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery,
      concurrency: 2,
      runHealth: false,
      sourceIdentity: 'test-idempotency',
    });

    const first = await orch.runScan();
    expect(first.scanRun.state).toBe('COMPLETED');
    // ok
    expect(first.scanRun.repositoriesSucceeded).toBe(1);

    const eventsAfterFirst = await persistence.events.listByRepository(
      first.repositories[0]!.id,
      { limit: 500 },
    );
    const commitsAfterFirst = eventsAfterFirst.filter(
      (e) => e.type === 'dev.commit.observed',
    );
    expect(commitsAfterFirst.length).toBeGreaterThanOrEqual(1);

    const snapshotEventsFirst = eventsAfterFirst.filter(
      (e) => e.type === 'dev.repo.snapshot',
    );
    expect(snapshotEventsFirst.length).toBe(1);

    const second = await orch.runScan();
    expect(second.scanRun.state).toBe('COMPLETED');

    const eventsAfterSecond = await persistence.events.listByRepository(
      first.repositories[0]!.id,
      { limit: 500 },
    );
    const commitsAfterSecond = eventsAfterSecond.filter(
      (e) => e.type === 'dev.commit.observed',
    );
    expect(commitsAfterSecond.length).toBe(commitsAfterFirst.length);

    const snapshotEventsSecond = eventsAfterSecond.filter(
      (e) => e.type === 'dev.repo.snapshot',
    );
    expect(snapshotEventsSecond.length).toBe(snapshotEventsFirst.length);

    // fingerprints unique
    const fps = new Set(eventsAfterSecond.map((e) => e.fingerprint));
    expect(fps.size).toBe(eventsAfterSecond.length);

    persistence.close();
  });
});
