// What deserves a person's attention, and what has already been said.
//
// The judgement lives in @dexnest/attention, which is pure and knows nothing
// about SQLite, runs or phones. This is its durable half: it turns what DexNest
// knows into the engine's vocabulary, remembers what was delivered so cooldowns
// mean something across a restart, and hands the decision back.
//
// TWO VOCABULARIES, ON PURPOSE
//
// DexNest has eighteen LoopStopReasons. They describe the machine: whether a
// grant was exhausted, whether verification was inconclusive, whether the
// worker's send was uncertain. The engine has five, and they describe what a
// stop MEANS to a person — is this finished, broken, out of budget, or waiting
// on a provider. Mapping one onto the other is this file's job, exactly as
// QUEUE_OUTCOME maps them onto what happened to a project.
//
// Keeping them separate is what lets the engine be tested against a vocabulary
// small enough to reason about, while DexNest keeps the precision it needs.
//
// THE LOCAL-OFFSET TRAP
//
// Quiet hours read the wall-clock hour straight out of the ISO string, which is
// what makes "23:00 to 08:00" survive a daylight-saving change. It only works
// if `now` carries its local offset. DexNest's clock produces
// `new Date().toISOString()`, which is always UTC "Z" — passed straight in, a
// 23:00-08:00 window would silently run on UTC instead, which for anyone not on
// UTC is the wrong nine hours of the day. So the conversion happens here, once,
// rather than being left to every caller to remember.

import {
  decide,
  itemsFor,
  renderSummary,
  type AttentionItem,
  type AttentionStopReason,
  type Decision,
  type DeliveryRecord,
  type QuietHours
} from "@dexnest/attention";
import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import type { LoopStopReason } from "./loop.ts";
import { isTerminal, type RunState } from "./states.ts";

/**
 * What each way a run can stop means to a person.
 *
 * `null` means "nobody needs telling": a run a human just paused is a run the
 * human is looking at, and notifying them about their own click is the kind of
 * noise that makes someone stop reading notifications altogether.
 */
export const ATTENTION_REASON: Readonly<Record<LoopStopReason, AttentionStopReason | null>> = Object.freeze({
  // Needs an answer before anything else happens.
  plan_complete_proposed: "proposed_completion",

  // Something is broken and a person should look.
  worker_failed: "worker_failure",
  worker_uncertain: "worker_failure",
  verification_indeterminate: "worker_failure",
  consecutive_failures: "worker_failure",
  primary_blocked: "worker_failure",
  consultant_recommended: "worker_failure",
  direction_needs_human: "worker_failure",

  // A bound was spent. Nothing is wrong; there is simply no more authorization.
  turn_limit: "budget_spent",
  iteration_limit: "budget_spent",
  time_limit: "budget_spent",
  cost_limit: "budget_spent",
  no_progress: "budget_spent",

  // Finished.
  completed: "run_finished",

  // Waiting on capacity, which no longer clears itself by default.
  provider_limit: "provider_limit",

  // The operator did this. They know.
  paused: null,
  stopped: null,
  grant_closed: null
});

/** Quiet hours nobody has configured. Sensible, and overridable. */
export const DEFAULT_QUIET_HOURS: QuietHours = Object.freeze({ start: "23:00", end: "08:00" });

/**
 * Whether a held question still stands, given what the run is doing now.
 *
 * Attention items are derived from the last LOOP_HELD event a run recorded,
 * and that event is never retracted — stopping a run, or resuming it, writes
 * no second LOOP_HELD. So without this the desktop and the phone go on asking
 * "does this run look finished to you?" about a run the operator stopped days
 * ago, and the one list that is supposed to mean "these need you" fills with
 * things that do not.
 *
 * Terminal is obvious: a stopped, completed or failed run has no question left
 * to answer. RUNNING is the subtler one — it means the run was resumed after
 * the hold, so the operator has already answered by carrying on.
 *
 * Deliberately a denylist rather than an allowlist of "waiting" states. Being
 * wrong here should mean showing an item that no longer matters, not silently
 * withholding one that does.
 */
