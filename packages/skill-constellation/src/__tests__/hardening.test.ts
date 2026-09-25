/**
 * Phase 7: the edges. Restarts, disk faults at every write, large synthetic
 * histories, duplicate and racing triggers, facts that disappear, odd paths,
 * odd dates and corrupt settings. All data is synthetic and lives in a temp
 * directory.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataBoundary, createHostScheduler, type SchedulerTimers, type SqlDatabase } from '@dexnest/foundation';
import { assertSafeTestPath } from '@dexnest/foundation/testing';
import { createSqlitePersistence, type TestPersistence } from '@dexnest/dev-intelligence-store/testing';
import { createSkillConstellationModule } from '../module/runtime.ts';
import { createSkillStore, runSkillConstellationMigrations } from '../store/index.ts';
import { buildConstellation } from '../domain/build.ts';
import { deriveEvidence } from '../domain/evidence.ts';
import { defaultSkillConstellationSettings, normalizeSkillConstellationSettings, type SkillConstellationSettings } from '../domain/settings.ts';
import { SKILL_REBUILD_JOB } from '../manifest.ts';
import { createWorld, type World } from './di-fixtures.ts';
import { commit as inputCommit, input, OPEN, tech as inputTech } from './fixtures.ts';

describe('hardening', () => {
  let world: World | undefined;
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    world?.dispose();
    world = undefined;
    for (const c of cleanups.splice(0)) c();
  });

  async function seeded() {
    const w = (world = await createWorld());
    await w.repo('r-app', 'app');
    await w.repo('r-api', 'api');
    await w.tech('r-app', { category: 'language', name: 'TypeScript', evidencePath: 'src/a.ts', evidenceKind: 'file-extension' });
    await w.tech('r-api', { category: 'language', name: 'Go', evidencePath: 'main.go', evidenceKind: 'file-extension' });
    await w.tech('r-app', { name: 'react' });
    await w.tech('r-api', { name: 'react' });
    await w.todo('r-app', { filePath: 'src/b.ts', text: 'TODO: x' });
    await w.commit('r-app', 's1', '2026-05-01T00:00:00.000Z');
    return w;
  }

  function moduleFor(w: World, settings: { value: SkillConstellationSettings }, scheduler = createHostScheduler({ timers: heldTimers() })) {
    return createSkillConstellationModule({
      database: w.di.database,
      events: w.di.eventLog,
      boundary: w.boundary,
      scheduler,
      settings: { read: () => settings.value, write: (s) => (settings.value = s) },
      reader: w.di,
      now: () => w.clock.now,
    });
  }

  describe('restart', () => {
    it('a build killed mid-read is closed out on the next start, and the next build succeeds', async () => {
      const dir = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'skill-restart-')));
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      const dbPath = join(dir, 'db', 'dexnest.sqlite');
      const boundary = createDataBoundary({ dataRoot: join(dir, 'data') });
      const settings = { value: { ...defaultSkillConstellationSettings(), enabled: true } };

      const open = async () => {
        const di = await createSqlitePersistence({ dbPath });
        runSkillConstellationMigrations(di.database);
        return di;
      };
      const make = (di: TestPersistence, reader = di as Parameters<typeof createSkillConstellationModule>[0]['reader']) =>
        createSkillConstellationModule({
          database: di.database,
          events: di.eventLog,
          boundary,
          scheduler: createHostScheduler({ timers: heldTimers() }),
          settings: { read: () => settings.value, write: (s) => (settings.value = s) },
          reader,
        });

      // First life: one good build, then a second one that never finishes reading.
      const first = await open();
      await first.repositories.upsertRepository({ schemaVersion: 1, id: 'r1', roots: [{ path: join(dir, 'p', 'r1'), domain: 'windows' }], displayName: 'r1', discoveredAt: 'x', lastSeenAt: 'x' });
      await first.technologies.upsert({
        schemaVersion: 1, id: 't1', repositoryId: 'r1', category: 'language', name: 'Rust', evidencePath: 'src/lib.rs', evidenceKind: 'file-extension',
        fingerprint: 'f1', status: 'observed', firstObservedAt: '2026-01-01T00:00:00.000Z', lastObservedAt: '2026-01-01T00:00:00.000Z', observedAt: '2026-01-01T00:00:00.000Z',
      });
      const life1 = make(first);
      life1.start();
      await life1.rebuildNow();
      const hanging = make(first, { ...first, todos: { get: first.todos.get, listByRepository: () => new Promise(() => {}) } });
      void hanging.rebuildNow({ force: true });
      await new Promise((r) => setTimeout(r, 20));
      expect(life1.store.listBuilds().filter((b) => b.status === 'running')).toHaveLength(1);
      life1.stop();
      first.close(); // the process dies here

      // Second life: same file.
      const second = await open();
      cleanups.push(() => second.close());
      const life2 = make(second);
      life2.start();
      const builds = life2.store.listBuilds();
      expect(builds.filter((b) => b.status === 'running')).toEqual([]);
      expect(builds.filter((b) => b.status === 'failed')).toHaveLength(1);
      expect(life2.store.skillIds()).toEqual(['rust']);
      expect((await life2.rebuildNow({ force: true })).status).toBe('completed');
      life2.stop();
    });
  });

  describe('disk fault at every write of a build', () => {
    const statements = [
      /DELETE FROM skill_skills/,
      /DELETE FROM skill_evidence/,
      /DELETE FROM skill_links/,
      /DELETE FROM skill_layout/,
      /INSERT INTO skill_skills/,
      /INSERT INTO skill_evidence/,
      /INSERT INTO skill_links/,
      /INSERT INTO skill_layout/,
      /INSERT INTO skill_strength_history/,
      /UPDATE skill_builds SET status = 'completed'/,
      /INSERT INTO skill_state/,
    ];

    it.each(statements.map((s) => [s.source, s]))('%s failing leaves the previous constellation whole', async (_name, failOn) => {
      const w = await seeded();
      const before = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
      const snapshot = () => ({
        skills: w.store.listSkills(),
        evidence: w.store.countEvidence(),
        links: w.store.listLinks(),
        layout: w.store.listLayout(),
        cursor: w.store.devCursor(),
        history: w.store.historyBuildIds(),
        last: w.store.lastCompletedBuild()?.id,
      });
      const good = snapshot();
      await w.commit('r-api', 's2', '2026-05-02T00:00:00.000Z');
      await w.tech('r-api', { category: 'language', name: 'Python', evidencePath: 'x.py', evidenceKind: 'file-extension' });

      const broken = createSkillStore(failing(w.di.database, failOn));
      const engine = w.engine({ store: broken });
      await expect(engine.build({ occurrenceId: 'o2', trigger: 'manual' })).rejects.toThrow(/injected/);
      expect(snapshot()).toEqual(good);
      expect(good.last).toBe(before.build.id);
      expect(w.store.getBuildByOccurrence('o2')!.status).toBe('failed');
      // And the fault clears: the next build goes through.
      expect((await w.engine().build({ occurrenceId: 'o3', trigger: 'manual' })).status).toBe('completed');
      expect(w.store.skillIds()).toContain('python');
    });

    it('history pruning failing also rolls the build back', async () => {
      const w = await seeded();
      const store = createSkillStore(w.di.database, { historyBuildsKept: 1 });
      const engine = w.engine({ store });
      await engine.build({ occurrenceId: 'o1', trigger: 'manual' });
      const broken = w.engine({ store: createSkillStore(failing(w.di.database, /DELETE FROM skill_strength_history/), { historyBuildsKept: 1 }) });
      await expect(broken.build({ occurrenceId: 'o2', trigger: 'manual', force: true })).rejects.toThrow(/injected/);
      expect(store.historyBuildIds()).toHaveLength(1);
      expect(store.lastCompletedBuild()!.occurrenceId).toBe('o1');
    });
  });

  describe('events are never announced for a build that rolled back', () => {
    it('subscribers hear nothing from a failed build', async () => {
      const w = await seeded();
      const heard: string[] = [];
      w.di.eventLog.subscribe({ stream: 'skill' }, (e) => heard.push(e.type));
      const settings = { value: defaultSkillConstellationSettings() };
      const module = moduleFor(w, settings);
      const realAppend = w.di.eventLog.append.bind(w.di.eventLog);
      w.di.eventLog.append = (e) => {
        if (e.type === 'skill.discovered') throw new Error('late failure');
        return realAppend(e);
      };
      await expect(module.rebuildNow()).rejects.toThrow(/late failure/);
      w.di.eventLog.append = realAppend;
      expect(heard).toEqual([]);
      await module.rebuildNow();
      expect(heard.filter((t) => t === 'skill.constellation.built')).toHaveLength(1);
    });
  });

  describe('duplicate and racing triggers', () => {
    it('many rebuilds at once: one completes, the rest skip, one built event', async () => {
      const w = await seeded();
      const module = moduleFor(w, { value: defaultSkillConstellationSettings() });
      const outcomes = await Promise.all(Array.from({ length: 10 }, () => module.rebuildNow()));
      expect(outcomes.filter((o) => o.status === 'completed')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'skipped')).toHaveLength(9);
      expect(w.di.eventLog.query({ stream: 'skill', types: ['skill.constellation.built'] })).toHaveLength(1);
    });

    it('the host scheduler: a manual run joins the scheduled one in flight, and a slot delivered twice builds once', async () => {
      const w = await seeded();
      const timers = heldTimers();
      const scheduler = createHostScheduler({ timers, now: () => Date.parse('2026-06-01T10:00:00.000Z') });
      const settings = { value: { ...defaultSkillConstellationSettings(), enabled: true } };
      const module = moduleFor(w, settings, scheduler);
      module.start();
      expect(timers.count()).toBe(1);
      await Promise.all([scheduler.runNow(SKILL_REBUILD_JOB), scheduler.runNow(SKILL_REBUILD_JOB)]);
      await Promise.all([timers.fire(), timers.fire()]);
      const completed = w.store.listBuilds().filter((b) => b.status === 'completed');
      expect(completed).toHaveLength(1);
      expect(w.di.eventLog.query({ stream: 'skill', types: ['skill.constellation.built'] })).toHaveLength(1);
      module.stop();
      expect(timers.count()).toBe(0);
      await scheduler.dispose();
    });
  });

  describe('facts that change or disappear', () => {
    it('a repository DI no longer lists takes its evidence with it, and the loss is recorded once', async () => {
      const w = await seeded();
      const settings = { value: defaultSkillConstellationSettings() };
      const module = moduleFor(w, settings);
      await module.rebuildNow();
      expect(w.store.skillIds()).toEqual(['go', 'react', 'typescript']);
      w.di.database.prepare("DELETE FROM dev_repositories WHERE id = 'r-api'").run();
      await module.rebuildNow({ force: true });
      expect(w.store.skillIds()).toEqual(['react', 'typescript']);
      expect(w.store.getSkill('react')!.repositoryCount).toBe(1);
      const lost = w.di.eventLog.query({ stream: 'skill', types: ['skill.evidence_lost'] });
      expect(lost.map((e) => e.subject)).toEqual(['go']);
    });

    it('a removed technology stays as dated history, not as current presence', async () => {
      const w = await seeded();
      const react = (await w.di.technologies.listByRepository('r-app')).find((t) => t.name === 'react')!;
      await w.di.technologies.upsert({ ...react, status: 'removed', removedAt: '2026-03-01T00:00:00.000Z' });
      await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
      const kinds = w.store.listEvidence('react').map((e) => `${e.repositoryId} ${e.kind} ${e.at}`).sort();
      expect(kinds).toEqual(['r-api technology.manifest 2026-05-01T00:00:00.000Z', 'r-app technology.removed 2026-03-01T00:00:00.000Z']);
    });

    it('a TODO deleted from DI after the build shows no text rather than failing', async () => {
      const w = await seeded();
      const engine = w.engine();
      await engine.build({ occurrenceId: 'o1', trigger: 'manual' });
      w.di.database.prepare('DELETE FROM dev_todos').run();
      const described = await engine.describeEvidence('typescript');
      expect(described.find((e) => e.kind === 'todo.open')!.todoText).toBeNull();
    });

    it('the same commit in two clones is one piece of evidence, not two', () => {
      const derived = deriveEvidence(
        input({
          technologies: [
            inputTech({ repositoryId: 'r-app', category: 'language', name: 'Go', evidencePath: 'a.go', evidenceKind: 'file-extension' }),
            inputTech({ repositoryId: 'r-api', category: 'language', name: 'Go', evidencePath: 'a.go', evidenceKind: 'file-extension' }),
          ],
          commits: [inputCommit({ repositoryId: 'r-app', sha: 'same' }), inputCommit({ repositoryId: 'r-api', sha: 'same' })],
        }),
        { settings: OPEN },
      );
      expect(derived.evidence.filter((e) => e.kind === 'commit')).toHaveLength(1);
    });
  });

  describe('odd paths', () => {
    it.each([
      ['../outside/escape.ts'],
      ['src/../../escape.ts'],
      ['/etc/passwd.c'],
      ['C:\\Users\\me\\secret.ts'],
      ['c:/Users/me/secret.ts'],
      ['\\\\server\\share\\x.ts'],
    ])('%s is not recorded: evidence paths must stay inside the repository', (path) => {
      const derived = deriveEvidence(
        input({ technologies: [inputTech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: path, evidenceKind: 'file-extension' })] }),
        { settings: OPEN },
      );
      expect(derived.evidence).toEqual([]);
      expect(derived.refusedPrivate).toBe(1);
    });

    it('unicode and very long ordinary paths are kept as written', () => {
      const long = `${'deep/'.repeat(80)}file.ts`;
      const derived = deriveEvidence(
        input({
          technologies: [
            inputTech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: 'src/données/ünïcode.ts', evidenceKind: 'file-extension' }),
            inputTech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: long, evidenceKind: 'file-extension' }),
          ],
        }),
        { settings: OPEN },
      );
      expect(derived.evidence.map((e) => e.path).sort()).toEqual([long, 'src/données/ünïcode.ts'].sort());
    });
  });

  describe('odd dates', () => {
    it('future, missing and garbage dates never break a build or strength', () => {
      const now = new Date('2026-06-01T00:00:00.000Z');
      const build = buildConstellation(
        input({
          technologies: [inputTech({ repositoryId: 'r-app', category: 'language', name: 'Go', evidencePath: 'a.go', evidenceKind: 'file-extension', lastObservedAt: '2031-01-01T00:00:00.000Z' })],
          commits: [inputCommit({ repositoryId: 'r-app', sha: 'x', authorDate: 'not a date' })],
        }),
        { settings: OPEN, now },
      );
      const go = build.skills[0]!;
      expect(go.strength.score).toBeGreaterThan(0);
      expect(go.strength.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(build.layout[0]!.x)).toBe(true);
    });
  });

  describe('corrupt settings', () => {
    it.each([[null], ['{"enabled":tru'], [42], [[]], [{ enabled: 'true', myEmails: 'me@x.y', rebuildIntervalMinutes: 'soon' }]])(
      '%j reads back as safe, off defaults',
      (raw) => {
        const s = normalizeSkillConstellationSettings(raw);
        expect(s.enabled).toBe(false);
        expect(s.myEmails).toEqual([]);
        expect(s.rebuildIntervalMinutes).toBe(60);
      },
    );
  });

  describe('large synthetic history', () => {
    it('50,000 commits across 200 repositories build within a time budget, and a rebuild with no change is cheap', async () => {
      const w = (world = await createWorld());
      const languages = ['TypeScript', 'Go', 'Rust', 'Python', 'Java'];
      for (let r = 0; r < 200; r++) {
        await w.repo(`r${r}`, `repo-${r}`);
        await w.tech(`r${r}`, { category: 'language', name: languages[r % 5]!, evidencePath: `src/main${r}`, evidenceKind: 'file-extension' });
        await w.tech(`r${r}`, { name: r % 2 === 0 ? 'react' : 'express', evidencePath: 'package.json' });
      }
      // Bulk-insert the commit events in one transaction; the event log is what DI would have written.
      const log = w.di.eventLog;
      w.di.database.exec('BEGIN');
      for (let i = 0; i < 50_000; i++) {
        const repo = `r${i % 200}`;
        log.append({
          type: 'dev.commit.observed', stream: 'dev', module: 'developer_intelligence', subject: repo, source: 'test',
          idempotencyKey: `developer_intelligence:bulk_${i}`,
          payload: { sha: `sha${i}`, subject: 'x', authorDate: new Date(Date.UTC(2025, 0, 1) + i * 600_000).toISOString() },
        });
      }
      w.di.database.exec('COMMIT');

      const engine = w.engine();
      const started = performance.now();
      const outcome = await engine.build({ occurrenceId: 'big', trigger: 'manual' });
      const elapsed = performance.now() - started;
      expect(outcome.status).toBe('completed');
      expect(w.store.countEvidence()).toBe(50_000 + 200 + 200);
      expect(w.store.listSkills().map((s) => s.id)).toEqual(['express', 'go', 'java', 'python', 'react', 'rust', 'typescript']);
      // Generous: a CI container, not a benchmark. Recorded in the report.
      expect(elapsed).toBeLessThan(30_000);

      const skipStarted = performance.now();
      expect((await engine.build({ occurrenceId: 'big2', trigger: 'scheduled' })).status).toBe('skipped');
      expect(performance.now() - skipStarted).toBeLessThan(500);
      // The evidence panel stays bounded however much evidence a skill has.
      expect((await engine.describeEvidence('typescript', { limit: 200 })).length).toBe(200);
    }, 120_000);
  });
});

/** Wraps a database so statements matching `failOn` throw on run - a disk error. */
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
        get: (params) => statement.get(params),
        all: (params) => statement.all(params),
      };
    },
  };
}

function heldTimers(): SchedulerTimers & { count(): number; fire(): Promise<void> } {
  let next = 0;
  const live = new Map<number, () => void>();
  return {
    set: (callback) => {
      const id = ++next;
      live.set(id, callback);
      return id;
    },
    clear: (id) => {
      live.delete(id as number);
    },
    count: () => live.size,
    async fire() {
      for (const [id, callback] of [...live]) {
        live.delete(id);
        callback();
      }
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
