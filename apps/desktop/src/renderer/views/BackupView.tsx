import React, { useState } from "react";
import { Vault,Search,AlertTriangle,Plus,FolderOpen,ShieldCheck,Trash2,RotateCcw,HardDriveDownload } from "lucide-react";
import { formatLocalDateTime } from "@dexnest/shared-types";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { ProgressRing } from "../components/ui/ProgressRing";
import { getBridge } from "../lib/bridge";
import { formatBytes } from "../lib/format";
import type { BackupOptions, BackupPreview, BackupState } from "../main";

export function BackupView({
  backupState,
  onAction,
  onRefresh
}: {
  backupState: BackupState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const ACCENT_BACKUP = "#0EA5E9";
  const [options, setOptions] = useState<BackupOptions>(backupState.defaultOptions);
  const [restorePath, setRestorePath] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = backupState.backups[0];

  async function createBackup(): Promise<void> {
    setBusy(true);
    setMessage("Creating DexNest backup…");
    const result = await onAction("backup.create", "module_ui", options) as { ok?: boolean; error?: string };
    setMessage(result.ok ? "Backup created." : result.error ?? "Backup failed.");
    setBusy(false);
    await onRefresh();
  }
  async function chooseBackup(): Promise<void> {
    const selected = await getBridge().selectBackupZip();
    if (selected) { setRestorePath(selected); setPreview(null); void previewRestore(selected); }
  }
  async function deleteBackup(target: { path: string; fileName: string }): Promise<void> {
    if (!window.confirm(`Delete backup "${target.fileName}" from disk? This cannot be undone.`)) { return; }
    const result = await onAction("backup.delete_file", "module_ui", { path: target.path, fileName: target.fileName, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    if (result.ok) {
      if (restorePath === target.path) { setRestorePath(""); setPreview(null); }
      setMessage("Backup deleted.");
      await onRefresh();
    } else {
      setMessage(result.error ?? "Could not delete backup.");
    }
  }
  async function previewRestore(path = restorePath): Promise<void> {
    if (!path) { return; }
    const result = await onAction("backup.preview_restore", "module_ui", { path }) as { ok?: boolean; preview?: BackupPreview; error?: string };
    if (result.ok && result.preview) { setPreview(result.preview); } else { setMessage(result.error ?? "Preview failed."); }
  }
  async function restoreBackup(): Promise<void> {
    if (!restorePath) { setMessage("Choose a backup file first."); return; }
    if (!window.confirm("Restore will replace current DexNest local data. A safety backup is made first. Continue?")) { return; }
    const result = await onAction("backup.restore_confirmed", "module_ui", { path: restorePath, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    setMessage(result.ok ? "Restore completed." : result.error ?? "Restore failed.");
    await onRefresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_BACKUP}40`, background: `${ACCENT_BACKUP}14`, color: ACCENT_BACKUP }}><HardDriveDownload className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">Backup &amp; Restore</h1><p className="text-sm text-[#A3A3A3]">Encrypted local snapshots · {backupState.backups.length} backups</p></div>
        </div>
        <StatusChip tone={latest ? "ok" : "info"}>{latest ? "Last backup ✓" : "No backups yet"}</StatusChip>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <GlassCard accent={ACCENT_BACKUP} hover={false} className="flex items-center gap-4">
            <ProgressRing value={100} size={64} color={ACCENT_BACKUP} label={busy ? "…" : "✓"} sub="ready" />
            <div className="flex-1">
              <SectionTitle>Create backup</SectionTitle>
              <p className="mb-2.5 text-xs text-[#A3A3A3]">Snapshot Vault, Journal, Finance, Finder &amp; settings.</p>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton accent={ACCENT_BACKUP} variant="solid" icon={Plus} disabled={busy} onClick={() => void createBackup()}>Backup now</ActionButton>
                <label className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                  <button type="button" role="switch" aria-checked={options.includeSecureVault} onClick={() => setOptions({ ...options, includeSecureVault: !options.includeSecureVault })} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: options.includeSecureVault ? ACCENT_BACKUP : "#262626" }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: options.includeSecureVault ? "1.125rem" : "0.125rem" }} /></button>
                  Include Secure Vault
                </label>
              </div>
            </div>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={<button type="button" onClick={() => void onAction("backup.open_folder")} className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#A3A3A3]"><FolderOpen className="h-3 w-3" />folder</button>}>Backups</SectionTitle>
            {backupState.backups.length === 0 ? <p className="text-xs text-[#525252]">No backups yet. Create your first snapshot above.</p> : (
              <div className="space-y-1.5">
                {backupState.backups.map((b) => {
                  const active = restorePath === b.path;
                  return (
                    <div key={b.path} className={`glass-card flex w-full items-center gap-3 p-3 transition-colors ${active ? "border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.06]" : ""}`}>
                      <button type="button" onClick={() => { setRestorePath(b.path); void previewRestore(b.path); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0EA5E9]/12 text-[#0EA5E9]"><HardDriveDownload className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm text-[#F5F5F5]">{formatLocalDateTime(b.createdAt)}</p><p className="font-mono text-[10px] text-[#525252]">{formatBytes(b.sizeBytes)} · {b.fileName}</p></div>
                      </button>
                      <StatusChip tone="ok">ready</StatusChip>
                      <button type="button" title="Delete backup file from disk" onClick={() => void deleteBackup(b)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#A3A3A3] hover:bg-[#EF4444]/10 hover:text-[#EF4444]"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <GlassCard accent="#F59E0B" hover={false}>
            <SectionTitle action={<button type="button" onClick={() => void chooseBackup()} className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#A3A3A3]"><RotateCcw className="h-3 w-3" />choose file</button>}>Restore preview</SectionTitle>
            {preview ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-[#A3A3A3]">size</span><span className="font-mono text-[#F5F5F5]">{formatBytes(preview.sizeBytes)}</span></div>
                <div className="flex items-center justify-between"><span className="text-[#A3A3A3]">entries</span><span className="font-mono text-[#F5F5F5]">{preview.entries.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-[#A3A3A3]">contents</span><span className="font-mono text-[#F5F5F5]">{preview.topLevel.slice(0, 4).join(", ") || "—"}</span></div>
              </div>
            ) : <p className="text-xs text-[#525252]">Select a backup to preview, or choose a file.</p>}
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#EF4444]/25 bg-[#EF4444]/[0.07] px-3 py-2 text-xs text-[#EF4444]"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Restoring overwrites current local data. This cannot be undone.</div>
            <button type="button" disabled={!restorePath} onClick={() => void restoreBackup()} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#F59E0B] px-4 py-2 text-sm font-semibold text-[#04121a] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-4 w-4" />Restore this backup</button>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={<ShieldCheck className="h-3.5 w-3.5 text-[#22C55E]" />}>Backup options</SectionTitle>
            <div className="space-y-1">
              {([
                ["includeSettings", "Settings"], ["includeFiles", "Files"], ["includeVaultDocuments", "Vault documents"],
                ["includeSecureVault", "Secure Vault"], ["includeReceipts", "Receipts"], ["includeDropFiles", "Drop files"], ["includeIndex", "Search index"]
              ] as Array<[keyof BackupOptions, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between py-1 text-xs text-[#F5F5F5]">
                  {label}
                  <button type="button" role="switch" aria-checked={options[key]} onClick={() => setOptions({ ...options, [key]: !options[key] })} className="relative h-5 w-9 rounded-full transition-colors" style={{ background: options[key] ? ACCENT_BACKUP : "#262626" }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: options[key] ? "1.125rem" : "0.125rem" }} /></button>
                </label>
              ))}
            </div>
            <p className="mt-2 font-mono text-[10px] text-[#525252]">{backupState.backupFolderPath}</p>
          </GlassCard>
        </div>
      </div>
      {message && <p className="text-xs text-[#A3A3A3]">{message}</p>}
    </div>
  );
}