export function attentionStands(state: RunState): boolean {
  return !isTerminal(state) && state !== "RUNNING";
}

interface DeliveryRow {
  group_key: string;
  priority: string;
  delivered_at: string;
}

/**
 * An ISO instant rendered in local wall-clock with its offset.
 *
 * `2026-09-07T05:30:00.000Z` becomes `2026-09-06T23:30:00-06:00`, which is what
 * the engine needs to know it is 23:30 rather than 05:30. Derived from the
 * platform's own offset for that instant, so it follows daylight saving rather
 * than assuming a fixed shift.
 */
export function toLocalIso(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`Not a valid timestamp: ${iso}.`);
  // getTimezoneOffset is minutes to ADD to local to reach UTC, so its sign is
  // the reverse of the one an ISO offset carries.
  const offsetMinutes = -at.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, "0");
  const local = new Date(at.getTime() + offsetMinutes * 60_000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`
  );
}

export class AttentionStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  /** Older databases have no delivery log; a host without one simply has none. */
  available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_attention_deliveries'").get()
    );
  }

  /**
   * What has been delivered, newest last.
   *
   * Bounded: a cooldown only ever looks at the most recent delivery per group,
   * so reading a night's worth is plenty and reading a year's is waste.
   */
  deliveries(limit = 200): DeliveryRecord[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_attention_deliveries ORDER BY rowid DESC LIMIT :limit")
      .all<DeliveryRow>({ limit })
      .map(row => ({ groupKey: row.group_key, priority: row.priority as DeliveryRecord["priority"], at: row.delivered_at }))
      .reverse();
  }

  /** How a run stopping becomes items, or nothing when nobody needs telling. */
  itemsForRun(input: { runId: string; reason: LoopStopReason; detail?: string; at?: string }): AttentionItem[] {
    const mapped = ATTENTION_REASON[input.reason];
    if (!mapped) return [];
    return itemsFor({
      runId: input.runId,
      stopReason: mapped,
      at: input.at ?? this.ports.clock.now(),
      ...(input.detail ? { detail: input.detail } : {})
    });
  }

  /**
   * What to say now, and what waits.
   *
   * Records nothing: deciding and delivering are separate so a caller that
   * fails to send has not already claimed it did.
   */
  decide(items: readonly AttentionItem[], options: { quietHours?: QuietHours; cooldownMinutes?: number } = {}): Decision {
    return decide({
      items: [...items],
      delivered: this.deliveries(),
      quietHours: options.quietHours ?? DEFAULT_QUIET_HOURS,
      // The conversion the whole quiet-hours design depends on.
      now: toLocalIso(this.ports.clock.now()),
      ...(options.cooldownMinutes !== undefined ? { cooldownMinutes: options.cooldownMinutes } : {})
    });
  }

  /**
   * Records that a group was delivered, which is what makes its cooldown real.
   *
   * Called after the send, never before: a delivery recorded for something that
   * never arrived would silence the retry.
   */
  recordDelivery(input: { groupKey: string; priority: DeliveryRecord["priority"]; runId?: string }): void {
    if (!this.available()) return;
    const now = this.ports.clock.now();
    this.db
      .prepare(
        `INSERT INTO autopilot_attention_deliveries (group_key, priority, delivered_at)
         VALUES (:groupKey, :priority, :now)`
      )
      .run({ groupKey: input.groupKey, priority: input.priority, now });
    if (input.runId) {
      this.store.appendEvent(input.runId, {
        type: "ATTENTION_DELIVERED",
        payload: { groupKey: input.groupKey, priority: input.priority }
      });
    }
  }

  /** Plain text describing a decision, for an operator checking the engine. */
  summarise(decision: Decision): string {
    return renderSummary(decision);
  }
}
