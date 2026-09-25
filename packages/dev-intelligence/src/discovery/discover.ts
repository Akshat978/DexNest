/**
 * Bounded repository discovery. Does NOT scan the entire computer.
 * Failure-isolated: one bad path does not abort the run.
 * Cancellable via CancelHandle.
 */

import { readdir, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import type {
  CancelHandle,
  Repository,
  RepositoryExecutionDomain,
  RepositoryRoot,
} from '@dexnest/dev-intelligence-contracts';
import type { DiscoveryConfig } from '../config/roots.js';
import { isExcludedDirName, isExcludedPath } from './exclusions.js';
import { displayNameFromPath, stableRepositoryId } from './identity.js';
import { repositoryIdentityKey, resolveRepositoryPath } from '../domain/path-translation.js';

export interface DiscoveredRepo {
  repository: Repository;
  root: RepositoryRoot;
  error?: undefined;
}

export interface DiscoveryFailure {
  path: string;
  domain: RepositoryExecutionDomain;
  error: string;
}

export interface DiscoveryResult {
  found: DiscoveredRepo[];
  failures: DiscoveryFailure[];
  directoriesVisited: number;
  cancelled: boolean;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'), fsConstants.F_OK);
    return true;
  } catch {
    // bare repo: HEAD + objects
    try {
      await access(join(dir, 'HEAD'), fsConstants.F_OK);
      await access(join(dir, 'objects'), fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function makeRepository(
  domain: RepositoryExecutionDomain,
  path: string,
  now: string,
): Repository {
  // The real path, not the one the walk arrived by: a repository reached
  // through a junction is recorded where it actually lives.
  const real = resolveRepositoryPath(path, domain);
  const id = stableRepositoryId(domain, real);
  return {
    schemaVersion: 1,
    id,
    displayName: displayNameFromPath(real),
    discoveredAt: now,
    lastSeenAt: now,
    roots: [{ path: real, domain }],
  };
}

export interface DiscoveryOptions {
  /**
   * The host's data boundary. Nothing inside it is walked or reported as a
   * repository - DexNest's own data root sits inside DexNest's repository.
   */
  isSensitive?: (absolutePath: string) => boolean;
}

export async function discoverRepositories(
  config: DiscoveryConfig,
  cancel?: CancelHandle,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const now = new Date().toISOString();
  const found: DiscoveredRepo[] = [];
  const failures: DiscoveryFailure[] = [];
  const seenIds = new Set<string>();
  // Directories already walked, by resolved identity. A junction cycle, a
  // junction alias and two overlapping configured roots all arrive at a
  // directory already seen and stop there, rather than walking it again under
  // another name until the depth limit runs out.
  const visited = new Set<string>();
  let directoriesVisited = 0;
  let cancelled = false;

  const disabled = new Set(config.disabledRepositoryIds);
  const sensitive = (path: string) => options.isSensitive?.(path) === true;

  const tryAdd = (domain: RepositoryExecutionDomain, path: string) => {
    if (sensitive(path)) return;
    const repo = makeRepository(domain, path, now);
    if (disabled.has(repo.id)) return;
    if (seenIds.has(repo.id)) return;
    if (found.length >= config.maxRepositories) return;
    seenIds.add(repo.id);
    found.push({
      repository: repo,
      root: repo.roots[0]!,
    });
  };

  // Manual repositories first
  for (const manual of config.manualRepositories) {
    if (cancel?.aborted) {
      cancelled = true;
      break;
    }
    if (
      isExcludedPath(
        manual.path,
        config.excludedRoots,
        config.excludedRepositories,
      )
    ) {
      continue;
    }
    try {
      const st = await stat(manual.path);
      if (!st.isDirectory()) {
        failures.push({
          path: manual.path,
          domain: manual.domain,
          error: 'not a directory',
        });
        continue;
      }
      if (await isGitRepo(manual.path)) {
        tryAdd(manual.domain, manual.path);
      } else {
        failures.push({
          path: manual.path,
          domain: manual.domain,
          error: 'not a git repository',
        });
      }
    } catch (err) {
      failures.push({
        path: manual.path,
        domain: manual.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  type QueueItem = {
    path: string;
    domain: RepositoryExecutionDomain;
    depth: number;
  };
  const queue: QueueItem[] = config.roots.map((r) => ({
    path: r.path,
    domain: r.domain,
    depth: 0,
  }));

  while (queue.length > 0) {
    if (cancel?.aborted) {
      cancelled = true;
      break;
    }
    if (found.length >= config.maxRepositories) break;
    if (directoriesVisited >= config.maxDirectories) break;

    const item = queue.shift()!;
    if (
      isExcludedPath(item.path, config.excludedRoots, config.excludedRepositories)
    ) {
      continue;
    }
    if (sensitive(item.path)) continue;

    // Checked before counting, so a cycle does not spend the directory budget
    // that real directories need.
    const key = repositoryIdentityKey(item.path, item.domain);
    if (visited.has(key)) continue;
    visited.add(key);

    directoriesVisited += 1;
    try {
      const st = await stat(item.path);
      if (!st.isDirectory()) continue;

      if (await isGitRepo(item.path)) {
        tryAdd(item.domain, item.path);
        // Do not recurse into a discovered git repo (nested repos are rare;
        // if needed they can be manual). Prevents deep walks under monorepos.
        continue;
      }

      if (item.depth >= config.maxDepth) continue;

      let entries;
      try {
        entries = await readdir(item.path, { withFileTypes: true });
      } catch (err) {
        failures.push({
          path: item.path,
          domain: item.domain,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (isExcludedDirName(entry.name)) continue;
        // Skip hidden dirs except we already skip .git via exclusions
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        queue.push({
          path: join(item.path, entry.name),
          domain: item.domain,
          depth: item.depth + 1,
        });
      }
    } catch (err) {
      failures.push({
        path: item.path,
        domain: item.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { found, failures, directoriesVisited, cancelled };
}
