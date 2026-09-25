/**
 * TODO/FIXME/HACK/XXX scanner — facts only; never stores whole source files.
 * Skips binary, huge, generated, and secret-like paths.
 *
 * The files it reads come from Git, not from walking the directory. A walk
 * only knows the handful of names it was told to skip; Git knows what the
 * repository actually contains and what its owner chose to ignore. Walking
 * DexNest's own repository reached local-data - the vault, the journal,
 * finance records - and copied any line mentioning TODO into this database.
 * Git never lists local-data, because it is ignored, and the data boundary
 * check below refuses it even if a repository forgot to ignore it.
 */

import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fingerprintTodoMarker,
  type TodoMarker,
  type TodoMarkerKind,
} from '@dexnest/dev-intelligence-contracts';
import { isExcludedDirName } from '../discovery/exclusions.js';

const MARKER_RE =
  /\b(TODO|FIXME|HACK|XXX)(?:\s*[:\-]?\s*|\s+)([^\n\r]{0,240})/g;

const SECRET_LIKE_NAMES = new Set(
  [
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    '.envrc',
    'id_rsa',
    'id_dsa',
    'id_ed25519',
    'id_ecdsa',
    '.npmrc',
    '.pypirc',
    '.netrc',
    '.git-credentials',
    'credentials',
    'credentials.json',
    'secrets.json',
    'secret.json',
    'secrets.yaml',
    'secrets.yml',
    'service-account.json',
    'google-services.json',
    'private.key',
    'private.pem',
  ].map((s) => s.toLowerCase()),
);

const SECRET_LIKE_EXT = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.keystore',
  '.jks',
  '.kdbx',
]);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.md',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.bash',
  '.zsh',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.svelte',
  '.sql',
]);

export const DEFAULT_MAX_TODO_FILE_BYTES = 512 * 1024;
export const DEFAULT_MAX_TODO_FILES = 5_000;

export interface TodoScanOptions {
  repositoryId: string;
  rootPath: string;
  /**
   * Repository-relative paths to consider, as Git reports them: tracked files
   * plus untracked files that are not ignored. Untracked-but-not-ignored are
   * included on purpose - a TODO in a file not yet committed is exactly
   * "where work was left". Required: there is no directory-walk fallback.
   */
  listFiles: () => Promise<readonly string[]>;
  /**
   * The host's data boundary. A path for which this returns true is never
   * opened, whatever Git says about it.
   */
  isSensitive?: (absolutePath: string) => boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  now?: string;
}

export interface TodoScanResult {
  todos: ObservedTodo[];
  /**
   * False when some candidates were not examined (the file cap was reached).
   * An incomplete scan must not be used to resolve markers it never looked
   * for - absence from a partial scan is not evidence of removal.
   */
  complete: boolean;
  candidates: number;
  filesRead: number;
  /** Refused by the data boundary. Counted so a misconfiguration is visible. */
  refusedSensitive: number;
  /** Listed by Git but really located outside the repository (junction, link). */
  refusedOutside: number;
  /**
   * Every candidate that passed the boundary, containment and regular-file
   * checks, repository-relative. Other readers of the repository - technology
   * detection - take their files from here, so there is one vetted list and no
   * second walk of the directory that could reach what this one refused.
   */
  safeFiles: string[];
}

export interface ObservedTodo {
  kind: TodoMarkerKind;
  filePath: string;
  line: number;
  column: number;
  text: string;
  fingerprint: string;
}

export function isSecretLikePath(relPath: string): boolean {
  const base = basename(relPath).toLowerCase();
  if (SECRET_LIKE_NAMES.has(base)) return true;
  if (base.startsWith('.env')) return true;
  const ext = extname(base);
  if (SECRET_LIKE_EXT.has(ext)) return true;
  if (base.endsWith('.key') || base.endsWith('.pem')) return true;
  return false;
}

export function isProbablyBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function shouldSkipFile(relPath: string, size: number, maxBytes: number): boolean {
  if (size > maxBytes) return true;
  if (isSecretLikePath(relPath)) return true;
  const parts = relPath.replace(/\\/g, '/').split('/');
  for (const part of parts.slice(0, -1)) {
    if (isExcludedDirName(part)) return true;
  }
  const ext = extname(relPath).toLowerCase();
  if (ext && !TEXT_EXT.has(ext)) {
    // Allow extensionless small text-ish files via content sniff later
    if (ext === '.lock' || ext === '.min.js') return true;
    if (!TEXT_EXT.has(ext) && ext !== '') {
      // skip known non-text
      const binaryish = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.ico',
        '.pdf',
        '.zip',
        '.gz',
        '.tar',
        '.woff',
        '.woff2',
        '.ttf',
        '.eot',
        '.mp4',
        '.mp3',
        '.wasm',
        '.so',
        '.dll',
        '.exe',
        '.bin',
        '.o',
        '.a',
      ];
      if (binaryish.includes(ext)) return true;
    }
  }
  return false;
}

