// How full the Claude and Codex plan windows are, right now, without asking.
//
// THE PROBLEM
//
// Neither provider offers a way to read a subscription's limits. Claude's
// endpoint for it is reserved for the official client — using the OAuth token
// from any other program is a terms violation since February 2026, enforced by
// account bans, and the endpoint 429s for hours under a one-minute poll anyway.
// So "live" cannot mean "ask the server every minute". It has to mean
// something DexNest can know from this machine alone.
//
// THE IDEA
//
// Both official clients cache their last answer to disk. Claude Code writes
// `cachedUsageUtilization` to ~/.claude.json; Codex writes `rate_limits` into
// each session's rollout log. Those are ANCHORS: a true percentage at a known
// instant, with the exact time the window resets.
//
// Both clients also log every turn they make, with token counts, to disk.
// That is the DELTA: everything spent since the anchor, updated the moment a
// turn completes, for free.
//
// The anchor also tells us the window's start (`resets_at` minus its length),
// so we can sum the logged spend from the window's start up to the anchor and
// equate it to the anchor's percentage. That yields the window's BUDGET in our
// own units. From then on, live percent is just logged spend divided by that
// budget — no network, no credential, and it re-calibrates itself every time a
// fresh anchor appears.
//
// WHAT IT CANNOT SEE
//
// Usage from claude.ai on the web or a phone. Those never touch this machine's
// logs, so the estimate drifts by exactly that amount until the next anchor.
// The UI shows measured and estimated separately for this reason: a person
// should always be able to tell which part of the bar was read and which part
// was reckoned.
//
// UNITS
//
// The budget is in weighted tokens, and only the ratios between weights matter,
// because calibration absorbs any constant factor. The weights below follow
// API pricing ratios (output is dearer than input; cache reads are cheap), with
// a per-model multiplier for the same reason. A wrong ratio distorts estimates
// only when the model mix changes between anchors.

export type Provider = "claude" | "codex";

export interface LimitBucket {
  provider: Provider;
  /** Stable id: "session" | "weekly" | "weekly:<scope>" | "primary" | "secondary". */
  id: string;
  /** What a person calls it: "Current session", "All models", "Fable". */
  label: string;
  /** The provider's own figure, 0–100. */
  percent: number;
  resetsAt: string;
  windowMinutes: number;
  /** The provider's word for how worried to be, when it says one. */
  severity: string | null;
  /** Whether the provider considers the window currently active. */
  active: boolean;
}

export interface Anchor {
  provider: Provider;
  /** When the provider last told the official client these numbers. */
  fetchedAt: string;
  buckets: LimitBucket[];
  /** Plan name, when the provider says one. */
  plan: string | null;
  /** Provider notices worth showing — a promo, a lock reason. */
  notices: string[];
}

/** One model call, weighted into budget units. */
export interface Sample {
  at: string;
  model: string;
  weight: number;
}

export interface TokenWeights {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Multiplier by model-name substring; the first match wins; default 1. */
  models: Array<{ match: string; factor: number }>;
}

/** API pricing ratios. Absolute values are irrelevant; see UNITS above. */
export const DEFAULT_WEIGHTS: TokenWeights = {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheWrite: 1.25,
  models: [
    { match: "opus", factor: 5 },
    { match: "fable", factor: 5 },
    { match: "sonnet", factor: 1 },
    { match: "haiku", factor: 0.2 }
  ]
};

export type Confidence =
  /** An anchor inside the current window and a budget solved from it. */
  | "calibrated"
  /** The anchor is real but the window has rolled over since; the delta is
   *  measured from the rollover and the budget is carried forward. */
  | "rolled"
  /** An anchor exists but nothing could be solved from it — it reports 0%, or
   *  the logs show no spend inside its window. Only the anchor is shown. */
  | "uncalibrated"
  /** No anchor at all. */
  | "none";

