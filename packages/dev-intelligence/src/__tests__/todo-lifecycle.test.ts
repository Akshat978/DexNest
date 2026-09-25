import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { scanTodos, extractMarkersFromText, isSecretLikePath } from '../todo/scan.js';
import { reconcileTodos } from '../todo/lifecycle.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace, gitFiles } from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('TODO/FIXME/HACK/XXX lifecycle', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('extracts markers and skips secret-like paths', () => {
    const markers = extractMarkersFromText(
      '// TODO: fix me\n/* FIXME: later */\n# HACK: temp\nXXX: watch\n',
      'src/a.ts',
    );
    expect(markers.map((m) => m.kind).sort()).toEqual([
      'FIXME',
      'HACK',
      'TODO',
      'XXX',
    ]);
    expect(isSecretLikePath('.env')).toBe(true);
    expect(isSecretLikePath('secrets/id_rsa')).toBe(true);
    expect(isSecretLikePath('src/app.ts')).toBe(false);
  });

  it('created → unchanged → moved/renamed → resolved; no whole-file storage', async () => {
    workspace = await createTempWorkspace('di-todo-');
    const repo = await createGitRepo(workspace, 'todo-repo', { commits: 1 });
    await mkdir(join(repo.path, 'src'), { recursive: true });
    await writeFile(
      join(repo.path, 'src', 'a.ts'),
      'export const x = 1;\n// TODO: ship it\n',
      'utf8',
    );
    await writeFile(join(repo.path, '.env'), 'TODO: secret should skip\n', 'utf8');
    await writeFile(join(repo.path, 'huge.bin'), Buffer.alloc(600_000, 1));

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const repoId = 'repo_todo_1';

    const obs1 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(obs1.some((o) => o.filePath.includes('.env'))).toBe(false);
    expect(obs1.length).toBeGreaterThanOrEqual(1);

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
    const firstSeen = open1[0]!.firstObservedAt;

    // unchanged
    const obs2 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const r2 = await reconcileTodos({
      repositoryId: repoId,
      observed: obs2,
      store: persistence.todos,
    });
    expect(r2.results.every((x) => x.action === 'unchanged')).toBe(true);
    expect(r2.open[0]!.firstObservedAt).toBe(firstSeen);

    // rename (same dir)
    await rename(join(repo.path, 'src', 'a.ts'), join(repo.path, 'src', 'b.ts'));
    const obs3 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const r3 = await reconcileTodos({
      repositoryId: repoId,
      observed: obs3,
      store: persistence.todos,
    });
    expect(r3.results.some((x) => x.action === 'renamed')).toBe(true);
    expect(r3.open[0]!.fingerprint).toBe(fp);
    expect(r3.open[0]!.filePath).toBe('src/b.ts');
    expect(r3.open[0]!.previousFilePath).toBe('src/a.ts');

    // move
    await mkdir(join(repo.path, 'lib'), { recursive: true });
    await rename(join(repo.path, 'src', 'b.ts'), join(repo.path, 'lib', 'b.ts'));
    const obs4 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const r4 = await reconcileTodos({
      repositoryId: repoId,
      observed: obs4,
      store: persistence.todos,
    });
    expect(r4.results.some((x) => x.action === 'moved')).toBe(true);
    expect(r4.open[0]!.fingerprint).toBe(fp);

    // resolved
    await rm(join(repo.path, 'lib', 'b.ts'));
    const obs5 = await scanTodos({ repositoryId: repoId, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const r5 = await reconcileTodos({
      repositoryId: repoId,
      observed: obs5,
      store: persistence.todos,
    });
    expect(r5.resolved).toHaveLength(1);
    expect(r5.resolved[0]!.status).toBe('resolved');
    expect(r5.resolved[0]!.resolvedAt).toBeTruthy();
    expect(r5.resolved[0]!.firstObservedAt).toBe(firstSeen);

    // Ensure we never persisted whole source — marker text only
    const all = await persistence.todos.listByRepository(repoId);
    for (const m of all) {
      expect(m.text.length).toBeLessThan(500);
      expect(m.text).not.toMatch(/export const x/);
    }

    persistence.close();
  });
});
