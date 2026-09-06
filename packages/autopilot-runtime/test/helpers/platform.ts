// Real platform ports for tests.
//
// These are genuine implementations — real filesystem, real `git`, real child
// processes — running against temporary directories. Policy is therefore tested
// against reality rather than against a mock that agrees with it.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
        trailing.unshift(current.slice(parent.length + 1));
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
    }
  };
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
