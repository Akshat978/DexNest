/**
 * Phase 7: the edges. Restarts, a disk fault at every write of a run, large
 * logs, racing triggers, seq reuse, DST, corrupt definitions, rule edits,
 * odd dates, deleted source events and the top of the level curve. All data
 * is synthetic, in temp directories.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEventLog, createHostScheduler, runFoundationMigrations, type EventQuery, type SchedulerTimers, type SqlDatabase } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { createRealityRpgModule, type RealityRpgModule } from '../module/runtime.ts';
import { runRealityRpgMigrations } from '../store/index.ts';
import { defaultRealityRpgSettings, normalizeRealityRpgSettings, type RealityRpgSettings } from '../domain/settings.ts';
import { LEVEL_THRESHOLDS } from '../domain/data/levels.ts';
import { RPG_PROCESS_JOB } from '../manifest.ts';

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

function heldTimers(): SchedulerTimers & { count(): number; fire(): Promise<void> } {
  let next = 0;
  const live = new Map<number, () => void>();
  return {
    set: (cb) => { const id = ++next; live.set(id, cb); return id; },
    clear: (id) => { live.delete(id as number); },
    count: () => live.size,
    async fire() {
      for (const [id, cb] of [...live]) { live.delete(id); cb(); }
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

interface Game {
  handle: TestDatabase;
  db: SqlDatabase;
  module: RealityRpgModule;
  clock: { now: Date };
  queries: EventQuery[];
  commit(at?: string): void;
  legacy(module: string, actionId: string, at?: string): void;
}

const games: TestDatabase[] = [];
afterEach(() => {
  for (const h of games.splice(0)) h.dispose();
});

/** A game over one database; `wrap` lets a test put a faulty disk under everything. */
function game(options: { handle?: TestDatabase; wrap?: (db: SqlDatabase) => SqlDatabase; timeZone?: string; settings?: RealityRpgSettings; scheduler?: ReturnType<typeof createHostScheduler> } = {}): Game {
  const handle = options.handle ?? createTestDatabase('rpg-hard-');
  if (!options.handle) games.push(handle);
  runFoundationMigrations(handle.db);
  runRealityRpgMigrations(handle.db);
  const db = options.wrap ? options.wrap(handle.db) : handle.db;
  const log = createEventLog(db);
  const clock = { now: new Date('2026-06-01T12:00:00.000Z') };
  const queries: EventQuery[] = [];
  let stored = options.settings ?? defaultRealityRpgSettings();
  let n = 0;
  const module = createRealityRpgModule({
    database: db,
    events: log,
    reader: { query: <T = unknown>(f?: EventQuery) => { queries.push(f ?? {}); return log.query<T>(f); } },
    scheduler: options.scheduler ?? createHostScheduler({ timers: heldTimers() }),
    settings: { read: () => stored, write: (s) => (stored = s) },
    timeZone: options.timeZone ?? 'UTC',
    now: () => clock.now,
  });
  return {
    handle,
    db,
    module,
    clock,
    queries,
    commit(at) {
      const t = at ?? clock.now.toISOString();
      log.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', source: 't', occurredAt: t, recordedAt: t, payload: {} });
    },
    legacy(module, actionId, at) {
      handle.db.prepare('INSERT INTO event_log (id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run([
        `lg-${++n}-${Math.random()}`, 'action_executed', 'command', JSON.stringify({ module, actionId, status: 'success', summary: 'synthetic' }), at ?? clock.now.toISOString(),
      ]);
    },
  };
}

const commitRule = { id: 'commits', name: 'Commit observed', enabled: true, match: { types: ['dev.commit.observed'] }, award: { xp: 10, stat: 'Craft' } };
const later = (g: Game, ms = 1000) => { g.clock.now = new Date(g.clock.now.getTime() + ms); };

