// The process port. The read engine never spawns anything itself: the host
// passes a GitRunner (node implementation in ../node/gitRunner.ts), and the
// engine wraps it so every call is checked against the read-only allowlist.

import { assertReadOnlyGitArgv } from "./readOnlyArgv.ts";

export interface GitRunRequest {
  cwd: string;
  /** Arguments after `git`. Never a shell string. */
  args: readonly string[];
  timeoutMs: number;
  /** Output beyond this many bytes is dropped and `truncated` is set. */
  maxBytes: number;
  signal?: AbortSignal;
  /** Added to the runner's base environment. */
  env?: Readonly<Record<string, string>>;
  /** Written to git's stdin, then closed (git-ops sends commit messages this way). */
  stdin?: string;
}

export interface GitRunResult {
  /** null when the process was killed or never started. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  /** git itself could not be started (not installed / not on PATH). */
  notFound: boolean;
}

export interface GitRunner {
  run(request: GitRunRequest): Promise<GitRunResult>;
}

/** Environment every reading call gets: no prompts, no optional locks, stable output. */
export const READ_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "never",
  GIT_PAGER: "cat",
  PAGER: "cat",
  LC_ALL: "C"
};

/** Prefix for every reading call: never run a configured fsmonitor hook, never colour, never quote paths. */
export const READ_PREFIX: readonly string[] = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "color.ui=false", "-c", "core.quotepath=false"];

export interface ReadOnlyGit {
  run(cwd: string, args: readonly string[], options?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }): Promise<GitRunResult>;
}

export const DEFAULT_READ_TIMEOUT_MS = 15_000;
export const DEFAULT_READ_MAX_BYTES = 8 * 1024 * 1024;

export function createReadOnlyGit(runner: GitRunner): ReadOnlyGit {
  return {
    run(cwd, args, options = {}) {
      const full = [...READ_PREFIX, ...args];
      assertReadOnlyGitArgv(full);
      return runner.run({
        cwd,
        args: full,
        timeoutMs: options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
        maxBytes: options.maxBytes ?? DEFAULT_READ_MAX_BYTES,
        signal: options.signal,
        env: READ_ENV
      });
    }
  };
}