export interface LiveBucket extends LimitBucket {
  /** The anchor's figure, as read. */
  measuredPercent: number;
  /** Spend since the anchor, as a share of the solved budget. */
  deltaPercent: number;
  /** measured + delta, clamped. What the bar shows. */
  estimatedPercent: number;
  confidence: Confidence;
  anchorFetchedAt: string;
  anchorAgeMs: number;
  /** True when the anchor is older than its own window. */
  anchorStale: boolean;
  /** A session window that has expired with no turn since: nothing is open. */
  idle: boolean;
  resetsInMs: number;
  windowStart: string;
  /** Weighted spend inside the current window, per the logs. */
  windowSpend: number;
  /** The solved budget, in the same units. Null when uncalibrated. */
  budget: number | null;
}

export interface LiveReport {
  provider: Provider;
  plan: string | null;
  notices: string[];
  buckets: LiveBucket[];
  anchorFetchedAt: string | null;
  /** The most recent logged turn the estimate could see. */
  lastSampleAt: string | null;
  sampleCount: number;
}

const MINUTE = 60_000;

// --- weights -----------------------------------------------------------------

export function weightOf(
  usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
  model: string,
  weights: TokenWeights = DEFAULT_WEIGHTS
): number {
  const lower = model.toLowerCase();
  const factor = weights.models.find(m => lower.includes(m.match))?.factor ?? 1;
  const raw =
    (usage.input ?? 0) * weights.input +
    (usage.output ?? 0) * weights.output +
    (usage.cacheRead ?? 0) * weights.cacheRead +
    (usage.cacheWrite ?? 0) * weights.cacheWrite;
  return raw * factor;
}

// --- anchors -----------------------------------------------------------------

interface ClaudeLimitRow {
  kind?: string;
  group?: string;
  percent?: number;
  severity?: string | null;
  resets_at?: string | null;
  is_active?: boolean;
  scope?: { model?: { display_name?: string | null } | null; surface?: string | null } | null;
}

/**
 * Reads Claude Code's cached utilization out of ~/.claude.json.
 *
 * Takes the file's text, not its path: this package touches no filesystem.
 * The `limits[]` array is the source of truth — it is what the official
 * settings page renders — with the older five_hour/seven_day fields as a
 * fallback for a client version that predates it.
 */
