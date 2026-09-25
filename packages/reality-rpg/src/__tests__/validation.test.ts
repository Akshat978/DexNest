import { describe, it, expect } from 'vitest';
import { LIMITS, namedTypes, parseAchievement, parseQuest, parseRule } from '../domain/validation.ts';
import { STARTER_ACHIEVEMENTS, STARTER_RULES } from '../domain/data/starter-pack.ts';
import { rule } from './fixtures.ts';

const good = { id: 'commit-observed', name: 'Commit observed', enabled: true, match: { types: ['dev.commit.observed'], stream: 'dev' }, award: { xp: 5, stat: 'Craft' }, dailyCap: 20 };

const errorsOf = (input: unknown) => {
  const r = parseRule(input);
  return r.ok ? [] : r.errors;
};

describe('parseRule', () => {
  it('accepts a well-formed rule and fills defaults', () => {
    expect(parseRule(good)).toEqual({ ok: true, value: { ...good, version: 1, effectiveFromSeq: 0 } });
  });

  it('refuses a rule that names no event types - the game never reads everything', () => {
    expect(errorsOf({ ...good, match: { stream: 'audit' } })).toContain('match.types must list at least one name');
    expect(errorsOf({ ...good, match: { types: [] } })).toContain('match.types must list at least one name');
  });

  it.each([
    ['a denied module', { types: ['action_executed'], module: 'vault' }],
    ['a denied action', { types: ['action_executed'], actionIds: ['finance.log_receipt_from_drop'] }],
    ['a denied type', { types: ['journal.entry_saved'] }],
    ['a legacy denied type', { types: ['vault_ocr_completed'] }],
    ['a denied module in another case', { types: ['action_executed'], module: 'Finance' }],
  ])('refuses %s', (_name, match) => {
    expect(errorsOf({ ...good, match })).toContain('rules may not name vault, finance or journal activity');
  });

  it("refuses a rule that could match the game's own events", () => {
    expect(errorsOf({ ...good, match: { types: ['rpg.level.reached'] } })).toContain("rules may not match Reality RPG's own events");
    expect(errorsOf({ ...good, match: { types: ['x'], stream: 'rpg' } })).toContain("rules may not match Reality RPG's own events");
  });

  it.each([0, -5, 2.5, LIMITS.maxXp + 1, '10', Number.NaN])('refuses xp %s', (xp) => {
    expect(errorsOf({ ...good, award: { xp, stat: 'Craft' } }).some((e) => e.startsWith('award.xp'))).toBe(true);
  });

  it('refuses bad ids, names, stats, caps and statuses', () => {
    expect(errorsOf({ ...good, id: 'Bad Id' })).toContain('id must be lowercase letters, digits and dashes');
    expect(errorsOf({ ...good, name: '' })).toContain('name is required');
    expect(errorsOf({ ...good, award: { xp: 5, stat: '<script>' } })).toContain('award.stat must be a short name (letters, digits, spaces)');
    expect(errorsOf({ ...good, dailyCap: 0 }).some((e) => e.startsWith('dailyCap'))).toBe(true);
    expect(errorsOf({ ...good, match: { types: ['a'], status: 'maybe' } })).toContain('match.status must be "success" or "failed"');
    expect(errorsOf({ ...good, match: { types: ['has space'] } })).toContain('match.types contains an invalid name');
    expect(errorsOf(null)).toEqual(['a rule must be an object']);
  });

  it('keeps unicode stat names and removes duplicate types', () => {
    const r = parseRule({ ...good, match: { types: ['a', 'a', 'b'] }, award: { xp: 1, stat: 'Ausdauer Ü' } });
    expect(r.ok && r.value.match.types).toEqual(['a', 'b']);
    expect(r.ok && r.value.award.stat).toBe('Ausdauer Ü');
  });
});

describe('namedTypes', () => {
  it('is exactly the types enabled rules name', () => {
    const rules = [
      rule({ id: 'a', match: { types: ['dev.commit.observed', 'action_executed'] } }),
      rule({ id: 'b', match: { types: ['action_executed'] } }),
      rule({ id: 'c', enabled: false, match: { types: ['never_read'] } }),
    ];
    expect(namedTypes(rules)).toEqual(['action_executed', 'dev.commit.observed']);
    expect(namedTypes([])).toEqual([]);
  });
});

describe('achievements and quests', () => {
  it('parse the three measurable condition kinds and nothing else', () => {
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'count', ruleIds: ['r'], target: 3 } }).ok).toBe(true);
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'xp', stat: 'Craft', target: 100 } }).ok).toBe(true);
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'days', ruleIds: ['r'], target: 7 } }).ok).toBe(true);
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'script', code: 'x' } }).ok).toBe(false);
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'count', ruleIds: [], target: 3 } }).ok).toBe(false);
    expect(parseAchievement({ id: 'a', name: 'A', description: 'd', condition: { kind: 'xp', target: 0 } }).ok).toBe(false);
  });

  it('quests need a valid window, and a fixed window must end after it starts', () => {
    const q = { id: 'q', title: 'Q', condition: { kind: 'xp', target: 10 }, createdAt: '2026-06-01T00:00:00.000Z' };
    expect(parseQuest(q)).toMatchObject({ ok: true, value: { status: 'active', window: { kind: 'none' } } });
    expect(parseQuest({ ...q, window: { kind: 'weekly' } }).ok).toBe(true);
    expect(parseQuest({ ...q, window: { kind: 'fixed', from: '2026-06-02', to: '2026-06-01' } })).toEqual({ ok: false, errors: ['window.to must be after window.from'] });
    expect(parseQuest({ ...q, window: { kind: 'hourly' } }).ok).toBe(false);
    expect(parseQuest({ ...q, createdAt: 'yesterday' }).ok).toBe(false);
    expect(parseQuest({ ...q, status: 'failed' }).ok).toBe(false);
  });
});

describe('starter pack', () => {
  it('every rule is valid, disabled, and names only allowed activity', () => {
    for (const r of STARTER_RULES) {
      const parsed = parseRule(r);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      expect(parsed.ok && parsed.value.enabled).toBe(false);
    }
  });

  it('every achievement is valid and refers only to starter rules', () => {
    const ids = new Set(STARTER_RULES.map((r) => (parseRule(r).ok ? (r as { id: string }).id : '')));
    for (const a of STARTER_ACHIEVEMENTS) {
      const parsed = parseAchievement(a);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (parsed.ok && parsed.value.condition.kind !== 'xp') {
        for (const ruleId of parsed.value.condition.ruleIds) expect(ids.has(ruleId), ruleId).toBe(true);
      }
    }
  });
});
