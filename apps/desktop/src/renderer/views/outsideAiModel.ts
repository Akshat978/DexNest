// What the Outside AI settings card shows, without the card: kept apart so it can be tested on its own.

export interface OutsideAiSettingsValue {
  enabled: boolean;
  surfaces: { voice: boolean; typed: boolean; capture: boolean };
  minConfidence: number;
}

export interface OutsideAiState {
  settings: OutsideAiSettingsValue;
  hasKey: boolean;
  keySavedAt: string | null;
  canStoreKey: boolean;
  model: string;
}

/** Whether anything can be sent as things stand, in words. */
export function sendingSummary(state: Pick<OutsideAiState, "settings" | "hasKey">): string {
  const { enabled, surfaces } = state.settings;
  if (!enabled) return "Off. Nothing is sent anywhere.";
  if (!state.hasKey) return "On, but no key is saved, so nothing is sent.";
  const commands = [surfaces.voice ? "spoken commands" : "", surfaces.typed ? "typed commands" : ""].filter(Boolean);
  const parts = [
    commands.length > 0 ? `${commands.join(" and ")}, only when DexNest's own rules cannot tell what a command means` : "",
    surfaces.capture ? "Capture, only when you click Suggest on a note" : ""
  ].filter(Boolean);
  if (parts.length === 0) return "On, but not allowed anywhere yet, so nothing is sent.";
  return `On for ${parts.join("; and for ")}.`;
}

/** A percentage the user typed, as the 0.5 to 0.99 the setting holds. */
export function confidenceFromPercent(text: string, fallback: number): number {
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.99, Math.max(0.5, Math.round(n) / 100));
}
