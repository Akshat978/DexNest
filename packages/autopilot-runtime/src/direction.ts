// Self-direction: the agent choosing what to do next, in its own session.
//
// WHY THIS SHAPE
//
// The obvious design is to ask the agent a second question after each turn —
// "what next?" — and that is what a naive supervisor loop does. It is also
// wasteful: a second round-trip, a second dispatch, a second thing to reconcile
// after a crash, all to ask a session that just finished the work what it was
// about to do anyway.
//
// So the decision rides along with the work. The agent ends its turn with one
// small block naming what it would do next, and DexNest keeps it. There is no
// extra provider call in this phase at all.
//
// WHAT THE AGENT MAY DECIDE, AND WHAT IT MAY NOT
//
//   CONTINUE       here is the next assignment
//   PLAN_COMPLETE  I believe the plan is finished
//   NEEDS_HUMAN    something needs a person
//
// Not in the vocabulary: repair. A failing verification is DexNest's finding,
// not the agent's claim, and the existing deterministic repair prompt already
// carries the real evidence. If the agent could declare REPAIR it could also
// describe a failure as something milder and steer the loop away from it.
//
// Not in the vocabulary either: anything that ends a run. PLAN_COMPLETE is a
// proposal. It stops the loop and asks a human — an agent that could declare
// itself finished would be marking its own homework at 3am.
//
// A decision is a PROPOSAL ABOUT WORK, never a change of authority. The
// assignment text is embedded inside a DexNest-authored prompt that restates
// the authoritative goal and constraints; it is never sent as the prompt. An
// agent cannot widen its own scope by writing a persuasive next assignment.

import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { RunSpec } from "./runSpec.ts";
import { AutopilotStore } from "./store.ts";

export type DirectionVerb = "CONTINUE" | "PLAN_COMPLETE" | "NEEDS_HUMAN";

/**
 * Who chose the next step.
 *
 * "self" is the working agent, deciding in its own session as part of the turn
 * it just finished. Cheap — no extra call — but it spends the coding agent's
 * capacity on planning.
 *
 * "chat" is a separate read-only session that holds the project's history and
 * writes assignments, which is the split the manual workflow used: the chat
 * plans, the expensive coding subscription codes. It costs one extra call per
 * iteration.
 *
 * Neither is more trusted than the other. Both produce proposals about work,
 * bounded identically.
 */
export type DirectionSource = "self" | "chat";

/** Who currently decides, and the record of every change. */
export interface DirectionAuthority {
  id: string;
  runId: string;
  ordinal: number;
  source: DirectionSource;
  status: "CURRENT" | "HISTORICAL";
  reason: string;
  changedBy: string;
  startedAt: string;
  endedAt: string | null;
}

export const MAX_ASSIGNMENT_CHARS = 8_000;
export const MAX_REASON_CHARS = 2_000;

/**
 * The assignment shown in the instructions.
 *
 * Workers quote formats back at you. If the example is parseable, an echo of
 * the instructions becomes an instruction — a run steering itself on text
 * DexNest wrote. So the example text is known here and rejected on the way in.
 */
export const EXAMPLE_ASSIGNMENT = "One concrete next piece of work, in a sentence or two.";

export interface DirectionDecision {
  id: string;
  runId: string;
  /** The turn whose answer carried this decision. */
  turnId: string;
  source: DirectionSource;
  verb: DirectionVerb;
  /** For CONTINUE: what the agent proposes to do next. */
  assignment: string | null;
  /** For PLAN_COMPLETE and NEEDS_HUMAN: why. */
  reason: string | null;
  /** The plan item the agent says the next assignment belongs to. */
  planItemId: string | null;
  /** Set once the decision has been turned into a prompt. Then never reused. */
  consumedByTurnId: string | null;
  createdAt: string;
}

interface DirectionRow {
  id: string;
  run_id: string;
  turn_id: string;
  source: string;
  verb: string;
  assignment: string | null;
  reason: string | null;
  plan_item_id: string | null;
  consumed_by_turn_id: string | null;
  created_at: string;
}

const toDecision = (row: DirectionRow): DirectionDecision => ({
  id: row.id,
  runId: row.run_id,
  turnId: row.turn_id,
  source: row.source as DirectionSource,
  verb: row.verb as DirectionVerb,
  assignment: row.assignment,
  reason: row.reason,
  planItemId: row.plan_item_id,
  consumedByTurnId: row.consumed_by_turn_id,
  createdAt: row.created_at
});

