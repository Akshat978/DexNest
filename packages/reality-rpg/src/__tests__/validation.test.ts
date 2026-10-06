import { describe, it, expect } from 'vitest';
import { LIMITS, namedTypes, parseAchievement, parseQuest, parseRule } from '../domain/validation.ts';
import { STARTER_ACHIEVEMENTS, STARTER_INFO, STARTER_QUESTS, STARTER_RULES } from '../domain/data/starter-pack.ts';
import { levelFor } from '../domain/levels.ts';
import { rule } from './fixtures.ts';

const good = { id: 'commit-observed', name: 'Commit observed', enabled: true, match: { types: ['dev.commit.observed'], stream: 'dev' }, award: { xp: 5, stat: 'Craft' }, dailyCap: 20 };

const errorsOf = (input: unknown) => {
  const r = parseRule(input);
  return r.ok ? [] : r.errors;
};

describe('parseRule', () => {
  it('accepts a well-formed rule and fills defaults', () => {
    expect(parseRule(good)).toEqual({ ok: true, value: { ...good, version: 1, effectiveFrom: '1970-01-01T00:00:00.000Z' } });
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
    expect(errorsOf({ ...good, match: { types: ['action_executed'], actionIds: ['reality_rpg.rule.save'] } })).toContain("rules may not match Reality RPG's own events");
    expect(errorsOf({ ...good, match: { types: ['action_executed'], module: 'reality_rpg' } })).toContain("rules may not match Reality RPG's own events");
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

  it('is a real set: many rules across projects, DexNest and day to day, each said in plain words', () => {
    const rules = STARTER_RULES.map((r) => parseRule(r)).flatMap((p) => (p.ok ? [p.value] : []));
    expect(rules.length).toBeGreaterThanOrEqual(15);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    for (const rule of rules) {
      const info = STARTER_INFO[rule.id];
      expect(info, `${rule.id} has no plain-word description`).toBeDefined();
      expect(info!.when.length).toBeGreaterThan(10);
      expect(rule.name, 'a name a person would say, not an event type').not.toMatch(/[._]/);
      expect(rule.dailyCap, `${rule.id} is capped, so one busy day cannot run away`).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(STARTER_INFO).map((i) => i.group))).toEqual(new Set(['projects', 'dexnest', 'life']));
    expect(Object.keys(STARTER_INFO).sort()).toEqual(rules.map((r) => r.id).sort());
    expect(Object.values(STARTER_INFO).filter((i) => i.recommended).length).toBeGreaterThanOrEqual(5);
  });

  it('names nothing from vault, finance or journal except the three "an entry was made" actions', () => {
    // The owner allowed these three on 5 October 2026 (privacy.ts, COUNTED_ENTRIES). Nothing else of those modules is named.
    const counted = ['journal-written', 'expense-logged', 'document-filed'];
    const rules = STARTER_RULES as { id: string; match: { types: string[]; stream?: string; actionIds?: string[]; status?: string; module?: string } }[];
    const others = rules.filter((r) => !counted.includes(r.id));
    const text = JSON.stringify(others);
    for (const word of ['vault', 'finance', 'journal']) expect(text, word).not.toContain(word);
    expect(rules.filter((r) => counted.includes(r.id)).map((r) => [r.id, r.match.types, r.match.actionIds, r.match.stream, r.match.status, r.match.module])).toEqual([
      ['journal-written', ['journal_action'], ['journal.create_entry'], 'audit', 'success', undefined],
      ['expense-logged', ['finance_action'], ['finance.create_transaction'], 'audit', 'success', undefined],
      ['document-filed', ['vault_action'], ['vault.import_documents'], 'audit', 'success', undefined],
    ]);
    // Filing a capture into one of them is still not counted by the capture rule.
    expect(JSON.stringify(rules.find((r) => r.id === 'capture-filed'))).not.toMatch(/route_to_(vault|finance|journal)/);
  });

  it('achievements come in tiers, and the level ones sit on the level curve', () => {
    const byId = new Map(STARTER_ACHIEVEMENTS.map((a) => [(a as { id: string }).id, a as { condition: { kind: string; target: number } }]));
    expect([byId.get('commits-10'), byId.get('commits-100'), byId.get('commits-1000')].map((a) => a?.condition.target)).toEqual([10, 100, 1000]);
    expect([byId.get('committed-week'), byId.get('committed-month'), byId.get('committed-hundred')].map((a) => a?.condition.target)).toEqual([7, 30, 100]);
    expect(levelFor(byId.get('level-5')!.condition.target)).toBe(5);
    expect(levelFor(byId.get('level-5')!.condition.target - 1)).toBe(4);
    expect(levelFor(byId.get('level-10')!.condition.target)).toBe(10);
    expect(levelFor(byId.get('level-20')!.condition.target)).toBe(20);
    expect(STARTER_ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
  });

  it('every quest is valid, measurable, and counts a rule that exists', () => {
    const ids = new Set(STARTER_RULES.map((r) => (r as { id: string }).id));
    expect(STARTER_QUESTS.length).toBeGreaterThanOrEqual(6);
    for (const q of STARTER_QUESTS) {
      const parsed = parseQuest({ id: q.id, title: q.title, condition: q.condition, window: q.window, status: 'active', createdAt: '2026-06-01T00:00:00.000Z' });
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      expect(ids.has(q.needs), q.needs).toBe(true);
      if (parsed.ok && parsed.value.condition.kind !== 'xp') expect(parsed.value.condition.ruleIds).toEqual([q.needs]);
    }
  });
});
