import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { detectTechnologies } from '../tech/detect.js';
import { reconcileTechnologies } from '../tech/lifecycle.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  gitFiles,
} from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('technology facts + provenance', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('detects package.json / pyproject / Cargo / go.mod / Dockerfile / extensions', async () => {
    workspace = await createTempWorkspace('di-tech-');
    const repo = await createGitRepo(workspace, 'tech-repo', { commits: 1 });
    await writeFile(
      join(repo.path, 'package.json'),
      JSON.stringify({
        name: 'demo',
        packageManager: 'pnpm@9.0.0',
        engines: { node: '>=20' },
        dependencies: { leftpad: '1.0.0' },
      }),
      'utf8',
    );
    await writeFile(
      join(repo.path, 'pyproject.toml'),
      '[project]\nname = "demo-py"\nrequires-python = ">=3.11"\n',
      'utf8',
    );
    await writeFile(
      join(repo.path, 'Cargo.toml'),
      '[package]\nname = "demo-rs"\nedition = "2021"\n',
      'utf8',
    );
    await writeFile(
      join(repo.path, 'go.mod'),
      'module example.com/demo\n\ngo 1.22\n',
      'utf8',
    );
    await writeFile(
      join(repo.path, 'Dockerfile'),
      'FROM node:20-alpine\n',
      'utf8',
    );
    await writeFile(join(repo.path, 'main.ts'), 'export {}\n', 'utf8');

    const raw = await detectTechnologies(repo.path, await gitFiles(repo.path)());
    const kinds = new Set(raw.map((r) => r.evidenceKind.split('#')[0]));
    expect(kinds.has('package.json')).toBe(true);
    expect(kinds.has('pyproject.toml')).toBe(true);
    expect(kinds.has('Cargo.toml')).toBe(true);
    expect(kinds.has('go.mod')).toBe(true);
    expect(kinds.has('Dockerfile')).toBe(true);
    expect(raw.some((r) => r.category === 'language' && r.name === 'TypeScript')).toBe(
      true,
    );
    // No skill/XP fields anywhere
    for (const r of raw) {
      expect(r).not.toHaveProperty('skill');
      expect(r).not.toHaveProperty('xp');
      expect(r.evidencePath).toBeTruthy();
    }
  });

  it('emits observed/removed with provenance retained', async () => {
    workspace = await createTempWorkspace('di-tech-life-');
    const repo = await createGitRepo(workspace, 'life', { commits: 1 });
    await writeFile(
      join(repo.path, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { lodash: '4.0.0' } }),
      'utf8',
    );

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const repoId = 'repo_tech_1';

    const first = await reconcileTechnologies({
      repositoryId: repoId,
      rootPath: repo.path,
      files: await gitFiles(repo.path)(),
      store: persistence.technologies,
    });
    expect(first.observed.length).toBeGreaterThan(0);
    const lodash = first.observed.find((f) => f.name === 'lodash');
    expect(lodash?.evidencePath).toBe('package.json');
    expect(lodash?.status).toBe('observed');

    await rm(join(repo.path, 'package.json'));
    // A capped, partial listing that happens to miss package.json removes nothing.
    const partial = await reconcileTechnologies({
      repositoryId: repoId,
      rootPath: repo.path,
      files: [],
      complete: false,
      store: persistence.technologies,
    });
    expect(partial.removed).toEqual([]);

    const second = await reconcileTechnologies({
      repositoryId: repoId,
      rootPath: repo.path,
      files: await gitFiles(repo.path)(),
      store: persistence.technologies,
    });
    expect(second.removed.some((f) => f.name === 'lodash')).toBe(true);
    const listed = await persistence.technologies.listByRepository(repoId);
    const removedLodash = listed.find((f) => f.name === 'lodash');
    expect(removedLodash?.status).toBe('removed');
    expect(removedLodash?.evidencePath).toBe('package.json');
    expect(removedLodash?.removedAt).toBeTruthy();

    persistence.close();
  });

  it('reads only the files it is handed, never walking the tree', async () => {
    workspace = await createTempWorkspace('di-tech-handed-');
    const repo = await createGitRepo(workspace, 'handed', { commits: 1 });
    // Present on disk, but not in the vetted list: as local-data is for DexNest.
    await mkdir(join(repo.path, 'local-data', 'speech'), { recursive: true });
    await writeFile(join(repo.path, 'local-data', 'speech', 'sidecar.py'), 'print(1)\n', 'utf8');
    await writeFile(join(repo.path, 'local-data', 'package.json'), '{"dependencies":{"secret-dep":"1"}}', 'utf8');
    await writeFile(join(repo.path, 'main.ts'), 'export {}\n', 'utf8');

    const raw = await detectTechnologies(repo.path, ['main.ts', 'README.md']);
    expect(raw.map((r) => r.evidencePath)).toEqual(['main.ts']);
    expect(JSON.stringify(raw)).not.toContain('local-data');
  });
});
