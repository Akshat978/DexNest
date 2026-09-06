// Deterministic PRIMARY evidence only. No platform access and no consultant execution.
import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { LoopStore } from "./loopStore.ts";
import { WorkerStore } from "./workerStore.ts";
import { CheckpointStore } from "./checkpoints.ts";
import { ContextRequestStore } from "./contextRequests.ts";
import { ConsultationStore } from "./consultations.ts";

export interface PrimaryProgress {
  version: 1;
  status: "PROGRESSING" | "STALLED" | "BLOCKED";
  reason: string;
  turnId: string | null;
  turnOrdinal: number | null;
  verificationId: string | null;
  failureFingerprint: string | null;
  workspaceFingerprint: string | null;
  requestFingerprint: string | null;
  consecutiveStalled: number;
  consultantRecommended: boolean;
}
// Three equivalent comparisons: the first ordinary failure is never stuck.
export const STALL_COMPARISONS = 3;
export function evidenceFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return a.toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
export function latestPrimaryProgress(ports: RuntimePorts, runId: string): PrimaryProgress | null {
  const event = new AutopilotStore(ports).listEvents(runId).reverse().find(e => e.type === "PRIMARY_PROGRESS_EVALUATED");
  return event ? event.payload.decision as unknown as PrimaryProgress : null;
}
export function evaluatePrimaryProgress(ports: RuntimePorts, runId: string, obstacle?: string): PrimaryProgress | null {
  const store = new AutopilotStore(ports);
  const previous = latestPrimaryProgress(ports, runId);
  // Holds cannot be cleared by a restart, a new grant, or another evaluation.
  if (previous && previous.status !== "PROGRESSING") {
    new ConsultationStore(ports).reconcile(runId);
    return previous;
  }
  const turn = new LoopStore(ports).turns(runId).at(-1);
  if (!turn && !obstacle) return previous;
  if (!obstacle && previous?.turnId === turn?.id) return previous;
  const verification = new LoopStore(ports).verifications(runId).reverse().find(v => v.turnId === turn?.id);
  const report = verification?.report;
  const send = turn?.sendId ? new WorkerStore(ports).list(runId).find(s => s.id === turn.sendId) : null;
  const failure = obstacle ?? (send?.result?.ok === false ? send.result.failure : null);
  const outputBlocked = store.listEvents(runId).some(e => e.stepKey === turn?.id &&
    ["WORKER_OUTPUT_APPLIED", "WORKER_OUTPUT_REJECTED"].includes(e.type) && Number(e.payload.refused) > 0);
  const blocked = outputBlocked ? "policy" : failure && !["interrupted", "timeout"].includes(failure)
    ? failure : report?.configurationError ? "verification_configuration_error"
    : report?.tiers.some(t => t.gating && !t.ran) ? "verification_unavailable" : null;
  const requests = new ContextRequestStore(ports).list(runId).filter(r => r.requestedTurnId === turn?.id).map(r => r.path).sort();
  const snapshot = new CheckpointStore(ports).snapshots(runId).reverse().find(s => s.turnId === turn?.id);
  const writes: Record<string, string> = {};
  for (const event of store.listEvents(runId)) {
    if (event.type === "WORKER_OUTPUT_APPLIED" && event.payload.contentFingerprints) Object.assign(writes, event.payload.contentFingerprints);
  }
  const workspaceFingerprint = snapshot ? evidenceFingerprint([snapshot.headSha, snapshot.statusText, snapshot.diffStat, Object.entries(writes).sort()]) : null;
  // Normalize timing/ANSI only. Preserve diagnostic numbers and paths so a changed
  // compiler error or assertion is not accidentally classified as equivalent.
  const failing = report?.tiers.filter(t => t.gating && !t.ok);
  const failureFingerprint = failing?.length ? evidenceFingerprint(failing.map(t => [t.tier, t.command, t.exitCode,
    t.detail.replace(/\u001b\[[0-9;]*m/g, "").replace(/\b\d+(?:\.\d+)?\s*ms\b/g, "<duration>").replace(/\s+/g, " ").trim()])) : null;
  const requestFingerprint = requests.length ? evidenceFingerprint(requests) : null;
  const equivalentFailure = report?.outcome === "FAILED" && failureFingerprint === previous?.failureFingerprint;
  const repeatedRequests = turn?.status === "REQUESTED_CONTEXT" && requestFingerprint !== null && requestFingerprint === previous?.requestFingerprint;
  const unchanged = workspaceFingerprint !== null && workspaceFingerprint === previous?.workspaceFingerprint;
  const count = unchanged && (equivalentFailure || repeatedRequests) ? (previous?.consecutiveStalled ?? 0) + 1 : 0;
  const status = blocked ? "BLOCKED" : count >= STALL_COMPARISONS ? "STALLED" : "PROGRESSING";
  const decision: PrimaryProgress = {
    version: 1, status, turnId: turn?.id ?? null, turnOrdinal: turn?.ordinal ?? null,
    verificationId: verification?.id ?? null, failureFingerprint, workspaceFingerprint, requestFingerprint,
    consecutiveStalled: count,
    reason: blocked ? "terminal_obstacle:" + blocked : status === "STALLED"
      ? repeatedRequests ? "repeated_context_requests_without_change" : "equivalent_verification_without_change"
      : count ? "equivalent_evidence_below_threshold" : "first_or_changed_evidence",
    consultantRecommended: status === "STALLED" || !!blocked && ["auth", "quota", "session", "protocol", "unsupported", "not_installed"].includes(blocked)
  };
  store.appendEvent(runId, { type: "PRIMARY_PROGRESS_EVALUATED", stepKey: turn?.id,
    payload: { decision, consultant_recommended: decision.consultantRecommended } });
  return decision;
}
