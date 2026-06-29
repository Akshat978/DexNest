import React from "react";

// Ported 1:1 from reference-ui/frontend/src/components/common/ProgressRing.js (typed).

export function ProgressRing({
  value = 0,
  size = 56,
  stroke = 5,
  color = "#22D3EE",
  label,
  sub
}: {
  value?: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f1f1f" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)", filter: `drop-shadow(0 0 4px ${color}88)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-xs font-semibold text-[#F5F5F5]">{label ?? `${Math.round(value)}%`}</span>
        {sub && <span className="text-[9px] text-[#A3A3A3]">{sub}</span>}
      </div>
    </div>
  );
}