describe('restart', () => {
  it('a run killed before it committed is closed out on the next start; nothing is lost or doubled', async () => {
    const first = game();
    first.module.saveRule(commitRule);
    later(first);
    first.commit();
    await first.module.refresh();
    first.commit();
    // The process dies with a run begun but not committed.
    first.module.store.beginRun({ id: 'dying', occurrenceId: 'process:dying', trigger: 'scheduled', startedAt: first.clock.now.toISOString() });
    first.handle.close();

    const reopened = first.handle.reopen();
    games.push(reopened);
    const second = game({ handle: reopened });
    second.clock.now = first.clock.now;
    second.module.start();
    expect(second.module.store.getRun('dying')!.status).toBe('failed');
    await second.module.refresh();
    expect(second.module.store.allAwards()).toHaveLength(2);
    await second.module.refresh();
    expect(second.module.store.allAwards()).toHaveLength(2);
    second.module.stop();
  });
});

describe('a disk fault at every write of a run', () => {
  const statements = [
    /INSERT OR IGNORE INTO rpg_awards/,
    /INSERT OR IGNORE INTO rpg_achievement_unlocks/,
    /INSERT OR IGNORE INTO rpg_quest_completions/,
    /UPDATE rpg_quests SET status = 'completed'/,
    /INSERT OR IGNORE INTO rpg_levels/,
    /UPDATE rpg_runs SET status = 'completed'/,
    /INSERT INTO rpg_state/,
    /INSERT OR IGNORE INTO event_log|INSERT INTO event_log/,
  ];

  it.each(statements.map((s) => [s.source, s]))('%s failing leaves nothing behind, and the next run awards exactly once', async (_name, failOn) => {
    const handle = createTestDatabase('rpg-fault-');
    games.push(handle);
    // Set up on a healthy disk.
    const healthy = game({ handle });
    healthy.module.saveRule({ ...commitRule, award: { xp: 60, stat: 'Craft' } });
    healthy.module.saveAchievement({ id: 'first', name: 'First', description: 'd', condition: { kind: 'xp', target: 1 } });
    healthy.module.createQuest({ id: 'once', title: 'Two commits', condition: { kind: 'count', ruleIds: ['commits'], target: 2 } });
    later(healthy);
    healthy.commit();
    healthy.commit();

    // The disk fails during the run.
    const broken = game({ handle, wrap: (db) => failing(db, failOn) });
    broken.clock.now = healthy.clock.now;
    await expect(broken.module.refresh()).rejects.toThrow(/injected/);
    const store = healthy.module.store;
    expect(store.allAwards()).toEqual([]);
    expect(store.listUnlocks()).toEqual([]);
    expect(store.listLevels()).toEqual([]);
    expect(store.listCompletions()).toEqual([]);
    expect(store.getQuest('once')!.status).toBe('active');
    expect(store.cursor()).toBe(0);
    expect(handle.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE stream = 'rpg'").get<{ n: number }>()!.n).toBe(0);
    expect(store.listRuns(10).some((r) => r.status === 'failed')).toBe(true);

    // The disk recovers.
    await healthy.module.refresh();
    expect(store.allAwards()).toHaveLength(2);
    expect(store.listUnlocks().map((u) => u.achievementId)).toEqual(['first']);
    expect(store.listLevels().map((l) => l.level)).toEqual([2]);
    expect(store.getQuest('once')!.status).toBe('completed');
    await healthy.module.refresh();
    expect(store.allAwards()).toHaveLength(2);
  });
});

describe('racing and duplicate triggers', () => {
  it('ten refreshes at once: one run awards, the rest find nothing new', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    for (let i = 0; i < 5; i++) g.commit();
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => g.module.refresh()));
    expect(outcomes.filter((o) => o.status === 'completed')).toHaveLength(1);
    expect(g.module.store.allAwards()).toHaveLength(5);
  });

  it('the real host scheduler: manual runs racing a slot delivered twice give one set of awards', async () => {
    const timers = heldTimers();
    const scheduler = createHostScheduler({ timers, now: () => Date.parse('2026-06-01T12:00:00.000Z') });
    const g = game({ scheduler, settings: { ...defaultRealityRpgSettings(), enabled: true } });
    g.module.saveRule(commitRule);
    later(g);
    for (let i = 0; i < 3; i++) g.commit();
    g.module.start();
    expect(timers.count()).toBe(1);
    await Promise.all([scheduler.runNow(RPG_PROCESS_JOB), scheduler.runNow(RPG_PROCESS_JOB), timers.fire(), timers.fire()]);
    expect(g.module.store.allAwards()).toHaveLength(3);
    expect(g.module.store.listRuns(20).filter((r) => r.status === 'completed')).toHaveLength(1);
    g.module.stop();
    expect(timers.count()).toBe(0);
    await scheduler.dispose();
  });
});

