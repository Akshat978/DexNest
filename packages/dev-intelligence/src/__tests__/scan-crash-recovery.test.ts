import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import {
  cleanup,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('crash recovery (Phase 2 carry-over)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('incomplete scan run found at startup reconciled to FAILED/interrupted', async () => {
    workspace = await createTempWorkspace('di-crash-');
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });

    await persistence.scanRuns.create({
      schemaVersion: 1,
      id: 'scan_orphan_started',
      state: 'STARTED',
      startedAt: '2026-01-01T00:00:00Z',
      repositoriesAttempted: 2,
      repositoriesSucceeded: 1,
      repositoriesFailed: 0,
      checkpoint: JSON.stringify({ phase: 'inspect' }),
    });

    const orch = new ScanOrchestrator({
      persistence,
      domains: createDomainRegistry(),
      discovery: defaultDiscoveryConfig({ roots: [], manualRepositories: [] }),
      runHealth: false,
    });

    const recovered = await orch.recoverInterruptedScans();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.state).toBe('FAILED');
    expect(recovered[0]!.errorSummary).toMatch(/interrupted|crash recovery/i);

    const stored = await persistence.scanRuns.get('scan_orphan_started');
    expect(stored?.state).toBe('FAILED');
    expect(stored?.finishedAt).toBeTruthy();

    const incomplete = await persistence.scanRuns.listIncomplete();
    expect(incomplete).toHaveLength(0);

    persistence.close();
  });
});
