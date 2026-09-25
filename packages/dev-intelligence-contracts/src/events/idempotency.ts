/**
 * Deterministic fingerprint helpers for Developer Events.
 *
 * Rules (ARCHITECTURE.md / Phase 1):
 * - Observing the same Git commit repeatedly MUST NOT duplicate commit events.
 * - Scanning an unchanged repository MUST NOT create duplicate consequential events.
 * - Fingerprints are derived from stable inputs (type + repositoryId + consequential keys).
 * - eventId may be unique per emission attempt; idempotent stores key on `fingerprint`
 *   (and optionally type+repositoryId) so inserts are no-ops on conflict.
 *
 * Algorithm: FNV-1a 32-bit over a canonical string, hex-encoded with a short prefix.
 * Pure / sync — no crypto dependency required for Phase 1 stubs.
 */

import type { DeveloperEventType } from './types.js';

/** Canonical separator that must not appear unescaped in keys (keys are constrained). */
const SEP = '\u001f';

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Build a fingerprint from type + repo + ordered stable parts. */
export function fingerprintFromParts(
  type: DeveloperEventType,
  repositoryId: string,
  ...parts: Array<string | number | boolean | undefined | null>
): string {
  const normalized = parts.map((p) =>
    p === undefined || p === null ? '' : String(p),
  );
  const canonical = [type, repositoryId, ...normalized].join(SEP);
  return `fp_${fnv1a32(canonical)}_${fnv1a32(canonical.split('').reverse().join(''))}`;
}

/** Same commit in the same repo → same fingerprint. */
export function fingerprintCommitObserved(
  repositoryId: string,
  commitSha: string,
): string {
  return fingerprintFromParts('dev.commit.observed', repositoryId, commitSha);
}

/** Snapshot events keyed by content fingerprint when available, else head+branch+wt summary. */
export function fingerprintRepoSnapshot(
  repositoryId: string,
  contentFingerprint: string,
): string {
  return fingerprintFromParts(
    'dev.repo.snapshot',
    repositoryId,
    contentFingerprint,
  );
}

export function fingerprintRepoDiscovered(
  repositoryId: string,
  rootPath: string,
  domain: string,
): string {
  return fingerprintFromParts(
    'dev.repo.discovered',
    repositoryId,
    domain,
    rootPath,
  );
}

export function fingerprintBranchChanged(
  repositoryId: string,
  previousBranch: string | undefined,
  currentBranch: string | undefined,
  headSha: string | undefined,
): string {
  return fingerprintFromParts(
    'dev.branch.changed',
    repositoryId,
    previousBranch ?? '',
    currentBranch ?? '',
    headSha ?? '',
  );
}

export function fingerprintWorkingTreeChanged(
  repositoryId: string,
  isClean: boolean,
  stagedCount: number,
  unstagedCount: number,
  untrackedCount: number,
  conflictedCount: number,
): string {
  return fingerprintFromParts(
    'dev.working_tree.changed',
    repositoryId,
    isClean,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictedCount,
  );
}

export function fingerprintConflictObserved(
  repositoryId: string,
  conflictSignature: string,
): string {
  return fingerprintFromParts(
    'dev.conflict.observed',
    repositoryId,
    conflictSignature,
  );
}

export function fingerprintGitOperation(
  type: 'dev.git_operation.started' | 'dev.git_operation.resolved',
  repositoryId: string,
  operation: string,
  detail?: string,
): string {
  return fingerprintFromParts(type, repositoryId, operation, detail ?? '');
}

export function fingerprintTodo(
  type: 'dev.todo.observed' | 'dev.todo.resolved',
  repositoryId: string,
  todoFingerprint: string,
): string {
  return fingerprintFromParts(type, repositoryId, todoFingerprint);
}

export function fingerprintHealthCompleted(
  repositoryId: string,
  healthRunId: string,
): string {
  return fingerprintFromParts(
    'dev.health.completed',
    repositoryId,
    healthRunId,
  );
}

export function fingerprintTechnologyObserved(
  repositoryId: string,
  technologyFingerprint: string,
): string {
  return fingerprintFromParts(
    'dev.technology.observed',
    repositoryId,
    technologyFingerprint,
  );
}

/**
 * Stable fingerprint for a TODO marker itself (store upsert key).
 * Content-stable: kind + normalized text only so moves/renames keep identity.
 * filePath/line args retained for call-site compatibility but ignored.
 */
export function fingerprintTodoMarker(
  kind: string,
  filePathOrText: string,
  lineOrText?: number | string | undefined,
  textArg?: string,
): string {
  let text: string;
  if (typeof textArg === 'string') {
    text = textArg;
  } else if (typeof lineOrText === 'string') {
    text = lineOrText;
  } else {
    // fingerprintTodoMarker(kind, text)
    text = filePathOrText;
  }
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  const canonical = ['todo', kind, normalizedText].join(SEP);
  return `todo_${fnv1a32(canonical)}_${fnv1a32(normalizedText)}`;
}

/**
 * Stable fingerprint for a technology fact (includes provenance path).
 */
export function fingerprintTechnologyFact(
  category: string,
  name: string,
  version: string | undefined,
  evidencePath: string,
): string {
  const canonical = ['tech', category, name, version ?? '', evidencePath].join(
    SEP,
  );
  return `tech_${fnv1a32(canonical)}`;
}

export function fingerprintTechnologyRemoved(
  repositoryId: string,
  technologyFingerprint: string,
): string {
  return fingerprintFromParts(
    'dev.technology.removed',
    repositoryId,
    technologyFingerprint,
  );
}