describe('seq reuse', () => {
  it('the whole audit history cleared (the log goes empty) and refilled: new events are awarded, none twice', async () => {
    const g = game();
    g.module.saveRule({ id: 'copies', name: 'Copies', enabled: true, match: { types: ['action_executed'], actionIds: ['clipboard.copy'] }, award: { xp: 1, stat: 'Order' } });
    later(g);
    for (let i = 0; i < 3; i++) g.legacy('clipboard', 'clipboard.copy');
    await g.module.refresh();
    g.handle.db.prepare("DELETE FROM event_log WHERE stream = 'audit'").run();
    expect(g.handle.db.prepare("SELECT COUNT(*) AS n FROM event_log WHERE stream = 'audit'").get<{ n: number }>()!.n).toBe(0);
    // Nothing named exists now; a refresh must not reset or break anything.
    await g.module.refresh();
    later(g);
    g.legacy('clipboard', 'clipboard.copy');
    g.legacy('clipboard', 'clipboard.copy');
    await g.module.refresh();
    expect(g.module.store.allAwards()).toHaveLength(5);
    await g.module.refresh();
    expect(g.module.store.allAwards()).toHaveLength(5);
  });
});

describe('time', () => {
  it('daily caps and daily quests follow the local day across a DST change', async () => {
    const g = game({ timeZone: 'America/New_York' });
    g.clock.now = new Date('2026-03-07T12:00:00.000Z');
    g.module.saveRule({ ...commitRule, dailyCap: 1 });
    g.module.createQuest({ id: 'daily', title: 'Commit daily', condition: { kind: 'count', ruleIds: ['commits'], target: 1 }, window: { kind: 'daily' } });
    // 23:30 EST on the 7th, 00:30 EST on the 8th, and 03:30 EDT on the 8th (after spring-forward).
    g.commit('2026-03-08T04:30:00.000Z');
    g.commit('2026-03-08T05:30:00.000Z');
    g.commit('2026-03-08T07:30:00.000Z');
    g.clock.now = new Date('2026-03-08T15:00:00.000Z');
    await g.module.refresh();
    expect(g.module.store.allAwards().map((a) => a.localDay).sort()).toEqual(['2026-03-07', '2026-03-08']);
    expect(g.module.store.listCompletions('daily').map((c) => c.periodKey).sort()).toEqual(['2026-03-07', '2026-03-08']);
  });

  it('an event with an unreadable time is skipped, not re-read forever', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    g.handle.db.prepare("INSERT INTO event_log (id, type, source, payload_json, created_at, stream, module, occurred_at) VALUES ('bad', 'dev.commit.observed', 't', '{}', ?, 'dev', 'developer_intelligence', 'not a date')").run([g.clock.now.toISOString()]);
    g.commit();
    const first = await g.module.refresh();
    expect(first.status).toBe('completed');
    expect(g.module.store.allAwards()).toHaveLength(1);
    expect((await g.module.refresh()).status).toBe('skipped');
  });

  it('far-future event times do not break levels, caps or quests', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    g.commit('2099-01-01T00:00:00.000Z');
    await g.module.refresh();
    expect(g.module.snapshot().sheet.totalXp).toBe(10);
  });
});

