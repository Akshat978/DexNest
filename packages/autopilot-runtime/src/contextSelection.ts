// Deciding which files the worker gets to see.
//
// The worker has no tools, so the prompt is its only view of the code. The
// first live trial sent every tracked file, which works for a toy repo and is
// hopeless for a real one. This picks a bounded, ordered, deterministic set
// instead.
//
// Deliberately NOT here: embeddings, RAG, semantic search, or a model choosing
// files. Every rule below is plain string matching over evidence DexNest
// already holds, so the same inputs always produce the same selection — which
// is what makes it reproducible across a restart.

export type ContextReason =
  | "worker-request"
  | "spec-reference"
  | "failure-output"
  | "previously-changed"
  | "project-metadata"
  | "fallback";

export interface ContextCandidate {
  path: string;
  reason: ContextReason;
  /** Lower sorts first. Fixed per reason, so ordering is stable. */
  priority: number;
}

export interface ContextLimits {
  maxFiles: number;
  maxBytes: number;
  /** Selection falls back to tracked files below this count. */
  minFiles: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { maxFiles: 12, maxBytes: 80_000, minFiles: 2 };

/** Config files a failing command usually needs in order to be understood. */
const METADATA_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "vitest.config.ts",
  "jest.config.js",
  "eslint.config.js",
  ".eslintrc.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod"
];

const PRIORITY: Record<ContextReason, number> = {
  // A file the worker explicitly asked for outranks everything: it is the only
  // signal that comes from the worker's own understanding of what it is missing.
  "worker-request": -1,
  "failure-output": 0,
  "previously-changed": 1,
  "spec-reference": 2,
  "project-metadata": 3,
  fallback: 4
};

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

/**
 * Extracts workspace-relative paths mentioned in arbitrary text.
 *
 * Matched against the tracked file list rather than trusted directly, so a
 * hallucinated or absolute path can never become a read.
 */
export function extractReferencedPaths(text: string, tracked: string[]): string[] {
  if (!text) return [];
  const haystack = text.replace(/\\/g, "/");
  const lowerTracked = new Map(tracked.map((path) => [path.toLowerCase(), path]));
  const found: string[] = [];
  const seen = new Set<string>();

  // Any token that looks like a path, plus bare file names.
  const tokens = haystack.match(/[\w.@/-]+\.[A-Za-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const candidate = normalize(token);
    const direct = lowerTracked.get(candidate.toLowerCase());
    if (direct && !seen.has(direct)) {
      seen.add(direct);
      found.push(direct);
      continue;
    }
    // A bare basename ("lru.test.mjs") should still match its tracked path.
    const base = candidate.split("/").pop()!.toLowerCase();
    for (const [lower, original] of lowerTracked) {
      if (lower.endsWith(`/${base}`) || lower === base) {
        if (!seen.has(original)) {
          seen.add(original);
          found.push(original);
        }
        break;
      }
    }
  }
  return found;
}

export interface SelectionInput {
  /** Every tracked file, from `git ls-files`. The only readable universe. */
  tracked: string[];
  /** Goal, constraints, non-goals and acceptance criteria text. */
  specText: string;
  /** Combined output of the failing verification tiers, if any. */
  failureOutput: string;
  /** Workspace-relative paths the worker changed on previous turns. */
  changed: string[];
  /** Paths the worker explicitly asked for. Highest priority, this turn only. */
  requested?: string[];
  limits?: ContextLimits;
}

export interface Selection {
  files: ContextCandidate[];
  /** Tracked files deliberately left out, for the audit record. */
  omitted: number;
  limits: ContextLimits;
}

/**
 * Chooses the files to embed in the next prompt.
 *
 * Priority order, highest first:
 *   1. files named in the failing command's output  — what actually broke
 *   2. files the worker already changed             — its own work in progress
 *   3. files the Run Spec names                     — the human's framing
 *   4. project metadata a failing command needs
 *   5. a bounded fallback, only when the above are too thin to work with
 *
 * Within a reason, tracked order is preserved, so the result is stable.
 */
export function selectContextFiles(input: SelectionInput): Selection {
  const limits = input.limits ?? DEFAULT_CONTEXT_LIMITS;
  const tracked = input.tracked.map(normalize).filter(Boolean);
  const trackedSet = new Set(tracked);

  const candidates: ContextCandidate[] = [];
  const claimed = new Set<string>();

  const add = (paths: string[], reason: ContextReason) => {
    for (const raw of paths) {
      const path = normalize(raw);
      if (!path || claimed.has(path) || !trackedSet.has(path)) continue;
      claimed.add(path);
      candidates.push({ path, reason, priority: PRIORITY[reason] });
    }
  };

  add(input.requested ?? [], "worker-request");
  add(extractReferencedPaths(input.failureOutput, tracked), "failure-output");
  add(input.changed, "previously-changed");
  add(extractReferencedPaths(input.specText, tracked), "spec-reference");
  add(
    METADATA_FILES.filter((name) => trackedSet.has(name)),
    "project-metadata"
  );

  // Only widen when the targeted evidence is too thin to act on.
  if (candidates.length < limits.minFiles) {
    add(tracked, "fallback");
  }

  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      left.candidate.priority === right.candidate.priority
        ? left.index - right.index
        : left.candidate.priority - right.candidate.priority
    )
    .map((entry) => entry.candidate);

  const files = ordered.slice(0, limits.maxFiles);
  return { files, omitted: Math.max(0, tracked.length - files.length), limits };
}