export function parseClaudeAnchor(text: string): Anchor | null {
  let root: Record<string, unknown>;
  try { root = JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  const cached = root.cachedUsageUtilization as
    | { fetchedAtMs?: number; utilization?: Record<string, unknown> }
    | undefined;
  if (!cached?.utilization || typeof cached.fetchedAtMs !== "number") return null;

  const fetchedAt = new Date(cached.fetchedAtMs).toISOString();
  const u = cached.utilization;
  const buckets: LimitBucket[] = [];

  const rows = Array.isArray(u.limits) ? (u.limits as ClaudeLimitRow[]) : [];
  for (const row of rows) {
    if (!row.resets_at || typeof row.percent !== "number") continue;
    const scope = row.scope?.model?.display_name ?? null;
    const isSession = row.kind === "session" || row.group === "session";
    buckets.push({
      provider: "claude",
      id: isSession ? "session" : scope ? `weekly:${scope.toLowerCase()}` : "weekly",
      label: isSession ? "Current session" : scope ?? "All models",
      percent: clampPercent(row.percent),
      resetsAt: new Date(row.resets_at).toISOString(),
      windowMinutes: isSession ? 300 : 10_080,
      severity: row.severity ?? null,
      active: row.is_active ?? true
    });
  }

  if (buckets.length === 0) {
    const legacy = (key: string, id: string, label: string, minutes: number) => {
      const b = u[key] as { utilization?: number; resets_at?: string | null } | undefined;
      if (!b || typeof b.utilization !== "number" || !b.resets_at) return;
      buckets.push({
        provider: "claude", id, label,
        percent: clampPercent(b.utilization),
        resetsAt: new Date(b.resets_at).toISOString(),
        windowMinutes: minutes, severity: null, active: true
      });
    };
    legacy("five_hour", "session", "Current session", 300);
    legacy("seven_day", "weekly", "All models", 10_080);
  }
  if (buckets.length === 0) return null;

  const notices: string[] = [];
  const promos = (root.cachedGrowthBookFeatures as Record<string, unknown> | undefined)?.tengu_rate_limit_promo_notices;
  if (Array.isArray(promos)) {
    for (const p of promos as Array<{ text?: string }>) if (p?.text) notices.push(p.text);
  }
  for (const key of ["five_hour", "seven_day"]) {
    const reason = (u[key] as { locked_reason?: string | null } | undefined)?.locked_reason;
    if (reason) notices.push(reason);
  }

  return { provider: "claude", fetchedAt, buckets, plan: null, notices };
}

interface CodexWindow { used_percent?: number; window_minutes?: number; resets_at?: number }
interface CodexRateLimits {
  primary?: CodexWindow | null;
  secondary?: CodexWindow | null;
  plan_type?: string | null;
  rate_limit_reached_type?: string | null;
  credits?: { has_credits?: boolean; balance?: string } | null;
}

/**
 * Reads the newest populated `rate_limits` from Codex rollout logs.
 *
 * Codex writes one on every API response, so the last one in the newest log
 * is as fresh as Codex's last turn. Lines may come from several files; the
 * record with the latest timestamp wins, not the last one given.
 */
export function parseCodexAnchor(lines: Iterable<string>): Anchor | null {
  let best: { at: string; limits: CodexRateLimits } | null = null;
  for (const line of lines) {
    if (!line.includes("rate_limits")) continue;
    let record: { timestamp?: string; payload?: { rate_limits?: CodexRateLimits } };
    try { record = JSON.parse(line) as typeof record; } catch { continue; }
    const limits = record.payload?.rate_limits;
    if (!limits || (!limits.primary && !limits.secondary) || !record.timestamp) continue;
    if (!best || record.timestamp > best.at) best = { at: record.timestamp, limits };
  }
  if (!best) return null;

  const buckets: LimitBucket[] = [];
  const push = (w: CodexWindow | null | undefined, id: string, fallbackLabel: string) => {
    if (!w || typeof w.used_percent !== "number" || typeof w.resets_at !== "number" || !w.window_minutes) return;
    const minutes = w.window_minutes;
    buckets.push({
      provider: "codex",
      id,
      label: minutes <= 360 ? "Current session" : minutes >= 10_000 ? "Weekly" : fallbackLabel,
      percent: clampPercent(w.used_percent),
      resetsAt: new Date(w.resets_at * 1000).toISOString(),
      windowMinutes: minutes,
      severity: best!.limits.rate_limit_reached_type ?? null,
      active: true
    });
  };
  push(best.limits.primary, "primary", "Primary");
  push(best.limits.secondary, "secondary", "Secondary");
  if (buckets.length === 0) return null;

  const notices: string[] = [];
  if (best.limits.rate_limit_reached_type) notices.push(`Limit reached: ${best.limits.rate_limit_reached_type}`);

  return {
    provider: "codex",
    fetchedAt: new Date(best.at).toISOString(),
    buckets,
    plan: best.limits.plan_type ?? null,
    notices
  };
}

// --- samples -----------------------------------------------------------------

/**
 * Turns Claude Code session-log lines into samples.
 *
 * The one trap here is streaming: the client writes an assistant record per
 * content block, and every one of them carries the same `usage`. Roughly half
 * of all requests have more than one. Summing naively would count a turn
 * twice. So this keeps one record per `requestId`, and a record without one is
 * kept on its own uuid.
 */
export function parseClaudeSamples(lines: Iterable<string>, weights: TokenWeights = DEFAULT_WEIGHTS): Sample[] {
  const seen = new Set<string>();
  const out: Sample[] = [];
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let record: {
      type?: string; timestamp?: string; requestId?: string; uuid?: string;
      message?: { model?: string; usage?: Record<string, number> };
    };
    try { record = JSON.parse(line) as typeof record; } catch { continue; }
    if (record.type !== "assistant" || !record.message?.usage || !record.timestamp) continue;
    const key = record.requestId ?? record.uuid ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const u = record.message.usage;
    const model = record.message.model ?? "";
    const weight = weightOf({
      input: u.input_tokens, output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens
    }, model, weights);
    if (weight > 0) out.push({ at: new Date(record.timestamp).toISOString(), model, weight });
  }
  return out;
}

