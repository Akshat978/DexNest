/**
 * Skill Constellation settings. Off by default: nothing is built until the
 * user turns it on or asks for a rebuild.
 */

import { stableHash } from './hash.ts';

export interface SkillConstellationSettings {
  schemaVersion: 1;
  enabled: boolean;
  rebuildIntervalMinutes: number;
  /** Show libraries the catalogue does not name. Off: only curated ones. */
  includeUnmappedLibraries: boolean;
  /** Built but not shown. A display preference, not a deletion. */
  hiddenSkills: string[];
  /**
   * The owner's commit author emails, lowercase. When set, only commits by
   * these authors count; a commit recorded without an author still counts.
   * Empty: every commit counts, because nothing says whose it is.
   */
  myEmails: string[];
}

export const MIN_REBUILD_INTERVAL_MINUTES = 15;
export const DEFAULT_REBUILD_INTERVAL_MINUTES = 60;

export function defaultSkillConstellationSettings(): SkillConstellationSettings {
  return {
    schemaVersion: 1,
    enabled: false,
    rebuildIntervalMinutes: DEFAULT_REBUILD_INTERVAL_MINUTES,
    includeUnmappedLibraries: false,
    hiddenSkills: [],
    myEmails: [],
  };
}

function stringList(value: unknown, map: (s: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const mapped = map(item.trim());
    if (mapped.length > 0) out.add(mapped);
  }
  return [...out].sort();
}

/** Accepts anything read back from disk and returns usable settings. */
export function normalizeSkillConstellationSettings(input: unknown): SkillConstellationSettings {
  const base = defaultSkillConstellationSettings();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<Record<keyof SkillConstellationSettings, unknown>>;
  const interval = Number(raw.rebuildIntervalMinutes);
  return {
    schemaVersion: 1,
    enabled: raw.enabled === true,
    rebuildIntervalMinutes: Number.isFinite(interval)
      ? Math.max(MIN_REBUILD_INTERVAL_MINUTES, Math.floor(interval))
      : base.rebuildIntervalMinutes,
    includeUnmappedLibraries: raw.includeUnmappedLibraries === true,
    hiddenSkills: stringList(raw.hiddenSkills, (s) => s),
    // An email needs an "@" with something either side; anything else would
    // silently match nothing and hide every commit.
    myEmails: stringList(raw.myEmails, (s) => (/^[^@\s]+@[^@\s]+$/.test(s) ? s.toLowerCase() : '')),
  };
}

/**
 * The settings a build's result depends on. A rebuild with the same dev cursor
 * and the same fingerprint would produce the same constellation, so it can be
 * skipped. (hiddenSkills only affects display.)
 */
export function buildSettingsFingerprint(settings: SkillConstellationSettings): string {
  return stableHash(
    JSON.stringify({ includeUnmappedLibraries: settings.includeUnmappedLibraries, myEmails: settings.myEmails }),
  );
}
