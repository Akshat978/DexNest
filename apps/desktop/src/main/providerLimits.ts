// The desktop's half of plan-limit tracking: reading the files, and nothing else.
//
// The maths lives in the runtime package and touches no filesystem. This
// module is the part that does — it finds the official clients' logs, streams
// them, hands lines to the parsers, and keeps the results between polls so a
// one-minute refresh re-reads only what changed.
//
// WHAT IT READS, AND WHAT IT DOES NOT
//
//   ~/.claude.json                     the cached utilization (anchor)
//   ~/.claude/projects/**/*.jsonl      session transcripts (samples)
//   ~/.codex/sessions/**/*.jsonl       rollout logs (anchor + samples)
//
// It never opens ~/.claude/.credentials.json or ~/.codex/auth.json, and it
// makes no network request. That is the whole point: the number on the
// Command page comes from files the official clients wrote on this machine,
// which is not the same act as using the account's token somewhere else.
//
// WHY A PER-FILE CACHE
//
// A transcript can run to hundreds of megabytes, and there are dozens. Parsing
// all of them every minute would make the dashboard the most expensive thing
// DexNest does. So each file's samples are cached against its size and mtime,
// and only a file that grew is re-read. Only files touched inside the longest
// window (a week) matter at all; older ones cannot contribute to any bucket.

import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  liveReport, parseClaudeAnchor, parseClaudeSamples, parseCodexAnchor, parseCodexSamples,
  type Anchor, type LiveReport, type Provider, type Sample
} from "@dexnest/autopilot-runtime";
import type { ProviderLimitsProvider, ProviderLimitsSnapshot } from "@dexnest/shared-types";

const WEEK_MS = 7 * 24 * 60 * 60_000;

interface FileEntry {
  size: number;
  mtimeMs: number;
  samples: Sample[];
  /** Codex only: the newest populated rate_limits record in this file. */
  anchor: Anchor | null;
}

/** Budgets solved from good anchors, kept so a rolled-over window still has one. */
type Budgets = Partial<Record<Provider, Record<string, number>>>;

export interface ProviderLimitsService {
  snapshot: () => Promise<ProviderLimitsSnapshot>;
}

export function createProviderLimitsService(options: { budgetsPath: string; homeDir?: string }): ProviderLimitsService {
  const home = options.homeDir ?? homedir();
  const claudeRoot = join(home, ".claude", "projects");
  const claudeAnchorPath = join(home, ".claude.json");
  const codexRoot = join(home, ".codex", "sessions");

  const claudeFiles = new Map<string, FileEntry>();
  const codexFiles = new Map<string, FileEntry>();
  let budgets: Budgets = readBudgets(options.budgetsPath);
  let inflight: Promise<ProviderLimitsSnapshot> | null = null;

  // Two callers a second apart share one read rather than racing the disk.
  const snapshot = (): Promise<ProviderLimitsSnapshot> => {
    if (!inflight) inflight = build().finally(() => { inflight = null; });
    return inflight;
  };

  async function build(): Promise<ProviderLimitsSnapshot> {
    const now = new Date();
    const nowIso = now.toISOString();
    const providers: ProviderLimitsProvider[] = [];

    providers.push(await guarded("claude", async () => {
      const anchor = existsSync(claudeAnchorPath) ? parseClaudeAnchor(readFileSync(claudeAnchorPath, "utf8")) : null;
      await refresh(claudeFiles, claudeRoot, now, lines => ({ samples: parseClaudeSamples(lines), anchor: null }));
      return liveReport("claude", anchor, allSamples(claudeFiles), nowIso, budgets.claude ?? {});
    }, nowIso));

    providers.push(await guarded("codex", async () => {
      await refresh(codexFiles, codexRoot, now, lines => ({
        samples: parseCodexSamples([{ lines }]),
        anchor: parseCodexAnchor(lines)
      }));
      let anchor: Anchor | null = null;
      for (const entry of codexFiles.values()) {
        if (entry.anchor && (!anchor || entry.anchor.fetchedAt > anchor.fetchedAt)) anchor = entry.anchor;
      }
      return liveReport("codex", anchor, allSamples(codexFiles), nowIso, budgets.codex ?? {});
    }, nowIso));

    remember(providers);
    return { generatedAt: nowIso, providers };
  }

  /**
   * Re-reads files that changed, forgets files that fell out of the week.
   *
   * A file is read in full when it changes rather than from its last offset:
   * the dedupe in the parser needs the whole file to be correct, and a changed
   * file is usually the one live session, which is the one worth the cost.
   */
  async function refresh(
    cache: Map<string, FileEntry>,
    root: string,
    now: Date,
    parse: (lines: string[]) => { samples: Sample[]; anchor: Anchor | null }
  ): Promise<void> {
    const cutoff = now.getTime() - WEEK_MS;
    const seen = new Set<string>();
    for (const path of walk(root)) {
      let stat;
      try { stat = statSync(path); } catch { continue; }
      if (stat.mtimeMs < cutoff || stat.size === 0) continue;
      seen.add(path);
      const cached = cache.get(path);
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) continue;
      const parsed = parse(await readLines(path));
      cache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, ...parsed });
    }
    for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
  }

  /** Keeps every budget a calibrated bucket solved, so rollovers have one. */
  function remember(providers: readonly ProviderLimitsProvider[]): void {
    let changed = false;
    for (const p of providers) {
      for (const b of p.buckets) {
        if (b.confidence !== "calibrated" || b.budget === null) continue;
        const forProvider = (budgets[p.provider] ??= {});
        if (forProvider[b.id] !== b.budget) { forProvider[b.id] = b.budget; changed = true; }
      }
    }
    if (changed) writeBudgets(options.budgetsPath, budgets);
  }

  return { snapshot };
}

