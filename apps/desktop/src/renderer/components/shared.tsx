import React, { useState } from "react";
import type { ToastMessage } from "../main";

// Small presentational primitives shared across DexNest module views. Kept free
// of app state so any view can import them without pulling in the renderer shell.

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="panel">
      <h3>{title}</h3>
      <div className="panel__body">{children}</div>
    </article>
  );
}

export function CollapsibleListItem({
  accentClass,
  title,
  meta,
  children,
  actions
}: {
  accentClass: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <details className={`library-item ${accentClass}`}>
      <summary>
        <span className="library-item__chevron" aria-hidden="true" />
        <span className="library-item__summary">
          <strong>{title}</strong>
          {meta && <span>{meta}</span>}
        </span>
      </summary>
      <div className="library-item__body">
        <div className="library-item__details">{children}</div>
        {actions && <div className="library-item__actions">{actions}</div>}
      </div>
    </details>
  );
}

export function PageHeader({
  eyebrow,
  title,
  titleId,
  actions
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`section-heading page-header ${actions ? "section-heading--row" : ""}`}>
      <div>
        <p>{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      {actions && <div className="button-row page-header__actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

// Renders a long list capped to `step` rows with a "Show more" button, so views
// like Audit / Clipboard / Finder never paint thousands of DOM nodes at once.
export function LimitedList<T>({
  items,
  step = 50,
  children
}: {
  items: T[];
  step?: number;
  children: (item: T, index: number) => React.ReactNode;
}) {
  const [limit, setLimit] = useState(step);
  const visible = limit >= items.length ? items : items.slice(0, limit);
  return (
    <>
      {visible.map((item, index) => children(item, index))}
      {items.length > limit && (
        <button type="button" className="show-more-row" onClick={() => setLimit((value) => value + step)}>
          Show {Math.min(step, items.length - limit)} more ({items.length - limit} remaining)
        </button>
      )}
    </>
  );
}

export function PathText({ children }: { children: React.ReactNode }) {
  return <span className="technical technical--truncate">{children}</span>;
}

export function StatusBadge({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "error" | "warning" | "info";
}) {
  return <span className="status-badge" data-tone={tone}>{children}</span>;
}

export function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" data-tone={toast.tone} key={toast.id}>{toast.message}</div>
      ))}
    </div>
  );
}

export function Spinner({ size = "md", label }: { size?: "sm" | "md" | "lg"; label?: string }) {
  return (
    <span
      className={`spinner${size === "sm" ? " spinner--sm" : size === "lg" ? " spinner--lg" : ""}`}
      role="status"
      aria-label={label ?? "Loading"}
    />
  );
}
