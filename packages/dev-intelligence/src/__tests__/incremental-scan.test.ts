import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

describe('incremental scanning', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('unchanged repos stay cheap (skip heavy work when fingerprint unchanged)', async () => {
    workspace = await createTempWorkspace('di-incr-');
    const repo = await createGitRepo(workspace, 'incr', { commits: 1 });
    await writeFile(
      join(repo.path, 'src.ts'),
      '// TODO: first\nexport const a = 1;\n',
      'utf8',
    );
    await writeFile(
      join(repo.path, 'package.json'),
      JSON.stringify({ name: 'incr', dependencies: { leftpad: '1.0.0' } }),
      'utf8',
    );

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [
          { path: repo.path, domain: domains.defaultDomain() },
        ],
      }),
      incremental: true,
      runHealth: false,
      sourceIdentity: 'test-incr',
    });

    const first = await orch.runScan();
    expect(first.scanRun.state).toBe('COMPLETED');
    expect(first.meta[0]!.skippedHeavy).toBe(false);
    expect(first.meta[0]!.todosTouched).toBeGreaterThan(0);
    expect(first.meta[0]!.techObserved).toBeGreaterThan(0);

    const todosAfterFirst = await persistence.todos.listByRepository(
      first.repositories[0]!.id,
      { status: 'open' },
    );
    expect(todosAfterFirst.length).toBeGreaterThan(0);

    const second = await orch.runScan();
    expect(second.scanRun.state).toBe('COMPLETED');
    expect(second.meta[0]!.skippedHeavy).toBe(true);
    expect(second.meta[0]!.todosTouched).toBe(0);
    expect(second.meta[0]!.techObserved).toBe(0);

    // Durable TODOs remain
    const todosAfterSecond = await persistence.todos.listByRepository(
      first.repositories[0]!.id,
      { status: 'open' },
    );
    expect(todosAfterSecond.length).toBe(todosAfterFirst.length);

    persistence.close();
  });
});
