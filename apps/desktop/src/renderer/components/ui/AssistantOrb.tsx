import React from "react";
import { motion } from "framer-motion";

// Ported 1:1 from reference-ui/frontend/src/components/common/AssistantOrb.js (typed).
const RAINBOW = "conic-gradient(from 0deg, #FB4D6A, #FB923C, #FACC15, #4ADE80, #22D3EE, #6366F1, #A855F7, #FB4D6A)";
const RING_COLORS = ["#FB4D6A", "#22D3EE", "#A855F7"];

export function AssistantOrb({
  size = 120,
  color = "#06B6D4",
  state = "idle",
  gemini = true
}: {
  size?: number;
  color?: string;
  state?: "idle" | "listening" | "heard" | "processing" | "speaking";
  gemini?: boolean;
}) {
  const speaking = state === "speaking";
  const listening = state === "listening" || state === "heard";
  const processing = state === "processing";
  const activeVis = speaking || listening || processing;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {(listening || speaking) &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              width: size * 0.8,
              height: size * 0.8,
              border: `1px solid ${gemini ? RING_COLORS[i] : color}66`,
              animation: `glow-ring 2.4s ease-out ${i * 0.6}s infinite`
            }}
          />
        ))}

      <motion.div
        className="relative overflow-hidden rounded-full"
        style={{
          width: size * 0.7,
          height: size * 0.7,
          background: gemini ? "#05070f" : `radial-gradient(circle at 35% 30%, ${color}, #06121a 75%)`,
          boxShadow: gemini
            ? "inset -6px -10px 22px rgba(0,0,0,0.55), 0 0 38px rgba(99,102,241,0.4), 0 0 22px rgba(34,211,238,0.3)"
            : `inset -8px -12px 24px rgba(0,0,0,0.6), 0 0 36px ${color}66`
        }}
        animate={{ scale: speaking ? [1, 1.07, 1] : listening ? [1, 1.04, 1] : [1, 1.02, 1] }}
        transition={{ duration: speaking ? 0.5 : listening ? 1.2 : 3.5, repeat: Infinity, ease: "easeInOut" }}
      >
        {gemini ? (
          <>
            <div className="absolute -inset-[20%] animate-spin-slow rounded-full blur-[6px]" style={{ background: RAINBOW, opacity: activeVis ? 0.95 : 0.6 }} />
            <div className="absolute -inset-[10%] animate-spin-rev rounded-full opacity-70 blur-[10px]" style={{ background: RAINBOW, mixBlendMode: "screen" }} />
            <div className="absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 0 26px rgba(0,0,0,0.55)" }} />
            <div className="absolute left-[20%] top-[16%] h-3 w-6 rounded-full bg-white/45 blur-[3px]" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 rounded-full opacity-70 animate-spin-slow" style={{ background: `conic-gradient(from 0deg, transparent, ${color}66, transparent 60%)`, mixBlendMode: "screen" }} />
            <div className="absolute left-[22%] top-[18%] h-3 w-6 rounded-full bg-white/40 blur-[3px]" />
          </>
        )}
      </motion.div>

      {processing && (
        <span
          className="absolute rounded-full animate-spin-slow"
          style={{ width: size * 0.86, height: size * 0.86, border: `2px dashed ${gemini ? "#6366F1" : color}88` }}
        />
      )}
    </div>
  );
}
