/**
 * Rules, achievements and quests are data. This is where that data is
 * checked: anything arriving from the view, a file or the database passes
 * through here before the game uses it.
 *
 * A rule is refused when it:
 * - names no event types (the game must never read "everything");
 * - names a denied module, action or type (vault, finance, journal);
 * - could match the game's own events (it would feed itself);
 * - awards zero, negative, fractional or outsized XP.
 */

import { isDeniedModule, isDeniedName, isSelfFeeding } from './privacy.ts';
import type { AchievementDef, Condition, Quest, QuestStatus, QuestWindow, Rule, RuleMatch } from './types.ts';

export const LIMITS = {
  maxXp: 500,
  maxDailyCap: 1000,
  maxTypes: 20,
  maxActionIds: 50,
  maxRuleIdsInCondition: 20,
  maxTarget: 1_000_000,
  maxName: 80,
  maxDescription: 280,
} as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const STAT = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, field: string, max: number, errors: string[]): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    errors.push(`${field} is required`);
    return '';
  }
  const t = v.trim();
  if (t.length > max) errors.push(`${field} is longer than ${max} characters`);
  return t;
}

function id(v: unknown, field: string, errors: string[]): string {
  if (typeof v !== 'string' || !ID.test(v)) {
    errors.push(`${field} must be lowercase letters, digits and dashes`);
    return '';
  }
  return v;
}

function int(v: unknown, field: string, min: number, max: number, errors: string[]): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    errors.push(`${field} must be a whole number from ${min} to ${max}`);
    return min;
  }
  return v;
}

function tokens(v: unknown, field: string, max: number, errors: string[], required: boolean): string[] {
  if (v === undefined && !required) return [];
  if (!Array.isArray(v) || (required && v.length === 0)) {
    errors.push(`${field} must list at least one name`);
    return [];
  }
  if (v.length > max) errors.push(`${field} lists more than ${max} names`);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !NAME_TOKEN.test(item)) {
      errors.push(`${field} contains an invalid name`);
      continue;
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function parseMatch(v: unknown, errors: string[]): RuleMatch {
  if (!isObj(v)) {
    errors.push('match is required');
    return { types: [] };
  }
  const match: RuleMatch = { types: tokens(v.types, 'match.types', LIMITS.maxTypes, errors, true) };
  if (v.stream !== undefined) {
    if (typeof v.stream !== 'string' || !NAME_TOKEN.test(v.stream)) errors.push('match.stream is invalid');
    else match.stream = v.stream;
  }
  if (v.module !== undefined) {
    if (typeof v.module !== 'string' || !NAME_TOKEN.test(v.module)) errors.push('match.module is invalid');
    else match.module = v.module;
  }
  if (v.actionIds !== undefined) {
    const actionIds = tokens(v.actionIds, 'match.actionIds', LIMITS.maxActionIds, errors, true);
    if (actionIds.length > 0) match.actionIds = actionIds;
  }
  if (v.status !== undefined) {
    if (v.status !== 'success' && v.status !== 'failed') errors.push('match.status must be "success" or "failed"');
    else match.status = v.status;
  }

  // Privacy and self-feeding.
  const named = [...match.types, ...(match.actionIds ?? []), ...(match.module ? [match.module] : [])];
  if (isDeniedModule(match.module) || named.some((n) => isDeniedName(n))) {
    errors.push('rules may not name vault, finance or journal activity');
  }
  if (isSelfFeeding(match.stream, null) || match.types.some((t) => isSelfFeeding(null, t))) {
    errors.push("rules may not match Reality RPG's own events");
  }
  return match;
}

export function parseRule(input: unknown): Parsed<Rule> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['a rule must be an object'] };
  const award = isObj(input.award) ? input.award : {};
  if (!isObj(input.award)) errors.push('award is required');
  const stat = typeof award.stat === 'string' ? award.stat.trim() : '';
  if (!STAT.test(stat)) errors.push('award.stat must be a short name (letters, digits, spaces)');
  const rule: Rule = {
    id: id(input.id, 'id', errors),
    version: input.version === undefined ? 1 : int(input.version, 'version', 1, Number.MAX_SAFE_INTEGER, errors),
    name: text(input.name, 'name', LIMITS.maxName, errors),
    enabled: input.enabled === true,
    match: parseMatch(input.match, errors),
    award: { xp: int(award.xp, 'award.xp', 1, LIMITS.maxXp, errors), stat },
    effectiveFromSeq: input.effectiveFromSeq === undefined ? 0 : int(input.effectiveFromSeq, 'effectiveFromSeq', 0, Number.MAX_SAFE_INTEGER, errors),
  };
  if (input.dailyCap !== undefined) rule.dailyCap = int(input.dailyCap, 'dailyCap', 1, LIMITS.maxDailyCap, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: rule };
}

