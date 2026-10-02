import { strict as assert } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";

import { findVsCode, powershellSetLocation, terminalCommand, vsCodeCommand, type LaunchEnv } from "../src/node/launch.ts";

function env(platform: NodeJS.Platform, files: string[], vars: Record<string, string> = {}): LaunchEnv {
  const set = new Set(files);
  return { platform, env: vars, exists: (p) => set.has(p) };
}

test("VS Code on Windows: the owner's choice, the usual install folders, or the Code.exe beside code.cmd on PATH", () => {
  const user = join("C:\\Users\\me\\AppData\\Local", "Programs", "Microsoft VS Code", "Code.exe");
  assert.equal(findVsCode(env("win32", [user], { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }), null), user);
  assert.equal(findVsCode(env("win32", [user, "D:\\Code.exe"], { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }), "D:\\Code.exe"), "D:\\Code.exe");
  const bin = join("E:\\Tools", "VS Code", "bin");
  const exe = join("E:\\Tools", "VS Code", "Code.exe");
  assert.equal(findVsCode(env("win32", [join(bin, "code.cmd"), exe], { PATH: `C:\\Windows;${bin}` }), null), exe, "never code.cmd itself");
  assert.equal(findVsCode(env("win32", [join(bin, "code.cmd")], { PATH: bin }), null), null);
  assert.equal(findVsCode(env("linux", ["/usr/bin/code"], { PATH: "/bin:/usr/bin" }), null), "/usr/bin/code");
  assert.equal(findVsCode(env("linux", [], { PATH: "/bin" }), null), null);
});

test("VS Code opens the workspace file when the project has one", () => {
  assert.deepEqual(vsCodeCommand("Code.exe", "/p", "app.code-workspace").args, [join("/p", "app.code-workspace")]);
  assert.deepEqual(vsCodeCommand("Code.exe", "/p", null).args, ["/p"]);
});

test("terminal: Windows Terminal when installed, else PowerShell with the path safely quoted", () => {
  const wt = join("C:\\L", "Microsoft", "WindowsApps", "wt.exe");
  assert.deepEqual(terminalCommand(env("win32", [wt], { LOCALAPPDATA: "C:\\L" }), "auto", "D:\\code\\it's"), { file: wt, args: ["-d", "D:\\code\\it's"], cwd: "D:\\code\\it's" });
  const ps = terminalCommand(env("win32", [], { LOCALAPPDATA: "C:\\L" }), "auto", "D:\\code\\it's");
  assert.deepEqual(ps, { file: "powershell.exe", args: ["-NoExit", "-Command", "Set-Location -LiteralPath 'D:\\code\\it''s'"], cwd: "D:\\code\\it's" });
  assert.equal(terminalCommand(env("win32", [wt], { LOCALAPPDATA: "C:\\L" }), "powershell", "D:\\x")?.file, "powershell.exe");
  assert.equal(terminalCommand(env("win32", [], { LOCALAPPDATA: "C:\\L" }), "windows_terminal", "D:\\x"), null);
  assert.equal(powershellSetLocation("a'b'c"), "Set-Location -LiteralPath 'a''b''c'");
  assert.equal(terminalCommand(env("linux", [], { PATH: "/bin" }), "auto", "/p"), null);
});
