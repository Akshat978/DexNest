/**
 * The host's data boundary, asked about a repository-relative path.
 *
 * A path is sensitive when the repository has no known root, when a root is
 * itself inside DexNest's data, or when the path joined to any root is. All
 * roots are checked, WSL ones included: stricter than needed costs nothing
 * here, because nothing is read - only what gets recorded changes.
 */

import type { DataBoundary } from '@dexnest/foundation';
import type { RepositoryRoots } from './collect.ts';

function joinRoot(root: string, relativePath: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  return `${trimmed}${separator}${relativePath.split('/').join(separator)}`;
}

export function repositoryBoundary(
  boundary: Pick<DataBoundary, 'isSensitive'>,
  repositories: readonly RepositoryRoots[],
): (repositoryId: string, relativePath: string) => boolean {
  const roots = new Map(repositories.map((r) => [r.id, r.roots]));
  return (repositoryId, relativePath) => {
    const repositoryRoots = roots.get(repositoryId);
    if (!repositoryRoots || repositoryRoots.length === 0) return true;
    return repositoryRoots.some((root) => boundary.isSensitive(root) || boundary.isSensitive(joinRoot(root, relativePath)));
  };
}
