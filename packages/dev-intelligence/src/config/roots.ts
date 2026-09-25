import type { RepositoryExecutionDomain } from '@dexnest/dev-intelligence-contracts';

/** User / host configuration for discovery. */
export interface DiscoveryConfig {
  /** Root directories to scan (bounded). */
  roots: Array<{ path: string; domain: RepositoryExecutionDomain }>;
  /** Explicit repositories to include without scanning parents. */
  manualRepositories: Array<{ path: string; domain: RepositoryExecutionDomain }>;
  /** Paths that must not be entered. */
  excludedRoots: string[];
  /** Specific repo paths to skip. */
  excludedRepositories: string[];
  /** Previously known repo ids that are disabled. */
  disabledRepositoryIds: string[];
  /** Max directory depth from each root (default 4). */
  maxDepth: number;
  /** Max directories visited across a discovery run (default 2000). */
  maxDirectories: number;
  /** Max repos discovered in one run (default 200). */
  maxRepositories: number;
}

export function defaultDiscoveryConfig(
  partial?: Partial<DiscoveryConfig>,
): DiscoveryConfig {
  return {
    roots: partial?.roots ?? [],
    manualRepositories: partial?.manualRepositories ?? [],
    excludedRoots: partial?.excludedRoots ?? [],
    excludedRepositories: partial?.excludedRepositories ?? [],
    disabledRepositoryIds: partial?.disabledRepositoryIds ?? [],
    maxDepth: partial?.maxDepth ?? 4,
    maxDirectories: partial?.maxDirectories ?? 2000,
    maxRepositories: partial?.maxRepositories ?? 200,
  };
}
