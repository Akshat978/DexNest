// The dispatcher.
//
// The ONLY seam where an intent becomes a real effect. It holds the platform
// ports; the engine, executors and policy layer do not.
//
// The dispatcher does NOT decide authority. Policy decides what is permitted;
// the approval system decides whether gated authority was granted; the
// dispatcher executes an intent that has already been authorized, and refuses
// anything else.

import type { Intent } from "./intent.ts";
import { fingerprintIntent } from "./intent.ts";
import type { CommandOutcome, PlatformPorts, ProcessConversation } from "./ports.ts";
import { CodexConversation } from "./codexConversation.ts";
import { buildEnvironment, type CapabilityPolicy } from "./policy.ts";
import { canonicalize, contains } from "./paths.ts";
import type { OperationRecord } from "./operations.ts";

export interface DispatchResult {
  ok: boolean;
  summary: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  detail?: Record<string, unknown>;
}

export class UnauthorizedDispatchError extends Error {
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.name = "UnauthorizedDispatchError";
    this.rule = rule;
  }
}

export interface DispatcherOptions {
  platform: PlatformPorts;
  windows?: boolean;
}

export class Dispatcher {
  private readonly platform: PlatformPorts;
  private readonly windows: boolean;

  constructor(options: DispatcherOptions) {
    this.platform = options.platform;
    this.windows = options.windows ?? true;
  }

  ownedPids(runId: string, operationId?: string): number[] {
    return this.platform.process.ownedProcesses(runId)
      .filter((owned) => operationId === undefined || owned.operationId === operationId).map((owned) => owned.pid);
  }

