/**
 * Developer events, stored in DexNest's shared event log.
 *
 * The standalone build had its own developer_events table. Inside DexNest the
 * envelope maps onto event_log instead, so there is one event table for every
 * module and nothing to keep in step between two:
 *
 *   eventId        -> id
 *   type           -> type                 (dev.* types unchanged)
 *   repositoryId   -> subject
 *   occurredAt     -> occurred_at
 *   observedAt     -> recorded time
 *   source         -> source
 *   sourceIdentity -> source_identity
 *   fingerprint    -> idempotency_key, as "developer_intelligence:<fingerprint>"
 *   schemaVersion  -> schema_version
 *
 * Idempotency is unchanged in meaning: the standalone table had a unique
 * fingerprint across all developer events, and the idempotency key is unique
 * across the whole log. A replayed observation records nothing and reports
 * `false`, exactly as before.
 */

import { withTransaction, type DexNestEvent, type EventLog } from '@dexnest/foundation';
import type { DeveloperEvent, EventStore } from '@dexnest/dev-intelligence-contracts';
import type { StoreDb } from '../db.ts';

export const DEV_MODULE = 'developer_intelligence';
export const DEV_STREAM = 'dev';
const KEY_PREFIX = `${DEV_MODULE}:`;

function keyFor(fingerprint: string): string {
  return `${KEY_PREFIX}${fingerprint}`;
}

function toDeveloperEvent(event: DexNestEvent): DeveloperEvent {
  const key = event.idempotencyKey ?? '';
  return {
    schemaVersion: 1,
    eventId: event.id,
    type: event.type as DeveloperEvent['type'],
    repositoryId: event.subject ?? '',
    occurredAt: event.occurredAt,
    observedAt: event.recordedAt,
    source: event.source,
    sourceIdentity: event.sourceIdentity ?? '',
    fingerprint: key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key,
    payload: event.payload,
  };
}

export function createEventStore(db: StoreDb, log: EventLog): EventStore {
  const ours = (event: DexNestEvent | undefined) =>
    event && event.module === DEV_MODULE && event.stream === DEV_STREAM ? event : undefined;

  return {
    async append(event: DeveloperEvent): Promise<boolean> {
      // The event and the commit index it feeds are written together. Before,
      // they were two independent statements, so a crash between them left a
      // commit event with no index row, or the reverse.
      return withTransaction(db.sql, () => {
        const { inserted } = log.append({
          id: event.eventId,
          type: event.type,
          stream: DEV_STREAM,
          module: DEV_MODULE,
          subject: event.repositoryId,
          source: event.source,
          sourceIdentity: event.sourceIdentity,
          occurredAt: event.occurredAt,
          recordedAt: event.observedAt,
          schemaVersion: event.schemaVersion,
          idempotencyKey: keyFor(event.fingerprint),
          payload: event.payload ?? null,
        });

        if (event.type === 'dev.commit.observed') {
          const payload = event.payload as { sha?: string; subject?: string; authorDate?: string } | null;
          if (payload?.sha) {
            db.run(
              `INSERT OR IGNORE INTO dev_observed_commits (
                repository_id, sha, subject, author_date, first_observed_at
              ) VALUES (?, ?, ?, ?, ?)`,
              [event.repositoryId, payload.sha, payload.subject ?? null, payload.authorDate ?? null, event.observedAt],
            );
          }
        }
        return inserted;
      });
    },

    async getById(eventId: string): Promise<DeveloperEvent | undefined> {
      const event = ours(log.get(eventId));
      return event ? toDeveloperEvent(event) : undefined;
    },

    async listByRepository(
      repositoryId: string,
      options?: { type?: string; since?: string; limit?: number },
    ): Promise<DeveloperEvent[]> {
      // "since" means observed since, which is recorded time - the semantics
      // Standup's "what changed since the last report" was built on.
      return log
        .query({
          stream: DEV_STREAM,
          module: DEV_MODULE,
          subject: repositoryId,
          ...(options?.type ? { types: [options.type] } : {}),
          ...(options?.since ? { recordedSince: options.since } : {}),
          orderBy: 'recorded',
          order: 'desc',
          limit: options?.limit ?? 500,
        })
        .map(toDeveloperEvent);
    },

    async findByFingerprint(fingerprint: string): Promise<DeveloperEvent | undefined> {
      const event = ours(log.findByIdempotencyKey(keyFor(fingerprint)));
      return event ? toDeveloperEvent(event) : undefined;
    },
  };
}
