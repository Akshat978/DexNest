import React, { useMemo, useState } from "react";
import { Activity, Clock, Cpu, EyeOff } from "lucide-react";
import { getLocalTodayDateString } from "@dexnest/shared-types";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ToastStack } from "../components/shared";
import { formatDuration } from "../lib/format";
import type { HeatmapState, HeatmapGoal } from "../main";

export function HeatmapView({
  heatmapState,
  onAction,
  onRefresh
}: {
  heatmapState: HeatmapState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    heatmapState?: HeatmapState;
    snapshot?: { detectionStatus?: string; error?: string };
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [goalForm, setGoalForm] = useState({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true });
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  }

  async function heatmapAction(actionId: string, params: Record<string, unknown> = {}, successMessage = "Heatmap updated."): Promise<void> {
    const result = await onAction(actionId, "module_ui", params);
    showToast(result.ok ? successMessage : result.error ?? "Heatmap action failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  function startAddGoal(): void {
    setGoalForm({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true });
    setShowGoalModal(true);
  }

  function editGoal(goal: HeatmapGoal): void {
    setGoalForm({
      id: goal.id,
      name: goal.name,
      targetHoursPerWeek: String(goal.targetHoursPerWeek),
      keyword: goal.keyword,
      active: goal.active
    });
    setShowGoalModal(true);
  }

  async function saveGoal(): Promise<void> {
    await heatmapAction(goalForm.id ? "heatmap.update_goal" : "heatmap.create_goal", goalForm, "Heatmap goal saved.");
    setGoalForm({ id: "", name: "", targetHoursPerWeek: "5", keyword: "", active: true });
    setShowGoalModal(false);
  }

  async function deleteGoal(goal: HeatmapGoal): Promise<void> {
    if (!window.confirm(`Delete Heatmap goal "${goal.name}"?`)) {
      return;
    }
    await heatmapAction("heatmap.delete_goal", { goalId: goal.id, confirmedDangerous: true }, "Heatmap goal deleted.");
  }

  const ACCENT_HEAT = "#EF4444";
  const hourSeconds = Array.from({ length: 24 }, (_, h) => heatmapState.summary.activeHours.find((a) => a.hour === h)?.seconds ?? 0);
  const hourMax = Math.max(1, ...hourSeconds);
  const topApps = heatmapState.summary.todayByApp.slice(0, 5);
  const topMax = Math.max(1, ...topApps.map((a) => a.seconds));
  const appColors = ["#3B82F6", "#22C55E", "#A855F7", "#EC4899", "#F59E0B"];
  const heatPaused = /performance/i.test(heatmapState.trackingStatus);
  const tracking = !heatPaused; // tracking is always-on unless Performance Mode pauses it

  // Derived analytics from raw samples.
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const { weekGrid, weekMax, focusBlocks, contextSwitches } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const todayKey = getLocalTodayDateString();
    const todayEvents = heatmapState.events
      .filter((event) => event.timestamp.slice(0, 10) === todayKey)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let blocks = 0;
    let switches = 0;
    let prevActive = false;
    let prevApp = "";
    for (const event of todayEvents) {
      if (event.active && !prevActive) { blocks += 1; }
      if (event.active && prevApp && event.appName !== prevApp) { switches += 1; }
      prevActive = event.active;
      if (event.active) { prevApp = event.appName; }
    }
    for (const event of heatmapState.events) {
      if (!event.active) { continue; }
      const date = new Date(event.timestamp);
      const weekday = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
      const hour = date.getHours();
      grid[weekday][hour] += event.durationSeconds || 0;
    }
    const max = Math.max(1, ...grid.flat());
    return { weekGrid: grid, weekMax: max, focusBlocks: blocks, contextSwitches: switches };
  }, [heatmapState.events]);
  const heatCellColor = (seconds: number): string => {
    if (seconds <= 0) { return "#141414"; }
    const intensity = Math.min(1, seconds / weekMax);
    return `rgba(239, 68, 68, ${0.18 + intensity * 0.82})`;
  };

  return (
    <div className="space-y-6">
      {toast && <ToastStack toasts={[{ id: toast.message, message: toast.message, tone: toast.tone }]} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_HEAT}40`, background: `${ACCENT_HEAT}14`, color: ACCENT_HEAT }}><Activity className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">Heatmap</h1><p className="text-sm text-[#A3A3A3]">App usage analytics · tracked locally</p></div>
        </div>
        {heatPaused ? <StatusChip tone="paused"><Cpu className="mr-1 h-2.5 w-2.5" />Paused by Performance</StatusChip> : <StatusChip tone={tracking ? "running" : "info"} pulse={tracking}>{tracking ? "Tracking active" : heatmapState.trackingStatus}</StatusChip>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Active today", value: formatDuration(heatmapState.summary.activeSecondsToday), c: "#EF4444" },
          { label: "Focus blocks", value: String(focusBlocks), c: "#22C55E" },
          { label: "Context switches", value: String(contextSwitches), c: "#F59E0B" },
          { label: "Top app", value: heatmapState.summary.topAppToday || "—", c: "#3B82F6" }
        ].map((s) => (
          <GlassCard key={s.label} accent={s.c} className="flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-wider text-[#525252]">{s.label}</p>
            <p className="font-mono text-xl font-semibold text-[#F5F5F5]">{s.value}</p>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <GlassCard hover={false}>
            <SectionTitle action={<Clock className="h-3.5 w-3.5 text-[#EF4444]" />}>Hourly activity · today</SectionTitle>
            <div className="flex h-[150px] items-end gap-[3px] pt-2">
              {hourSeconds.map((sec, h) => (
                <div key={h} className="flex-1 rounded-t-[3px] transition-all hover:brightness-125" style={{ height: `${Math.max(3, (sec / hourMax) * 100)}%`, background: ACCENT_HEAT, opacity: 0.3 + (sec / hourMax) * 0.7 }} title={`${h}:00 · ${formatDuration(sec)}`} />
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-[#525252]">{["0", "3", "6", "9", "12", "15", "18", "21", "24"].map((h) => <span key={h}>{h}</span>)}</div>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={<span className="flex items-center gap-1.5 font-mono text-[10px] text-[#525252]">less<span className="flex gap-0.5">{[0.2, 0.45, 0.7, 1].map((t) => <span key={t} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `rgba(239,68,68,${t})` }} />)}</span>more</span>}>Weekly heatmap</SectionTitle>
            <div className="space-y-[3px] overflow-x-auto pt-1">
              <div className="flex gap-[3px] pl-8">
                {["0", "", "", "3", "", "", "6", "", "", "9", "", "", "12", "", "", "15", "", "", "18", "", "", "21", "", ""].map((h, i) => (
                  <span key={i} className="w-[14px] text-center font-mono text-[8px] text-[#525252]">{h}</span>
                ))}
              </div>
              {weekGrid.map((row, day) => (
                <div key={day} className="flex items-center gap-[3px]">
                  <span className="w-7 font-mono text-[10px] text-[#525252]">{weekdayLabels[day]}</span>
                  {row.map((seconds, hour) => (
                    <span key={hour} className="h-[14px] w-[14px] rounded-[2px]" style={{ background: heatCellColor(seconds) }} title={`${weekdayLabels[day]} ${hour}:00 · ${formatDuration(seconds)}`} />
                  ))}
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <GlassCard hover={false}>
            <SectionTitle>Top apps · today</SectionTitle>
            {topApps.length === 0 ? <p className="text-xs text-[#525252]">No samples today.</p> : (
              <div className="space-y-2.5">
                {topApps.map((a, i) => (
                  <div key={a.name}>
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="truncate text-[#F5F5F5]">{a.name}</span><span className="font-mono text-[#A3A3A3]">{formatDuration(a.seconds)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#1f1f1f]"><div className="h-full rounded-full" style={{ width: `${(a.seconds / topMax) * 100}%`, background: appColors[i % appColors.length] }} /></div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard accent="#22C55E" hover={false}>
            <SectionTitle action={<button type="button" onClick={() => startAddGoal()} className="min-h-0 rounded-md border border-[#262626] bg-transparent px-2 py-0.5 text-[10px] text-[#22C55E] hover:border-[#22C55E]/40">+ New</button>}>Goals</SectionTitle>
            {heatmapState.goalProgress.length === 0 ? <p className="text-xs text-[#525252]">No goals yet.</p> : (
              <div className="space-y-2.5">
                {heatmapState.goalProgress.map((goal) => (
                  <div key={goal.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-[#F5F5F5]">{goal.name}</span>
                      <StatusChip tone={goal.percent >= 100 ? "ok" : goal.percent >= 60 ? "info" : "warn"}>{goal.percent}%</StatusChip>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#1f1f1f]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, goal.percent)}%`, background: "#22C55E" }} /></div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[#525252]">{formatDuration(goal.progressSeconds)} of {formatDuration(goal.targetSeconds)}</span>
                      <span className="flex gap-1">
                        <button type="button" onClick={() => editGoal(goal)} className="min-h-0 rounded-md border border-[#262626] bg-transparent px-1.5 py-0.5 text-[10px] text-[#A3A3A3] hover:text-[#F5F5F5]">Edit</button>
                        <button type="button" onClick={() => void deleteGoal(goal)} className="min-h-0 rounded-md border border-[#262626] bg-transparent px-1.5 py-0.5 text-[10px] text-[#A3A3A3] hover:text-[#EF4444]">Delete</button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={<EyeOff className="h-3.5 w-3.5 text-[#A3A3A3]" />}>Privacy exclusions</SectionTitle>
            {heatmapState.settings.privateApps.length === 0 ? <p className="text-xs text-[#525252]">No app exclusions set.</p> : (
              <div className="flex flex-wrap gap-1.5">{heatmapState.settings.privateApps.map((e) => <span key={e} className="rounded-full border border-[#1f1f1f] px-2.5 py-1 text-[11px] text-[#A3A3A3]">{e}</span>)}</div>
            )}
            <p className="mt-2 text-[11px] text-[#525252]">Metadata only — no keystrokes, screenshots, or content.</p>
          </GlassCard>
        </div>
      </div>

      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={goalForm.id ? "Edit goal" : "New goal"}>
          <div className="w-full max-w-md rounded-2xl border p-5 shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div><p className="text-xs uppercase tracking-[0.16em]" style={{ color: "#22C55E" }}>{goalForm.id ? "Edit" : "New"}</p><h2 className="text-xl font-semibold text-[#F5F5F5]">{goalForm.id ? "Edit goal" : "New goal"}</h2></div>
              <button type="button" aria-label="Close" onClick={() => { setShowGoalModal(false); }} className="min-h-0 border-0 bg-transparent text-[#A3A3A3] hover:text-[#F5F5F5]">✕</button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs text-[#A3A3A3]">Name<input className="mt-1 w-full" value={goalForm.name} onChange={(event) => setGoalForm({ ...goalForm, name: event.target.value })} placeholder="Deep work" /></label>
              <label className="block text-xs text-[#A3A3A3]">Target hours / week<input type="number" min="0.25" step="0.25" className="mt-1 w-full" value={goalForm.targetHoursPerWeek} onChange={(event) => setGoalForm({ ...goalForm, targetHoursPerWeek: event.target.value })} /></label>
              <label className="block text-xs text-[#A3A3A3]">App / project keyword<input className="mt-1 w-full" value={goalForm.keyword} onChange={(event) => setGoalForm({ ...goalForm, keyword: event.target.value })} placeholder="Code, VS Code" /></label>
              <label className="block text-xs text-[#A3A3A3]">Active<select className="mt-1 w-full" value={goalForm.active ? "true" : "false"} onChange={(event) => setGoalForm({ ...goalForm, active: event.target.value === "true" })}><option value="true">Active</option><option value="false">Inactive</option></select></label>
            </div>
            <div className="button-row mt-4">
              <button type="button" className="button-primary" disabled={!goalForm.name.trim()} onClick={() => void saveGoal()}>{goalForm.id ? "Update goal" : "Create goal"}</button>
              <button type="button" onClick={() => setShowGoalModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
