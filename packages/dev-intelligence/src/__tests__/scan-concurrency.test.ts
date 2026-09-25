import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import type {
  ProcessInvocationRequest,
  ProcessRunnerPort,
} from '@dexnest/dev-intelligence-contracts';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

/**
 * One huge/slow repo stalls on first git call; others must still complete
 * under bounded concurrency (slot does not starve forever).
 */
class StarvationProbeRunner implements ProcessRunnerPort {
  private readonly inner = new LocalProcessRunner();
  readonly started = new Map<string, number>();
  readonly finished = new Map<string, number>();
  slowPath: string;

  constructor(slowPath: string) {
    this.slowPath = slowPath;
  }

  async run(req: ProcessInvocationRequest) {
    const key = req.cwd;
    this.started.set(key, (this.started.get(key) ?? 0) + 1);
    if (key === this.slowPath && req.argv[0] === 'git') {
      await new Promise((r) => setTimeout(r, 800));
    }
    const result = await this.inner.run(req);
    this.finished.set(key, (this.finished.get(key) ?? 0) + 1);
    return result;
  }
}

describe('concurrency slot (Phase 2 carry-over)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('one huge/slow repo cannot starve others', async () => {
    workspace = await createTempWorkspace('di-conc-');
    const slow = await createGitRepo(workspace, 'slow-repo', { commits: 1 });
    const fast1 = await createGitRepo(workspace, 'fast-1', { commits: 1 });
    const fast2 = await createGitRepo(workspace, 'fast-2', { commits: 1 });

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const domain = domains.defaultDomain();
    const probe = new StarvationProbeRunner(slow.path);

    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [
          { path: slow.path, domain },
          { path: fast1.path, domain },
          { path: fast2.path, domain },
        ],
      }),
      concurrency: 2,
      runner: probe,
      runHealth: false,
      sourceIdentity: 'test-concurrency',
    });

    const t0 = Date.now();
    const result = await orch.runScan();
    const elapsed = Date.now() - t0;

    expect(result.scanRun.state).toBe('COMPLETED');
    expect(result.scanRun.repositoriesSucceeded).toBe(3);
    // With concurrency 2, fast repos should finish without waiting for full
    // serial slow*3 — wall time well under naive 800*3 serial lower bound.
    expect(elapsed).toBeLessThan(6_000);
    expect(probe.finished.get(fast1.path) ?? 0).toBeGreaterThan(0);
    expect(probe.finished.get(fast2.path) ?? 0).toBeGreaterThan(0);
    expect(probe.finished.get(slow.path) ?? 0).toBeGreaterThan(0);

    persistence.close();
  });
});
