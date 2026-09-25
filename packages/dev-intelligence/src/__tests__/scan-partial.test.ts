import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import {
  cleanup,
  createBrokenRepoDir,
  createGitRepo,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('scan partial failure isolation', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('one broken repo does not fail entire scan (PARTIAL)', async () => {
    workspace = await createTempWorkspace();
    const good = await createGitRepo(workspace, 'good-repo', { commits: 1 });
    const broken = await createBrokenRepoDir(workspace, 'broken-repo');

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const domain = domains.defaultDomain();

    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [
          { path: good.path, domain },
          { path: broken, domain },
        ],
      }),
      concurrency: 2,
      runHealth: false,
      sourceIdentity: 'test-partial',
    });

    const result = await orch.runScan();
    expect(result.scanRun.state).toBe('PARTIAL');
    expect(result.scanRun.repositoriesSucceeded).toBe(1);
    expect(result.scanRun.repositoriesFailed).toBe(1);
    expect(result.snapshots.length).toBe(1);
    expect(result.snapshots[0]!.git.headSha).toBeTruthy();

    persistence.close();
  });
});
