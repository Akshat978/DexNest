import React, { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";

// Shared loading-state primitives for DexNest module switches.
// Pure presentation — accent colour is passed in (no hardcoded palette),
// neutrals come from existing token-based classes. These never block the
// sidebar/topbar: they only fill a module's content area.

const ACCENT_DEFAULT = "#22D3EE";

// Full content-area overlay. Appears only after `delayMs` (default 150ms) so a
// module that loads instantly never flashes a spinner, and swaps to a
// reassuring "still loading" message after `slowMs` (default 3000ms).
export function ModuleLoadingOverlay({
  accent = ACCENT_DEFAULT,
  label = "Loading…",
  subtext,
  variant = "spinner",
  skeletonRows = 6,
  delayMs = 150,
  slowMs = 3000
}: {
  accent?: string;
  label?: string;
  subtext?: string;
  variant?: "spinner" | "skeleton";
  skeletonRows?: number;
  delayMs?: number;
  slowMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const appear = window.setTimeout(() => setVisible(true), delayMs);
    const slowTimer = window.setTimeout(() => setSlow(true), slowMs);
    return () => { window.clearTimeout(appear); window.clearTimeout(slowTimer); };
  }, [delayMs, slowMs]);
  if (!visible) { return null; }
  if (variant === "skeleton") {
    return (
      <div className="module-loading module-loading--skeleton" role="status" aria-live="polite" aria-busy="true">
        <ModuleSkeleton accent={accent} rows={skeletonRows} className="w-full" />
        <p className="module-loading__sub">{slow ? "Still loading local data…" : (label)}</p>
      </div>
    );
  }
  return (
    <div className="module-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="module-loading__spinner" style={{ borderTopColor: accent, boxShadow: `0 0 24px ${accent}40` }} />
      <p className="module-loading__label">{label}</p>
      <p className="module-loading__sub">{slow ? "Still loading local data…" : (subtext ?? "")}</p>
    </div>
  );
}

// Lightweight shimmer skeleton for a module's content area.
export function ModuleSkeleton({ rows = 4, accent = ACCENT_DEFAULT, className }: { rows?: number; accent?: string; className?: string }) {
  return (
    <div className={cn("module-skeleton", className)} aria-hidden="true">
      <div className="module-skeleton__header">
        <span className="module-skeleton__tile" style={{ background: `${accent}1f` }} />
        <div className="module-skeleton__titles">
          <span className="module-skeleton__bar module-skeleton__bar--lg" />
          <span className="module-skeleton__bar module-skeleton__bar--sm" />
        </div>
      </div>
      <div className="module-skeleton__grid">
        {Array.from({ length: rows }).map((_unused, index) => (
          <span key={index} className="module-skeleton__card" />
        ))}
      </div>
    </div>
  );
}

// Small inline loading row (for panels waiting on secondary data).
export function InlineLoadingState({ label = "Loading…", accent = ACCENT_DEFAULT }: { label?: string; accent?: string }) {
  return (
    <span className="inline-loading" role="status" aria-live="polite">
      <span className="inline-loading__dot" style={{ background: accent }} />
      <span className="inline-loading__text">{label}</span>
    </span>
  );
}

// Error card with retry, used when a module's data fails to load.
export function LoadingStatusCard({
  title = "Could not load this module",
  message,
  accent = "#EF4444",
  onRetry
}: {
  title?: string;
  message?: string;
  accent?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="loading-status-card" role="alert" style={{ borderColor: `${accent}33` }}>
      <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: accent }} />
      <div className="loading-status-card__body">
        <p className="loading-status-card__title">{title}</p>
        {message && <p className="loading-status-card__msg">{message}</p>}
      </div>
      {onRetry && (
        <button type="button" className="loading-status-card__retry" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" />Retry
        </button>
      )}
    </div>
  );
}
