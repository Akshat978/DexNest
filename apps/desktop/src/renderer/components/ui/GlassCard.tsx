import React from "react";
import { cn } from "../../lib/utils";

// Ported 1:1 from reference-ui/frontend/src/components/common/GlassCard.js
// (typed for TS). Pure presentation — no app logic.

export function GlassCard({
  className,
  children,
  accent,
  hover = true,
  glow = false,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { accent?: string; hover?: boolean; glow?: boolean }) {
  return (
    <div
      className={cn("glass-card relative p-4", hover && "lift", className)}
      style={{
        ...(accent && glow ? { boxShadow: `0 0 0 1px ${accent}22, 0 10px 40px -20px ${accent}55` } : {}),
        ...style
      }}
      {...props}
    >
      {accent && (
        <span
          className="pointer-events-none absolute left-0 top-4 h-7 w-[3px] rounded-r-full"
          style={{ background: accent, boxShadow: `0 0 12px ${accent}` }}
        />
      )}
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A3A3A3]">{children}</h3>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  accent,
  icon: Icon,
  children
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  accent?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl border"
            style={{ borderColor: `${accent}40`, background: `${accent}14`, color: accent }}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">{title}</h1>
          {subtitle && <p className="text-sm text-[#A3A3A3]">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
