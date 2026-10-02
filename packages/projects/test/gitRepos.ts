// Real git repositories in temp directories, with a local bare repository as
// "origin". Git runs with an isolated HOME and global config, no system
// config, and only the file:// transport allowed - so nothing here can reach
// the network or read the developer's own git settings.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSafeTestPath } from "@dexnest/foundation/testing";

import { createNodeGitRunner, createNodeRepoFs } from "../src/node/gitRunner.ts";
import { createGitReader, type GitReader } from "../src/git/reader.ts";
import type { GitRunner, GitRunRequest } from "../src/git/runner.ts";

export interface Sandbox {
  root: string;
  env: NodeJS.ProcessEnv;
  git(cwd: string, ...args: string[]): string;
  gitAt(cwd: string, date: string, ...args: string[]): string;
  write(path: string, content: string): void;
  /** A bare "origin" plus a clone of it with one pushed commit on main. */
  origin(): { bare: string; app: string };
  clone(bare: string, name: string): string;
  runner: GitRunner;
  calls: GitRunRequest[];
  reader(options?: { branchLimit?: number }): GitReader;
  dispose(): void;
}

export function sandbox(label = "dexnest-git-"): Sandbox {
  const root = assertSafeTestPath(mkdtempSync(join(tmpdir(), label)));
  const home = join(root, "home");
  mkdirSync(home);
  const globalConfig = join(home, ".gitconfig");
  writeFileSync(
    globalConfig,
    [
      "[user]", "\tname = Test Person", "\temail = test@example.invalid",
      "[init]", "\tdefaultBranch = main",
      "[protocol \"file\"]", "\tallow = always",
      "[advice]", "\tdetachedHead = false",
      "[commit]", "\tgpgsign = false",
      ""
    ].join("\n")
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C"
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const gitAt = (cwd: string, date: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (path: string, content: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  };
  const clone = (bare: string, name: string) => {
    const dir = join(root, name);
    git(root, "clone", "-q", bare, dir);
    return dir;
  };
  const inner = createNodeGitRunner({ env });
  const calls: GitRunRequest[] = [];
  const runner: GitRunner = {
    run(request) {
      calls.push(request);
      return inner.run(request);
    }
  };
  return {
    root,
    env,
    git,
    gitAt,
    write,
    clone,
    origin() {
      const bare = join(root, "origin.git");
      git(root, "init", "-q", "--bare", bare);
      const seed = join(root, "seed");
      git(root, "init", "-q", seed);
      write(join(seed, "a.txt"), "one\n");
      git(seed, "add", "a.txt");
      git(seed, "commit", "-q", "-m", "first");
      git(seed, "remote", "add", "origin", bare);
      git(seed, "push", "-q", "-u", "origin", "main");
      rmSync(seed, { recursive: true, force: true });
      return { bare, app: clone(bare, "app") };
    },
    runner,
    calls,
    reader(options = {}) {
      return createGitReader({ runner, fs: createNodeRepoFs(), branchLimit: options.branchLimit });
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}
