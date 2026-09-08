// Writing the plan, instead of pasting one in.
//
// The manual workflow this replaces: open a separate chat, describe the
// project, ask for a phase plan, copy the markdown back into New Run. The
// prompt below is that conversation, written once and kept, so the plan is
// produced by the same machinery that runs it.
//
// WHY THIS IS NOT A WORKER TURN
//
// It never sees the repository and gets no tools — exactly the director's
// posture, for the same reason. A drafter that could read the project would be
// a worker, and would want a workspace, a policy widened to reach it, and a
// checkpoint to undo what it did. It proposes; nothing here writes anything but
// text.
//
// It still goes through the effects gateway against a real run: intent,
// policy, journal. A draft is a provider send like any other, and one that
// slipped past that path would be a send nobody could account for.
//
// WHAT COMES BACK IS A DRAFT, NOT A PLAN
//
// The result is handed to the operator to edit, never started from directly.
// A model asked to break work into phases will confidently produce phases for
// work it has not seen, and the person who chose the goal is the only one who
// can tell which of them are real.

import type { EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { RuntimePorts } from "./ports.ts";
import type { WorkerProtocol } from "./worker.ts";
import type { CodingProvider } from "./roles.ts";
import type { RunSpec } from "./runSpec.ts";
import { parsePlanText } from "./runSpec.ts";
import { AutopilotStore } from "./store.ts";

/**
 * How long a phase should be.
 *
 * Not "one file" or "one function" — those are units of code, and a phase is a
 * unit of *attention*. The operator's rule, and it is the difference between a
 * plan that runs overnight and one that stalls: too large and the worker drops
 * half of it silently, too small and twenty phases each pay the cost of a
 * fresh session for ten minutes of work.
 */
export const PHASE_SIZING_RULE =
  "Size each phase to what one focused agent session can finish and verify: "
  + "large enough to be worth a session, small enough that nothing gets dropped. "
  + "Do not split by file or by function.";

export interface PlanDraft {
  /** The markdown, ready to be edited. Empty when nothing usable came back. */
  text: string;
  /** Parsed the way the run will parse it, so the count is the real one. */
  phases: number;
  /** Present when the provider could not be asked or did not answer. */
  problem: string | null;
}

export function planDraftPrompt(spec: RunSpec): string {
  const lines = [
    "Write an implementation plan for the goal below, as a numbered list of phases.",
    "",
    "You cannot see the repository and must not guess at its contents. Plan from",
    "the goal, the constraints, and what the acceptance criteria imply. Where a",
    "phase depends on something you cannot know, say so inside that phase rather",
    "than inventing a filename.",
    "",
    `GOAL: ${spec.goal}`
  ];

  if (spec.constraints.length) {
    lines.push("", `CONSTRAINTS:\n${spec.constraints.map(value => `- ${value}`).join("\n")}`);
  }
  if (spec.nonGoals.length) {
    lines.push("", `NOT IN SCOPE:\n${spec.nonGoals.map(value => `- ${value}`).join("\n")}`);
  }
  const criteria = (spec.acceptanceCriteria ?? []).map(item => item.text).filter(Boolean);
  if (criteria.length) {
    lines.push("", `DONE MEANS:\n${criteria.map(value => `- ${value}`).join("\n")}`);
  }

  const tiers = Object.keys(spec.verification?.structuredCommands ?? {});
  if (tiers.length) {
    lines.push(
      "",
      `Every phase is verified by: ${tiers.join(", ")}. A phase that cannot be`,
      "checked by those is a phase that cannot be judged finished — prefer work"
      + " that ends in something they can see."
    );
  }

  lines.push(
    "",
    PHASE_SIZING_RULE,
    "",
    "FORMAT — this is parsed, so follow it exactly:",
    "- One line per phase, starting `1.`, `2.`, and so on.",
    "- The line is the phase's title: what it delivers, in one sentence.",
    "- Under it, indented or on following lines, say how it is verified.",
    "- No preamble, no closing summary, no code."
  );
  return lines.join("\n");
}

export interface PlanDrafterOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
  protocol: WorkerProtocol;
  provider: CodingProvider;
  /** Where the provider is invoked. Never the project: this reads nothing. */
  cwd: string;
}

export class PlanDrafter {
  private readonly store: AutopilotStore;
  private readonly busy = new Set<string>();
  // Assigned explicitly rather than as a parameter property: this package runs
  // its tests under --experimental-strip-types, which does not support them.
  private readonly options: PlanDrafterOptions;

  constructor(options: PlanDrafterOptions) {
    this.options = options;
    this.store = new AutopilotStore(options.ports);
  }

  /**
   * Asks once, and returns whatever came back.
   *
   * Never throws for a provider that refused, timed out or answered nonsense —
   * those are ordinary outcomes of asking a model a question, and the operator
   * can read the reason and press the button again or write the plan
   * themselves. It throws only for a second concurrent request, which is a
   * caller mistake rather than a provider one.
   */
  async draft(runId: string): Promise<PlanDraft> {
    if (this.busy.has(runId)) throw new Error("A plan is already being drafted for this run.");
    this.busy.add(runId);
    try {
      const { ports, options } = { ports: this.options.ports, options: this.options };
      const spec = this.store.requireRun(runId).spec;
      const prompt = planDraftPrompt(spec);
      const sessionId = ports.ids.next("plan-draft");

      this.store.appendEvent(runId, {
        type: "PLAN_DRAFT_REQUESTED",
        payload: { provider: options.provider, promptLength: prompt.length }
      });

      const intent = options.protocol.prompt(
        {
          runId,
          provider: options.provider,
          sessionId,
          cwd: options.cwd,
          // Always a fresh conversation. A drafter that accumulated history
          // would carry one project's plan into the next one's suggestions.
          established: false,
          providerSessionId: null,
          disabledMcpServers: []
        },
        prompt
      );

      const outcome = await options.effects.request({
        runId,
        stepKey: ports.ids.next("plan-draft-step"),
        policy: options.policy,
        intent,
        diagnostics: { provider: options.provider, role: "CONSULTANT" }
      });

      if (!("result" in outcome)) {
        const reason = "decision" in outcome ? outcome.decision.reason : `not authorized (${outcome.status})`;
        return this.failed(runId, `The plan could not be drafted: ${reason}`);
      }

      const completion = options.protocol.completion(outcome.result, sessionId);
      if (!completion.ok) {
        return this.failed(runId, `The provider did not answer (${completion.failure ?? "unknown"}).`);
      }

      // Parsed with the run's own parser, so the number shown is the number of
      // phases the run would actually get — not the number the model believes
      // it wrote.
      const parsed = parsePlanText(completion.text);
      if (parsed.items.length === 0) {
        return this.failed(runId, "The reply contained no numbered phases.");
      }

      this.store.appendEvent(runId, {
        type: "PLAN_DRAFTED",
        payload: { provider: options.provider, phases: parsed.items.length }
      });
      return { text: completion.text.trim(), phases: parsed.items.length, problem: null };
    } finally {
      this.busy.delete(runId);
    }
  }

  private failed(runId: string, problem: string): PlanDraft {
    this.store.appendEvent(runId, { type: "PLAN_DRAFT_FAILED", payload: { problem } });
    return { text: "", phases: 0, problem };
  }
}
