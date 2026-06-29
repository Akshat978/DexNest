import React from "react";

// Ported 1:1 from reference-ui/frontend/src/components/common/VoiceWaveform.js (typed).
export const GEMINI_PALETTE = ["#FB4D6A", "#FB923C", "#FACC15", "#4ADE80", "#22D3EE", "#6366F1", "#A855F7"];

export function VoiceWaveform({
  active = true,
  color = "#06B6D4",
  gemini = false,
  bars = 18,
  height = 28,
  className
}: {
  active?: boolean;
  color?: string;
  gemini?: boolean;
  bars?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-[3px] ${className || ""}`}
      style={{ height, animation: gemini && active ? "hue-drift 5s ease-in-out infinite" : undefined }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const c = gemini ? GEMINI_PALETTE[Math.round((i / Math.max(1, bars - 1)) * (GEMINI_PALETTE.length - 1))] : color;
        return (
          <span
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: "100%",
              background: c,
              transformOrigin: "center",
              opacity: active ? 0.9 : 0.25,
              animation: active ? `wave ${0.7 + (i % 5) * 0.14}s ease-in-out ${i * 0.05}s infinite` : "none",
              boxShadow: active ? `0 0 6px ${c}` : "none"
            }}
          />
        );
      })}
    </div>
  );
}
