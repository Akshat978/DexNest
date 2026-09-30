/**
 * The only way GhostOS reads the event log.
 *
 * It wraps `EventLog.query` and refuses - before the log is touched - any
 * query that does not name exactly the allowed stream, module and types
 * (domain/privacy.ts). What comes back is projected to repository, sha and
 * time; nothing else from an event leaves this file.
 */

import type { EventLog } from '@dexnest/foundation';
import { projectCommit, refuseEventRead, type CommitSample, type EventReadRequest } from '../domain/privacy.ts';

export class RefusedReadError extends Error {
  constructor(reason: string) {
    super(`GhostOS refused an event read: ${reason}`);
    this.name = 'RefusedReadError';
  }
}

export interface AllowedEventQuery extends EventReadRequest {
  afterSeq?: number;
  subject?: string;
  limit: number;
}

export interface AllowedEventPage {
  commits: CommitSample[];
  /** The last seq in the page, including events that did not project (so the cursor still moves). */
  lastSeq: number | null;
  /** Rows in the page before projection. Fewer than the limit means the end. */
  rows: number;
}

export interface AllowedEventReader {
  query(q: AllowedEventQuery): AllowedEventPage;
  /** The newest allowed event's seq, or null. */
  latestSeq(q: EventReadRequest): number | null;
}

export function createAllowedEventReader(log: Pick<EventLog, 'query'>): AllowedEventReader {
  const check = (q: EventReadRequest) => {
    const refusal = refuseEventRead(q);
    if (refusal) throw new RefusedReadError(refusal);
  };
  return {
    query(q) {
      check(q);
      const limit = Math.max(1, Math.min(Math.floor(q.limit), 5000));
      const events = log.query({ stream: q.stream, module: q.module, types: q.types, subject: q.subject, afterSeq: q.afterSeq, limit, order: 'asc', orderBy: 'seq' });
      const commits: CommitSample[] = [];
      for (const event of events) {
        const c = projectCommit(event);
        if (c) commits.push(c);
      }
      return { commits, lastSeq: events.length ? (events[events.length - 1]?.seq ?? null) : null, rows: events.length };
    },
    latestSeq(q) {
      check(q);
      const [newest] = log.query({ stream: q.stream, module: q.module, types: q.types, limit: 1, order: 'desc', orderBy: 'seq' });
      return newest ? newest.seq : null;
    },
  };
}