/** Told to the worker so it knows how to end a turn. */
export function directionProtocolInstructions(planItemIds: readonly string[]): string {
  return [
    "BEFORE YOU FINISH",
    "",
    "End your reply with exactly one decision block, so the run knows what",
    "happens next. Put it last, after everything else:",
    "",
    "<<<DEXNEST_NEXT>>>",
    "decision: CONTINUE",
    planItemIds.length ? `plan-item: ${planItemIds[0]}` : "plan-item: none",
    `assignment: ${EXAMPLE_ASSIGNMENT}`,
    "<<<END_DEXNEST_NEXT>>>",
    "",
    "decision must be one of:",
    "- CONTINUE     — you have a next step. Describe it in assignment.",
    "- PLAN_COMPLETE — you believe everything asked for is done. Give a reason.",
    "- NEEDS_HUMAN  — a person has to decide or act. Give a reason.",
    "",
    planItemIds.length
      ? `plan-item must be one of: ${planItemIds.join(", ")} — or none.`
      : "plan-item: none (this run has no plan items).",
    "",
    "Notes:",
    "- Do not report a failure here. If the verification commands fail, DexNest",
    "  tells you what failed and you fix it next turn; that is not your call.",
    "- PLAN_COMPLETE stops the run and asks a human. It does not finish it.",
    `- assignment is at most ${MAX_ASSIGNMENT_CHARS} characters.`
  ].join("\n");
}

export interface ParsedDirection {
  verb: DirectionVerb;
  assignment: string | null;
  reason: string | null;
  planItemId: string | null;
  /** Why a block was rejected, when one was present but unusable. */
  issue: string | null;
}

/** Bounded, single-line, control-character-free text from a worker reply. */
const clean = (value: string, limit: number): string =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);

/**
 * Reads the decision block out of a worker reply.
 *
 * Absence is not an error: a worker may simply not have ended its turn that
 * way, and a run without a decision falls back to the deterministic prompt. A
 * malformed block IS reported, because silently treating it as absent would
 * hide a worker that is trying to direct the run and failing.
 */
export function parseDirection(text: string, planItemIds: readonly string[] = []): ParsedDirection | null {
  const blocks = [...String(text ?? "").matchAll(/<<<DEXNEST_NEXT>>>([\s\S]*?)<<<END_DEXNEST_NEXT>>>/g)];
  if (blocks.length === 0) return null;

  // The LAST block wins. Workers quote the instructions back, so an earlier
  // block is far more likely to be an echo of the example than a second
  // opinion, and the instructions say to put the real one last.
  const body = blocks.at(-1)![1] ?? "";
  const field = (name: string): string | null => {
    // Values run to the next field or the end of the block, so an assignment
    // may span lines.
    // The "m" flag is needed so the lookahead's "^" finds the next field at the
    // start of a line — but it also makes a bare "$" match every line ending,
    // which truncated multi-line assignments at their first newline. The
    // negative lookahead pins the alternative to real end-of-input instead.
    const pattern = new RegExp(
      `^\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:decision|plan-item|assignment|reason)\\s*:|$(?![\\s\\S]))`,
      "im"
    );
    const match = pattern.exec(body);
    return match ? match[1]!.trim() || null : null;
  };

  const rawVerb = (field("decision") ?? "").toUpperCase().replace(/[^A-Z_]/g, "");
  if (!["CONTINUE", "PLAN_COMPLETE", "NEEDS_HUMAN"].includes(rawVerb)) {
    return { verb: "NEEDS_HUMAN", assignment: null, planItemId: null, reason: "The worker's decision could not be read.", issue: `Unrecognized decision "${clean(field("decision") ?? "", 80)}".` };
  }
  const verb = rawVerb as DirectionVerb;

  const assignment = field("assignment") ? clean(field("assignment")!, MAX_ASSIGNMENT_CHARS) : null;
  const reason = field("reason") ? clean(field("reason")!, MAX_REASON_CHARS) : null;

  // A verbatim echo of the instructions is not a decision. Acting on it would
  // mean the run taking direction from text DexNest wrote itself.
  if (assignment && assignment.toLowerCase() === EXAMPLE_ASSIGNMENT.toLowerCase()) return null;

  const rawItem = field("plan-item");
  const named = rawItem && rawItem.toLowerCase() !== "none" ? clean(rawItem, 200) : null;
  // An invented plan item must never be recorded: work would be attributed to
  // something the human never asked for. But an unrecognized LABEL is almost
  // always a formatting slip — "Phase 2" for "plan-2" — and stopping the run
  // over one wakes a person at 4am to fix a hyphen, throwing away a decision
  // whose assignment is perfectly good.
  //
  // So the reference is dropped rather than trusted, the slip is recorded as
  // an issue, and the decision itself stands. The plan's own order then picks
  // the item, exactly as it does when an agent names none. The guarantee is
  // kept — nothing is attributed to an item that does not exist — without
  // spending the night on it.
  const unknownItem = named !== null && planItemIds.length > 0 && !planItemIds.includes(named);
  const planItemId = unknownItem ? null : named;
  const issue = unknownItem ? `Unknown plan item "${named}"; the plan's own order was used instead.` : null;

  if (verb === "CONTINUE" && !assignment) {
    return { verb: "NEEDS_HUMAN", assignment: null, planItemId, reason: "The worker asked to continue without saying what to do next.", issue: "CONTINUE without an assignment." };
  }

  return { verb, assignment, reason, planItemId, issue };
}

