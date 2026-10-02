/**
 * Phase 10: retention. GhostOS keeps its newest 500 runs and 180 days of its
 * own `ghost` events, pruned after each scheduled sync inside the sync job.
 * Nothing outside the ghost stream is touched, and the owner's entities,
 * relations and observations are never pruned.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEventLog, runFoundationMigrations, type EventLog, type ScheduledJob } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { createGhostOsModule, eventCutoff, RETENTION, type GhostOsModule } from '../index.ts';

const NOW = '2026-06-30T12:00:00.000Z';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY).toISOString();

interface Harness {
  handle: TestDatabase;
  log: EventLog;
  module: GhostOsModule;
  scheduled: ScheduledJob[];
  fire(occurrenceId: string): Promise<void>;
}

const open: TestDatabase[] = [];
afterEach(() => {
  for (const t of open.splice(0)) t.dispose();
});

let n = 0;

function harness(): Harness {
  const handle = createTestDatabase('ghost-retention-');
  open.push(handle);
  runFoundationMigrations(handle.db);
  const log = createEventLog(handle.db);
  const scheduled: ScheduledJob[] = [];
  const live = new Map<string, ScheduledJob>();
  const module = createGhostOsModule({
    database: handle.db,
    events: log,
    scheduler: {
      schedule(job) {
        scheduled.push(job);
        live.set(job.id, job);
        return () => live.delete(job.id);
      },
      async runNow() {},
    },
    isSensitive: () => false,
    developerIntelligence: { listRepositories: async () => [], listTechnologies: async () => [] },
    timeZone: 'UTC',
    now: () => new Date(NOW),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  return {
    handle,
    log,
    module,
    scheduled,
    async fire(occurrenceId) {
      const job = live.get('sync');
      if (!job) throw new Error('sync is not scheduled');
      await job.run({ occurrenceId, scheduledAt: NOW, trigger: 'scheduled' });
    },
  };
}

function seedRuns(h: Harness, count: number) {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse(NOW) - (count - i) * 3_600_000).toISOString();
    h.module.store.claimRun({ id: `run-old-${String(i).padStart(4, '0')}`, occurrenceId: `old:${i}`, kind: 'sync', trigger: 'scheduled', now: at });
    h.module.store.finishRun(`run-old-${String(i).padStart(4, '0')}`, 'completed', at, {});
  }
}

const count = (h: Harness, sql: string) => Number(h.handle.db.prepare(sql).get<{ n: number }>()?.n);

describe('retention', () => {
  it('keeps the newest 500 runs, never one still running', async () => {
    const h = harness();
    seedRuns(h, 700);
    h.module.start();
    // A run in progress (claimed after start, so not an interrupted one), and old: still never pruned.
    h.module.store.claimRun({ id: 'run-stuck', occurrenceId: 'stuck', kind: 'sync', trigger: 'scheduled', now: daysAgo(400) });
    expect(h.module.enableAdapter('developer_intelligence').ok).toBe(true);
    await h.fire('sync:now');
    expect(count(h, 'SELECT count(*) AS n FROM ghost_runs')).toBe(RETENTION.maxRuns + 1);
    // The newest are kept: this sync's run and the most recent old ones.
    expect(h.module.store.getRunByOccurrence('sync:now:developer_intelligence')).toBeDefined();
    expect(h.module.store.getRunByOccurrence('old:699')).toBeDefined();
    expect(h.module.store.getRunByOccurrence('old:0')).toBeUndefined();
    expect(h.module.store.getRunByOccurrence('stuck')?.status).toBe('running');
  });

  it('prunes ghost events older than 180 days, and nothing else in the event log', async () => {
    const h = harness();
    const append = (stream: string, module: string, type: string, at: string) =>
      h.log.append({ type, stream, module, source: module, occurredAt: at, recordedAt: at, payload: {} });
    append('ghost', 'ghost_os', 'ghost.entity.saved', daysAgo(400));
    append('ghost', 'ghost_os', 'ghost.forgotten', daysAgo(181));
    append('ghost', 'ghost_os', 'ghost.entity.saved', daysAgo(179));
    append('ghost', 'ghost_os', 'ghost.entity.saved', eventCutoff(NOW)); // exactly at the edge: kept
    // Neighbours that must survive: other streams, GhostOS's own audit lines, another module on the ghost stream.
    append('audit', 'ghost_os', 'action_executed', daysAgo(400));
    append('dev', 'developer_intelligence', 'dev.commit.observed', daysAgo(400));
    append('vault', 'vault', 'vault.item.saved', daysAgo(400));
    append('ghost', 'someone_else', 'ghost.entity.saved', daysAgo(400));
    const before = count(h, 'SELECT count(*) AS n FROM event_log');

    h.module.start();
    expect(h.module.enableAdapter('developer_intelligence').ok).toBe(true);
    await h.fire('sync:now');

    expect(count(h, "SELECT count(*) AS n FROM event_log WHERE stream = 'ghost' AND module = 'ghost_os'")).toBe(2);
    expect(count(h, 'SELECT count(*) AS n FROM event_log')).toBe(before - 2);
    for (const [stream, module] of [['audit', 'ghost_os'], ['dev', 'developer_intelligence'], ['vault', 'vault'], ['ghost', 'someone_else']]) {
      expect(count(h, `SELECT count(*) AS n FROM event_log WHERE stream = '${stream}' AND module = '${module}'`), `${stream}/${module}`).toBeGreaterThan(0);
    }
  });

  it('never prunes the owner\'s entities, relations or observations, however old', async () => {
    const h = harness();
    const old = (type: string, title: string) => ({ type, title, details: type === 'memory' ? { text: 't', occurredAt: daysAgo(3000) } : undefined, startedAt: type === 'memory' ? undefined : daysAgo(3000) });
    const a = h.module.saveEntity(old('memory', 'An old memory'));
    const b = h.module.saveEntity(old('person', 'An old friend'));
    if (!a.ok || !b.ok) throw new Error('setup');
    h.module.saveRelation({ fromId: a.value.id, toId: b.value.id, type: 'involves', validFrom: daysAgo(3000), validTo: daysAgo(2900) });
    h.module.addObservation({ entityId: b.value.id, statement: 'met at school', observedAt: daysAgo(3000) });
    // Make the rows themselves look ancient too.
    h.handle.db.exec(`UPDATE ghost_entities SET created_at = '${daysAgo(3000)}', updated_at = '${daysAgo(3000)}'`);
    h.handle.db.exec(`UPDATE ghost_observations SET created_at = '${daysAgo(3000)}'`);
    const data = JSON.stringify(h.module.store.exportAll(NOW));

    h.module.start();
    expect(h.module.enableAdapter('developer_intelligence').ok).toBe(true);
    await h.fire('sync:now');

    expect(JSON.stringify(h.module.store.exportAll(NOW))).toBe(data);
    expect(h.module.status().counts).toEqual({ entity: 2, relation: 1, observation: 1 });
  });

  it('runs only inside the sync job: no job of its own, nothing pruned by a manual sync', async () => {
    const h = harness();
    h.log.append({ type: 'ghost.entity.saved', stream: 'ghost', module: 'ghost_os', source: 'ghost_os', occurredAt: daysAgo(400), payload: {} });
    seedRuns(h, 520);
    h.module.start();
    expect(h.module.enableAdapter('developer_intelligence').ok).toBe(true);
    await h.module.syncNow();
    expect(count(h, "SELECT count(*) AS n FROM event_log WHERE stream = 'ghost'")).toBeGreaterThan(0);
    expect(count(h, 'SELECT count(*) AS n FROM ghost_runs')).toBe(521);
    // Every job GhostOS ever scheduled is the sync.
    expect(h.scheduled.map((j) => j.id)).toEqual(['sync']);
    expect(h.scheduled[0]?.heavy).toBe(true);
  });

  it('is idempotent: a second pass removes nothing more', async () => {
    const h = harness();
    seedRuns(h, 600);
    h.module.start();
    expect(h.module.enableAdapter('developer_intelligence').ok).toBe(true);
    await h.fire('sync:a');
    const after = count(h, 'SELECT count(*) AS n FROM ghost_runs');
    await h.fire('sync:a'); // the same slot again: no new run, nothing more to prune
    expect(count(h, 'SELECT count(*) AS n FROM ghost_runs')).toBe(after);
    expect(after).toBe(RETENTION.maxRuns);
  });
});
