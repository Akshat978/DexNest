// The chat that decides what happens next.
//
// WHY THIS IS A SEPARATE SESSION
//
// Self-direction is cheap because the worker already holds the context, but it
// spends the worker's own capacity on planning. The manual workflow this
// product replaces did the opposite: one chat held the project's history and
// wrote implementation prompts, and a coding agent executed them. That split is
// what lets an expensive coding subscription be spent on coding.
//
// So a director is a second, separate session that:
//   - never receives a workspace and has no tools,
//   - never writes a file, runs a command, or touches git,
//   - answers only in the decision vocabulary the worker uses,
//   - is sticky, so the conversation accumulates the project's history the way
//     the human's own chat does.
//
// It is not a supervisor of the runtime. It proposes work. Every guarantee in
// direction.ts still applies: the assignment is embedded inside a
// DexNest-authored prompt, PLAN_COMPLETE stops rather than finishes, and a
// failing verification is answered with evidence rather than opinion.

import type { EffectsGateway } from "./effects.ts";
import type { CapabilityPolicy } from "./policy.ts";
import type { RuntimePorts, SqlDatabase } from "./ports.ts";
import type { RunSpec } from "./runSpec.ts";
import type { WorkerProtocol, WorkerFailure } from "./worker.ts";
import type { CodingProvider } from "./roles.ts";
import type { PlanView } from "./plan.ts";
import type { VerificationReport } from "./verification.ts";
import { AutopilotStore } from "./store.ts";
import { directionProtocolInstructions, parseDirection, type ParsedDirection } from "./direction.ts";

export interface DirectorSession {
  runId: string;
  provider: CodingProvider;
  sessionId: string;
  providerSessionId: string | null;
  cwd: string;
  established: boolean;
  createdAt: string;
}

interface DirectorRow {
  run_id: string;
  provider: string;
  session_id: string;
  provider_session_id: string | null;
  cwd: string;
  established: number;
  created_at: string;
}

const toSession = (row: DirectorRow): DirectorSession => ({
  runId: row.run_id,
  provider: row.provider as CodingProvider,
  sessionId: row.session_id,
  providerSessionId: row.provider_session_id,
  cwd: row.cwd,
  established: row.established === 1,
  createdAt: row.created_at
});

export class ChatDirectorError extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = "ChatDirectorError";
    this.rule = rule;
  }
}

/**
 * What the director is told before it decides.
 *
 * Evidence, not narrative: the goal and plan the human wrote, what the last
 * piece of work produced, and what the verification commands actually said.
 * The director never sees the workspace, so this is deliberately the whole of
 * what it knows.
 */
export function directorPrompt(input: {
  spec: RunSpec;
  plan: PlanView;
  iteration: number;
  iterationsRemaining: number | null;
  lastAssignment: string | null;
  workerReport: string;
  verification: VerificationReport | null;
}): string {
  const { spec, plan } = input;
  const lines: string[] = [
    "You are directing a coding agent working on this project. You do not write",
    "code and you cannot see the repository. You decide what it should do next.",
    "",
    `GOAL (set by the human, unchanged): ${spec.goal}`
  ];
  if (spec.constraints.length) lines.push(`CONSTRAINTS:\n${spec.constraints.map((value) => `- ${value}`).join("\n")}`);
  if (spec.nonGoals.length) lines.push(`NOT IN SCOPE:\n${spec.nonGoals.map((value) => `- ${value}`).join("\n")}`);

  if (plan.items.length) {
    lines.push("", "THE PLAN, AND WHERE IT STANDS:");
    for (const item of plan.items) {
      lines.push(`- [${item.status}] ${item.id}: ${item.title}`);
    }
  }

  lines.push("", `THIS IS ITERATION ${input.iteration}.`);
  if (input.iterationsRemaining !== null) {
    lines.push(
      input.iterationsRemaining > 0
        ? `${input.iterationsRemaining} further iteration(s) are authorized. Nothing continues past that without a human, so prefer finishing something over starting something.`
        : "This is the last authorized iteration."
    );
  }

  if (input.lastAssignment) {
    lines.push("", "THE ASSIGNMENT YOU GAVE LAST TIME:", input.lastAssignment);
  }

  lines.push("", "WHAT THE AGENT REPORTED:", input.workerReport.trim() || "(nothing)");

  if (input.verification) {
    lines.push(
      "",
      "WHAT DEXNEST'S OWN VERIFICATION FOUND:",
      `outcome: ${input.verification.outcome}`,
      input.verification.summary
    );
    lines.push(
      "",
      "The verification result is DexNest's finding, not the agent's claim. Treat",
      "it as the fact of record."
    );
  }

  lines.push("", directionProtocolInstructions(plan.items.map((item) => item.id)));
  return lines.join("\n");
}

/**
 * What the director produced, and why it could not produce more.
 *
 * The failure is separate from the decision on purpose. "The chat is out of
 * capacity" and "the chat wants a human" are both non-answers, but only one of
 * them means the run should wait rather than ask you to do something.
 */
export interface DirectorOutcome {
  decision: ParsedDirection;
  failure: WorkerFailure | null;
}

export interface ChatDirectorOptions {
  ports: RuntimePorts;
  effects: EffectsGateway;
  policy: CapabilityPolicy;
  provider: CodingProvider;
  protocol: WorkerProtocol;
  newSessionId(): string;
  /** Where the director process runs. Never a writable workspace. */
  cwd: string;
}

