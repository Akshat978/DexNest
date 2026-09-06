// Electron-side platform ports for the Autopilot dispatcher.
//
// These are the real effects. Everything here sits BEHIND the runtime's policy
// layer: nothing in this file decides what is permitted, it only performs work
// the dispatcher has already authorized.
//
// Process handling reuses DexNest's existing pattern (detached spawn, taskkill
// /F /T for the whole tree) rather than inventing a second process manager.

import { execFile, execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import type {
  CommandOutcome,
  EnvironmentPort,
  FileSystemPort,
  GitPort,
  OwnedProcess,
  PlatformPorts,
  ProcessPort,
  WorktreeInfo
} from "@dexnest/autopilot-runtime";

function createFileSystemPort(): FileSystemPort {
  return {
    realPath(path: string): string {
      // Resolve the nearest existing ancestor, so a file that does not exist yet
      // can still be checked and a symlinked/junctioned parent is followed.
      let current = resolve(path);
      const trailing: string[] = [];
      while (!existsSync(current)) {
        const parent = dirname(current);
        if (parent === current) return resolve(path);
        // basename, never length arithmetic: dirname("D:\\x") is "D:\\" WITH a
        // trailing separator, so slice(parent.length + 1) eats the first
        // character of the segment and silently rewrites the path. That turned
        // D:\dexnest-worktrees into D:\exnest-worktrees and failed every run
        // whose worktree parent was a drive root.
        trailing.unshift(basename(current));
        current = parent;
      }
      const real = realpathSync.native(current);
      return trailing.length ? resolve(real, ...trailing) : real;
    },
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, "utf8"),
    writeFile: (path: string, contents: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, "utf8");
    },
    mkdirp: (path: string) => {
      mkdirSync(path, { recursive: true });
    },
    listDirectory: (path: string) => {
      try { return readdirSync(path); } catch { return []; }
    },
    stat: (path: string) => {
      try {
        const info = statSync(path);
        return { sizeBytes: info.size, modifiedAt: info.mtime.toISOString(), directory: info.isDirectory() };
      } catch { return null; }
    },
    // Bounded reads so a multi-megabyte transcript can be sampled without
    // being loaded. Both clip at a byte boundary, so the caller discards the
    // partial line rather than parsing it.
    readFileHead: (path: string, bytes: number) => readSlice(path, bytes, "head"),
    readFileTail: (path: string, bytes: number) => readSlice(path, bytes, "tail")
  };
}

function readSlice(path: string, bytes: number, end: "head" | "tail"): string {
  if (bytes <= 0) return "";
  let handle: number | null = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(bytes, size);
    const start = end === "head" ? 0 : size - length;
    const buffer = Buffer.alloc(length);
    handle = openSync(path, "r");
    readSync(handle, buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (handle !== null) { try { closeSync(handle); } catch { /* already closed */ } }
  }
}

