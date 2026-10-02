// DexNest's shared component set (docs/ui-audit/REPORT.md, "Proposed shared
// component set"; integration QA phase 3). Every view's page header, buttons,
// badges, tabs, form controls, dialogs and its loading, empty and error
// states come from here, so the modules look like one app. Design tokens only:
// every colour is a var(--...) token or a color-mix() of one.
//
// Accent: components use --kit-accent, which defaults to the Dev accent and is
// inherited, so a view sets it once on its root (accentStyle("search")) and
// everything inside follows. Dialogs render into <body> and take `accent`.
//
// It lives in the renderer because it needs React; it can move to
// packages/shared-ui unchanged once that package carries React.

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, RotateCcw } from "lucide-react";
import "./kit.css";

type Tone = "success" | "warning" | "error" | "info" | "neutral" | "accent";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** An accent token name ("dev", "vault"...) as a CSS custom property value. */
export function accentVar(accent: string | undefined): string {
  return `var(--accent-${accent && /^[a-z-]+$/.test(accent) ? accent : "dev"})`;
}

/** Style for a view's root: sets the accent every kit component inside it uses. */
export function accentStyle(accent: string): React.CSSProperties {
  return { "--kit-accent": accentVar(accent) } as React.CSSProperties;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  accent,
  actions
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  accent?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="kit-header" style={accent ? accentStyle(accent) : undefined}>
      <div className="kit-header__lead">
        {icon && <div className="kit-header__icon" aria-hidden="true">{icon}</div>}
        <div>
          <h1 className="kit-header__title">{title}</h1>
          {subtitle && <p className="kit-header__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="kit-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({
  accent,
  interactive = false,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { accent?: string; interactive?: boolean; as?: never }) {
  return (
    <article
      className={cx("kit-card", interactive && "kit-card--interactive", className)}
      style={accent ? { ...accentStyle(accent), ...rest.style } : rest.style}
      {...rest}
    >
      {accent && <span className="kit-card__bar" aria-hidden="true" />}
      {children}
    </article>
  );
}

export function SectionTitle({ children, count, action, id }: { children: React.ReactNode; count?: number; action?: React.ReactNode; id?: string }) {
  return (
    <div className="kit-section-title">
      <h2 id={id}>
        {children}
        {count !== undefined && <span className="kit-section-title__count">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * A button that can say why it's unavailable. With `disabledReason` it stays
 * focusable (aria-disabled), shows the reason as its tooltip, and ignores
 * clicks - a plain `disabled` button would hide both the reason and itself
 * from the keyboard.
 */
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: React.ReactNode; disabledReason?: string | null }
>(function Button({ variant = "secondary", size = "md", icon, disabledReason, className, children, onClick, title, type, ...rest }, ref) {
  const unavailable = Boolean(disabledReason);
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx("kit-button", `kit-button--${variant}`, `kit-button--${size}`, unavailable && "kit-button--unavailable", className)}
      aria-disabled={unavailable || undefined}
      title={unavailable ? disabledReason ?? undefined : title}
      onClick={(event) => {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {icon && <span className="kit-button__icon" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
});

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={cx("kit-badge", `kit-badge--${tone}`)} title={title}>
      <span className="kit-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Technical({ children, title, className }: { children: React.ReactNode; title?: string; className?: string }) {
  return <span className={cx("kit-tech", className)} title={title}>{children}</span>;
}

export function EmptyState({ icon, title, children, actions }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="kit-empty" aria-label={title}>
      {icon && <div className="kit-empty__icon" aria-hidden="true">{icon}</div>}
      <h2 className="kit-empty__title">{title}</h2>
      {children && <div className="kit-empty__body">{children}</div>}
      {actions && <div className="kit-empty__actions">{actions}</div>}
    </section>
  );
}

/** A small "nothing here" line inside a section (a list with no rows). */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="kit-empty-note">{children}</p>;
}

/**
 * The one loading state: a visible label over skeleton blocks. `delayMs` keeps
 * a fast load from flashing; after `slowMs` the label says it is still going.
 * `header` adds a page-header skeleton, for when the view's own header isn't
 * drawn yet.
 */
export function LoadingState({
  label = "Loading",
  rows = 3,
  header = false,
  delayMs = 0,
  slowMs = 3000
}: {
  label?: string;
  rows?: number;
  header?: boolean;
  delayMs?: number;
  slowMs?: number;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const appear = window.setTimeout(() => setVisible(true), delayMs);
    const later = window.setTimeout(() => setSlow(true), slowMs);
    return () => {
      window.clearTimeout(appear);
      window.clearTimeout(later);
    };
  }, [delayMs, slowMs]);
  if (!visible) return null;
  return (
    <div className="kit-loading" role="status" aria-live="polite" aria-busy="true">
      {header && (
        <div className="kit-loading__header" aria-hidden="true">
          <span className="kit-loading__tile" />
          <span className="kit-loading__bars">
            <span className="kit-loading__bar kit-loading__bar--lg" />
            <span className="kit-loading__bar" />
          </span>
        </div>
      )}
      <p className="kit-loading__label">{slow ? "Still loading local data…" : `${label}…`}</p>
      <div className="kit-loading__grid" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="kit-skeleton" />
        ))}
      </div>
    </div>
  );
}

