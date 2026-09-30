import { afterEach, describe, expect, it } from 'vitest';
import { createEventLog, runFoundationMigrations, type EventLog, type JobOccurrence, type ScheduledJob } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { seededActions } from '@dexnest/action-registry';
import {
  AUDIT_SUMMARIES,
  GHOST_ACTION_IDS,
  GHOST_EVENT_TYPES,
  GHOST_OS_MANIFEST,
  createGhostOsModule,
  type DiRepository,
  type DiTechnology,
  type Entity,
  type GhostOsModule,
  type GhostOsModuleOptions,
} from '../index.ts';
import { daysBefore } from './world.ts';

const MARK = 'OWNER-TEXT-91c2';

interface Harness {
  handle: TestDatabase;
  log: EventLog;
  module: GhostOsModule;
  jobs: Map<string, ScheduledJob>;
  audits: { actionId: string; summary: string; metadata: Record<string, unknown>; status: string }[];
  repos: DiRepository[];
  techs: DiTechnology[];
  clock: { now: string };
  fire(occurrenceId: string, trigger?: JobOccurrence['trigger']): Promise<void>;
  eventTypes(): string[];
  eventLogText(): string;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) {
    h.module.stop();
    h.handle.dispose();
  }
});

let n = 0;

function harness(over: Partial<GhostOsModuleOptions> = {}): Harness {
  const handle = createTestDatabase('ghost-module-');
  runFoundationMigrations(handle.db);
  const log = createEventLog(handle.db);
  const jobs = new Map<string, ScheduledJob>();
  const audits: Harness['audits'] = [];
  const repos: DiRepository[] = [];
  const techs: DiTechnology[] = [];
  const clock = { now: '2026-06-30T12:00:00.000Z' };
  const module = createGhostOsModule({
    database: handle.db,
    events: log,
    scheduler: {
      schedule(job) {
        jobs.set(job.id, job);
        return () => jobs.delete(job.id);
      },
      async runNow() {},
    },
    isSensitive: (p) => p.startsWith('/dexnest-data'),
    developerIntelligence: {
      async listRepositories() {
        return repos;
      },
      async listTechnologies(repositoryId) {
        return techs.filter((t) => t.repositoryId === repositoryId);
      },
    },
    // As the host does it: an audit line is an event in the shared log.
    audit(actionId, summary, metadata, status) {
      audits.push({ actionId, summary, metadata, status });
      log.append({ type: 'action_executed', stream: 'audit', module: 'ghost_os', source: 'module_ui', payload: { actionId, summary, status, metadata } });
    },
    timeZone: 'UTC',
    now: () => new Date(clock.now),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    ...over,
  });
  const h: Harness = {
    handle,
    log,
    module,
    jobs,
    audits,
    repos,
    techs,
    clock,
    async fire(occurrenceId, trigger = 'scheduled') {
      const job = jobs.get('sync');
      if (!job) throw new Error('sync is not scheduled');
      await job.run({ occurrenceId, scheduledAt: clock.now, trigger });
    },
    eventTypes: () => log.query({ stream: 'ghost' }).map((e) => e.type),
    eventLogText: () => JSON.stringify(handle.db.prepare('SELECT * FROM event_log').all()),
  };
  harnesses.push(h);
  return h;
}

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
}

function seedDi(h: Harness) {
  h.repos.push({ id: 'repo-app', roots: [{ path: '/home/dev/app' }], displayName: 'app', discoveredAt: '2026-01-01T00:00:00.000Z' });
  h.techs.push({ id: 'tf-1', repositoryId: 'repo-app', category: 'language', name: 'TypeScript', evidencePath: 'package.json', evidenceKind: 'package.json', status: 'observed', firstObservedAt: '2026-01-02T00:00:00.000Z' });
  for (let i = 0; i < 10; i++) {
    h.log.append({
      type: 'dev.commit.observed',
      stream: 'dev',
      module: 'developer_intelligence',
      subject: 'repo-app',
      source: 'developer_intelligence',
      idempotencyKey: `c${i}`,
      payload: { sha: `abcdef${i}`, subject: `${MARK} commit`, authorDate: daysBefore(h.clock.now, i, '20:00') },
    });
  }
}

