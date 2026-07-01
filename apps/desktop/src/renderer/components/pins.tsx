import React from "react";
import { Pin } from "lucide-react";
import type { DexNestPin } from "@dexnest/shared-types";
import type { ViewId } from "../main";

export interface PinInput {
  type: DexNestPin["type"];
  module: string;
  entityId?: string;
  title: string;
  subtitle?: string;
  actionId?: string;
}

export function computePinId(input: PinInput): string {
  const base = input.type === "action" && input.actionId ? input.actionId : `${input.module}:${input.entityId ?? ""}`;
  return `${input.type}:${base}`.toLowerCase().replace(/\s+/g, "-");
}

export function pinModuleToView(module: string): ViewId {
  const map: Record<string, ViewId> = {
    command: "command", clipboard: "clipboard", drop: "drop", tools: "tools", vault: "vault",
    search: "search", capture: "capture", journal: "journal", calendar: "calendar", finder: "finder",
    finance: "finance", dev: "dev", deck: "deck", heatmap: "heatmap", backup: "backup",
    external_devices: "devices", timetable: "timetable", utilities: "utilities", news: "news"
  };
  return map[module] ?? "command";
}

export interface PinsContextValue {
  pins: DexNestPin[];
  isPinned: (id: string) => boolean;
  toggle: (input: PinInput) => void;
}

export const PinsContext = React.createContext<PinsContextValue>({ pins: [], isPinned: () => false, toggle: () => undefined });

// One consistent pin control across the app: outline when unpinned, filled accent
// when pinned, with a hover state (styled in styles.css via .pin-btn).
export function PinButton({ input, size = 14, className = "" }: { input: PinInput; size?: number; className?: string }) {
  const ctx = React.useContext(PinsContext);
  const pinned = ctx.isPinned(computePinId(input));
  return (
    <button
      type="button"
      className={`pin-btn${pinned ? " pin-btn--on" : ""} ${className}`.trim()}
      title={pinned ? "Unpin" : "Pin"}
      aria-label={pinned ? "Unpin" : "Pin"}
      aria-pressed={pinned}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        ctx.toggle(input);
      }}
    >
      <Pin size={size} fill={pinned ? "currentColor" : "none"} strokeWidth={2} />
    </button>
  );
}

// Module-level handle to the current voice/Ask pin context (the focused or active
// pinnable item). "pin this" / "unpin this" only act when this is set.
export let activePinContext: PinInput | null = null;
export function setActivePinContext(input: PinInput | null): void {
  activePinContext = input;
}