/**
 * The one error state: what failed, why, and a way out. `onRetry` adds "Try
 * again"; `actions` adds more buttons; `detail` is the raw error, in
 * technical type.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  detail,
  onRetry,
  actions
}: {
  title?: React.ReactNode;
  message?: React.ReactNode;
  detail?: React.ReactNode;
  onRetry?: () => void;
  actions?: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="kit-error" role="alert" aria-labelledby={titleId}>
      <span className="kit-error__icon" aria-hidden="true">
        <AlertTriangle />
      </span>
      <div className="kit-error__body">
        <h2 id={titleId} className="kit-error__title">{title}</h2>
        {message && <p className="kit-error__message">{message}</p>}
        {detail && <p className="kit-error__detail">{detail}</p>}
      </div>
      {(onRetry || actions) && (
        <div className="kit-error__actions">
          {onRetry && <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={onRetry}>Try again</Button>}
          {actions}
        </div>
      )}
    </section>
  );
}

/** A one-line problem next to the thing it is about (a failed save, a bad field). */
export function InlineError({ children, id }: { children: React.ReactNode; id?: string }) {
  return <p className="kit-inline-error" role="alert" id={id}>{children}</p>;
}

/** A one-line result of the last action ("Object saved."). */
export function Notice({ tone = "success", children }: { tone?: "success" | "info"; children: React.ReactNode }) {
  return <p className={cx("kit-notice", `kit-notice--${tone}`)} role="status">{children}</p>;
}

// --- Form controls --------------------------------------------------------------

/** A labelled control: the label above, an optional hint below. */
export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("kit-field", className)}>
      <span className="kit-field__label">{label}</span>
      {children}
      {hint && <span className="kit-field__hint">{hint}</span>}
    </label>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("kit-input", className)} {...rest} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx("kit-input", "kit-select", className)} {...rest} />;
});

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("kit-input", "kit-textarea", className)} {...rest} />;
});

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="kit-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cx("kit-segmented__option", option.value === value && "kit-segmented__option--on")}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span aria-hidden="true">{option.icon}</span>}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Tabs with roving focus: arrows move and select, Home/End jump; the panel is labelled by its tab. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix
}: {
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string; badge?: React.ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="kit-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className={cx("kit-tab", tab.id === value && "kit-tab--on")}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }: { idPrefix: string; id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} className="kit-tabpanel" tabIndex={0}>
      {children}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal: focus moves in and is trapped, Escape closes, focus returns to the opener. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
  initialFocus,
  role = "dialog",
  accent
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** CSS selector inside the dialog to focus first. */
  initialFocus?: string;
  /** "alertdialog" for a question that needs an answer (ConfirmDialog). */
  role?: "dialog" | "alertdialog";
  /** Accent token name; the dialog renders outside the view, so it can't inherit one. */
  accent?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = (initialFocus && node?.querySelector<HTMLElement>(initialFocus)) || node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => opener?.focus?.();
  }, [initialFocus]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  // Rendered at the end of <body> so the backdrop covers the whole window,
  // sidebar included, whatever stacking context the view sits in.
  const content = (
    <div className="kit-backdrop" style={accent ? accentStyle(accent) : undefined} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={ref}
        className={cx("kit-dialog", wide && "kit-dialog--wide")}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
      >
        <header className="kit-dialog__header">
          <h2 id={titleId} className="kit-dialog__title">{title}</h2>
          {description && <p id={descId} className="kit-dialog__description">{description}</p>}
        </header>
        {children && <div className="kit-dialog__body">{children}</div>}
        {footer && <footer className="kit-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

/**
 * The one confirmation: a question, what will happen, and two buttons. Escape,
 * a click outside and Cancel all cancel; focus starts on Cancel when the
 * action is destructive. `error` shows a refusal inside the dialog, next to
 * the question, and the dialog stays open.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  error,
  accent,
  onConfirm,
  onCancel
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  accent?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      role="alertdialog"
      title={title}
      description={children}
      onClose={onCancel}
      accent={accent}
      initialFocus={destructive ? ".kit-confirm__cancel" : ".kit-confirm__ok"}
      footer={
        <>
          {error && <InlineError>{error}</InlineError>}
          <Button variant="ghost" className="kit-confirm__cancel" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} className="kit-confirm__ok" disabledReason={busy ? "Working…" : null} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="kit-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx("kit-toast", `kit-toast--${toast.tone}`)}>
          <span>{toast.text}</span>
          <button type="button" className="kit-toast__close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

let toastSeq = 0;
export function useToasts(timeoutMs = 4500) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const dismiss = React.useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = React.useCallback(
    (tone: Toast["tone"], text: string) => {
      toastSeq += 1;
      const id = toastSeq;
      setToasts((list) => [...list.slice(-3), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), timeoutMs);
    },
    [dismiss, timeoutMs]
  );
  return { toasts, push, dismiss };
}
