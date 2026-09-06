import { join, isAbsolute } from "node:path";
import { readdirSync } from "node:fs";
import { defaultEnforcedCapabilityPolicy, evaluatePathAccess, samePath, WorkspaceManager,
  type PlatformPorts, type RunSpecInput } from "@dexnest/autopilot-runtime";

/** Native installation locations only; never execute a shell shim or renderer-supplied command. */
export function claudeExecutable(platform: PlatformPorts): string {
  const env = platform.env.snapshot();
  const candidates = [
    env.USERPROFILE && join(env.USERPROFILE, ".local", "bin", "claude.exe"),
    env.APPDATA && join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
  ].filter((path): path is string => Boolean(path));
  return candidates.find(path => platform.fs.exists(path)) ?? candidates[0] ?? "";
}

export function codexExecutable(platform: PlatformPorts): string {
  const env = platform.env.snapshot();
  const candidates = [
    env.USERPROFILE && join(env.USERPROFILE, ".local", "bin", "codex.exe"),
    env.APPDATA && join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe")
  ].filter((path): path is string => Boolean(path));
  // Read installation directory names only; never inspect Codex auth/session files.
  if (env.USERPROFILE) {
    const extensions = join(env.USERPROFILE, ".vscode", "extensions");
    try {
      for (const entry of readdirSync(extensions).filter(name => /^openai\.chatgpt-[\d.]+-win32-x64$/.test(name)).sort().reverse())
        candidates.push(join(extensions, entry, "bin", "windows-x86_64", "codex.exe"));
    } catch { /* No VS Code installation. */ }
  }
  return candidates.find(path => platform.fs.exists(path)) ?? "";
}

/** Read-only validation; the operator supplies an already registered, separate worktree. */
export function validateClaudeWorkspace(platform: PlatformPorts, spec: RunSpecInput): void {
  const repo = spec.projectPath;
  const cwd = spec.capabilities?.workspaceRoot;
  if (!repo || !cwd || !isAbsolute(repo) || !isAbsolute(cwd)) throw new Error("Select absolute primary repository and existing worktree paths.");
  const policy = defaultEnforcedCapabilityPolicy();
  policy.workspaceRoot = cwd;
  policy.readRoots = [repo];
  policy.denyRoots.push(...(spec.capabilities?.forbiddenPaths ?? []).filter(path => path !== "local-data"));
  for (const [path, mode] of [[repo, "read"], [cwd, "write"]] as const) {
    if (evaluatePathAccess(policy, { path, mode }).decision !== "ALLOW") throw new Error("Repository or worktree is denied by policy.");
    if (!platform.fs.exists(path) || !samePath(platform.fs.realPath(path), path)) throw new Error("Repository and worktree must exist at their canonical paths.");
  }
  const manager = new WorkspaceManager({ git: platform.git, fs: platform.fs, worktreesRoot: cwd, scratchesRoot: cwd });
  manager.assertUsable(repo, cwd);
  if (!samePath(manager.resolveRepositoryRoot(repo), repo) || !samePath(manager.resolveRepositoryRoot(cwd), cwd)) throw new Error("Use repository roots, not subdirectories.");
  const trees = platform.git.listWorktrees(repo);
  if (!trees[0] || !samePath(trees[0].path, repo) || !trees.some(tree => samePath(tree.path, cwd))) throw new Error("Worktree must be registered to the selected primary repository.");
}