describe('registration', () => {
  it('the manifest names exactly the registered ghost_os actions, and each handler is its own id or the view', () => {
    const registered = seededActions.filter((a) => a.moduleId === 'ghost_os');
    expect(registered.map((a) => a.id).sort()).toEqual(Object.values(GHOST_ACTION_IDS).sort());
    expect(GHOST_OS_MANIFEST.actionIds).toEqual(Object.values(GHOST_ACTION_IDS));
    for (const a of registered) expect(a.handlerRef).toBe(a.id === GHOST_ACTION_IDS.open ? 'desktop.view.ghost' : a.id);
  });

  it('only forget and turning a source off are caution, with a confirmation; nothing is phone- or Deck-exposed', () => {
    const registered = seededActions.filter((a) => a.moduleId === 'ghost_os');
    const caution = registered.filter((a) => a.dangerLevel !== 'safe');
    expect(caution.map((a) => a.id).sort()).toEqual([GHOST_ACTION_IDS.adapterDisable, GHOST_ACTION_IDS.forget].sort());
    for (const a of caution) expect(a.requiresConfirmation && a.confirmationRule).toBeTruthy();
    for (const a of registered) expect(a.allowedTriggers).not.toContain('deck');
  });

  it('every action that writes has a fixed audit summary', () => {
    const writers = Object.values(GHOST_ACTION_IDS).filter((id) => id !== GHOST_ACTION_IDS.open);
    expect(Object.keys(AUDIT_SUMMARIES).sort()).toEqual(writers.sort());
  });
});

describe('scheduling', () => {
  it('is off by default: starting schedules nothing', () => {
    const h = harness();
    h.module.start();
    expect([...h.jobs.keys()]).toEqual([]);
  });

  it('turning a source on schedules one heavy sync that does not run at startup; off removes it', () => {
    const h = harness();
    h.module.start();
    ok(h.module.enableAdapter('developer_intelligence'));
    const job = h.jobs.get('sync');
    expect(job).toMatchObject({ id: 'sync', heavy: true, runAtStartup: false, intervalMs: 60 * 60_000 });
    ok(h.module.updateSettings({ syncIntervalMinutes: 120 }));
    expect(h.jobs.get('sync')?.intervalMs).toBe(120 * 60_000);
    ok(h.module.disableAdapter('developer_intelligence'));
    expect(h.jobs.size).toBe(0);
  });

  it('a slot fired twice gives one result', async () => {
    const h = harness();
    seedDi(h);
    h.module.start();
    ok(h.module.enableAdapter('developer_intelligence'));
    await h.fire('sync:2026-06-30T12:00');
    const after = { counts: h.module.status().counts, events: h.eventTypes() };
    await h.fire('sync:2026-06-30T12:00');
    expect({ counts: h.module.status().counts, events: h.eventTypes() }).toEqual(after);
    expect(h.eventTypes().filter((t) => t === 'ghost.adapter.synced')).toHaveLength(1);
    expect(h.eventTypes().filter((t) => t === 'ghost.habit.detected')).toHaveLength(1); // ten evenings: time of day, not yet a weekly rhythm
    expect(h.module.store.listRuns(10).length).toBe(1);
  });

  it('a habit is announced once per detection period', async () => {
    const h = harness();
    seedDi(h);
    h.module.start();
    ok(h.module.enableAdapter('developer_intelligence'));
    await h.fire('sync:a');
    await h.fire('sync:b');
    expect(h.eventTypes().filter((t) => t === 'ghost.habit.detected')).toHaveLength(1); // ten evenings: time of day, not yet a weekly rhythm
    // Nothing changed on the second sync: no synced event for it.
    expect(h.eventTypes().filter((t) => t === 'ghost.adapter.synced')).toHaveLength(1);
  });

  it('closes runs a crash left open', () => {
    const h = harness();
    h.module.store.claimRun({ id: 'run-x', occurrenceId: 'sync:crash', kind: 'sync', trigger: 'scheduled', now: h.clock.now });
    h.module.start();
    expect(h.module.store.getRunByOccurrence('sync:crash')).toMatchObject({ status: 'failed', error: 'interrupted' });
  });
});

