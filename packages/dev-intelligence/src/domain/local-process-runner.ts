/**
 * Structured process runner using argv arrays (never shell-string concat).
 * Primary implementation for Linux/posix (this Week-1 box) and usable as the
 * WSL-domain runner. Windows-domain uses the same spawn API when Node runs on Windows.
 */

import { spawn } from 'node:child_process';
import type {
  CancelHandle,
  ProcessInvocationRequest,
  ProcessInvocationResult,
  ProcessRunnerPort,
} from '@dexnest/dev-intelligence-contracts';

function truncateUtf8(buf: Buffer, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf.toString('utf8');
  return buf.subarray(0, maxBytes).toString('utf8');
}

/**
 * Local argv-based process runner. Works on Linux (tests), macOS, and Windows Node.
 * Does not invoke through `sh -c` / `cmd /c` — argv is passed directly to spawn.
 */
export class LocalProcessRunner implements ProcessRunnerPort {
  async run(request: ProcessInvocationRequest): Promise<ProcessInvocationResult> {
    const started = Date.now();
    if (request.cancel?.aborted) {
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: true,
        durationMs: 0,
        errorMessage: 'cancelled before start',
      };
    }

    const [file, ...args] = request.argv;
    if (!file) {
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: false,
        durationMs: Date.now() - started,
        errorMessage: 'empty argv',
      };
    }

    return new Promise<ProcessInvocationResult>((resolve) => {
      const child = spawn(file, args, {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        shell: false,
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutLen = 0;
      let stderrLen = 0;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const finish = (result: ProcessInvocationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, request.timeoutMs);

      const onCancelPoll = setInterval(() => {
        if (request.cancel?.aborted && !cancelled) {
          cancelled = true;
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, 50);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutLen >= request.maxStdoutBytes) return;
        const remaining = request.maxStdoutBytes - stdoutLen;
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stdoutChunks.push(slice);
        stdoutLen += slice.length;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrLen >= request.maxStderrBytes) return;
        const remaining = request.maxStderrBytes - stderrLen;
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        stderrChunks.push(slice);
        stderrLen += slice.length;
      });

      child.on('error', (err) => {
        clearInterval(onCancelPoll);
        finish({
          exitCode: null,
          stdout: truncateUtf8(Buffer.concat(stdoutChunks), request.maxStdoutBytes),
          stderr: truncateUtf8(Buffer.concat(stderrChunks), request.maxStderrBytes),
          timedOut,
          cancelled,
          durationMs: Date.now() - started,
          errorMessage: err.message,
        });
      });

      child.on('close', (code) => {
        clearInterval(onCancelPoll);
        finish({
          exitCode: code,
          stdout: truncateUtf8(Buffer.concat(stdoutChunks), request.maxStdoutBytes),
          stderr: truncateUtf8(Buffer.concat(stderrChunks), request.maxStderrBytes),
          timedOut,
          cancelled,
          durationMs: Date.now() - started,
        });
      });
    });
  }
}

/** Mutable cancel handle for scan orchestration. */
export class MutableCancelHandle implements CancelHandle {
  private _aborted = false;
  get aborted(): boolean {
    return this._aborted;
  }
  cancel(): void {
    this._aborted = true;
  }
}
