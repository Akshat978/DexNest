import React, { useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, Stethoscope } from "lucide-react";
import { formatLocalDateTime } from "@dexnest/shared-types";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { ProgressRing } from "../components/ui/ProgressRing";
import { InlineLoadingState, LoadingStatusCard } from "../components/ui/ModuleLoading";
import { getPerfStats, subscribePerf } from "../lib/perf";
import type { AppHealthState, HealthStatus } from "../main";

export function AppHealthView({
  healthState,
  onRunChecks,
  onAction
}: {
  healthState: AppHealthState | null;
  onRunChecks: () => Promise<void>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
}) {
  const ACCENT_HEALTH = "#34D399";
  const perf = useSyncExternalStore(subscribePerf, getPerfStats, getPerfStats);
  const [running, setRunning] = useState(false);
  const hasRun = Boolean(healthState?.checkedAt);
  const summary = healthState?.summary ?? { pass: 0, warn: 0, fail: 0 };
  const total = summary.pass + summary.warn + summary.fail;
  const score = total > 0 ? Math.round((summary.pass / total) * 100) : 100;
  const allChecks = (healthState?.groups ?? []).flatMap((g) => g.checks);
  const problems = allChecks.filter((c) => c.status !== "pass");
  const statusIcon = (s: HealthStatus) => s === "pass" ? <CheckCircle2 className="h-4 w-4 text-[#22C55E]" /> : s === "warn" ? <AlertTriangle className="h-4 w-4 text-[#F59E0B]" /> : <AlertTriangle className="h-4 w-4 text-[#EF4444]" />;
  async function handleRunChecks(): Promise<void> {
    setRunning(true);
    try { await onRunChecks(); } finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_HEALTH}40`, background: `${ACCENT_HEALTH}14`, color: ACCENT_HEALTH }}><Stethoscope className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">App Health</h1><p className="text-sm text-[#A3A3A3]">System diagnostics &amp; worker status</p></div>
        </div>
        <div className="flex items-center gap-2">
          {running && <InlineLoadingState accent={ACCENT_HEALTH} label="Running checks…" />}
          {!running && hasRun && <StatusChip tone="info">checked {formatLocalDateTime(healthState!.checkedAt)}</StatusChip>}
          {summary.warn + summary.fail > 0 && <StatusChip tone={summary.fail > 0 ? "error" : "warn"}>{summary.warn} warnings · {summary.fail} failures</StatusChip>}
          <ActionButton accent={ACCENT_HEALTH} variant="ghost" icon={RotateCcw} disabled={running} onClick={() => void handleRunChecks()}>{running ? "Running…" : "Run checks"}</ActionButton>
        </div>
      </div>

      {!hasRun && !running && (
        <LoadingStatusCard accent={ACCENT_HEALTH} title="No health check has run yet" message="Checks are on-demand only — run them to see local-data safety, Git safety, registry, Secure Vault and integration status." />
      )}

      <GlassCard hover={false}>
        <SectionTitle>Module load metrics</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-4">
          <div className="flex items-center justify-between"><span className="text-[#525252]">last switch</span><span className="text-[#A3A3A3]">{perf.lastModule || "—"} {perf.lastModuleSwitchMs != null ? `· ${perf.lastModuleSwitchMs}ms` : ""}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#525252]">worst switch</span><span className="text-[#A3A3A3]">{perf.worstModuleSwitchMs != null ? `${perf.worstModuleSwitchMs}ms` : "—"}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#525252]">last data load</span><span className="text-[#A3A3A3]">{perf.lastDataLoadModule || "—"} {perf.lastDataLoadMs != null ? `· ${perf.lastDataLoadMs}ms` : ""}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#525252]">total ready</span><span className="text-[#A3A3A3]">{perf.lastTotalReadyMs != null ? `${perf.lastTotalReadyMs}ms` : "—"}</span></div>
        </div>
        {perf.slowModuleWarning && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#F59E0B]"><AlertTriangle className="h-3 w-3" />{perf.slowModuleWarning}</p>}
      </GlassCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassCard hover={false} accent={ACCENT_HEALTH} className="flex flex-col items-center justify-center py-5">
          <ProgressRing value={score} size={84} color={ACCENT_HEALTH} label={`${score}`} sub="health" />
          <p className="mt-2 text-xs text-[#A3A3A3]">Overall score</p>
        </GlassCard>
        <GlassCard hover={false}><p className="text-[10px] uppercase tracking-wider text-[#525252]">Passing</p><p className="mt-2 text-3xl font-semibold text-[#F5F5F5]">{summary.pass}</p></GlassCard>
        <GlassCard hover={false}><p className="text-[10px] uppercase tracking-wider text-[#525252]">Warnings</p><p className="mt-2 text-3xl font-semibold" style={{ color: summary.warn ? "#F59E0B" : "#F5F5F5" }}>{summary.warn}</p></GlassCard>
        <GlassCard hover={false}><p className="text-[10px] uppercase tracking-wider text-[#525252]">Failures</p><p className="mt-2 text-3xl font-semibold" style={{ color: summary.fail ? "#EF4444" : "#F5F5F5" }}>{summary.fail}</p></GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {(healthState?.groups ?? []).map((group) => (
          <GlassCard key={group.id} hover={false}>
            <SectionTitle>{group.title}</SectionTitle>
            <div className="space-y-1.5">
              {group.checks.map((check) => (
                <div key={check.id} className="flex items-center gap-3 rounded-lg border border-[#161616] bg-[#0a0a0a] px-3 py-2">
                  <div className="min-w-0 flex-1"><p className="text-sm text-[#F5F5F5]">{check.label}</p><p className="truncate font-mono text-[10px] text-[#525252]">{check.detail}</p></div>
                  {statusIcon(check.status)}
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>

      {problems.length > 0 && (
        <GlassCard accent="#EF4444" hover={false}>
          <SectionTitle action={<StatusChip tone="error">action needed</StatusChip>}>Warnings &amp; failures</SectionTitle>
          <div className="space-y-1.5">
            {problems.map((check) => (
              <div key={check.id} className="flex items-center gap-3 rounded-lg border border-[#161616] bg-[#0a0a0a] px-3 py-2">
                {statusIcon(check.status)}
                <span className="flex-1 text-sm text-[#F5F5F5]">{check.label}: {check.detail}</span>
                {check.suggestion && <span className="hidden text-[11px] text-[#A3A3A3] sm:inline">{check.suggestion}</span>}
                {check.actionId && (
                  <button
                    type="button"
                    onClick={() => void onAction(check.actionId as string, "module_ui", {})}
                    className="shrink-0 rounded-md border border-[#262626] px-2.5 py-1 text-[11px] font-medium text-[#A3A3A3] transition-colors hover:border-[#34D399]/40 hover:text-[#F5F5F5]"
                  >
                    {check.actionLabel ?? "Open"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {!healthState && <p className="text-xs text-[#525252]">Loading diagnostics… or click “Run checks”.</p>}
    </div>
  );
}
