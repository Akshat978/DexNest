// How "Open in VS Code" and "Open terminal" find their programs. No Electron,
// no spawning here: the host spawns what these return (argv, never a shell).
//
// VS Code: the owner's own choice first, then the usual install folders, then
// `code` on PATH. On Windows `code` is `code.cmd`, which current Node refuses
// to spawn without a shell, so the `Code.exe` beside it is used instead.

import { join, posix, win32 } from "node:path";

import type { TerminalChoice } from "../domain/settings.ts";

export interface LaunchEnv {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
}

export interface LaunchCommand {
  file: string;
  args: string[];
  /** Working folder for the new process. */
  cwd?: string;
}

/** Path rules of the platform being asked about, not the machine running this. */
function pathsOf(env: LaunchEnv): typeof win32 {
  return env.platform === "win32" ? win32 : posix;
}

function pathDirs(env: LaunchEnv): string[] {
  const raw = env.env.PATH ?? env.env.Path ?? "";
  return raw.split(env.platform === "win32" ? ";" : ":").filter(Boolean);
}

/** The VS Code executable, or null when it can't be found. */
export function findVsCode(env: LaunchEnv, configured: string | null): string | null {
  if (configured && env.exists(configured)) return configured;
  const { dirname, join } = pathsOf(env);
  if (env.platform === "win32") {
    const candidates = [
      env.env.LOCALAPPDATA && join(env.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
      env.env.ProgramFiles && join(env.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
      env.env["ProgramFiles(x86)"] && join(env.env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe")
    ].filter((p): p is string => Boolean(p));
    for (const dir of pathDirs(env)) {
      // ...\Microsoft VS Code\bin\code.cmd -> ...\Microsoft VS Code\Code.exe
      if (env.exists(join(dir, "code.cmd"))) candidates.push(join(dirname(dir), "Code.exe"));
    }
    return candidates.find((p) => env.exists(p)) ?? null;
  }
  if (env.platform === "darwin") {
    const app = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    if (env.exists(app)) return app;
  }
  for (const dir of pathDirs(env)) {
    const candidate = join(dir, "code");
    if (env.exists(candidate)) return candidate;
  }
  return null;
}

/** VS Code opens the project's workspace file when it has one, else the folder. */
export function vsCodeCommand(executable: string, folder: string, workspaceFile: string | null): LaunchCommand {
  return { file: executable, args: [workspaceFile ? join(folder, workspaceFile) : folder] };
}

/** PowerShell's -LiteralPath with the path single-quoted (single quotes doubled), as the Dev dashboard did. */
export function powershellSetLocation(path: string): string {
  return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'`;
}

/** What to call the terminal that was started, from its program file. */
export function terminalProgramName(file: string): string {
  const base = (file.split(/[\\/]/).pop() ?? file).toLowerCase();
  if (base === "wt.exe" || base === "wt") return "Windows Terminal";
  if (base === "powershell.exe" || base === "pwsh.exe" || base === "powershell" || base === "pwsh") return "PowerShell";
  return base.replace(/\.exe$/, "") || "a terminal";
}

export function terminalCommand(env: LaunchEnv, choice: TerminalChoice, folder: string): LaunchCommand | null {
  const { join } = pathsOf(env);
  if (env.platform === "win32") {
    const wt = env.env.LOCALAPPDATA ? join(env.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "wt.exe") : null;
    if (choice !== "powershell" && wt && env.exists(wt)) return { file: wt, args: ["-d", folder], cwd: folder };
    if (choice === "windows_terminal") return null;
    return { file: "powershell.exe", args: ["-NoExit", "-Command", powershellSetLocation(folder)], cwd: folder };
  }
  if (env.platform === "darwin") return { file: "open", args: ["-a", "Terminal", folder] };
  for (const program of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
    if (pathDirs(env).some((dir) => env.exists(join(dir, program)))) {
      return program === "gnome-terminal" ? { file: program, args: [`--working-directory=${folder}`], cwd: folder } : { file: program, args: [], cwd: folder };
    }
  }
  return null;
}
