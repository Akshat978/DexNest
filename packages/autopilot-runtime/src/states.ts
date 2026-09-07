// The run state machine.
//
// State is never a free string mutated at call sites. Every change goes through
// assertTransition, and the legal edges live only in TRANSITIONS below.

export const RUN_STATES = [
  "CREATED",
  "READY",
  "RUNNING",
  "PAUSE_REQUESTED",
  "PAUSED",
  "STOP_REQUESTED",
  "STOPPED",
  "RECONCILING",
  "AWAITING_APPROVAL",
  "NEEDS_REVIEW",
  "COMPLETED",
  "FAILED"
] as const;

export type RunState = (typeof RUN_STATES)[number];

/**
 * Terminal states. A run in one of these never transitions again, and is never
 * auto-resumed on restart.
 */
export const TERMINAL_STATES: readonly RunState[] = ["STOPPED", "COMPLETED", "FAILED"];

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * NEEDS_REVIEW is deliberately distinct from PAUSED.
 *
 * PAUSED means "the user asked to hold at a safe boundary"; resuming is a plain
 * user decision and continues from a known-good position.
 *
 * NEEDS_REVIEW means reconciliation could not establish whether an already
 * dispatched side effect took place. Resuming is NOT a plain decision, because
 * either choice can be wrong: replaying may duplicate work that already
 * happened, skipping may drop work that never did. The runtime therefore refuses
 * to move without an explicit human resolution of the specific uncertain step
 * (see engine.resolveUncertainStep). Collapsing this into PAUSED would let a
 * single "resume" click silently replay a non-idempotent operation, which is the
 * exact failure this phase exists to prevent.
 */
export const REVIEW_STATE: RunState = "NEEDS_REVIEW";