describe('definitions', () => {
  it('a corrupt or sneaky stored rule is ignored, its types are never queried, and valid rules keep working', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    const t = g.clock.now.toISOString();
    g.handle.db.prepare("INSERT INTO rpg_rules (id, version, name, enabled, effective_from, definition_json, created_at, updated_at) VALUES ('broken', 1, 'b', 1, ?, '{', ?, ?)").run([t, t, t]);
    g.handle.db.prepare("INSERT INTO rpg_rules (id, version, name, enabled, effective_from, definition_json, created_at, updated_at) VALUES ('sneaky', 1, 's', 1, ?, ?, ?, ?)").run([
      t, JSON.stringify({ ...commitRule, id: 'sneaky', match: { types: ['journal_entry_saved'] }, effectiveFrom: t }), t, t,
    ]);
    later(g);
    g.commit();
    await g.module.refresh();
    expect(g.module.store.allAwards()).toHaveLength(1);
    for (const q of g.queries) expect(q.types).toEqual(['dev.commit.observed']);
    expect(g.module.snapshot().invalid.rules.map((i) => i.id)).toEqual(['broken', 'sneaky']);
  });

  it('editing a rule changes future awards only; past awards keep the XP and version they were given', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    g.commit();
    await g.module.refresh();
    g.module.saveRule({ ...commitRule, award: { xp: 25, stat: 'Craft' } });
    later(g);
    g.commit();
    await g.module.refresh();
    const awards = g.module.store.allAwards();
    expect(awards.map((a) => [a.xp, a.ruleVersion])).toEqual([[10, 1], [25, 2]]);
    expect(g.module.store.ruleVersion('commits', 1)!.award.xp).toBe(10);
  });

  it('corrupt settings read back as off', () => {
    for (const junk of ['{', null, [], { enabled: 'yes' }, { intervalMinutes: -1 }]) {
      expect(normalizeRealityRpgSettings(junk).enabled).toBe(false);
    }
  });
});

describe('history and limits', () => {
  it('awards stay when their source events are deleted, and are not given again', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    g.commit();
    g.commit();
    await g.module.refresh();
    g.handle.db.prepare("DELETE FROM event_log WHERE stream = 'dev'").run();
    await g.module.refresh();
    expect(g.module.snapshot().sheet.totalXp).toBe(20);
  });

  it('the top of the level curve: every level recorded once, no overflow', async () => {
    const g = game();
    g.module.saveRule({ ...commitRule, award: { xp: 500, stat: 'Craft' } });
    later(g);
    const top = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]!;
    for (let i = 0; i < Math.ceil(top / 500) + 10; i++) g.commit();
    await g.module.refresh();
    const sheet = g.module.snapshot().sheet;
    expect(sheet.level).toBe(LEVEL_THRESHOLDS.length);
    expect(sheet.xpToNextLevel).toBeNull();
    expect(g.module.store.listLevels().map((l) => l.level)).toEqual(Array.from({ length: LEVEL_THRESHOLDS.length - 1 }, (_, i) => i + 2));
  }, 60_000);

  it('a 100,000-event log (half of it unnamed noise): bounded time, and later runs stay cheap', async () => {
    const g = game();
    g.module.saveRule(commitRule);
    later(g);
    const log = createEventLog(g.handle.db);
    const t = g.clock.now.toISOString();
    g.handle.db.exec('BEGIN');
    for (let i = 0; i < 50_000; i++) {
      log.append({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', source: 't', occurredAt: t, recordedAt: t, payload: {} });
      log.append({ type: 'clipboard_history_cleanup', stream: 'audit', module: 'clipboard', source: 't', occurredAt: t, recordedAt: t, payload: { summary: 'noise' } });
    }
    g.handle.db.exec('COMMIT');

    const started = performance.now();
    await g.module.refresh();
    const firstRun = performance.now() - started;
    expect(g.module.store.allAwards()).toHaveLength(50_000);
    expect(firstRun).toBeLessThan(60_000);
    for (const q of g.queries) expect(q.types).toEqual(['dev.commit.observed']);

    later(g);
    for (let i = 0; i < 10; i++) g.commit();
    const nextStarted = performance.now();
    await g.module.refresh();
    const nextRun = performance.now() - nextStarted;
    expect(g.module.store.allAwards()).toHaveLength(50_010);
    const skipStarted = performance.now();
    expect((await g.module.refresh()).status).toBe('skipped');
    const skipRun = performance.now() - skipStarted;
    // Recorded for the report through the assertion message.
    expect(nextRun, `first ${Math.round(firstRun)} ms, next ${Math.round(nextRun)} ms, skip ${Math.round(skipRun)} ms`).toBeLessThan(5_000);
    // An idle run must not load the ledger: it skips on a fingerprint, in milliseconds.
    expect(skipRun).toBeLessThan(250);
  }, 180_000);
});
