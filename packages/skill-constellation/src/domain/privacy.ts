/**
 * Paths that look like private data are never recorded as evidence.
 *
 * Skill Constellation reads no files, but it does store paths, and a path can
 * itself be private ("finance/2026-taxes.xlsx"). Developer Intelligence already
 * refuses DexNest's data root; this is the second fence, applied by name so it
 * holds whatever repository the path came from. The host's data boundary is the
 * third (see the engine).
 */

/** Any path segment equal to one of these marks the whole path private. */
const PRIVATE_SEGMENTS = new Set([
  'local-data',
  'vault',
  'receipts',
  'finance',
  'journal',
  'captures',
  'secrets',
  '.ssh',
  '.gnupg',
]);

const PRIVATE_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|kdbx|keychain)$/i,
  /\.(sqlite|sqlite3|db|db-wal|db-shm)$/i,
  /^\.?(npmrc|netrc|pgpass)$/i,
];

/** Forward slashes, no leading "./", no trailing slash. */
export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

/**
 * Evidence paths are repository-relative. One that is absolute (POSIX, a
 * Windows drive, a UNC share) or climbs out with ".." does not describe a file
 * in the repository, whatever produced it, so it is never recorded.
 */
export function escapesRepository(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split('/').some((segment) => segment === '..');
}

export function isPrivateLookingPath(path: string): boolean {
  const segments = normalizeRelativePath(path)
    .split('/')
    .filter((s) => s.length > 0);
  if (segments.some((segment) => PRIVATE_SEGMENTS.has(segment.toLowerCase()))) return true;
  const file = segments[segments.length - 1] ?? '';
  return PRIVATE_FILE_PATTERNS.some((pattern) => pattern.test(file));
}
