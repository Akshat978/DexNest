// Low-level Windows keyboard hook for natural Clipboard Slot shortcut sequences:
//   Hold Ctrl, tap 1/2/3, then C (copy selection, then save to slot) or V (paste slot).
//   For C the keystroke is passed through so a normal Ctrl+C runs first; the main
//   process waits briefly and then saves the freshly-copied clipboard to the slot.
//   For V the keystroke is suppressed because DexNest replays the paste itself.
//
// Why a hook and not globalShortcut: registering Ctrl+1/2/3 globally would
// permanently swallow them and break browser tab switching. This hook only
// SUPPRESSES Ctrl+digit when it is actually completed by C/V; if no C/V follows
// (or Ctrl is released), the Ctrl+digit is re-injected so its normal effect
// (e.g. browser tab switch) still happens. Normal Ctrl+C / Ctrl+V are never
// touched unless they directly complete a slot sequence. It never reads or logs
// clipboard content — it only deals with virtual key codes.
//
// The hook runs in a hidden PowerShell child (C# via Add-Type) that prints
// "SEQ <slot> SAVE|PASTE" lines to stdout. Killing the child removes the hook.

import { spawn, type ChildProcess } from "node:child_process";

let hookProc: ChildProcess | null = null;

export function isSlotHookRunning(): boolean {
  return hookProc !== null;
}

// Builds the PowerShell + C# script. windowMs is the time after Ctrl+digit during
// which a following C/V completes the sequence.
function buildHookScript(windowMs: number): string {
  const win = Math.max(200, Math.min(3000, Math.round(windowMs)));
  return [
    "$ErrorActionPreference = 'Stop'",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -Language CSharp -TypeDefinition @\"",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class DexNestSlotHook {",
    "  const int WH_KEYBOARD_LL = 13;",
    "  const int WM_KEYDOWN = 0x0100, WM_SYSKEYDOWN = 0x0104, WM_KEYUP = 0x0101, WM_SYSKEYUP = 0x0105;",
    "  const int VK_CONTROL = 0x11, VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3;",
    "  const uint KEYEVENTF_KEYUP = 0x0002;",
    "  const int LLKHF_INJECTED = 0x10;",
    "  [StructLayout(LayoutKind.Sequential)] public struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }",
    "  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; }",
    "  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);",
    "  [DllImport(\"user32.dll\", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);",
    "  [DllImport(\"user32.dll\")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);",
    "  [DllImport(\"kernel32.dll\")] static extern IntPtr GetModuleHandle(string name);",
    "  [DllImport(\"user32.dll\")] static extern short GetAsyncKeyState(int vKey);",
    "  [DllImport(\"user32.dll\")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);",
    "  [DllImport(\"user32.dll\")] static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);",
    "  [DllImport(\"user32.dll\")] static extern bool TranslateMessage(ref MSG lpMsg);",
    "  [DllImport(\"user32.dll\")] static extern IntPtr DispatchMessage(ref MSG lpMsg);",
    "  static IntPtr hookId = IntPtr.Zero;",
    "  static HookProc proc = HookCallback;",
    "  static int armedSlot = 0;",
    "  static int armedTick = 0;",
    `  static int windowMs = ${win};`,
    "  static bool CtrlDown() { return (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0; }",
    "  static void Emit(int slot, string op) { Console.Out.WriteLine(\"SEQ \" + slot + \" \" + op); Console.Out.Flush(); }",
    "  static void TapCtrlDigit(int slot, bool pressCtrl) {",
    "    byte vk = (byte)(0x30 + slot);",
    "    if (pressCtrl) keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);",
    "    keybd_event(vk, 0, 0, UIntPtr.Zero);",
    "    keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);",
    "    if (pressCtrl) keybd_event((byte)VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);",
    "  }",
    "  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {",
    "    if (nCode >= 0) {",
    "      int msg = (int)wParam;",
    "      KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));",
    "      bool injected = (k.flags & LLKHF_INJECTED) != 0;",
    "      if (!injected && (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)) {",
    "        int vk = (int)k.vkCode;",
    "        int now = Environment.TickCount;",
    "        bool ctrl = CtrlDown();",
    "        if (ctrl && (vk == 0x31 || vk == 0x32 || vk == 0x33)) {",
    "          armedSlot = vk - 0x30; armedTick = now; return (IntPtr)1;",
    "        }",
    "        if (armedSlot != 0) {",
    "          bool fresh = (now - armedTick) <= windowMs;",
    "          if (ctrl && fresh && vk == 0x43) { int s = armedSlot; armedSlot = 0; Emit(s, \"SAVE\"); return CallNextHookEx(hookId, nCode, wParam, lParam); }",
    "          if (ctrl && fresh && vk == 0x56) { int s = armedSlot; armedSlot = 0; Emit(s, \"PASTE\"); return (IntPtr)1; }",
    "          int pend = armedSlot; armedSlot = 0;",
    "          if (fresh && ctrl) { TapCtrlDigit(pend, false); }",
    "        }",
    "      }",
    "      if (!injected && (msg == WM_KEYUP || msg == WM_SYSKEYUP)) {",
    "        int vk = (int)k.vkCode;",
    "        if ((vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL) && armedSlot != 0) {",
    "          int pend = armedSlot; armedSlot = 0; TapCtrlDigit(pend, true);",
    "        }",
    "      }",
    "    }",
    "    return CallNextHookEx(hookId, nCode, wParam, lParam);",
    "  }",
    "  public static void Run() {",
    "    hookId = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);",
    "    if (hookId == IntPtr.Zero) { Console.Error.WriteLine(\"HOOK_FAILED:\" + Marshal.GetLastWin32Error()); return; }",
    "    Console.Out.WriteLine(\"HOOK_READY\"); Console.Out.Flush();",
    "    MSG m;",
    "    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }",
    "  }",
    "}",
    "\"@",
    "[DexNestSlotHook]::Run()"
  ].join("\n");
}

export function startSlotHook(opts: {
  windowMs: number;
  onSequence: (slot: number, op: "SAVE" | "PASTE") => void;
  onReady: () => void;
  onExit: (error: string | null) => void;
}): { ok: boolean; error?: string } {
  if (process.platform !== "win32") {
    return { ok: false, error: "Clipboard slot sequences are currently Windows-only." };
  }
  if (hookProc) {
    return { ok: true };
  }
  const script = buildHookScript(opts.windowMs);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    hookProc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true }
    );
  } catch (error) {
    hookProc = null;
    return { ok: false, error: error instanceof Error ? error.message : "Failed to start keyboard hook." };
  }

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let reportedExit = false;

  hookProc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line === "HOOK_READY") {
        opts.onReady();
      } else {
        const match = /^SEQ ([123]) (SAVE|PASTE)$/.exec(line);
        if (match) {
          opts.onSequence(Number(match[1]), match[2] as "SAVE" | "PASTE");
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  hookProc.stderr?.on("data", (chunk: Buffer) => { stderrBuffer += chunk.toString("utf8"); });
  const finish = (fallback: string | null): void => {
    if (reportedExit) { return; }
    reportedExit = true;
    hookProc = null;
    opts.onExit(stderrBuffer.trim() || fallback);
  };
  hookProc.on("exit", (code) => finish(code && code !== 0 ? `Keyboard hook exited with code ${code}.` : null));
  hookProc.on("error", (error) => finish(error.message));
  return { ok: true };
}

export function stopSlotHook(): void {
  if (hookProc) {
    try { hookProc.kill(); } catch { /* already gone */ }
    hookProc = null;
  }
}