/**
 * Turns Codex rollout-log lines into samples.
 *
 * Codex reports `total_token_usage` as a running total per session, and
 * `last_token_usage` per turn. The running total is the safer source: a turn
 * that logs twice moves the total once. So each sample is the increase in the
 * total since the previous record of the same session.
 */
export function parseCodexSamples(
  files: Iterable<{ lines: Iterable<string>; model?: string }>,
  weights: TokenWeights = DEFAULT_WEIGHTS
): Sample[] {
  const out: Sample[] = [];
  for (const file of files) {
    let previous = 0;
    let model = file.model ?? "";
    for (const line of file.lines) {
      if (!line.includes("token_count") && !line.includes('"model"')) continue;
      let record: {
        timestamp?: string;
        payload?: {
          type?: string; model?: string;
          info?: { total_token_usage?: Record<string, number> } | null;
        };
      };
      try { record = JSON.parse(line) as typeof record; } catch { continue; }
      if (record.payload?.model && record.payload.type === "turn_context") model = record.payload.model;
      if (record.payload?.type !== "token_count" || !record.payload.info?.total_token_usage || !record.timestamp) continue;
      const t = record.payload.info.total_token_usage;
      const total = weightOf({
        input: (t.input_tokens ?? 0) - (t.cached_input_tokens ?? 0),
        output: t.output_tokens,
        cacheRead: t.cached_input_tokens,
        cacheWrite: t.cache_write_input_tokens
      }, model, weights);
      const delta = total - previous;
      previous = Math.max(previous, total);
      if (delta > 0) out.push({ at: new Date(record.timestamp).toISOString(), model, weight: delta });
    }
  }
  return out;
}

// --- the estimate ------------------------------------------------------------

const spendBetween = (samples: readonly Sample[], fromIso: string, toIso: string): number => {
  let total = 0;
  for (const s of samples) if (s.at > fromIso && s.at <= toIso) total += s.weight;
  return total;
};

/**
 * Solves a bucket's budget from its anchor.
 *
 * spend(windowStart .. fetchedAt) is `percent` of the budget, so the budget is
 * that spend divided by the fraction. Undefined when the anchor says 0% (no
 * information) or the logs saw nothing in the window (the spend was elsewhere).
 */
export function calibrate(bucket: LimitBucket, fetchedAt: string, samples: readonly Sample[]): number | null {
  if (bucket.percent <= 0) return null;
  const windowStart = isoMinus(bucket.resetsAt, bucket.windowMinutes);
  const spent = spendBetween(samples, windowStart, fetchedAt);
  if (spent <= 0) return null;
  return spent / (bucket.percent / 100);
}

/**
 * The live figure for one bucket.
 *
 * `budget` may be passed in from an earlier, better calibration — a bucket
 * that has rolled over keeps the budget it solved before the rollover, since
 * a fresh window has no anchor of its own yet.
 */
