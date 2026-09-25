/**
 * A real Developer Intelligence store (node:sqlite, temp dir) seeded with
 * synthetic facts, plus Skill Constellation's tables on the same connection -
 * the arrangement production has. No real repository or user data is touched.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataBoundary, type DataBoundary } from '@dexnest/foundation';
import { assertSafeTestPath } from '@dexnest/foundation/testing';
import { createSqlitePersistence, type TestPersistence } from '@dexnest/dev-intelligence-store/testing';
import type { DeveloperEvent, TechnologyFact, TodoMarker } from '@dexnest/dev-intelligence-contracts';
import { runSkillConstellationMigrations, createSkillStore, type SkillStore } from '../store/index.ts';
import { defaultSkillConstellationSettings, type SkillConstellationSettings } from '../domain/settings.ts';
import { createConstellationEngine, type ConstellationEngineOptions } from '../engine/engine.ts';

export interface World {
  dir: string;
  dataRoot: string;
  di: TestPersistence;
  store: SkillStore;
  boundary: DataBoundary;
  settings: SkillConstellationSettings;
  clock: { now: Date };
  engine(overrides?: Partial<ConstellationEngineOptions>): ReturnType<typeof createConstellationEngine>;
  repo(id: string, name: string, root?: string): Promise<string>;
  tech(repositoryId: string, fact: Partial<TechnologyFact> & Pick<TechnologyFact, 'name'>): Promise<TechnologyFact>;
  todo(repositoryId: string, marker: Partial<TodoMarker> & Pick<TodoMarker, 'filePath'>): Promise<TodoMarker>;
  commit(repositoryId: string, sha: string, authorDate: string, authorEmail?: string): Promise<void>;
  /** Every value in every skill_ table, as one string - for "never recorded" checks. */
  dumpSkillTables(): string;
  dispose(): void;
}

let counter = 0;

export async function createWorld(): Promise<World> {
  const dir = assertSafeTestPath(mkdtempSync(join(tmpdir(), 'skill-engine-')));
  const dataRoot = join(dir, 'dexnest', 'local-data');
  const di = await createSqlitePersistence({ dbPath: join(dir, 'db', 'dexnest.sqlite') });
  runSkillConstellationMigrations(di.database);
  const store = createSkillStore(di.database);
  const boundary = createDataBoundary({ dataRoot });
  const settings = defaultSkillConstellationSettings();
  const clock = { now: new Date('2026-06-01T10:00:00.000Z') };

  const world: World = {
    dir,
    dataRoot,
    di,
    store,
    boundary,
    settings,
    clock,
    engine: (overrides) =>
      createConstellationEngine({
        store,
        reader: di,
        events: di.eventLog,
        boundary,
        settings: () => world.settings,
        now: () => clock.now,
        newId: () => `build_${++counter}`,
        ...overrides,
      }),
    async repo(id, name, root) {
      await di.repositories.upsertRepository({
        schemaVersion: 1,
        id,
        roots: [{ path: root ?? join(dir, 'projects', name), domain: 'windows' }],
        displayName: name,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-06-01T00:00:00.000Z',
      });
      return id;
    },
    async tech(repositoryId, fact) {
      const full: TechnologyFact = {
        schemaVersion: 1,
        id: `tech_${++counter}`,
        repositoryId,
        category: 'library',
        evidencePath: 'package.json',
        evidenceKind: 'package.json#dependencies',
        fingerprint: `fp_${counter}`,
        status: 'observed',
        firstObservedAt: '2026-01-01T00:00:00.000Z',
        lastObservedAt: '2026-05-01T00:00:00.000Z',
        observedAt: '2026-05-01T00:00:00.000Z',
        ...fact,
      };
      await di.technologies.upsert(full);
      return full;
    },
    async todo(repositoryId, marker) {
      const full: TodoMarker = {
        schemaVersion: 1,
        id: `todo_${++counter}`,
        repositoryId,
        kind: 'TODO',
        status: 'open',
        line: 1,
        text: 'TODO: something',
        fingerprint: `tfp_${counter}`,
        firstObservedAt: '2026-04-01T00:00:00.000Z',
        lastObservedAt: '2026-05-01T00:00:00.000Z',
        ...marker,
      };
      await di.todos.upsert(full);
      return full;
    },
    async commit(repositoryId, sha, authorDate, authorEmail) {
      const event: DeveloperEvent = {
        schemaVersion: 1,
        eventId: `ev_${++counter}`,
        type: 'dev.commit.observed',
        repositoryId,
        occurredAt: authorDate,
        observedAt: '2026-06-01T00:00:00.000Z',
        source: 'test',
        sourceIdentity: 'test',
        fingerprint: `commit_${repositoryId}_${sha}`,
        payload: { sha, subject: `subject of ${sha}`, authorDate, ...(authorEmail ? { authorEmail } : {}) },
      };
      await di.events.append(event);
    },
    dumpSkillTables() {
      const tables = di.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'skill\\_%' ESCAPE '\\'")
        .all<{ name: string }>();
      return tables.map((t) => JSON.stringify(di.database.prepare(`SELECT * FROM ${t.name}`).all())).join('\n');
    },
    dispose() {
      di.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return world;
}
