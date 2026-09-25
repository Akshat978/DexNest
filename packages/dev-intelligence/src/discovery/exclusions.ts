/** Directory / path exclusion rules for bounded discovery. */

const EXCLUDED_DIR_NAMES = new Set(
  [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    'vendor',
    'venv',
    '.venv',
    '__pycache__',
    '.cache',
    '.turbo',
    '.pnpm-store',
    'target', // rust
    '.git', // do not recurse into .git internals as discovery roots
    '.hg',
    '.svn',
    '.idea',
    '.vscode',
  ].map((s) => s.toLowerCase()),
);

export function isExcludedDirName(name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name.toLowerCase());
}

export function isExcludedPath(
  absolutePath: string,
  excludedRoots: readonly string[],
  excludedRepos: readonly string[],
): boolean {
  const norm = absolutePath.replace(/\\/g, '/');
  for (const root of excludedRoots) {
    const r = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (norm === r || norm.startsWith(r + '/')) return true;
  }
  for (const repo of excludedRepos) {
    const r = repo.replace(/\\/g, '/').replace(/\/$/, '');
    if (norm === r || norm.startsWith(r + '/')) return true;
  }
  return false;
}

export { EXCLUDED_DIR_NAMES };
