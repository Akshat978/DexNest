// Recovery and routing policy.
//
// Every mechanism this decides between already exists: the sticky retry, the
// bounded grant, the consultation, the read-only diagnosis, the ownership
// handoff, the uncertain-send resolution. What was missing was a single
// deterministic answer to "what should happen next", so the Control Center
// could stop asking a human to infer it from six separate panels.
//
// Two properties matter more than anything else here:
//
//   - It is a pure function of durable evidence. No model call, no prose
//     sentiment, no counter living outside SQLite. The same database always
//     produces the same decision, which is why a restart reconstructs it for
//     free and why new evidence retires an old decision automatically.
//
//   - It recommends. It never acts. It cannot approve a consultation, execute a
//     consultant, approve or activate a handoff, issue a grant, touch the Run
//     Spec, change ownership or write to the workspace. Every one of those
//     remains behind the human control that already owns it.

import type { RuntimePorts } from "./ports.ts";
import { AutopilotStore } from "./store.ts";
import { LoopStore } from "./loopStore.ts";
import { WorkerStore } from "./workerStore.ts";
import { ConsultationStore } from "./consultations.ts";
import { ConsultantStore } from "./consultant.ts";
import { OwnershipStore, HandoffStore, currentRoles } from "./handoff.ts";
import { WorkerDiagnosticsStore } from "./diagnostics.ts";
import { latestPrimaryProgress } from "./progress.ts";
import type { CodingProvider } from "./roles.ts";

export type RecoveryAction =
  /** The loop may keep going on its own authority; nothing to recommend. */
  | "CONTINUE_PRIMARY"
  /** The same sticky PRIMARY should take another turn. */
  | "RETRY_PRIMARY"
  /** Ask the configured consultant for one read-only second opinion. */
  | "RECOMMEND_CONSULTATION"
  /** Propose moving implementation ownership to the alternate provider. */
  | "RECOMMEND_HANDOFF"
  /** A provider send has no confirmed outcome; resolve that first. */
  | "RESOLVE_UNCERTAIN"
  /** Only a human can move this forward. */
  | "WAIT_FOR_OPERATOR"
  /** The run finished successfully. */
  | "COMPLETE"
  /** The run is terminal and not successful; nothing to recover. */
  | "NO_ACTION";

/** Local availability of a provider. Never a claim about usage or quota. */
export interface ProviderPreflight {
  provider: string;
  executableConfigured: boolean;
  executableFound: boolean;
  availableLocally: boolean;
  quota: "unknown_until_provider_call";
}

export interface RecoveryDecision {
  version: 1;
  runId: string;
  action: RecoveryAction;
  /** A stable machine reason, never model prose. */
  reason: string;
  /** One sentence for a human, derived from the same durable evidence. */
  summary: string;
  currentPrimary: string;
  alternateProvider: string | null;
  /** The durable record this decision was derived from. */
  evidence: {
    runState: string;
    progressStatus: string | null;
    progressReason: string | null;
    latestTurnId: string | null;
    latestTurnOrdinal: number | null;
    verification: string | null;
    workerFailure: string | null;
    uncertainSendId: string | null;
    consultationId: string | null;
    consultationStatus: string | null;
    diagnosisId: string | null;
    diagnosisSuppliedToTurnId: string | null;
    handoffId: string | null;
    handoffStatus: string | null;
    grantStatus: string | null;
    grantTurnsRemaining: number | null;
  };
  /** Local availability of the alternate provider, when one is relevant. */
  alternatePreflight: ProviderPreflight | null;
  /**
   * When the evidence behind this decision last changed — not when it was
   * evaluated. A derived decision has no evaluation time of its own, and a
   * wall-clock stamp would make two rebuilds of the same state look different.
   */
  createdAt: string;
  /** Changes whenever any evidence above changes, so a stale decision cannot persist. */
  fingerprint: string;
}

/** Optional local availability probe. Absent means "not checked". */
export type PreflightProbe = (provider: string) => ProviderPreflight;

const TERMINAL_PROVIDER_OBSTACLES: Record<string, string> = {
  auth: "primary_unauthenticated",
  quota: "primary_quota_exhausted",
  session: "primary_session_unavailable",
  protocol: "primary_protocol_failure",
  unsupported: "primary_unsupported",
  not_installed: "primary_not_installed"
};

/**
 * BLOCKED reasons that are emphatically not provider-routing problems.
 *
 * Switching provider must never become a way around DexNest's own policy, a
 * misconfigured verification command, or a workspace the runtime refused.
 */
const OPERATOR_ONLY_OBSTACLES = new Set([
  "policy",
  "permission",
  "verification_configuration_error",
  "verification_unavailable"
]);