/**
 * Runs one director turn: ask the chat what to do next, read its decision.
 *
 * Refusals are deterministic and happen before a process starts. An unreadable
 * or absent answer becomes NEEDS_HUMAN rather than a guess, because the
 * alternative is a run that keeps going on an assignment nobody wrote.
 */
export class ChatDirector {
  private readonly ports: RuntimePorts;
  private readonly db: SqlDatabase;
  private readonly store: AutopilotStore;
  private readonly options: ChatDirectorOptions;
  private readonly busy = new Set<string>();

  constructor(options: ChatDirectorOptions) {
    this.options = options;
    this.ports = options.ports;
    this.db = options.ports.db;
    this.store = new AutopilotStore(options.ports);
  }

  get provider(): CodingProvider {
    return this.options.provider;
  }

  private available(): boolean {
    return Boolean(
      this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_director_sessions'").get()
    );
  }

  session(runId: string): DirectorSession | null {
    if (!this.available()) return null;
    const row = this.db
      .prepare("SELECT * FROM autopilot_director_sessions WHERE run_id=:runId")
      .get<DirectorRow>({ runId });
    return row ? toSession(row) : null;
  }

  /** Opens the sticky director session, once per run. */
  private ensureSession(runId: string): DirectorSession {
    if (!this.available()) throw new ChatDirectorError("director.migration-missing", "Chat direction requires migration 21.");
    const existing = this.session(runId);
    if (existing) {
      if (existing.provider !== this.options.provider) {
        throw new ChatDirectorError(
          "director.provider-changed",
          `This run's director is ${existing.provider}; a session is never moved to another provider.`
        );
      }
      return existing;
    }
    return this.store.transaction(() => {
      const sessionId = this.options.newSessionId();
      this.db
        .prepare(
          `INSERT INTO autopilot_director_sessions (run_id, provider, session_id, cwd, established, created_at)
           VALUES (:runId, :provider, :sessionId, :cwd, 0, :now)`
        )
        .run({
          runId, provider: this.options.provider, sessionId,
          cwd: this.options.cwd, now: this.ports.clock.now()
        });
      this.store.appendEvent(runId, {
        type: "DIRECTOR_SESSION_STARTED",
        payload: { provider: this.options.provider, sessionId }
      });
      return this.session(runId)!;
    });
  }

  private establish(runId: string, providerSessionId: string | null): void {
    this.db
      .prepare(
        `UPDATE autopilot_director_sessions
            SET established=1, provider_session_id=COALESCE(:providerSessionId, provider_session_id)
          WHERE run_id=:runId`
      )
      .run({ runId, providerSessionId });
  }

  /** Asks the director what to do next. One process, read-only, bounded. */
  async decide(input: { runId: string; prompt: string }): Promise<DirectorOutcome> {
    const { runId } = input;
    if (this.busy.has(runId)) throw new ChatDirectorError("director.busy", "The director is already deciding for this run.");
    this.busy.add(runId);
    try {
      const session = this.ensureSession(runId);
      this.store.appendEvent(runId, {
        type: "DIRECTION_REQUESTED",
        payload: { provider: this.options.provider, sessionId: session.sessionId, promptLength: input.prompt.length }
      });

      const intent = this.options.protocol.prompt(
        {
          runId, provider: this.options.provider, sessionId: session.sessionId,
          cwd: session.cwd, established: session.established,
          providerSessionId: session.providerSessionId, disabledMcpServers: []
        },
        input.prompt
      );

      const outcome = await this.options.effects.request({
        runId,
        stepKey: this.ports.ids.next("director-decide"),
        policy: this.options.policy,
        intent,
        diagnostics: { provider: this.options.provider, role: "CONSULTANT" }
      });

      if (!("result" in outcome)) {
        const reason = "decision" in outcome ? outcome.decision.reason : `not authorized (${outcome.status})`;
        return this.unreadable(runId, `The director could not be asked: ${reason}`, "policy");
      }

      const completion = this.options.protocol.completion(outcome.result, session.sessionId);
      if (completion.sessionConfirmed) this.establish(runId, completion.providerSessionId ?? null);
      if (!completion.ok) {
        return this.unreadable(
          runId,
          `The director did not answer (${completion.failure ?? "unknown"}).`,
          completion.failure ?? null
        );
      }

      const parsed = parseDirection(completion.text, []);
      if (!parsed) {
        return this.unreadable(runId, "The director's reply contained no decision.", "protocol");
      }
      return { decision: parsed, failure: null };
    } finally {
      this.busy.delete(runId);
    }
  }

  /**
   * A director that cannot be read is a request for a human.
   *
   * Never a silent fallback to self-direction: the operator chose who decides,
   * and quietly substituting a different decider would make that choice a
   * suggestion.
   */
  private unreadable(runId: string, reason: string, failure: WorkerFailure | null): DirectorOutcome {
    this.store.appendEvent(runId, {
      type: "DIRECTION_REJECTED",
      payload: { source: "chat", issue: reason, ...(failure ? { failure } : {}) }
    });
    return {
      decision: { verb: "NEEDS_HUMAN", assignment: null, reason, planItemId: null, issue: reason },
      failure
    };
  }
}
