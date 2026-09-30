/**
 * What GhostOS may read, as data. PLAN.md section 5 is the prose version;
 * this is the one the code and the tests use.
 *
 * From Developer Intelligence the adapter reads repository records,
 * technology facts, and event_log rows of exactly one type from exactly one
 * stream and module. Any other query is refused before it reaches the log.
 * Nothing else in DexNest is readable: no vault, finance, journal,
 * clipboard, captures, receipts or any other module's content.
 */

export const DI_EVENT_READ = {
  stream: 'dev',
  module: 'developer_intelligence',
  types: ['dev.commit.observed'],
} as const;

/** Modules and streams GhostOS never reads, named so tests can plant bait in them. */
export const NEVER_READ = [
  'vault',
  'finance',
  'journal',
  'clipboard',
  'captures',
  'receipts',
  'drop',
  'search',
  'ocr',
  'voice',
  'calendar',
  'timetable',
  'heatmap',
  'audit',
  'autopilot',
] as const;

export interface EventReadRequest {
  stream?: string;
  module?: string;
  types?: readonly string[];
}

/** Null when allowed; otherwise why not. The query must name the stream, the module and only allowed types. */
export function refuseEventRead(q: EventReadRequest): string | null {
  if (q.stream !== DI_EVENT_READ.stream) return `GhostOS reads only the ${DI_EVENT_READ.stream} stream`;
  if (q.module !== DI_EVENT_READ.module) return `GhostOS reads only events from ${DI_EVENT_READ.module}`;
  if (!q.types || q.types.length === 0) return 'GhostOS names the event types it reads';
  const allowed: readonly string[] = DI_EVENT_READ.types;
  const other = q.types.find((t) => !allowed.includes(t));
  return other === undefined ? null : `GhostOS does not read ${other}`;
}

/** Just the envelope and the two payload fields GhostOS uses. The subject line is never kept. */
export interface CommitSample {
  seq: number;
  repositoryId: string;
  sha: string;
  at: string;
}

export interface EventEnvelopeLike {
  seq: number;
  type: string;
  stream: string;
  module: string | null;
  subject: string | null;
  payload: unknown;
}

const SHA = /^[0-9a-f]{7,64}$/;

/**
 * The one place GhostOS reads an event payload. It re-checks the envelope
 * (a reader that let something else through would still be stopped here)
 * and takes `sha` and `authorDate`, nothing more.
 */
export function projectCommit(event: EventEnvelopeLike): CommitSample | null {
  if (event.type !== DI_EVENT_READ.types[0] || event.stream !== DI_EVENT_READ.stream || event.module !== DI_EVENT_READ.module) return null;
  if (!event.subject) return null;
  const p = event.payload;
  if (typeof p !== 'object' || p === null) return null;
  const sha = (p as { sha?: unknown }).sha;
  const at = (p as { authorDate?: unknown }).authorDate;
  if (typeof sha !== 'string' || !SHA.test(sha) || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  return { seq: event.seq, repositoryId: event.subject, sha, at: new Date(Date.parse(at)).toISOString() };
}
