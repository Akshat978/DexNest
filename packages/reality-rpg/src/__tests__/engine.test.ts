import { describe, it, expect, afterEach } from 'vitest';
import { createWorld, type World } from './world.ts';

describe('Reality RPG engine', () => {
  let w: World;
  afterEach(() => w?.dispose());

  it('awards matching events and records the envelope, not the content', async () => {
    w = createWorld();
    w.rule({ id: 'standup', match: { types: ['action_executed'], actionIds: ['standup.generate'], status: 'success' }, award: { xp: 10, stat: 'Focus' } });
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'], stream: 'dev' }, award: { xp: 5, stat: 'Craft' } });
    w.legacy({ module: 'standup', actionId: 'standup.generate', summary: 'Standup ready: 3 item(s) about Project Falcon' });
    w.legacy({ module: 'standup', actionId: 'standup.generate', status: 'failed' });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', payload: { sha: 'abc', subject: 'secret refactor of billing' } });

    const out = await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
    expect(out.status).toBe('completed');
    expect(w.store.allAwards().map((a) => `${a.ruleId}:${a.eventType}:${a.actionId ?? '-'}`).sort()).toEqual([
      'commits:dev.commit.observed:-',
      'standup:action_executed:standup.generate',
    ]);
    expect(w.store.totals()).toEqual({ totalXp: 15, stats: [{ stat: 'Focus', xp: 10 }, { stat: 'Craft', xp: 5 }] });
    const dump = w.dump();
    for (const bait of ['Project Falcon', 'billing', 'abc']) expect(dump, bait).not.toContain(bait);
  });

  it('reads only the event types enabled rules name; with no rules it reads nothing', async () => {
    w = createWorld();
    w.legacy({ type: 'clipboard_history_cleanup', module: 'clipboard', actionId: 'clipboard.cleanup', summary: 'removed my copied password' });
    const idle = await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
    expect(idle).toMatchObject({ status: 'skipped', reason: 'no_rules' });
    expect(w.queries).toEqual([]);

    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
    w.rule({ id: 'off', enabled: false, match: { types: ['never_read_this'] } });
    await w.engine().process({ occurrenceId: 'o2', trigger: 'manual' });
    expect(w.queries.length).toBeGreaterThan(0);
    for (const q of w.queries) expect(q.types).toEqual(['dev.commit.observed']);
    expect(w.dump()).not.toContain('password');
  });

  describe('bait: vault, finance and journal', () => {
    it('are never recorded, even by a rule broad enough to match every action', async () => {
      w = createWorld();
      w.rule({ id: 'any-action', match: { types: ['action_executed'] } });
      const baits = [
        w.legacy({ module: 'vault', actionId: 'vault.secure.copy_secret', summary: 'Copied secret hunter2 for bank.example' }),
        w.legacy({ module: 'finance', actionId: 'finance.log_receipt_from_drop', summary: 'Receipt 1,240.00 salary advance', metadataJson: { amount: 1240 } }),
        w.legacy({ module: 'journal', actionId: 'journal.draft_worklog', summary: 'Dear diary, today I felt anxious' }),
        // Mislabelled: an ordinary module, but a denied action id.
        w.legacy({ module: 'command', actionId: 'vault.secure.unlock', summary: 'unlocked vault' }),
      ];
      const ok = w.legacy({ module: 'clipboard', actionId: 'clipboard.copy', summary: 'copied the lunch menu' });

      await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
      expect(w.store.allAwards().map((a) => a.eventId)).toEqual([ok]);
      const dump = w.dump();
      for (const bait of [...baits, 'hunter2', 'bank.example', 'salary', '1240', 'diary', 'anxious', 'vault', 'finance', 'journal', 'lunch menu']) {
        expect(dump, bait).not.toContain(bait);
      }
    });
  });

  describe('idempotency', () => {
    it('processing again finds nothing new; replaying from the start awards nothing twice', async () => {
      w = createWorld();
      w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
      for (let i = 0; i < 5; i++) w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
      const engine = w.engine();
      expect((await engine.process({ occurrenceId: 'o1', trigger: 'scheduled' })).status).toBe('completed');
      expect(await engine.process({ occurrenceId: 'o2', trigger: 'scheduled' })).toMatchObject({ status: 'skipped', reason: 'nothing_new' });

      w.store.setCursor(0); // replay everything
      const replay = await engine.process({ occurrenceId: 'o3', trigger: 'manual' });
      expect(replay.status === 'completed' && replay.committed.inserted).toEqual([]);
      expect(w.store.allAwards()).toHaveLength(5);
      expect(w.store.totals().totalXp).toBe(50);
    });

    it('the same occurrence twice is one run; different ones run one after the other', async () => {
      w = createWorld();
      w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
      w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
      const engine = w.engine();
      const [a, b] = await Promise.all([engine.process({ occurrenceId: 'slot', trigger: 'scheduled' }), engine.process({ occurrenceId: 'slot', trigger: 'manual' })]);
      expect([a.status, b.status]).toEqual(['completed', 'duplicate']);
      const racing = await Promise.all(['x', 'y', 'z'].map((o) => engine.process({ occurrenceId: o, trigger: 'manual' })));
      expect(racing.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
      expect(w.store.allAwards()).toHaveLength(1);
    });
  });

  it('a rule never awards events recorded before it took effect', async () => {
    w = createWorld();
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', at: '2026-05-01T00:00:00.000Z' });
    const fresh = w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', at: '2026-06-01T11:00:00.000Z' });
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] }, effectiveFrom: '2026-06-01T00:00:00.000Z' });
    await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
    expect(w.store.allAwards().map((a) => a.eventId)).toEqual([fresh]);
  });

  it('daily caps hold across runs', async () => {
    w = createWorld();
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] }, dailyCap: 3 });
    const engine = w.engine();
    for (let i = 0; i < 2; i++) w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    await engine.process({ occurrenceId: 'o1', trigger: 'manual' });
    for (let i = 0; i < 4; i++) w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    await engine.process({ occurrenceId: 'o2', trigger: 'manual' });
    expect(w.store.allAwards()).toHaveLength(3);
  });

  it('seq reuse after an audit clear: detected, rescanned, new events awarded, old ones not twice', async () => {
    w = createWorld();
    w.rule({ id: 'standup', match: { types: ['action_executed'], actionIds: ['standup.generate'] } });
    for (let i = 0; i < 3; i++) w.legacy({ module: 'standup', actionId: 'standup.generate' });
    const engine = w.engine();
    await engine.process({ occurrenceId: 'o1', trigger: 'manual' });
    const cursor = w.store.cursor();

    // Settings -> Data Management -> clear audit history, exactly as local-db does it.
    w.handle.db.prepare("DELETE FROM event_log WHERE stream = 'audit'").run();
    const after = w.legacy({ module: 'standup', actionId: 'standup.generate', at: '2026-06-01T13:00:00.000Z' });
    const reusedSeq = w.log.get(after)!.seq;
    expect(reusedSeq).toBeLessThanOrEqual(cursor); // the problem, reproduced

    const out = await engine.process({ occurrenceId: 'o2', trigger: 'manual' });
    expect(out.status === 'completed' && out.rescanned).toBe(true);
    expect(w.store.allAwards().map((a) => a.eventId)).toContain(after);
    expect(w.store.allAwards()).toHaveLength(4);
  });

  it('achievements, quests and levels are evaluated from the ledger in the same run', async () => {
    w = createWorld();
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] }, award: { xp: 60, stat: 'Craft' } });
    w.store.saveAchievement({ id: 'two', name: 'Two', description: 'Two commits', condition: { kind: 'count', ruleIds: ['commits'], target: 2 } }, w.clock.now.toISOString());
    w.store.createQuest({ id: 'daily', title: 'Commit today', condition: { kind: 'count', ruleIds: ['commits'], target: 1 }, window: { kind: 'daily' }, status: 'active', createdAt: '2026-05-01T00:00:00.000Z' });
    w.store.createQuest({ id: 'once', title: 'Earn 100 XP', condition: { kind: 'xp', target: 100 }, window: { kind: 'none' }, status: 'active', createdAt: '2026-05-01T00:00:00.000Z' });
    // One commit yesterday (processed late) and two today.
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', at: '2026-05-31T10:00:00.000Z' });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });

    const out = await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
    expect(out.status).toBe('completed');
    if (out.status !== 'completed') return;
    expect(out.committed.newUnlocks).toEqual(['two']);
    expect(out.committed.newCompletions.map((c) => `${c.questId}:${c.periodKey}`).sort()).toEqual(['daily:2026-05-31', 'daily:2026-06-01', 'once:once']);
    expect(out.committed.newLevels).toEqual([2]);
    expect(w.store.getQuest('once')!.status).toBe('completed');
    expect(w.store.getQuest('daily')!.status).toBe('active');
  });

  it('a new achievement is unlocked from existing awards without any new event', async () => {
    w = createWorld();
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    const engine = w.engine();
    await engine.process({ occurrenceId: 'o1', trigger: 'manual' });
    w.store.saveAchievement({ id: 'first', name: 'First', description: 'd', condition: { kind: 'xp', target: 1 } }, w.clock.now.toISOString());
    const out = await engine.process({ occurrenceId: 'o2', trigger: 'manual' });
    expect(out.status === 'completed' && out.committed.newUnlocks).toEqual(['first']);
  });

  it('reads every event across many pages', async () => {
    w = createWorld();
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
    for (let i = 0; i < 1234; i++) w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    await w.engine({ pageSize: 100 }).process({ occurrenceId: 'o1', trigger: 'manual' });
    expect(w.store.allAwards()).toHaveLength(1234);
  });

  it('a failing read fails the run, keeps the ledger and cursor, and does not wedge the queue', async () => {
    w = createWorld();
    w.rule({ id: 'commits', match: { types: ['dev.commit.observed'] } });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    await w.engine().process({ occurrenceId: 'o1', trigger: 'manual' });
    w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });
    const broken = w.engine({ events: { query: () => { throw new Error('database is locked'); } } });
    await expect(broken.process({ occurrenceId: 'o2', trigger: 'manual' })).rejects.toThrow(/locked/);
    expect(w.store.getRunByOccurrence('o2')).toMatchObject({ status: 'failed', error: 'database is locked' });
    expect(w.store.allAwards()).toHaveLength(1);
    expect((await w.engine().process({ occurrenceId: 'o3', trigger: 'manual' })).status).toBe('completed');
    expect(w.store.allAwards()).toHaveLength(2);
  });
});