export class DirectionStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_direction_decisions'").get()
    );
  }

  list(runId: string): DirectionDecision[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_direction_decisions WHERE run_id=:runId ORDER BY created_at, rowid")
      .all<DirectionRow>({ runId })
      .map(toDecision);
  }

  /** The decision waiting to become the next prompt, if any. */
  pending(runId: string): DirectionDecision | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_direction_decisions WHERE run_id=:runId AND consumed_by_turn_id IS NULL ORDER BY rowid DESC LIMIT 1")
      .get<DirectionRow>({ runId });
    return row ? toDecision(row) : null;
  }

  /** One decision per turn. A second is ignored rather than allowed to overwrite. */
  record(input: {
    runId: string;
    turnId: string;
    decision: ParsedDirection;
    /** Who decided. Defaults to the working agent itself. */
    source?: DirectionSource;
  }): DirectionDecision | null {
    if (!this.available()) return null;
    return this.store.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM autopilot_direction_decisions WHERE run_id=:runId AND turn_id=:turnId")
        .get<DirectionRow>({ runId: input.runId, turnId: input.turnId });
      if (existing) return toDecision(existing);

      const id = this.ports.ids.next("direction");
      this.db
        .prepare(
          `INSERT INTO autopilot_direction_decisions
             (id, run_id, turn_id, source, verb, assignment, reason, plan_item_id, created_at)
           VALUES (:id, :runId, :turnId, :source, :verb, :assignment, :reason, :planItemId, :now)`
        )
        .run({
          id, runId: input.runId, turnId: input.turnId, source: input.source ?? "self", verb: input.decision.verb,
          assignment: input.decision.assignment, reason: input.decision.reason,
          planItemId: input.decision.planItemId, now: this.ports.clock.now()
        });

      this.store.appendEvent(input.runId, {
        type: input.decision.issue ? "DIRECTION_REJECTED" : "DIRECTION_RECORDED",
        stepKey: input.turnId,
        payload: {
          verb: input.decision.verb,
          source: input.source ?? "self",
          planItemId: input.decision.planItemId,
          assignmentLength: input.decision.assignment?.length ?? 0,
          ...(input.decision.issue ? { issue: input.decision.issue } : {})
        }
      });
      return this.record(input);
    });
  }

  /**
   * Binds a decision to the turn it produced.
   *
   * consumed_by_turn_id can only move away from NULL once, which is what makes
   * "an assignment is acted on at most once" true across a restart.
   */
  consume(decisionId: string, turnId: string): void {
    if (!this.available()) return;
    this.db
      .prepare("UPDATE autopilot_direction_decisions SET consumed_by_turn_id=:turnId WHERE id=:id AND consumed_by_turn_id IS NULL")
      .run({ id: decisionId, turnId });
  }
}

/**
 * Who decides what happens next, over time.
 *
 * Shaped like OwnershipStore on purpose. Ownership answers "who writes the
 * code"; this answers "who decides what to write". They are different axes and
 * move independently — the same agent can keep implementing while direction
 * moves to a chat, which is exactly the switch this exists for.
 *
 * The Run Spec is never rewritten by a switch. Authority is separate durable
 * state with a full history, so "who was directing when this was decided" stays
 * answerable after the fact.
 */
export class DirectionAuthorityStore {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;

