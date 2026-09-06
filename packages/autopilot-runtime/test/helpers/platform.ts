// Real platform ports for tests.
//
// These are genuine implementations — real filesystem, real `git`, real child
// processes — running against temporary directories. Policy is therefore tested
// against reality rather than against a mock that agrees with it.

import { execFileSync, spawnSync } from "node:child_process";
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
} from "../../src/ports.ts";

export function createFileSystemPort(): FileSystemPort {
  return {
    realPath(path: string): string {
      // Resolve the nearest existing ancestor so a not-yet-created file can
      // still be checked, and so a symlinked parent is still followed.
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

export interface DispatchedCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface TrackingProcessPort extends ProcessPort {
  /** Every command that actually reached the operating system. */
  readonly dispatched: DispatchedCommand[];
  /** Registers a PID as owned, for ownership tests without a live process. */
  registerOwned(owned: OwnedProcess): void;
  readonly terminated: OwnedProcess[];
}

export function createProcessPort(): TrackingProcessPort {
  const dispatched: Array<{ executable: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
  const owned = new Map<string, OwnedProcess[]>();
  const terminated: OwnedProcess[] = [];

  return {
    dispatched,
    terminated,
    registerOwned(process: OwnedProcess) {
      const list = owned.get(process.runId) ?? [];
      list.push(process);
      owned.set(process.runId, list);
    },
    ownedProcesses(runId: string): OwnedProcess[] {
      return [...(owned.get(runId) ?? [])];
    },
    async run(input): Promise<CommandOutcome> {
      dispatched.push({ executable: input.executable, args: input.args, cwd: input.cwd, env: input.env });
      const result = spawnSync(input.executable, input.args, {
        cwd: input.cwd,
        env: input.env,
        encoding: "utf8",
        timeout: input.timeoutMs ?? 30_000,
        shell: false,
        // A worker prompt is delivered on stdin. Dropping it silently turns a
        // real prompt into an empty one, which the provider then rejects.
        ...(input.stdin === undefined ? {} : { input: input.stdin })
      });
      const pid = result.pid ?? -1;
      const list = owned.get(input.runId) ?? [];
      list.push({ pid, runId: input.runId, operationId: input.operationId });
      owned.set(input.runId, list);
      return {
        exitCode: result.status ?? (result.error ? -1 : 0),
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? (result.error ? String(result.error.message) : ""),
        pid
      };
    },
    async terminate(process: OwnedProcess): Promise<void> {
      const list = owned.get(process.runId) ?? [];
      if (!list.some((candidate) => candidate.pid === process.pid)) {
        throw new Error(`Refusing to terminate PID ${process.pid}: not owned by run ${process.runId}.`);
      }
      terminated.push(process);
    }
  };
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

export function createGitPort(): GitPort {
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
      const output = git(["worktree", "list", "--porcelain"], repoRoot);
      const entries: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> = {};
      for (const line of output.split("\n")) {
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

export function createEnvironmentPort(values: Record<string, string>): EnvironmentPort {
  return { snapshot: () => ({ ...values }) };
}

export function createPlatformPorts(env: Record<string, string>): PlatformPorts & { process: TrackingProcessPort } {
  return {
    fs: createFileSystemPort(),
    process: createProcessPort(),
    git: createGitPort(),
    env: createEnvironmentPort(env)
  };
}

/** Creates a real git repository with one commit. */
export function createTestRepository(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(["init", "-b", "main"], dir);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "Autopilot Test"], dir);
  writeFileSync(resolve(dir, "README.md"), "# test repo\n", "utf8");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return realpathSync.native(dir);
}
