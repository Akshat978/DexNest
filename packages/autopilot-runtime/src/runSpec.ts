// The Run Spec: the authoritative, human-owned definition of a run.
//
// Nothing the runtime, a worker or a supervisor produces may mutate the
// authoritative fields. They are frozen into the run record at creation time and
// carry a content hash so drift is detectable. Later phases add explicit,
// human-approved revisions; Phase 1 implements the identity and versioning that
// makes those revisions possible.

export const RUN_SPEC_SCHEMA_VERSION = 1;

export type AcceptanceCriterionKind = "automated" | "judgment";

/**
 * One item of the plan the human hands to Autopilot.
 *
 * The plan is the output of work that happens OUTSIDE DexNest: the human
 * brainstorms and designs with an agent or a chat, and what comes back is an
 * ordered list of things to build. DexNest never authors it and no agent may
 * rewrite it, which is why it lives in the Run Spec and is fingerprinted with
 * the other authoritative fields.
 *
 * Progress against an item is deliberately NOT stored here. Content is
 * human-owned and immutable; status is runtime state and belongs in
 * autopilot_plan_items.
 */
export interface PlanItem {
  id: string;
  ordinal: number;
  title: string;
  /** Body text under the heading. Empty when the item is a bare title. */
  detail: string;
}

/** Bounds. A plan is a work list, not a document store. */
export const MAX_PLAN_ITEMS = 200;
export const MAX_PLAN_ITEM_DETAIL_CHARS = 8_000;

/**
 * Where a run does its work.
 *
 * "worktree" is the original model: a disposable checkout outside the project,
 * so the project is never touched and abandoning a run is a directory removal.
 *
 * "project-branch" works in the project itself, on a dedicated branch. The
 * operator sees results in their own working copy without merging, which is the
 * point, but the safety properties are genuinely weaker: there is no separate
 * copy to throw away, so reversibility rests entirely on the branch and its
 * per-iteration checkpoint commits.
 *
 * It changes the blast radius of a run, so it is authoritative: an agent cannot
 * move a run into the project by editing its own configuration.
 */
export type WorkspaceMode = "worktree" | "project-branch";

/**
 * Whether the worker gets its real tools. See WorkerCapabilityProfile in
 * worker.ts for what each profile actually means and gives up.
 *
 * Authoritative, because it decides whether DexNest evaluates every individual
 * file write or none of them. An agent must not be able to grant itself tools.
 */
export type WorkerProfile = "mediated" | "agentic";

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
  /** Ordered work items. Empty for runs driven by the goal alone. */
  plan: PlanItem[];
  /** Where the run works. Defaults to the isolated worktree. */
  workspaceMode: WorkspaceMode;
  /** Whether the worker has tools. Defaults to the fully mediated worker. */
  workerProfile: WorkerProfile;
  /**
   * Model and effort for the worker. Deliberately NOT authoritative: they
   * change what a turn costs and how well it thinks, never what it is
   * allowed to touch, so they are configuration rather than a promise the
   * fingerprint has to protect.
   */
  model: string | null;
  effort: string | null;

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
  "plan",
  "workerProfile",
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

/**
 * Turns a written plan into ordered items.
 *
 * Accepts what a human actually pastes: markdown headings, "Phase 3 - title",
 * or a numbered list. Text before the first heading is returned separately as
 * preamble rather than silently dropped or silently promoted to an item — the
 * caller decides whether that context belongs in the goal.
 */
