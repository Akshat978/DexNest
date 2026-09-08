// Claude and Codex plan usage, live, on the Command page.
//
// Every number here is either READ — the official client's last figure — or
// RECKONED — that figure plus what this machine has logged since. The card
// keeps those visibly apart: the ring is the reckoned total, the line under it
// says how much of that was read and how much added. A person deciding
// whether to start a long run at 1am should be able to tell a measurement from
// an estimate at a glance, and a bar that hides the difference is a bar that
// eventually gets trusted at the wrong moment.
//
// Refreshes every minute. That cadence is safe because nothing here leaves the
// machine — it is the cost of re-reading whichever log grew, and no more.

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { ProviderLimitBucket, ProviderLimitsProvider, ProviderLimitsSnapshot } from "@dexnest/shared-types";
import { getBridge } from "../lib/bridge";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { ProgressRing } from "../components/ui/ProgressRing";
import { StatusChip } from "../components/ui/StatusChip";

const REFRESH_MS = 60_000;
const TICK_MS = 15_000;

const ACCENT: Record<ProviderLimitsProvider["provider"], string> = { claude: "#F59E0B", codex: "#10B981" };
const NAME: Record<ProviderLimitsProvider["provider"], string> = { claude: "Claude", codex: "Codex" };

export function ProviderLimitsCard() {
  const [snapshot, setSnapshot] = useState<ProviderLimitsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Countdowns should move between polls; the snapshot's figures are decayed
  // against this rather than re-fetched.
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    setBusy(true);
    try {
      setSnapshot(await getBridge().getProviderLimits());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => { if (alive) await load(); })();
    const poll = setInterval(() => { if (alive) void load(); }, REFRESH_MS);
    const tick = setInterval(() => { if (alive) setNow(Date.now()); }, TICK_MS);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  const elapsed = snapshot ? Math.max(0, now - Date.parse(snapshot.generatedAt)) : 0;

  return (
    <GlassCard accent="#F59E0B" hover={false}>
      <SectionTitle
        action={(
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#A3A3A3] disabled:opacity-50"
            title="Re-read the local logs now"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {snapshot ? `updated ${ago(elapsed)}` : "loading"}
          </button>
        )}
      >
        Plan Usage
      </SectionTitle>

      {error && <p className="mb-2 text-xs text-[#EF4444]">{error}</p>}

      {!snapshot ? (
        <p className="text-xs text-[#525252]">Reading local logs…</p>
      ) : (
        <div className="space-y-4">
          {snapshot.providers.map((p) => <ProviderBlock key={p.provider} provider={p} elapsed={elapsed} />)}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-[#525252]">
        Read from the official clients' own logs on this machine. Nothing is sent anywhere.
        Usage on claude.ai — web, phone, the desktop app — is invisible here, so a figure is only
        added to while its reading is recent; after that it is shown as a floor.
      </p>
    </GlassCard>
  );
}

function ProviderBlock({ provider: p, elapsed }: { provider: ProviderLimitsProvider; elapsed: number }) {
  const accent = ACCENT[p.provider];
  const staleBucket = p.buckets.find((b) => b.anchorStale);
  const anchorAge = p.anchorFetchedAt ? Date.now() - Date.parse(p.anchorFetchedAt) : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 6px ${accent}` }} />
          <span className="text-sm font-semibold text-[#F5F5F5]">{NAME[p.provider]}</span>
          {p.plan && <span className="rounded border border-[#1f1f1f] px-1.5 py-0.5 font-mono text-[10px] text-[#A3A3A3]">{p.plan}</span>}
        </div>
        {anchorAge !== null ? (
          <StatusChip tone={staleBucket ? "warn" : "ok"} dot={false}>
            read {ago(anchorAge)}
          </StatusChip>
        ) : (
          <StatusChip tone="offline" dot={false}>no reading yet</StatusChip>
        )}
      </div>

      {p.error ? (
        <p className="text-xs text-[#EF4444]">{p.error}</p>
      ) : p.buckets.length === 0 ? (
        <p className="text-xs text-[#525252]">
          {p.provider === "claude"
            ? "No usage cache yet. Claude Code writes one when it signs in."
            : "No Codex session found in the last week."}
        </p>
      ) : (
        <div className={`grid gap-2 ${p.buckets.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {p.buckets.map((b) => <Bucket key={b.id} bucket={b} accent={accent} elapsed={elapsed} />)}
        </div>
      )}

      {p.notices.map((n) => (
        <p key={n} className="mt-2 text-[10px] text-[#A3A3A3]">{n}</p>
      ))}
      {p.provider === "claude" && p.buckets.some((b) => !b.deltaTrusted) && (
        <p className="mt-2 text-[10px] text-[#F59E0B]">
          Reading is {anchorAge !== null ? ago(anchorAge) : "old"} — these are floors, not totals.
          {" "}Nothing here can refresh it: Claude Code writes this cache on its own schedule, and
          neither a headless turn nor opening the terminal UI updates it. Both were tested.
        </p>
      )}
    </div>
  );
}

function Bucket({ bucket: b, accent, elapsed }: { bucket: ProviderLimitBucket; accent: string; elapsed: number }) {
  const value = Math.round(b.estimatedPercent);
  // A figure the delta could not be added to is a floor, not a total, and it
  // is drawn muted so it never reads as a live measurement.
  const trusted = b.deltaTrusted && !b.idle;
  const colour = b.idle ? "#525252"
    : !trusted ? "#6b7280"
      : value >= 90 ? "#EF4444" : value >= 75 ? "#F59E0B" : accent;
  const resetsIn = b.idle ? null : Math.max(0, b.resetsInMs - elapsed);

  return (
    <div className="glass-card flex flex-col items-center p-2.5 text-center">
      <ProgressRing
        value={b.idle ? 0 : value}
        size={64}
        stroke={5}
        color={colour}
        label={b.idle ? "—" : trusted ? `${value}%` : `${value}%+`}
        sub={b.idle ? undefined : trusted ? "live" : "at least"}
      />
      <p className="mt-1.5 truncate text-[11px] font-medium text-[#F5F5F5]" title={b.label}>{b.label}</p>
      <p className="font-mono text-[10px] text-[#A3A3A3]">
        {b.idle ? "no open session" : resetsIn !== null ? describeResetsIn(resetsIn) : ""}
      </p>
      <p
        className="mt-0.5 font-mono text-[9px] text-[#525252]"
        title={trusted
          ? "read by the official client, plus what this machine logged since"
          : "the reading is too old to add to: usage elsewhere (web, phone, desktop app) is not visible here"}
      >
        {b.idle
          ? "0% since reset"
          : trusted
            ? `read ${Math.round(b.measuredPercent)}% · +${b.deltaPercent.toFixed(1)}%`
            : `${b.turnsSinceAnchor} turns logged since`}
      </p>
    </div>
  );
}

// --- words -------------------------------------------------------------------

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function describeResetsIn(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "resets now";
  if (minutes < 60) return `resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `resets in ${hours} hr ${rest} min` : `resets in ${hours} hr`;
  const days = Math.floor(hours / 24);
  const hr = hours % 24;
  return hr ? `resets in ${days} d ${hr} hr` : `resets in ${days} d`;
}
