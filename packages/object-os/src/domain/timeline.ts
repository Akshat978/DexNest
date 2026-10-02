/**
 * One history per object, newest first: everything that happened to it.
 * Built by the store from its own tables; `title` and `detail` are for the
 * owner's own view and never leave ObjectOS.
 */

export const TIMELINE_KINDS = ['created', 'change', 'state', 'schedule', 'maintenance', 'modification', 'settings', 'measurement', 'file', 'purchase'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export interface TimelineItem {
  kind: TimelineKind;
  /** The row it points at (a record id, a sequence number, or the object id). */
  refId: string;
  at: string;
  title: string;
  detail: string;
}

export const TIMELINE_PAGE = { defaultLimit: 50, maxLimit: 200 } as const;
