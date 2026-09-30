import { describe, it, expect, afterEach } from 'vitest';
import { AUDIT_STREAM, createHostScheduler, type JobOccurrence, type ModuleScheduler, type ScheduledJob, type SchedulerTimers } from '@dexnest/foundation';
import { seededActions } from '@dexnest/action-registry';
import { createSkillConstellationModule, type SkillConstellationModule } from '../module/runtime.ts';
import { defaultSkillConstellationSettings, type SkillConstellationSettings } from '../domain/settings.ts';
import { SKILL_ACTION_IDS, SKILL_CONSTELLATION_MANIFEST, SKILL_REBUILD_JOB } from '../manifest.ts';
import { createWorld, type World } from './di-fixtures.ts';

/** Captures scheduled jobs so a test can fire a slot by hand, twice if it likes. */
function capturingScheduler(): ModuleScheduler & { jobs: Map<string, ScheduledJob> } {
  const jobs = new Map<string, ScheduledJob>();
  return {
    jobs,
    schedule(job) {
      jobs.set(job.id, job);
      return () => jobs.delete(job.id);
    },
    async runNow(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`No job ${jobId}`);
      await job.run({ occurrenceId: `${jobId}:manual:x`, scheduledAt: 'x', trigger: 'manual' });
    },
  };
}

function heldTimers(): SchedulerTimers & { count(): number } {
  let next = 0;
  const live = new Set<number>();
  return {
    set: () => {
      const id = ++next;
      live.add(id);
      return id;
    },
    clear: (id) => {
      live.delete(id as number);
    },
    count: () => live.size,
  };
}

