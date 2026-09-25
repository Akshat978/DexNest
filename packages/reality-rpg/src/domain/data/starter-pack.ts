/**
 * An optional starter pack - data only, every rule disabled.
 *
 * Offered in the view so a new player has something to switch on; nothing
 * here does anything until the user enables a rule. It names only event
 * types DexNest writes today, and none from vault, finance or journal (the
 * tests check it passes validation).
 */

export const STARTER_RULES: readonly unknown[] = [
  {
    id: 'commit-observed',
    name: 'Commit observed',
    enabled: false,
    match: { types: ['dev.commit.observed'], stream: 'dev' },
    award: { xp: 5, stat: 'Craft' },
    dailyCap: 20,
  },
  {
    id: 'standup-generated',
    name: 'Standup generated',
    enabled: false,
    match: { types: ['action_executed'], stream: 'audit', actionIds: ['standup.generate'], status: 'success' },
    award: { xp: 10, stat: 'Focus' },
    dailyCap: 1,
  },
  {
    id: 'repositories-scanned',
    name: 'Repositories scanned',
    enabled: false,
    match: { types: ['action_executed'], stream: 'audit', actionIds: ['dev.scan_repositories'], status: 'success' },
    award: { xp: 5, stat: 'Order' },
    dailyCap: 3,
  },
  {
    id: 'backup-completed',
    name: 'Backup completed',
    enabled: false,
    match: { types: ['action_executed'], stream: 'audit', actionIds: ['backup.create'], status: 'success' },
    award: { xp: 15, stat: 'Order' },
    dailyCap: 1,
  },
];

export const STARTER_ACHIEVEMENTS: readonly unknown[] = [
  { id: 'first-steps', name: 'First steps', description: 'Earn your first XP.', condition: { kind: 'xp', target: 1 } },
  { id: 'hundred', name: 'Hundred', description: 'Earn 100 XP.', condition: { kind: 'xp', target: 100 } },
  {
    id: 'committed-week',
    name: 'Committed week',
    description: 'Have commits observed on 7 different days.',
    condition: { kind: 'days', ruleIds: ['commit-observed'], target: 7 },
  },
];
