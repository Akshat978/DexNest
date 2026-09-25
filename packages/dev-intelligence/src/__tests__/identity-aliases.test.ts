/**
 * One repository, however it is reached.
 *
 * Before these fixes, identity hashed the path as written. On Windows the same
 * repository spelled D:\Code\app and d:\code\app, or reached through a
 * junction, became separate repositories with separate histories - a real
 * junction cycle turned one repository into 89. Every case here uses the real
 * filesystem: real directories, real junctions (Windows) or symlinks (POSIX).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverRepositories } from '../discovery/discover.js';
import { stableRepositoryId } from '../discovery/identity.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace,
  linkDirectory,
  nativeDomain,
} from './fixture-repos.js';

const onWindows = process.platform === 'win32';

describe('repository identity across aliases', () => {
  let workspace = '';
  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it.skipIf(!onWindows)('case variants of one Windows path are one repository', async () => {
    workspace = await createTempWorkspace('id-case-');
    const repo = await createGitRepo(workspace, 'MyApp', { commits: 1 });
    const ids = new Set([
      stableRepositoryId('windows', repo.path),
      stableRepositoryId('windows', repo.path.toLowerCase()),
      stableRepositoryId('windows', repo.path.toUpperCase()),
      stableRepositoryId('windows', repo.path.replace(/\\/g, '/') + '/'),
    ]);
    expect(ids.size).toBe(1);
  });

  it('a repository reached through a link is the same repository', async () => {
    workspace = await createTempWorkspace('id-link-');
    const repo = await createGitRepo(workspace, 'real', { commits: 1 });
    const alias = join(workspace, 'alias');
    await linkDirectory(repo.path, alias);
    expect(stableRepositoryId(nativeDomain, alias)).toBe(stableRepositoryId(nativeDomain, repo.path));
  });

  it('discovery through an alias reports the repository once, at its real path', async () => {
    workspace = await createTempWorkspace('id-disc-');
    await mkdir(join(workspace, 'code'), { recursive: true });
    const repo = await createGitRepo(join(workspace, 'code'), 'app', { commits: 1 });
    await linkDirectory(join(workspace, 'code'), join(workspace, 'shortcut'));

    const result = await discoverRepositories(
      defaultDiscoveryConfig({ roots: [{ path: workspace, domain: nativeDomain }], maxDepth: 4 }),
    );
    expect(result.found).toHaveLength(1);
    expect(result.found[0]!.root.path.toLowerCase()).toBe(repo.path.toLowerCase());
  });

  it('a link cycle is walked once and yields no duplicates at any depth', async () => {
    // The shape that produced 89 repositories from one at depth 12.
    workspace = await createTempWorkspace('id-cycle-');
    await mkdir(join(workspace, 'work'), { recursive: true });
    await createGitRepo(join(workspace, 'work'), 'only-repo', { commits: 1 });
    await mkdir(join(workspace, 'a'), { recursive: true });
    await mkdir(join(workspace, 'b'), { recursive: true });
    await linkDirectory(join(workspace, 'b'), join(workspace, 'a', 'to-b'));
    await linkDirectory(join(workspace, 'a'), join(workspace, 'b', 'to-a'));
    await linkDirectory(workspace, join(workspace, 'a', 'to-root'));

    for (const maxDepth of [4, 12]) {
      const result = await discoverRepositories(
        defaultDiscoveryConfig({ roots: [{ path: workspace, domain: nativeDomain }], maxDepth }),
      );
      expect(result.found).toHaveLength(1);
      // Bounded by distinct real directories, not by depth x links.
      expect(result.directoriesVisited).toBeLessThan(15);
    }
  });

  it('overlapping configured roots find each repository once', async () => {
    workspace = await createTempWorkspace('id-nested-');
    const outer = join(workspace, 'outer');
    await mkdir(outer, { recursive: true });
    await createGitRepo(outer, 'inner-repo', { commits: 1 });
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [
          { path: workspace, domain: nativeDomain },
          { path: outer, domain: nativeDomain },
        ],
      }),
    );
    expect(result.found).toHaveLength(1);
  });

  it('a manual path and a discovered path to one repository give one repository', async () => {
    workspace = await createTempWorkspace('id-manual-');
    const repo = await createGitRepo(workspace, 'shared', { commits: 1 });
    const manualSpelling = onWindows ? repo.path.toUpperCase() : repo.path;
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        manualRepositories: [{ path: manualSpelling, domain: nativeDomain }],
        roots: [{ path: workspace, domain: nativeDomain }],
      }),
    );
    expect(result.found).toHaveLength(1);
  });

  it('genuinely different repositories are never merged', async () => {
    workspace = await createTempWorkspace('id-distinct-');
    const a = await createGitRepo(workspace, 'app', { commits: 1 });
    const b = await createGitRepo(workspace, 'app-2', { commits: 1 });
    const nested = join(workspace, 'nested');
    await mkdir(nested, { recursive: true });
    const c = await createGitRepo(nested, 'app', { commits: 1 });
    const ids = new Set([a.path, b.path, c.path].map((p) => stableRepositoryId(nativeDomain, p)));
    expect(ids.size).toBe(3);
  });

  it('a WSL path seen from Windows is not resolved through Windows path rules', () => {
    // Previously /home/me/app on a Windows host became D:\home\me\app.
    const id1 = stableRepositoryId('wsl', '/home/me/app');
    const id2 = stableRepositoryId('wsl', '/home/me/app/');
    expect(id1).toBe(id2);
    if (onWindows) {
      expect(stableRepositoryId('wsl', '/home/me/app')).not.toBe(stableRepositoryId('windows', 'D:\\home\\me\\app'));
    }
  });
});
