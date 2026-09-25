/**
 * Path normalization / Windows↔WSL translation at the adapter edge.
 * On Linux-only hosts, WSL-style paths are treated as posix paths.
 */

import { resolve, normalize, isAbsolute, posix } from 'node:path';
import { realpathSync } from 'node:fs';
import type {
  PathTranslationPort,
  RepositoryExecutionDomain,
} from '@dexnest/dev-intelligence-contracts';

const WIN_DRIVE = /^([A-Za-z]):([\\/].*)$/;
const WSL_MNT = /^\/mnt\/([a-zA-Z])(\/.*)?$/;

export function canonicalPath(path: string): string {
  // Preserve Unicode; normalize separators conceptually for identity.
  const normalized = normalize(path);
  // On posix, resolve to absolute when possible.
  try {
    return isAbsolute(normalized) ? resolve(normalized) : normalized;
  } catch {
    return normalized;
  }
}

/** Whether paths in `domain` are native to the machine DI is running on. */
function isNativeDomain(domain: RepositoryExecutionDomain): boolean {
  return process.platform === 'win32' ? domain === 'windows' : domain === 'wsl';
}

/**
 * The path a repository really lives at.
 *
 * For paths native to this machine that means following junctions and
 * symlinks with realpath, which on Windows also returns the true on-disk
 * casing. Without it, one repository reached as D:\Code\app, d:\code\app and
 * through a junction was recorded as three repositories, each with its own
 * history and its own Standup issues.
 *
 * A WSL path seen from Windows is normalised with POSIX rules and never run
 * through Windows path resolution, which would turn /home/me/app into
 * D:\home\me\app. Unresolvable paths fall back to their normalised form.
 */
export function resolveRepositoryPath(path: string, domain: RepositoryExecutionDomain): string {
  if (!isNativeDomain(domain)) {
    const normalized = posix.normalize(path.replace(/\\/g, '/'));
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  }
  const canon = canonicalPath(path);
  try {
    return realpathSync.native(canon);
  } catch {
    return canon;
  }
}

/**
 * The string repository identity is derived from: the resolved path with
 * forward slashes and no trailing separator, case-folded for Windows, whose
 * filesystem ignores case. Two genuinely different repositories resolve to
 * different real paths, so they never collide.
 */
export function repositoryIdentityKey(path: string, domain: RepositoryExecutionDomain): string {
  const resolved = resolveRepositoryPath(path, domain).replace(/\\/g, '/');
  const trimmed = resolved.length > 1 && !/^[A-Za-z]:\/$/.test(resolved) ? resolved.replace(/\/$/, '') : resolved;
  return domain === 'windows' ? trimmed.toLowerCase() : trimmed;
}

export class DefaultPathTranslation implements PathTranslationPort {
  detectDomain(path: string): RepositoryExecutionDomain | undefined {
    if (WIN_DRIVE.test(path) || path.includes('\\')) {
      return 'windows';
    }
    if (WSL_MNT.test(path) || path.startsWith('/')) {
      // Posix / WSL-style — map to wsl domain for contract compatibility.
      return 'wsl';
    }
    return undefined;
  }

  toDomainPath(path: string, targetDomain: RepositoryExecutionDomain): string {
    if (targetDomain === 'wsl') {
      const m = WIN_DRIVE.exec(path);
      if (m) {
        const drive = m[1]!.toLowerCase();
        const rest = (m[2] ?? '').replace(/\\/g, '/');
        return `/mnt/${drive}${rest}`;
      }
      return path.replace(/\\/g, '/');
    }

    // windows
    const m = WSL_MNT.exec(path.replace(/\\/g, '/'));
    if (m) {
      const drive = m[1]!.toUpperCase();
      const rest = (m[2] ?? '').replace(/\//g, '\\');
      return `${drive}:${rest || '\\'}`;
    }
    return path;
  }
}