export function parsePlanText(text: string): { items: PlanItem[]; preamble: string } {
  const heading = (line: string): string | null => {
    // Strip wrapping emphasis first: people write "**Phase 2 — Worker**" as a
    // heading, and a title is no less a title for being bold.
    const unwrap = (value: string) => value.replace(/^\*{1,3}(.*?)\*{1,3}$/, "$1").trim();
    const bare = unwrap(line.trim());
    const markdown = /^#{1,6}\s+(.+?)\s*$/.exec(bare);
    if (markdown) return unwrap(markdown[1]!);
    // Markup is stripped; prose the human wrote is kept, so a "Phase 2" label
    // survives in the title exactly as it does inside a markdown heading.
    if (/^(?:phase|step|milestone|stage)\s+\d{1,3}\b/i.test(bare)) return bare;
    const numbered = /^\d{1,3}[.)]\s+(.+?)\s*$/.exec(bare);
    if (numbered) return numbered[1]!;
    return null;
  };

  const items: PlanItem[] = [];
  const bodies: string[][] = [];
  const preamble: string[] = [];

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const title = heading(line);
    if (title !== null) {
      items.push({ id: `plan-${items.length + 1}`, ordinal: items.length + 1, title, detail: "" });
      bodies.push([]);
      continue;
    }
    // Lines before the first heading are preamble, not part of any item.
    (bodies.at(-1) ?? preamble).push(line);
  }

  for (const [index, item] of items.entries()) item.detail = (bodies[index] ?? []).join("\n").trim();

  // A real PLAN.md usually opens with a document title — "# Plan: ..." —
  // above the first phase. A title is a heading, but it is not work: left in,
  // it becomes item 1, and the run's first assignment is to "do" the title of
  // the document. So when the plan contains explicitly numbered work, leading
  // items that are not numbered work are folded into the preamble, detail and
  // all. Only leading ones: a closing "Wrap-up" item someone wrote after the
  // phases is still theirs.
  const work = /^(?:phase|step|milestone|stage)\s+\d{1,3}\b/i;
  if (items.some(item => work.test(item.title))) {
    while (items.length > 0 && !work.test(items[0]!.title)) {
      const dropped = items.shift()!;
      preamble.push(dropped.title, dropped.detail);
    }
    for (const [index, item] of items.entries()) {
      item.id = `plan-${index + 1}`;
      item.ordinal = index + 1;
    }
  }

  return { items, preamble: preamble.filter(line => line.trim()).join("\n").trim() };
}

/** Normalizes plan input, recording problems rather than repairing them. */
function normalizePlan(value: unknown, issues: string[]): PlanItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push("plan must be an array of items");
    return [];
  }
  if (value.length > MAX_PLAN_ITEMS) issues.push(`plan has ${value.length} items; the maximum is ${MAX_PLAN_ITEMS}`);

  const seen = new Set<string>();
  return value.slice(0, MAX_PLAN_ITEMS).map((raw, index) => {
    const source = (raw ?? {}) as Partial<PlanItem>;
    const title = typeof source.title === "string" ? source.title.trim() : "";
    if (!title) issues.push(`plan[${index}].title is required`);
    const detail = typeof source.detail === "string" ? source.detail.trim() : "";
    if (detail.length > MAX_PLAN_ITEM_DETAIL_CHARS) {
      issues.push(`plan[${index}].detail exceeds ${MAX_PLAN_ITEM_DETAIL_CHARS} characters`);
    }
    const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : `plan-${index + 1}`;
    if (seen.has(id)) issues.push(`duplicate plan item id "${id}"`);
    seen.add(id);
    // Ordinal is positional and never taken from input: list order IS the plan.
    return { id, ordinal: index + 1, title, detail };
  });
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

  const plan = normalizePlan(input.plan, issues);

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
    plan,
    workspaceMode: input.workspaceMode === "project-branch" ? "project-branch" : "worktree",
    workerProfile: input.workerProfile === "agentic" ? "agentic" : "mediated",
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : null,
    effort: ["low", "medium", "high", "xhigh", "max"].includes(String(input.effort)) ? String(input.effort) : null,
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
    // Conditional so runs created before plans existed keep the fingerprint
    // they were stored with. Same for the workspace mode: "worktree" was the
    // only behaviour, so it must hash as the absence of a choice.
    ...(spec.plan?.length
      ? { plan: spec.plan.map((item) => ({ id: item.id, ordinal: item.ordinal, title: item.title, detail: item.detail })) }
      : {}),
    ...(spec.workspaceMode && spec.workspaceMode !== "worktree" ? { workspaceMode: spec.workspaceMode } : {}),
    ...(spec.workerProfile && spec.workerProfile !== "mediated" ? { workerProfile: spec.workerProfile } : {}),
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
