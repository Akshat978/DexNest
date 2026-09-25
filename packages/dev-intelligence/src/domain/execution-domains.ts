/**
 * Execution domain adapters.
 * Contract domains remain `windows` | `wsl`.
 * On this Linux box, LocalProcessRunner backs the `wsl` (posix) domain for tests.
 * Windows adapter is explicit and uses the same runner when Node is on Windows;
 * true WSL bridge via `wsl.exe` is opt-in when available.
 */

import type {
  ExecutionDomainPort,
  ProcessRunnerPort,
  RepositoryExecutionDomain,
} from '@dexnest/dev-intelligence-contracts';
import { LocalProcessRunner } from './local-process-runner.js';
import { DefaultPathTranslation } from './path-translation.js';

export interface DomainRegistry {
  get(domain: RepositoryExecutionDomain): ExecutionDomainPort;
  /** Prefer posix-local (wsl domain) on Linux. */
  defaultDomain(): RepositoryExecutionDomain;
}

export function createWindowsDomain(
  runner: ProcessRunnerPort = new LocalProcessRunner(),
): ExecutionDomainPort {
  return {
    domain: 'windows',
    processRunner: runner,
    paths: new DefaultPathTranslation(),
  };
}

export function createWslDomain(
  runner: ProcessRunnerPort = new LocalProcessRunner(),
): ExecutionDomainPort {
  return {
    domain: 'wsl',
    processRunner: runner,
    paths: new DefaultPathTranslation(),
  };
}

/**
 * Optional: invoke via `wsl.exe` when running on Windows with WSL available.
 * Not used on the Linux Week-1 box; kept for adapter completeness.
 */
export class WslBridgeProcessRunner implements ProcessRunnerPort {
  private readonly inner = new LocalProcessRunner();

  async run(request: Parameters<ProcessRunnerPort['run']>[0]) {
    // Prefix with wsl.exe -- only meaningful on Windows hosts.
    if (process.platform !== 'win32') {
      return this.inner.run(request);
    }
    const [file, ...args] = request.argv;
    return this.inner.run({
      ...request,
      argv: ['wsl.exe', '--', file!, ...args],
      // cwd translation: leave to caller via PathTranslationPort
    });
  }
}

export function createDomainRegistry(options?: {
  windowsRunner?: ProcessRunnerPort;
  wslRunner?: ProcessRunnerPort;
}): DomainRegistry {
  const windows = createWindowsDomain(options?.windowsRunner);
  const wsl = createWslDomain(options?.wslRunner);
  const map: Record<RepositoryExecutionDomain, ExecutionDomainPort> = {
    windows,
    wsl,
  };
  return {
    get(domain) {
      return map[domain];
    },
    defaultDomain() {
      // Linux / darwin → wsl (posix) domain; win32 → windows.
      return process.platform === 'win32' ? 'windows' : 'wsl';
    },
  };
}
