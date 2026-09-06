// Running while nobody is watching.
//
// Three things change when there is no human at the keyboard.
//
// 1. A QUESTION IS A STALL. An agent that asks "which database should I use?"
//    at 3am has stopped working until morning. So it is told not to ask: pick
//    the most defensible option, write down what was assumed, carry on. The
//    assumptions come back in the summary, so the operator reviews a list of
//    decisions instead of finding a run that did nothing for six hours.
//
//    This is not the same as letting the agent decide anything it likes. It
//    still cannot change the goal, the constraints or the plan, and anything
//    genuinely unsafe or irreversible is still a NEEDS_HUMAN decision.
//
// 2. LOSING CAPACITY IS TEMPORARY. A usage limit lifts on its own, so the run
//    waits and tries again rather than sitting paused until morning. The wait
//    is bounded, journalled, and never extends the authorization: it buys time,
//    never permission.
//
// 3. NOBODY READS A UI AT 3AM. What matters is what is true in the morning, so
//    the summary is written for someone who has been asleep: what got done,
//    what was assumed, why it stopped, and where to look.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import { AutopilotStore } from "./store.ts";

/**
 * Told to the worker, and to the director, at the top of every prompt.
 *
 * Deliberately narrow. "Do not ask" without "and here is what to do instead"
 * produces an agent that guesses silently, which is worse than one that stops.
 */
export function unattendedInstructions(): string {
  return [
    "NOBODY IS WATCHING THIS RUN",
    "",
    "You have no way to ask a question and get an answer. If you find yourself",
    "wanting to ask one, do this instead:",
    "",
    "- Choose the option you would defend to a colleague, favouring the",
    "  reversible one and the one that matches what is already in the codebase.",
    "- Record it, so the human can see what you decided without reading the",
    "  whole conversation:",
    "",
    "  <<<DEXNEST_ASSUMED>>>",
    "  What you assumed, and why, in one or two sentences.",
    "  <<<END_DEXNEST_ASSUMED>>>",
    "",
    "- Carry on with the work.",
    "",
    "Assume nothing about these, and stop with NEEDS_HUMAN instead:",
    "- anything that spends money, sends a message, or touches production",
    "- anything you cannot undo",
    "- the goal, the constraints, or the plan itself, which are the human's",
    "",
    "Recording an assumption is not permission to widen the work. It is a note."
  ].join("\n");
}

export const MAX_ASSUMPTION_CHARS = 2_000;
export const MAX_ASSUMPTIONS_PER_TURN = 10;

export interface AssumptionRecord {
  id: string;
  runId: string;
  turnId: string;
  iterationId: string | null;
  text: string;
  createdAt: string;
}

interface AssumptionRow {
  id: string;
  run_id: string;
  turn_id: string;
  iteration_id: string | null;
  text: string;
  created_at: string;
}

const toAssumption = (row: AssumptionRow): AssumptionRecord => ({
  id: row.id,
  runId: row.run_id,
  turnId: row.turn_id,
  iterationId: row.iteration_id,
  text: row.text,
  createdAt: row.created_at
});

/** Pulls the assumptions out of a reply. Bounded, and never fatal. */
export function parseAssumptions(text: string): string[] {
  const found: string[] = [];
  for (const match of String(text ?? "").matchAll(/<<<DEXNEST_ASSUMED>>>([\s\S]*?)<<<END_DEXNEST_ASSUMED>>>/g)) {
    const body = (match[1] ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ASSUMPTION_CHARS);
    // The instructions carry an example block; an echo of it is not a decision.
    if (!body || /^What you assumed, and why/i.test(body)) continue;
    found.push(body);
    if (found.length >= MAX_ASSUMPTIONS_PER_TURN) break;
  }
  return found;
}

/**
 * How long to wait before trying a limited provider again.
 *
 * Escalating, because a limit that has not lifted after fifteen minutes is
 * unlikely to lift in the next fifteen. Capped, because a run that has waited
 * most of a night is one the human should look at rather than one that should
 * keep knocking.
 */
export const RESUME_BACKOFF_MINUTES: readonly number[] = [15, 30, 60, 120, 240];

export interface ResumePlan {
  runId: string;
  attempt: number;
  notBefore: string;
  reason: string;
  exhausted: boolean;
}

interface ResumeRow {
  run_id: string;
  attempt: number;
  not_before: string;
  reason: string;
  updated_at: string;
}

