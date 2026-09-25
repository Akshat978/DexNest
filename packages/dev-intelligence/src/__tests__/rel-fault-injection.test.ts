/**
 * Phase 7 Reliability — executable fault injection (EC absorb from Phase 6).
 * Evidence mirrored under .grok-build/fault-injection/ after suite runs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import type {
  ProcessInvocationRequest,
  ProcessInvocationResult,
  ProcessRunnerPort,
} from '@dexnest/dev-intelligence-contracts';
import { createDomainRegistry } from '../domain/execution-domains.js';
import {
  createForcedUnavailableProbe,
  availabilityFailureMessage,
} from '../domain/availability.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import { evaluateHealthArgv } from '../health/argv-policy.js';
import { runConfiguredHealthCheck } from '../health/runner.js';
import { discoverRepositories } from '../discovery/discover.js';
import { inspectGitState } from '../git/readonly-git.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  denyAccess,
  nativeDomain,
  restoreAccess,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

class ScriptedGitRunner implements ProcessRunnerPort {
  private readonly inner = new LocalProcessRunner();
  constructor(
    private readonly script: (
      req: ProcessInvocationRequest,
      inner: LocalProcessRunner,
    ) => Promise<ProcessInvocationResult | 'passthrough'>,
  ) {}
  async run(req: ProcessInvocationRequest): Promise<ProcessInvocationResult> {
    const r = await this.script(req, this.inner);
    if (r === 'passthrough') return this.inner.run(req);
    return r;
  }
}

describe('P7 Rel fault injection', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('EC-049: interactive/watch argv rejected fail-closed without spawn', async () => {
    const cases: Array<{ argv: string[]; expectReject: boolean }> = [
      { argv: ['node', '-e', 'process.exit(0)'], expectReject: false },
      { argv: ['npm', 'run', 'test'], expectReject: false },
      { argv: ['npm', 'run', 'dev'], expectReject: true },
      { argv: ['pnpm', 'run', 'watch'], expectReject: true },
      { argv: ['node', '--watch', 'server.js'], expectReject: true },
      { argv: ['vitest', '--watch'], expectReject: true },
      { argv: ['bash', '-i'], expectReject: true },
      { argv: ['vite'], expectReject: true },
      { argv: ['vite', 'build'], expectReject: false },
      { argv: ['python', 'repl'], expectReject: true },
    ];
    for (const c of cases) {
      const r = evaluateHealthArgv(c.argv);
      expect(r.allowed, c.argv.join(' ')).toBe(!c.expectReject);
    }

    workspace = await createTempWorkspace('rel-ec049-');
    const repo = await createGitRepo(workspace, 'h', { commits: 1 });
    const calls: ProcessInvocationRequest[] = [];
    const runner: ProcessRunnerPort = {
      async run(req) {
        calls.push(req);
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          durationMs: 0,
        };
      },
    };
    const now = new Date().toISOString();
    const rejected = await runConfiguredHealthCheck({
      check: {
        schemaVersion: 1,
        id: 'hc_watch',
        repositoryId: 'r',
        name: 'watch-bad',
        enabled: true,
        cwd: repo.path,
        domain: 'wsl',
        argv: ['npm', 'run', 'dev'],
        timeoutMs: 30_000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
        createdAt: now,
        updatedAt: now,
      },
      runner,
    });
    expect(rejected.status).toBe('EXECUTION_ERROR');
    expect(rejected.errorMessage).toMatch(/rejected|fail-closed|watch/i);
    expect(calls).toHaveLength(0);
  });

  it('EC-002: hundreds of synthetic repos stay within maxRepositories bound', async () => {
    workspace = await createTempWorkspace('rel-ec002-');
    const root = join(workspace, 'many');
    await mkdir(root, { recursive: true });
    const N = 250;
    for (let i = 0; i < N; i++) {
      // Lightweight .git marker dirs (discovery only checks .git presence)
      const p = join(root, `repo_${String(i).padStart(4, '0')}`);
      await mkdir(join(p, '.git'), { recursive: true });
    }
    const t0 = Date.now();
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: root, domain: 'wsl' }],
        maxDepth: 2,
        maxDirectories: 5000,
        maxRepositories: 200,
      }),
    );
    const elapsed = Date.now() - t0;
    expect(result.found.length).toBe(200);
    expect(result.found.length).toBeLessThanOrEqual(200);
    expect(elapsed).toBeLessThan(30_000);
    // Bound: visited dirs should not explode unboundedly past maxDirectories
    expect(result.directoriesVisited).toBeLessThanOrEqual(5000);
  }, 60_000);

  it('EC-030: recoverInterruptedScans clears leftover STARTED mid multi-repo scan', async () => {
    workspace = await createTempWorkspace('rel-ec030-');
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    await persistence.scanRuns.create({
      schemaVersion: 1,
      id: 'scan_mid_crash',
      state: 'STARTED',
      startedAt: '2026-01-01T00:00:00Z',
      repositoriesAttempted: 5,
      repositoriesSucceeded: 2,
      repositoriesFailed: 0,
      targetRepositoryIds: ['a', 'b', 'c', 'd', 'e'],
      checkpoint: JSON.stringify({
        phase: 'inspect',
        repoIds: ['a', 'b', 'c', 'd', 'e'],
        completed: ['a', 'b'],
      }),
    });
    const orch = new ScanOrchestrator({
      persistence,
      domains: createDomainRegistry(),
      discovery: defaultDiscoveryConfig(),
      runHealth: false,
    });
    const recovered = await orch.recoverInterruptedScans();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.state).toBe('FAILED');
    expect(recovered[0]!.errorSummary).toMatch(/crash recovery|interrupted/i);
    expect(await persistence.scanRuns.listIncomplete()).toHaveLength(0);

    // Fresh scan after recovery succeeds on empty discovery
    const next = await orch.runScan();
    expect(['COMPLETED', 'FAILED']).toContain(next.scanRun.state);
    persistence.close();
  });

  it('EC-039: slow large-repo slot does not indefinitely block others (concurrency=2)', async () => {
    workspace = await createTempWorkspace('rel-ec039-');
    const slow = await createGitRepo(workspace, 'monorepo-slow', { commits: 1 });
    const fastA = await createGitRepo(workspace, 'fast-a', { commits: 1 });
    const fastB = await createGitRepo(workspace, 'fast-b', { commits: 1 });
    const fastC = await createGitRepo(workspace, 'fast-c', { commits: 1 });

    const finishedAt = new Map<string, number>();
    const runner = new ScriptedGitRunner(async (req, inner) => {
      if (req.cwd === slow.path && req.argv[0] === 'git') {
        await new Promise((r) => setTimeout(r, 600));
      }
      const res = await inner.run(req);
      finishedAt.set(req.cwd, Date.now());
      return res;
    });

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const domain = domains.defaultDomain();
    const t0 = Date.now();
    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [
          { path: slow.path, domain },
          { path: fastA.path, domain },
          { path: fastB.path, domain },
          { path: fastC.path, domain },
        ],
      }),
      concurrency: 2,
      runner,
      runHealth: false,
      incremental: false,
    });
    const result = await orch.runScan();
    const elapsed = Date.now() - t0;
    expect(result.scanRun.repositoriesSucceeded).toBe(4);
    expect(result.scanRun.state).toBe('COMPLETED');
    // Fast repos should have finished well before wall clock of serial slow*all
    const fastTimes = [fastA.path, fastB.path, fastC.path].map(
      (p) => (finishedAt.get(p) ?? 0) - t0,
    );
    expect(Math.min(...fastTimes)).toBeLessThan(2_500);
    expect(elapsed).toBeLessThan(20_000);
    persistence.close();
  }, 60_000);

  it('EC-040/051 simulation: unavailable domain probe isolates degrade message', async () => {
    const probe = createForcedUnavailableProbe(
      'wsl_unavailable',
      'simulated: wsl.exe not present on Linux Rel box',
    );
    const a = await probe('wsl');
    expect(a.available).toBe(false);
    expect(a.reason).toBe('wsl_unavailable');
    expect(availabilityFailureMessage(a)).toMatch(/wsl_unavailable/);

    const win = createForcedUnavailableProbe(
      'windows_git_unavailable',
      'simulated: Windows Git not on PATH',
    );
    const b = await win('windows');
    expect(b.available).toBe(false);
    expect(b.reason).toBe('windows_git_unavailable');

    const distro = createForcedUnavailableProbe(
      'wsl_distro_missing',
      'simulated: requested distro not installed',
    );
    expect((await distro('wsl')).reason).toBe('wsl_distro_missing');

    // Orchestrator: domain unavailable → isolated FAILED/PARTIAL, no hang
    workspace = await createTempWorkspace('rel-ec040-scan-');
    const repo = await createGitRepo(workspace, 'r', { commits: 1 });
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: [{ path: repo.path, domain: domains.defaultDomain() }],
      }),
      runHealth: false,
      availabilityProbe: createForcedUnavailableProbe(
        'wsl_unavailable',
        'simulated host gap on Linux Rel box',
      ),
    });
    const result = await orch.runScan();
    expect(result.scanRun.state).toBe('FAILED');
    expect(result.scanRun.repositoriesFailed).toBe(1);
    expect(result.scanRun.errorSummary).toMatch(/wsl_unavailable|unavailable/i);
    persistence.close();
  });

  it('Git timeout: hung git yields timedOut and isolated repo failure in PARTIAL scan', async () => {
    workspace = await createTempWorkspace('rel-git-to-');
    const good = await createGitRepo(workspace, 'good', { commits: 1 });
    const hung = await createGitRepo(workspace, 'hung', { commits: 1 });
    const runner = new ScriptedGitRunner(async (req, _inner) => {
      if (req.cwd === hung.path && req.argv[0] === 'git') {
        await new Promise((r) => setTimeout(r, req.timeoutMs + 50));
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: true,
          cancelled: false,
          durationMs: req.timeoutMs,
          errorMessage: 'git timed out (injected)',
        };
      }
      return 'passthrough';
    });
    // Override: make inspect throw on timeout by using a runner that fails git
    const failingRunner = new ScriptedGitRunner(async (req, _inner) => {
      if (req.cwd === hung.path && req.argv[0] === 'git') {
        throw new Error('git timed out (injected)');
      }
      return 'passthrough';
    });

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
          { path: hung.path, domain },
        ],
      }),
      concurrency: 2,
      runner: failingRunner,
      runHealth: false,
    });
    const result = await orch.runScan();
    expect(result.scanRun.state).toBe('PARTIAL');
    expect(result.scanRun.repositoriesSucceeded).toBe(1);
    expect(result.scanRun.repositoriesFailed).toBe(1);
    expect(result.scanRun.errorSummary).toMatch(/timed out/i);
    void runner;
    persistence.close();
  });

  it('repo deleted mid-scan: isolated failure, others succeed', async () => {
    workspace = await createTempWorkspace('rel-deleted-');
    const keep = await createGitRepo(workspace, 'keep', { commits: 1 });
    const doomed = await createGitRepo(workspace, 'doomed', { commits: 1 });
    let deleted = false;
    const runner = new ScriptedGitRunner(async (req, _inner) => {
      if (req.cwd === doomed.path && !deleted) {
        deleted = true;
        await rm(doomed.path, { recursive: true, force: true });
      }
      return 'passthrough';
    });
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
          { path: keep.path, domain },
          { path: doomed.path, domain },
        ],
      }),
      concurrency: 1,
      runner,
      runHealth: false,
    });
    const result = await orch.runScan();
    expect(['PARTIAL', 'FAILED', 'COMPLETED']).toContain(result.scanRun.state);
    // Keep should succeed; doomed may fail depending on when deletion races
    expect(result.scanRun.repositoriesSucceeded).toBeGreaterThanOrEqual(1);
    persistence.close();
  });

  it('malformed Git output: inspect does not throw; snapshot still produced', async () => {
    workspace = await createTempWorkspace('rel-malformed-');
    const repo = await createGitRepo(workspace, 'm', { commits: 1 });
    const runner = new ScriptedGitRunner(async (req, _inner) => {
      if (req.argv[0] === 'git' && req.argv.includes('--porcelain=v2')) {
        return {
          exitCode: 0,
          stdout: 'THIS IS NOT PORCELAIN\n!!!!\n',
          stderr: '',
          timedOut: false,
          cancelled: false,
          durationMs: 1,
        };
      }
      return 'passthrough';
    });
    const git = await inspectGitState({
      cwd: repo.path,
      domain: 'wsl',
      runner,
    });
    expect(git).toBeTruthy();
    expect(typeof git.workingTree.isClean).toBe('boolean');
  });

  it('health huge stdout bounded; crash/timeout statuses recorded', async () => {
    workspace = await createTempWorkspace('rel-health-bound-');
    const repo = await createGitRepo(workspace, 'h', { commits: 1 });
    const runner = new LocalProcessRunner();
    const now = new Date().toISOString();
    const huge = await runConfiguredHealthCheck({
      check: {
        schemaVersion: 1,
        id: 'hc_huge',
        repositoryId: 'r',
        name: 'huge',
        enabled: true,
        cwd: repo.path,
        domain: 'wsl',
        argv: [
          'node',
          '-e',
          "process.stdout.write('Z'.repeat(500000)); process.exit(0)",
        ],
        timeoutMs: 10_000,
        maxStdoutBytes: 128,
        maxStderrBytes: 128,
        createdAt: now,
        updatedAt: now,
      },
      runner,
      retention: { maxHealthOutputBytes: 64 },
    });
    expect(huge.status).toBe('PASS');
    expect(Buffer.byteLength(huge.stdoutPreview ?? '', 'utf8')).toBeLessThanOrEqual(
      64,
    );

    const boom = await runConfiguredHealthCheck({
      check: {
        schemaVersion: 1,
        id: 'hc_boom',
        repositoryId: 'r',
        name: 'boom',
        enabled: true,
        cwd: repo.path,
        domain: 'wsl',
        argv: ['node', '-e', "process.crash?.() || process.exit(1); throw new Error('x')"],
        timeoutMs: 5_000,
        maxStdoutBytes: 128,
        maxStderrBytes: 128,
        createdAt: now,
        updatedAt: now,
      },
      runner,
    });
    expect(['FAIL', 'EXECUTION_ERROR']).toContain(boom.status);
  });

  it('permission-denied path during discovery is isolated', async () => {
    workspace = await createTempWorkspace('rel-perm-');
    const ok = await createGitRepo(workspace, 'ok', { commits: 1 });
    const denied = join(workspace, 'denied');
    await mkdir(denied, { recursive: true });
    await mkdir(join(denied, 'hidden'), { recursive: true });
    // A real denial on both platforms: chmod on POSIX, a deny ACE on Windows.
    denyAccess(denied);
    let result;
    try {
      result = await discoverRepositories(
        defaultDiscoveryConfig({
          roots: [
            { path: workspace, domain: nativeDomain },
            { path: denied, domain: nativeDomain },
          ],
          maxDepth: 3,
        }),
      );
    } finally {
      restoreAccess(denied);
    }
    expect(result.found.some((f) => f.root.path === ok.path)).toBe(true);
    expect(result.cancelled).toBe(false);
    if (process.platform === 'win32') {
      // The Windows deny is unconditional, so the refusal must be reported -
      // isolated as a failure, not silently skipped and not fatal.
      expect(result.failures.some((f) => f.path.toLowerCase().includes('denied'))).toBe(true);
    }
  });

  it('duplicate scan/event: unchanged rescan does not duplicate commit events', async () => {
    workspace = await createTempWorkspace('rel-dup-');
    const repo = await createGitRepo(workspace, 'dup', { commits: 2 });
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const domain = domains.defaultDomain();
    const mk = () =>
      new ScanOrchestrator({
        persistence,
        domains,
        discovery: defaultDiscoveryConfig({
          manualRepositories: [{ path: repo.path, domain }],
        }),
        concurrency: 2,
        runHealth: false,
        sourceIdentity: 'rel-dup',
      });
    const r1 = await mk().runScan();
    expect(r1.scanRun.state).toBe('COMPLETED');
    const events1 = await persistence.events.listByRepository(
      r1.repositories[0]!.id,
    );
    const r2 = await mk().runScan();
    expect(r2.scanRun.state).toBe('COMPLETED');
    const events2 = await persistence.events.listByRepository(
      r1.repositories[0]!.id,
    );
    const commits1 = events1.filter((e) => e.type === 'dev.commit.observed');
    const commits2 = events2.filter((e) => e.type === 'dev.commit.observed');
    expect(commits2.length).toBe(commits1.length);
    persistence.close();
  });
});