export function liveBucket(
  bucket: LimitBucket,
  anchor: Anchor,
  samples: readonly Sample[],
  nowIso: string,
  budget: number | null = calibrate(bucket, anchor.fetchedAt, samples)
): LiveBucket {
  const now = Date.parse(nowIso);
  const fetched = Date.parse(anchor.fetchedAt);
  const anchorAgeMs = Math.max(0, now - fetched);
  const windowMs = bucket.windowMinutes * MINUTE;

  // Two kinds of window, rolled two ways.
  //
  // A weekly window is on a schedule: roll it forward by its own length until
  // it contains `now`, and a week-old anchor still names the right reset.
  //
  // A session window is not. It opens at the first message after the previous
  // one expired and closes five hours later, so the schedule is set by usage.
  // After a reset, the next window starts at the first logged turn after it —
  // which the samples know. If there is no such turn, no window is open.
  const sorted = [...samples].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const isSession = bucket.windowMinutes <= 360;
  let resetsAt = Date.parse(bucket.resetsAt);
  let rolled = false;
  let idle = false;
  while (resetsAt <= now) {
    rolled = true;
    if (!isSession) { resetsAt += windowMs; continue; }
    const resetsAtIso = new Date(resetsAt).toISOString();
    const first = sorted.find(s => s.at > resetsAtIso);
    if (!first || Date.parse(first.at) > now) { idle = true; break; }
    resetsAt = Date.parse(first.at) + windowMs;
  }
  const windowStart = resetsAt - windowMs;
  const windowStartIso = new Date(windowStart).toISOString();
  const resetsAtIso = new Date(resetsAt).toISOString();

  let confidence: Confidence;
  let measured: number;
  let delta = 0;
  const windowSpend = idle ? 0 : spendBetween(sorted, windowStartIso, nowIso);

  if (idle) {
    // Expired and untouched since. Nothing is open, so nothing is pending, and
    // whatever budget was solved is kept for the next window to use.
    confidence = "rolled";
    measured = 0;
  } else if (budget === null) {
    confidence = "uncalibrated";
    measured = rolled ? 0 : bucket.percent;
  } else if (rolled) {
    confidence = "rolled";
    measured = 0;
    delta = (windowSpend / budget) * 100;
  } else {
    confidence = "calibrated";
    measured = bucket.percent;
    delta = (spendBetween(sorted, anchor.fetchedAt, nowIso) / budget) * 100;
  }

  return {
    ...bucket,
    resetsAt: resetsAtIso,
    measuredPercent: clampPercent(measured),
    deltaPercent: Math.max(0, delta),
    estimatedPercent: clampPercent(measured + delta),
    confidence,
    anchorFetchedAt: anchor.fetchedAt,
    anchorAgeMs,
    anchorStale: anchorAgeMs > windowMs,
    idle,
    resetsInMs: idle ? 0 : Math.max(0, resetsAt - now),
    windowStart: windowStartIso,
    windowSpend,
    budget
  };
}

export function liveReport(
  provider: Provider,
  anchor: Anchor | null,
  samples: readonly Sample[],
  nowIso: string,
  /** Budgets remembered from earlier calibrations, by bucket id. */
  rememberedBudgets: Readonly<Record<string, number>> = {}
): LiveReport {
  const sorted = [...samples].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lastSampleAt = sorted.length ? sorted[sorted.length - 1]!.at : null;
  if (!anchor) {
    return { provider, plan: null, notices: [], buckets: [], anchorFetchedAt: null, lastSampleAt, sampleCount: sorted.length };
  }
  const buckets = anchor.buckets.map(bucket => {
    const solved = calibrate(bucket, anchor.fetchedAt, sorted);
    // A fresh solution beats a remembered one; a remembered one beats nothing.
    const budget = solved ?? rememberedBudgets[bucket.id] ?? null;
    return liveBucket(bucket, anchor, sorted, nowIso, budget);
  });
  return {
    provider, plan: anchor.plan, notices: anchor.notices, buckets,
    anchorFetchedAt: anchor.fetchedAt, lastSampleAt, sampleCount: sorted.length
  };
}

// --- helpers -----------------------------------------------------------------

const clampPercent = (n: number): number => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

const isoMinus = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) - minutes * MINUTE).toISOString();

/** "resets in 37 min" / "resets in 5 hr 7 min" / "resets in 2 d 4 hr". */
export function describeResetsIn(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 1) return "resets now";
  if (minutes < 60) return `resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `resets in ${hours} hr ${rest} min` : `resets in ${hours} hr`;
  const days = Math.floor(hours / 24);
  const hr = hours % 24;
  return hr ? `resets in ${days} d ${hr} hr` : `resets in ${days} d`;
}