function parseCondition(v: unknown, errors: string[]): Condition {
  if (!isObj(v)) {
    errors.push('condition is required');
    return { kind: 'xp', target: 1 };
  }
  const target = int(v.target, 'condition.target', 1, LIMITS.maxTarget, errors);
  if (v.kind === 'count' || v.kind === 'days') {
    const ruleIds: string[] = [];
    if (!Array.isArray(v.ruleIds) || v.ruleIds.length === 0) errors.push('condition.ruleIds must list at least one rule');
    else {
      if (v.ruleIds.length > LIMITS.maxRuleIdsInCondition) errors.push(`condition.ruleIds lists more than ${LIMITS.maxRuleIdsInCondition} rules`);
      for (const r of v.ruleIds) {
        const ruleId = id(r, 'condition.ruleIds', errors);
        if (ruleId && !ruleIds.includes(ruleId)) ruleIds.push(ruleId);
      }
    }
    return { kind: v.kind, ruleIds, target };
  }
  if (v.kind === 'xp') {
    if (v.stat === undefined) return { kind: 'xp', target };
    if (typeof v.stat !== 'string' || !STAT.test(v.stat.trim())) errors.push('condition.stat is invalid');
    return { kind: 'xp', stat: typeof v.stat === 'string' ? v.stat.trim() : '', target };
  }
  errors.push('condition.kind must be "count", "xp" or "days"');
  return { kind: 'xp', target };
}

export function parseAchievement(input: unknown): Parsed<AchievementDef> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['an achievement must be an object'] };
  const value: AchievementDef = {
    id: id(input.id, 'id', errors),
    name: text(input.name, 'name', LIMITS.maxName, errors),
    description: text(input.description, 'description', LIMITS.maxDescription, errors),
    condition: parseCondition(input.condition, errors),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/;

function parseWindow(v: unknown, errors: string[]): QuestWindow {
  if (v === undefined) return { kind: 'none' };
  if (!isObj(v)) {
    errors.push('window is invalid');
    return { kind: 'none' };
  }
  if (v.kind === 'none' || v.kind === 'daily' || v.kind === 'weekly') return { kind: v.kind };
  if (v.kind === 'fixed') {
    const from = typeof v.from === 'string' && ISO.test(v.from) && Number.isFinite(Date.parse(v.from)) ? v.from : '';
    const to = typeof v.to === 'string' && ISO.test(v.to) && Number.isFinite(Date.parse(v.to)) ? v.to : '';
    if (!from || !to) errors.push('window.from and window.to must be dates');
    else if (Date.parse(to) <= Date.parse(from)) errors.push('window.to must be after window.from');
    return { kind: 'fixed', from, to };
  }
  errors.push('window.kind must be "none", "fixed", "daily" or "weekly"');
  return { kind: 'none' };
}

const STATUSES: readonly QuestStatus[] = ['active', 'completed', 'abandoned'];

export function parseQuest(input: unknown): Parsed<Quest> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['a quest must be an object'] };
  const status = input.status === undefined ? 'active' : input.status;
  if (typeof status !== 'string' || !STATUSES.includes(status as QuestStatus)) errors.push('status is invalid');
  const createdAt = typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt)) ? input.createdAt : '';
  if (!createdAt) errors.push('createdAt must be a date');
  const value: Quest = {
    id: id(input.id, 'id', errors),
    title: text(input.title, 'title', LIMITS.maxName, errors),
    condition: parseCondition(input.condition, errors),
    window: parseWindow(input.window, errors),
    status: STATUSES.includes(status as QuestStatus) ? (status as QuestStatus) : 'active',
    createdAt,
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Every event type the enabled rules name - the complete list the game may read. */
export function namedTypes(rules: readonly Rule[]): string[] {
  const out = new Set<string>();
  for (const rule of rules) if (rule.enabled) for (const t of rule.match.types) out.add(t);
  return [...out].sort();
}
