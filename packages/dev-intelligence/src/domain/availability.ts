/**
 * Execution-domain availability probes (EC-040 / EC-051).
 *
 * On Linux Week-1 box we cannot exercise real Windows Git / WSL.exe absence.
 * Callers may inject probes for fault-injection tests; production default probes
 * the local `git` binary for the active domain and reports degrade reasons.
 *
 * Unresolved HostProcessPort may later supply richer WSL bridge status.
 */

import type {
  ProcessRunnerPort,
  RepositoryExecutionDomain,
} from '@dexnest/dev-intelligence-contracts';
import { LocalProcessRunner } from './local-process-runner.js';

export type DomainDegradeReason =
  | 'git_unavailable'
  | 'wsl_unavailable'
  | 'wsl_distro_missing'
  | 'windows_git_unavailable'
  | 'probe_timeout'
  | 'probe_error';

export interface DomainAvailability {
  domain: RepositoryExecutionDomain;
  available: boolean;
  reason?: DomainDegradeReason;
  detail?: string;
}

export type DomainAvailabilityProbe = (
  domain: RepositoryExecutionDomain,
) => Promise<DomainAvailability>;

/**
 * Default probe: run `git --version` via the given runner (or LocalProcessRunner).
 * Does not claim Windows/WSL host facts — only whether git argv works locally.
 */
export function createGitAvailabilityProbe(
  runner: ProcessRunnerPort = new LocalProcessRunner(),
): DomainAvailabilityProbe {
  return async (domain) => {
    try {
      const result = await runner.run({
        cwd: process.cwd(),
        domain,
        argv: ['git', '--version'],
        timeoutMs: 5_000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
      });
      if (result.timedOut) {
        return {
          domain,
          available: false,
          reason: 'probe_timeout',
          detail: 'git --version timed out',
        };
      }
      if (result.exitCode !== 0 || result.errorMessage) {
        const reason: DomainDegradeReason =
          domain === 'windows'
            ? 'windows_git_unavailable'
            : 'git_unavailable';
        return {
          domain,
          available: false,
          reason,
          detail:
            result.errorMessage ??
            (result.stderr.slice(0, 200) || `exit ${result.exitCode}`),
        };
      }
      return { domain, available: true };
    } catch (err) {
      return {
        domain,
        available: false,
        reason: 'probe_error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

/**
 * Simulate WSL/Windows Git unavailable for fault injection (Linux box).
 * Production code should not use forced unavailability except in tests.
 */
export function createForcedUnavailableProbe(
  reason: DomainDegradeReason,
  detail: string,
): DomainAvailabilityProbe {
  return async (domain) => ({
    domain,
    available: false,
    reason,
    detail,
  });
}

/**
 * If a domain is unavailable, scans that target that domain should isolate
 * the failure rather than crash the whole run. Helper for orchestrator/tests.
 */
export function availabilityFailureMessage(a: DomainAvailability): string {
  return `domain ${a.domain} unavailable (${a.reason ?? 'unknown'}): ${a.detail ?? ''}`;
}
