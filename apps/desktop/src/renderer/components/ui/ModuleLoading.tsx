import React from "react";

// Small inline loading row, for a panel waiting on secondary data. A whole
// view's loading and error states are the kit's LoadingState and ErrorState
// (components/ui/kit), so every module shows the same ones.
export function InlineLoadingState({ label = "Loading…", accent = "var(--kit-accent)" }: { label?: string; accent?: string }) {
  return (
    <span className="inline-loading" role="status" aria-live="polite">
      <span className="inline-loading__dot" style={{ background: accent }} />
      <span className="inline-loading__text">{label}</span>
    </span>
  );
}
