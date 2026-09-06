import { join, isAbsolute } from "node:path";
import { readdirSync } from "node:fs";
import { type PlatformPorts } from "@dexnest/autopilot-runtime";

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
/**
 * Re-validates the workspace before every worker action.
 *
 * Lives in the runtime now — it is pure logic over a Run Spec and the platform
 * ports, with nothing Electron about it, and keeping it here meant it could not
 * be tested at all. That is how it came to refuse an entire workspace mode.
 */
export { validateRunWorkspace as validateClaudeWorkspace } from "@dexnest/autopilot-runtime";
