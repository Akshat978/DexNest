// Whether a finished run may finish itself.
//
// THE PROBLEM THIS SOLVES
//
// PLAN_COMPLETE is a proposal, not a completion, because an agent that could
// declare itself finished would be marking its own homework at 3am. That is
// right, and it stays right. But it means an unattended system stops being
// unattended at the last step: work that is built, verified and checkpointed
// sits until someone wakes up, and the operator finds three green runs waiting
// hours for a signature they were always going to give.
//
// WHAT MAKES THIS DIFFERENT FROM TRUSTING THE MODEL
//
// None of the conditions below is the agent's opinion. Every one is a fact
// DexNest recorded itself:
//
//   - the verification outcome is a command's exit code,
//   - plan item statuses are the plan store's rows,
//   - assumptions are what the run wrote down when it guessed.
//
// The agent still cannot declare itself finished. DexNest checks, and the
// agent's claim is not one of the inputs — it is only what starts the check.
//
// WHY EACH CONDITION
//
// A SKIPPED or BLOCKED item is work that did not happen. `settled` is not
// enough: it counts those as settled and its own comment says it never implies
// success. Every item must be DONE.
//
// An assumption is the run saying "I did not know, so I chose" — precisely the
// case where a person should look. One assumption is enough to hold.
//
// An empty plan holds too. A run with no plan judged by one green verification
// is the old trap: a single passing check would end a night that had barely
// started.

import type { PlanItemProgress } from "./plan.ts";

export interface AutoAcceptFacts {
  /** Whether the operator asked for this at all. Off by default. */
  enabled: boolean;
  /** The latest verification outcome. Anything but PASSED holds. */
  verification: string | null;
  /** Every item in the run's plan, with the status the store recorded. */
  planItems: ReadonlyArray<Pick<PlanItemProgress, "status">>;
  /** How many times the run wrote down a guess it had to make. */
  assumptions: number;
}

export interface AutoAcceptVerdict {
  accept: boolean;
  /**
   * Why, in the words the event and the morning view will use.
   *
   * Present whether it accepts or holds, because "it held, and here is the
   * one condition that failed" is the more useful half — an operator who
   * turned this on and still found a run waiting deserves to know which fact
   * stopped it rather than re-deriving it from four screens.
   */
  reason: string;
}

export function canAutoAccept(facts: AutoAcceptFacts): AutoAcceptVerdict {
  if (!facts.enabled) {
    return { accept: false, reason: "Auto-accept is off for this run." };
  }
  if (facts.verification !== "PASSED") {
    return { accept: false, reason: `Verification was ${facts.verification ?? "never run"}, not PASSED.` };
  }
  if (facts.planItems.length === 0) {
    return { accept: false, reason: "This run has no plan, so a green check proves only that one turn passed." };
  }

  const unfinished = facts.planItems.filter(item => item.status !== "DONE");
  if (unfinished.length > 0) {
    const counts = new Map<string, number>();
    for (const item of unfinished) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    const described = [...counts].map(([status, count]) => `${count} ${status.toLowerCase()}`).join(", ");
    return { accept: false, reason: `The plan is not finished: ${described}.` };
  }

  if (facts.assumptions > 0) {
    return {
      accept: false,
      reason: facts.assumptions === 1
        ? "The run recorded an assumption, so a person should read it."
        : `The run recorded ${facts.assumptions} assumptions, so a person should read them.`
    };
  }

  return {
    accept: true,
    reason: `All ${facts.planItems.length} phases are done, verification passed, and nothing was assumed.`
  };
}
