// The Run Spec: the authoritative, human-owned definition of a run.
//
// Nothing the runtime, a worker or a supervisor produces may mutate the
// authoritative fields. They are frozen into the run record at creation time and
// carry a content hash so drift is detectable. Later phases add explicit,
// human-approved revisions; Phase 1 implements the identity and versioning that
// makes those revisions possible.

export const RUN_SPEC_SCHEMA_VERSION = 1;

export type AcceptanceCriterionKind = "automated" | "judgment";

export interface AcceptanceCriterion {
  checkCommand?: { executable: string; args: string[] };
  id: string;
  text: string;
  kind: AcceptanceCriterionKind;
  /** For automated criteria: the command whose exit code decides the outcome. */
  check?: string;
}

/**
 * Capability policy. Phase 1 stores and round-trips this but does not enforce
 * it — enforcement is Phase 2, alongside worktrees and the approval queue.
 * Deliberately kept flat rather than speculatively modelled.
 */
export interface CapabilityPolicy {
  workspaceRoot: string | null;
  allowedPaths: string[];
  forbiddenPaths: string[];
  allowedCommands: string[];
  forbiddenCommands: string[];
  requiresApproval: string[];
}

export interface WorkerPreference {
  consultant?: "claude" | "codex" | null;
  primary: string;
  fallback: string | null;
  sticky: boolean;
  consultantMode: boolean;
}

export interface SupervisorPreference {
  provider: string;
}

export interface VerificationConfig {
  structuredCommands?: Record<string, { executable: string; args: string[] }>;
  tiers: string[];
  commands: Record<string, string>;
}

export interface FailurePolicy {
  maxConsecutiveFailures: number;
  maxAttemptsPerStep: number;
}

export interface EscalationPolicy {
  /** Repeated identical failures before a supervisor is consulted. */
  supervisorAfterFailures: number;
  /** Escalate to the human rather than continuing automatically. */
  humanOnUncertainty: boolean;
}

export interface CompletionPolicy {
  rule: string;
  requiresHumanApproval: boolean;
}

export interface RunSpec {
  id: string;
  schemaVersion: number;
  /** Bumped by an explicit, human-approved revision. Never by the runtime. */
  revision: number;
  projectId: string | null;
  projectPath: string | null;

  goal: string;
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: AcceptanceCriterion[];

  workers: WorkerPreference;
  supervisor: SupervisorPreference;
  capabilities: CapabilityPolicy;
  verification: VerificationConfig;
  failurePolicy: FailurePolicy;
  escalationPolicy: EscalationPolicy;
  completion: CompletionPolicy;

  createdAt: string;
  updatedAt: string;
}

/** Fields no agent, worker, supervisor or runtime event may silently change. */
export const AUTHORITATIVE_FIELDS = [
  "goal",
  "constraints",
  "nonGoals",
  "acceptanceCriteria",
  "capabilities"
] as const;

export type RunSpecInput = Partial<Omit<RunSpec, "schemaVersion" | "createdAt" | "updatedAt">> & {
  goal: string;
  provider?: "claude" | "codex";
};

