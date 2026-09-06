// What is true in the morning.
//
// Written for someone who has been asleep, so it answers the questions they
// actually have, in the order they have them: did anything get done, what did
// it decide without me, why did it stop, and where do I look.
//
// It is deliberately short and it is not a transcript. The conversation lives
// in the agent's own session and is better read there; this says whether it is
// worth reading.

import type { IterationRecord } from "./iterations.ts";
import type { AssumptionRecord, ResumePlan } from "./unattended.ts";
import type { DirectionSource } from "./direction.ts";
import type { LoopStopReason } from "./loop.ts";
import { renderWhereToWatch } from "./iterations.ts";

/** What actually needs to happen next, if anything. */
export type MorningAction = "nothing" | "review" | "resume" | "decide" | "sign_in" | "waiting";

export interface MorningSummary {
  headline: string;
  action: MorningAction;
  detail: string;
  iterationsDone: number;
  iterationsAttempted: number;
  checkpoints: number;
  assumptions: string[];
  whereToWatch: string;
}

/** Plain sentences, because a stop reason is not an explanation. */
const OUTCOMES: Record<LoopStopReason, { headline: string; action: MorningAction; detail: string }> = {
  completed: { headline: "Finished.", action: "review", detail: "Verification passed and the run completed." },
  plan_complete_proposed: {
    headline: "It believes the work is done.",
    action: "decide",
    detail: "Verification passed and the agent proposed that the plan is complete. It did not finish the run itself — accept it to finish the run, or reject it and say what is still missing, which becomes the instruction for the next turn."
  },
  direction_needs_human: { headline: "It needs a decision from you.", action: "decide", detail: "The run stopped and asked for a person." },
  provider_limit: { headline: "It ran out of capacity.", action: "waiting", detail: "The subscription limit was reached, or a login went stale." },
  iteration_limit: { headline: "It used everything you authorized.", action: "resume", detail: "Every authorized piece of work was spent. Authorize more to continue." },
  time_limit: { headline: "It stopped at the time you set.", action: "review", detail: "The run reached its stop time. Whatever had started was finished first, so nothing is half-done." },
  cost_limit: { headline: "It reached the spend you allowed.", action: "review", detail: "The run stopped on its cost budget." },
  no_progress: { headline: "It stopped getting anywhere.", action: "review", detail: "Nothing passed verification for several turns in a row, so it stopped rather than keep spending." },
  turn_limit: { headline: "It hit the turn ceiling.", action: "resume", detail: "The safety limit on provider calls was reached." },
  consecutive_failures: { headline: "It could not get the checks passing.", action: "review", detail: "Verification failed repeatedly and the run stopped rather than keep trying." },
  verification_indeterminate: { headline: "The checks were inconclusive.", action: "review", detail: "Verification could not decide, so nothing was recorded as done." },
  worker_uncertain: { headline: "One send could not be accounted for.", action: "decide", detail: "A send was interrupted and DexNest cannot tell whether it arrived. It will not guess." },
  worker_failed: { headline: "The agent failed.", action: "review", detail: "A turn failed in a way that waiting will not fix." },
  primary_blocked: { headline: "The agent is blocked.", action: "review", detail: "It stopped making progress." },
  consultant_recommended: { headline: "The agent is blocked.", action: "review", detail: "It stopped making progress, and a second opinion may help." },
  grant_closed: { headline: "The authorization was withdrawn.", action: "resume", detail: "The run stopped because its authorization ended." },
  paused: { headline: "Paused.", action: "resume", detail: "The run was paused." },
  stopped: { headline: "Stopped.", action: "nothing", detail: "The run was stopped." }
};

export function buildMorningSummary(input: {
  reason: LoopStopReason;
  detail: string;
  iterations: IterationRecord[];
  checkpoints: number;
  assumptions: AssumptionRecord[];
  directionSource: DirectionSource;
  resume: ResumePlan | null;
  provider: string;
  sessionId: string | null;
  cwd: string | null;
}): MorningSummary {
  const outcome = OUTCOMES[input.reason];
  const done = input.iterations.filter((entry) => entry.status === "VERIFIED").length;

  let action = outcome.action;
  let detail = outcome.detail;

  if (input.reason === "provider_limit") {
    // A limit that is still being waited out needs nothing from the operator.
    // One that has given up does.
    if (input.resume && !input.resume.exhausted) {
      detail = `${detail} It is waiting and will try again after ${input.resume.notBefore}.`;
    } else {
      action = /logged in|sign in/i.test(input.detail) ? "sign_in" : "resume";
      detail = `${detail} It waited and the limit did not clear, so it stopped.`;
    }
  }

  return {
    headline: outcome.headline,
    action,
    detail,
    iterationsDone: done,
    iterationsAttempted: input.iterations.length,
    checkpoints: input.checkpoints,
    assumptions: input.assumptions.map((entry) => entry.text),
    whereToWatch: renderWhereToWatch({
      provider: input.provider, sessionId: input.sessionId, cwd: input.cwd, runActive: false
    })
  };
}

/** The whole of what DexNest shows you before you open the conversation. */
export function renderMorningSummary(summary: MorningSummary): string {
  const lines = [summary.headline, "", summary.detail, ""];

  lines.push(
    summary.iterationsDone === summary.iterationsAttempted
      ? `${summary.iterationsDone} piece(s) of work completed, each committed as a checkpoint.`
      : `${summary.iterationsDone} of ${summary.iterationsAttempted} piece(s) of work completed; ${summary.checkpoints} checkpoint(s).`
  );

  if (summary.assumptions.length > 0) {
    lines.push(
      "",
      `It decided ${summary.assumptions.length} thing(s) on its own rather than stopping to ask:`,
      ...summary.assumptions.map((text, index) => `  ${index + 1}. ${text}`)
    );
  }

  const next: Record<MorningAction, string> = {
    nothing: "Nothing to do.",
    review: "Read what happened, then decide whether to continue.",
    resume: "Authorize more work to continue.",
    decide: "It needs an answer from you before it goes further.",
    sign_in: "Sign in to the provider, then resume.",
    waiting: "Nothing to do; it will pick itself back up."
  };
  lines.push("", `NEXT: ${next[summary.action]}`, "", summary.whereToWatch);
  return lines.join("\n");
}
