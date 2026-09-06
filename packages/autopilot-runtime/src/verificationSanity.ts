// Telling a broken verification command apart from broken code.
//
// The live trial made the need obvious: a misconfigured command
// (`node --test test/` -> MODULE_NOT_FOUND) failed identically every turn and
// burned the entire turn budget, because from inside the loop it is
// indistinguishable from code that will not compile. The worker was being asked
// to repair something it had not broken and could not reach.
//
// Everything here is deterministic string and history analysis. No model is
// consulted, and the bar is deliberately high: a real compiler or test failure
// must stay FAILED so the loop keeps repairing it.

import type { VerificationTierResult } from "./verification.ts";

export const VERIFICATION_CONFIGURATION_ERROR = "verification_configuration_error";

export type VerificationFailureKind = "code" | "configuration";

export interface FailureClassification {
  kind: VerificationFailureKind;
  /** Stable identifier of the rule that decided, for audit and tests. */
  rule: string;
  /** One line an operator can act on. Empty for ordinary code failures. */
  reason: string;
}

const CODE_FAILURE: FailureClassification = { kind: "code", rule: "verification.code-failure", reason: "" };

/** The executable itself could not be started. */
const EXECUTABLE_MISSING = [
  /is not recognized as an internal or external command/i,
  /command not found/i,
  /\bENOENT\b/,
  /spawn\s+\S+\s+ENOENT/i,
  /No such file or directory.*\b(exec|spawn)/i
];

/** A lookup failure, which may point at the command's target OR at the code. */
const LOOKUP_FAILURE = [
  /\bMODULE_NOT_FOUND\b/,
  /Cannot find module\s+['"]?([^'"\s]+)/i,
  /Cannot find package\s+['"]?([^'"\s]+)/i,
  /ERR_MODULE_NOT_FOUND/,
  /no such file or directory,\s*(?:open|stat|scandir)\s+['"]?([^'"\n]+)/i,
  /error TS5058/i,
  // Node 22's test runner for a target that does not exist.
  /Could not find\s+['"][^'"\n]+['"]/i,
  /No test files? found/i,
  /Could not find a tsconfig/i,
  /can't open file\s+['"]?([^'"\n]+)/i
];

/** Evidence that a runner started and actually executed something. */
const EXECUTION_PROGRESS = [
  /^\s*#?\s*tests\s+[1-9]/im,
  /^\s*(ok|not ok)\s+\d+/im,
  /\b\d+\s+(passing|passed|failing|failed)\b/i,
  /Tests:\s+\d+/i,
  /\berror TS\d{4}\b/,
  /^\s*✓|^\s*✗|^\s*×/m,
  /AssertionError/,
  /\bFAIL\b.*\.(test|spec)\./i,
  /\bPASS\b.*\.(test|spec)\./i
];

function matches(patterns: RegExp[], text: string): RegExpExecArray | null {
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) return found;
  }
  return null;
}

/** Path-ish arguments of the command, normalized for comparison. */
function commandTargets(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((token) => !token.startsWith("-"))
    .map((token) => token.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase())
    .filter(Boolean);
}

/**
 * True when a lookup failure names something the verification command itself
 * pointed at, rather than something the project's own code imported.
 *
 * This is the distinction that matters: `Cannot find module './helper'` from a
 * source file is a code bug the worker should fix; the same error naming
 * `test/` — an argument of the command — is a broken command.
 */
function namesCommandTarget(detail: string, command: string): string | null {
  const targets = commandTargets(command);
  if (targets.length === 0) return null;
  const haystack = detail.replace(/\\/g, "/").toLowerCase();

  for (const target of targets) {
    if (!target) continue;
    // Whole-token match so "test" does not match "latest". The trailing class
    // includes "/" because a directory target is often quoted with its slash,
    // as in Node's `Could not find 'does-not-exist/'`.
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[\\s'"\`(\\[/])${escaped}([\\s'"\`)\\]:,/]|$)`).test(haystack)) {
      return target;
    }
  }
  return null;
}

/** Collapses volatile parts so the same failure compares equal across turns. */
export function failureSignature(tier: VerificationTierResult): string {
  const normalized = (tier.detail ?? "")
    .replace(/\r/g, "")
    .replace(/[A-Za-z]:[\\/][^\s'"]*/g, "<path>")
    .replace(/\b\d+(\.\d+)?(ms|s)\b/g, "<duration>")
    .replace(/\b\d{2,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return `${tier.tier}|${tier.exitCode ?? "null"}|${normalized}`;
}

export interface ClassifyInput {
  tier: VerificationTierResult;
  /** Signatures of this tier's failures on previous turns, oldest first. */
  history: string[];
  /** Whether any previous turn showed this tier actually executing work. */
  everMadeProgress: boolean;
  /** How many identical repeats before a stuck tier is called configuration. */
  repeatThreshold?: number;
}

/**
 * Classifies one failing gating tier.
 *
 * Ordering matters. A missing executable is unambiguous. A lookup failure is
 * only configuration when it names the command's own target. Everything else
 * needs both "no execution progress ever" and repetition before it is treated
 * as configuration, so a genuinely failing test suite is never escalated.
 */
export function classifyTierFailure(input: ClassifyInput): FailureClassification {
  const { tier, history, everMadeProgress } = input;
  const repeatThreshold = input.repeatThreshold ?? 2;
  const detail = tier.detail ?? "";

  if (!tier.ran) {
    return {
      kind: "configuration",
      rule: "verification.tier-could-not-run",
      reason: `The "${tier.tier}" command could not be run at all: ${detail.slice(0, 200)}`
    };
  }

  if (matches(EXECUTABLE_MISSING, detail)) {
    return {
      kind: "configuration",
      rule: "verification.executable-missing",
      reason: `The executable for "${tier.tier}" could not be started. Check the command: ${tier.command}`
    };
  }

  const lookup = matches(LOOKUP_FAILURE, detail);
  if (lookup) {
    const target = namesCommandTarget(detail, tier.command);
    if (target) {
      return {
        kind: "configuration",
        rule: "verification.target-missing",
        reason:
          `The "${tier.tier}" command failed looking up "${target}", which is part of the command itself ` +
          `(${tier.command}). The verification target looks wrong, not the code.`
      };
    }
    // A lookup failure inside the project's own code is a real defect: the
    // worker imported something that does not exist. Leave it FAILED.
  }

  const madeProgressNow = EXECUTION_PROGRESS.some((pattern) => pattern.test(detail));

  // A tier that has never once executed anything, failing the same way over and
  // over, is stuck on its own setup rather than on the code.
  const signature = failureSignature(tier);
  const identicalRepeats = history.filter((entry) => entry === signature).length;
  if (!madeProgressNow && !everMadeProgress && identicalRepeats >= repeatThreshold) {
    return {
      kind: "configuration",
      rule: "verification.repeated-without-progress",
      reason:
        `The "${tier.tier}" command has failed identically ${identicalRepeats + 1} times without ever ` +
        `executing a test or build step. The command is probably misconfigured: ${tier.command}`
    };
  }

  return CODE_FAILURE;
}

/** True when this tier result shows the command actually did work. */
export function showedExecutionProgress(tier: VerificationTierResult): boolean {
  return EXECUTION_PROGRESS.some((pattern) => pattern.test(tier.detail ?? ""));
}
