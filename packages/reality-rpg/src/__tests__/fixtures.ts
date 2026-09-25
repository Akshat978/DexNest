/** Synthetic events and rules. Nothing here comes from a real event log. */
import type { ObservedEvent, RawEvent, Rule } from '../domain/types.ts';

export function raw(overrides: Partial<RawEvent> = {}): RawEvent {
  return { id: 'e1', seq: 1, type: 'action_executed', stream: 'audit', module: null, occurredAt: '2026-06-01T10:00:00.000Z', payload: {}, ...overrides };
}

let n = 0;
export function observed(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  n += 1;
  return {
    id: `ev-${n}`,
    seq: n,
    type: 'dev.commit.observed',
    stream: 'dev',
    module: 'developer_intelligence',
    actionId: null,
    status: null,
    occurredAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

export function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'commit-observed',
    version: 1,
    name: 'Commit observed',
    enabled: true,
    match: { types: ['dev.commit.observed'] },
    award: { xp: 5, stat: 'Craft' },
    effectiveFromSeq: 0,
    ...overrides,
  };
}

export const UTC = 'UTC';
