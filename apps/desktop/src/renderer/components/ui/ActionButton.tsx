import React from "react";
import { cn } from "../../lib/utils";

// Ported 1:1 from reference-ui/frontend/src/components/common/ActionButton.js (typed).

export function ActionButton({
  icon: Icon,
  children,
  accent = "#22D3EE",
  variant = "soft",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ComponentType<{ className?: string }>;
  accent?: string;
  variant?: "soft" | "solid" | "ghost";
}) {
  const styles: React.CSSProperties = {
    soft: { background: `${accent}14`, border: `1px solid ${accent}33`, color: accent },
    solid: { background: accent, border: `1px solid ${accent}`, color: "#04121a" },
    ghost: { background: "transparent", border: "1px solid #1f1f1f", color: "#A3A3A3" }
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]",
        className
      )}
      style={styles}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}
