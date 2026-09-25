/**
 * Stable repository identity from domain + resolved path.
 *
 * v2: the path is resolved through realpath and case-folded on Windows before
 * hashing (see repositoryIdentityKey). v1 hashed the path as written, so the
 * same repository reached by a different spelling or through a junction got a
 * different id - and with it a separate history.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { RepositoryExecutionDomain } from '@dexnest/dev-intelligence-contracts';
import { repositoryIdentityKey } from '../domain/path-translation.js';

export function stableRepositoryId(
  domain: RepositoryExecutionDomain,
  path: string,
): string {
  const key = repositoryIdentityKey(path, domain);
  const digest = createHash('sha256')
    .update(`v2|${domain}|${key}`)
    .digest('hex')
    .slice(0, 32);
  return `repo_${digest}`;
}

export function displayNameFromPath(path: string): string {
  const base = basename(path.replace(/[/\\]+$/, '') || path);
  return base || path;
}
