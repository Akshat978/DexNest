/**
 * Configured health checks ONLY.
 * Never auto-run discovered package.json / Makefile / deploy scripts.
 */

import { randomUUID } from 'node:crypto';
import type {
  CancelHandle,
  HealthCheck,
  HealthRun,
  HealthRunStatus,
  HealthStore,
  ProcessRunnerPort,
  RetentionPolicy,
} from '@dexnest/dev-intelligence-contracts';
import { DEFAULT_RETENTION_POLICY } from '@dexnest/dev-intelligence-contracts';
import { evaluateHealthArgv } from './argv-policy.js';

function truncateToBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return buf.subarray(0, maxBytes).toString('utf8');
}

function isCommandMissing(err?: string, exitCode?: number | null): boolean {
  if (!err) return false;
  const m = err.toLowerCase();
  return (
    m.includes('enoent') ||
    m.includes('not found') ||
    m.includes('no such file') ||
    (exitCode === 127)
  );
}

export interface RunHealthOptions {
  check: HealthCheck;
  runner: ProcessRunnerPort;
  cancel?: CancelHandle;
  /** Bound retained output (retention foundations). */
  retention?: Pick<RetentionPolicy, 'maxHealthOutputBytes'>;
}

export async function runConfiguredHealthCheck(
  options: RunHealthOptions,
): Promise<HealthRun> {
  const { check, runner, cancel } = options;
  const retentionCap =
    options.retention?.maxHealthOutputBytes ??
    DEFAULT_RETENTION_POLICY.maxHealthOutputBytes;
  const startedAt = new Date().toISOString();
  const id = `hrun_${randomUUID().replace(/-/g, '')}`;

  if (!check.enabled) {
    return {
      schemaVersion: 1,
      id,
      healthCheckId: check.id,
      repositoryId: check.repositoryId,
      status: 'CANCELLED',
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: 'health check disabled',
    };
  }

  if (!check.argv.length || !check.argv[0]) {
    return {
      schemaVersion: 1,
      id,
      healthCheckId: check.id,
      repositoryId: check.repositoryId,
      status: 'EXECUTION_ERROR',
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: 'empty argv — health checks require explicit argv',
    };
  }

  // EC-049: fail-closed before spawn for interactive/watch misconfig
  const argvPolicy = evaluateHealthArgv(check.argv);
  if (!argvPolicy.allowed) {
    return {
      schemaVersion: 1,
      id,
      healthCheckId: check.id,
      repositoryId: check.repositoryId,
      status: 'EXECUTION_ERROR',
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: `health argv rejected (${argvPolicy.reason}): ${argvPolicy.detail ?? 'fail-closed'} — not executed`,
    };
  }

  if (cancel?.aborted) {
    return {
      schemaVersion: 1,
      id,
      healthCheckId: check.id,
      repositoryId: check.repositoryId,
      status: 'CANCELLED',
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: 'cancelled before start',
    };
  }

  const maxOut = Math.min(check.maxStdoutBytes, retentionCap);
  const maxErr = Math.min(check.maxStderrBytes, retentionCap);

  const result = await runner.run({
    cwd: check.cwd,
    domain: check.domain,
    argv: check.argv,
    timeoutMs: check.timeoutMs,
    maxStdoutBytes: maxOut,
    maxStderrBytes: maxErr,
    cancel,
  });

  const finishedAt = new Date().toISOString();
  let status: HealthRunStatus;

  if (result.cancelled) {
    status = 'CANCELLED';
  } else if (result.timedOut) {
    status = 'TIMEOUT';
  } else if (isCommandMissing(result.errorMessage, result.exitCode)) {
    status = 'COMMAND_MISSING';
  } else if (result.errorMessage && result.exitCode == null) {
    status = 'EXECUTION_ERROR';
  } else if (result.exitCode === 0) {
    status = 'PASS';
  } else if (result.exitCode === 127) {
    status = 'COMMAND_MISSING';
  } else {
    status = 'FAIL';
  }

  const stdoutPreview = truncateToBytes(result.stdout, retentionCap);
  const stderrPreview = truncateToBytes(result.stderr, retentionCap);

  return {
    schemaVersion: 1,
    id,
    healthCheckId: check.id,
    repositoryId: check.repositoryId,
    status,
    startedAt,
    finishedAt,
    exitCode: result.exitCode ?? undefined,
    stdoutPreview: stdoutPreview || undefined,
    stderrPreview: stderrPreview || undefined,
    timedOut: result.timedOut,
    errorMessage: result.errorMessage,
    stdoutBytesRetained: Buffer.byteLength(stdoutPreview, 'utf8'),
    stderrBytesRetained: Buffer.byteLength(stderrPreview, 'utf8'),
  };
}

export async function runEnabledHealthChecks(options: {
  repositoryId: string;
  store: HealthStore;
  runner: ProcessRunnerPort;
  cancel?: CancelHandle;
  retention?: Pick<RetentionPolicy, 'maxHealthOutputBytes'>;
}): Promise<HealthRun[]> {
  const checks = await options.store.listEnabledChecks(options.repositoryId);
  const runs: HealthRun[] = [];
  for (const check of checks) {
    if (options.cancel?.aborted) break;
    const run = await runConfiguredHealthCheck({
      check,
      runner: options.runner,
      cancel: options.cancel,
      retention: options.retention,
    });
    await options.store.saveRun(run);
    runs.push(run);
  }
  return runs;
}
