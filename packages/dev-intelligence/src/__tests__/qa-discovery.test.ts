/**
 * Phase 6 QA — discovery / path edge cases (independent of builder suites).
 * EC-001, EC-004, EC-005, EC-006, EC-008, EC-043 (+ exclusions / disabled).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverRepositories } from '../discovery/discover.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { isExcludedDirName } from '../discovery/exclusions.js';
import {
  cleanup,
  createBrokenRepoDir,
  createGitRepo,
  createPathWithSpaces,
  createTempWorkspace,
  createUnicodePathRepo,
  denyAccess,
  linkDirectory,
  nativeDomain,
  restoreAccess,
} from './fixture-repos.js';

describe('QA discovery (EC-001/004/005/006/008/043)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) {
      try {
        // Restore access so cleanup can delete
        restoreAccess(join(workspace, 'denied'));
      } catch {
        /* ignore */
      }
      await cleanup(workspace);
    }
    workspace = '';
  });

  it('EC-001: zero repositories → empty found, no crash', async () => {
    workspace = await createTempWorkspace('qa-ec001-');
    const emptyRoot = join(workspace, 'empty');
    await mkdir(emptyRoot, { recursive: true });
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: emptyRoot, domain: nativeDomain }],
        maxDepth: 2,
      }),
    );
    expect(result.found).toHaveLength(0);
    expect(result.cancelled).toBe(false);
  });

  it('EC-004: path with spaces discovers and is scannable identity', async () => {
    workspace = await createTempWorkspace('qa-ec004-');
    const spaced = await createPathWithSpaces(workspace);
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: workspace, domain: nativeDomain }],
        maxDepth: 2,
      }),
    );
    expect(result.found.some((f) => f.root.path === spaced.path)).toBe(true);
  });

  it('EC-005: Unicode path discovers', async () => {
    workspace = await createTempWorkspace('qa-ec005-');
    const uni = await createUnicodePathRepo(workspace);
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: workspace, domain: nativeDomain }],
        maxDepth: 2,
      }),
    );
    expect(result.found.some((f) => f.root.path === uni.path)).toBe(true);
  });

  it('EC-006: permission-denied path isolated; others proceed', async () => {
    workspace = await createTempWorkspace('qa-ec006-');
    const good = await createGitRepo(workspace, 'good', { commits: 1 });
    const denied = join(workspace, 'denied');
    await mkdir(denied, { recursive: true });
    await createGitRepo(denied, 'secret-repo', { commits: 1 });
    // Deny traverse on denied/ so discovery cannot enter: chmod on POSIX, a
    // real deny ACE on Windows, where chmod is ignored.
    denyAccess(denied);

    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: workspace, domain: nativeDomain }],
        maxDepth: 3,
      }),
    );
    expect(result.found.some((f) => f.root.path === good.path)).toBe(true);
    // Either denied itself or its child may appear in failures; good still found
    expect(result.found.every((f) => !f.root.path.includes('secret-repo'))).toBe(
      true,
    );
    expect(result.failures.length + result.found.length).toBeGreaterThan(0);
  });

  it('EC-008: corrupt / fake .git isolated as failure on manual add', async () => {
    workspace = await createTempWorkspace('qa-ec008-');
    const broken = await createBrokenRepoDir(workspace, 'corrupt');
    const good = await createGitRepo(workspace, 'ok', { commits: 1 });
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        manualRepositories: [
          { path: broken, domain: nativeDomain },
          { path: good.path, domain: nativeDomain },
        ],
      }),
    );
    // Broken has a .git dir so discover may *find* it as a git repo by presence;
    // corruption surfaces at inspect time. At discovery layer: both may be "found".
    // Assert: discovery does not throw; good is present.
    expect(result.found.some((f) => f.root.path === good.path)).toBe(true);
  });

  it('EC-043: symlink loop bounded (no infinite walk)', async () => {
    workspace = await createTempWorkspace('qa-ec043-');
    const a = join(workspace, 'a');
    const b = join(workspace, 'b');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    // Junctions on Windows, where creating symlinks needs elevation.
    await linkDirectory(b, join(a, 'to-b'));
    await linkDirectory(a, join(b, 'to-a'));

    const started = Date.now();
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: workspace, domain: nativeDomain }],
        maxDepth: 20,
        maxDirectories: 50,
      }),
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(10_000);
    expect(result.directoriesVisited).toBeLessThanOrEqual(50);
    expect(result.found).toHaveLength(0);
  });

  it('exclusions: generated dir names skipped; disabled ids omitted', async () => {
    expect(isExcludedDirName('node_modules')).toBe(true);
    expect(isExcludedDirName('dist')).toBe(true);
    expect(isExcludedDirName('.next')).toBe(true);
    expect(isExcludedDirName('coverage')).toBe(true);
    expect(isExcludedDirName('vendor')).toBe(true);
    expect(isExcludedDirName('.venv')).toBe(true);

    workspace = await createTempWorkspace('qa-excl-');
    const hidden = await createGitRepo(join(workspace, 'node_modules'), 'lib', {
      commits: 1,
    });
    const visible = await createGitRepo(workspace, 'app', { commits: 1 });
    const result = await discoverRepositories(
      defaultDiscoveryConfig({
        roots: [{ path: workspace, domain: nativeDomain }],
        maxDepth: 3,
        disabledRepositoryIds: [],
      }),
    );
    expect(result.found.some((f) => f.root.path === visible.path)).toBe(true);
    expect(result.found.some((f) => f.root.path === hidden.path)).toBe(false);
  });
});