const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  CREATED: ["READY", "RECONCILING", "FAILED"],
  READY: ["RUNNING", "STOP_REQUESTED", "STOPPED", "RECONCILING", "FAILED"],
  RUNNING: ["PAUSE_REQUESTED", "STOP_REQUESTED", "RECONCILING", "AWAITING_APPROVAL", "COMPLETED", "FAILED"],
  PAUSE_REQUESTED: ["PAUSED", "STOP_REQUESTED", "RECONCILING", "FAILED"],
  PAUSED: ["RUNNING", "STOP_REQUESTED", "RECONCILING", "FAILED"],
  STOP_REQUESTED: ["STOPPED", "RECONCILING", "FAILED"],
  // Terminal.
  STOPPED: [],
  // Reconciliation is entered on restart from any non-terminal state, and exits
  // to whichever state the durable evidence justifies.
  RECONCILING: ["READY", "RUNNING", "PAUSED", "STOPPED", "AWAITING_APPROVAL", "NEEDS_REVIEW", "COMPLETED", "FAILED"],
  // A run blocked on a human decision. Only an approval resolution, a stop or
  // reconciliation moves it; it never proceeds on its own.
  AWAITING_APPROVAL: ["RUNNING", "PAUSED", "STOP_REQUESTED", "STOPPED", "RECONCILING", "NEEDS_REVIEW", "FAILED"],
  // Only an explicit human resolution leaves NEEDS_REVIEW.
  NEEDS_REVIEW: ["RUNNING", "PAUSED", "STOP_REQUESTED", "STOPPED", "RECONCILING", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function legalTargets(from: RunState): readonly RunState[] {
  return TRANSITIONS[from];
}

export class IllegalTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(
      `Illegal Autopilot run transition ${from} -> ${to}. Legal targets from ${from}: ` +
        (TRANSITIONS[from].length ? TRANSITIONS[from].join(", ") : "(none, terminal state)")
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

/** Run event types. Append-only journal vocabulary. */
export const RUN_EVENT_TYPES = [
  "WORKER_SESSION_CREATED",
  "WORKER_PROVIDER_SESSION_BOUND",
  "WORKER_CONFIGURATION_RECORDED",
  "WORKER_SESSION_RESUMED",
  "WORKER_SEND_INTENT",
  "WORKER_SEND_DISPATCHING",
  "WORKER_SEND_RESULT",
  "WORKER_SEND_UNCERTAIN",
  "WORKER_INTERRUPT_REQUESTED",
  "WORKER_SEND_RESOLVED_BY_HUMAN",
  "LOOP_GRANTED",
  "LOOP_REVOKED",
  "LOOP_TURN_PLANNED",
  "LOOP_TURN_CONSUMED_GRANT",
  "LOOP_TURN_SETTLED",
  "LOOP_TURN_LIMIT_REACHED",
  "LOOP_HELD",
  "PRIMARY_PROGRESS_EVALUATED",
  "CONSULTATION_RECOMMENDED",
  "CONSULTANT_SESSION_STARTED",
  "CONSULTANT_SESSION_RESUMED",
  "CONSULTANT_DIAGNOSIS_INTENT",
  "CONSULTANT_DIAGNOSIS_COMPLETED",
  "CONSULTANT_DIAGNOSIS_FAILED",
  "CONSULTANT_DIAGNOSIS_UNCERTAIN",
  "CONSULTANT_OUTPUT_REFUSED",
  "CONSULTATION_HOLD_RELEASED",
  "DIAGNOSIS_SUPPLIED_TO_PRIMARY",
  "WORKER_DIAGNOSTICS_RECORDED",
  "CONSULTATION_REQUESTED",
  "HANDOFF_PROPOSED",
  "HANDOFF_APPROVED",
  "HANDOFF_CANCELLED",
  "HANDOFF_SUPERSEDED",
  "HANDOFF_ACTIVATING",
  "HANDOFF_ACTIVATED",
  "HANDOFF_FAILED",
  "PRIMARY_OWNERSHIP_CHANGED",
  "RECOVERY_EVALUATED",
  "PLAN_ITEM_STARTED",
  "PLAN_ITEM_COMPLETED",
  "PLAN_ITEM_BLOCKED",
  "PLAN_ITEM_SKIPPED",
  "PLAN_ITEM_RESET",
  "PROJECT_BRANCH_CREATED",
  "PROJECT_BRANCH_RESUMED",
  "WORKER_SESSION_ATTACHED",
  "WORKER_SESSION_ROTATED",
  "ITERATION_STARTED",
  "ITERATION_SETTLED",
  "DIRECTION_RECORDED",
  "DIRECTION_REJECTED",
  "DIRECTION_REQUESTED",
  "DIRECTION_AUTHORITY_CHANGED",
  "DIRECTOR_SESSION_STARTED",
  "ASSUMPTION_RECORDED",
  "RESUME_SCHEDULED",
  "RESUME_ABANDONED",
  "RESUME_ATTEMPTED",
  "LOOP_TURN_COST_RECORDED",
  "OPERATOR_NOTE_RECORDED",
  "RUN_QUEUE_ITEM_STARTED",
  "RUN_QUEUE_ITEM_SETTLED",
  "PLAN_COMPLETE_ACCEPTED",
  "PLAN_COMPLETE_REJECTED",
  "CONSULTATION_APPROVED",
  "CONSULTATION_CANCELLED",
  "CONSULTATION_SUPERSEDED",
  "VERIFICATION_STARTED",
  "VERIFICATION_TIER_FAILED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "VERIFICATION_INDETERMINATE",
  "CHECKPOINT_INTENT_RECORDED",
  "CHECKPOINT_CREATED",
  "CHECKPOINT_NO_CHANGES",
  "CHECKPOINT_FAILED",
  "CHECKPOINT_RECOVERED",
  "WORKSPACE_SNAPSHOT_RECORDED",
  "REPORT_EXPORTED",
  "WORKSPACE_CONTEXT_READ",
  "WORKER_OUTPUT_APPLIED",
  "WORKER_OUTPUT_REJECTED",
  "CONTEXT_REQUESTED",
  "CONTEXT_REQUEST_FULFILLED",
  "CONTEXT_REQUEST_DENIED",
  "RUN_CREATED",
  "RUN_READY",
  "RUN_STARTED",
  "STEP_INTENT_RECORDED",
  "STEP_STARTED",
  "STEP_COMPLETED",
  "STEP_FAILED",
  "STEP_CANCELLED",
  "OPERATION_INTENT_RECORDED",
  "OPERATION_POLICY_DECIDED",
  "OPERATION_DENIED",
  "OPERATION_DISPATCHED",
  "OPERATION_COMPLETED",
  "OPERATION_FAILED",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "APPROVAL_MISMATCH_REJECTED",
  "WORKSPACE_CREATED",
  "WORKSPACE_VALIDATED",
  "PAUSE_REQUESTED",
  "RUN_PAUSED",
  "RUN_RESUMED",
  "STOP_REQUESTED",
  "RUN_STOPPED",
  "RECONCILIATION_STARTED",
  "RECONCILIATION_RESOLVED",
  "STEP_UNCERTAIN",
  "STEP_RESOLVED_BY_HUMAN",
  "RUN_NEEDS_REVIEW",
  "RUN_COMPLETED",
  "RUN_FAILED"
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Lifecycle of a single logical step. Drives duplicate prevention. */
export const STEP_STATUSES = ["INTENT", "RUNNING", "COMPLETED", "FAILED", "UNCERTAIN", "SKIPPED"] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

/** A step in one of these has a settled outcome and must never be re-executed. */
export const SETTLED_STEP_STATUSES: readonly StepStatus[] = ["COMPLETED", "FAILED", "SKIPPED"];

export function isSettled(status: StepStatus): boolean {
  return SETTLED_STEP_STATUSES.includes(status);
}
