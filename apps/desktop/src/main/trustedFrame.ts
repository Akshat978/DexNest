// The trusted-main-frame check every module host applies to its IPC.
//
// A message is accepted only from DexNest's own window, and only from its
// main frame - never from a subframe, a webview, or a window that has been
// destroyed. Developer Intelligence and Autopilot inline the same test; the
// Projects host uses this shared, tested form.

export interface IpcSenderLike {
  sender: unknown;
  senderFrame: unknown;
}

export interface TrustedWindowLike {
  isDestroyed(): boolean;
  webContents: { mainFrame: unknown };
}

export function isTrustedMainFrame(event: IpcSenderLike, window: TrustedWindowLike | null): boolean {
  if (!window || window.isDestroyed()) return false;
  if (event.sender !== window.webContents) return false;
  return event.senderFrame === window.webContents.mainFrame;
}
