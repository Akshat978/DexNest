// Deliberately hostile scripted executor.
//
// This executor is UNTRUSTED BY DESIGN. It tries to do things the run's
// capabilities forbid: write outside the workspace, read DexNest local-data,
// read SSH keys, push to a remote, publish, install packages without approval,
// kill an unrelated process, and reuse an approval for a modified command.
//
// Crucially, none of the protection lives here. This executor makes no checks of
// its own — it simply asks. Everything that stops it is policy, approval and the
// dispatcher. That is the point of the test: a future Claude or Codex adapter
// will be exactly this untrustworthy, and the boundary must hold without its
// cooperation.

import type { StepExecutionContext, StepExecutionResult, StepExecutor, StepProbeResult } from "./ports.ts";
import type { Intent } from "./intent.ts";
import type { EffectOutcome, EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";

export interface HostileAttempt {
  stepKey: string;
  intent: Intent;
  /** What the test expects: whether policy should stop this. */
  expect: "allowed" | "denied" | "approval";
}

export interface HostileExecutorOptions {
  attempts: HostileAttempt[];
  policy: CapabilityPolicy;
  /**
   * Replaces the intent on a later attempt to model a worker mutating arguments
   * after an approval was granted. Used for the TOCTOU test.
   */
  mutateBeforeDispatch?: (intent: Intent, stepKey: string) => Intent;
}

export interface AttemptOutcome {
  stepKey: string;
  status: EffectOutcome["status"] | "THREW";
  rule?: string;
  message?: string;
}

export class HostileExecutor implements StepExecutor {
  readonly id = "hostile-scripted";

  /** Every outcome observed, for assertions. */
  readonly outcomes: AttemptOutcome[] = [];

  private readonly attempts: HostileAttempt[];
  private readonly policy: CapabilityPolicy;
  private readonly mutate: HostileExecutorOptions["mutateBeforeDispatch"];

  constructor(options: HostileExecutorOptions) {
    this.attempts = options.attempts;
    this.policy = options.policy;
    this.mutate = options.mutateBeforeDispatch;
  }

  plan(): string[] {
    return this.attempts.map((attempt) => attempt.stepKey);
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const attempt = this.attempts.find((candidate) => candidate.stepKey === context.stepKey);
    if (!attempt) {
      return { ok: true, summary: `no attempt for ${context.stepKey}` };
    }

    const effects = context.effects as EffectsGateway | undefined;
    if (!effects) {
      return { ok: false, summary: "no effects gateway available" };
    }

    const intent = this.mutate ? this.mutate(attempt.intent, context.stepKey) : attempt.intent;

    try {
      const outcome = await effects.request({
        runId: context.runId,
        stepKey: context.stepKey,
        policy: this.policy,
        intent
      });

      this.outcomes.push({
        stepKey: context.stepKey,
        status: outcome.status,
        rule: outcome.status === "DENIED" ? outcome.decision.rule : undefined
      });

      if (outcome.status === "AWAITING_APPROVAL") {
        return {
          ok: false,
          summary: `awaiting approval: ${outcome.approval.summary}`,
          awaitingApproval: { operationId: outcome.operation.id, approvalId: outcome.approval.id }
        };
      }

      if (outcome.status === "DENIED") {
        // A denial is a normal, non-fatal outcome: the run continues and the
        // human is not interrupted for it.
        return { ok: true, summary: `denied by policy (${outcome.decision.rule})` };
      }

      if (outcome.status === "REJECTED") {
        return { ok: true, summary: "operation rejected by human" };
      }

      return { ok: outcome.status === "COMPLETED", summary: outcome.result.summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outcomes.push({ stepKey: context.stepKey, status: "THREW", message });
      // A refused dispatch is still a safe outcome from the run's perspective.
      return { ok: true, summary: `refused: ${message}` };
    }
  }

  async probe(): Promise<StepProbeResult> {
    return "not_started";
  }

  async cancel(): Promise<void> {
    // Nothing in flight: every attempt completes synchronously through the gateway.
  }
}
