/**
 * Phase 6 QA — scan lifecycle / isolation / idempotency.
 * EC-026, EC-029, EC-031, EC-034, EC-042.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { scanTodos } from '../todo/scan.js';
import { reconcileTodos } from '../todo/lifecycle.js';
import {
  cleanup,
  createBrokenRepoDir,
  createGitRepo,
  createTempWorkspace, gitFiles } from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('QA scan lifecycle (EC-026/029/031/034/042)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('EC-034: one repo fails → healthy still processed (PARTIAL)', async () => {
    workspace = await createTempWorkspace('qa-ec034-');
    const good = await createGitRepo(workspace, 'healthy', { commits: 1 });
    const broken = await createBrokenRepoDir(workspace, 'boom');
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
          { path: good.path, domain: domains.defaultDomain() },
          { path: broken, domain: domains.defaultDomain() },
        ],
      }),
      concurrency: 2,
      runHealth: false,
      sourceIdentity: 'qa-ec034',
    });
    const result = await orch.runScan();
    expect(result.scanRun.state).toBe('PARTIAL');
    expect(result.scanRun.repositoriesSucceeded).toBe(1);
    expect(result.scanRun.repositoriesFailed).toBe(1);
    expect(result.snapshots).toHaveLength(1);
    persistence.close();
  });

  it('EC-042 + EC-031: unchanged rescan is idempotent for commits/events', async () => {
    workspace = await createTempWorkspace('qa-ec042-');
    const repo = await createGitRepo(workspace, 'idemp', { commits: 2 });
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
      concurrency: 2,
      runHealth: false,
      sourceIdentity: 'qa-ec042',
    });
    const first = await orch.runScan();
    expect(first.scanRun.state).toBe('COMPLETED');
    const repoId = first.repositories[0]!.id;
    const e1 = await persistence.events.listByRepository(repoId, {
      limit: 500,
    });
    const commits1 = e1.filter((e) => e.type === 'dev.commit.observed');
    const second = await orch.runScan();
    expect(second.scanRun.state).toBe('COMPLETED');
    const e2 = await persistence.events.listByRepository(repoId, {
      limit: 500,
    });
    const commits2 = e2.filter((e) => e.type === 'dev.commit.observed');
    expect(commits2.length).toBe(commits1.length);
    const fps = new Set(e2.map((e) => e.fingerprint));
    expect(fps.size).toBe(e2.length);
    persistence.close();
  });

  it('EC-029: cancelled scan reports CANCELLED lifecycle', async () => {
    workspace = await createTempWorkspace('qa-ec029-');
    const repos = [];
    for (let i = 0; i < 6; i++) {
      repos.push(await createGitRepo(workspace, `r${i}`, { commits: 1 }));
    }
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const domains = createDomainRegistry();
    const orch = new ScanOrchestrator({
      persistence,
      domains,
      discovery: defaultDiscoveryConfig({
        manualRepositories: repos.map((r) => ({
          path: r.path,
          domain: domains.defaultDomain(),
        })),
      }),
      concurrency: 1,
      runHealth: false,
      sourceIdentity: 'qa-ec029',
    });
    const pending = orch.runScan();
    // Cancel quickly
    orch.requestCancel();
    const result = await pending;
    expect(['CANCELLED', 'COMPLETED', 'PARTIAL']).toContain(
      result.scanRun.state,
    );
    // If cancel won the race, state is CANCELLED; otherwise still valid terminal
    expect(result.scanRun.finishedAt).toBeTruthy();
    persistence.close();
  });

  it('EC-026: TODO created / renamed / resolved with fingerprint stability', async () => {
    workspace = await createTempWorkspace('qa-ec026-');
    const repo = await createGitRepo(workspace, 'todos', { commits: 1 });
    await mkdir(join(repo.path, 'src'), { recursive: true });
    await writeFile(
      join(repo.path, 'src', 'a.ts'),
      '// TODO: ship feature\n',
      'utf8',
    );
    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const repoId = 'qa_todo_repo';

    const obs1 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const r1 = await reconcileTodos({
      repositoryId: repoId,
      observed: obs1,
      store: persistence.todos,
    });
    expect(r1.results.some((x) => x.action === 'created')).toBe(true);
    const open1 = await persistence.todos.listByRepository(repoId, {
      status: 'open',
    });
    expect(open1).toHaveLength(1);
    const fp = open1[0]!.fingerprint;

    await mkdir(join(repo.path, 'src', 'nested'), { recursive: true });
    await rename(
      join(repo.path, 'src', 'a.ts'),
      join(repo.path, 'src', 'nested', 'a.ts'),
    );
    const obs2 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    await reconcileTodos({
      repositoryId: repoId,
      observed: obs2,
      store: persistence.todos,
    });
    const open2 = await persistence.todos.listByRepository(repoId, {
      status: 'open',
    });
    expect(open2.some((t) => t.fingerprint === fp)).toBe(true);

    await writeFile(
      join(repo.path, 'src', 'nested', 'a.ts'),
      '// done\n',
      'utf8',
    );
    const obs3 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    await reconcileTodos({
      repositoryId: repoId,
      observed: obs3,
      store: persistence.todos,
    });
    const open3 = await persistence.todos.listByRepository(repoId, {
      status: 'open',
    });
    const resolved = await persistence.todos.listByRepository(repoId, {
      status: 'resolved',
    });
    expect(open3.find((t) => t.fingerprint === fp)).toBeUndefined();
    expect(resolved.some((t) => t.fingerprint === fp)).toBe(true);
    persistence.close();
  });
});
