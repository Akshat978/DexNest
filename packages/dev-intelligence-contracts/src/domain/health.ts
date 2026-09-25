import type { RepositoryExecutionDomain } from './repository.js';

/**
 * Opt-in configured health check. Never auto-run discovered scripts.
 * Commands use argv arrays, not shell strings.
 */
export interface HealthCheck {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  name: string;
  enabled: boolean;
  cwd: string;
  domain: RepositoryExecutionDomain;
  /** Executable + args; never a shell-concatenated string. */
  argv: string[];
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Terminal / in-flight health run outcomes.
 * PASS/FAIL/TIMEOUT/COMMAND_MISSING/CANCELLED/EXECUTION_ERROR are Phase 3 required.
 */
export type HealthRunStatus =
  | 'STARTED'
  | 'PASS'
  | 'FAIL'
  | 'TIMEOUT'
  | 'COMMAND_MISSING'
  | 'CANCELLED'
  | 'EXECUTION_ERROR';

export interface HealthRun {
  schemaVersion: 1;
  id: string;
  healthCheckId: string;
  repositoryId: string;
  status: HealthRunStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  /** Bounded / truncated output; retention is bounded. */
  stdoutPreview?: string;
  stderrPreview?: string;
  timedOut?: boolean;
  errorMessage?: string;
  /** Bytes retained after truncation (retention foundations). */
  stdoutBytesRetained?: number;
  stderrBytesRetained?: number;
}
