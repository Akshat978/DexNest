// The visual layer of DexNest's kit: the pieces that make the best screens
// (Heatmap, Finance, Clipboard, Command) feel alive - stat tiles, meters,
// small charts, rings, rich rows and a hero panel. See docs/DESIGN_LANGUAGE.md.
//
// Design tokens only: every colour is var(--...) or a color-mix() of one, and
// the accent follows --kit-accent, which a view sets once on its root. Numbers
// render in JetBrains Mono. Charts are plain SVG/HTML - no chart library, no
// canvas, nothing that animates while idle. Motion is a single entrance that
// prefers-reduced-motion turns off.

import React from "react";

type Tone = "accent" | "success" | "warning" | "error" | "info" | "neutral";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function toneVar(tone: Tone): string {
  return tone === "accent" ? "var(--kit-accent)" : tone === "neutral" ? "var(--text-muted)" : `var(--${tone})`;
}

/** Clamp to 0..1; anything not a finite number is 0. */
export function fraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

// --- Stat tile ------------------------------------------------------------------

export interface StatDelta {
  /** Signed change, already formatted ("+12%", "-3"). */
  label: string;
  /** Whether this change is good news. Colour follows meaning, not sign. */
  good: boolean | null;
}

/**
 * One number that matters, with a tiny label above it: the tiles across the
 * top of Heatmap and Finance. Give a grid of them a `StatGrid`.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  tone = "accent",
  icon
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: StatDelta;
  tone?: Tone;
  icon?: React.ReactNode;
}) {
  return (
    <div className="kit-stat" style={{ "--kit-tone": toneVar(tone) } as React.CSSProperties}>
      <span className="kit-stat__rail" aria-hidden="true" />
      <div className="kit-stat__head">
        {icon && <span className="kit-stat__icon" aria-hidden="true">{icon}</span>}
        <p className="kit-stat__label">{label}</p>
      </div>
      <p className="kit-stat__value">{value}</p>
      {(delta || hint) && (
        <p className="kit-stat__foot">
          {delta && <span className={cx("kit-stat__delta", delta.good === true && "kit-stat__delta--good", delta.good === false && "kit-stat__delta--bad")}>{delta.label}</span>}
          {hint && <span className="kit-stat__hint">{hint}</span>}
        </p>
      )}
    </div>
  );
}

export function StatGrid({ children, columns = 4 }: { children: React.ReactNode; columns?: 2 | 3 | 4 }) {
  return <div className={`kit-stat-grid kit-stat-grid--${columns}`}>{children}</div>;
}

// --- Meter ------------------------------------------------------------------------

/** A labelled progress bar: "Deep work 3h of 20h". */
export function Meter({
  label,
  value,
  max,
  display,
  tone = "accent",
  size = "md"
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  /** What to print at the end, e.g. "3h of 20h". Defaults to a percentage. */
  display?: React.ReactNode;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
}) {
  const f = fraction(value, max);
  const percent = Math.round(f * 100);
  return (
    <div className={`kit-meter kit-meter--${size}`} style={{ "--kit-tone": toneVar(tone) } as React.CSSProperties}>
      <div className="kit-meter__row">
        <span className="kit-meter__label">{label}</span>
        <span className="kit-meter__value">{display ?? `${percent}%`}</span>
      </div>
      <div className="kit-meter__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={typeof label === "string" ? label : undefined}>
        <span className="kit-meter__fill" style={{ width: `${f * 100}%` }} />
      </div>
    </div>
  );
}

// --- Ring -------------------------------------------------------------------------

/** A circular progress ring with a value in the middle: levels, completion, scores. */
export function Ring({
  value,
  max = 100,
  size = 96,
  stroke = 8,
  tone = "accent",
  center,
  caption,
  label
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  center?: React.ReactNode;
  caption?: React.ReactNode;
  /** Read out instead of the bare numbers. */
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = fraction(value, max);
  return (
    <div className="kit-ring" style={{ width: size, height: size, "--kit-tone": toneVar(tone) } as React.CSSProperties} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="kit-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="kit-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="kit-ring__center" aria-hidden="true">
        <span className="kit-ring__value">{center ?? `${Math.round(f * 100)}%`}</span>
        {caption && <span className="kit-ring__caption">{caption}</span>}
      </div>
    </div>
  );
}

// --- Bar chart ---------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  /** Tooltip; defaults to "label: value". */
  title?: string;
}

