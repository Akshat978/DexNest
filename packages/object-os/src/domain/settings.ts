/** ObjectOS module settings. Reminders are off by default: nothing runs until the owner turns them on. */

export interface ObjectOsSettings {
  schemaVersion: 1;
  reminders: { enabled: boolean };
}

export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function defaultObjectOsSettings(): ObjectOsSettings {
  return { schemaVersion: 1, reminders: { enabled: false } };
}

/** Accepts anything read back from storage; only a literal `true` turns reminders on. */
export function normalizeObjectOsSettings(input: unknown): ObjectOsSettings {
  const base = defaultObjectOsSettings();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const reminders = (input as { reminders?: unknown }).reminders;
  base.reminders.enabled = typeof reminders === 'object' && reminders !== null && (reminders as { enabled?: unknown }).enabled === true;
  return base;
}
