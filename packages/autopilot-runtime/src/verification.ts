// Deterministic mechanical verification.
//
// This is the "did it actually work" half of the loop. It runs only commands the
// Run Spec configured, in a fixed cheapest-first order, through the effects
// gateway — so every verification command passes capability policy exactly like
// any other effect. No model is consulted, and nothing here decides completion
// on narration.
//
// Deliberately NOT included in this slice: browser, screenshots, visual QA,
// judgment criteria. A judgment criterion makes the outcome INDETERMINATE, which
// holds the run for a human rather than inventing success.

import type { RunSpec } from "./runSpec.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { EffectsGateway } from "./effects.ts";
import type { RuntimePorts } from "./ports.ts";
import type { Intent } from "./intent.ts";
import {
  VERIFICATION_CONFIGURATION_ERROR,
  classifyTierFailure,
  failureSignature,
  showedExecutionProgress,
  type FailureClassification
} from "./verificationSanity.ts";

export type VerificationOutcome = "PASSED" | "FAILED" | "INDETERMINATE";

export interface VerificationTierResult {
  tier: string;
  command: string;
  /** false when the tier could not be run at all (policy denied, not configured). */
  ran: boolean;
  ok: boolean;
  exitCode: number | null;
  /** Truncated evidence. Never the full transcript. */
  detail: string;
  /** Informational tiers report evidence without deciding pass/fail. */
  gating: boolean;
}

export interface VerificationReport {
  outcome: VerificationOutcome;
  summary: string;
  tiers: VerificationTierResult[];
  /** Set when the failure looks like a broken command rather than broken code. */
  configurationError: (FailureClassification & { tier: string; command: string }) | null;
  /** The first gating tier that failed, if any. */
  failingTier: VerificationTierResult | null;
  /** Why completion could not be decided mechanically. */
  indeterminateReason: string | null;
  changedFiles: number;
}

/** Cheapest and most deterministic first; stop at the first gating failure. */
export const VERIFICATION_TIER_ORDER = ["typecheck", "lint", "test", "integration", "build"] as const;

const MAX_DETAIL = 2000;

function truncate(value: string, limit = MAX_DETAIL): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  // Keep the tail: compiler and test failures are at the end of the output.
  return `…(truncated)\n${trimmed.slice(trimmed.length - limit)}`;
}

/**
 * Splits a configured command into an executable and arguments.
 *
 * No shell is involved anywhere in Autopilot, so a configured command cannot use
 * pipes, redirects, `&&` or variable expansion. That is a real limitation and a
 * deliberate one: a shell turns arguments into an opaque program that command
 * policy cannot inspect.
 */