/** Vertical bars, like Heatmap's hours. Axis labels every `labelEvery` bars. */
export function BarChart({
  data,
  height = 140,
  labelEvery = 1,
  tone = "accent",
  label
}: {
  data: readonly BarDatum[];
  height?: number;
  labelEvery?: number;
  tone?: Tone;
  label: string;
}) {
  const max = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)));
  return (
    <figure className="kit-bars" style={{ "--kit-tone": toneVar(tone) } as React.CSSProperties} aria-label={label}>
      <div className="kit-bars__plot" style={{ height }}>
        {data.map((d) => {
          const f = fraction(d.value, max);
          return <span key={d.label} className="kit-bars__bar" style={{ height: `${Math.max(2, f * 100)}%`, opacity: 0.35 + f * 0.65 }} title={d.title ?? `${d.label}: ${d.value}`} />;
        })}
      </div>
      <div className="kit-bars__axis" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.label}>{i % labelEvery === 0 ? d.label : ""}</span>
        ))}
      </div>
      {/* The numbers, for anyone who can't see the bars. */}
      <figcaption className="kit-visually-hidden">
        {label}: {data.map((d) => `${d.label} ${d.value}`).join(", ")}
      </figcaption>
    </figure>
  );
}

// --- Sparkline -----------------------------------------------------------------------

/** The points of a sparkline in a width x height box, as an SVG path. Pure, for tests. */
export function sparkPath(values: readonly number[], width: number, height: number): string {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length === 0) return "";
  if (clean.length === 1) return `M0 ${height / 2} L${width} ${height / 2}`;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  return clean.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(height - ((v - min) / span) * height).toFixed(1)}`).join(" ");
}

/**
 * A small trend line with a soft fill: a stat tile's history in one glance.
 * `fill` stretches it to its container's width (the line keeps its stroke).
 */
export function Sparkline({ values, width = 120, height = 32, tone = "accent", label, fill = false }: { values: readonly number[]; width?: number; height?: number; tone?: Tone; label: string; fill?: boolean }) {
  const line = sparkPath(values, width, height);
  return (
    <svg
      className={cx("kit-spark", fill && "kit-spark--fill")}
      width={fill ? undefined : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fill ? "none" : undefined}
      role="img"
      aria-label={label}
      style={{ "--kit-tone": toneVar(tone) } as React.CSSProperties}
    >
      {line && <path className="kit-spark__area" d={`${line} L${width} ${height} L0 ${height} Z`} />}
      {line && <path className="kit-spark__line" d={line} fill="none" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

// --- List row ------------------------------------------------------------------------

/**
 * The rich row the good lists use: an icon tile, a title with a quiet line
 * under it, and something on the right (a badge, a time, an amount). As a
 * button when it opens something.
 */
export function ListRow({
  icon,
  title,
  meta,
  trailing,
  tone = "accent",
  selected = false,
  onClick
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  tone?: Tone;
  selected?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      {icon && <span className="kit-row__icon" aria-hidden="true">{icon}</span>}
      <span className="kit-row__text">
        <span className="kit-row__title">{title}</span>
        {meta && <span className="kit-row__meta">{meta}</span>}
      </span>
      {trailing && <span className="kit-row__trailing">{trailing}</span>}
    </>
  );
  const style = { "--kit-tone": toneVar(tone) } as React.CSSProperties;
  return onClick ? (
    <button type="button" className={cx("kit-row", "kit-row--action", selected && "kit-row--selected")} style={style} onClick={onClick} aria-pressed={selected || undefined}>
      {body}
    </button>
  ) : (
    <div className={cx("kit-row", selected && "kit-row--selected")} style={style}>
      {body}
    </div>
  );
}

// --- Hero --------------------------------------------------------------------------------

/**
 * The one big moment of a screen: a level, today's total, "where you left off".
 * An accent-lit panel with a headline, a line under it, a visual on the side
 * (a Ring, a Sparkline) and actions. At most one per screen.
 */
export function Hero({ eyebrow, title, children, visual, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; visual?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="kit-hero">
      <div className="kit-hero__glow" aria-hidden="true" />
      <div className="kit-hero__body">
        {eyebrow && <p className="kit-hero__eyebrow">{eyebrow}</p>}
        <h2 className="kit-hero__title">{title}</h2>
        {children && <div className="kit-hero__text">{children}</div>}
        {actions && <div className="kit-hero__actions">{actions}</div>}
      </div>
      {visual && <div className="kit-hero__visual">{visual}</div>}
    </section>
  );
}

// --- Layout ----------------------------------------------------------------------------------

/** The dashboard layout of the good screens: a wide main column and a side column (8/4). */
export function DashboardGrid({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="kit-dash">
      <div className="kit-dash__main">{main}</div>
      <aside className="kit-dash__side">{side}</aside>
    </div>
  );
}

/** Children appear with a short, staggered rise. Once, on mount; off with reduced motion. */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("kit-reveal", className)}>
      {React.Children.map(children, (child, i) => (
        <div className="kit-reveal__item" style={{ "--kit-i": i } as React.CSSProperties}>
          {child}
        </div>
      ))}
    </div>
  );
}
