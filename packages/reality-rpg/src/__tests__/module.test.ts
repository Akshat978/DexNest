import { describe, it, expect, afterEach } from 'vitest';
import { createHostScheduler, type JobOccurrence, type ModuleScheduler, type ScheduledJob, type SchedulerTimers } from '@dexnest/foundation';
import { seededActions } from '@dexnest/action-registry';
import { createRealityRpgModule } from '../module/runtime.ts';
import { defaultRealityRpgSettings, type RealityRpgSettings } from '../domain/settings.ts';
import { REALITY_RPG_MANIFEST, RPG_ACTION_IDS, RPG_PROCESS_JOB } from '../manifest.ts';
import { createWorld, type World } from './world.ts';

function capturing(): ModuleScheduler & { jobs: Map<string, ScheduledJob> } {
  const jobs = new Map<string, ScheduledJob>();
  return {
    jobs,
    schedule(job) {
      jobs.set(job.id, job);
      return () => jobs.delete(job.id);
    },
    async runNow(id) {
      await jobs.get(id)?.run({ occurrenceId: `${id}:manual:x`, scheduledAt: 'x', trigger: 'manual' });
    },
  };
}

function heldTimers(): SchedulerTimers & { count(): number } {
  let next = 0;
  const live = new Set<number>();
  return { set: () => { const id = ++next; live.add(id); return id; }, clear: (id) => { live.delete(id as number); }, count: () => live.size };
}

