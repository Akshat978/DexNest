import { describe, it, expect, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { inspectModuleMigrations, validateManifest, type SqlDatabase } from '@dexnest/foundation';
import { buildConstellation } from '../domain/build.ts';
import { createSkillStore, runSkillConstellationMigrations, SKILL_CONSTELLATION_MIGRATIONS } from '../store/index.ts';
import { manifestProblems, SKILL_CONSTELLATION_MANIFEST } from '../manifest.ts';
import { commit, input, OPEN, tech, todo } from './fixtures.ts';

const NOW = new Date('2026-06-01T10:00:00.000Z');

function sampleBuild(extra: { vue?: boolean } = {}) {
  return buildConstellation(
    input({
      technologies: [
        tech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: 'src/a.ts', evidenceKind: 'file-extension' }),
        tech({ repositoryId: 'r-api', category: 'language', name: 'TypeScript', evidencePath: 'src/b.ts', evidenceKind: 'file-extension' }),
        tech({ repositoryId: 'r-app', name: 'react' }),
        tech({ repositoryId: 'r-api', name: 'react' }),
        ...(extra.vue ? [tech({ repositoryId: 'r-cli', name: 'vue' })] : []),
      ],
      todos: [todo({ repositoryId: 'r-app', filePath: 'src/c.ts', line: 3 })],
      commits: [commit({ repositoryId: 'r-app', sha: 'c1' })],
    }),
    { settings: OPEN, now: NOW },
  );
}

/** Wraps a database so a statement matching `failOn` throws - a disk error mid-build. */
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

