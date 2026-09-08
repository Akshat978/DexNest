// How full the plan windows are, without asking the provider.
//
// The claim under test is that an anchor plus local logs gives a live figure
// that is honest about what it knows. So the tests that matter are the ones
// about honesty: a streamed turn counts once, a 0% anchor calibrates nothing,
// a rolled-over window admits it is guessing, and a stale anchor says so.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calibrate, describeResetsIn, liveBucket, liveReport,
  parseClaudeAnchor, parseClaudeSamples, parseCodexAnchor, parseCodexSamples,
  weightOf, DEFAULT_WEIGHTS, type LimitBucket, type Anchor
} from "../src/providerLimits.ts";

// --- fixtures ----------------------------------------------------------------

const claudeJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  cachedGrowthBookFeatures: {
    tengu_rate_limit_promo_notices: [{ bar: "seven_day", text: "+50% weekly limits promo through Sep 13", variant: "claude" }]
  },
  cachedUsageUtilization: {
    fetchedAtMs: Date.parse("2026-09-06T10:14:17Z"),
    utilization: {
      five_hour: { utilization: 19, resets_at: "2026-09-06T14:10:00+00:00", locked_reason: null },
      seven_day: { utilization: 9, resets_at: "2026-09-08T05:00:00+00:00", locked_reason: null },
      limits: [
        { kind: "session", group: "session", percent: 19, severity: "normal", resets_at: "2026-09-06T14:10:00+00:00", scope: null, is_active: true },
        { kind: "weekly_all", group: "weekly", percent: 9, severity: "normal", resets_at: "2026-09-08T05:00:00+00:00", scope: null, is_active: false },
        { kind: "weekly_scoped", group: "weekly", percent: 2, severity: "normal", resets_at: "2026-09-08T05:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false }
      ],
      ...over
    }
  }
});

const assistantLine = (at: string, requestId: string, out: number, model = "claude-opus-5", uuid = requestId + "-u") => JSON.stringify({
  type: "assistant", timestamp: at, requestId, uuid,
  message: { model, usage: { input_tokens: 100, output_tokens: out, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } }
});

const codexLine = (at: string, limits: unknown) => JSON.stringify({
  timestamp: at, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: limits }
});

const codexCount = (at: string, total: number) => JSON.stringify({
  timestamp: at, type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: { input_tokens: total, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, total_tokens: total } } }
});

// --- anchors -----------------------------------------------------------------

test("Claude anchor reads limits[] as the settings page does", () => {
  const anchor = parseClaudeAnchor(claudeJson());
  assert.ok(anchor);
  assert.equal(anchor.fetchedAt, "2026-09-06T10:14:17.000Z");
  assert.deepEqual(anchor.buckets.map(b => [b.id, b.label, b.percent, b.windowMinutes]), [
    ["session", "Current session", 19, 300],
    ["weekly", "All models", 9, 10_080],
    ["weekly:fable", "Fable", 2, 10_080]
  ]);
  assert.equal(anchor.notices[0], "+50% weekly limits promo through Sep 13");
});

test("Claude anchor falls back to five_hour/seven_day when limits[] is missing", () => {
  const anchor = parseClaudeAnchor(claudeJson({ limits: undefined }));
  assert.ok(anchor);
  assert.deepEqual(anchor.buckets.map(b => b.id), ["session", "weekly"]);
});

test("Claude anchor is null for a file that has none, and never throws on junk", () => {
  assert.equal(parseClaudeAnchor("{}"), null);
  assert.equal(parseClaudeAnchor("not json"), null);
  assert.equal(parseClaudeAnchor(JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 1, utilization: {} } })), null);
});