export function parseCommand(command: string): { executable: string; args: string[] } | null {
  const parts = String(command ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (/[|&><;`$]/.test(command)) return null;
  return { executable: parts[0]!, args: parts.slice(1) };
}

export interface VerifierOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
  windows?: boolean;
}

export class Verifier {
  private readonly ports: RuntimePorts;
  private readonly effects: EffectsGateway;
  private readonly policy: CapabilityPolicy;

  constructor(options: VerifierOptions) {
    this.ports = options.ports;
    this.effects = options.effects;
    this.policy = options.policy;
  }

  private async runIntent(runId: string, stepKey: string, intent: Intent): Promise<{ ok: boolean; exitCode: number | null; detail: string; ran: boolean }> {
    const outcome = await this.effects.request({ runId, stepKey, policy: this.policy, intent });
    if (!("result" in outcome)) {
      // Denied or gated: the tier did not run, which is not the same as failing.
      const reason = outcome.status === "DENIED" ? outcome.decision.reason : "awaiting approval";
      return { ok: false, ran: false, exitCode: null, detail: `Verification command was not permitted: ${reason}` };
    }
    const result = outcome.result;
    return {
      ok: result.ok,
      ran: true,
      exitCode: result.exitCode,
      detail: truncate(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    };
  }

  /**
   * Runs the configured tiers plus every automated acceptance criterion.
   *
   * Outcome rules:
   *   FAILED        — a gating tier or automated criterion failed.
   *   INDETERMINATE — nothing failed, but completion cannot be established
   *                   mechanically (a judgment criterion, a criterion with no
   *                   check, no configured verification at all, or a tier that
   *                   policy would not permit).
   *   PASSED        — every gating tier and every acceptance criterion passed,
   *                   and all criteria are automated.
   */
  async verify(input: {
    runId: string;
    spec: RunSpec;
    workspaceRoot: string;
    /** Prior reports, oldest first, used only for repeat detection. */
    history?: VerificationReport[];
  }): Promise<VerificationReport> {
    const { runId, spec, workspaceRoot } = input;
    const history = input.history ?? [];
    const tiers: VerificationTierResult[] = [];

    this.ports.logger.log("info", "Autopilot verification started", { runId });

    // Informational: what the worker actually changed.
    let changedFiles = 0;
    const status = await this.runIntent(runId, this.ports.ids.next("verify-diff"), {
      kind: "GIT_OPERATION",
      operation: "status",
      args: ["--porcelain"],
      cwd: workspaceRoot,
      purpose: "verification: inspect working tree"
    });
    if (status.ran) {
      changedFiles = status.detail.split("\n").map((line) => line.trim()).filter(Boolean).length;
    }
    tiers.push({
      tier: "diff",
      command: "git status --porcelain",
      ran: status.ran,
      ok: status.ran,
      exitCode: status.exitCode,
      detail: status.ran ? `${changedFiles} changed path(s)` : status.detail,
      gating: false
    });

    let indeterminateReason: string | null = null;
    let failingTier: VerificationTierResult | null = null;

    const configured = VERIFICATION_TIER_ORDER.filter((tier) => Boolean(spec.verification.commands[tier] || spec.verification.structuredCommands?.[tier]));

    for (const tier of configured) {
      const structured = spec.verification.structuredCommands?.[tier];
      const command = structured ? [structured.executable, ...structured.args].join(" ") : spec.verification.commands[tier]!;
      const parsed = structured ?? parseCommand(command);
      if (!parsed) {
        const result: VerificationTierResult = {
          tier,
          command,
          ran: false,
          ok: false,
          exitCode: null,
          detail: "Command could not be parsed without a shell. Configure a plain executable and arguments.",
          gating: true
        };
        tiers.push(result);
        indeterminateReason ??= `Verification tier "${tier}" is not runnable without a shell.`;
        continue;
      }

      const outcome = await this.runIntent(runId, this.ports.ids.next(`verify-${tier}`), {
        kind: "RUN_COMMAND",
        executable: parsed.executable,
        args: parsed.args,
        cwd: workspaceRoot,
        purpose: `verification: ${tier}`
      });

      const result: VerificationTierResult = { tier, command, ran: outcome.ran, ok: outcome.ok, exitCode: outcome.exitCode, detail: outcome.detail, gating: true };
      tiers.push(result);

      if (!outcome.ran) {
        indeterminateReason ??= `Verification tier "${tier}" could not run: ${outcome.detail}`;
        continue;
      }
      if (!outcome.ok) {
        failingTier = result;
        // Stop at the first gating failure: later tiers add cost, not information.
        break;
      }
    }

    // Acceptance criteria are the actual definition of done.
    if (!failingTier) {
      for (const criterion of spec.acceptanceCriteria) {
        if (criterion.kind === "judgment") {
          indeterminateReason ??= `Acceptance criterion "${criterion.id}" needs human judgment and cannot be decided mechanically.`;
          continue;
        }
        const parsed = criterion.checkCommand ?? (criterion.check ? parseCommand(criterion.check) : null);
        if (!parsed) {
          indeterminateReason ??= `Acceptance criterion "${criterion.id}" has no runnable check.`;
          continue;
        }
        const outcome = await this.runIntent(runId, this.ports.ids.next(`verify-ac-${criterion.id}`), {
          kind: "RUN_COMMAND",
          executable: parsed.executable,
          args: parsed.args,
          cwd: workspaceRoot,
          purpose: `verification: acceptance criterion ${criterion.id}`
        });
        const result: VerificationTierResult = {
          tier: `acceptance:${criterion.id}`,
          command: criterion.checkCommand ? [criterion.checkCommand.executable, ...criterion.checkCommand.args].join(" ") : criterion.check!,
          ran: outcome.ran,
          ok: outcome.ok,
          exitCode: outcome.exitCode,
          detail: outcome.detail,
          gating: true
        };
        tiers.push(result);
        if (!outcome.ran) {
          indeterminateReason ??= `Acceptance criterion "${criterion.id}" could not run.`;
          continue;
        }
        if (!outcome.ok) {
          failingTier = result;
          break;
        }
      }
    }

    if (spec.acceptanceCriteria.length === 0) {
      indeterminateReason ??= "The Run Spec declares no acceptance criteria, so completion cannot be established mechanically.";
    }
    if (configured.length === 0 && spec.acceptanceCriteria.length === 0) {
      indeterminateReason ??= "No verification commands and no acceptance criteria are configured.";
    }

    // Is this broken code, or a broken verification command? The worker can
    // only repair the first, so escalating the second is what stops the loop
    // spending its whole budget on something it cannot reach.
    let configurationError: VerificationReport["configurationError"] = null;
    if (failingTier) {
      const priorSignatures: string[] = [];
      let everMadeProgress = false;
      for (const report of history) {
        const previous = report.tiers.find((entry) => entry.tier === failingTier.tier);
        if (!previous) continue;
        if (!previous.ok) priorSignatures.push(failureSignature(previous));
        if (showedExecutionProgress(previous)) everMadeProgress = true;
      }

      const classification = classifyTierFailure({
        tier: failingTier,
        history: priorSignatures,
        everMadeProgress
      });
      if (classification.kind === "configuration") {
        configurationError = { ...classification, tier: failingTier.tier, command: failingTier.command };
        indeterminateReason = `${VERIFICATION_CONFIGURATION_ERROR}: ${classification.reason}`;
      }
    }

    // A configuration error is not a code failure: it holds for a human rather
    // than being handed back to the worker as something to fix.
    const outcome: VerificationOutcome = configurationError
      ? "INDETERMINATE"
      : failingTier
        ? "FAILED"
        : indeterminateReason
          ? "INDETERMINATE"
          : "PASSED";

    const summary = configurationError
      ? `${VERIFICATION_CONFIGURATION_ERROR} in "${configurationError.tier}": ${configurationError.reason}`
      : failingTier
        ? `${failingTier.tier} failed (exit ${failingTier.exitCode ?? "n/a"})`
        : indeterminateReason
          ? `Verification inconclusive: ${indeterminateReason}`
          : `All ${tiers.filter((tier) => tier.gating).length} gating check(s) passed`;

    return {
      outcome,
      summary,
      tiers,
      failingTier,
      configurationError,
      indeterminateReason: indeterminateReason ?? null,
      changedFiles
    };
  }
}

/**
 * Builds the next turn's prompt from verification evidence.
 *
 * Deterministic and template-based: this is not a planner and no model authors
 * it. The worker receives exactly what failed and the tail of its output.
 */
export function repairPrompt(report: VerificationReport, spec: RunSpec, context?: string): string {
  const failing = report.failingTier;
  const lines: string[] = [];

  lines.push("The previous change did not pass verification. Fix it.");
  lines.push("");
  if (failing) {
    lines.push(`Failing check: ${failing.tier}`);
    lines.push(`Command: ${failing.command}`);
    lines.push(`Exit code: ${failing.exitCode ?? "unknown"}`);
    lines.push("");
    lines.push("Output:");
    lines.push(failing.detail || "(no output captured)");
  } else {
    lines.push(`Verification could not be completed: ${report.indeterminateReason ?? "unknown reason"}`);
  }
  lines.push("");
  lines.push(`Changed paths in the workspace: ${report.changedFiles}`);
  if (spec.constraints.length > 0) {
    lines.push("");
    lines.push("Constraints that still apply:");
    for (const constraint of spec.constraints) lines.push(`- ${constraint}`);
  }
  lines.push("");
  lines.push("Make the smallest change that fixes this. Do not change the goal or the acceptance criteria.");
  if (context) {
    lines.push("");
    lines.push(context);
  }

  return lines.join("\n");
}

/** The opening prompt. Derived only from the human-owned Run Spec. */
export function initialPrompt(spec: RunSpec, context?: string): string {
  const lines: string[] = [];
  lines.push("Goal:");
  lines.push(spec.goal);

  if (spec.constraints.length > 0) {
    lines.push("");
    lines.push("Hard constraints:");
    for (const constraint of spec.constraints) lines.push(`- ${constraint}`);
  }
  if (spec.nonGoals.length > 0) {
    lines.push("");
    lines.push("Explicitly out of scope:");
    for (const nonGoal of spec.nonGoals) lines.push(`- ${nonGoal}`);
  }
  if (spec.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("Acceptance criteria:");
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- [${criterion.kind}] ${criterion.text}${criterion.check ? ` (checked by: ${criterion.check})` : ""}`);
    }
  }
  lines.push("");
  lines.push("Work only inside the current working directory. Make the change; verification runs automatically afterwards.");
  if (context) {
    lines.push("");
    lines.push(context);
  }

  return lines.join("\n");
}
