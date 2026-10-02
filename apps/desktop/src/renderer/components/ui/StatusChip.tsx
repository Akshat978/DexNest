import React from "react";
import { cn } from "../../lib/utils";
import "./kit/kit.css";

// The older views' status chip, drawn as the shared kit badge (integration QA
// C8): one badge shape and one set of tone colours across the app, from design
// tokens only. The tone names and props stay as they were, so callers don't
// change.

type Tone = "ready" | "running" | "paused" | "locked" | "unlocked" | "error" | "offline" | "warn" | "ok" | "info";
type KitTone = "success" | "warning" | "error" | "info" | "neutral";

const TONES: Record<Tone, { kit: KitTone; label: string }> = {
  ready: { kit: "success", label: "Ready" },
  running: { kit: "info", label: "Running" },
  paused: { kit: "warning", label: "Paused" },
  locked: { kit: "error", label: "Locked" },
  unlocked: { kit: "success", label: "Unlocked" },
  error: { kit: "error", label: "Error" },
  offline: { kit: "neutral", label: "Offline" },
  warn: { kit: "warning", label: "Warning" },
  ok: { kit: "success", label: "OK" },
  info: { kit: "info", label: "Info" }
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
    <span data-testid={`status-chip-${tone}`} className={cn("kit-badge", `kit-badge--${t.kit}`, pulse && "kit-badge--pulse", className)} style={style}>
      {dot && <span className="kit-badge__dot" aria-hidden="true" />}
      {children || t.label}
    </span>
  );
}
