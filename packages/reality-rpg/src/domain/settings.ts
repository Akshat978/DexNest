/** Reality RPG settings. Off by default: nothing is read until the user turns it on. */

export interface RealityRpgSettings {
  schemaVersion: 1;
  enabled: boolean;
  intervalMinutes: number;
}

export const MIN_INTERVAL_MINUTES = 5;
export const DEFAULT_INTERVAL_MINUTES = 15;

export function defaultRealityRpgSettings(): RealityRpgSettings {
  return { schemaVersion: 1, enabled: false, intervalMinutes: DEFAULT_INTERVAL_MINUTES };
}

/** Accepts anything read back from disk and returns usable settings. */
export function normalizeRealityRpgSettings(input: unknown): RealityRpgSettings {
  const base = defaultRealityRpgSettings();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Partial<Record<keyof RealityRpgSettings, unknown>>;
  const interval = Number(raw.intervalMinutes);
  return {
    schemaVersion: 1,
    enabled: raw.enabled === true,
    intervalMinutes: Number.isFinite(interval) ? Math.max(MIN_INTERVAL_MINUTES, Math.floor(interval)) : base.intervalMinutes,
  };
}
