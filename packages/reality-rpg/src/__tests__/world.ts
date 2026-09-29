/**
 * A synthetic DexNest: the foundation's event log and Reality RPG's tables on
 * one real SQLite file in a temp directory. Legacy audit rows are written the
 * way @dexnest/local-db writes them (no envelope module, content in the
 * payload), module events through the foundation's EventLog.
 */
import { createEventLog, runFoundationMigrations, type EventLog, type EventQuery } from '@dexnest/foundation';
import { createTestDatabase, type TestDatabase } from '@dexnest/foundation/testing';
import { createRealityRpgStore, runRealityRpgMigrations, type RealityRpgStore } from '../store/index.ts';
import { createRpgEngine, type EventReader, type RpgEngineOptions } from '../engine/engine.ts';
import type { Rule } from '../domain/types.ts';

export interface World {
  handle: TestDatabase;
  log: EventLog;
  store: RealityRpgStore;
  queries: EventQuery[];
  clock: { now: Date };
  engine(overrides?: Partial<RpgEngineOptions>): ReturnType<typeof createRpgEngine>;
  /** A row as local-db's appendActionEvent writes it. */
  legacy(input: { type?: string; module: string; actionId: string; status?: string; summary?: string; metadataJson?: unknown; at?: string }): string;
  moduleEvent(input: { type: string; stream: string; module: string; at?: string; payload?: unknown }): string;
  rule(overrides: Partial<Omit<Rule, 'version'>> & Pick<Rule, 'id' | 'match'>): Rule;
  dump(): string;
  dispose(): void;
}

let n = 0;

export function createWorld(): World {
  const handle = createTestDatabase('rpg-engine-');
  runFoundationMigrations(handle.db);
  runRealityRpgMigrations(handle.db);
  const log = createEventLog(handle.db);
  const store = createRealityRpgStore(handle.db);
  const queries: EventQuery[] = [];
  const clock = { now: new Date('2026-06-01T12:00:00.000Z') };
  const spy: EventReader = {
    query<TPayload = unknown>(filter?: EventQuery) {
      queries.push(filter ?? {});
      return log.query<TPayload>(filter);
    },
  };

  return {
    handle,
    log,
    store,
    queries,
    clock,
    engine: (overrides) => createRpgEngine({ store, events: spy, timeZone: 'UTC', now: () => clock.now, newId: () => `run_${++n}`, ...overrides }),
    legacy(input) {
      const id = `legacy_${++n}`;
      const at = input.at ?? clock.now.toISOString();
      handle.db
        .prepare('INSERT INTO event_log (id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run([
          id,
          input.type ?? 'action_executed',
          'command',
          JSON.stringify({
            module: input.module,
            actionId: input.actionId,
            eventType: input.type ?? 'action_executed',
            status: input.status ?? 'success',
            source: 'command',
            summary: input.summary ?? 'ok',
            metadataJson: input.metadataJson ?? {},
            errorMessage: null,
            durationMs: 5,
          }),
          at,
        ]);
      return id;
    },
    moduleEvent(input) {
      const at = input.at ?? clock.now.toISOString();
      return log.append({ type: input.type, stream: input.stream, module: input.module, source: 'test', occurredAt: at, recordedAt: at, payload: input.payload ?? {} }).event.id;
    },
    rule(overrides) {
      return store.saveRule(
        { name: overrides.id, enabled: true, award: { xp: 10, stat: 'Craft' }, effectiveFrom: '1970-01-01T00:00:00.000Z', ...overrides },
        clock.now.toISOString(),
      );
    },
    dump() {
      const tables = handle.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rpg\\_%' ESCAPE '\\'").all<{ name: string }>();
      return tables.map((t) => JSON.stringify(handle.db.prepare(`SELECT * FROM ${t.name}`).all())).join('\n');
    },
    dispose: () => handle.dispose(),
  };
}