export class UnattendedStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private has(table: string): boolean {
    return Boolean(this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).get());
  }

  // --- assumptions ---------------------------------------------------------

  assumptions(runId: string): AssumptionRecord[] {
    if (!this.has("autopilot_assumptions")) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_assumptions WHERE run_id=:runId ORDER BY created_at, rowid")
      .all<AssumptionRow>({ runId })
      .map(toAssumption);
  }

  /** Records what a turn decided on its own. Idempotent per turn. */
  recordAssumptions(input: { runId: string; turnId: string; iterationId?: string | null; texts: readonly string[] }): AssumptionRecord[] {
    if (!this.has("autopilot_assumptions") || input.texts.length === 0) return [];
    return this.store.transaction(() => {
      const already = this.assumptions(input.runId).some((entry) => entry.turnId === input.turnId);
      if (already) return this.assumptions(input.runId).filter((entry) => entry.turnId === input.turnId);

      const now = this.ports.clock.now();
      for (const text of input.texts.slice(0, MAX_ASSUMPTIONS_PER_TURN)) {
        this.db
          .prepare(
            `INSERT INTO autopilot_assumptions (id, run_id, turn_id, iteration_id, text, created_at)
             VALUES (:id, :runId, :turnId, :iterationId, :text, :now)`
          )
          .run({
            id: this.ports.ids.next("assumption"), runId: input.runId, turnId: input.turnId,
            iterationId: input.iterationId ?? null, text, now
          });
      }
      this.store.appendEvent(input.runId, {
        type: "ASSUMPTION_RECORDED",
        stepKey: input.turnId,
        payload: { count: Math.min(input.texts.length, MAX_ASSUMPTIONS_PER_TURN) }
      });
      return this.assumptions(input.runId).filter((entry) => entry.turnId === input.turnId);
    });
  }

  // --- waiting out a limit -------------------------------------------------

  pending(runId: string): ResumePlan | null {
    if (!this.has("autopilot_resume_schedule")) return null;
    const row = this.db.prepare("SELECT * FROM autopilot_resume_schedule WHERE run_id=:runId").get<ResumeRow>({ runId });
    if (!row) return null;
    return {
      runId: row.run_id, attempt: row.attempt, notBefore: row.not_before, reason: row.reason,
      exhausted: row.attempt > RESUME_BACKOFF_MINUTES.length
    };
  }

  /**
   * Schedules the next attempt after a provider limit.
   *
   * Each call escalates. Past the last backoff the run is left paused for a
   * human: something that has not cleared in several hours is not a wait, it is
   * a problem.
   */
  scheduleRetry(input: { runId: string; reason: string }): ResumePlan | null {
    if (!this.has("autopilot_resume_schedule")) return null;
    return this.store.transaction(() => {
      const attempt = (this.pending(input.runId)?.attempt ?? 0) + 1;
      const minutes = RESUME_BACKOFF_MINUTES[attempt - 1];
      if (minutes === undefined) {
        this.store.appendEvent(input.runId, {
          type: "RESUME_ABANDONED",
          payload: { attempts: attempt - 1, reason: "The provider limit did not clear within the retry window." }
        });
        return { runId: input.runId, attempt, notBefore: this.ports.clock.now(), reason: input.reason, exhausted: true };
      }

      const notBefore = new Date(Date.parse(this.ports.clock.now()) + minutes * 60_000).toISOString();
      this.db
        .prepare(
          `INSERT INTO autopilot_resume_schedule (run_id, attempt, not_before, reason, updated_at)
           VALUES (:runId, :attempt, :notBefore, :reason, :now)
           ON CONFLICT(run_id) DO UPDATE SET attempt=:attempt, not_before=:notBefore, reason=:reason, updated_at=:now`
        )
        .run({ runId: input.runId, attempt, notBefore, reason: input.reason, now: this.ports.clock.now() });

      this.store.appendEvent(input.runId, {
        type: "RESUME_SCHEDULED",
        payload: { attempt, waitMinutes: minutes, notBefore, reason: input.reason }
      });
      return { runId: input.runId, attempt, notBefore, reason: input.reason, exhausted: false };
    });
  }

  /** Runs whose wait is over. What a host timer asks for. */
  due(now: string): ResumePlan[] {
    if (!this.has("autopilot_resume_schedule")) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_resume_schedule WHERE not_before <= :now ORDER BY not_before")
      .all<ResumeRow>({ now })
      .map((row) => ({
        runId: row.run_id, attempt: row.attempt, notBefore: row.not_before, reason: row.reason,
        exhausted: row.attempt > RESUME_BACKOFF_MINUTES.length
      }));
  }

  /** Clears the wait. Called once the run moves on, however it moves on. */
  clear(runId: string): void {
    if (!this.has("autopilot_resume_schedule")) return;
    this.db.prepare("DELETE FROM autopilot_resume_schedule WHERE run_id=:runId").run({ runId });
  }
}
