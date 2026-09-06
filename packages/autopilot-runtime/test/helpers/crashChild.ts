// Crash harness child process.
//
// Spawned by recovery.test.ts. It builds a real runtime against the SAME durable
// SQLite file and side-effect ledger as the parent, starts a run, and then dies
// abruptly at a chosen boundary via process.exit — no unwinding, no finally
// blocks, no journaling. Every byte of in-memory state is genuinely lost, which
// is the property the reconciliation tests depend on.
//
// Usage: node --experimental-strip-types --experimental-sqlite crashChild.ts <dbPath> <ledgerPath> <runId> <mode>

import { AutopilotEngine } from "../../src/engine.ts";
import { runAutopilotMigrations } from "../../src/migrations.ts";
import { ScriptedExecutor, type ScriptedStep } from "../../src/scriptedExecutor.ts";
import { createNodeSqliteAdapter, createTestClock, createTestIds, createTestLogger, FileSideEffectLedger } from "./harness.ts";

type CrashMode =
  | "exit-before-side-effect"
  | "exit-after-side-effect"
  | "exit-after-outcome"
  | "exit-during-pause"
  | "exit-during-stop"
  | "exit-unprobeable";

const [dbPath, ledgerPath, runId, mode] = process.argv.slice(2) as [string, string, string, CrashMode];

function stepsFor(crashMode: CrashMode): ScriptedStep[] {
  switch (crashMode) {
    case "exit-before-side-effect":
      return [
        { key: "step-1", behaviour: { kind: "succeed" } },
        { key: "step-2", behaviour: { kind: "exitBeforeSideEffect" } },
        { key: "step-3", behaviour: { kind: "succeed" } }
      ];
    case "exit-after-side-effect":
      return [
        { key: "step-1", behaviour: { kind: "succeed" } },
        { key: "step-2", behaviour: { kind: "exitAfterSideEffect" } },
        { key: "step-3", behaviour: { kind: "succeed" } }
      ];
    case "exit-unprobeable":
      return [
        { key: "step-1", behaviour: { kind: "succeed" } },
        { key: "step-2", behaviour: { kind: "exitAfterSideEffect" } },
        { key: "step-3", behaviour: { kind: "succeed" } }
      ];
    case "exit-after-outcome":
    case "exit-during-pause":
    case "exit-during-stop":
      return [
        { key: "step-1", behaviour: { kind: "succeed" } },
        { key: "step-2", behaviour: { kind: "block" } },
        { key: "step-3", behaviour: { kind: "succeed" } }
      ];
    default:
      throw new Error(`Unknown crash mode ${crashMode}`);
  }
}

async function main(): Promise<void> {
  const { db } = createNodeSqliteAdapter(dbPath);
  const ports = {
    db,
    clock: createTestClock(),
    // Instance 99: distinct from any id the parent process mints.
    ids: createTestIds(99),
    logger: createTestLogger()
  };

  runAutopilotMigrations(db, new Date().toISOString());

  const executor = new ScriptedExecutor({
    steps: stepsFor(mode),
    ledger: new FileSideEffectLedger(ledgerPath),
    unprobeableSteps: mode === "exit-unprobeable" ? ["step-2"] : [],
    hardExit: () => process.exit(9) as never
  });

  const engine = new AutopilotEngine({ ports, executor });
  engine.createRun({ id: runId, goal: `crash harness: ${mode}` });

  if (mode === "exit-after-outcome") {
    // Die at a clean boundary: step-1's outcome is journaled, step-2 has no
    // intent yet. Recovery must simply continue, with nothing uncertain.
    const loop = engine.start(runId);
    while (!executor.isBlocked("step-2")) await new Promise((resolve) => setImmediate(resolve));
    process.exit(9);
    void loop;
  }

  if (mode === "exit-during-pause") {
    const loop = engine.start(runId);
    while (!executor.isBlocked("step-2")) await new Promise((resolve) => setImmediate(resolve));
    engine.requestPause(runId); // PAUSE_REQUESTED is durable...
    process.exit(9); // ...but RUN_PAUSED never gets written.
    void loop;
  }

  if (mode === "exit-during-stop") {
    const loop = engine.start(runId);
    while (!executor.isBlocked("step-2")) await new Promise((resolve) => setImmediate(resolve));
    // Journal the stop intent directly, then die before it can be finalized.
    engine.store.appendEvent(runId, {
      type: "STOP_REQUESTED",
      toState: "STOP_REQUESTED",
      stopRequested: true
    });
    process.exit(9);
    void loop;
  }

  await engine.start(runId);
  // The exit* behaviours should have terminated us before reaching here.
  process.exit(0);
}

void main();