export function extractMarkersFromText(
  content: string,
  filePath: string,
): ObservedTodo[] {
  const out: ObservedTodo[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    MARKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(line)) !== null) {
      const kind = m[1]! as TodoMarkerKind;
      const text = (m[2] ?? '').trim();
      const fingerprint = fingerprintTodoMarker(kind, text);
      out.push({
        kind,
        filePath,
        line: i + 1,
        column: (m.index ?? 0) + 1,
        text: text.slice(0, 240),
        fingerprint,
      });
    }
  }
  return out;
}

/** Whether a repository-relative path runs through a directory never worth reading. */
function inExcludedDir(relPath: string): boolean {
  const parts = relPath.split('/');
  return parts.slice(0, -1).some((part) => isExcludedDirName(part));
}

/** Whether `child` is `parent` or inside it, comparing as the filesystem does. */
function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => {
    const forward = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? forward.toLowerCase() : forward;
  };
  const c = norm(child);
  const r = norm(parent);
  return c === r || c.startsWith(r + '/');
}

/**
 * Reads the candidate files Git lists and extracts markers.
 *
 * Every file is checked by where it really is, not by the path Git reported.
 * A symlink is an entry of its own and is skipped, but on Windows Git also
 * walks into junctions and lists the files beyond them as ordinary files - so
 * a junction inside a repository pointing elsewhere made those files look
 * like repository content. Each candidate's real path must lie inside the
 * repository's real path, and the data boundary is checked against both.
 */
export async function scanTodoCandidates(options: TodoScanOptions): Promise<TodoScanResult> {
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_TODO_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_TODO_FILES;

  // A failure here propagates. Returning an empty list instead would read as
  // "every TODO in this repository was resolved", and the reconciler would
  // record exactly that.
  const listed = await options.listFiles();
  const candidates = [...new Set(listed.map((path) => path.replace(/\\/g, '/')))]
    .filter((rel) => rel && !rel.startsWith('../') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel))
    .filter((rel) => !inExcludedDir(rel))
    .sort();

  const complete = candidates.length <= maxFiles;
  const todos: ObservedTodo[] = [];
  let filesRead = 0;
  let refusedSensitive = 0;
  let refusedOutside = 0;
  const safeFiles: string[] = [];

  let rootReal: string;
  try {
    rootReal = await realpath(options.rootPath);
  } catch {
    rootReal = options.rootPath;
  }

  for (const rel of candidates.slice(0, maxFiles)) {
    const abs = join(options.rootPath, rel);
    if (options.isSensitive?.(abs)) {
      refusedSensitive += 1;
      continue;
    }

    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      continue; // tracked but deleted from the working tree
    }
    if (!isInside(real, rootReal)) {
      refusedOutside += 1;
      continue;
    }
    if (real !== abs && options.isSensitive?.(real)) {
      refusedSensitive += 1;
      continue;
    }

    let st;
    try {
      st = await lstat(abs);
    } catch {
      continue; // tracked but deleted from the working tree
    }
    if (!st.isFile()) continue; // symlinks, and submodule gitlinks
    safeFiles.push(rel);
    if (shouldSkipFile(rel, st.size, maxBytes)) continue;

    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      continue;
    }
    if (buf.length > maxBytes) continue;
    if (isProbablyBinary(buf)) continue;

    filesRead += 1;
    todos.push(...extractMarkersFromText(buf.toString('utf8'), rel));
  }

  return { todos, complete, candidates: candidates.length, filesRead, refusedSensitive, refusedOutside, safeFiles };
}

/** The markers alone. Prefer scanTodoCandidates where completeness matters. */
export async function scanTodos(options: TodoScanOptions): Promise<ObservedTodo[]> {
  return (await scanTodoCandidates(options)).todos;
}

/** Build a durable TodoMarker from an observation (new id if needed). */
export function observationToMarker(
  repositoryId: string,
  obs: ObservedTodo,
  now: string,
  existing?: TodoMarker,
): TodoMarker {
  if (existing) {
    return {
      ...existing,
      filePath: obs.filePath,
      line: obs.line,
      column: obs.column,
      text: obs.text,
      kind: obs.kind,
      status: 'open',
      lastObservedAt: now,
      resolvedAt: undefined,
      previousFilePath:
        existing.filePath !== obs.filePath
          ? existing.filePath
          : existing.previousFilePath,
    };
  }
  const id = `todo_${createHash('sha256')
    .update(`${repositoryId}|${obs.fingerprint}`)
    .digest('hex')
    .slice(0, 24)}`;
  return {
    schemaVersion: 1,
    id,
    repositoryId,
    kind: obs.kind,
    status: 'open',
    filePath: obs.filePath,
    line: obs.line,
    column: obs.column,
    text: obs.text,
    fingerprint: obs.fingerprint,
    firstObservedAt: now,
    lastObservedAt: now,
  };
}
