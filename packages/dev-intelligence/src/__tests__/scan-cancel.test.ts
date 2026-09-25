import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import type { ProcessInvocationRequest, ProcessRunnerPort } from '@dexnest/dev-intelligence-contracts';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

/** Runner that stalls git status so cancel can win mid-scan. */
class SlowGitRunner implements ProcessRunnerPort {
  private readonly inner = new LocalProcessRunner();
  hits = 0;

  async run(req: ProcessInvocationRequest) {
    this.hits += 1;
    if (req.argv[0] === 'git' && req.argv.includes('status')) {
      await new Promise((r) => setTimeout(r, 2_000));
    }
    return this.inner.run(req);
  }
}

describe('scan cancellation (Phase 2 carry-over)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('CANCELLED recorded; no false COMPLETED; completed repos remain durable', async () => {
    workspace = await createTempWorkspace('di-cancel-');
    const repoA = await createGitRepo(workspace, 'repo-a', { commits: 1 });
    const repoB = await createGitRepo(workspace, 'repo-b', { commits: 1 });

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const domain = domains.defaultDomain();
    const slow = new SlowGitRunner();

    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [
          { path: repoA.path, domain },
          { path: repoB.path, domain },
        ],
      }),
      concurrency: 1,
      runner: slow,
      runHealth: false,
      sourceIdentity: 'test-cancel',
    });

    const scanPromise = orch.runScan();
    // Cancel shortly after start — while slow status is in flight
    await new Promise((r) => setTimeout(r, 150));
    orch.requestCancel();

    const result = await scanPromise;
    expect(result.scanRun.state).toBe('CANCELLED');
    expect(result.scanRun.state).not.toBe('COMPLETED');
    expect(result.scanRun.cancelRequested).toBe(true);

    const stored = await persistence.scanRuns.get(result.scanRun.id);
    expect(stored?.state).toBe('CANCELLED');

    // Any repos that finished before cancel remain durable
    for (const repo of result.repositories) {
      const snap = await persistence.repositories.getLatestSnapshot(repo.id);
      expect(snap).toBeTruthy();
    }

    persistence.close();
  });
});
