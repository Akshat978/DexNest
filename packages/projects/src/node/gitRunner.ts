// Node implementations of the read engine's ports: a git process runner
// (argv only, never a shell) and the two file checks the engine needs.
//
// git-ops (Phase 4) reuses the runner with its own argv validator; the read
// engine wraps it with the read-only allowlist.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";

import type { RepoFsPort } from "../git/reader.ts";
import type { GitRunner, GitRunResult } from "../git/runner.ts";

export interface NodeGitRunnerOptions {
  /** Executable; defaults to `git` on PATH. */
  gitPath?: string;
  /** Base environment; defaults to process.env. Tests pass an isolated one. */
  env?: NodeJS.ProcessEnv;
}

export function createNodeGitRunner(options: NodeGitRunnerOptions = {}): GitRunner {
  const gitPath = options.gitPath ?? "git";
  return {
    run(request) {
      return new Promise<GitRunResult>((resolve) => {
        const result: GitRunResult = { exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: false, truncated: false, notFound: false };
        if (request.signal?.aborted) {
          resolve({ ...result, cancelled: true });
          return;
        }
        // A missing working folder would otherwise look like a missing git (both are ENOENT).
        if (!existsSync(request.cwd)) {
          resolve({ ...result, stderr: "fatal: folder not found" });
          return;
        }
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let settled = false;
        const child = spawn(gitPath, [...request.args], {
          cwd: request.cwd,
          env: { ...(options.env ?? process.env), ...(request.env ?? {}) },
          shell: false,
          windowsHide: true,
          stdio: [request.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
        });
        const kill = () => {
          if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
        };
        const timer = setTimeout(() => {
          result.timedOut = true;
          kill();
        }, request.timeoutMs);
        const onAbort = () => {
          result.cancelled = true;
          kill();
        };
        request.signal?.addEventListener("abort", onAbort, { once: true });
        const collect = (chunks: Buffer[], chunk: Buffer, isOut: boolean) => {
          const used = isOut ? outBytes : errBytes;
          const room = request.maxBytes - used;
          if (room <= 0) {
            result.truncated = true;
            return;
          }
          const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
          if (piece.length < chunk.length) result.truncated = true;
          chunks.push(piece);
          if (isOut) outBytes += piece.length;
          else errBytes += piece.length;
        };
        if (request.stdin !== undefined && child.stdin) {
          child.stdin.on("error", () => undefined);
          child.stdin.end(request.stdin, "utf8");
        }
        child.stdout?.on("data", (chunk: Buffer) => collect(out, chunk, true));
        child.stderr?.on("data", (chunk: Buffer) => collect(err, chunk, false));
        const finish = (exitCode: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", onAbort);
          resolve({ ...result, exitCode: result.timedOut || result.cancelled ? null : exitCode, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
        };
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") result.notFound = true;
          finish(null);
        });
        child.on("close", (code) => finish(code));
      });
    }
  };
}

export function createNodeRepoFs(): RepoFsPort {
  return {
    exists(path) {
      return existsSync(path);
    },
    mtimeMs(path) {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    }
  };
}