  /**
   * Executes an authorized operation.
   *
   * Two checks run immediately before the effect, closing the TOCTOU window
   * between authorization and execution:
   *
   *   1. The intent handed in must still fingerprint to the value that was
   *      authorized. If anything mutated the arguments after approval, this
   *      throws rather than executing a different command than the one a human
   *      agreed to.
   *   2. Every path is re-resolved through realPath and re-checked, so a
   *      symlink or junction created between evaluation and dispatch cannot
   *      redirect the effect outside the permitted roots.
   */
  async dispatch(input: {
    operation: OperationRecord;
    intent: Intent;
    policy: CapabilityPolicy;
    runId: string;
    onWorkerSession?: (providerSessionId: string) => void;
  }): Promise<DispatchResult> {
    const { operation, intent, policy, runId } = input;

    if (operation.status !== "APPROVED" && operation.decision !== "ALLOW") {
      throw new UnauthorizedDispatchError(
        "dispatch.not-authorized",
        `Operation ${operation.id} is not authorized for dispatch (decision=${operation.decision}, status=${operation.status}).`
      );
    }
    if (operation.status === "REJECTED" || operation.status === "DENIED") {
      throw new UnauthorizedDispatchError("dispatch.rejected", `Operation ${operation.id} was rejected and may never execute.`);
    }

    const actual = fingerprintIntent(intent, this.windows);
    if (actual !== operation.fingerprint) {
      throw new UnauthorizedDispatchError(
        "dispatch.fingerprint-mismatch",
        `Intent does not match the authorized operation (authorized ${operation.fingerprint}, received ${actual}). ` +
          `An approval authorizes one exact operation and cannot be reused for a modified one.`
      );
    }

    switch (intent.kind) {
      case "READ_FILE": {
        this.assertRealPathWithin(intent.path, policy, "read");
        return { ok: true, summary: `Read ${intent.path}`, exitCode: null, stdout: this.platform.fs.readFile(intent.path) };
      }
      case "WRITE_FILE": {
        this.assertRealPathWithin(intent.path, policy, "write");
        this.platform.fs.writeFile(intent.path, intent.contents);
        return { ok: true, summary: `Wrote ${intent.contents.length} bytes to ${intent.path}`, exitCode: null };
      }
      case "RUN_COMMAND": {
        this.assertRealPathWithin(intent.cwd, policy, "write");
        if (intent.transport && !input.onWorkerSession) throw new UnauthorizedDispatchError("dispatch.missing-session-journal", "Interactive worker dispatch requires durable session binding.");
        const conversation = intent.transport === "codex-app-server" ? new CodexConversation(intent.stdin ?? "", intent.cwd, input.onWorkerSession!) : undefined;
        const outcome = await this.runProcess(runId, operation.id, intent.executable, intent.args, intent.cwd, policy, intent.timeoutMs, intent.stdin, conversation);
        return {
          ok: outcome.exitCode === 0,
          summary: `${intent.executable} exited ${outcome.exitCode}`,
          exitCode: outcome.exitCode,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          detail: { failure: outcome.failure ?? null, signal: outcome.signal ?? null }
        };
      }
      case "GIT_OPERATION": {
        this.assertRealPathWithin(intent.cwd, policy, "write");
        const outcome = await this.runProcess(runId, operation.id, "git", [intent.operation, ...intent.args], intent.cwd, policy);
        return {
          ok: outcome.exitCode === 0,
          summary: `git ${intent.operation} exited ${outcome.exitCode}`,
          exitCode: outcome.exitCode,
          stdout: outcome.stdout,
          stderr: outcome.stderr
        };
      }
      case "CREATE_WORKTREE": {
        this.assertRealPathWithin(intent.repoRoot, policy, "read");
        this.assertRealPathWithin(intent.worktreePath, policy, "write");
        this.platform.git.addWorktree({
          repoRoot: intent.repoRoot,
          worktreePath: intent.worktreePath,
          branch: intent.branch,
          baseRef: intent.baseRef
        });
        return { ok: true, summary: `Created worktree ${intent.worktreePath}`, exitCode: null };
      }
      case "REMOVE_WORKTREE": {
        this.platform.git.removeWorktree({ repoRoot: intent.repoRoot, worktreePath: intent.worktreePath, force: intent.force });
        return { ok: true, summary: `Removed worktree ${intent.worktreePath}`, exitCode: null };
      }
      case "TERMINATE_PROCESS": {
        const owned = this.platform.process.ownedProcesses(runId).find((candidate) => candidate.pid === intent.pid);
        if (!owned) {
          // Belt and braces: policy already checked ownership, and the platform
          // port checks again. A run must never terminate a foreign PID.
          throw new UnauthorizedDispatchError("dispatch.process-not-owned", `Process ${intent.pid} is not owned by run ${runId}.`);
        }
        await this.platform.process.terminate(owned);
        return { ok: true, summary: `Terminated process ${intent.pid}`, exitCode: null };
      }
      default: {
        const exhaustive: never = intent;
        throw new UnauthorizedDispatchError("dispatch.unknown-intent", `Unsupported intent ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private async runProcess(
    runId: string,
    operationId: string,
    executable: string,
    args: string[],
    cwd: string,
    policy: CapabilityPolicy,
    timeoutMs?: number,
    stdin?: string,
    conversation?: ProcessConversation
  ): Promise<CommandOutcome> {
    // The child never inherits the host environment.
    const env = buildEnvironment(policy, this.platform.env.snapshot());
    // Billing credentials must never reach a worker, even under a malformed custom allowlist.
    for (const key of Object.keys(env)) {
      if (["ANTHROPIC_API_KEY", "OPENAI_API_KEY"].includes(key.toUpperCase())) delete env[key];
    }
    return this.platform.process.run({ runId, operationId, executable, args, cwd, env, timeoutMs, stdin, conversation });
  }

  /**
   * Re-resolves a path through the filesystem (following symlinks and Windows
   * junctions) and re-checks containment immediately before the effect.
   *
   * Limitation, stated rather than hidden: this closes the window for links that
   * exist at dispatch time. It is not atomic — a link created between this check
   * and the syscall would not be caught. Eliminating that race needs OS-level
   * containment, which Phase 2 explicitly does not provide.
   */
  private assertRealPathWithin(path: string, policy: CapabilityPolicy, mode: "read" | "write"): void {
    const resolved = this.platform.fs.realPath(path);
    const roots = mode === "write"
      ? [policy.workspaceRoot, policy.scratchRoot, ...policy.writeRoots]
      : [policy.workspaceRoot, policy.scratchRoot, ...policy.writeRoots, ...policy.readRoots];

    const target = canonicalize(resolved, { windows: this.windows });

    for (const denied of policy.denyRoots) {
      if (contains(canonicalize(denied, { windows: this.windows }), target, this.windows)) {
        throw new UnauthorizedDispatchError(
          "dispatch.realpath-denied",
          `Resolved path ${target.display} is inside denied root ${denied}. A link may have redirected it.`
        );
      }
    }

    for (const root of roots) {
      if (!root) continue;
      if (contains(canonicalize(root, { windows: this.windows }), target, this.windows)) {
        return;
      }
    }

    throw new UnauthorizedDispatchError(
      "dispatch.realpath-outside-roots",
      `Resolved path ${target.display} is outside every root this run may ${mode}. A link may have redirected it.`
    );
  }
}