  constructor(ports: RuntimePorts) {
    this.ports = ports;
    this.db = ports.db;
    this.store = new AutopilotStore(ports);
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_direction_authority'").get()
    );
  }

  history(runId: string): DirectionAuthority[] {
    if (!this.available()) return [];
    return this.db
      .prepare("SELECT * FROM autopilot_direction_authority WHERE run_id=:runId ORDER BY ordinal")
      .all<AuthorityRow>({ runId })
      .map(toAuthority);
  }

  /** The source in force now. Absent history means the default: the agent itself. */
  current(runId: string): DirectionSource {
    if (!this.available()) return "self";
    const row = this.db
      .prepare("SELECT * FROM autopilot_direction_authority WHERE run_id=:runId AND status='CURRENT'")
      .get<AuthorityRow>({ runId });
    return row ? (row.source as DirectionSource) : "self";
  }

  /**
   * Moves direction to another source.
   *
   * A human act: it changes who writes the assignments a run acts on, so it
   * records who asked and why, and switching to what is already in force is a
   * no-op rather than a second entry in the history.
   */
  switchTo(input: { runId: string; source: DirectionSource; reason: string; changedBy: string }): DirectionAuthority | null {
    if (!this.available()) return null;
    if (!input.reason.trim()) throw new Error("Changing who directs a run requires a reason.");
    if (!input.changedBy.trim()) throw new Error("Changing who directs a run must record who asked.");

    return this.store.transaction(() => {
      const history = this.history(input.runId);
      const currentRow = history.find((entry) => entry.status === "CURRENT") ?? null;
      const effective = currentRow?.source ?? "self";
      if (effective === input.source && currentRow) return currentRow;
      // The first explicit switch also records the default that was in force,
      // so the history does not begin midway through the story.
      if (!currentRow && history.length === 0 && input.source !== "self") {
        this.openUnsafe(input.runId, "self", "The run began directing itself.", "system", 1);
      }

      const now = this.ports.clock.now();
      const open = this.db
        .prepare("SELECT * FROM autopilot_direction_authority WHERE run_id=:runId AND status='CURRENT'")
        .get<AuthorityRow>({ runId: input.runId });
      if (open) {
        this.db
          .prepare("UPDATE autopilot_direction_authority SET status='HISTORICAL', ended_at=:now WHERE id=:id")
          .run({ id: open.id, now });
      }

      const ordinal = (this.history(input.runId).at(-1)?.ordinal ?? 0) + 1;
      this.openUnsafe(input.runId, input.source, input.reason.trim(), input.changedBy.trim(), ordinal);
      this.store.appendEvent(input.runId, {
        type: "DIRECTION_AUTHORITY_CHANGED",
        payload: { from: effective, to: input.source, reason: input.reason.trim(), changedBy: input.changedBy.trim() }
      });
      return this.history(input.runId).find((entry) => entry.status === "CURRENT")!;
    });
  }

  private openUnsafe(runId: string, source: DirectionSource, reason: string, changedBy: string, ordinal: number): void {
    this.db
      .prepare(
        `INSERT INTO autopilot_direction_authority (id, run_id, ordinal, source, status, reason, changed_by, started_at)
         VALUES (:id, :runId, :ordinal, :source, 'CURRENT', :reason, :changedBy, :now)`
      )
      .run({
        id: this.ports.ids.next("direction-authority"), runId, ordinal, source,
        reason, changedBy, now: this.ports.clock.now()
      });
  }
}

interface AuthorityRow {
  id: string;
  run_id: string;
  ordinal: number;
  source: string;
  status: string;
  reason: string;
  changed_by: string;
  started_at: string;
  ended_at: string | null;
}

const toAuthority = (row: AuthorityRow): DirectionAuthority => ({
  id: row.id,
  runId: row.run_id,
  ordinal: row.ordinal,
  source: row.source as DirectionSource,
  status: row.status as "CURRENT" | "HISTORICAL",
  reason: row.reason,
  changedBy: row.changed_by,
  startedAt: row.started_at,
  endedAt: row.ended_at
});

/**
 * The prompt for a turn the agent asked for itself.
 *
 * The authoritative goal and constraints are restated by DexNest and come
 * FIRST; the agent's own words are quoted afterwards and clearly labelled as
 * its own proposal. An assignment is a piece of work, not an instruction to the
 * runtime, and it cannot be written in a way that outranks the Run Spec.
 */
export function directedPrompt(decision: DirectionDecision, spec: RunSpec, context: string): string {
  const item = spec.plan.find((entry) => entry.id === decision.planItemId) ?? null;
  return [
    `GOAL (set by the human, unchanged): ${spec.goal}`,
    spec.constraints.length ? `CONSTRAINTS:\n${spec.constraints.map((value) => `- ${value}`).join("\n")}` : "",
    spec.nonGoals.length ? `NOT IN SCOPE:\n${spec.nonGoals.map((value) => `- ${value}`).join("\n")}` : "",
    item ? `PLAN ITEM ${item.ordinal}: ${item.title}${item.detail ? `\n${item.detail}` : ""}` : "",
    "",
    "NEXT STEP",
    "",
    "At the end of your last turn you said this is what you would do next:",
    "",
    decision.assignment!.split("\n").map((line) => `  ${line}`).join("\n"),
    "",
    "Do that now. If it turns out to be the wrong next step, say so and do the",
    "right one instead — the goal and constraints above are what bind you, not",
    "your earlier note.",
    context ? `\n${context}` : ""
  ].filter((part) => part !== "").join("\n");
}

/** One line per decision, for the run report. */
export function renderDirections(decisions: DirectionDecision[]): string {
  if (decisions.length === 0) return "No self-directed decisions.";
  return decisions
    .map((decision) => {
      const detail = decision.verb === "CONTINUE"
        ? (decision.assignment ?? "").split("\n")[0]!.slice(0, 120)
        : (decision.reason ?? "");
      return `${decision.verb}${detail ? ` — ${detail}` : ""}`;
    })
    .join("\n");
}
