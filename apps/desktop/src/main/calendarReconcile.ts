/**
 * Making one calendar out of two that both changed.
 *
 * Once DexNest can write to Google, three things stop being hypothetical: an
 * event we pushed comes back on the next sync and must not become a second
 * copy; an event deleted on a phone has to disappear here; and an event edited
 * in both places needs a losing side.
 *
 * All of it decided here, with no clock, no network and no file access,
 * because one of the outcomes is deleting something the operator wrote. A rule
 * that can only be exercised by waiting fifteen minutes with a real account is
 * a rule nobody checks twice.
 */

/** A DexNest-owned event, as far as reconciliation cares. */
export interface LocalEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  notes?: string | null;
  sourceModule: string;
  remoteId?: string | null;
  remoteAccountId?: string | null;
  /** When DexNest last pushed it. */
  remoteSyncedAt?: string | null;
  updatedAt: string;
}

/** An event as it came back from the provider. */
export interface RemoteEvent {
  /** The provider's own id, without DexNest's "google:account:" prefix. */
  remoteId: string;
  accountId: string;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  notes?: string | null;
}

export interface ReconcileInput {
  local: readonly LocalEvent[];
  remote: readonly RemoteEvent[];
  accountId: string;
  /** The window the fetch covered, inclusive. */
  windowFrom: string;
  windowTo: string;
  /** False when the provider had more pages than were read. */
  complete: boolean;
}

export interface ReconcileResult {
  /** Provider ids that are echoes of local events and must not be shown twice. */
  echoes: string[];
  /** Local events to delete, because they are gone on the provider. */
  deletions: LocalEvent[];
  /** Local events to update from the provider's version. */
  adoptions: Array<{ event: LocalEvent; from: RemoteEvent }>;
  /** Why deletion propagation was skipped, when it was. */
  heldBack: string | null;
}

/** Whether two versions of the same event differ in anything DexNest stores. */
export function differs(local: LocalEvent, remote: RemoteEvent): boolean {
  return local.title !== remote.title
    || local.date !== remote.date
    || local.allDay !== remote.allDay
    || (local.startTime ?? null) !== (remote.startTime ?? null)
    || (local.endTime ?? null) !== (remote.endTime ?? null)
    || (local.notes ?? null) !== (remote.notes ?? null);
}

/**
 * What to hide, what to delete, and what to take from the other side.
 *
 * Deletion is the dangerous half and is guarded three ways. It only applies to
 * events DexNest itself pushed to this account, so nothing typed and never
 * shared can be taken away by a sync. It only applies inside the window that
 * was actually fetched, since an event next year is absent for a reason that
 * has nothing to do with anyone deleting it. And it is abandoned entirely when
 * the fetch was incomplete, because a truncated page looks exactly like a
 * calendar whose later events were removed.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const byRemoteId = new Map(input.remote.map(event => [event.remoteId, event]));

  const linked = input.local.filter(event =>
    Boolean(event.remoteId)
    && event.remoteAccountId === input.accountId
    // A provider event is not ours to reconcile: it came from that side and
    // has no local original to compare against.
    && event.sourceModule !== "google"
    && event.sourceModule !== "microsoft");

  const echoes: string[] = [];
  const adoptions: Array<{ event: LocalEvent; from: RemoteEvent }> = [];
  const missing: LocalEvent[] = [];

  for (const event of linked) {
    const remote = byRemoteId.get(event.remoteId!);
    if (!remote) {
      missing.push(event);
      continue;
    }

    // Present on both sides, so the provider's copy is the same event and
    // showing it alongside would be showing one thing twice.
    echoes.push(remote.remoteId);

    if (!differs(event, remote)) continue;

    // Both changed. The side that changed after the last push wins, which for
    // a local edit means DexNest already holds the newer version and will push
    // it again. Ties go to the provider: remoteSyncedAt is written at the
    // moment of a successful push, so an equal timestamp means nothing was
    // edited locally afterwards.
    const editedLocallySincePush = Boolean(event.remoteSyncedAt) && event.updatedAt > event.remoteSyncedAt!;
    if (!editedLocallySincePush) {
      adoptions.push({ event, from: remote });
    }
  }

  if (!input.complete) {
    return {
      echoes,
      deletions: [],
      adoptions,
      heldBack: "The calendar returned more events than were read, so absent events were not treated as deleted."
    };
  }

  const deletions = missing.filter(event => event.date >= input.windowFrom && event.date <= input.windowTo);
  return { echoes, deletions, adoptions, heldBack: null };
}

/** The provider's version of an event, merged onto the local record. */
export function adopt(event: LocalEvent, remote: RemoteEvent, now: string): LocalEvent {
  return {
    ...event,
    title: remote.title,
    date: remote.date,
    startTime: remote.startTime ?? null,
    endTime: remote.endTime ?? null,
    allDay: remote.allDay,
    notes: remote.notes ?? null,
    updatedAt: now,
    // Moved forward with the adoption. Without this the adopted values would
    // look like a local edit newer than the last push on the very next sync,
    // and DexNest would push them straight back - a loop that never settles.
    remoteSyncedAt: now
  };
}