export function createProcessPort(): ProcessPort {
  // Run-scoped ownership. A run may only ever terminate a PID recorded here.
  const owned = new Map<string, OwnedProcess[]>();
  const live = new Map<number, { child: ReturnType<typeof spawn>; stop: (reason: NonNullable<CommandOutcome["failure"]>) => Promise<void> }>();

  const terminateTree = async (record: OwnedProcess, reason: NonNullable<CommandOutcome["failure"]>) => {
    const entry = live.get(record.pid);
    if (!(owned.get(record.runId) ?? []).some((p) => p.pid === record.pid && p.operationId === record.operationId) || !entry) {
      throw new Error(`Refusing to terminate PID ${record.pid}: not an owned live worker.`);
    }
    await entry.stop(reason);
  };

  return {
    ownedProcesses: (runId: string) => [...(owned.get(runId) ?? [])],

    run(input): Promise<CommandOutcome> {
      return new Promise<CommandOutcome>((resolvePromise) => {
        const child = spawn(input.executable, input.args, {
          cwd: input.cwd,
          // Exactly the environment policy built. Never process.env.
          env: input.env,
          windowsHide: true,
          // No shell: arguments stay structured, so there is nothing to inject.
          shell: false
        });

        if (typeof child.pid === "number") {
          const list = owned.get(input.runId) ?? [];
          list.push({ pid: child.pid, runId: input.runId, operationId: input.operationId });
          owned.set(input.runId, list);
        }

        let failure: CommandOutcome["failure"];
        const stop = async (reason?: NonNullable<CommandOutcome["failure"]>) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          failure ??= reason;
          await new Promise<void>((done, reject) => {
            execFile("taskkill", ["/PID", String(child.pid), "/F", "/T"], { windowsHide: true, timeout: 5000 }, (error) => {
              if (error && child.exitCode === null && child.signalCode === null) reject(error);
              else done();
            });
          });
        };
        if (child.pid) live.set(child.pid, { child, stop });
        let stdout = "";
        let stderr = "";
        const limit = 2 * 1024 * 1024;
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        const collect = (chunk: string, isError: boolean) => {
          if (isError) stderr = (stderr + chunk).slice(0, limit);
          else {
            stdout = (stdout + chunk).slice(0, limit);
            // Visibility only. A throwing observer must not affect the run.
            if (input.onOutput) { try { input.onOutput(chunk); } catch { /* ignored */ } }
          }
          if (stdout.length + stderr.length >= limit && !failure) void stop("output_limit").catch(() => child.kill());
        };
        let buffer = "";
        let conversationComplete = false;
        const writeMessages = (messages: string[]) => {
          for (const message of messages) child.stdin?.write(message);
          if (input.conversation?.done && !conversationComplete) {
            conversationComplete = true;
            child.stdin?.end();
            void stop().catch(() => child.kill());
          }
        };
        child.stdout?.on("data", (chunk: string) => {
          collect(chunk, false);
          if (!input.conversation || failure || conversationComplete) return;
          buffer += chunk;
          try {
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0 && !conversationComplete) {
              const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
              if (line) writeMessages(input.conversation.receive(line));
            }
          } catch { void stop("protocol").catch(() => child.kill()); }
        });
        child.stderr?.on("data", (chunk: string) => collect(chunk, true));
        child.stdin?.on("error", () => { /* EPIPE is reflected by missing structured completion. */ });
        child.once("spawn", () => {
          if (input.conversation) {
            try { writeMessages(input.conversation.start()); }
            catch { void stop("protocol").catch(() => child.kill()); }
          } else child.stdin?.end(input.stdin ?? "");
        });

        const timer = input.timeoutMs
          ? setTimeout(() => {
              void stop("timeout").catch(() => child.kill());
            }, input.timeoutMs)
          : null;

        child.on("error", (error) => {
          if (timer) clearTimeout(timer);
          failure = "spawn";
          stderr += String(error.message);
        });
        child.on("close", (code, signal) => {
          if (timer) clearTimeout(timer);
          live.delete(child.pid ?? -1);
          owned.set(input.runId, (owned.get(input.runId) ?? []).filter((p) => p.operationId !== input.operationId || p.pid !== child.pid));
          resolvePromise({ exitCode: conversationComplete && !failure ? 0 : code ?? -1,
            stdout: input.conversation ? input.conversation.result() : stdout, stderr, pid: child.pid ?? -1, signal: signal ?? null,
            failure: input.conversation && !conversationComplete && !failure ? (code === 0 ? "protocol" : "process") : failure });
        });
      });
    },

    async terminate(process: OwnedProcess): Promise<void> {
      await terminateTree(process, "interrupted");
    }
  };
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 }).trim();
}

function createGitPort(): GitPort {
  return {
    isRepository(dir: string): boolean {
      try {
        return git(["rev-parse", "--is-inside-work-tree"], dir) === "true";
      } catch {
        return false;
      }
    },
    repositoryRoot: (dir: string) => git(["rev-parse", "--show-toplevel"], dir),
    head: (dir: string) => git(["rev-parse", "HEAD"], dir),
    isDirty: (dir: string) => git(["status", "--porcelain"], dir).length > 0,
    listWorktrees(repoRoot: string): WorktreeInfo[] {
      const entries: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> = {};
      for (const line of git(["worktree", "list", "--porcelain"], repoRoot).split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) entries.push({ path: current.path, branch: current.branch ?? null, head: current.head ?? null });
          current = { path: line.slice("worktree ".length).trim() };
        } else if (line.startsWith("HEAD ")) {
          current.head = line.slice("HEAD ".length).trim();
        } else if (line.startsWith("branch ")) {
          current.branch = line.slice("branch ".length).trim();
        }
      }
      if (current.path) entries.push({ path: current.path, branch: current.branch ?? null, head: current.head ?? null });
      return entries;
    },
    addWorktree({ repoRoot, worktreePath, branch, baseRef }) {
      git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoRoot);
    },
    removeWorktree({ repoRoot, worktreePath, force }) {
      git(["worktree", "remove", ...(force ? ["--force"] : []), worktreePath], repoRoot);
    }
  };
}

/**
 * The ambient environment, supplied so the runtime can filter it.
 *
 * The runtime never reads process.env itself; it receives this snapshot and
 * applies its allowlist and strip patterns to build what a child actually gets.
 */
function createEnvironmentPort(): EnvironmentPort {
  return {
    snapshot: () => {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") values[key] = value;
      }
      return values;
    }
  };
}

export function createAutopilotPlatformPorts(): PlatformPorts {
  return {
    fs: createFileSystemPort(),
    process: createProcessPort(),
    git: createGitPort(),
    env: createEnvironmentPort()
  };
}