export class RunSpecValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Run Spec: ${issues.join("; ")}`);
    this.name = "RunSpecValidationError";
    this.issues = issues;
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

export function defaultCapabilityPolicy(): CapabilityPolicy {
  return {
    workspaceRoot: null,
    allowedPaths: [],
    // local-data holds the vault, finance records and the DPAPI integration
    // keychain. Source access never implies data access — see AGENTS.md.
    // Phase 1 records the intent; Phase 2 enforces it.
    forbiddenPaths: ["local-data"],
    allowedCommands: [],
    forbiddenCommands: ["git push", "npm publish", "gh pr merge"],
    requiresApproval: ["push", "publish", "deploy", "install", "schema-change"]
  };
}

/**
 * Normalizes and validates raw input into a canonical Run Spec.
 * Throws RunSpecValidationError rather than silently repairing a bad goal.
 */
export function createRunSpec(
  input: RunSpecInput,
  context: { id: string; now: string }
): RunSpec {
  const issues: string[] = [];

  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  if (!goal) {
    issues.push("goal is required and must be a non-empty string");
  }

  const acceptanceCriteria: AcceptanceCriterion[] = Array.isArray(input.acceptanceCriteria)
    ? input.acceptanceCriteria.map((criterion, index) => {
        const text = typeof criterion?.text === "string" ? criterion.text.trim() : "";
        if (!text) {
          issues.push(`acceptanceCriteria[${index}].text is required`);
        }
        const kind: AcceptanceCriterionKind = criterion?.kind === "judgment" ? "judgment" : "automated";
        if (kind === "automated" && criterion?.check !== undefined && typeof criterion.check !== "string") {
          issues.push(`acceptanceCriteria[${index}].check must be a string when present`);
        }
        return {
          id: typeof criterion?.id === "string" && criterion.id.trim() ? criterion.id.trim() : `ac-${index + 1}`,
          text,
          kind,
          check: typeof criterion?.check === "string" ? criterion.check : undefined,
          ...(criterion?.checkCommand ? { checkCommand: criterion.checkCommand } : {})
        };
      })
    : [];

  const criterionIds = new Set<string>();
  for (const criterion of acceptanceCriteria) {
    if (criterionIds.has(criterion.id)) {
      issues.push(`duplicate acceptance criterion id "${criterion.id}"`);
    }
    criterionIds.add(criterion.id);
  }

  const revision = typeof input.revision === "number" && Number.isInteger(input.revision) && input.revision >= 1 ? input.revision : 1;
  const primary = input.workers?.primary ?? input.provider ?? "scripted";
  if (input.workers?.consultant != null && (!["claude", "codex"].includes(input.workers.consultant) || !["claude", "codex"].includes(primary) || primary === input.workers.consultant)) issues.push("Consultant must be the other coding provider.");

  if (issues.length > 0) {
    throw new RunSpecValidationError(issues);
  }

  const capabilityInput: Partial<CapabilityPolicy> = input.capabilities ?? {};
  const defaults = defaultCapabilityPolicy();

  return {
    id: input.id ?? context.id,
    schemaVersion: RUN_SPEC_SCHEMA_VERSION,
    revision,
    projectId: input.projectId ?? null,
    projectPath: input.projectPath ?? null,
    goal,
    constraints: stringArray(input.constraints),
    nonGoals: stringArray(input.nonGoals),
    acceptanceCriteria,
    workers: {
      primary,
      ...(input.workers?.consultant !== undefined ? { consultant: input.workers.consultant } : {}),
      fallback: input.workers?.fallback ?? null,
      sticky: input.workers?.sticky ?? true,
      consultantMode: input.workers?.consultantMode ?? true
    },
    supervisor: { provider: input.supervisor?.provider ?? "none" },
    capabilities: {
      workspaceRoot: capabilityInput.workspaceRoot ?? defaults.workspaceRoot,
      allowedPaths: stringArray(capabilityInput.allowedPaths),
      forbiddenPaths: capabilityInput.forbiddenPaths ? stringArray(capabilityInput.forbiddenPaths) : defaults.forbiddenPaths,
      allowedCommands: stringArray(capabilityInput.allowedCommands),
      forbiddenCommands: capabilityInput.forbiddenCommands ? stringArray(capabilityInput.forbiddenCommands) : defaults.forbiddenCommands,
      requiresApproval: capabilityInput.requiresApproval ? stringArray(capabilityInput.requiresApproval) : defaults.requiresApproval
    },
    verification: {
      tiers: stringArray(input.verification?.tiers),
      commands: input.verification?.commands ?? {},
      ...(input.verification?.structuredCommands ? { structuredCommands: input.verification.structuredCommands } : {})
    },
    failurePolicy: {
      maxConsecutiveFailures: input.failurePolicy?.maxConsecutiveFailures ?? 3,
      maxAttemptsPerStep: input.failurePolicy?.maxAttemptsPerStep ?? 3
    },
    escalationPolicy: {
      supervisorAfterFailures: input.escalationPolicy?.supervisorAfterFailures ?? 3,
      humanOnUncertainty: input.escalationPolicy?.humanOnUncertainty ?? true
    },
    completion: {
      rule: input.completion?.rule ?? "all automated criteria pass AND all judgment criteria approved",
      requiresHumanApproval: input.completion?.requiresHumanApproval ?? true
    },
    createdAt: context.now,
    updatedAt: context.now
  };
}

/**
 * Order-independent fingerprint of the authoritative fields.
 *
 * Stored alongside the run so that silent drift in goal, constraints, non-goals,
 * acceptance criteria or capabilities is detectable rather than assumed absent.
 * FNV-1a: this is a tamper-evidence check for our own code paths, not a security
 * primitive, and the runtime has no crypto port.
 */
export function authoritativeFingerprint(spec: RunSpec): string {
  const canonical = JSON.stringify({
    ...(spec.workers?.consultant !== undefined ? { workerRoles: { primary: spec.workers.primary, consultant: spec.workers.consultant } } : {}),
    ...(spec.verification?.structuredCommands ? { verification: spec.verification } : {}),
    goal: spec.goal,
    constraints: [...spec.constraints].sort(),
    nonGoals: [...spec.nonGoals].sort(),
    acceptanceCriteria: [...spec.acceptanceCriteria]
      .map((criterion) => ({ id: criterion.id, text: criterion.text, kind: criterion.kind, check: criterion.check ?? null, ...(criterion.checkCommand ? { checkCommand: criterion.checkCommand } : {}) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    capabilities: {
      workspaceRoot: spec.capabilities.workspaceRoot,
      allowedPaths: [...spec.capabilities.allowedPaths].sort(),
      forbiddenPaths: [...spec.capabilities.forbiddenPaths].sort(),
      allowedCommands: [...spec.capabilities.allowedCommands].sort(),
      forbiddenCommands: [...spec.capabilities.forbiddenCommands].sort(),
      requiresApproval: [...spec.capabilities.requiresApproval].sort()
    }
  });

  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}
