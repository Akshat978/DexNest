// Where a night's usage actually went.
//
// The provider reports what each turn cost, and DexNest has stored it since the
// cost budget existed. It was surfaced nowhere — not in the report, not in the
// UI — so "which phase was expensive" had no answer, and the only evidence
// available was the provider's own dashboard hours later.
//
// That absence matters more than it sounds. The obvious explanation for a run
// eating a subscription is "we send too much context", and DexNest's own prompt
// is about a thousand tokens. The real cost is the conversation: one session is
// resumed across every phase, so each phase re-sends every phase before it, and
// each of those is itself up to thirty model calls. That is quadratic, and it
// is invisible without a per-phase number to look at.
//
// So this measures rather than argues. If the curve is flat, the theory is
// wrong and rotating sessions would buy nothing.
//
// WHAT THE NUMBER IS AND IS NOT
//
// It is `total_cost_usd` as the provider reports it. On a subscription that is
// an API-equivalent figure, not a bill and not a percentage of a plan — it is
// described that way everywhere an operator meets it, because inventing a
// "38% used" from it would be making up the one number nobody gives us.

import type { TurnRecord } from "./loopStore.ts";
import type { IterationRecord } from "./iterations.ts";

export interface TurnCost {
  ordinal: number;
  turnId: string;
  kind: string;
  status: string;
  /** Null when the provider reported nothing for this turn. */
  costUsd: number | null;
  /** Cost of every turn up to and including this one. */
  cumulativeUsd: number;
  /** DexNest's own prompt, for comparison with what the turn actually cost. */
  promptChars: number;
}

export interface PhaseCost {
  ordinal: number;
  status: string;
  summary: string | null;
  turns: number;
  costUsd: number | null;
}

export interface UsageReport {
  /** Total across every turn that reported one. */
  totalUsd: number;
  /** Turns whose cost the provider never reported; totals exclude them. */
  unreportedTurns: number;
  turns: TurnCost[];
  phases: PhaseCost[];
  /**
   * How much dearer the last turn was than the first, when both reported.
   *
   * The single number that answers the question this exists for: a run whose
   * cost per turn climbs is paying for its own history, and one whose cost is
   * flat is not.
   */
  growth: { first: number; last: number; ratio: number } | null;
}

const sum = (values: Array<number | null>): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

/**
 * What each turn cost, what each phase cost, and whether it is getting worse.
 *
 * Derived from rows every time, like every other counter in the runtime. A
 * stored total is a total that can drift.
 */
export function buildUsageReport(input: {
  turns: readonly TurnRecord[];
  iterations: readonly IterationRecord[];
}): UsageReport {
  let running = 0;
  const turns: TurnCost[] = input.turns.map(turn => {
    running += turn.costUsd ?? 0;
    return {
      ordinal: turn.ordinal,
      turnId: turn.id,
      kind: turn.kind,
      status: turn.status,
      costUsd: turn.costUsd,
      cumulativeUsd: running,
      promptChars: turn.prompt.length
    };
  });

  // A phase is an iteration, and an iteration spans its repairs — so its cost
  // is every turn from the one that opened it up to the next iteration's.
  // Attributing only the opening turn would make a phase that needed three
  // attempts look as cheap as one that worked first time.
  const byTurnId = new Map(input.turns.map(turn => [turn.id, turn]));
  const ordered = [...input.iterations].sort((left, right) => left.ordinal - right.ordinal);
  const phases: PhaseCost[] = ordered.map((iteration, index) => {
    const from = iteration.turnId ? byTurnId.get(iteration.turnId)?.ordinal ?? null : null;
    const nextStart = ordered
      .slice(index + 1)
      .map(entry => (entry.turnId ? byTurnId.get(entry.turnId)?.ordinal ?? null : null))
      .find((value): value is number => value !== null) ?? Number.POSITIVE_INFINITY;
    const owned = from === null
      ? []
      : input.turns.filter(turn => turn.ordinal >= from && turn.ordinal < nextStart);
    const reported = owned.filter(turn => turn.costUsd !== null);
    return {
      ordinal: iteration.ordinal,
      status: iteration.status,
      summary: iteration.summary,
      turns: owned.length,
      costUsd: reported.length > 0 ? sum(reported.map(turn => turn.costUsd)) : null
    };
  });

  const reported = turns.filter(turn => turn.costUsd !== null && turn.costUsd > 0);
  const first = reported[0]?.costUsd ?? null;
  const last = reported.at(-1)?.costUsd ?? null;

  return {
    totalUsd: running,
    unreportedTurns: turns.filter(turn => turn.costUsd === null).length,
    turns,
    phases,
    growth: first !== null && last !== null && reported.length > 1
      ? { first, last, ratio: last / first }
      : null
  };
}

/** Plain text, for a report an operator reads rather than parses. */
export function renderUsageReport(usage: UsageReport): string {
  if (usage.turns.length === 0) return "No turns yet, so nothing has been spent.";

  const lines = [
    `${usage.totalUsd.toFixed(2)} spent across ${usage.turns.length} turn(s), as the provider reports it.`,
    "On a subscription that figure is a usage proxy, not a bill."
  ];
  if (usage.unreportedTurns > 0) {
    lines.push(`${usage.unreportedTurns} turn(s) reported no cost and are not counted.`);
  }
  if (usage.growth) {
    const { first, last, ratio } = usage.growth;
    lines.push(
      "",
      ratio >= 1.5
        ? `The last turn cost ${ratio.toFixed(1)}x the first (${first.toFixed(2)} then ${last.toFixed(2)}). A run whose turns get dearer is paying for its own history.`
        : `Cost per turn stayed roughly level (${first.toFixed(2)} then ${last.toFixed(2)}).`
    );
  }
  return lines.join("\n");
}
