// Injected capability ports.
//
// This package must never import Electron, and must never reach the filesystem,
// clock, process table or database directly. Everything the runtime needs from
// the outside world arrives through the interfaces below. That is the mechanism
// which keeps a later extraction into a dedicated process mechanical rather than
// a rewrite (see docs/AUTOPILOT_ARCHITECTURE.md section 4).

/** A prepared statement. Deliberately the intersection of better-sqlite3 and node:sqlite. */
export interface SqlStatement {
  run(params?: Record<string, unknown>): { changes: number };
  get<T>(params?: Record<string, unknown>): T | undefined;
  all<T>(params?: Record<string, unknown>): T[];
}

/**
 * Minimal SQLite surface the runtime needs.
 *
 * Production injects an adapter over the app's existing better-sqlite3
 * connection (rebuilt for Electron's ABI). Tests inject an adapter over Node's
 * built-in `node:sqlite`. Both are real SQLite executing identical SQL, so the
 * schema, the transactions and the constraints are genuinely exercised in tests
 * even though the native Electron binding cannot load under plain Node.
 *
 * Named parameters use the `:name` form, which both drivers accept.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export interface Clock {
  /** ISO-8601 UTC timestamp. */
  now(): string;
}

export interface IdGenerator {
  /** Collision-free identifier. Prefixed by the caller for readability. */
  next(prefix: string): string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

/**
 * Outcome evidence for a step whose intent was journaled but whose result was
 * never recorded — the crash window that makes non-idempotent work dangerous.
 *
 * `unknown` is the honest answer and must not be treated as `not_started`.
 */
export type StepProbeResult = "completed" | "not_started" | "unknown";

export interface StepExecutionContext {
  runId: string;
  stepKey: string;
  /** Stable per-attempt key. Passed to the side effect so it can deduplicate. */
  idempotencyKey: string;
  /** Resolves true once pause or stop has been requested. */
  shouldYield(): boolean;
  /**
   * The ONLY route to an effect. An executor never receives a filesystem or a
   * process spawner: it describes an intent, and policy decides.
   * Typed as unknown here to keep ports.ts free of a cycle; executors import
   * EffectsGateway from the package root.
   */
  effects?: unknown;
}

export interface StepExecutionResult {
  ok: boolean;
  summary: string;
  /** The step stopped because an effect needs human approval. Not a failure. */
  awaitingApproval?: { operationId: string; approvalId: string };
  detail?: Record<string, unknown>;
  /**
   * The step ended because cancellation was requested, not because the work
   * failed. The distinction matters: a cancelled run must reach STOPPED, while a
   * failed one must reach FAILED.
   */
  cancelled?: boolean;
}

/**
 * Performs the side effect for one step.
 *
 * Phase 1 ships only a deterministic scripted implementation. A real
 * WorkerAdapter (Claude, Codex) implements this same interface in a later phase,
 * which is why `probe` exists: after a crash the runtime must be able to ask the
 * outside world what actually happened rather than guessing.
 */
export interface StepExecutor {
  readonly id: string;
  /** Ordered logical step keys for a run. Stable across restarts. */
  plan(runId: string): string[];
  execute(context: StepExecutionContext): Promise<StepExecutionResult>;
  /** Evidence lookup for a step with journaled intent and no recorded outcome. */
  probe(context: { runId: string; stepKey: string; idempotencyKey: string }): Promise<StepProbeResult>;
  /** Best-effort cancellation of in-flight work. Must be safe to call twice. */
  cancel(runId: string): Promise<void>;
}

// --- Phase 2 platform ports ------------------------------------------------
//
// These are the ONLY way an effect reaches the operating system. The dispatcher
// holds them; the engine, the policy layer and executors do not. Nothing in this
// package imports node:fs, node:child_process or a git helper directly, so there
// is no path from domain code to an effect that skips policy.

export interface FileSystemPort {
  /**
   * Fully resolved real path, following symlinks, junctions and reparse points.
   * Implementations resolve the nearest existing ancestor when the leaf does not
   * exist yet, so a not-yet-created file can still be policy-checked.
   */
  realPath(path: string): string;
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  mkdirp(path: string): void;
  /** Entry names directly inside a directory. Empty when it does not exist. */
  listDirectory(path: string): string[];
  stat(path: string): { sizeBytes: number; modifiedAt: string; directory: boolean } | null;
  /**
   * Bounded reads for files too large to load whole. Both decode leniently and
   * may clip a multi-byte character at the cut, so callers must discard the
   * partial line at the boundary rather than parsing it.
   */
  readFileHead(path: string, bytes: number): string;
  readFileTail(path: string, bytes: number): string;
}

/**
 * A process this run started, and therefore may terminate. Termination is
 * restricted to these — an Autopilot run must never be able to kill an arbitrary
 * machine PID.
 */
export interface OwnedProcess {
  pid: number;
  runId: string;
  operationId: string;
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  pid: number;
  /** Termination signal, when the process was killed rather than exiting. */
  signal?: string | null;
  failure?: "spawn" | "timeout" | "interrupted" | "output_limit" | "protocol" | "process";
}

/** A bounded protocol conversation created by the dispatcher, not arbitrary child authority. */
export interface ProcessConversation {
  start(): string[];
  receive(line: string): string[];
  done: boolean;
  result(): string;
}

export interface ProcessPort {
  run(input: {
    runId: string;
    operationId: string;
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs?: number;
    /** Private input, delivered through stdin rather than command-line arguments. */
    stdin?: string;
    conversation?: ProcessConversation;
    /**
     * Called with stdout as it arrives, so a caller can show what is
     * happening without waiting for the process to exit. Never authoritative:
     * the outcome is still decided by the completed CommandOutcome, so a
     * dropped or malformed chunk can only cost visibility, never correctness.
     */
    onOutput?: (chunk: string) => void;
  }): Promise<CommandOutcome>;
  /** Terminates a process tree. Implementations must verify ownership first. */
  terminate(owned: OwnedProcess): Promise<void>;
  /** Processes this port started for the given run and has not reaped. */
  ownedProcesses(runId: string): OwnedProcess[];
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
}

export interface GitPort {
  isRepository(dir: string): boolean;
  /** Canonical top-level directory of the repository containing `dir`. */
  repositoryRoot(dir: string): string;
  head(dir: string): string;
  isDirty(dir: string): boolean;
  listWorktrees(repoRoot: string): WorktreeInfo[];
  addWorktree(input: { repoRoot: string; worktreePath: string; branch: string; baseRef: string }): void;
  removeWorktree(input: { repoRoot: string; worktreePath: string; force: boolean }): void;
}

/**
 * The ambient environment the host process happens to have. Supplied as a port
 * so the runtime can filter it without reading process.env itself.
 */
export interface EnvironmentPort {
  snapshot(): Record<string, string>;
}

export interface PlatformPorts {
  fs: FileSystemPort;
  process: ProcessPort;
  git: GitPort;
  env: EnvironmentPort;
}

export interface RuntimePorts {
  db: SqlDatabase;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** Absent in pure-domain tests that never dispatch an effect. */
  platform?: PlatformPorts;
}
