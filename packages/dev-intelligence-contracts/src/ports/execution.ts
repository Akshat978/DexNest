/**
 * Execution-domain abstraction and structured process invocation.
 * Business logic must not shell-concatenate command strings.
 */

import type { RepositoryExecutionDomain } from '../domain/repository.js';

/** Cooperative cancel handle (opaque). Hosts/adapters may wrap AbortSignal later. */
export interface CancelHandle {
  readonly aborted: boolean;
}

export interface ProcessInvocationRequest {
  /** Absolute cwd in the domain's native path form. */
  cwd: string;
  domain: RepositoryExecutionDomain;
  /** Executable + arguments (argv array). */
  argv: readonly string[];
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  env?: Record<string, string>;
  /** Optional cooperative cancel. */
  cancel?: CancelHandle;
}

export interface ProcessInvocationResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  errorMessage?: string;
}

/** Port for structured process invocation across Windows / WSL. */
export interface ProcessRunnerPort {
  run(request: ProcessInvocationRequest): Promise<ProcessInvocationResult>;
}

/**
 * Path normalization / translation at the adapter edge.
 * Implementations map between Windows and WSL path forms when needed.
 */
export interface PathTranslationPort {
  toDomainPath(
    path: string,
    targetDomain: RepositoryExecutionDomain,
  ): string;
  detectDomain(path: string): RepositoryExecutionDomain | undefined;
}

export interface ExecutionDomainPort {
  readonly domain: RepositoryExecutionDomain;
  readonly processRunner: ProcessRunnerPort;
  readonly paths: PathTranslationPort;
}