describe('Skill Constellation module', () => {
  let world: World | undefined;
  afterEach(() => {
    world?.dispose();
    world = undefined;
  });

  async function setup(scheduler: ModuleScheduler = capturingScheduler()) {
    const w = (world = await createWorld());
    await w.repo('r-app', 'app');
    await w.tech('r-app', { category: 'language', name: 'TypeScript', evidencePath: 'src/a.ts', evidenceKind: 'file-extension' });
    await w.tech('r-app', { name: 'react' });
    await w.commit('r-app', 'aaa', '2026-05-01T00:00:00.000Z');
    let stored: SkillConstellationSettings = defaultSkillConstellationSettings();
    const module = createSkillConstellationModule({
      database: w.di.database,
      events: w.di.eventLog,
      boundary: w.boundary,
      scheduler,
      settings: { read: () => stored, write: (s) => (stored = s) },
      reader: w.di,
      now: () => w.clock.now,
      // The host's audit callback appends to the audit stream; do the same here.
      audit: (summary, metadata, status) => {
        w.di.eventLog.append({ type: 'skill_constellation.audit', stream: AUDIT_STREAM, module: 'skill_constellation', source: 'test', payload: { summary, metadata, status } });
      },
    });
    return { w, module, scheduler };
  }

  const skillEvents = (w: World, type?: string) =>
    w.di.eventLog.query({ stream: 'skill', module: 'skill_constellation', ...(type ? { types: [type] } : {}), limit: 1000 });
  const auditLines = (w: World) =>
    w.di.eventLog.query({ stream: AUDIT_STREAM, module: 'skill_constellation', limit: 1000 }).map((e) => (e.payload as { summary: string }).summary);

  it('is off by default: nothing scheduled, no timer, nothing built', async () => {
    const timers = heldTimers();
    const { w, module } = await setup(createHostScheduler({ timers }));
    module.start();
    expect(timers.count()).toBe(0);
    expect(module.status().enabled).toBe(false);
    expect(w.store.listBuilds()).toEqual([]);
    expect(skillEvents(w)).toEqual([]);
    module.stop();
  });

  it('turning it on schedules one heavy job and no startup run; turning it off removes it', async () => {
    const scheduler = capturingScheduler();
    const { module } = await setup(scheduler);
    module.start();
    module.enable();
    const job = scheduler.jobs.get(SKILL_REBUILD_JOB)!;
    expect(job).toMatchObject({ heavy: true, runAtStartup: false, intervalMs: 60 * 60_000 });
    module.disable();
    expect(scheduler.jobs.size).toBe(0);
  });

  it('a scheduled slot fired twice builds once and records one built event', async () => {
    const scheduler = capturingScheduler();
    const { w, module } = await setup(scheduler);
    module.start();
    module.enable();
    const job = scheduler.jobs.get(SKILL_REBUILD_JOB)!;
    const slot: JobOccurrence = { occurrenceId: 'rebuild:2026-06-01T10:00:00.000Z', scheduledAt: '2026-06-01T10:00:00.000Z', trigger: 'scheduled' };
    await Promise.all([job.run(slot), job.run(slot)]);
    await job.run(slot);
    expect(w.store.listBuilds()).toHaveLength(1);
    expect(skillEvents(w, 'skill.constellation.built')).toHaveLength(1);
    expect(auditLines(w).filter((l) => l.startsWith('Skill Constellation rebuilt'))).toHaveLength(1);
  });

  it('a build writes built and discovered events in the skill stream, with no paths or text', async () => {
    const { w, module } = await setup();
    const outcome = await module.rebuildNow();
    expect(outcome.status).toBe('completed');
    const built = skillEvents(w, 'skill.constellation.built');
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ subject: outcome.build.id, payload: expect.objectContaining({ skills: 2, added: 2 }) });
    expect(skillEvents(w, 'skill.discovered').map((e) => e.subject).sort()).toEqual(['react', 'typescript']);
    const text = JSON.stringify(skillEvents(w));
    expect(text).not.toContain('src/a.ts');
    expect(text).not.toContain('package.json');
  });

  it('a skill is discovered once ever, and loss is recorded', async () => {
    const { w, module } = await setup();
    await module.rebuildNow();
    // react disappears (removed from DI), then returns.
    const react = (await w.di.technologies.listByRepository('r-app')).find((t) => t.name === 'react')!;
    await w.di.technologies.upsert({ ...react, category: 'project' });
    await module.rebuildNow({ force: true });
    expect(skillEvents(w, 'skill.evidence_lost').map((e) => e.subject)).toEqual(['react']);
    await w.di.technologies.upsert(react);
    await module.rebuildNow({ force: true });
    expect(skillEvents(w, 'skill.discovered').filter((e) => e.subject === 'react')).toHaveLength(1);
    expect(w.store.skillIds()).toContain('react');
  });

  it('events and the build commit together: an event failure rolls the build back', async () => {
    const { w, module } = await setup();
    await module.rebuildNow();
    const before = w.store.lastCompletedBuild()!.id;
    const realAppend = w.di.eventLog.append.bind(w.di.eventLog);
    w.di.eventLog.append = (input) => {
      if (input.type === 'skill.constellation.built') throw new Error('event log full');
      return realAppend(input);
    };
    await expect(module.rebuildNow({ force: true })).rejects.toThrow(/event log full/);
    w.di.eventLog.append = realAppend;
    expect(w.store.lastCompletedBuild()!.id).toBe(before);
    expect(skillEvents(w, 'skill.constellation.built')).toHaveLength(1);
    expect(module.status().lastError).toBe('event log full');
    expect(auditLines(w).some((l) => l.startsWith('Skill Constellation rebuild failed'))).toBe(true);
  });

  it('every user action writes to the event log', async () => {
    const { w, module } = await setup();
    module.start();
    module.enable();
    module.disable();
    await module.rebuildNow();
    expect(auditLines(w)).toEqual([
      'Skill Constellation turned on',
      'Skill Constellation turned off',
      expect.stringMatching(/^Skill Constellation rebuilt: 2 skill\(s\)/),
    ]);
  });

  it('a skipped rebuild writes no event', async () => {
    const { w, module } = await setup();
    await module.rebuildNow();
    const again = await module.rebuildNow();
    expect(again.status).toBe('skipped');
    expect(skillEvents(w, 'skill.constellation.built')).toHaveLength(1);
  });

  it('a slot landing after it was turned off does nothing', async () => {
    const scheduler = capturingScheduler();
    const { w, module } = await setup(scheduler);
    module.enable();
    const job = scheduler.jobs.get(SKILL_REBUILD_JOB)!;
    module.disable();
    await job.run({ occurrenceId: 'late', scheduledAt: 'x', trigger: 'scheduled' });
    expect(w.store.listBuilds()).toEqual([]);
  });

  it('the snapshot carries strength computed now, hidden flags, and the all-commits notice', async () => {
    const { module } = await setup();
    await module.rebuildNow();
    module.updateSettings({ ...module.getSettings(), hiddenSkills: ['react'] });
    const snap = module.constellation();
    expect(snap.skills.map((s) => [s.id, s.hidden])).toEqual([
      ['react', true],
      ['typescript', false],
    ]);
    expect(snap.skills.every((s) => s.strength.score > 0 && s.strength.score <= 1)).toBe(true);
    expect(snap.countsAllCommits).toBe(true);
    expect(snap.layout).toHaveLength(2);
  });

  it('start closes out a build a crash left running', async () => {
    const { w, module } = await setup();
    w.store.beginBuild({ id: 'crashed', occurrenceId: 'occ', trigger: 'scheduled', startedAt: '2026-06-01T00:00:00.000Z' });
    module.start();
    expect(w.store.getBuild('crashed')!.status).toBe('failed');
    expect(auditLines(w)).toEqual(['Skill Constellation closed 1 interrupted build(s)']);
  });
});

describe('registered actions', () => {
  const ours = seededActions.filter((a) => a.moduleId === 'skill_constellation');

  it('every manifest action is registered, and nothing else under this module', () => {
    expect(ours.map((a) => a.id).sort()).toEqual([...SKILL_CONSTELLATION_MANIFEST.actionIds].sort());
  });

  it('are safe, not phone- or Deck-exposed, and the view opens through desktop.view.skills', () => {
    for (const action of ours) {
      expect(action.dangerLevel).toBe('safe');
      expect(action.phone).toBeUndefined();
      expect(action.allowedTriggers).not.toContain('deck');
      expect(action.enabled).toBe(true);
    }
    expect(ours.find((a) => a.id === SKILL_ACTION_IDS.open)!.handlerRef).toBe('desktop.view.skills');
  });
});
