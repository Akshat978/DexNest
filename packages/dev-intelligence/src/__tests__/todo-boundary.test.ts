/**
 * The TODO scanner reads what Git says is the repository, and never the
 * operator's private data.
 *
 * It used to walk the whole tree with a short list of names to skip. Pointed
 * at DexNest, that reached local-data - vault, journal, finance - and copied
 * any line mentioning TODO into its database. These tests build that shape for
 * real: a repository with a local-data folder full of TODO lines.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { scanTodoCandidates } from '../todo/scan.js';
import { reconcileTodos } from '../todo/lifecycle.js';
import { listCandidateFiles } from '../git/readonly-git.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import type { TodoMarker, TodoStore } from '@dexnest/dev-intelligence-contracts';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  gitFiles,
  linkDirectory,
  nativeDomain,
} from './fixture-repos.js';

function memoryTodoStore(): TodoStore & { all: TodoMarker[] } {
  const all: TodoMarker[] = [];
  return {
    all,
    async upsert(marker) {
      const i = all.findIndex((m) => m.id === marker.id);
      if (i >= 0) all[i] = marker;
      else all.push(marker);
    },
    async get(id) {
      return all.find((m) => m.id === id);
    },
    async findByFingerprint(repositoryId, fingerprint) {
      return all.find((m) => m.repositoryId === repositoryId && m.fingerprint === fingerprint);
    },
    async listByRepository(repositoryId, options) {
      return all.filter((m) => m.repositoryId === repositoryId && (!options?.status || m.status === options.status));
    },
  };
}

describe('TODO scanning is Git-aware and respects the data boundary', () => {
  let workspace = '';
  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  async function dexnestShapedRepo(ignoreLocalData: boolean) {
    workspace = await createTempWorkspace('todo-boundary-');
    const repo = await createGitRepo(workspace, 'dexnest', { commits: 1 });
    await mkdir(join(repo.path, 'src'), { recursive: true });
    await writeFile(join(repo.path, 'src', 'app.ts'), '// TODO: real work\n', 'utf8');
    await mkdir(join(repo.path, 'local-data', 'settings'), { recursive: true });
    await writeFile(join(repo.path, 'local-data', 'journal.json'), '{"text":"TODO: call the bank about the loan"}\n', 'utf8');
    await writeFile(join(repo.path, 'local-data', 'settings', 'finance.md'), 'FIXME: rent is due\n', 'utf8');
    if (ignoreLocalData) await writeFile(join(repo.path, '.gitignore'), 'local-data/\n', 'utf8');
    return repo;
  }

  it('an ignored data folder is never listed, so never read', async () => {
    const repo = await dexnestShapedRepo(true);
    const result = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(result.todos.map((t) => t.filePath)).toEqual(['src/app.ts']);
    expect(result.todos.some((t) => t.text.includes('bank'))).toBe(false);
  });

  it('the data boundary refuses private data even when .gitignore forgot it', async () => {
    // Defence in depth: .gitignore is the repository owner's choice, not a
    // security control. The host's boundary decides regardless.
    const repo = await dexnestShapedRepo(false);
    const dataRoot = join(repo.path, 'local-data').toLowerCase();
    const result = await scanTodoCandidates({
      repositoryId: 'r',
      rootPath: repo.path,
      listFiles: gitFiles(repo.path),
      isSensitive: (abs) => abs.toLowerCase().startsWith(dataRoot),
    });
    expect(result.todos.map((t) => t.filePath)).toEqual(['src/app.ts']);
    expect(result.refusedSensitive).toBe(2);
  });

  it('untracked files that are not ignored are scanned - that is where work was left', async () => {
    const repo = await dexnestShapedRepo(true);
    await writeFile(join(repo.path, 'src', 'new-file.ts'), '// HACK: not committed yet\n', 'utf8');
    const result = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(result.todos.some((t) => t.filePath === 'src/new-file.ts')).toBe(true);
  });

  it('a symlink is not followed out of the repository', async () => {
    const repo = await dexnestShapedRepo(true);
    const outside = join(workspace, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'private.txt'), 'TODO: private note\n', 'utf8');
    await linkDirectory(outside, join(repo.path, 'linked'));
    const result = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(result.todos.some((t) => t.text.includes('private note'))).toBe(false);
  });

  it('secret-named files stay excluded even when tracked', async () => {
    const repo = await dexnestShapedRepo(true);
    await writeFile(join(repo.path, '.env'), 'TODO=rotate\n', 'utf8');
    await writeFile(join(repo.path, 'google-services.json'), '{"note":"TODO"}\n', 'utf8');
    spawnSync('git', ['add', '-f', '.env', 'google-services.json'], { cwd: repo.path });
    const result = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(result.todos.map((t) => t.filePath)).toEqual(['src/app.ts']);
  });

  it('a scan capped before the end reports itself incomplete', async () => {
    const repo = await dexnestShapedRepo(true);
    for (let i = 0; i < 5; i++) await writeFile(join(repo.path, 'src', `f${i}.ts`), `// TODO: ${i}\n`, 'utf8');
    const result = await scanTodoCandidates({
      repositoryId: 'r',
      rootPath: repo.path,
      listFiles: gitFiles(repo.path),
      maxFiles: 2,
    });
    expect(result.complete).toBe(false);
    expect(result.candidates).toBeGreaterThan(2);
  });

  it('an incomplete scan resolves nothing it did not look at', async () => {
    const store = memoryTodoStore();
    const repo = await dexnestShapedRepo(true);
    for (let i = 0; i < 4; i++) await writeFile(join(repo.path, 'src', `f${i}.ts`), `// TODO: item ${i}\n`, 'utf8');
    const full = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    await reconcileTodos({ repositoryId: 'r', observed: full.todos, store, complete: full.complete });
    const openBefore = store.all.filter((m) => m.status === 'open').length;

    const partial = await scanTodoCandidates({ repositoryId: 'r', rootPath: repo.path, listFiles: gitFiles(repo.path), maxFiles: 1 });
    const result = await reconcileTodos({ repositoryId: 'r', observed: partial.todos, store, complete: partial.complete });
    expect(result.resolved).toHaveLength(0);
    expect(store.all.filter((m) => m.status === 'open')).toHaveLength(openBefore);
  });

  it('a failed file listing throws instead of reporting every TODO resolved', async () => {
    workspace = await createTempWorkspace('todo-notrepo-');
    const notARepo = join(workspace, 'plain');
    await mkdir(notARepo, { recursive: true });
    await expect(
      listCandidateFiles({ cwd: notARepo, domain: nativeDomain, runner: new LocalProcessRunner() }),
    ).rejects.toThrow(/ls-files failed/);
    await expect(
      scanTodoCandidates({
        repositoryId: 'r',
        rootPath: notARepo,
        listFiles: async () => {
          throw new Error('listing failed');
        },
      }),
    ).rejects.toThrow(/listing failed/);
  });

  it('an over-limit file list is refused rather than used partially', async () => {
    const repo = await dexnestShapedRepo(true);
    await expect(
      listCandidateFiles({ cwd: repo.path, domain: nativeDomain, runner: new LocalProcessRunner(), maxBytes: 8 }),
    ).rejects.toThrow(/refusing a possibly partial file list/);
  });
});