describe('Reality RPG module', () => {
  let w: World;
  afterEach(() => w?.dispose());

  function setup(scheduler: ModuleScheduler = capturing()) {
    w = createWorld();
    let stored: RealityRpgSettings = defaultRealityRpgSettings();
    const module = createRealityRpgModule({
      database: w.handle.db,
      events: w.log,
      scheduler,
      settings: { read: () => stored, write: (s) => (stored = s) },
      timeZone: 'UTC',
      now: () => w.clock.now,
      // The host's audit callback: an action_executed-style line in the audit stream.
      audit: (summary, metadata, status) => {
        w.legacy({ type: 'reality_rpg', module: 'reality_rpg', actionId: 'reality_rpg.audit', status: status === 'success' ? 'success' : 'failed', summary, metadataJson: metadata });
      },
    });
    return { module, scheduler };
  }

  const rpgEvents = (type?: string) => w.log.query({ stream: 'rpg', module: 'reality_rpg', ...(type ? { types: [type] } : {}), limit: 1000 });
  const auditLines = () =>
    w.log.query({ stream: 'audit', types: ['reality_rpg'], limit: 1000 }).map((e) => (e.payload as { summary: string }).summary);
  const later = (ms: number) => { w.clock.now = new Date(w.clock.now.getTime() + ms); };

  const commitRule = { id: 'commits', name: 'Commit observed', enabled: true, match: { types: ['dev.commit.observed'] }, award: { xp: 60, stat: 'Craft' } };
  const commit = () => w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence' });

  it('is off by default: no job, no timer, nothing read', () => {
    const timers = heldTimers();
    const { module } = setup(createHostScheduler({ timers }));
    module.start();
    expect(timers.count()).toBe(0);
    expect(module.status().enabled).toBe(false);
    expect(w.queries).toEqual([]);
    module.stop();
  });

  it('turning on schedules one light job that catches up at startup; off removes it', () => {
    const scheduler = capturing();
    const { module } = setup(scheduler);
    module.enable();
    expect(scheduler.jobs.get(RPG_PROCESS_JOB)).toMatchObject({ heavy: false, runAtStartup: true, intervalMs: 15 * 60_000 });
    module.disable();
    expect(scheduler.jobs.size).toBe(0);
  });

  it('a scheduled slot fired twice gives one run, one set of awards and one set of events', async () => {
    const scheduler = capturing();
    const { module } = setup(scheduler);
    module.enable();
    module.saveRule(commitRule);
    later(1000);
    commit();
    commit();
    const job = scheduler.jobs.get(RPG_PROCESS_JOB)!;
    const slot: JobOccurrence = { occurrenceId: 'process:2026-06-01T12:00:00.000Z', scheduledAt: 'x', trigger: 'scheduled' };
    await Promise.all([job.run(slot), job.run(slot)]);
    await job.run(slot);
    expect(w.store.listRuns(10).filter((r) => r.status === 'completed')).toHaveLength(1);
    expect(w.store.allAwards()).toHaveLength(2);
    expect(rpgEvents('rpg.run.completed')).toHaveLength(1);
    expect(rpgEvents('rpg.level.reached').map((e) => e.subject)).toEqual(['2']);
  });

  it('milestones are written once each, with ids and numbers only', async () => {
    const { module } = setup();
    module.saveRule(commitRule);
    module.saveAchievement({ id: 'first', name: 'First', description: 'd', condition: { kind: 'xp', target: 1 } });
    module.createQuest({ id: 'daily', title: 'Commit today', condition: { kind: 'count', ruleIds: ['commits'], target: 1 }, window: { kind: 'daily' } });
    later(1000);
    commit();
    await module.refresh();
    commit();
    await module.refresh();
    expect(rpgEvents('rpg.achievement.unlocked').map((e) => e.subject)).toEqual(['first']);
    expect(rpgEvents('rpg.quest.completed').map((e) => e.subject)).toEqual(['daily']);
    expect(rpgEvents('rpg.level.reached').map((e) => e.subject)).toEqual(['2']);
    expect(rpgEvents('rpg.run.completed')).toHaveLength(2);
    const text = JSON.stringify(rpgEvents());
    expect(text).not.toContain('Commit today');
    expect(text).not.toContain('Commit observed');
  });

  it('milestone events and the run commit together: an event failure rolls the run back', async () => {
    const { module } = setup();
    module.saveRule(commitRule);
    later(1000);
    commit();
    const append = w.log.append.bind(w.log);
    w.log.append = (input) => {
      if (input.type === 'rpg.run.completed') throw new Error('event log full');
      return append(input);
    };
    await expect(module.refresh()).rejects.toThrow(/event log full/);
    w.log.append = append;
    expect(w.store.allAwards()).toEqual([]);
    expect(rpgEvents()).toEqual([]);
    expect(module.status().lastError).toBe('event log full');
    await module.refresh();
    expect(w.store.allAwards()).toHaveLength(1);
  });

  it('every user action writes to the event log', async () => {
    const { module } = setup();
    module.enable();
    module.saveRule(commitRule);
    module.setRuleEnabled('commits', false);
    module.saveAchievement({ id: 'first', name: 'First', description: 'd', condition: { kind: 'xp', target: 1 } });
    const quest = module.createQuest({ title: 'Ship it', condition: { kind: 'xp', target: 100 } });
    module.abandonQuest(quest.ok ? quest.value.id : '');
    module.deleteAchievement('first');
    module.setRuleEnabled('commits', true);
    await module.backfill('commits');
    module.deleteRule('commits');
    module.disable();
    expect(auditLines()).toEqual([
      'Reality RPG turned on',
      'Reality RPG rule created: Commit observed',
      'Reality RPG rule switched off: Commit observed',
      'Reality RPG achievement saved: First',
      'Reality RPG quest created: Ship it',
      'Reality RPG quest abandoned: Ship it',
      'Reality RPG achievement deleted (an unlock already earned is kept)',
      'Reality RPG rule switched on: Commit observed',
      'Reality RPG rule applied to past activity: Commit observed',
      'Reality RPG rule deleted (its XP is kept)',
      'Reality RPG turned off',
    ]);
  });

  it("the game's own audit lines never earn XP, even for a rule on every action", async () => {
    const { module } = setup();
    // Naming the game's own audit type is refused outright...
    expect(module.saveRule({ id: 'self', name: 'Self', enabled: true, match: { types: ['reality_rpg'] }, award: { xp: 1, stat: 'All' } }).ok).toBe(false);
    // ...and a rule on every action still never matches the game's own actions.
    expect(module.saveRule({ id: 'any', name: 'Any action', enabled: true, match: { types: ['action_executed'] }, award: { xp: 1, stat: 'All' } }).ok).toBe(true);
    later(1000);
    module.enable();
    // What main.ts's logActionEvent writes when the user runs the game's actions.
    w.legacy({ module: 'reality_rpg', actionId: 'reality_rpg.enable' });
    w.legacy({ module: 'reality_rpg', actionId: 'reality_rpg.rule.save' });
    w.legacy({ module: 'command', actionId: 'reality_rpg.refresh' });
    w.legacy({ module: 'clipboard', actionId: 'clipboard.copy' });
    await module.refresh();
    expect(w.store.allAwards().map((a) => a.actionId)).toEqual(['clipboard.copy']);
  });

  it('a rule earns only from when it was created or switched on; backfill reaches the past once', async () => {
    const { module } = setup();
    commit(); // before any rule
    later(1000);
    module.saveRule(commitRule);
    later(1000);
    commit();
    await module.refresh();
    expect(w.store.allAwards()).toHaveLength(1);

    module.setRuleEnabled('commits', false);
    later(1000);
    commit(); // while switched off
    later(1000);
    module.setRuleEnabled('commits', true);
    await module.refresh();
    expect(w.store.allAwards()).toHaveLength(1);

    // Editing a rule that is on keeps its start; the input cannot move it.
    const start = w.store.getRule('commits')!.effectiveFrom;
    later(1000);
    module.saveRule({ ...commitRule, award: { xp: 70, stat: 'Craft' }, effectiveFrom: '1970-01-01T00:00:00.000Z' });
    expect(w.store.getRule('commits')!.effectiveFrom).toBe(start);

    const back = await module.backfill('commits');
    expect(back.ok).toBe(true);
    expect(w.store.allAwards()).toHaveLength(3);
    const again = await module.backfill('commits');
    expect(again.ok && again.value.status === 'completed' && again.value.committed.inserted).toEqual([]);
  });

  it('actions refuse bad input without writing anything', async () => {
    const { module } = setup();
    expect(module.saveRule({ ...commitRule, match: { types: ['journal.entry_saved'] } })).toEqual({ ok: false, errors: ['rules may not name vault, finance or journal activity'] });
    expect(module.saveRule('nope').ok).toBe(false);
    expect(module.setRuleEnabled('missing', true)).toEqual({ ok: false, errors: ['no such rule'] });
    expect(module.setRuleEnabled('../x', true).ok).toBe(false);
    expect(module.createQuest({ title: '', condition: { kind: 'xp', target: 1 } }).ok).toBe(false);
    expect(module.abandonQuest('missing').ok).toBe(false);
    expect((await module.backfill('missing')).ok).toBe(false);
    module.saveRule({ ...commitRule, enabled: false });
    expect(await module.backfill('commits')).toEqual({ ok: false, errors: ['switch the rule on before applying it to past activity'] });
    expect(w.store.listRules().rules.map((r) => r.id)).toEqual(['commits']);
    expect(auditLines()).toEqual(['Reality RPG rule created: Commit observed']);
  });

  it('a slot landing after it was turned off does nothing', async () => {
    const scheduler = capturing();
    const { module } = setup(scheduler);
    module.enable();
    const job = scheduler.jobs.get(RPG_PROCESS_JOB)!;
    module.disable();
    await job.run({ occurrenceId: 'late', scheduledAt: 'x', trigger: 'scheduled' });
    expect(w.store.listRuns()).toEqual([]);
  });

  it('start closes out a run a crash left running', () => {
    const { module } = setup();
    w.store.beginRun({ id: 'crashed', occurrenceId: 'o', trigger: 'scheduled', startedAt: 'x' });
    module.start();
    expect(w.store.getRun('crashed')!.status).toBe('failed');
    expect(auditLines()).toEqual(['Reality RPG closed 1 interrupted run(s)']);
  });

  it('the snapshot has the sheet, progress, history with rule names, and the starter pack', async () => {
    const { module } = setup();
    module.saveRule(commitRule);
    module.saveAchievement({ id: 'three', name: 'Three', description: 'd', condition: { kind: 'count', ruleIds: ['commits'], target: 3 } });
    later(1000);
    commit();
    await module.refresh();
    const snap = module.snapshot();
    expect(snap.sheet).toMatchObject({ totalXp: 60, level: 1, stats: [{ stat: 'Craft', xp: 60 }] });
    expect(snap.achievements[0]).toMatchObject({ unlocked: null, progress: { current: 1, target: 3, met: false } });
    expect(snap.recentAwards[0]).toMatchObject({ ruleName: 'Commit observed', xp: 60 });
    expect(snap.starter.rules.length).toBeGreaterThan(0);
    expect(snap.starter.rules.every((r) => !r.enabled)).toBe(true);
    // The built-in set comes with what each rule means and which group it is in.
    expect(snap.starter.info['commit-observed']).toMatchObject({ group: 'projects', groupLabel: 'Your projects', recommended: true });
    expect(snap.starter.info['commit-observed']!.when).toMatch(/^you make a commit/);
    expect(snap.starter.quests.find((q) => q.id === 'commit-5-days')).toMatchObject({ title: 'Commit on 5 days this week', needs: 'commit-observed', window: { kind: 'weekly' } });
    module.deleteRule('commits');
    expect(module.snapshot().recentAwards[0]!.ruleName).toBeNull();
  });
});

