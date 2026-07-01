import React, { useState } from "react";
import { Search,Wifi,RefreshCw,Save,KeyRound,EyeOff,Lightbulb,Power,Sun,Snowflake,Flame, type LucideIcon } from "lucide-react";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { getBridge } from "../lib/bridge";
import type { ExternalDeviceCacheItem, ExternalDevicesState } from "../main";

export function ExternalDevicesView({
  externalState,
  onStateChange,
  onAction,
  onRefresh
}: {
  externalState: ExternalDevicesState;
  onStateChange: (state: ExternalDevicesState) => void;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const ACCENT_DEV2 = "#FB923C";
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [brightOverride, setBrightOverride] = useState<Record<string, number>>({});
  const connected = externalState.providerStatus === "ready";
  const group = externalState.groups[0];
  const aliasOf = (d: ExternalDeviceCacheItem): string => d.userAlias || d.roomAlias || d.deviceName;

  async function runDevice(actionId: string, params: Record<string, unknown>, message?: string): Promise<void> {
    setBusy(true);
    try {
      const result = await onAction(actionId, "module_ui", params) as { ok?: boolean; error?: string; externalDevicesState?: ExternalDevicesState };
      if (result.externalDevicesState) { onStateChange(result.externalDevicesState); }
      else { onStateChange(await getBridge().getExternalDevicesState()); }
      setStatus(result.ok === false ? result.error ?? "Action failed." : message ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function toggleDevice(d: ExternalDeviceCacheItem): Promise<void> {
    const on = d.lastKnownPowerState === "on";
    await runDevice(on ? "external.govee.turn_off" : "external.govee.turn_on", { alias: aliasOf(d) }, on ? "Turned off." : "Turned on.");
  }
  async function setDeviceBrightness(d: ExternalDeviceCacheItem, value: number): Promise<void> {
    setBrightOverride((current) => ({ ...current, [d.deviceId]: value }));
    await runDevice("external.govee.set_brightness", { alias: aliasOf(d), brightness: value });
  }
  async function saveKey(): Promise<void> {
    if (!keyInput.trim()) { return; }
    setBusy(true);
    try {
      const result = await onAction("external.govee.update_settings", "module_ui", { goveeEnabled: true, apiKey: keyInput }) as { ok?: boolean; error?: string; externalDevicesState?: ExternalDevicesState };
      if (result.externalDevicesState) { onStateChange(result.externalDevicesState); }
      setStatus(result.ok === false ? result.error ?? "Save failed." : "Govee API key saved to Integration Keychain.");
      setKeyInput("");
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const QUICK: Array<{ id: string; label: string; icon: LucideIcon; c: string; action: string; params: Record<string, unknown> }> = group ? [
    { id: "on", label: "On", icon: Power, c: "#22C55E", action: "external.govee.turn_on", params: { alias: group.name } },
    { id: "off", label: "Off", icon: Power, c: "#525252", action: "external.govee.turn_off", params: { alias: group.name } },
    { id: "b40", label: "Bright 40", icon: Sun, c: "#F59E0B", action: "external.govee.set_brightness", params: { alias: group.name, brightness: 40 } },
    { id: "blue", label: "Blue", icon: Snowflake, c: "#38BDF8", action: "external.govee.set_color", params: { alias: group.name, color: "blue" } },
    { id: "warm", label: "Warm", icon: Flame, c: "#FB923C", action: "external.govee.set_color_temperature", params: { alias: group.name, kelvin: 2700 } }
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_DEV2}40`, background: `${ACCENT_DEV2}14`, color: ACCENT_DEV2 }}><Lightbulb className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">External Devices</h1><p className="text-sm text-[#A3A3A3]">Govee &amp; smart-home control · voice-mapped</p></div>
        </div>
        <StatusChip tone={connected ? "ready" : "error"} pulse={connected}>{connected ? "Govee connected" : "Govee " + externalState.providerStatus.replace(/_/g, " ")}</StatusChip>
      </div>

      {!connected && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/[0.08] px-4 py-3">
          <span className="text-sm text-[#EF4444]">{externalState.providerMessage || "Govee is not ready — check API key & network."}</span>
          <ActionButton accent="#EF4444" variant="ghost" icon={RefreshCw} disabled={busy} onClick={() => void runDevice("external.govee.refresh_devices", {}, "Refreshed devices.")}>Refresh</ActionButton>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <SectionTitle action={
            <div className="flex gap-2">
              <ActionButton accent={ACCENT_DEV2} variant="ghost" icon={Wifi} className="text-xs" disabled={busy} onClick={() => void runDevice("external.govee.test_connection", {}, "Connection tested.")}>Test</ActionButton>
              <ActionButton accent={ACCENT_DEV2} variant="ghost" icon={RefreshCw} className="text-xs" disabled={busy} onClick={() => void runDevice("external.govee.refresh_devices", {}, "Refreshed devices.")}>Refresh</ActionButton>
            </div>
          }>Devices</SectionTitle>

          {externalState.devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#262626] py-12 text-center"><Lightbulb className="h-8 w-8 text-[#525252]" /><p className="mt-2 text-sm text-[#A3A3A3]">No devices cached</p><p className="text-xs text-[#525252]">Add your Govee API key on the right, then Refresh.</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {externalState.devices.map((d) => {
                const on = d.lastKnownPowerState === "on";
                const glow = on ? ACCENT_DEV2 : "#1f1f1f";
                const brightVal = brightOverride[d.deviceId] ?? d.lastKnownBrightness ?? 100;
                return (
                  <GlassCard key={d.deviceId} hover={false} className="flex flex-col items-center gap-3 py-5" style={{ boxShadow: on ? `inset 0 0 50px ${glow}22, 0 0 30px ${glow}22` : "none" }}>
                    <div className="relative flex h-24 w-24 items-center justify-center">
                      {on && <span className="absolute h-24 w-24 rounded-full blur-2xl" style={{ background: glow, opacity: 0.5 }} />}
                      <div className="relative flex h-16 w-16 items-center justify-center rounded-full" style={{ background: on ? `${glow}33` : "#0d0d0d", border: `1px solid ${on ? glow : "#262626"}` }}>
                        <Lightbulb className="h-7 w-7" style={{ color: on ? glow : "#525252", filter: on ? `drop-shadow(0 0 8px ${glow})` : "none" }} />
                      </div>
                    </div>
                    <div className="text-center"><p className="text-sm font-medium text-[#F5F5F5]">{aliasOf(d)}</p><StatusChip tone={on ? "ready" : "offline"}>{on ? `on · ${brightVal}%` : "off"}</StatusChip></div>
                    <div className="flex w-full items-center gap-2 px-2">
                      <input type="range" min={0} max={100} step={1} value={brightVal} disabled={busy || !d.controllable} onChange={(event) => setBrightOverride((c) => ({ ...c, [d.deviceId]: Number(event.target.value) }))} onMouseUp={(event) => void setDeviceBrightness(d, Number((event.target as HTMLInputElement).value))} onTouchEnd={(event) => void setDeviceBrightness(d, Number((event.target as HTMLInputElement).value))} className="flex-1" />
                      <button type="button" disabled={busy} onClick={() => void toggleDevice(d)} className={`flex h-8 w-8 items-center justify-center rounded-lg ${on ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#1a1a1a] text-[#525252]"}`}><Power className="h-4 w-4" /></button>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}

          {group && (
            <GlassCard accent={ACCENT_DEV2} hover={false}>
              <SectionTitle action={<StatusChip tone="ready">group</StatusChip>}>{group.name}</SectionTitle>
              {group.aliases.length > 0 && <p className="mb-3 text-xs text-[#A3A3A3]">aliases: <span className="font-mono text-[#FB923C]">{group.aliases.join(" · ")}</span></p>}
              <div className="flex flex-wrap gap-2">
                {QUICK.map((q) => {
                  const QIcon = q.icon;
                  return <button key={q.id} type="button" disabled={busy} onClick={() => void runDevice(q.action, q.params, `${group.name} → ${q.label}`)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40" style={{ borderColor: `${q.c}33`, color: q.c, background: `${q.c}10` }}><QIcon className="h-4 w-4" />{q.label}</button>;
                })}
              </div>
            </GlassCard>
          )}
          {status && <p className="text-xs text-[#A3A3A3]">{status}</p>}
        </div>

        <div className="space-y-5 lg:col-span-4">
          <GlassCard hover={false}>
            <SectionTitle action={<KeyRound className="h-3.5 w-3.5 text-[#FB923C]" />}>Integration Keychain</SectionTitle>
            {externalState.apiKeyStored ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
                <span className="flex-1 font-mono text-sm text-[#A3A3A3]">{showKey ? "stored — re-enter to change" : "••••••••••••••••"}</span>
                <button type="button" onClick={() => setShowKey((v) => !v)} className="text-[#525252] hover:text-[#FB923C]">{showKey ? <EyeOff className="h-4 w-4" /> : <Search className="h-4 w-4" />}</button>
              </div>
            ) : (
              <p className="text-xs text-[#525252]">No Govee API key stored yet.</p>
            )}
            <div className="mt-2 flex gap-2">
              <input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder={externalState.apiKeyInKeychain ? "Enter replacement key" : "Paste Govee API key"} className="flex-1 rounded-lg border border-[#262626] bg-[#0a0a0a] px-2 py-1.5 text-xs text-[#F5F5F5]" />
              <button type="button" disabled={busy || !keyInput.trim()} onClick={() => void saveKey()} className="rounded-md bg-[#FB923C] px-3 py-1.5 text-xs font-medium text-[#04121a] disabled:opacity-40">Save</button>
            </div>
            <p className="mt-2 text-xs text-[#525252]">Stored encrypted in local keychain ({externalState.keychainStorageMethod ?? "encrypted"}) · never synced.</p>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle>Provider</SectionTitle>
            <div className="glass-card flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${ACCENT_DEV2}16`, color: ACCENT_DEV2 }}><Lightbulb className="h-4 w-4" /></div>
              <div className="flex-1"><p className="text-sm font-medium text-[#F5F5F5]">Govee</p><p className="font-mono text-[10px] text-[#525252]">{externalState.devices.length} devices · {externalState.groups.length} group{externalState.groups.length === 1 ? "" : "s"}</p></div>
              <StatusChip tone={connected ? "ok" : "error"} />
            </div>
          </GlassCard>

          <GlassCard accent="#06B6D4" hover={false}>
            <SectionTitle>Voice mapping</SectionTitle>
            <p className="text-sm text-[#A3A3A3]">Say <span className="font-mono text-[#06B6D4]">"turn on {group?.aliases?.[0] ?? "room lights"}"</span> or <span className="font-mono text-[#06B6D4]">"set brightness 40"</span> — DexNest maps to Govee actions.</p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
