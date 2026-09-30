/**
 * GhostOS settings. Every adapter is off by default: until the owner turns
 * one on, GhostOS reads nothing but what they type.
 */

export const ADAPTER_IDS = ['developer_intelligence'] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

export interface GhostOsSettings {
  schemaVersion: 1;
  adapters: Record<AdapterId, { enabled: boolean }>;
  syncIntervalMinutes: number;
}

export const MIN_SYNC_INTERVAL_MINUTES = 15;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 60;

export function defaultGhostOsSettings(): GhostOsSettings {
  return {
    schemaVersion: 1,
    adapters: { developer_intelligence: { enabled: false } },
    syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
  };
}

export function isAdapterId(value: unknown): value is AdapterId {
  return typeof value === 'string' && (ADAPTER_IDS as readonly string[]).includes(value);
}

/** Accepts anything read back from disk and returns usable settings; only a literal `true` turns an adapter on. */
export function normalizeGhostOsSettings(input: unknown): GhostOsSettings {
  const base = defaultGhostOsSettings();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as { adapters?: unknown; syncIntervalMinutes?: unknown };
  const adapters = raw.adapters && typeof raw.adapters === 'object' && !Array.isArray(raw.adapters) ? (raw.adapters as Record<string, unknown>) : {};
  for (const id of ADAPTER_IDS) {
    const a = adapters[id];
    base.adapters[id] = { enabled: typeof a === 'object' && a !== null && (a as { enabled?: unknown }).enabled === true };
  }
  const interval = Number(raw.syncIntervalMinutes);
  if (Number.isFinite(interval)) base.syncIntervalMinutes = Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.floor(interval));
  return base;
}

export const anyAdapterEnabled = (s: GhostOsSettings) => ADAPTER_IDS.some((id) => s.adapters[id].enabled);