describe('turning on with a selection', () => {
  let w: World;
  afterEach(() => w?.dispose());

  function setup() {
    w = createWorld();
    let stored: RealityRpgSettings = defaultRealityRpgSettings();
    return createRealityRpgModule({
      database: w.handle.db,
      events: w.log,
      scheduler: capturing(),
      settings: { read: () => stored, write: (s) => (stored = s) },
      timeZone: 'UTC',
      now: () => w.clock.now,
    });
  }
  const later = (ms: number) => { w.clock.now = new Date(w.clock.now.getTime() + ms); };
  const commit = (payload: unknown = {}) => w.moduleEvent({ type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', payload });

  it('one step: the picked rules are on, their quests and achievements exist, and the game is on', () => {
    const module = setup();
    const started = module.enableWith({ ruleIds: ['commit-observed', 'backup-completed'], questIds: ['commit-5-days', 'push-3-week'] });
    expect(started.ok && started.value).toMatchObject({ rules: 2, quests: 1 });
    const snap = module.snapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.rules.map((r) => [r.id, r.enabled]).sort()).toEqual([['backup-completed', true], ['commit-observed', true]]);
    // A quest whose rule was not picked is not created: nothing could ever count toward it.
    expect(snap.quests.map((q) => q.quest.id)).toEqual(['commit-5-days']);
    const achievements = snap.achievements.map((a) => a.achievement.id);
    expect(achievements).toEqual(expect.arrayContaining(['first-steps', 'level-5', 'commits-10', 'commits-1000', 'backups-5']));
    expect(achievements, 'no achievement for a rule that is off').not.toContain('pushes-10');
    expect(achievements).not.toContain('blocks-10');
  });

  it('nothing from before the game was turned on earns, and history never does (item 43)', async () => {
    const module = setup();
    commit(); // made before turning on
    later(60_000);
    expect(module.enableWith({ ruleIds: ['commit-observed'], questIds: [] }).ok).toBe(true);
    later(60_000);
    // A repository's old commits, read by the scan after the rule exists: marked as history.
    for (let i = 0; i < 40; i += 1) commit({ baseline: true });
    await module.refresh();
    expect(module.snapshot().sheet.totalXp, 'old commits earn nothing').toBe(0);
    commit(); // a commit made now
    await module.refresh();
    const snap = module.snapshot();
    expect(snap.sheet.totalXp).toBe(5);
    expect(snap.achievements.find((a) => a.achievement.id === 'first-steps')?.unlocked).not.toBeNull();
  });

  it('is safe to do twice, keeps what the owner already had, and refuses nonsense', () => {
    const module = setup();
    module.saveRule({ id: 'commit-observed', name: 'My commit rule', enabled: false, match: { types: ['dev.commit.observed'] }, award: { xp: 50, stat: 'Craft' } });
    const first = module.enableWith({ ruleIds: ['commit-observed', 'block-done'], questIds: ['blocks-3-day'] });
    expect(first.ok && first.value).toMatchObject({ rules: 2, quests: 1 });
    const mine = module.snapshot().rules.find((r) => r.id === 'commit-observed');
    expect(mine, 'their rule is switched on, not replaced').toMatchObject({ name: 'My commit rule', enabled: true, award: { xp: 50 } });
    const again = module.enableWith({ ruleIds: ['commit-observed', 'block-done'], questIds: ['blocks-3-day'] });
    expect(again.ok && again.value).toMatchObject({ rules: 0, quests: 0, achievements: 0 });
    expect(module.enableWith('everything').ok).toBe(false);
    expect(module.enableWith({ ruleIds: ['no-such-rule'], questIds: 7 })).toMatchObject({ ok: true, value: { rules: 0, quests: 0 } });
  });
});

describe('registered actions', () => {
  const ours = seededActions.filter((a) => a.moduleId === 'reality_rpg');

  it('match the manifest exactly', () => {
    expect(ours.map((a) => a.id).sort()).toEqual([...REALITY_RPG_MANIFEST.actionIds].sort());
  });

  it('are safe, never phone-exposed, off the Deck except for opening the screen, and the view opens through desktop.view.rpg', () => {
    // The owner allowed the open action on the Stream Deck on 5 October 2026: it shows the screen and sends nothing back.
    for (const a of ours) {
      expect(a.dangerLevel).toBe('safe');
      expect(a.phone).toBeUndefined();
      expect(a.allowedTriggers.includes('deck'), a.id).toBe(a.id === RPG_ACTION_IDS.open);
    }
    expect(ours.find((a) => a.id === RPG_ACTION_IDS.open)!.handlerRef).toBe('desktop.view.rpg');
  });
});
