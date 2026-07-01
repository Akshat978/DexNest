import React, { useState, useEffect } from "react";
import { ClipboardList, Share2, Search, Copy, Plus, Trash2, Save, Clipboard as ClipIcon, FileCode } from "lucide-react";
import {GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import {Panel, LimitedList, ToastStack } from "../components/shared";
import { PinButton } from "../components/pins";
import { formatBytes, shortcutLabel } from "../lib/format";
import type { ClipboardState, ClipboardHistoryItem, ClipboardSnippet } from "../main";

const emptySnippetForm = {
  id: "",
  title: "",
  text: ""
};

export function ClipboardView({
  clipboardState,
  onAction,
  onRefresh
}: {
  clipboardState: ClipboardState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"history" | "multi" | "slots" | "snippets" | "settings">("history");
  const [snippetForm, setSnippetForm] = useState(emptySnippetForm);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySource, setHistorySource] = useState("all");
  const [groupName, setGroupName] = useState("");
  const [separatorMode, setSeparatorMode] = useState<"blank" | "newline" | "comma" | "custom">("blank");
  const [customSeparator, setCustomSeparator] = useState("");
  const [autoClearMinutes, setAutoClearMinutes] = useState(String(clipboardState.settings.multiCopyAutoClearMinutes));
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  useEffect(() => {
    if (!clipboardState.settings.listenerEnabled) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      void onRefresh();
    }, Math.max(1000, clipboardState.settings.listenerIntervalMs));

    return () => window.clearInterval(refreshTimer);
  }, [clipboardState.settings.listenerEnabled, clipboardState.settings.listenerIntervalMs, onRefresh]);

  useEffect(() => {
    const unsubscribe = window.dexNest?.onClipboardHotkeyResult?.((payload) => {
      showStatus(payload.message, payload.tone);
      void onRefresh();
    });

    return () => {
      unsubscribe?.();
    };
  }, [onRefresh]);

  useEffect(() => {
    const separator = clipboardState.settings.combinedSeparator;
    if (separator === "\n\n") {
      setSeparatorMode("blank");
      setCustomSeparator("");
    } else if (separator === "\n") {
      setSeparatorMode("newline");
      setCustomSeparator("");
    } else if (separator === ", ") {
      setSeparatorMode("comma");
      setCustomSeparator("");
    } else {
      setSeparatorMode("custom");
      setCustomSeparator(separator);
    }
    setAutoClearMinutes(String(clipboardState.settings.multiCopyAutoClearMinutes));
  }, [clipboardState.settings.combinedSeparator, clipboardState.settings.multiCopyAutoClearMinutes]);

  function showStatus(message: string, tone: "success" | "error" = "success"): void {
    setStatus({ tone, message });
    window.setTimeout(() => setStatus((current) => current?.message === message ? null : current), 3000);
  }

  async function saveCurrentClipboard(): Promise<void> {
    const result = await onAction("clipboard.save_current") as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard saved." : result.error ?? "Clipboard save failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function pasteAsPlainText(): Promise<void> {
    const result = await onAction("clipboard.copy_plain_text") as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard normalized as plain text." : result.error ?? "Plain text copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveSnippet(): Promise<void> {
    const result = await onAction("clipboard.create_snippet", "module_ui", snippetForm) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Snippet saved." : result.error ?? "Snippet save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setSnippetForm(emptySnippetForm);
      await onRefresh();
    }
  }

  async function deleteSnippet(snippetId: string): Promise<void> {
    const confirmed = window.confirm("Delete this DexNest Clipboard snippet?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("clipboard.delete_snippet", "module_ui", { id: snippetId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Snippet deleted." : result.error ?? "Snippet delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function toggleListener(): Promise<void> {
    const enabled = !clipboardState.settings.listenerEnabled;
    const result = await onAction("clipboard.toggle_listener", "module_ui", { enabled }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Clipboard listener ${enabled ? "enabled" : "disabled"}.` : result.error ?? "Listener toggle failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function testReadClipboard(): Promise<void> {
    const result = await onAction("clipboard.test_read_current", "module_ui", {}) as { ok?: boolean; error?: string; preview?: string; byteLength?: number };
    showStatus(result.ok ? `Current clipboard: ${result.preview || "empty"} (${formatBytes(result.byteLength ?? 0)})` : result.error ?? "Clipboard read failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function startMultiCopy(): Promise<void> {
    const result = await onAction("clipboard.start_multi_copy", "module_ui", {}) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy started." : result.error ?? "Multi-copy start failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function stopMultiCopy(): Promise<void> {
    const result = await onAction("clipboard.stop_multi_copy", "module_ui", { name: groupName }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy stopped." : result.error ?? "Multi-copy stop failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function saveMultiCopyGroup(): Promise<void> {
    const result = await onAction("clipboard.save_multi_copy_group", "module_ui", { name: groupName }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy group saved." : result.error ?? "Multi-copy save failed.", result.ok ? "success" : "error");
    if (result.ok) {
      setGroupName("");
    }
    await onRefresh();
  }

  async function clearMultiCopySession(): Promise<void> {
    if (!window.confirm("Clear the active multi-copy session?")) {
      return;
    }
    const result = await onAction("clipboard.clear_multi_copy_session", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy session cleared." : result.error ?? "Multi-copy clear failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copyCombinedGroup(groupId?: string): Promise<void> {
    const result = await onAction("clipboard.copy_combined_group", "module_ui", { groupId }) as { ok?: boolean; error?: string; itemCount?: number };
    showStatus(result.ok ? `Combined ${result.itemCount ?? 0} items onto Clipboard.` : result.error ?? "Combined copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function deleteMultiCopyGroup(groupId: string): Promise<void> {
    if (!window.confirm("Delete this saved multi-copy group?")) {
      return;
    }
    const result = await onAction("clipboard.delete_multi_copy_group", "module_ui", { groupId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Multi-copy group deleted." : result.error ?? "Multi-copy group delete failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copyHistoryItem(itemId: string): Promise<void> {
    const result = await onAction("clipboard.copy_history_item", "module_ui", { id: itemId }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Copied item to clipboard." : result.error ?? "Copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function assignSlot(slot: number): Promise<void> {
    const actionId = slot >= 1 && slot <= 3 ? `clipboard.slot${slot}.save_current` : "clipboard.assign_slot";
    let result = await onAction(actionId, "module_ui", { slot }) as { ok?: boolean; status?: string; error?: string };
    if (!result.ok && result.status === "sensitive_confirmation_required") {
      const confirmed = window.confirm("This clipboard text looks sensitive. Save it to this DexNest slot anyway?");
      if (confirmed) {
        result = await onAction(actionId, "module_ui", { slot, confirmedSensitive: true }) as { ok?: boolean; error?: string };
      }
    }
    showStatus(result.ok ? `Saved to Slot ${slot}.` : result.error ?? "Slot assignment failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function copySlot(slot: number): Promise<void> {
    const actionId = slot >= 1 && slot <= 3 ? `clipboard.slot${slot}.paste` : "clipboard.copy_slot";
    const result = await onAction(actionId, "module_ui", { slot }) as { ok?: boolean; error?: string; pasteMode?: string };
    showStatus(result.ok ? `Slot ${slot} copied. Press Ctrl+V.` : result.error ?? "Slot copy failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function clearSlot(slot: number): Promise<void> {
    if (!window.confirm(`Clear DexNest Clipboard Slot ${slot}?`)) {
      return;
    }
    const result = await onAction("clipboard.clear_slot", "module_ui", { slot }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? `Cleared Slot ${slot}.` : result.error ?? "Slot clear failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm("Clear DexNest Clipboard history? Snippets, slots, and multi-copy groups stay.")) {
      return;
    }
    const result = await onAction("clipboard.clear_history", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "Clipboard history cleared." : result.error ?? "Clear history failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function deleteHistoryItem(itemId: string): Promise<void> {
    const result = await onAction("clipboard.delete_history_item", "module_ui", { id: itemId }) as { ok?: boolean; error?: string };
    showStatus(result.ok ? "History item removed." : result.error ?? "Could not remove item.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function cleanupHistoryNow(): Promise<void> {
    const result = await onAction("clipboard.cleanup_history", "module_ui", { force: true }) as { ok?: boolean; error?: string; removedCount?: number };
    showStatus(result.ok ? `Clipboard cleanup removed ${result.removedCount ?? 0} item${result.removedCount === 1 ? "" : "s"}.` : result.error ?? "Clipboard cleanup failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  async function updateClipboardSettings(params: Record<string, unknown>, successMessage: string): Promise<void> {
    const result = await onAction("clipboard.update_settings", "module_ui", params) as { ok?: boolean; error?: string };
    showStatus(result.ok ? successMessage : result.error ?? "Clipboard settings update failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function separatorFromMode(mode: typeof separatorMode, customValue = customSeparator): string {
    if (mode === "newline") {
      return "\n";
    }
    if (mode === "comma") {
      return ", ";
    }
    if (mode === "custom") {
      return customValue;
    }
    return "\n\n";
  }

  const activeSession = clipboardState.settings.activeMultiCopySession;
  const activeCombinedPreview = activeSession ? activeSession.items.map((item) => item.preview).join(" / ") : "";
  const activeArmedForPaste = Boolean(activeSession?.items.length && activeSession.armedForPasteAt);
  const activeTimeoutAt = activeSession
    ? new Date(new Date(activeSession.updatedAt).getTime() + clipboardState.settings.multiCopyAutoClearMinutes * 60 * 1000)
    : null;
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();
  const filteredHistory = clipboardState.history.filter((item) => {
    const matchesQuery = !normalizedHistoryQuery || item.preview.toLowerCase().includes(normalizedHistoryQuery) || item.id.toLowerCase().includes(normalizedHistoryQuery);
    const matchesSource = historySource === "all" || (item.source ?? "manual") === historySource;
    return matchesQuery && matchesSource;
  });
  const quickSlots = clipboardState.slots.filter((slot) => slot.slot >= 1 && slot.slot <= 3);
  const extendedSlots = clipboardState.slots.filter((slot) => slot.slot > 3);
  const quickSlotShortcutText = (slot: number) => `Save: Ctrl+Shift+${slot} / Paste: Ctrl+Alt+${slot}`;

  const ACCENT_CLIP = "#8B5CF6";
  const clipAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const day = Math.floor(diff / 86400000);
    if (day > 0) return `${day}d`;
    const hr = Math.floor(diff / 3600000);
    if (hr > 0) return `${hr}h`;
    return `${Math.max(1, Math.floor(diff / 60000))}m`;
  };
  const clipType = (item: ClipboardHistoryItem): { c: string; label: string } => {
    if (/^https?:\/\//i.test(item.text)) return { c: "#38BDF8", label: "link" };
    if (/[{}();=]|\s-\s|\.\w+$|\//.test(item.text) && item.text.length < 80) return { c: "#22D3EE", label: "code" };
    return { c: "#A3A3A3", label: "text" };
  };
  const selectedClip = filteredHistory.find((item) => item.id === selectedHistoryId) ?? filteredHistory[0] ?? null;
  const multiActive = Boolean(activeSession);
  async function insertSnippet(text: string, name: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); showStatus(`Inserted "${name}"`); } catch { showStatus("Copy failed", "error"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_CLIP}40`, background: `${ACCENT_CLIP}14`, color: ACCENT_CLIP }}>
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">Clipboard</h1>
            <p className="text-sm text-[#A3A3A3]">Persistent history, quick slots &amp; snippets — sensitive entries auto-protected</p>
          </div>
        </div>
        <StatusChip tone={multiActive ? "running" : "info"} pulse={multiActive}>{multiActive ? "Multi-copy active" : "Single copy"}</StatusChip>
      </div>

      {/* Quick slots */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {quickSlots.map((slot) => {
          const filled = Boolean(slot.value || slot.text);
          return (
            <GlassCard key={slot.slot} accent={ACCENT_CLIP} hover={false} className="flex flex-col">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs font-semibold tracking-wider" style={{ color: ACCENT_CLIP }}>SLOT {slot.slot}</span>
                <span className="text-[10px]" style={{ color: filled ? "#22C55E" : "#525252" }}>{filled ? "filled" : "empty"}</span>
              </div>
              <p className="mb-3 line-clamp-2 min-h-[32px] font-mono text-xs text-[#A3A3A3]">{slot.preview || "empty memory pad"}</p>
              <div className="mt-auto space-y-2">
                <div className="flex gap-2">
                  <ActionButton accent={ACCENT_CLIP} icon={Save} className="flex-1 justify-center text-xs" onClick={() => void assignSlot(slot.slot)}>Save</ActionButton>
                  <ActionButton accent={ACCENT_CLIP} variant="ghost" icon={ClipIcon} className="flex-1 justify-center text-xs" onClick={() => void copySlot(slot.slot)}>Paste</ActionButton>
                </div>
                <div className="flex items-center justify-between font-mono text-[9px] text-[#525252]"><span>Ctrl+Shift+{slot.slot}</span><span>Ctrl+Alt+{slot.slot}</span></div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* History */}
        <div className="lg:col-span-7">
          <SectionTitle action={<span className="font-mono text-[10px] text-[#525252]">retention {clipboardState.settings.historyRetentionDays === "never" ? "∞" : `${clipboardState.settings.historyRetentionDays}d`} · {filteredHistory.length} items</span>}>History</SectionTitle>
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#262626] bg-[#0d0d0d] px-3 py-1.5 focus-within:border-[#8B5CF6]/40">
            <Search className="h-3.5 w-3.5 text-[#525252]" />
            <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Filter history…" className="flex-1 bg-transparent text-xs text-[#F5F5F5] placeholder:text-[#525252] focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            {filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#262626] py-12 text-center"><ClipboardList className="h-7 w-7 text-[#525252]" /><p className="mt-2 text-sm text-[#A3A3A3]">No clipboard history matches.</p></div>
            ) : (
              <LimitedList items={filteredHistory} step={50}>
                {(item) => {
                  const tm = clipType(item);
                  const active = selectedClip?.id === item.id;
                  return (
                    <button key={item.id} type="button" onClick={() => setSelectedHistoryId(item.id)} className={`glass-card flex w-full items-center gap-3 p-3 text-left transition-colors ${active ? "border-[#8B5CF6]/40 bg-[#8B5CF6]/[0.06]" : ""}`}>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${tm.c}14`, color: tm.c }}><FileCode className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#F5F5F5]">{item.preview || "Clipboard item"}</p>
                        <p className="font-mono text-[10px] text-[#525252]">{clipAgo(item.createdAt)} ago · {formatBytes(item.byteLength)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ color: tm.c, borderColor: `${tm.c}33`, background: `${tm.c}10` }}>{tm.label}</span>
                    </button>
                  );
                }}
              </LimitedList>
            )}
          </div>
        </div>

        {/* Preview + protection + snippets */}
        <div className="space-y-5 lg:col-span-5">
          <GlassCard accent={ACCENT_CLIP} hover={false}>
            <SectionTitle action={<StatusChip tone="ready">Plain</StatusChip>}>Preview</SectionTitle>
            {selectedClip ? (
              <>
                <pre className="max-h-40 overflow-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-xs text-[#F5F5F5] whitespace-pre-wrap">{selectedClip.preview || selectedClip.text}</pre>
                <p className="mt-2 font-mono text-[10px] text-[#525252]">{clipType(selectedClip).label} · captured {clipAgo(selectedClip.createdAt)} ago · {selectedClip.source ?? "clipboard"}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ActionButton accent={ACCENT_CLIP} icon={ClipIcon} className="justify-center text-xs" onClick={() => void copyHistoryItem(selectedClip.id)}>Copy</ActionButton>
                  <ActionButton accent="#38BDF8" icon={Share2} className="justify-center text-xs" onClick={() => { void copyHistoryItem(selectedClip.id).then(() => onAction("drop.send_clipboard_to_drop")); }}>To Drop</ActionButton>
                  <ActionButton accent="#EF4444" variant="ghost" icon={Trash2} className="justify-center text-xs" onClick={() => void deleteHistoryItem(selectedClip.id)}>Delete</ActionButton>
                  <ActionButton accent="#EF4444" variant="ghost" icon={Trash2} className="justify-center text-xs" onClick={() => void clearHistory()}>Clear all</ActionButton>
                </div>
              </>
            ) : <p className="text-xs text-[#525252]">Select a history item to preview it.</p>}
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle>Protection</SectionTitle>
            <div className="divide-y divide-[#141414]">
              <div className="flex items-center justify-between py-3 first:pt-0">
                <div className="pr-4"><p className="text-sm text-[#F5F5F5]">Multi-copy session</p><p className="text-xs text-[#525252]">Stack several copies into one buffer</p></div>
                <button type="button" role="switch" aria-checked={multiActive} onClick={() => void (multiActive ? stopMultiCopy() : startMultiCopy())} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: multiActive ? ACCENT_CLIP : "#262626" }}>
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: multiActive ? "1.125rem" : "0.125rem" }} />
                </button>
              </div>
              <div className="flex items-center justify-between py-3 last:pb-0">
                <div className="pr-4"><p className="text-sm text-[#F5F5F5]">Sensitive protection</p><p className="text-xs text-[#525252]">Auto-mask tokens, keys &amp; ID numbers</p></div>
                <button type="button" role="switch" aria-checked={clipboardState.settings.secretProtectionEnabled} onClick={() => void updateClipboardSettings({ secretProtectionEnabled: !clipboardState.settings.secretProtectionEnabled }, "Sensitive protection updated.")} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: clipboardState.settings.secretProtectionEnabled ? ACCENT_CLIP : "#262626" }}>
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: clipboardState.settings.secretProtectionEnabled ? "1.125rem" : "0.125rem" }} />
                </button>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="pr-4"><p className="text-sm text-[#F5F5F5]">Clipboard listener</p><p className="text-xs text-[#525252]">Auto-capture new copies to history</p></div>
                <button type="button" role="switch" aria-checked={clipboardState.settings.listenerEnabled} onClick={() => void toggleListener()} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: clipboardState.settings.listenerEnabled ? ACCENT_CLIP : "#262626" }}>
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: clipboardState.settings.listenerEnabled ? "1.125rem" : "0.125rem" }} />
                </button>
              </div>
              <div className="flex items-center justify-between py-3 last:pb-0">
                <div className="pr-4">
                  <p className="text-sm text-[#F5F5F5]">Slot shortcut sequences</p>
                  <p className="text-xs text-[#525252]">Hold Ctrl, tap 1/2/3, then C to save or V to paste that slot. Normal Ctrl+C/V and browser tabs keep working.{clipboardState.settings.slotSequenceStatus === "failed" && clipboardState.settings.slotSequenceLastError ? ` · ${clipboardState.settings.slotSequenceLastError}` : clipboardState.settings.slotSequenceEnabled ? ` · ${clipboardState.settings.slotSequenceStatus}` : ""}</p>
                </div>
                <button type="button" role="switch" aria-checked={clipboardState.settings.slotSequenceEnabled} onClick={() => void updateClipboardSettings({ slotSequenceEnabled: !clipboardState.settings.slotSequenceEnabled }, clipboardState.settings.slotSequenceEnabled ? "Slot sequences disabled." : "Slot sequences enabled.")} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: clipboardState.settings.slotSequenceEnabled ? ACCENT_CLIP : "#262626" }}>
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: clipboardState.settings.slotSequenceEnabled ? "1.125rem" : "0.125rem" }} />
                </button>
              </div>
            </div>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={<details className="relative"><summary className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-2 py-1 text-[10px] font-medium text-[#8B5CF6]"><Plus className="h-3 w-3" />New</summary><div className="absolute right-0 z-10 mt-1 w-56 space-y-1.5 rounded-lg border border-[#262626] bg-[#0a0a0a] p-2"><input value={snippetForm.title} onChange={(event) => setSnippetForm({ ...snippetForm, title: event.target.value })} placeholder="Snippet title" /><textarea value={snippetForm.text} onChange={(event) => setSnippetForm({ ...snippetForm, text: event.target.value })} placeholder="Snippet text" /><button type="button" onClick={() => void saveSnippet()}>Save snippet</button></div></details>}>Snippets</SectionTitle>
            <div className="space-y-1.5">
              {clipboardState.snippets.length === 0 ? <p className="text-xs text-[#525252]">No snippets yet.</p> : clipboardState.snippets.map((s) => (
                <div key={s.id} className="glass-card flex w-full items-center gap-2 p-2.5">
                  <button type="button" onClick={() => void insertSnippet(s.text, s.title)} className="min-w-0 flex-1 truncate text-left text-sm text-[#F5F5F5]" title={s.text}>{s.title}</button>
                  <button type="button" onClick={() => void insertSnippet(s.text, s.title)} title="Copy" className="text-[#525252] hover:text-[#8B5CF6]"><ClipIcon className="h-3.5 w-3.5" /></button>
                  <PinButton input={{ type: "item", module: "clipboard", entityId: s.id, title: s.title, subtitle: "Snippet" }} />
                  <button type="button" onClick={() => void deleteSnippet(s.id)} title="Delete" className="min-h-0 border-0 bg-transparent px-1 text-[#A3A3A3] hover:text-[#EF4444]"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Advanced (multi-copy groups, settings, slots 4+) */}
      <details className="rounded-lg border border-[#1a1a1a] bg-[#080808]">
        <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] text-[#525252] hover:text-[#A3A3A3]">advanced · multi-copy groups, settings, extra slots</summary>
        <div className="space-y-4 border-t border-[#1a1a1a] p-3">
          <Panel title="Multi-copy group">
            <div className="button-row">
              <button type="button" disabled={Boolean(activeSession)} onClick={() => void startMultiCopy()}>Start group</button>
              <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Group name" />
              <button type="button" disabled={!activeSession?.items.length} onClick={() => void copyCombinedGroup()}>Copy combined</button>
              <button type="button" disabled={!activeSession?.items.length} onClick={() => void saveMultiCopyGroup()}>Save group</button>
              <button className="danger-button" type="button" disabled={!activeSession?.items.length} onClick={() => void clearMultiCopySession()}>Clear</button>
              <button type="button" disabled={!activeSession} onClick={() => void stopMultiCopy()}>Stop</button>
            </div>
            <p className="technical">Select text anywhere and press {shortcutLabel(clipboardState.settings.multiCopyHotkey)}.</p>
            {activeSession?.items.length ? (
              <div className="action-list action-list--compact">
                {activeSession.items.map((item) => (
                  <article className="data-item data-item--compact accent-clipboard" key={item.id}><strong>{item.preview || "Item"}</strong><span>{formatBytes(item.byteLength)}</span></article>
                ))}
              </div>
            ) : null}
          </Panel>
          {clipboardState.multiGroups.length > 0 && (
            <Panel title="Saved multi-copy groups">
              <div className="action-list action-list--compact">
                {clipboardState.multiGroups.map((group) => (
                  <article className="data-item data-item--stacked accent-clipboard" key={group.id}>
                    <div className="section-heading section-heading--row">
                      <strong>{group.name}</strong>
                      <div className="button-row">
                        <button type="button" onClick={() => void copyCombinedGroup(group.id)}>Copy combined</button>
                        <button className="danger-button" type="button" onClick={() => void deleteMultiCopyGroup(group.id)}>Delete</button>
                      </div>
                    </div>
                    <span>{group.items.length} items</span>
                  </article>
                ))}
              </div>
            </Panel>
          )}
          {extendedSlots.length > 0 && (
            <Panel title="Extra slots">
              <div className="action-list action-list--compact">
                {extendedSlots.map((slot) => (
                  <article className="data-item data-item--stacked accent-clipboard" key={slot.slot}>
                    <strong>Slot {slot.slot}</strong>
                    <span className="clipboard-slot-preview">{slot.preview || "Empty slot"}</span>
                    <div className="button-row">
                      <button type="button" onClick={() => void assignSlot(slot.slot)}>Save current</button>
                      <button type="button" disabled={!(slot.value || slot.text)} onClick={() => void copySlot(slot.slot)}>Copy</button>
                      <button className="danger-button" type="button" disabled={!(slot.value || slot.text)} onClick={() => void clearSlot(slot.slot)}>Clear</button>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="History &amp; settings">
            <div className="button-row">
              <button type="button" onClick={() => void saveCurrentClipboard()}>Save current</button>
              <button type="button" onClick={() => void pasteAsPlainText()}>Copy as plain text</button>
              <button type="button" onClick={() => void testReadClipboard()}>Test read</button>
              <button type="button" onClick={() => void cleanupHistoryNow()}>Cleanup now</button>
              <button className="danger-button" type="button" onClick={() => void clearHistory()}>Clear history</button>
            </div>
            <div className="registry-controls">
              <label>Separator
                <select value={separatorMode} onChange={(event) => { const m = event.target.value as typeof separatorMode; setSeparatorMode(m); void updateClipboardSettings({ combinedSeparator: separatorFromMode(m) }, "Separator updated."); }}>
                  <option value="blank">Blank line</option><option value="newline">Single newline</option><option value="comma">Comma</option><option value="custom">Custom</option>
                </select>
              </label>
              {separatorMode === "custom" && <label>Custom<input value={customSeparator} onChange={(event) => setCustomSeparator(event.target.value)} onBlur={() => void updateClipboardSettings({ combinedSeparator: customSeparator }, "Custom separator saved.")} /></label>}
              <label>Auto-clear minutes<input type="number" min="1" max="240" value={autoClearMinutes} onChange={(event) => setAutoClearMinutes(event.target.value)} onBlur={() => void updateClipboardSettings({ multiCopyAutoClearMinutes: Number(autoClearMinutes) || 5 }, "Auto-clear updated.")} /></label>
            </div>
            <p className="technical">{clipboardState.historyPath}</p>
          </Panel>
        </div>
      </details>

      {status && <ToastStack toasts={[{ id: status.message, message: status.message, tone: status.tone }]} />}
    </div>
  );

}
