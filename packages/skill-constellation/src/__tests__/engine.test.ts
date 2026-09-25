import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { createWorld, type World } from './di-fixtures.ts';

describe('constellation engine', () => {
  let world: World | undefined;
  afterEach(() => {
    world?.dispose();
    world = undefined;
  });

  async function seeded() {
    const w = (world = await createWorld());
    await w.repo('r-app', 'app');
    await w.repo('r-api', 'api');
    await w.tech('r-app', { category: 'language', name: 'TypeScript', evidencePath: 'src/main.ts', evidenceKind: 'file-extension' });
    await w.tech('r-api', { category: 'language', name: 'TypeScript', evidencePath: 'src/server.ts', evidenceKind: 'file-extension' });
    await w.tech('r-app', { name: 'react', version: '^18.2.0' });
    await w.tech('r-app', { category: 'project', name: 'app' });
    await w.todo('r-app', { filePath: 'src/main.ts', line: 7, text: 'TODO: tidy the router' });
    await w.commit('r-app', 'aaa1', '2026-05-20T09:00:00.000Z', 'me@example.com');
    await w.commit('r-app', 'bbb2', '2026-05-21T09:00:00.000Z', 'someone@example.com');
    await w.commit('r-api', 'ccc3', '2026-05-22T09:00:00.000Z');
    return w;
  }

  it('builds skills from Developer Intelligence facts, each with its evidence', async () => {
    const w = await seeded();
    const outcome = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
    expect(outcome.status).toBe('completed');

    expect(w.store.skillIds()).toEqual(['react', 'typescript']);
    const ts = w.store.getSkill('typescript')!;
    expect(ts).toMatchObject({ repositoryCount: 2, lastActivityAt: '2026-05-22T09:00:00.000Z' });
    const evidence = w.store.listEvidence('typescript');
    expect(evidence.map((e) => `${e.kind} ${e.repositoryName} ${e.path ?? e.sourceRef}`).sort()).toEqual([
      'commit api ccc3',
      'commit app aaa1',
      'commit app bbb2',
      'technology.extension api src/server.ts',
      'technology.extension app src/main.ts',
      'todo.open app src/main.ts',
    ]);
    const react = w.store.listEvidence('react');
    expect(react).toEqual([expect.objectContaining({ kind: 'technology.manifest', path: 'package.json', detail: 'package.json#dependencies ^18.2.0' })]);
    expect(w.store.devCursor()).toBeGreaterThan(0);
  });

  it('counts only my commits once my emails are set; unknown authors still count', async () => {
    const w = await seeded();
    w.settings = { ...w.settings, myEmails: ['me@example.com'] };
    const outcome = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
    const commits = w.store.listEvidence('typescript').filter((e) => e.kind === 'commit').map((e) => e.sourceRef).sort();
    expect(commits).toEqual(['aaa1', 'ccc3']);
    expect(outcome.build.othersCommits).toBe(1);
  });

  it('never copies TODO text or commit subjects; the view looks TODO text up live', async () => {
    const w = await seeded();
    const engine = w.engine();
    await engine.build({ occurrenceId: 'o1', trigger: 'manual' });
    const dump = w.dumpSkillTables();
    expect(dump).not.toContain('tidy the router');
    expect(dump).not.toContain('subject of');

    const described = await engine.describeEvidence('typescript');
    expect(described.find((e) => e.kind === 'todo.open')!.todoText).toBe('TODO: tidy the router');
    expect(described.filter((e) => e.kind !== 'todo.open').every((e) => e.todoText === null)).toBe(true);
  });

  describe('data boundary (bait)', () => {
    const BAIT_PATHS = [
      'local-data/files/vault/journal.md',
      'local-data/data/dexnest.sqlite',
      '.env',
      'config/.env.local',
      'secrets/id_rsa',
      'certs/server.pem',
      'finance/receipts-2026.ts',
      'journal/diary.py',
    ];

    it('records nothing named like private data, nor anything in a repository inside the data root', async () => {
      const w = (world = await createWorld());
      await w.repo('r-app', 'app');
      // A repository that lives inside DexNest's (synthetic) data root, with ordinary-looking files.
      await w.repo('r-inside', 'innocent-name', join(w.dataRoot, 'files', 'drop', 'repo'));
      await w.tech('r-app', { category: 'language', name: 'TypeScript', evidencePath: 'src/ok.ts', evidenceKind: 'file-extension' });
      for (const path of BAIT_PATHS) {
        await w.tech('r-app', { category: 'language', name: 'TypeScript', evidencePath: path, evidenceKind: 'file-extension' });
        await w.tech('r-app', { name: 'react', evidencePath: path });
      }
      await w.todo('r-app', { filePath: 'finance/budget.ts', text: 'TODO: move savings' });
      await w.todo('r-app', { filePath: 'local-data/files/vault/notes.ts', text: 'TODO: vault note' });
      await w.tech('r-inside', { category: 'language', name: 'Go', evidencePath: 'main.go', evidenceKind: 'file-extension' });
      await w.tech('r-inside', { name: 'vue', evidencePath: 'package.json' });
      await w.todo('r-inside', { filePath: 'main.go', text: 'TODO: inside data root' });
      await w.commit('r-inside', 'ddd4', '2026-05-01T00:00:00.000Z');

      const outcome = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
      expect(outcome.status).toBe('completed');
      expect(w.store.skillIds()).toEqual(['typescript']);
      expect(w.store.listEvidence('typescript').map((e) => e.path)).toEqual(['src/ok.ts']);

      const dump = w.dumpSkillTables();
      for (const bait of [...BAIT_PATHS, 'finance/budget.ts', 'vault', 'local-data', 'innocent-name', 'r-inside', 'ddd4', 'savings', 'id_rsa', '.env']) {
        expect(dump, bait).not.toContain(bait);
      }
      expect(outcome.build.refusedPrivate).toBe(BAIT_PATHS.length * 2 + 2 + 3);
    });
  });

  describe('when nothing changed', () => {
    it('a second build is skipped and changes nothing', async () => {
      const w = await seeded();
      const engine = w.engine();
      const first = await engine.build({ occurrenceId: 'o1', trigger: 'scheduled' });
      const second = await engine.build({ occurrenceId: 'o2', trigger: 'scheduled' });
      expect(second.status).toBe('skipped');
      expect(w.store.lastCompletedBuild()!.id).toBe(first.build.id);
      expect(w.store.historyBuildIds()).toEqual([first.build.id]);
      expect(engine.staleness()).toMatchObject({ stale: false, hasBuild: true });
    });

    it('a new dev event makes it stale, and the next build picks it up', async () => {
      const w = await seeded();
      const engine = w.engine();
      await engine.build({ occurrenceId: 'o1', trigger: 'scheduled' });
      await w.tech('r-api', { category: 'language', name: 'Go', evidencePath: 'go.mod', evidenceKind: 'go.mod' });
      // A fact alone emits no event; DI emits dev.technology.observed with it. Model that.
      await w.di.events.append({
        schemaVersion: 1,
        eventId: 'ev_go',
        type: 'dev.technology.observed',
        repositoryId: 'r-api',
        occurredAt: '2026-06-02T00:00:00.000Z',
        observedAt: '2026-06-02T00:00:00.000Z',
        source: 'test',
        sourceIdentity: 'test',
        fingerprint: 'tech_go',
        payload: {},
      });
      expect(engine.staleness()).toMatchObject({ stale: true, devChanged: true });
      const next = await engine.build({ occurrenceId: 'o2', trigger: 'scheduled' });
      expect(next.status).toBe('completed');
      expect(w.store.skillIds()).toContain('go');
      if (next.status === 'completed') expect(next.result.added).toEqual(['go']);
    });

    it('changing a build-relevant setting makes it stale; a display-only one does not', async () => {
      const w = await seeded();
      const engine = w.engine();
      await engine.build({ occurrenceId: 'o1', trigger: 'scheduled' });
      w.settings = { ...w.settings, hiddenSkills: ['react'] };
      expect(engine.staleness().stale).toBe(false);
      w.settings = { ...w.settings, myEmails: ['me@example.com'] };
      expect(engine.staleness()).toMatchObject({ stale: true, settingsChanged: true });
    });

    it('force rebuilds anyway', async () => {
      const w = await seeded();
      const engine = w.engine();
      await engine.build({ occurrenceId: 'o1', trigger: 'manual' });
      expect((await engine.build({ occurrenceId: 'o2', trigger: 'manual', force: true })).status).toBe('completed');
    });
  });

  it('the same occurrence twice is one build', async () => {
    const w = await seeded();
    const engine = w.engine();
    const [a, b] = await Promise.all([
      engine.build({ occurrenceId: 'slot', trigger: 'scheduled' }),
      engine.build({ occurrenceId: 'slot', trigger: 'manual' }),
    ]);
    expect(a.status).toBe('completed');
    expect(b).toEqual({ status: 'duplicate', build: expect.objectContaining({ id: a.build.id }) });
    expect(w.store.listBuilds()).toHaveLength(1);
  });

  it('concurrent builds with different occurrences run one after the other', async () => {
    const w = await seeded();
    const engine = w.engine();
    const outcomes = await Promise.all([
      engine.build({ occurrenceId: 'a', trigger: 'scheduled' }),
      engine.build({ occurrenceId: 'b', trigger: 'manual' }),
      engine.build({ occurrenceId: 'c', trigger: 'manual' }),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['completed', 'skipped', 'skipped']);
  });

  it('reads every commit, well past one page', async () => {
    const w = (world = await createWorld());
    await w.repo('r-app', 'app');
    await w.tech('r-app', { category: 'language', name: 'Rust', evidencePath: 'Cargo.toml', evidenceKind: 'Cargo.toml' });
    for (let i = 0; i < 1234; i++) {
      await w.commit('r-app', `sha${i}`, new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString());
    }
    await w.engine({ pageSize: 100 }).build({ occurrenceId: 'o1', trigger: 'manual' });
    expect(w.store.countEvidence('rust')).toBe(1234 + 1);
  });

  it('skips a commit event it cannot read, and still builds', async () => {
    const w = await seeded();
    await w.di.events.append({
      schemaVersion: 1,
      eventId: 'ev_bad',
      type: 'dev.commit.observed',
      repositoryId: 'r-app',
      occurredAt: '2026-05-01T00:00:00.000Z',
      observedAt: '2026-05-01T00:00:00.000Z',
      source: 'test',
      sourceIdentity: 'test',
      fingerprint: 'bad',
      payload: { sha: 42, authorDate: 'never' },
    });
    const outcome = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
    expect(outcome.status).toBe('completed');
    expect(w.store.listEvidence('typescript').filter((e) => e.kind === 'commit')).toHaveLength(3);
  });

  it('a failing read fails the build and leaves the previous constellation', async () => {
    const w = await seeded();
    await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
    const before = w.store.skillIds();
    const broken = w.engine({
      reader: {
        ...w.di,
        todos: {
          get: (id) => w.di.todos.get(id),
          listByRepository: () => Promise.reject(new Error('DI store unavailable')),
        },
      },
    });
    await expect(broken.build({ occurrenceId: 'o2', trigger: 'manual', force: true })).rejects.toThrow(/unavailable/);
    expect(w.store.getBuildByOccurrence('o2')).toMatchObject({ status: 'failed', error: 'DI store unavailable' });
    expect(w.store.skillIds()).toEqual(before);
    // The failure does not wedge the queue.
    expect((await w.engine().build({ occurrenceId: 'o3', trigger: 'manual', force: true })).status).toBe('completed');
  });

  it('with no Developer Intelligence data, builds an empty constellation', async () => {
    const w = (world = await createWorld());
    const outcome = await w.engine().build({ occurrenceId: 'o1', trigger: 'manual' });
    expect(outcome.status).toBe('completed');
    expect(w.store.listSkills()).toEqual([]);
  });
});