describe('every action writes the log', () => {
  it('each user action records its ghost event and one audit line', async () => {
    const h = harness();
    seedDi(h);
    h.module.start();
    const me = ok(h.module.saveEntity({ type: 'person', title: 'Me' }));
    const decision = ok(h.module.saveEntity({ type: 'decision', title: 'Move', details: { decidedAt: '2026-06-01T00:00:00Z', choice: 'go' } }));
    const rel = ok(h.module.saveRelation({ fromId: me.id, toId: decision.id, type: 'about' }));
    const obs = ok(h.module.addObservation({ entityId: me.id, statement: 'ran 5k' }));
    ok(h.module.recordDecisionOutcome({ id: decision.id, outcome: 'good' }));
    ok(h.module.enableAdapter('developer_intelligence'));
    await h.module.syncNow();
    const exported = h.module.exportData();
    ok(h.module.forget({ kind: 'observation', id: obs.id }));
    ok(h.module.forget({ kind: 'relation', id: rel.id }));
    ok(h.module.disableAdapter('developer_intelligence'));
    const target = harness();
    ok(target.module.importData(JSON.parse(JSON.stringify(exported))));

    expect(h.eventTypes()).toEqual([
      'ghost.entity.saved',
      'ghost.entity.saved',
      'ghost.relation.saved',
      'ghost.observation.recorded',
      'ghost.entity.saved',
      'ghost.adapter.synced',
      'ghost.habit.detected',
      'ghost.export.created',
      'ghost.forgotten',
      'ghost.forgotten',
      'ghost.adapter.withdrawn',
    ]);
    expect(target.eventTypes()).toEqual(['ghost.import.completed']);
    expect(h.audits.map((a) => a.actionId)).toEqual([
      'ghost_os.entity.save',
      'ghost_os.entity.save',
      'ghost_os.relation.save',
      'ghost_os.observation.add',
      'ghost_os.decision.record_outcome',
      'ghost_os.adapter.enable',
      'ghost_os.adapter.sync',
      'ghost_os.export',
      'ghost_os.forget',
      'ghost_os.forget',
      'ghost_os.adapter.disable',
    ]);
    expect(target.audits.map((a) => a.actionId)).toEqual(['ghost_os.import']);
    for (const a of [...h.audits, ...target.audits]) expect(a.summary).toBe(AUDIT_SUMMARIES[a.actionId as keyof typeof AUDIT_SUMMARIES]);
    expect(new Set(h.eventTypes()).size).toBeLessThanOrEqual(GHOST_EVENT_TYPES.length);
  });

  it('a refused action writes no ghost event', () => {
    const h = harness();
    expect(h.module.saveEntity({ type: 'person', title: '' }).ok).toBe(false);
    expect(h.module.saveRelation({ fromId: 'ent_00000001', toId: 'ent_00000002', type: 'uses' }).ok).toBe(false);
    expect(h.module.forget({ kind: 'entity', id: 'ent_missing1' }).ok).toBe(false);
    expect(h.module.enableAdapter('vault').ok).toBe(false);
    expect(h.eventTypes()).toEqual([]);
  });
});

describe('the owner\'s text never reaches the event log', () => {
  it('a marker in every text field appears nowhere in event_log, audit included', async () => {
    const h = harness();
    seedDi(h);
    h.module.start();
    const m = (field: string) => `${MARK} ${field}`;
    const tags = [MARK.toLowerCase()];
    const saved: Entity[] = [];
    const details: Record<string, unknown> = {
      memory: { text: m('memory'), occurredAt: '2026-05-01T00:00:00Z' },
      event: { occurredAt: '2026-05-01T00:00:00Z' },
      decision: { decidedAt: '2026-05-01T00:00:00Z', choice: m('choice'), alternatives: [m('alt')], rationale: m('why') },
      habit: { cadence: 'daily' },
      file: { path: `/home/me/${MARK}.txt`, label: m('label') },
      conversation: { text: m('conversation'), participants: [m('participant')] },
    };
    for (const type of ['person', 'project', 'skill', 'knowledge', 'memory', 'event', 'habit', 'decision', 'file', 'conversation', 'place']) {
      saved.push(ok(h.module.saveEntity({ type, title: m('title'), notes: m('notes'), tags, details: details[type] })));
    }
    const [a, b] = saved as [Entity, Entity];
    ok(h.module.saveEntity({ id: a.id, type: a.type, title: m('edited title'), notes: m('edited notes'), tags }));
    const rel = ok(h.module.saveRelation({ fromId: a.id, toId: b.id, type: 'related_to', notes: m('relation notes') }));
    ok(h.module.addObservation({ entityId: a.id, statement: m('statement') }));
    const decision = saved.find((e) => e.type === 'decision') as Entity;
    ok(h.module.recordDecisionOutcome({ id: decision.id, outcome: m('outcome') }));
    ok(h.module.enableAdapter('developer_intelligence'));
    await h.module.syncNow();
    const exported = h.module.exportData();
    ok(h.module.forget({ kind: 'relation', id: rel.id }));
    ok(h.module.forget({ kind: 'entity', id: b.id }));
    ok(h.module.importData(JSON.parse(JSON.stringify(exported))));

    expect(h.eventTypes().length).toBeGreaterThan(15);
    expect(h.audits.length).toBeGreaterThan(15);
    const logged = h.eventLogText();
    expect(logged).toContain('ghost.entity.saved');
    // The marker is only in the DI commit subject the test planted, never in a ghost or audit row.
    const ghostAndAudit = JSON.stringify(h.handle.db.prepare("SELECT * FROM event_log WHERE stream IN ('ghost', 'audit')").all());
    expect(ghostAndAudit).not.toContain(MARK);
    expect(ghostAndAudit.toLowerCase()).not.toContain(MARK.toLowerCase());
  });
});