test("Codex anchor takes the newest populated record, not the last line", () => {
  const older = codexLine("2026-09-04T22:58:28Z", {
    primary: { used_percent: 12, window_minutes: 300, resets_at: 1788580703 },
    secondary: { used_percent: 3, window_minutes: 10080, resets_at: 1789167503 },
    plan_type: "plus"
  });
  const empty = codexLine("2026-09-05T18:00:00Z", { primary: null, secondary: null });
  const newest = codexLine("2026-09-05T12:00:00Z", {
    primary: { used_percent: 40, window_minutes: 300, resets_at: 1788600000 },
    secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1789167503 },
    plan_type: "plus", rate_limit_reached_type: null
  });
  const anchor = parseCodexAnchor([newest, older, empty]);
  assert.ok(anchor);
  assert.equal(anchor.fetchedAt, "2026-09-05T12:00:00.000Z");
  assert.equal(anchor.plan, "plus");
  assert.deepEqual(anchor.buckets.map(b => [b.id, b.label, b.percent]), [
    ["primary", "Current session", 40],
    ["secondary", "Weekly", 5]
  ]);
  assert.equal(anchor.buckets[0]!.resetsAt, new Date(1788600000 * 1000).toISOString());
});

// --- samples -----------------------------------------------------------------

test("a streamed turn counts once, however many records it wrote", () => {
  // The trap this exists for: half of all requests write several assistant
  // records, each carrying the same usage. Naive summing doubles the bill.
  const lines = [
    assistantLine("2026-09-06T09:00:00Z", "req-1", 50, "claude-opus-5", "u1"),
    assistantLine("2026-09-06T09:00:01Z", "req-1", 50, "claude-opus-5", "u2"),
    assistantLine("2026-09-06T09:00:02Z", "req-1", 50, "claude-opus-5", "u3"),
    assistantLine("2026-09-06T09:05:00Z", "req-2", 50)
  ];
  const samples = parseClaudeSamples(lines);
  assert.equal(samples.length, 2);
  assert.equal(samples[0]!.weight, weightOf({ input: 100, output: 50, cacheRead: 1000 }, "claude-opus-5"));
});

test("weights follow pricing ratios and the model multiplier", () => {
  const sonnet = weightOf({ input: 100, output: 10 }, "claude-sonnet-5");
  const opus = weightOf({ input: 100, output: 10 }, "claude-opus-5");
  assert.equal(sonnet, 100 * 1 + 10 * 5);
  assert.equal(opus, sonnet * 5);
  assert.equal(weightOf({ cacheRead: 1000 }, "unknown-model"), 100);
});

test("Codex samples are the increase in the running total, so a repeat moves nothing", () => {
  const files = [{
    model: "gpt-5",
    lines: [
      codexCount("2026-09-05T10:00:00Z", 1000),
      codexCount("2026-09-05T10:01:00Z", 1000), // repeated report
      codexCount("2026-09-05T10:02:00Z", 2500)
    ]
  }];
  const samples = parseCodexSamples(files);
  assert.deepEqual(samples.map(s => s.weight), [1000, 1500]);
});

// --- calibration -------------------------------------------------------------

const session: LimitBucket = {
  provider: "claude", id: "session", label: "Current session",
  percent: 20, resetsAt: "2026-09-06T14:00:00Z", windowMinutes: 300, severity: null, active: true
};
const anchor: Anchor = { provider: "claude", fetchedAt: "2026-09-06T11:00:00Z", buckets: [session], plan: null, notices: [] };
const sample = (at: string, weight: number) => ({ at, model: "claude-opus-5", weight });

test("the budget is the window's logged spend divided by the anchor's fraction", () => {
  // Window is 09:00–14:00. Anchor at 11:00 says 20%. Logs show 400 spent
  // between 09:00 and 11:00, so 400 is 20% and the budget is 2000.
  const samples = [
    sample("2026-09-06T08:30:00Z", 999), // before the window: ignored
    sample("2026-09-06T09:30:00Z", 250),
    sample("2026-09-06T10:30:00Z", 150),
    sample("2026-09-06T11:30:00Z", 500)  // after the anchor: not part of calibration
  ];
  assert.equal(calibrate(session, anchor.fetchedAt, samples), 2000);
});

