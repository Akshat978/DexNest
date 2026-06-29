import React from "react";
import { cn } from "../../lib/utils";

// Ported 1:1 from reference-ui/frontend/src/components/common/StatusChip.js (typed).

type Tone = "ready" | "running" | "paused" | "locked" | "unlocked" | "error" | "offline" | "warn" | "ok" | "info";

const TONES: Record<Tone, { c: string; label: string }> = {
  ready: { c: "#22C55E", label: "Ready" },
  running: { c: "#22D3EE", label: "Running" },
  paused: { c: "#F59E0B", label: "Paused" },
  locked: { c: "#EF4444", label: "Locked" },
  unlocked: { c: "#10B981", label: "Unlocked" },
  error: { c: "#EF4444", label: "Error" },
  offline: { c: "#525252", label: "Offline" },
  warn: { c: "#F59E0B", label: "Warning" },
  ok: { c: "#22C55E", label: "OK" },
  info: { c: "#6366F1", label: "Info" }
};

export function StatusChip({
  tone = "info",
  children,
  dot = true,
  pulse = false,
  className,
  style
}: {
  tone?: Tone;
  children?: React.ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = TONES[tone] || TONES.info;
  return (
    <span
      data-testid={`status-chip-${tone}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none",
        className
      )}
      style={{ borderColor: `${t.c}33`, background: `${t.c}12`, color: t.c, ...style }}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: t.c }} />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: t.c }} />
        </span>
      )}
      {children || t.label}
    </span>
  );
}