describe('Skill Constellation store', () => {
  let handle: TestDatabase | undefined;
  const extra: TestDatabase[] = [];
  afterEach(() => {
    for (const h of extra.splice(0)) h.close();
    handle?.dispose();
    handle = undefined;
  });

  function open() {
    handle = createTestDatabase('skill-store-');
    runSkillConstellationMigrations(handle.db);
    return handle;
  }

  let seq = 0;
  function commitNew(store: ReturnType<typeof createSkillStore>, at: string, result = sampleBuild(), cursor = 10) {
    const id = `b${++seq}`;
    store.beginBuild({ id, occurrenceId: `occ-${id}`, trigger: 'manual', startedAt: at });
    return store.commitBuild({ buildId: id, finishedAt: at, devCursorSeq: cursor, settingsFingerprint: 'fp', result });
  }

  it('migrates through the foundation ledger, once', () => {
    const { db } = open();
    expect(inspectModuleMigrations(db, 'skill_constellation', SKILL_CONSTELLATION_MIGRATIONS)).toEqual({ applied: [1], pending: [] });
    expect(runSkillConstellationMigrations(db)).toEqual({ applied: [], alreadyApplied: [1] });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'skill_%' ORDER BY name")
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(tables).toEqual([
      'skill_builds',
      'skill_evidence',
      'skill_layout',
      'skill_links',
      'skill_skills',
      'skill_state',
      'skill_strength_history',
    ]);
  });

  it('manifest is valid, and validation would catch a table outside the prefix', () => {
    expect(manifestProblems()).toEqual([]);
    const bad = { ...SKILL_CONSTELLATION_MANIFEST, migrations: [{ version: 2, name: 'x', sql: 'CREATE TABLE dev_oops (id TEXT)' }] };
    expect(validateManifest(bad, 'skill')).toHaveLength(1);
  });

  it('everything survives closing and reopening the database', () => {
    const h = open();
    const store = createSkillStore(h.db);
    const result = sampleBuild();
    const build = commitNew(store, '2026-06-01T10:00:00.000Z', result, 42);
    h.close();

    const again = h.reopen();
    extra.push(again);
    const reopened = createSkillStore(again.db);
    expect(runSkillConstellationMigrations(again.db).applied).toEqual([]);
    expect(reopened.listSkills()).toEqual(result.skills.map(({ strength: _s, ...skill }) => skill));
    expect(reopened.listEvidence('typescript').length).toBe(result.evidence.filter((e) => e.skillId === 'typescript').length);
    expect(reopened.countEvidence()).toBe(result.evidence.length);
    expect(reopened.listLinks()).toEqual(result.links);
    expect(reopened.listLayout()).toEqual(result.layout);
    expect(reopened.strengthHistory('react')).toHaveLength(1);
    expect(reopened.devCursor()).toBe(42);
    expect(reopened.settingsFingerprint()).toBe('fp');
    expect(reopened.lastCompletedBuild()).toEqual(build);
    expect(build).toMatchObject({ status: 'completed', skills: result.skills.length, evidence: result.evidence.length });
  });

  it('one occurrence is one build, however often it is begun', () => {
    const store = createSkillStore(open().db);
    const first = store.beginBuild({ id: 'x1', occurrenceId: 'rebuild:slot', trigger: 'scheduled', startedAt: '2026-06-01T10:00:00.000Z' });
    const second = store.beginBuild({ id: 'x2', occurrenceId: 'rebuild:slot', trigger: 'manual', startedAt: '2026-06-01T10:00:01.000Z' });
    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, build: first.build });
    expect(store.listBuilds()).toHaveLength(1);
  });

  it('a build cannot be committed twice', () => {
    const store = createSkillStore(open().db);
    const build = commitNew(store, '2026-06-01T10:00:00.000Z');
    expect(() =>
      store.commitBuild({ buildId: build.id, finishedAt: 'x', devCursorSeq: 99, settingsFingerprint: 'fp', result: sampleBuild() }),
    ).toThrow(/completed, not running/);
    expect(store.devCursor()).toBe(10);
  });

  describe('a build lands whole or not at all', () => {
    function expectPreviousIntact(store: ReturnType<typeof createSkillStore>, before: ReturnType<typeof sampleBuild>, buildId: string) {
      expect(store.skillIds()).toEqual(before.skills.map((s) => s.id));
      expect(store.countEvidence()).toBe(before.evidence.length);
      expect(store.listLinks()).toEqual(before.links);
      expect(store.listLayout()).toEqual(before.layout);
      expect(store.devCursor()).toBe(10);
      expect(store.getBuild(buildId)!.status).toBe('running');
      expect(store.historyBuildIds()).toHaveLength(1);
    }

    it('when a later write in the same transaction fails', () => {
      const store = createSkillStore(open().db);
      const before = sampleBuild();
      commitNew(store, '2026-06-01T10:00:00.000Z', before);
      store.beginBuild({ id: 'next', occurrenceId: 'occ-next', trigger: 'manual', startedAt: '2026-06-02T10:00:00.000Z' });
      expect(() =>
        store.commitBuild({
          buildId: 'next',
          finishedAt: '2026-06-02T10:00:00.000Z',
          devCursorSeq: 20,
          settingsFingerprint: 'fp2',
          result: sampleBuild({ vue: true }),
          alsoInTransaction: () => {
            throw new Error('event write failed');
          },
        }),
      ).toThrow(/event write failed/);
      expectPreviousIntact(store, before, 'next');
    });

    it('when the disk refuses a write halfway through', () => {
      const h = open();
      const before = sampleBuild();
      commitNew(createSkillStore(h.db), '2026-06-01T10:00:00.000Z', before);
      const broken = createSkillStore(failing(h.db, /INSERT INTO skill_links/));
      broken.beginBuild({ id: 'next', occurrenceId: 'occ-next', trigger: 'manual', startedAt: '2026-06-02T10:00:00.000Z' });
      expect(() =>
        broken.commitBuild({ buildId: 'next', finishedAt: 'x', devCursorSeq: 20, settingsFingerprint: 'fp2', result: sampleBuild({ vue: true }) }),
      ).toThrow(/injected/);
      expectPreviousIntact(createSkillStore(h.db), before, 'next');
    });
  });

  it('a skipped build changes nothing but its own row', () => {
    const store = createSkillStore(open().db);
    const before = sampleBuild();
    commitNew(store, '2026-06-01T10:00:00.000Z', before);
    store.beginBuild({ id: 's', occurrenceId: 'occ-s', trigger: 'scheduled', startedAt: '2026-06-02T00:00:00.000Z' });
    const skipped = store.markSkipped('s', { finishedAt: '2026-06-02T00:00:01.000Z', devCursorSeq: 10, settingsFingerprint: 'fp' });
    expect(skipped.status).toBe('skipped');
    expect(store.skillIds()).toEqual(before.skills.map((s) => s.id));
    expect(store.historyBuildIds()).toHaveLength(1);
  });

  it('a crash leaves running builds; recovery marks them failed and keeps the constellation', () => {
    const h = open();
    const store = createSkillStore(h.db);
    commitNew(store, '2026-06-01T10:00:00.000Z');
    store.beginBuild({ id: 'crashed', occurrenceId: 'occ-crashed', trigger: 'scheduled', startedAt: '2026-06-02T00:00:00.000Z' });
    h.close();
    const again = h.reopen();
    extra.push(again);
    const reopened = createSkillStore(again.db);
    expect(reopened.recoverInterruptedBuilds('2026-06-02T01:00:00.000Z')).toBe(1);
    expect(reopened.getBuild('crashed')).toMatchObject({ status: 'failed', error: 'Interrupted before it finished.' });
    expect(reopened.skillIds().length).toBeGreaterThan(0);
    expect(reopened.recoverInterruptedBuilds('2026-06-02T01:00:00.000Z')).toBe(0);
  });

  it('keeps strength history for the newest builds only, and prunes old build rows', () => {
    const store = createSkillStore(open().db, { historyBuildsKept: 3 });
    const ids: string[] = [];
    for (let day = 1; day <= 5; day++) {
      const at = `2026-06-0${day}T10:00:00.000Z`;
      if (day === 2) {
        store.beginBuild({ id: 'skip2', occurrenceId: 'occ-skip2', trigger: 'scheduled', startedAt: `2026-06-02T09:00:00.000Z` });
        store.markSkipped('skip2', { finishedAt: at, devCursorSeq: 1, settingsFingerprint: 'fp' });
      }
      ids.push(commitNew(store, at).id);
    }
    expect(store.historyBuildIds()).toEqual(ids.slice(2).sort());
    expect(store.strengthHistory('react').map((h) => h.buildId)).toEqual(ids.slice(2).reverse());
    const remaining = store.listBuilds(100).map((b) => b.id);
    expect(remaining.sort()).toEqual(ids.slice(2).sort());
  });

  it('the schema itself refuses a skill with no evidence', () => {
    const { db } = open();
    expect(() =>
      db
        .prepare(
          `INSERT INTO skill_skills (id, name, category, evidence_count, repository_count, evidence_kinds, first_evidence_at, last_evidence_at, build_id)
           VALUES ('ghost', 'Ghost', 'language', 0, 0, 0, 'x', 'x', 'b')`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});