test("a 0% anchor, or a window the logs never saw, calibrates nothing", () => {
  assert.equal(calibrate({ ...session, percent: 0 }, anchor.fetchedAt, [sample("2026-09-06T10:00:00Z", 100)]), null);
  assert.equal(calibrate(session, anchor.fetchedAt, [sample("2026-09-06T12:00:00Z", 100)]), null);
});

// --- live --------------------------------------------------------------------

test("live = measured + spend since the anchor, as a share of the budget", () => {
  const samples = [
    sample("2026-09-06T09:30:00Z", 250),
    sample("2026-09-06T10:30:00Z", 150),
    sample("2026-09-06T11:30:00Z", 500), // 25% of a 2000 budget
    sample("2026-09-06T12:30:00Z", 300)  // 15%
  ];
  const live = liveBucket(session, anchor, samples, "2026-09-06T13:00:00Z");
  assert.equal(live.confidence, "calibrated");
  assert.equal(live.measuredPercent, 20);
  assert.equal(live.deltaPercent, 40);
  assert.equal(live.estimatedPercent, 60);
  assert.equal(live.budget, 2000);
  assert.equal(live.resetsInMs, 60 * 60_000);
  assert.equal(live.anchorStale, false);
});

test("the estimate is clamped at 100 and never hides an anchor that read high", () => {
  const samples = [sample("2026-09-06T10:00:00Z", 400), sample("2026-09-06T12:00:00Z", 5000)];
  const live = liveBucket(session, anchor, samples, "2026-09-06T13:00:00Z");
  assert.equal(live.estimatedPercent, 100);
  assert.equal(live.measuredPercent, 20);
});

test("a rolled-over window starts from zero, keeps its budget, and admits the guess", () => {
  const samples = [
    sample("2026-09-06T10:00:00Z", 400),   // calibrates to 2000
    sample("2026-09-06T15:00:00Z", 200)    // first turn after the 14:00 reset: opens 15:00–20:00, 10% spent
  ];
  const live = liveBucket(session, anchor, samples, "2026-09-06T16:00:00Z");
  assert.equal(live.confidence, "rolled");
  assert.equal(live.measuredPercent, 0);
  assert.equal(live.estimatedPercent, 10);
  assert.equal(live.budget, 2000, "the budget survives the rollover");
  assert.equal(live.resetsAt, "2026-09-06T20:00:00.000Z", "five hours after the turn that opened it");
  assert.equal(live.windowStart, "2026-09-06T15:00:00.000Z");
});

test("a weekly window rolls forward as many times as it must", () => {
  const weekly: LimitBucket = { ...session, id: "weekly", windowMinutes: 10_080, resetsAt: "2026-09-08T05:00:00Z", percent: 9 };
  const weekAnchor: Anchor = { ...anchor, buckets: [weekly] };
  const live = liveBucket(weekly, weekAnchor, [sample("2026-09-05T00:00:00Z", 90)], "2026-09-30T00:00:00Z");
  assert.equal(live.resetsAt, "2026-10-06T05:00:00.000Z");
  assert.equal(live.confidence, "rolled");
  assert.equal(live.anchorStale, true);
});

test("an anchor older than its window is flagged stale even if unrolled", () => {
  // Weekly anchor fetched nine days before now, but the (rolled) window is
  // what's compared; staleness is about the anchor's age, not the window.
  const weekly: LimitBucket = { ...session, id: "weekly", windowMinutes: 10_080, resetsAt: "2026-09-20T05:00:00Z", percent: 9 };
  const weekAnchor: Anchor = { ...anchor, fetchedAt: "2026-09-01T00:00:00Z", buckets: [weekly] };
  const live = liveBucket(weekly, weekAnchor, [], "2026-09-15T00:00:00Z");
  assert.equal(live.anchorStale, true);
  assert.equal(live.confidence, "uncalibrated");
  assert.equal(live.measuredPercent, 9, "the anchor's own figure is still shown");
});