function fingerprintOf(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5;
  let b = 5381;
  for (let index = 0; index < text.length; index += 1) {
    a = Math.imul(a ^ text.charCodeAt(index), 16777619) >>> 0;
    b = (Math.imul(b, 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `rec-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function providerName(value: string | null): string {
  return value === "codex" ? "Codex" : value === "claude" ? "Claude" : String(value ?? "the provider");
}

/**
 * The single current recommendation for a run.
 *
 * Precedence is explicit and total, so exactly one recommendation exists at any
 * moment and two mechanisms can never both claim to be "next".
 */
export function evaluateRecovery(ports: RuntimePorts, runId: string, preflight?: PreflightProbe): RecoveryDecision {
  const store = new AutopilotStore(ports);
  const run = store.requireRun(runId);
  const loops = new LoopStore(ports);
  const sessions = new WorkerStore(ports);
  const consultations = new ConsultationStore(ports);
  const consultant = new ConsultantStore(ports);
  const handoffs = new HandoffStore(ports);
  const ownership = new OwnershipStore(ports);

  const roles = currentRoles(ports, runId, run.spec);
  const currentPrimary = ownership.primaryProvider(runId, run.spec);
  const alternate = roles.consultant;

  const progress = latestPrimaryProgress(ports, runId);
  const turns = loops.turns(runId);
  const latestTurn = turns.at(-1) ?? null;
  const verifications = loops.verifications(runId);
  const latestVerification = verifications.at(-1) ?? null;
  const grant = loops.activeGrant(runId);
  const latestGrant = loops.grants(runId).at(-1) ?? null;
  const sends = sessions.list(runId);
  const uncertain = sends.find((send) => send.status === "UNCERTAIN") ?? null;
  const openConsultation = consultations.list(runId).find((entry) => ["RECOMMENDED", "APPROVED"].includes(entry.status)) ?? null;
  const pendingDiagnosis = consultant.pendingForPrimary(runId);
  const openHandoff = handoffs.open(runId);
  const diagnostics = new WorkerDiagnosticsStore(ports).list(runId);
  const latestPrimaryDiagnostic = diagnostics.filter((entry) => entry.role === "PRIMARY").at(-1) ?? null;

  // A diagnosis that PRIMARY has already been given, and the turn it went to.
  const suppliedDiagnosis = consultant.diagnoses(runId)
    .filter((entry) => entry.status === "COMPLETED" && entry.suppliedToTurnId)
    .at(-1) ?? null;
  const advisoryTurn = suppliedDiagnosis
    ? turns.find((turn) => turn.id === suppliedDiagnosis.suppliedToTurnId) ?? null
    : null;

  // The decision is as old as the newest durable evidence it rests on.
  const events = store.listEvents(runId);
  const evidenceAt = events.at(-1)?.createdAt ?? run.updatedAt;

  // Whether PRIMARY has already acted on a diagnosis and is stuck regardless.
  const advisoryRetried = Boolean(
    advisoryTurn && advisoryTurn.status !== "PLANNED" &&
    progress?.status === "STALLED" && (progress.turnOrdinal ?? 0) >= advisoryTurn.ordinal
  );

  const obstacle = progress?.status === "BLOCKED" && progress.reason.startsWith("terminal_obstacle:")
    ? progress.reason.slice("terminal_obstacle:".length)
    : null;

  const alternatePreflight = alternate && preflight ? preflight(alternate) : null;
  const alternateViable = Boolean(
    alternate && alternate !== currentPrimary && (alternatePreflight ? alternatePreflight.availableLocally : true)
  );

  const evidence: RecoveryDecision["evidence"] = {
    runState: run.state,
    progressStatus: progress?.status ?? null,
    progressReason: progress?.reason ?? null,
    latestTurnId: latestTurn?.id ?? null,
    latestTurnOrdinal: latestTurn?.ordinal ?? null,
    verification: latestVerification?.report.outcome ?? null,
    workerFailure: latestPrimaryDiagnostic?.category ?? null,
    uncertainSendId: uncertain?.id ?? null,
    consultationId: openConsultation?.id ?? null,
    consultationStatus: openConsultation?.status ?? null,
    diagnosisId: pendingDiagnosis?.id ?? suppliedDiagnosis?.id ?? null,
    diagnosisSuppliedToTurnId: suppliedDiagnosis?.suppliedToTurnId ?? null,
    handoffId: openHandoff?.id ?? null,
    handoffStatus: openHandoff?.status ?? null,
    grantStatus: latestGrant?.status ?? null,
    grantTurnsRemaining: latestGrant ? Math.max(0, latestGrant.maxTurns - latestGrant.turnsUsed) : null
  };

  const decide = (
    action: RecoveryAction,
    reason: string,
    summary: string,
    includePreflight = false
  ): RecoveryDecision => ({
    version: 1,
    runId,
    action,
    reason,
    summary,
    currentPrimary,
    alternateProvider: alternate,
    evidence,
    alternatePreflight: includePreflight ? alternatePreflight : null,
    createdAt: evidenceAt,
    // Deliberately excludes createdAt: the decision is identified by its
    // evidence, so re-evaluating unchanged state yields the same fingerprint.
    fingerprint: fingerprintOf({ action, reason, currentPrimary, alternate, evidence })
  });

  // 1. Terminal runs recover nothing.
  if (run.state === "COMPLETED") {
    return decide("COMPLETE", "run_completed", "The run completed and its acceptance criteria passed.");
  }
  if (run.state === "FAILED" || run.state === "STOPPED") {
    return decide("NO_ACTION", `run_${run.state.toLowerCase()}`, `The run is ${run.state.toLowerCase()}; there is nothing to recover.`);
  }

  // 2. An unresolved send outranks everything. Never resend, never route around it.
  if (uncertain) {
    return decide(
      "RESOLVE_UNCERTAIN",
      "uncertain_primary_send",
      `A ${providerName(currentPrimary)} send has no confirmed outcome. Resolve it before anything else runs.`
    );
  }

  // 3./4. An action already in flight is the current action.
  if (openHandoff) {
    return decide(
      "RECOMMEND_HANDOFF",
      `handoff_${openHandoff.status.toLowerCase()}`,
      `A handoff from ${providerName(openHandoff.fromProvider)} to ${providerName(openHandoff.toProvider)} is ${openHandoff.status.toLowerCase()}.`,
      true
    );
  }
  // A completed opinion PRIMARY has not yet seen is consumed by its next turn.
  // This outranks the consultation row it came from: recommending another
  // second opinion while one is already waiting would be noise.
  if (pendingDiagnosis) {
    return grant && grant.status === "ACTIVE" && grant.maxTurns > grant.turnsUsed
      ? decide("CONTINUE_PRIMARY", "diagnosis_pending_for_primary",
          `A ${providerName(pendingDiagnosis.consultantProvider)} diagnosis is waiting for ${providerName(currentPrimary)}'s next turn.`)
      : decide("WAIT_FOR_OPERATOR", "diagnosis_pending_without_grant",
          `A ${providerName(pendingDiagnosis.consultantProvider)} diagnosis is ready, but ${providerName(currentPrimary)} has no authorized turn left.`);
  }

  if (openConsultation) {
    // A merely-recommended consultation does not outrank the escalation it has
    // already failed to resolve: the automatic recommender raises a fresh one on
    // every new stall, which would otherwise make the handoff unreachable. Work
    // actually in flight (APPROVED) still wins.
    // A PRIMARY that cannot execute at all is not helped by a second opinion
    // about its code, and the escalation an advisory already failed to resolve
    // is not answered by recommending the same advisory again.
    const supersededByEscalation = openConsultation.status === "RECOMMENDED"
      && (advisoryRetried || Boolean(obstacle && TERMINAL_PROVIDER_OBSTACLES[obstacle]));
    if (!supersededByEscalation) {
      return alternateViable
        ? decide(
            "RECOMMEND_CONSULTATION",
            `consultation_${openConsultation.status.toLowerCase()}`,
            `A ${providerName(openConsultation.consultantProvider)} second opinion is ${openConsultation.status.toLowerCase()}.`
          )
        : decide(
            "WAIT_FOR_OPERATOR",
            `consultation_${openConsultation.status.toLowerCase()}:no_viable_consultant`,
            `A ${providerName(openConsultation.consultantProvider)} second opinion is ${openConsultation.status.toLowerCase()}, but that provider is not available locally.`,
            true
          );
    }
  }

  // 5./6. Infrastructure and policy refusals are never routed around.
  if (obstacle && OPERATOR_ONLY_OBSTACLES.has(obstacle)) {
    return decide(
      "WAIT_FOR_OPERATOR",
      `operator_required:${obstacle}`,
      obstacle.startsWith("verification")
        ? "Verification cannot run as configured. A provider change would not fix that."
        : "The run was refused by policy. A provider change would not fix that."
    );
  }

  // 7. A PRIMARY that genuinely cannot execute is a routing problem.
  if (obstacle && TERMINAL_PROVIDER_OBSTACLES[obstacle]) {
    const reason = TERMINAL_PROVIDER_OBSTACLES[obstacle]!;
    return alternateViable
      ? decide("RECOMMEND_HANDOFF", reason,
          `${providerName(currentPrimary)} cannot continue (${obstacle}). ${providerName(alternate)} is available locally; usage/quota is unknown until a provider call.`,
          true)
      : decide("WAIT_FOR_OPERATOR", `${reason}:no_alternate`,
          `${providerName(currentPrimary)} cannot continue (${obstacle}) and no alternate provider is available locally.`,
          true);
  }

  // Any other BLOCKED reason is for a human; it is not a provider problem.
  if (progress?.status === "BLOCKED") {
    return decide("WAIT_FOR_OPERATOR", `operator_required:${progress.reason}`,
      `${providerName(currentPrimary)} is blocked: ${progress.reason}.`);
  }

  if (progress?.status === "STALLED") {
    // 8. The canonical escalation: stuck, advised, retried, still stuck.
    if (advisoryRetried) {
      return alternateViable
        ? decide("RECOMMEND_HANDOFF", "stalled_after_consultant_assisted_retry",
            `${providerName(currentPrimary)} is still stuck after acting on a ${providerName(suppliedDiagnosis!.consultantProvider)} diagnosis. ${providerName(alternate)} is available locally; usage/quota is unknown until a provider call.`,
            true)
        : decide("WAIT_FOR_OPERATOR", "stalled_after_consultant_assisted_retry:no_alternate",
            `${providerName(currentPrimary)} is still stuck after a second opinion, and no alternate provider is available locally.`,
            true);
    }

    // 9. First meaningful stall: ask for a second opinion, not a handoff.
    return alternateViable
      ? decide("RECOMMEND_CONSULTATION", "stalled_without_consultation",
          `${providerName(currentPrimary)} is not making progress. Ask ${providerName(alternate)} for a second opinion.`)
      : decide("WAIT_FOR_OPERATOR", "stalled_without_viable_consultant",
          `${providerName(currentPrimary)} is not making progress and no consultant is available locally.`);
  }

  // 10./11. Ordinary work. The loop continues on its own authority while it has one.
  if (grant && grant.status === "ACTIVE" && grant.maxTurns > grant.turnsUsed) {
    return latestVerification?.report.outcome === "FAILED"
      ? decide("RETRY_PRIMARY", "recoverable_verification_failure",
          `Verification failed and the evidence is still changing. ${providerName(currentPrimary)} has ${grant.maxTurns - grant.turnsUsed} authorized turn(s) left.`)
      : decide("CONTINUE_PRIMARY", "progressing",
          `${providerName(currentPrimary)} is making progress with ${grant.maxTurns - grant.turnsUsed} authorized turn(s) left.`);
  }

  // 12. No authorized turn remains. Issuing one is a human decision.
  return decide(
    "WAIT_FOR_OPERATOR",
    latestGrant ? "grant_exhausted" : "no_active_grant",
    `${providerName(currentPrimary)} has no authorized turn left. Authorize more turns to continue.`
  );
}

/** One-line timeline form. Never includes diagnosis or package contents. */
export function recoveryActivityLabel(decision: Pick<RecoveryDecision, "action" | "currentPrimary" | "alternateProvider" | "reason">): string {
  switch (decision.action) {
    case "RETRY_PRIMARY": return `Recovery: retry ${providerName(decision.currentPrimary)} PRIMARY`;
    case "CONTINUE_PRIMARY": return `Recovery: continue ${providerName(decision.currentPrimary)} PRIMARY`;
    case "RECOMMEND_CONSULTATION": return `Recovery: ${providerName(decision.alternateProvider)} consultation recommended`;
    case "RECOMMEND_HANDOFF": return `Recovery: handoff from ${providerName(decision.currentPrimary)} to ${providerName(decision.alternateProvider)} recommended`;
    case "RESOLVE_UNCERTAIN": return `Recovery: resolve uncertain ${providerName(decision.currentPrimary)} send`;
    case "WAIT_FOR_OPERATOR": return `Recovery: operator attention required (${decision.reason})`;
    case "COMPLETE": return "Recovery: run completed";
    default: return "Recovery: no action required";
  }
}

/**
 * Journals the decision, but only when it differs from the last one recorded.
 *
 * The decision itself is always derived, so this exists purely to give the
 * timeline a history of how routing changed. It writes no authority.
 */
export function recordRecoveryDecision(ports: RuntimePorts, runId: string, preflight?: PreflightProbe): RecoveryDecision {
  const decision = evaluateRecovery(ports, runId, preflight);
  const store = new AutopilotStore(ports);
  const previous = store.listEvents(runId).reverse().find((event) => event.type === "RECOVERY_EVALUATED");
  if (previous?.payload.fingerprint === decision.fingerprint) return decision;
  store.appendEvent(runId, {
    type: "RECOVERY_EVALUATED",
    payload: {
      action: decision.action, reason: decision.reason, fingerprint: decision.fingerprint,
      currentPrimary: decision.currentPrimary, alternateProvider: decision.alternateProvider,
      label: recoveryActivityLabel(decision)
    }
  });
  return decision;
}
