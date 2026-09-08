// Weather on the Command page, and the only place the location is set.
//
// Small on purpose. The forecast's real home is the phone's Today screen — at
// the desk you can see out of a window. This card exists so the location has
// somewhere to be configured, and so it is obvious when it has not been.

import React, { useCallback, useEffect, useState } from "react";
import { CloudSun, MapPin, RefreshCw } from "lucide-react";

import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { getBridge } from "../lib/bridge";

const ACCENT = "#38BDF8";

interface WeatherSnapshot {
  configured: boolean;
  location: { latitude: number; longitude: number; label: string } | null;
  now: { temperature: number; feelsLike: number; description: string; isDay: boolean } | null;
  high: number | null;
  low: number | null;
  rainChance: number | null;
  fetchedAt: string | null;
  problem: string | null;
}

export function WeatherCard() {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await getBridge().getWeather() as WeatherSnapshot);
    } catch {
      // The card simply stays as it was. A failed refresh is not worth an
      // error banner on a page that is mostly about other things.
    }
  }, []);

  useEffect(() => {
    void load();
    // Ten minutes matches the service's own cache, so this asks for fresh data
    // exactly when there is fresh data to be had and never more often.
    const timer = window.setInterval(() => void load(), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const save = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await getBridge().setWeatherLocation(query.trim());
      if (result.ok) {
        setQuery("");
        await load();
      } else {
        setProblem(result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const configured = snapshot?.configured ?? false;

  return (
    <GlassCard accent={ACCENT} hover={false}>
      <SectionTitle
        action={
          configured ? (
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1 text-[10px] text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
            >
              <RefreshCw className="h-3 w-3" />
              refresh
            </button>
          ) : (
            <StatusChip tone="info">not set</StatusChip>
          )
        }
      >
        Weather
      </SectionTitle>

      {configured && snapshot?.now ? (
        <>
          <div className="flex items-center gap-3">
            <CloudSun className="h-8 w-8 shrink-0" style={{ color: ACCENT }} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-2xl text-[#F5F5F5]">{snapshot.now.temperature}°</p>
              <p className="truncate text-xs text-[#A3A3A3]">
                {snapshot.now.description} · feels {snapshot.now.feelsLike}°
              </p>
            </div>
            <div className="shrink-0 text-right text-[11px] text-[#525252]">
              {snapshot.high !== null ? <p>high {snapshot.high}°</p> : null}
              {snapshot.low !== null ? <p>low {snapshot.low}°</p> : null}
              {snapshot.rainChance !== null ? <p>{snapshot.rainChance}% rain</p> : null}
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1.5 truncate font-mono text-[10px] text-[#525252]">
            <MapPin className="h-3 w-3 shrink-0" />
            {snapshot.location?.label}
          </p>
          {snapshot.problem ? <p className="text-[11px] text-[#F59E0B]">{snapshot.problem}</p> : null}
        </>
      ) : (
        <p className="mb-2.5 text-xs text-[#A3A3A3]">
          Set a location and the forecast appears here and on your phone.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
          placeholder={configured ? "Change location" : "Town or city"}
          disabled={busy}
          className="min-w-0 flex-1 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-2.5 py-1.5 text-xs text-[#F5F5F5] placeholder:text-[#525252]"
        />
        <ActionButton icon={MapPin} accent={ACCENT} variant="soft" disabled={busy || !query.trim()} onClick={() => void save()}>
          {busy ? "Finding…" : "Set"}
        </ActionButton>
      </div>
      {problem ? <p className="mt-2 text-[11px] text-[#EF4444]">{problem}</p> : null}
    </GlassCard>
  );
}