// --- helpers -----------------------------------------------------------------

async function guarded(
  provider: Provider,
  run: () => Promise<LiveReport>,
  nowIso: string
): Promise<ProviderLimitsProvider> {
  try {
    return { ...toProvider(await run()), error: null };
  } catch (error) {
    return {
      provider, plan: null, notices: [], buckets: [],
      anchorFetchedAt: null, lastSampleAt: null, sampleCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const toProvider = (report: LiveReport): Omit<ProviderLimitsProvider, "error"> => ({
  provider: report.provider,
  plan: report.plan,
  notices: report.notices,
  anchorFetchedAt: report.anchorFetchedAt,
  lastSampleAt: report.lastSampleAt,
  sampleCount: report.sampleCount,
  buckets: report.buckets.map(b => ({
    id: b.id,
    label: b.label,
    measuredPercent: b.measuredPercent,
    deltaPercent: b.deltaPercent,
    estimatedPercent: b.estimatedPercent,
    confidence: b.confidence,
    anchorFetchedAt: b.anchorFetchedAt,
    anchorAgeMs: b.anchorAgeMs,
    anchorStale: b.anchorStale,
    idle: b.idle,
    deltaTrusted: b.deltaTrusted,
    turnsSinceAnchor: b.turnsSinceAnchor,
    resetsAt: b.resetsAt,
    resetsInMs: b.resetsInMs,
    windowMinutes: b.windowMinutes,
    severity: b.severity,
    budget: b.budget
  }))
});

function allSamples(cache: Map<string, FileEntry>): Sample[] {
  const out: Sample[] = [];
  for (const entry of cache.values()) for (const s of entry.samples) out.push(s);
  return out;
}

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** Streams, so a log larger than Node's string limit still reads. */
async function readLines(path: string): Promise<string[]> {
  const out: string[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) out.push(line);
  return out;
}

function readBudgets(path: string): Budgets {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Budgets) : {};
  } catch {
    // A corrupt budgets file costs one calibration, not the feature.
    return {};
  }
}

function writeBudgets(path: string, budgets: Budgets): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(budgets, null, 2)}\n`, "utf8");
  } catch { /* best effort; the in-memory copy still serves this session */ }
}
