import { describe, it, expect, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { inspectModuleMigrations, validateManifest, type SqlDatabase } from '@dexnest/foundation';
import { createRealityRpgStore, runRealityRpgMigrations, REALITY_RPG_MIGRATIONS, type RealityRpgStore } from '../store/index.ts';
import { manifestProblems, REALITY_RPG_MANIFEST } from '../manifest.ts';
import { computeAwards } from '../domain/awards.ts';
import type { Award, Quest, Rule } from '../domain/types.ts';
import { observed, rule } from './fixtures.ts';

const T = '2026-06-01T12:00:00.000Z';

function failing(db: SqlDatabase, failOn: RegExp): SqlDatabase {
  return {
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!failOn.test(sql)) return statement;
      return {
        run: () => {
          throw new Error('injected write failure');
        },
        get: (p) => statement.get(p),
        all: (p) => statement.all(p),
      };
    },
  };
}

describe('Reality RPG store', () => {
  let handle: TestDatabase | undefined;
  const extra: TestDatabase[] = [];
  afterEach(() => {
    for (const h of extra.splice(0)) h.close();
    handle?.dispose();
    handle = undefined;
  });

  function open() {
    handle = createTestDatabase('rpg-store-');
    runRealityRpgMigrations(handle.db);
    return handle;
  }

  const { version: _v, ...ruleInput } = rule();
  const quest: Quest = { id: 'q1', title: 'Commit twice', condition: { kind: 'count', ruleIds: ['commit-observed'], target: 2 }, window: { kind: 'none' }, status: 'active', createdAt: '2026-05-01T00:00:00.000Z' };

  function someAwards(r: Rule, n: number): Award[] {
    return computeAwards([r], Array.from({ length: n }, () => observed()), { alreadyAwarded: new Set(), dailyCounts: new Map(), timeZone: 'UTC' });
  }

  let runs = 0;
  function commit(store: RealityRpgStore, awards: Award[], extraInput: Partial<Parameters<RealityRpgStore['commitRun']>[0]> = {}) {
    const id = `run-${++runs}`;
    store.beginRun({ id, occurrenceId: `occ-${id}`, trigger: 'manual', startedAt: T });
    return store.commitRun({ runId: id, finishedAt: T, fromSeq: 0, toSeq: 100, maxSeqSeen: 100, awards, unlocks: [], questCompletions: [], levels: [], ...extraInput });
  }

  it('migrates once through the foundation ledger, into rpg_ tables only', () => {
    const { db } = open();
    expect(inspectModuleMigrations(db, 'reality_rpg', REALITY_RPG_MIGRATIONS)).toEqual({ applied: [1], pending: [] });
    expect(runRealityRpgMigrations(db)).toEqual({ applied: [], alreadyApplied: [1] });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rpg_%' ORDER BY name").all<{ name: string }>().map((r) => r.name);
    expect(tables).toEqual([
      'rpg_achievement_unlocks', 'rpg_achievements', 'rpg_awards', 'rpg_levels', 'rpg_quest_completions',
      'rpg_quests', 'rpg_rule_versions', 'rpg_rules', 'rpg_runs', 'rpg_state',
    ]);
  });

  it('manifest is valid, and validation would catch a table outside the prefix', () => {
    expect(manifestProblems()).toEqual([]);
    expect(validateManifest({ ...REALITY_RPG_MANIFEST, migrations: [{ version: 2, name: 'x', sql: 'CREATE TABLE event_log2 (id TEXT)' }] }, 'rpg')).toHaveLength(1);
  });

  it('everything survives closing and reopening the database', () => {
    const h = open();
    const store = createRealityRpgStore(h.db);
    const saved = store.saveRule(ruleInput, T);
    store.saveAchievement({ id: 'first', name: 'First', description: 'd', condition: { kind: 'xp', target: 1 } }, T);
    store.createQuest(quest);
    const awards = someAwards(saved, 3);
    commit(store, awards, { unlocks: [{ achievementId: 'first', tippingAwardId: awards[0]!.id }], questCompletions: [{ questId: 'q1', periodKey: 'once', completesQuest: true }], levels: [{ level: 2, totalXp: 100 }] });
    h.close();

    const again = h.reopen();
    extra.push(again);
    const s = createRealityRpgStore(again.db);
    expect(runRealityRpgMigrations(again.db).applied).toEqual([]);
    expect(s.listRules()).toEqual({ rules: [saved], invalid: [] });
    expect(s.allAwards().map((a) => a.id)).toEqual(awards.map((a) => a.id));
    expect(s.totals()).toEqual({ totalXp: 15, stats: [{ stat: 'Craft', xp: 15 }] });
    expect(s.listUnlocks().map((u) => u.achievementId)).toEqual(['first']);
    expect(s.getQuest('q1')!.status).toBe('completed');
    expect(s.listCompletions('q1')).toHaveLength(1);
    expect(s.listLevels().map((l) => l.level)).toEqual([2]);
    expect(s.cursor()).toBe(100);
    expect(s.maxSeqSeen()).toBe(100);
  });

  it('the ledger holds each (rule, event) once: a replayed award is not written or counted', () => {
    const store = createRealityRpgStore(open().db);
    const awards = someAwards(rule(), 2);
    expect(commit(store, awards).inserted).toHaveLength(2);
    const replay = commit(store, awards);
    expect(replay.inserted).toEqual([]);
    expect(replay.run).toMatchObject({ awards: 0, xp: 0 });
    // Even with a different award id, the same rule and event cannot be written twice.
    const forged = { ...awards[0]!, id: 'aw_forged' };
    expect(commit(store, [forged]).inserted).toEqual([]);
    expect(store.allAwards()).toHaveLength(2);
    expect(store.totals().totalXp).toBe(10);
  });

  it('unlocks, completions and levels are recorded once each', () => {
    const store = createRealityRpgStore(open().db);
    const awards = someAwards(rule(), 1);
    const input = { unlocks: [{ achievementId: 'a', tippingAwardId: awards[0]!.id }], questCompletions: [{ questId: 'q', periodKey: '2026-06-01', completesQuest: false }], levels: [{ level: 2, totalXp: 100 }] };
    const first = commit(store, awards, input);
    const second = commit(store, [], input);
    expect([first.newUnlocks, first.newCompletions.length, first.newLevels]).toEqual([['a'], 1, [2]]);
    expect([second.newUnlocks, second.newCompletions, second.newLevels]).toEqual([[], [], []]);
  });

  describe('a run lands whole or not at all', () => {
    function expectNothingFrom(store: RealityRpgStore, runId: string) {
      expect(store.allAwards()).toEqual([]);
      expect(store.listUnlocks()).toEqual([]);
      expect(store.listLevels()).toEqual([]);
      expect(store.cursor()).toBe(0);
      expect(store.getRun(runId)!.status).toBe('running');
    }

    it('when a later write in the same transaction throws', () => {
      const store = createRealityRpgStore(open().db);
      const awards = someAwards(rule(), 2);
      store.beginRun({ id: 'r', occurrenceId: 'o', trigger: 'manual', startedAt: T });
      expect(() =>
        store.commitRun({
          runId: 'r', finishedAt: T, fromSeq: 0, toSeq: 50, maxSeqSeen: 50, awards,
          unlocks: [{ achievementId: 'a', tippingAwardId: awards[0]!.id }], questCompletions: [], levels: [{ level: 2, totalXp: 100 }],
          alsoInTransaction: () => {
            throw new Error('event write failed');
          },
        }),
      ).toThrow(/event write failed/);
      expectNothingFrom(store, 'r');
    });

    it.each([/INSERT OR IGNORE INTO rpg_achievement_unlocks/, /INSERT OR IGNORE INTO rpg_levels/, /UPDATE rpg_runs SET status = 'completed'/, /INSERT INTO rpg_state/])(
      'when the disk refuses %s',
      (failOn) => {
        const h = open();
        const awards = someAwards(rule(), 2);
        const broken = createRealityRpgStore(failing(h.db, failOn));
        broken.beginRun({ id: 'r', occurrenceId: 'o', trigger: 'manual', startedAt: T });
        expect(() =>
          broken.commitRun({ runId: 'r', finishedAt: T, fromSeq: 0, toSeq: 50, maxSeqSeen: 50, awards, unlocks: [{ achievementId: 'a', tippingAwardId: awards[0]!.id }], questCompletions: [], levels: [{ level: 2, totalXp: 100 }] }),
        ).toThrow(/injected/);
        expectNothingFrom(createRealityRpgStore(h.db), 'r');
      },
    );
  });

  it('one occurrence is one run; a run cannot be committed twice', () => {
    const store = createRealityRpgStore(open().db);
    const a = store.beginRun({ id: 'r1', occurrenceId: 'process:slot', trigger: 'scheduled', startedAt: T });
    const b = store.beginRun({ id: 'r2', occurrenceId: 'process:slot', trigger: 'manual', startedAt: T });
    expect(a.started).toBe(true);
    expect(b).toEqual({ started: false, run: a.run });
    store.commitRun({ runId: 'r1', finishedAt: T, fromSeq: 0, toSeq: 1, maxSeqSeen: 1, awards: [], unlocks: [], questCompletions: [], levels: [] });
    expect(() => store.commitRun({ runId: 'r1', finishedAt: T, fromSeq: 0, toSeq: 9, maxSeqSeen: 9, awards: [], unlocks: [], questCompletions: [], levels: [] })).toThrow(/completed, not running/);
    expect(store.cursor()).toBe(1);
  });

  it('a crash leaves a running run; recovery marks it failed and keeps the ledger', () => {
    const h = open();
    const store = createRealityRpgStore(h.db);
    commit(store, someAwards(rule(), 1));
    store.beginRun({ id: 'crashed', occurrenceId: 'occ-crashed', trigger: 'scheduled', startedAt: T });
    h.close();
    const again = h.reopen();
    extra.push(again);
    const s = createRealityRpgStore(again.db);
    expect(s.recoverInterruptedRuns(T)).toBe(1);
    expect(s.getRun('crashed')).toMatchObject({ status: 'failed', error: 'Interrupted before it finished.' });
    expect(s.allAwards()).toHaveLength(1);
    expect(s.recoverInterruptedRuns(T)).toBe(0);
  });

  it('a skipped run records only itself and the max seq it saw', () => {
    const store = createRealityRpgStore(open().db);
    store.beginRun({ id: 's', occurrenceId: 'o', trigger: 'scheduled', startedAt: T });
    expect(store.markSkipped('s', { finishedAt: T, maxSeqSeen: 7 }).status).toBe('skipped');
    expect([store.cursor(), store.maxSeqSeen()]).toEqual([0, 7]);
  });

  describe('rules', () => {
    it('every save is a new version, and old versions stay readable', () => {
      const store = createRealityRpgStore(open().db);
      expect(store.saveRule(ruleInput, T).version).toBe(1);
      const v2 = store.saveRule({ ...ruleInput, award: { xp: 9, stat: 'Craft' } }, T);
      expect(v2.version).toBe(2);
      expect(store.getRule('commit-observed')!.award.xp).toBe(9);
      expect(store.ruleVersion('commit-observed', 1)!.award.xp).toBe(5);
    });

    it('refuses to store a rule the domain would refuse', () => {
      const store = createRealityRpgStore(open().db);
      expect(() => store.saveRule({ ...ruleInput, match: { types: ['vault_ocr_completed'] } }, T)).toThrow(/vault, finance or journal/);
      expect(store.listRules().rules).toEqual([]);
    });

    it('deleting a rule keeps the awards it gave', () => {
      const store = createRealityRpgStore(open().db);
      const r = store.saveRule(ruleInput, T);
      commit(store, someAwards(r, 2));
      expect(store.deleteRule(r.id)).toBe(true);
      expect(store.getRule(r.id)).toBeUndefined();
      expect(store.totals().totalXp).toBe(10);
    });

    it('a stored definition that no longer validates is reported, never used', () => {
      const { db } = open();
      const store = createRealityRpgStore(db);
      store.saveRule(ruleInput, T);
      db.prepare("INSERT INTO rpg_rules (id, version, name, enabled, effective_from, definition_json, created_at, updated_at) VALUES ('broken', 1, 'b', 1, ?, '{not json', ?, ?)").run([T, T, T]);
      db.prepare("INSERT INTO rpg_rules (id, version, name, enabled, effective_from, definition_json, created_at, updated_at) VALUES ('sneaky', 1, 's', 1, ?, ?, ?, ?)").run([
        T,
        JSON.stringify({ ...ruleInput, id: 'sneaky', match: { types: ['action_executed'], module: 'journal' } }), T, T,
      ]);
      const { rules, invalid } = store.listRules();
      expect(rules.map((r) => r.id)).toEqual(['commit-observed']);
      expect(invalid.map((i) => i.id)).toEqual(['broken', 'sneaky']);
      expect(invalid[1]!.errors).toContain('rules may not name vault, finance or journal activity');
    });
  });

  it('quests: created active, can be abandoned and resumed, and a completed quest stays completed', () => {
    const store = createRealityRpgStore(open().db);
    expect(store.createQuest({ ...quest, status: 'completed' }).status).toBe('active');
    expect(store.setQuestStatus('q1', 'abandoned', T)!.status).toBe('abandoned');
    expect(store.listQuests('active').quests).toEqual([]);
    expect(store.setQuestStatus('q1', 'active', T)!.status).toBe('active');
    commit(store, [], { questCompletions: [{ questId: 'q1', periodKey: 'once', completesQuest: true }] });
    expect(store.setQuestStatus('q1', 'abandoned', T)!.status).toBe('completed');
  });

  it('daily counts per rule and day come from the ledger', () => {
    const store = createRealityRpgStore(open().db);
    commit(store, someAwards(rule(), 3));
    expect(store.dailyCounts(['commit-observed'], ['2026-06-01', '2026-06-02'])).toEqual(new Map([['commit-observed|2026-06-01', 3]]));
    expect(store.dailyCounts([], ['2026-06-01']).size).toBe(0);
  });

  it('the schema refuses zero or negative XP and unknown statuses', () => {
    const { db } = open();
    expect(() =>
      db.prepare("INSERT INTO rpg_awards (id, rule_id, rule_version, event_id, event_seq, event_type, occurred_at, local_day, xp, stat, awarded_at, run_id) VALUES ('x','r',1,'e',1,'t','d','d',0,'s','d','r')").run(),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO rpg_quests (id, definition_json, status, created_at) VALUES ('x', '{}', 'won', 'd')").run()).toThrow(/CHECK/);
  });
});