describe('refusals', () => {
  it('a file inside DexNest\'s data is refused, typed in or imported', () => {
    const h = harness();
    expect(h.module.saveEntity({ type: 'file', title: 'f', details: { path: '/dexnest-data/files/vault/x.txt' } })).toEqual({ ok: false, errors: ["that file is inside DexNest's data; GhostOS does not refer to it"] });
    const other = harness({ isSensitive: () => false });
    ok(other.module.saveEntity({ type: 'file', title: 'f', details: { path: '/dexnest-data/files/vault/x.txt' } }));
    const r = h.module.importData(JSON.parse(JSON.stringify(other.module.exportData())));
    expect(r.ok).toBe(false);
    expect(h.module.status().counts.entity).toBe(0);
  });

  it('what a source contributed cannot be edited, only forgotten', async () => {
    const h = harness();
    seedDi(h);
    h.module.start();
    ok(h.module.enableAdapter('developer_intelligence'));
    await h.module.syncNow();
    const project = h.module.store.listEntities({ type: 'project' })[0] as Entity;
    const r = h.module.saveEntity({ id: project.id, type: 'project', title: 'renamed' });
    expect(r.ok).toBe(false);
    expect(h.module.store.getEntity(project.id)?.title).toBe('app');
  });

  it('an entry keeps its type, and a pasted conversation keeps when it was pasted', () => {
    const h = harness();
    const c = ok(h.module.saveEntity({ type: 'conversation', title: 'c', details: { text: 'hi' } }));
    expect(h.module.saveEntity({ id: c.id, type: 'person', title: 'c' }).ok).toBe(false);
    h.clock.now = '2026-07-05T00:00:00.000Z';
    const edited = ok(h.module.saveEntity({ id: c.id, type: 'conversation', title: 'c2', details: { text: 'hi there' } }));
    expect(edited.details).toMatchObject({ importedAt: '2026-06-30T12:00:00.000Z' });
    expect(edited.createdAt).toBe('2026-06-30T12:00:00.000Z');
  });
});

describe('decisions', () => {
  it('editing a decision keeps the outcome recorded for it', () => {
    const h = harness();
    const d = ok(h.module.saveEntity({ type: 'decision', title: 'Move', details: { decidedAt: '2026-06-01T00:00:00Z', choice: 'go' } }));
    ok(h.module.recordDecisionOutcome({ id: d.id, outcome: 'went well' }));
    const edited = ok(h.module.saveEntity({ id: d.id, type: 'decision', title: 'Move city', details: { decidedAt: '2026-06-01T00:00:00Z', choice: 'go', rationale: 'closer' } }));
    expect(edited.title).toBe('Move city');
    expect(edited.details).toMatchObject({ rationale: 'closer', outcome: 'went well', outcomeAt: '2026-06-30T12:00:00.000Z' });
  });
});

describe('reading', () => {
  it('search, timeline and entity detail', () => {
    const h = harness();
    const a = ok(h.module.saveEntity({ type: 'project', title: 'Zephyr' }));
    const b = ok(h.module.saveEntity({ type: 'skill', title: 'Rust' }));
    ok(h.module.saveRelation({ fromId: a.id, toId: b.id, type: 'uses' }));
    ok(h.module.addObservation({ entityId: a.id, statement: 'launched' }));
    expect(ok(h.module.search('zeph')).map((x) => x.id)).toEqual([a.id]);
    expect(ok(h.module.search('   '))).toEqual([]);
    expect(h.module.search('x', ['robot']).ok).toBe(false);
    expect(ok(h.module.timeline({ types: ['project'] })).map((i) => i.kind).sort()).toEqual(['entity', 'observation']);
    const d = ok(h.module.entityDetail(a.id));
    expect(d.relations).toEqual([expect.objectContaining({ direction: 'out', other: { id: b.id, type: 'skill', title: 'Rust' } })]);
    expect(d.observations.map((o) => o.statement)).toEqual(['launched']);
    expect(h.module.entityDetail('nope').ok).toBe(false);
  });
});
