import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import { Image as ImageIcon, ClipboardCopy, Copy, Download, FileText, FolderOpen, Inbox, Monitor, QrCode, RefreshCw, Share2, ShieldCheck, Smartphone, Trash2, Upload } from "lucide-react";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { ToastStack } from "../components/shared";
import { getBridge } from "../lib/bridge";
import { formatBytes, formatDate } from "../lib/format";
import type { DropState } from "../main";

export function DropView({
  dropState,
  endpoint,
  onAction,
  onRefresh
}: {
  dropState: DropState;
  endpoint?: string;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [dropText, setDropText] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: "success" | "error" }>>([]);
  // Files the user has selected but NOT yet sent. Nothing leaves the PC until
  // "Send files" is pressed; these are just staged local paths (no disk copy).
  const [pendingFiles, setPendingFiles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!dropState.phoneUrl) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(dropState.phoneUrl, { margin: 1, width: 180 }).then(setQrDataUrl);
  }, [dropState.phoneUrl]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    let fallbackTimer: number | null = null;
    const eventsUrl = dropState.localUrl
      ? dropState.localUrl.replace(/\/drop$/, "/drop/api/events")
      : `${endpoint ?? "http://127.0.0.1:43217"}/drop/api/events`;
    let eventSource: EventSource;

    try {
      eventSource = new EventSource(eventsUrl);
    } catch {
      fallbackTimer = window.setInterval(() => {
        void onRefresh();
      }, 3000);
      return () => {
        if (fallbackTimer !== null) {
          window.clearInterval(fallbackTimer);
        }
      };
    }

    eventSource.onmessage = (event) => {
      let payload: { eventType?: string; message?: string } = {};
      try {
        payload = JSON.parse(event.data) as { eventType?: string; message?: string };
      } catch {
        return;
      }
      void onRefresh();
      if (payload.eventType && payload.eventType !== "drop.connected" && payload.message) {
        showToast(payload.message);
      }
    };

    eventSource.onerror = () => {
      if (fallbackTimer === null) {
        fallbackTimer = window.setInterval(() => {
          void onRefresh();
        }, 3000);
      }
    };

    return () => {
      eventSource.close();
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
      }
    };
  }, [autoRefresh, dropState.localUrl, endpoint, onRefresh]);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  async function toggleAutoRefresh(enabled: boolean): Promise<void> {
    setAutoRefresh(enabled);
    await getBridge().logDropAutoRefresh(enabled);
    showToast(`Auto-refresh ${enabled ? "enabled" : "disabled"}`);
  }

  async function copyTextToClipboard(value: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showToast(message);
    } catch {
      showToast("Copy failed", "error");
    }
  }

  async function createTextDrop(): Promise<void> {
    const result = await onAction("drop.create_text_drop", "module_ui", { text: dropText }) as { ok?: boolean; error?: string };
    if (result?.ok === false) {
      showToast(result.error ?? "Text send failed", "error");
      return;
    }
    setDropText("");
    showToast("Text sent");
    await onRefresh();
  }

  async function sendClipboardToDrop(): Promise<void> {
    const result = await onAction("drop.send_clipboard_to_drop") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clipboard send failed" : "Text sent", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  // Stage files into the pending list — does NOT send them.
  async function selectFilesToSend(): Promise<void> {
    const result = await getBridge().pickDropOutgoingFiles();
    if (!result.ok || !result.paths?.length) {
      if (result.error && result.error !== "No file selected.") {
        showToast(result.error, "error");
      }
      return;
    }
    setPendingFiles((current) => {
      const merged = [...current];
      for (const path of result.paths ?? []) {
        if (!merged.includes(path)) {
          merged.push(path);
        }
      }
      return merged;
    });
    const added = result.paths.length;
    showToast(`${added} file${added === 1 ? "" : "s"} selected — not sent yet`);
  }

  function removePendingFile(path: string): void {
    setPendingFiles((current) => current.filter((entry) => entry !== path));
  }

  function clearPendingFiles(): void {
    setPendingFiles([]);
  }

  // Explicitly send every staged file to the outgoing shelf (phone can then pull).
  async function sendPendingFiles(): Promise<void> {
    if (!pendingFiles.length || sending) {
      return;
    }
    setSending(true);
    const remaining: string[] = [];
    let sent = 0;
    for (const path of pendingFiles) {
      const result = await onAction("drop.add_outgoing_file", "module_ui", { path }) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        remaining.push(path);
        showToast(result.error ?? "File send failed", "error");
      } else {
        sent += 1;
      }
    }
    setPendingFiles(remaining);
    setSending(false);
    if (sent > 0) {
      showToast(`Sent ${sent} file${sent === 1 ? "" : "s"} to phone`);
    }
    await onRefresh();
  }

  async function removeOutgoingFile(fileId: string): Promise<void> {
    const confirmed = window.confirm("Remove this outgoing Drop file copy?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.remove_outgoing_file", "module_ui", { id: fileId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File remove failed" : "File removed", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function clearOutgoing(): Promise<void> {
    const confirmed = window.confirm("Clear outgoing DexNest Drop text and file items?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_outgoing", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear outgoing failed" : "Outgoing cleared", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function clearIncoming(): Promise<void> {
    const confirmed = window.confirm("Clear incoming DexNest Drop metadata? Received files stay on disk.");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_incoming", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear incoming failed" : "Incoming list cleared", result?.ok === false ? "error" : "success");
    await onRefresh();
  }

  async function copyIncomingText(itemId: string): Promise<void> {
    const result = await getBridge().copyDropIncomingText(itemId);
    showToast(result.ok ? "Copied incoming text" : result.error ?? "Copy failed", result.ok ? "success" : "error");
  }

  async function chooseReceiveFolder(): Promise<void> {
    try {
      const result = await getBridge().chooseDropReceiveFolder();
      if (result.ok) {
        await onRefresh();
        showToast("Receive folder changed");
      } else {
        showToast(result.error ?? "Receive folder change cancelled", "error");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Receive folder change failed", "error");
    }
  }

  async function resetReceiveFolder(): Promise<void> {
    const result = await getBridge().resetDropReceiveFolder();
    await onRefresh();
    showToast(result.ok ? "Receive folder changed" : "Receive folder reset failed", result.ok ? "success" : "error");
  }

  const outgoingCount = dropState.outgoingText.length + dropState.outgoingFiles.length;
  const incomingText = dropState.incoming.filter((item) => item.type === "text");
  const incomingFiles = dropState.incoming.filter((item) => item.type === "file");

  const dropConnected = Boolean(dropState.phoneUrl);
  const ACCENT_DROP = "#38BDF8";
  return (
    <div className="space-y-6">
      <ToastStack toasts={toasts} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_DROP}40`, background: `${ACCENT_DROP}14`, color: ACCENT_DROP }}>
            <Share2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">Drop</h1>
            <p className="text-sm text-[#A3A3A3]">Private local bridge between this PC and your phone — like AirDrop, on your LAN</p>
          </div>
        </div>
        <StatusChip tone={dropConnected ? "ready" : "offline"} pulse={dropConnected}>{dropConnected ? "Connected · LAN" : "Offline"}</StatusChip>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-[#10B981]/25 bg-[#10B981]/[0.07] px-3.5 py-2 text-xs text-[#34D399]">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Local-only · transfers stay on your network, no relay servers
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Pair device */}
        <GlassCard accent={ACCENT_DROP} hover={false} className="lg:col-span-4">
          <SectionTitle action={<StatusChip tone={dropConnected ? "ready" : "offline"}>{dropConnected ? "Connected" : "Waiting"}</StatusChip>}>Pair device</SectionTitle>
          <div className="flex flex-col items-center text-center">
            <div className="relative my-1 flex h-40 w-40 items-center justify-center rounded-2xl border border-[#262626] bg-[#0a0a0a]">
              {qrDataUrl ? <img src={qrDataUrl} alt="Drop phone URL QR code" className="h-36 w-36 rounded-lg" /> : <QrCode className="h-28 w-28 text-[#525252]" strokeWidth={1} />}
              <span className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 26px ${ACCENT_DROP}1f` }} />
            </div>
            <p className="mt-2 text-xs text-[#A3A3A3]">{dropConnected ? "Scan with your phone to connect" : "Scan with phone to connect"}</p>
          </div>
          <div className="mt-4 space-y-2">
            <div className="glass-card flex items-center gap-2.5 p-2.5">
              <Smartphone className="h-4 w-4 shrink-0 text-[#38BDF8]" />
              <div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-wider text-[#525252]">Phone URL</p><p className="truncate font-mono text-xs text-[#F5F5F5]">{dropState.phoneUrl || "Loading"}</p></div>
              <button type="button" onClick={() => void copyTextToClipboard(dropState.phoneUrl || "", "Phone URL copied")} title="Copy Phone URL" aria-label="Copy Phone URL" className="drop-url-copy-button"><Copy className="h-4 w-4" /><span className="hidden sm:inline">Copy</span></button>
            </div>
            <div className="glass-card flex items-center gap-2.5 p-2.5">
              <Monitor className="h-4 w-4 shrink-0 text-[#38BDF8]" />
              <div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-wider text-[#525252]">PC URL</p><p className="truncate font-mono text-xs text-[#F5F5F5]">{dropState.localUrl || endpoint || "Loading"}</p></div>
              <button type="button" onClick={() => void copyTextToClipboard(dropState.localUrl || endpoint || "", "PC URL copied")} title="Copy PC URL" aria-label="Copy PC URL" className="drop-url-copy-button"><Copy className="h-4 w-4" /><span className="hidden sm:inline">Copy</span></button>
            </div>
            <p className="font-mono text-[10px] text-[#525252]">LAN IP · {dropState.lanIp ?? "not detected"}</p>
          </div>
        </GlassCard>

        {/* Transfer */}
        <div className="space-y-5 lg:col-span-8">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <ActionButton accent={ACCENT_DROP} variant="solid" icon={ClipboardCopy} className="h-10 justify-center" onClick={() => void sendClipboardToDrop()}>Send clipboard</ActionButton>
            <ActionButton accent={ACCENT_DROP} variant="soft" icon={Upload} className="h-10 justify-center" onClick={() => void selectFilesToSend()}>Select files</ActionButton>
            <ActionButton accent={ACCENT_DROP} variant="ghost" icon={FolderOpen} className="h-10 justify-center" onClick={() => void chooseReceiveFolder()}>Receive folder</ActionButton>
          </div>

          {/* Pending selection — staged locally, nothing sent until "Send files". */}
          {pendingFiles.length > 0 && (
            <GlassCard accent={ACCENT_DROP} hover={false}>
              <SectionTitle action={<button type="button" onClick={clearPendingFiles} className="rounded-md px-2 py-1 text-[11px] text-[#A3A3A3] transition-colors hover:bg-[#1a1a1a] hover:text-[#F5F5F5]">Clear all</button>}>
                Ready to send · {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"}
              </SectionTitle>
              <div className="space-y-1.5">
                {pendingFiles.map((path) => {
                  const name = path.split(/[\\/]/).pop() || path;
                  const isImage = /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name);
                  const Icon = isImage ? ImageIcon : FileText;
                  return (
                    <div key={path} className="glass-card flex items-center gap-3 p-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#38BDF8]/12 text-[#38BDF8]"><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#F5F5F5]">{name}</p><p className="truncate font-mono text-[10px] text-[#525252]">{path}</p></div>
                      <button type="button" onClick={() => removePendingFile(path)} title="Remove from selection" aria-label={`Remove ${name} from selection`} className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:border-[#EF4444]/50 hover:bg-[#EF4444]/10 hover:text-[#EF4444]"><Trash2 className="h-3.5 w-3.5" />Remove</button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <ActionButton accent={ACCENT_DROP} variant="solid" icon={Upload} className="h-10 w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed" onClick={() => void sendPendingFiles()} disabled={sending}>
                  {sending ? "Sending…" : `Send ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"}`}
                </ActionButton>
              </div>
            </GlassCard>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <GlassCard hover={false}>
              <SectionTitle action={<button type="button" onClick={() => void clearIncoming()} title="Clear the whole incoming list (received files stay on disk)" className="rounded-md px-2 py-1 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:bg-[#1a1a1a] hover:text-[#F5F5F5]">Clear list</button>}>Incoming</SectionTitle>
              <div className="space-y-1.5">
                {dropState.incoming.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#1f1f1f] py-8 text-center"><Inbox className="h-5 w-5 text-[#525252]" /><p className="text-xs text-[#525252]">No incoming files</p></div>
                ) : dropState.incoming.slice(0, 30).map((item) => {
                  const Icon = item.type === "text" ? ClipboardCopy : (item.originalName ?? item.fileName ?? "").match(/\.(png|jpe?g|gif|webp|bmp)$/i) ? ImageIcon : FileText;
                  return (
                    <div key={item.id} className="glass-card flex items-center gap-3 p-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#38BDF8]/12 text-[#38BDF8]"><Icon className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#F5F5F5]">{item.type === "text" ? (item.preview || "Text") : (item.originalName ?? item.fileName ?? "File")}</p><p className="font-mono text-[10px] text-[#525252]">{formatBytes(item.byteLength)} · from phone · {formatDate(item.createdAt)}</p></div>
                      <div className="flex shrink-0 items-center gap-1">
                        {item.type === "text"
                          ? <button type="button" onClick={() => void copyIncomingText(item.id)} title="Copy" className="flex h-7 w-7 items-center justify-center rounded-md text-[#A3A3A3] hover:bg-[#1a1a1a] hover:text-[#38BDF8]"><Copy className="h-4 w-4" /></button>
                          : <button type="button" onClick={() => void onAction("drop.open_incoming_folder")} title="Open folder" className="flex h-7 w-7 items-center justify-center rounded-md text-[#A3A3A3] hover:bg-[#1a1a1a] hover:text-[#38BDF8]"><Download className="h-4 w-4" /></button>}
                        <button type="button" title="Remove from this list (keeps the file on disk)" aria-label="Remove from list" onClick={() => void (async () => { const r = await onAction("drop.remove_incoming_item", "module_ui", { id: item.id }) as { ok?: boolean }; if (r.ok) { await onRefresh(); } })()} className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:border-[#3a3a3a] hover:bg-[#1a1a1a] hover:text-[#F5F5F5]">Remove</button>
                        {item.type === "file" && <button type="button" title="Delete the received file from disk (permanent)" aria-label="Delete file from disk" onClick={() => void (async () => { if (!window.confirm("Delete this received file from disk? This cannot be undone.")) { return; } const r = await onAction("drop.delete_incoming_file", "module_ui", { id: item.id, confirmedDangerous: true }) as { ok?: boolean }; if (r.ok) { await onRefresh(); } })()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#EF4444]/30 text-[#EF4444]/80 transition-colors hover:border-[#EF4444]/60 hover:bg-[#EF4444]/15 hover:text-[#EF4444]"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            <GlassCard hover={false}>
              <SectionTitle action={<button type="button" onClick={() => void clearOutgoing()} title="Clear the whole outgoing shelf" className="rounded-md px-2 py-1 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:bg-[#1a1a1a] hover:text-[#F5F5F5]">Clear shelf</button>}>Outgoing shelf</SectionTitle>
              <div className="space-y-1.5">
                {outgoingCount === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#1f1f1f] py-8 text-center"><Inbox className="h-5 w-5 text-[#525252]" /><p className="text-xs text-[#525252]">Shelf is empty</p></div>
                ) : (
                  <>
                    {dropState.outgoingText.map((item) => (
                      <div key={item.id} className="glass-card flex items-center gap-3 p-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#38BDF8]/12 text-[#38BDF8]"><ClipboardCopy className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#F5F5F5]">{item.preview || "Text drop"}</p><p className="font-mono text-[10px] text-[#525252]">{formatBytes(item.byteLength)} · to phone</p></div>
                        <button type="button" onClick={() => void copyTextToClipboard(item.id, "Drop ID copied")} title="Copy ID" className="flex h-7 w-7 items-center justify-center rounded-md text-[#A3A3A3] hover:bg-[#1a1a1a] hover:text-[#38BDF8]"><Copy className="h-4 w-4" /></button>
                      </div>
                    ))}
                    {dropState.outgoingFiles.map((item) => (
                      <div key={item.id} className="glass-card flex items-center gap-3 p-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#38BDF8]/12 text-[#38BDF8]"><FileText className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#F5F5F5]">{item.originalName ?? item.fileName ?? "Outgoing file"}</p><p className="font-mono text-[10px] text-[#525252]">{formatBytes(item.byteLength)} · to phone</p></div>
                        <button type="button" onClick={() => void removeOutgoingFile(item.id)} title="Remove from the outgoing shelf" aria-label="Remove from shelf" className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:border-[#EF4444]/50 hover:bg-[#EF4444]/10 hover:text-[#EF4444]"><Trash2 className="h-3.5 w-3.5" />Remove</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </GlassCard>
          </div>

          <GlassCard hover={false}>
            <SectionTitle action={<StatusChip tone={autoRefresh ? "ready" : "offline"}>auto-receive {autoRefresh ? "on" : "off"}</StatusChip>}>Receive folder</SectionTitle>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#38BDF8]/12 text-[#38BDF8]"><FolderOpen className="h-4 w-4" /></div>
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-[#A3A3A3]">{dropState.receiveFolderPath}</p>
              <ActionButton accent={ACCENT_DROP} variant="ghost" icon={RefreshCw} className="text-xs" onClick={() => void chooseReceiveFolder()}>Change</ActionButton>
              <ActionButton accent={ACCENT_DROP} variant="ghost" icon={FolderOpen} className="text-xs" onClick={() => void onAction("drop.open_incoming_folder")}>Open</ActionButton>
            </div>
          </GlassCard>

          {/* Advanced (text drop, reset, auto-refresh) */}
          <details className="rounded-lg border border-[#1a1a1a] bg-[#080808]">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] text-[#525252] hover:text-[#A3A3A3]">advanced · send text, reset folder, auto-refresh</summary>
            <div className="space-y-3 border-t border-[#1a1a1a] p-3">
              <textarea className="technical" placeholder="Write text to make available on your phone" value={dropText} onChange={(event) => setDropText(event.target.value)} />
              <div className="button-row">
                <button type="button" onClick={() => void createTextDrop()}>Send text</button>
                <button type="button" onClick={() => void resetReceiveFolder()}>Reset receive folder</button>
                <button type="button" onClick={() => void toggleAutoRefresh(!autoRefresh)}>Auto-refresh {autoRefresh ? "On" : "Off"}</button>
                <button type="button" onClick={() => void onRefresh().then(() => showToast("Drop refreshed"))}>Refresh</button>
              </div>
              <p className="technical">Outgoing: {dropState.outgoingFolderPath}</p>
              <p className="technical">Default: {dropState.defaultReceiveFolderPath}</p>
              {dropState.customReceiveFolderPath && <p className="technical">Custom: {dropState.customReceiveFolderPath}</p>}
            </div>
          </details>
        </div>
      </div>
    </div>
  );

}
