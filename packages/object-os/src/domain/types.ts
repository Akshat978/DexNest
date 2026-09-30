/**
 * ObjectOS data model. See docs/modules/object_os/PLAN.md section 6.
 *
 * Every row belongs to one object (parts may fit several). Times are ISO
 * timestamps in UTC; calendar dates (purchase, warranty) are YYYY-MM-DD.
 * Money is integer minor units with an ISO 4217 code.
 */

export const CATEGORIES = ['printer', 'computer', 'appliance', 'tool', 'vehicle', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ['active', 'stored', 'broken', 'lent_out', 'sold', 'disposed'] as const;
export type ObjectStatus = (typeof STATUSES)[number];

export interface ObjectRecord {
  /** Short id, 8 Crockford base32 characters, canonical upper case without the dash. */
  id: string;
  name: string;
  category: Category;
  make: string;
  model: string;
  serial: string;
  location: string;
  status: ObjectStatus;
  notes: string;
  tags: string[];
  /** The object this one is a component of. */
  parentId: string | null;
  /** An attached file with role `photo`. */
  photoFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Money {
  /** Minor units (cents). */
  amount: number;
  /** ISO 4217, e.g. EUR. */
  currency: string;
}

/** One current-state fact: "firmware: 2.3.1". */
export interface StateFact {
  objectId: string;
  key: string;
  value: string;
  updatedAt: string;
}

export const INTERVAL_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

/** Maintenance by time ("every 6 months") or by a usage counter ("every 200 print hours"). */
export type ScheduleRule =
  | { kind: 'time'; every: number; unit: IntervalUnit }
  | { kind: 'usage'; measurementKey: string; every: number };

export interface Schedule {
  id: string;
  objectId: string;
  title: string;
  rule: ScheduleRule;
  /** Time schedules count from here until the first completion. */
  startsAt: string;
  /** Usage schedules count from this reading until the first completion; null = the first reading. */
  startReading: number | null;
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartUse {
  partId: string;
  quantity: number;
}

export interface MaintenanceEntry {
  id: string;
  objectId: string;
  scheduleId: string | null;
  title: string;
  doneAt: string;
  doneBy: string;
  cost: Money | null;
  notes: string;
  /** The counter reading when it was done (for usage schedules). */
  usageReading: number | null;
  parts: PartUse[];
  createdAt: string;
}

export interface Modification {
  id: string;
  objectId: string;
  title: string;
  doneAt: string;
  reason: string;
  before: string;
  after: string;
  reversible: boolean;
  revertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A named, versioned configuration snapshot ("Slicer profile" v3). */
export interface SettingsSnapshot {
  id: string;
  objectId: string;
  name: string;
  version: number;
  values: Record<string, string>;
  note: string;
  createdAt: string;
}

export interface Part {
  id: string;
  name: string;
  partNumber: string;
  supplier: string;
  unit: string;
  quantity: number;
  lowStockAt: number | null;
  notes: string;
  /** Objects it fits. */
  fits: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Measurement {
  id: string;
  objectId: string;
  key: string;
  value: number;
  unit: string;
  measuredAt: string;
  note: string;
  createdAt: string;
}

export interface Purchase {
  objectId: string;
  purchasedOn: string | null;
  price: Money | null;
  shop: string;
  warrantyUntil: string | null;
  receiptFileId: string | null;
  updatedAt: string;
}

export const FILE_ROLES = ['manual', 'photo', 'receipt', 'model', 'config', 'other'] as const;
export type FileRole = (typeof FILE_ROLES)[number];

/** An attached file: a copy in files/objects/<object id>/, never a reference elsewhere. */
export interface FileRecord {
  id: string;
  objectId: string;
  role: FileRole;
  /** What the owner sees: the original name, sanitised. */
  name: string;
  /** The file name inside the object's folder. */
  storedName: string;
  sizeBytes: number;
  /** Decided from the extension only; the contents are never parsed. */
  type: string;
  sha256: string;
  addedAt: string;
}

/** A field change kept for history. */
export interface ObjectChange {
  objectId: string;
  field: 'status' | 'location' | 'parent';
  from: string | null;
  to: string | null;
  at: string;
}