test("liveReport prefers a fresh solution, then a remembered budget, then nothing", () => {
  const fresh = liveReport("claude", anchor, [sample("2026-09-06T10:00:00Z", 400), sample("2026-09-06T12:00:00Z", 200)], "2026-09-06T13:00:00Z", { session: 99_999 });
  assert.equal(fresh.buckets[0]!.budget, 2000, "solved from the anchor, not remembered");

  const remembered = liveReport("claude", anchor, [sample("2026-09-06T12:00:00Z", 200)], "2026-09-06T13:00:00Z", { session: 4000 });
  assert.equal(remembered.buckets[0]!.budget, 4000);
  assert.equal(remembered.buckets[0]!.estimatedPercent, 25);

  const nothing = liveReport("claude", anchor, [sample("2026-09-06T12:00:00Z", 200)], "2026-09-06T13:00:00Z");
  assert.equal(nothing.buckets[0]!.confidence, "uncalibrated");
  assert.equal(nothing.buckets[0]!.estimatedPercent, 20);

  assert.deepEqual(liveReport("codex", null, [], "2026-09-06T13:00:00Z").buckets, []);
});

test("resets-in reads like the settings page", () => {
  assert.equal(describeResetsIn(37 * 60_000), "resets in 37 min");
  assert.equal(describeResetsIn((5 * 60 + 7) * 60_000), "resets in 5 hr 7 min");
  assert.equal(describeResetsIn(2 * 24 * 60 * 60_000 + 4 * 60 * 60_000), "resets in 2 d 4 hr");
  assert.equal(describeResetsIn(0), "resets now");
});

test("default weights make output dearer than input and cache reads cheap", () => {
  assert.ok(DEFAULT_WEIGHTS.output > DEFAULT_WEIGHTS.input);
  assert.ok(DEFAULT_WEIGHTS.cacheRead < DEFAULT_WEIGHTS.input);
});

test("a session window reopens at the first turn after its reset, not on a schedule", () => {
  // Anchor window 09:00–14:00. Nothing happens until 16:30, then coding
  // resumes. The new window is 16:30–21:30 — not 14:00–19:00 or 19:00–00:00.
  const samples = [
    sample("2026-09-06T10:00:00Z", 400),   // calibrates the budget to 2000
    sample("2026-09-06T16:30:00Z", 300),   // first turn after the reset: opens the window
    sample("2026-09-06T18:00:00Z", 100)
  ];
  const live = liveBucket(session, anchor, samples, "2026-09-06T19:00:00Z");
  assert.equal(live.confidence, "rolled");
  assert.equal(live.windowStart, "2026-09-06T16:30:00.000Z");
  assert.equal(live.resetsAt, "2026-09-06T21:30:00.000Z");
  assert.equal(live.estimatedPercent, 20, "400 of 2000 since the window opened");
});

test("a session with no turn since its reset is idle: nothing open, nothing pending", () => {
  const live = liveBucket(session, anchor, [sample("2026-09-06T10:00:00Z", 400)], "2026-09-06T19:00:00Z");
  assert.equal(live.confidence, "rolled");
  assert.equal(live.idle, true);
  assert.equal(live.estimatedPercent, 0);
  assert.equal(live.resetsInMs, 0);
});

test("a session window that has expired more than once is walked turn by turn", () => {
  // 09:00–14:00 (anchored), reopened 15:00–20:00 by a turn, then 22:00–03:00.
  const samples = [
    sample("2026-09-06T10:00:00Z", 400),
    sample("2026-09-06T15:00:00Z", 100),
    sample("2026-09-06T22:00:00Z", 500),
    sample("2026-09-06T23:00:00Z", 500)
  ];
  const live = liveBucket(session, anchor, samples, "2026-09-07T00:00:00Z");
  assert.equal(live.windowStart, "2026-09-06T22:00:00.000Z");
  assert.equal(live.resetsAt, "2026-09-07T03:00:00.000Z");
  assert.equal(live.estimatedPercent, 50);
});
