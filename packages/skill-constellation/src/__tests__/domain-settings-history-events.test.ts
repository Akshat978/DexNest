import { describe, it, expect } from 'vitest';
import {
  buildSettingsFingerprint,
  defaultSkillConstellationSettings,
  MIN_REBUILD_INTERVAL_MINUTES,
  normalizeSkillConstellationSettings,
} from '../domain/settings.ts';
import { buildsToPrune, HISTORY_BUILDS_KEPT, strengthSnapshots } from '../domain/history.ts';
import { builtKey, discoveredKey, evidenceLostKey, SKILL_EVENT_NAMESPACE, SKILL_EVENT_TYPES } from '../domain/events.ts';

describe('settings', () => {
  it('are off by default', () => {
    expect(defaultSkillConstellationSettings()).toMatchObject({ enabled: false, includeUnmappedLibraries: false, myEmails: [] });
    expect(normalizeSkillConstellationSettings(undefined).enabled).toBe(false);
    expect(normalizeSkillConstellationSettings({ enabled: 'yes' }).enabled).toBe(false);
  });

  it('normalise emails, drop junk, clamp the interval', () => {
    const s = normalizeSkillConstellationSettings({
      enabled: true,
      rebuildIntervalMinutes: 1,
      myEmails: [' Me@Example.com ', 'me@example.com', 'not-an-email', 7, ''],
      hiddenSkills: ['react', 'react', 3],
    });
    expect(s.enabled).toBe(true);
    expect(s.rebuildIntervalMinutes).toBe(MIN_REBUILD_INTERVAL_MINUTES);
    expect(s.myEmails).toEqual(['me@example.com']);
    expect(s.hiddenSkills).toEqual(['react']);
  });

  it('fingerprint follows what changes a build, not display preferences', () => {
    const base = defaultSkillConstellationSettings();
    const f = buildSettingsFingerprint(base);
    expect(buildSettingsFingerprint({ ...base, hiddenSkills: ['react'], enabled: true })).toBe(f);
    expect(buildSettingsFingerprint({ ...base, myEmails: ['me@example.com'] })).not.toBe(f);
    expect(buildSettingsFingerprint({ ...base, includeUnmappedLibraries: true })).not.toBe(f);
  });
});

describe('history', () => {
  it(`keeps the newest ${HISTORY_BUILDS_KEPT} builds`, () => {
    const builds = Array.from({ length: 60 }, (_, i) => ({ id: `b${String(i).padStart(2, '0')}`, at: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z` }));
    const pruned = buildsToPrune([...builds].reverse());
    expect(pruned).toHaveLength(8);
    expect(pruned.sort()).toEqual(builds.slice(0, 8).map((b) => b.id));
    expect(buildsToPrune(builds.slice(0, 10))).toEqual([]);
  });

  it('snapshots one row per skill', () => {
    const rows = strengthSnapshots('b1', '2026-01-01T00:00:00.000Z', [
      { id: 'react', evidenceCount: 3, strength: { volume: 0.1, recency: 1, variety: 0.2, score: 0.44 } },
    ]);
    expect(rows).toEqual([{ buildId: 'b1', skillId: 'react', at: '2026-01-01T00:00:00.000Z', evidenceCount: 3, volume: 0.1, recency: 1, variety: 0.2, score: 0.44 }]);
  });
});

describe('events', () => {
  it('stay in the skill namespace', () => {
    for (const type of SKILL_EVENT_TYPES) expect(type.startsWith(`${SKILL_EVENT_NAMESPACE}.`)).toBe(true);
  });

  it('keys are namespaced and stable', () => {
    expect(builtKey('rebuild:2026-01-01T00:00:00.000Z')).toBe('skill_constellation:build:rebuild:2026-01-01T00:00:00.000Z');
    expect(discoveredKey('react')).toBe('skill_constellation:discovered:react');
    expect(evidenceLostKey('react', 'b1')).toBe('skill_constellation:lost:react:b1');
  });
});
