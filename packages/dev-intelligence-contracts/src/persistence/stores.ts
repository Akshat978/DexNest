/**
 * Persistence service interfaces. Implementations live in @dexnest/dev-intelligence-store.
 * Contracts must not expose raw SQL or table schemas.
 */

import type {
  Repository,
  RepositorySnapshot,
} from '../domain/repository.js';
import type { TodoMarker } from '../domain/todo.js';
import type { TechnologyFact } from '../domain/technology.js';
import type { HealthCheck, HealthRun } from '../domain/health.js';
import type { ScanRun } from '../domain/scan.js';
import type { DeveloperEvent } from '../events/types.js';
import type { RetentionStore } from '../domain/retention.js';

export interface RepositoryStore {
  upsertRepository(repo: Repository): Promise<void>;
  getRepository(id: string): Promise<Repository | undefined>;
  listRepositories(): Promise<Repository[]>;
  saveSnapshot(snapshot: RepositorySnapshot): Promise<void>;
  getLatestSnapshot(
    repositoryId: string,
  ): Promise<RepositorySnapshot | undefined>;
  getSnapshot(snapshotId: string): Promise<RepositorySnapshot | undefined>;
}

/**
 * Event store: inserts are idempotent on `fingerprint`
 * (duplicate fingerprints for the same type+repo must not create duplicates).
 */
export interface EventStore {
  /** Returns true if inserted, false if duplicate fingerprint skipped. */
  append(event: DeveloperEvent): Promise<boolean>;
  getById(eventId: string): Promise<DeveloperEvent | undefined>;
  listByRepository(
    repositoryId: string,
    options?: { type?: string; since?: string; limit?: number },
  ): Promise<DeveloperEvent[]>;
  findByFingerprint(
    fingerprint: string,
  ): Promise<DeveloperEvent | undefined>;
}

export interface ScanRunStore {
  create(run: ScanRun): Promise<void>;
  update(run: ScanRun): Promise<void>;
  get(id: string): Promise<ScanRun | undefined>;
  listRecent(limit?: number): Promise<ScanRun[]>;
  /** Interrupted STARTED runs for crash recovery. */
  listIncomplete(): Promise<ScanRun[]>;
}

export interface TodoStore {
  upsert(marker: TodoMarker): Promise<void>;
  get(id: string): Promise<TodoMarker | undefined>;
  findByFingerprint(
    repositoryId: string,
    fingerprint: string,
  ): Promise<TodoMarker | undefined>;
  listByRepository(
    repositoryId: string,
    options?: { status?: string },
  ): Promise<TodoMarker[]>;
}

export interface HealthStore {
  upsertCheck(check: HealthCheck): Promise<void>;
  getCheck(id: string): Promise<HealthCheck | undefined>;
  listChecks(repositoryId: string): Promise<HealthCheck[]>;
  /** Enabled checks only — health runner never auto-discovers scripts. */
  listEnabledChecks(repositoryId: string): Promise<HealthCheck[]>;
  saveRun(run: HealthRun): Promise<void>;
  getRun(id: string): Promise<HealthRun | undefined>;
  listRuns(
    healthCheckId: string,
    options?: { limit?: number },
  ): Promise<HealthRun[]>;
  /** Delete oldest runs beyond keepLimit for a check (retention). */
  pruneRuns(healthCheckId: string, keepLimit: number): Promise<number>;
}

export interface TechnologyStore {
  upsert(fact: TechnologyFact): Promise<void>;
  get(id: string): Promise<TechnologyFact | undefined>;
  findByFingerprint(
    repositoryId: string,
    fingerprint: string,
  ): Promise<TechnologyFact | undefined>;
  listByRepository(
    repositoryId: string,
    options?: { status?: string },
  ): Promise<TechnologyFact[]>;
  /** Mark fact removed (provenance retained). */
  markRemoved(
    repositoryId: string,
    fingerprint: string,
    removedAt: string,
  ): Promise<TechnologyFact | undefined>;
}

/** Aggregate facade optional for DI kernel wiring later. */
export interface PersistencePorts {
  repositories: RepositoryStore;
  events: EventStore;
  scanRuns: ScanRunStore;
  todos: TodoStore;
  health: HealthStore;
  technologies: TechnologyStore;
  retention: RetentionStore;
}
