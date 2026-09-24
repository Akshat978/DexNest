// Where modules may not look.
//
// DexNest's data root holds the vault, finance records, the journal, receipts,
// captures and the DPAPI keychain. Source-code access does not imply data
// access (AGENTS.md): a module that walks the filesystem - Developer
// Intelligence scanning repositories, later anything that indexes files - must
// never enter it, even when DexNest itself is one of the repositories.
//
// Comparison is by path, which is only safe if paths are compared the way the
// filesystem compares them. On Windows that means case-insensitively, and after
// resolving junctions and symlinks: `d:\desknest\LOCAL-DATA` and a junction
// pointing at the data root are both the data root.

import { resolve, sep } from "node:path";

export type Platform = NodeJS.Platform;

/**
 * A path in a form that can be compared by string: absolute, forward slashes,
 * no trailing separator, and lowercased where the filesystem ignores case.
 */
export function comparablePath(path: string, platform: Platform = process.platform): string {
  let out = resolve(path).replace(/\\/g, "/");
  if (out.length > 1 && out.endsWith("/") && !/^[A-Za-z]:\/$/.test(out)) out = out.slice(0, -1);
  return platform === "win32" ? out.toLowerCase() : out;
}

/** Whether `child` is `parent` or anything inside it. */
export function isWithin(child: string, parent: string, platform: Platform = process.platform): boolean {
  const c = comparablePath(child, platform);
  const p = comparablePath(parent, platform);
  if (c === p) return true;
  return c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

export interface DataBoundary {
  /** DexNest's resolved data root. */
  readonly dataRoot: string;
  /** Every root a module must not read, the data root included. */
  readonly sensitiveRoots: readonly string[];
  /**
   * True when `path` is inside a sensitive root, by its written form or by
   * where it really points. Unresolvable paths are judged by their written form.
   */
  isSensitive(path: string): boolean;
}

export interface DataBoundaryOptions {
  dataRoot: string;
  /** Further roots to deny, in addition to the data root. */
  extraSensitiveRoots?: readonly string[];
  /**
   * Resolves junctions and symlinks. Injected so this module stays free of
   * filesystem access; the host passes `fs.realpathSync.native`.
   */
  realpath?: (path: string) => string;
  platform?: Platform;
}

export function createDataBoundary(options: DataBoundaryOptions): DataBoundary {
  const platform = options.platform ?? process.platform;
  const real = (path: string): string | undefined => {
    if (!options.realpath) return undefined;
    try {
      return options.realpath(path);
    } catch {
      return undefined;
    }
  };

  const declared = [options.dataRoot, ...(options.extraSensitiveRoots ?? [])];
  // Both the written and the resolved form of each root, so a data root that is
  // itself reached through a junction is still recognised by either name.
  const roots = new Set<string>();
  for (const root of declared) {
    roots.add(comparablePath(root, platform));
    const resolved = real(root);
    if (resolved) roots.add(comparablePath(resolved, platform));
  }
  const rootList = [...roots];

  const inside = (path: string) => rootList.some((root) => isWithin(path, root, platform));

  return {
    dataRoot: options.dataRoot,
    sensitiveRoots: declared,
    isSensitive(path) {
      if (inside(path)) return true;
      const resolved = real(path);
      return resolved !== undefined && inside(resolved);
    }
  };
}

/** Joins with the platform separator; exported for callers building child paths. */
export const pathSeparator = sep;
