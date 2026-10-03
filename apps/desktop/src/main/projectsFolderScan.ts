// "Import projects": the walk behind it.
//
// Developer Intelligence's discovery, used here as a library: bounded depth and
// folder count, junction loops followed once, node_modules and hidden folders
// skipped, and nothing inside DexNest's data boundary walked or reported. It
// runs only when the owner asks, and doesn't need Developer Intelligence to be
// turned on.

import { defaultDiscoveryConfig, discoverRepositories } from "@dexnest/dev-intelligence";
import type { FolderScanPort } from "@dexnest/projects";

export const IMPORT_LIMITS = { maxDepth: 4, maxDirectories: 4000, maxRepositories: 500 } as const;

export function createFolderScan(isSensitive: (path: string) => boolean, limits: { maxDepth: number; maxDirectories: number; maxRepositories: number } = IMPORT_LIMITS): FolderScanPort {
  return {
    async scan(roots) {
      const domain = process.platform === "win32" ? "windows" : "wsl";
      const result = await discoverRepositories(defaultDiscoveryConfig({ roots: roots.map((path) => ({ path, domain })), ...limits }), undefined, { isSensitive });
      return {
        repositories: result.found.map((f) => ({ path: f.root.path, displayName: f.repository.displayName ?? null })),
        truncated: result.directoriesVisited >= limits.maxDirectories || result.found.length >= limits.maxRepositories,
        unreadable: result.failures.length
      };
    }
  };
}
