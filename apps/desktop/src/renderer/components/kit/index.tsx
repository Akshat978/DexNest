// DexNest's token-only component kit (docs/ui-audit/REPORT.md, "Proposed
// shared component set"). It reproduces the look of components/ui - glass
// cards, icon-tile page header, uppercase section titles, tinted buttons,
// status chips - with design tokens only: every colour is a var(--...) token
// or a color-mix() of one, so token accents work (UI audit X1/X2).
//
// It lives in the renderer because it needs React; it can move to
// packages/shared-ui unchanged once that package carries React.

import React, { useEffect, useId, useRef } from "react";
import "./kit.css";

type Tone = "success" | "warning" | "error" | "info" | "neutral" | "accent";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** An accent token name ("dev", "vault"...) as a CSS custom property value. */
export function accentVar(accent: string | undefined): string {
  return `var(--accent-${accent && /^[a-z-]+$/.test(accent) ? accent : "dev"})`;
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
    <header className="kit-header" style={{ "--kit-accent": accentVar(accent) } as React.CSSProperties}>
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
      style={accent ? ({ "--kit-accent": accentVar(accent), ...rest.style } as React.CSSProperties) : rest.style}
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

export function LoadingState({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="kit-loading" role="status" aria-live="polite">
      <span className="kit-visually-hidden">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="kit-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <section className="kit-error" role="alert">
      <h2 className="kit-error__title">{title}</h2>
      <p className="kit-error__message">{message}</p>
      {onRetry && (
        <div className="kit-error__actions">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </section>
  );
}

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

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal: focus moves in and is trapped, Escape closes, focus returns to the opener. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
  initialFocus
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** CSS selector inside the dialog to focus first. */
  initialFocus?: string;
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
  return (
    <div className="kit-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={ref}
        className={cx("kit-dialog", wide && "kit-dialog--wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
      >
        <header className="kit-dialog__header">
          <h2 id={titleId} className="kit-dialog__title">{title}</h2>
          {description && <p id={descId} className="kit-dialog__description">{description}</p>}
        </header>
        <div className="kit-dialog__body">{children}</div>
        {footer && <footer className="kit-dialog__footer">{footer}</footer>}
      </div>
    </div>
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
