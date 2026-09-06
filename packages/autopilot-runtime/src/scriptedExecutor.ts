// Deterministic scripted executor.
//
// This is NOT a WorkerAdapter and never talks to an AI service. It exists to
// exercise the orchestration, durability and reconciliation logic with fully
// controlled behaviour, including deliberate crashes at precise boundaries.
//
// Its "side effect" is an append to a caller-supplied ledger which lives OUTSIDE
// the runtime database — the same relationship a real worker has to the world.
// That separation is what makes the crash tests meaningful: the ledger survives
// a lost runtime, so probe() can report what actually happened, exactly as a
// future worker adapter will inspect git state or a session transcript.

import type { StepExecutionContext, StepExecutionResult, StepExecutor, StepProbeResult } from "./ports.ts";

export interface SideEffectLedger {
  /** Records that the side effect for `idempotencyKey` occurred. */
  append(runId: string, stepKey: string, idempotencyKey: string): void;
  /** Every idempotency key recorded for this step. */
  entriesFor(runId: string, stepKey: string): string[];
}

/** In-memory ledger. Use FileSideEffectLedger when a test must survive process death. */
export class MemorySideEffectLedger implements SideEffectLedger {
  private readonly entries = new Map<string, string[]>();

  private key(runId: string, stepKey: string): string {
    return `${runId}::${stepKey}`;
  }

  append(runId: string, stepKey: string, idempotencyKey: string): void {
    const key = this.key(runId, stepKey);
    const list = this.entries.get(key) ?? [];
    list.push(idempotencyKey);
    this.entries.set(key, list);
  }

  entriesFor(runId: string, stepKey: string): string[] {
    return [...(this.entries.get(this.key(runId, stepKey)) ?? [])];
  }

  /** Total recorded side effects. Used by duplicate-prevention assertions. */
  size(): number {
    let total = 0;
    for (const list of this.entries.values()) total += list.length;
    return total;
  }
}

export type ScriptedBehaviour =
  /** Complete successfully. */
  | { kind: "succeed"; summary?: string }
  /** Fail in a controlled way. */
  | { kind: "fail"; summary?: string }
  /**
   * Perform the side effect, then throw before the runtime can journal the
   * outcome. Models the dangerous window: the world changed, our record did not.
   */
  | { kind: "crashAfterSideEffect"; summary?: string }
  /** Throw before performing the side effect. The world is unchanged. */
  | { kind: "crashBeforeSideEffect" }
  /** Complete, but report `unknown` from probe(). Models unreadable evidence. */
  | { kind: "succeedButUnprobeable" }
  /** Await an externally resolved gate, allowing pause/stop to be observed. */
  | { kind: "block" }
  /**
   * Terminate the host process abruptly BEFORE the side effect, via the injected
   * hardExit. Nothing unwinds and nothing is journaled — genuine process death,
   * not a catchable throw. The world is unchanged.
   */
  | { kind: "exitBeforeSideEffect" }
  /**
   * Terminate the host process abruptly AFTER the side effect but before the
   * outcome can be journaled. This is the dangerous window that makes
   * non-idempotent work unsafe to replay.
   */
  | { kind: "exitAfterSideEffect" };

export interface ScriptedStep {
  key: string;
  behaviour: ScriptedBehaviour;
}

export class ScriptedCrash extends Error {
  readonly stepKey: string;
  readonly sideEffectPerformed: boolean;

  constructor(stepKey: string, sideEffectPerformed: boolean) {
    super(`Scripted crash at step ${stepKey} (sideEffectPerformed=${sideEffectPerformed})`);
    this.name = "ScriptedCrash";
    this.stepKey = stepKey;
    this.sideEffectPerformed = sideEffectPerformed;
  }
}

export interface ScriptedExecutorOptions {
  steps: ScriptedStep[];
  ledger: SideEffectLedger;
  /** Step keys whose probe() must answer "unknown" regardless of the ledger. */
  unprobeableSteps?: string[];
  /**
   * Terminates the host process abruptly. Injected rather than calling
   * process.exit here, so this package never reaches the platform directly.
   * Only the exit* behaviours use it.
   */
  hardExit?: () => never;
}

export class ScriptedExecutor implements StepExecutor {
  readonly id = "scripted";

  private readonly steps: ScriptedStep[];
  private readonly ledger: SideEffectLedger;
  private readonly unprobeable: Set<string>;
  private readonly hardExit: (() => never) | undefined;
  private readonly gates = new Map<string, () => void>();
  private cancelled = false;

  /** Step keys this instance actually executed. Reset by a fresh instance. */
  readonly executed: string[] = [];

  constructor(options: ScriptedExecutorOptions) {
    this.steps = options.steps;
    this.ledger = options.ledger;
    this.hardExit = options.hardExit;
    this.unprobeable = new Set(options.unprobeableSteps ?? []);
    for (const step of this.steps) {
      if (step.behaviour.kind === "succeedButUnprobeable") {
        this.unprobeable.add(step.key);
      }
    }
  }

  plan(): string[] {
    return this.steps.map((step) => step.key);
  }

  /** Releases a step blocked on `{ kind: "block" }`. */
  release(stepKey: string): void {
    const gate = this.gates.get(stepKey);
    if (gate) {
      this.gates.delete(stepKey);
      gate();
    }
  }

  isBlocked(stepKey: string): boolean {
    return this.gates.has(stepKey);
  }

  private requireHardExit(): () => never {
    if (!this.hardExit) {
      throw new Error("ScriptedExecutor: an exit* behaviour was used without a hardExit option.");
    }
    return this.hardExit;
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const step = this.steps.find((candidate) => candidate.key === context.stepKey);
    if (!step) {
      throw new Error(`Scripted executor has no step ${context.stepKey}`);
    }

    this.executed.push(context.stepKey);
    const behaviour = step.behaviour;

    if (behaviour.kind === "crashBeforeSideEffect") {
      throw new ScriptedCrash(step.key, false);
    }

    if (behaviour.kind === "exitBeforeSideEffect") {
      this.requireHardExit()();
    }

    if (behaviour.kind === "block") {
      await new Promise<void>((resolve) => {
        this.gates.set(step.key, resolve);
      });
      if (this.cancelled) {
        return { ok: false, cancelled: true, summary: "cancelled while blocked" };
      }
    }

    // The side effect itself.
    this.ledger.append(context.runId, context.stepKey, context.idempotencyKey);

    if (behaviour.kind === "exitAfterSideEffect") {
      this.requireHardExit()();
    }

    if (behaviour.kind === "crashAfterSideEffect") {
      throw new ScriptedCrash(step.key, true);
    }

    if (behaviour.kind === "fail") {
      return { ok: false, summary: behaviour.summary ?? `step ${step.key} failed` };
    }

    const summary = "summary" in behaviour && behaviour.summary ? behaviour.summary : `step ${step.key} completed`;
    return { ok: true, summary };
  }

  async probe(context: { runId: string; stepKey: string; idempotencyKey: string }): Promise<StepProbeResult> {
    if (this.unprobeable.has(context.stepKey)) {
      return "unknown";
    }
    const entries = this.ledger.entriesFor(context.runId, context.stepKey);
    if (entries.includes(context.idempotencyKey)) {
      return "completed";
    }
    return entries.length > 0 ? "unknown" : "not_started";
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    for (const [key, gate] of [...this.gates.entries()]) {
      this.gates.delete(key);
      gate();
    }
  }
}
