import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import type {
  HealthCheck,
  ProcessInvocationRequest,
  ProcessRunnerPort,
} from '@dexnest/dev-intelligence-contracts';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import {
  runConfiguredHealthCheck,
  runEnabledHealthChecks,
} from '../health/runner.js';
import { listDiscoveredScriptCandidates } from '../health/auto-discover.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

class RecordingRunner implements ProcessRunnerPort {
  readonly calls: ProcessInvocationRequest[] = [];
  private readonly inner = new LocalProcessRunner();

  async run(req: ProcessInvocationRequest) {
    this.calls.push(req);
    return this.inner.run(req);
  }
}

describe('configured health checks ONLY', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('PASS / FAIL / TIMEOUT / COMMAND_MISSING / CANCELLED / EXECUTION_ERROR', async () => {
    workspace = await createTempWorkspace('di-health-');
    const repo = await createGitRepo(workspace, 'h', { commits: 1 });
    const runner = new LocalProcessRunner();
    const base = {
      schemaVersion: 1 as const,
      repositoryId: 'repo_h',
      enabled: true,
      cwd: repo.path,
      domain: 'wsl' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    };

    const passCheck: HealthCheck = {
      ...base,
      id: 'hc_pass',
      name: 'pass',
      argv: ['node', '-e', 'process.exit(0)'],
      timeoutMs: 5_000,
    };
    const failCheck: HealthCheck = {
      ...base,
      id: 'hc_fail',
      name: 'fail',
      argv: ['node', '-e', 'process.exit(2)'],
      timeoutMs: 5_000,
    };
    const timeoutCheck: HealthCheck = {
      ...base,
      id: 'hc_to',
      name: 'timeout',
      argv: ['node', '-e', 'setTimeout(()=>{}, 30_000)'],
      timeoutMs: 300,
    };
    const missingCheck: HealthCheck = {
      ...base,
      id: 'hc_miss',
      name: 'missing',
      argv: ['definitely-not-a-real-binary-xyz'],
      timeoutMs: 5_000,
    };
    const emptyCheck: HealthCheck = {
      ...base,
      id: 'hc_empty',
      name: 'empty',
      argv: [],
      timeoutMs: 5_000,
    };
    const disabled: HealthCheck = {
      ...base,
      id: 'hc_dis',
      name: 'disabled',
      enabled: false,
      argv: ['node', '-e', 'process.exit(0)'],
      timeoutMs: 5_000,
    };

    expect((await runConfiguredHealthCheck({ check: passCheck, runner })).status).toBe(
      'PASS',
    );
    expect((await runConfiguredHealthCheck({ check: failCheck, runner })).status).toBe(
      'FAIL',
    );
    expect(
      (await runConfiguredHealthCheck({ check: timeoutCheck, runner })).status,
    ).toBe('TIMEOUT');
    expect(
      (await runConfiguredHealthCheck({ check: missingCheck, runner })).status,
    ).toBe('COMMAND_MISSING');
    expect(
      (await runConfiguredHealthCheck({ check: emptyCheck, runner })).status,
    ).toBe('EXECUTION_ERROR');
    expect((await runConfiguredHealthCheck({ check: disabled, runner })).status).toBe(
      'CANCELLED',
    );
  });

  it('proves auto-discovery does not execute package.json scripts', async () => {
    workspace = await createTempWorkspace('di-health-auto-');
    const repo = await createGitRepo(workspace, 'auto', { commits: 1 });
    await writeFile(
      join(repo.path, 'package.json'),
      JSON.stringify({
        name: 'auto',
        scripts: {
          deploy: 'echo SHOULD_NOT_RUN',
          release: 'echo SHOULD_NOT_RUN',
          test: 'echo ok',
        },
      }),
      'utf8',
    );

    const candidates = await listDiscoveredScriptCandidates(repo.path);
    expect(candidates.map((c) => c.name).sort()).toEqual([
      'deploy',
      'release',
      'test',
    ]);

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const recorder = new RecordingRunner();

    // No configured checks → runEnabled must not invoke runner at all
    const runs = await runEnabledHealthChecks({
      repositoryId: 'repo_auto',
      store: persistence.health,
      runner: recorder,
    });
    expect(runs).toHaveLength(0);
    expect(recorder.calls).toHaveLength(0);

    // Even with candidates present, only explicit enabled checks execute
    const now = new Date().toISOString();
    await persistence.health.upsertCheck({
      schemaVersion: 1,
      id: 'hc_only',
      repositoryId: 'repo_auto',
      name: 'explicit-node',
      enabled: true,
      cwd: repo.path,
      domain: 'wsl',
      argv: ['node', '-e', 'process.exit(0)'],
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      createdAt: now,
      updatedAt: now,
    });

    const runs2 = await runEnabledHealthChecks({
      repositoryId: 'repo_auto',
      store: persistence.health,
      runner: recorder,
    });
    expect(runs2).toHaveLength(1);
    expect(runs2[0]!.status).toBe('PASS');
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]!.argv).toEqual(['node', '-e', 'process.exit(0)']);
    // Never ran npm run deploy/release
    for (const c of recorder.calls) {
      expect(c.argv.join(' ')).not.toMatch(/deploy|release/);
    }

    persistence.close();
  });
});
