// Event types and payloads. Every payload is built here, from an explicit
// list of fields: ids, project, verb, outcome, counts, branch names and shas.
// Never file contents, file paths, commit messages, stash messages, command
// output or remote URLs - so a payload can't leak them by accident.

import type { OperationPlan, PlanCounts, Refusal, UndoRecord } from "./operations.ts";

export const PROJECTS_EVENT_STREAM = "projects";
export const PROJECTS_MODULE_ID = "projects";

export const PROJECTS_EVENT_TYPES = [
  "projects.project.added",
  "projects.project.updated",
  "projects.project.archived",
  "projects.project.restored",
  "projects.project.removed",
  "projects.legacy.imported",
  "projects.op.started",
  "projects.op.finished",
  "projects.op.undone",
  "projects.op.interrupted",
  "projects.fetch.scheduled"
] as const;
export type ProjectsEventType = (typeof PROJECTS_EVENT_TYPES)[number];

export type ProjectSource = "wizard" | "suggestion" | "clone" | "import" | "legacy_form" | "edit";

export type OpOutcome = "succeeded" | "failed" | "refused" | "auth_needed" | "cancelled" | "timed_out" | "busy";

type Scalar = string | number | boolean | null;
export type EventPayload = Record<string, Scalar | Record<string, number>>;

function counts(c: PlanCounts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of ["commits", "files", "branches", "stashes"] as const) {
    const value = c[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function projectEventPayload(projectId: string, source: ProjectSource): EventPayload {
  return { projectId, source };
}

export function legacyImportedPayload(count: number, skipped: number, sha256: string): EventPayload {
  return { count, skipped, sha256 };
}

export function opStartedPayload(opId: string, projectId: string, plan: OperationPlan, headBefore: string | null): EventPayload {
  return {
    opId,
    projectId,
    verb: plan.kind,
    safety: plan.safety,
    network: plan.network,
    branch: plan.branch,
    headBefore,
    counts: counts(plan.counts)
  };
}

export function opRefusedPayload(opId: string, projectId: string, refusal: Refusal): EventPayload {
  return { opId, projectId, verb: refusal.kind, outcome: "refused", code: refusal.code };
}

export function opFinishedPayload(
  opId: string,
  projectId: string,
  plan: OperationPlan,
  outcome: OpOutcome,
  details: { durationMs: number; headAfter: string | null; undoable: boolean; errorCode?: string | null }
): EventPayload {
  return {
    opId,
    projectId,
    verb: plan.kind,
    outcome,
    branch: plan.branch,
    durationMs: Math.max(0, Math.round(details.durationMs)),
    headAfter: details.headAfter,
    undoable: details.undoable,
    errorCode: details.errorCode ?? null,
    counts: counts(plan.counts)
  };
}

export function opUndonePayload(opId: string, undoOpId: string, projectId: string, record: UndoRecord): EventPayload {
  return { opId, undoOpId, projectId, undo: record.kind };
}

export function opInterruptedPayload(opId: string, projectId: string, verb: string): EventPayload {
  return { opId, projectId, verb };
}

export function fetchScheduledPayload(projects: number, failed: number): EventPayload {
  return { projects, failed };
}
