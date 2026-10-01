/**
 * Everything the owner types - and every row an import file brings - passes
 * through here first. Each parser returns the value or a list of errors that
 * name fields, never echo values.
 */

import { isRecordId, parseObjectId } from './ids.ts';
import { isMoney, parseMoney } from './money.ts';
import { normalizeDate, normalizeTimestamp } from './time.ts';
import {
  CATEGORIES,
  FILE_ROLES,
  INTERVAL_UNITS,
  STATUSES,
  type Category,
  type FileRole,
  type IntervalUnit,
  type Money,
  type ObjectStatus,
  type PartUse,
  type ScheduleRule,
} from './types.ts';

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const LIMITS = {
  name: 120,
  short: 120,
  serial: 80,
  location: 120,
  notes: 20_000,
  tags: 20,
  tag: 40,
  stateKey: 60,
  stateValue: 500,
  title: 200,
  longText: 5_000,
  settingsKeys: 500,
  settingsKey: 120,
  settingsValue: 2_000,
  unit: 20,
  measurementKey: 60,
  fits: 200,
  partsPerEntry: 50,
  interval: 100_000,
  quantity: 1_000_000,
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const done = <T>(value: T, errors: string[]): Parsed<T> => (errors.length ? { ok: false, errors } : { ok: true, value });

// C0 controls other than tab, newline and carriage return.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function text(v: unknown, field: string, max: number, errors: string[], required = false): string {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') {
    errors.push(`${field} must be text`);
    return '';
  }
  const t = v.trim();
  if (required && !t) errors.push(`${field} is required`);
  if (t.length > max) errors.push(`${field} is longer than ${max} characters`);
  if (CONTROL.test(t)) errors.push(`${field} contains control characters`);
  return t;
}

/** A single line: no line breaks either. */
function line(v: unknown, field: string, max: number, errors: string[], required = false): string {
  const t = text(v, field, max, errors, required);
  if (/[\r\n\t]/.test(t)) errors.push(`${field} must be one line`);
  return t;
}

function stamp(v: unknown, field: string, errors: string[], fallback: string | null): string | null {
  if (v === undefined || v === null || v === '') return fallback;
  const t = normalizeTimestamp(v);
  if (t === null) errors.push(`${field} must be a date and time`);
  return t ?? fallback;
}

function date(v: unknown, field: string, errors: string[]): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = normalizeDate(v);
  if (d === null) errors.push(`${field} must be a date (YYYY-MM-DD)`);
  return d;
}

function num(v: unknown, field: string, errors: string[], opts: { min: number; max: number; integer?: boolean; required?: boolean }): number | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) errors.push(`${field} is required`);
    return null;
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < opts.min || n > opts.max || (opts.integer && !Number.isInteger(n))) {
    errors.push(`${field} must be ${opts.integer ? 'a whole number' : 'a number'} from ${opts.min} to ${opts.max}`);
    return null;
  }
  return n;
}

function oneOf<T extends string>(v: unknown, all: readonly T[], field: string, errors: string[], fallback: T): T {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'string' && (all as readonly string[]).includes(v)) return v as T;
  errors.push(`${field} must be one of: ${all.join(', ')}`);
  return fallback;
}

function objectRef(v: unknown, field: string, errors: string[], required: boolean): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${field} is required`);
    return null;
  }
  const id = parseObjectId(v);
  if (!id) errors.push(`${field} is not an object id`);
  return id;
}

function recordRef(kind: Parameters<typeof isRecordId>[0], v: unknown, field: string, errors: string[]): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (!isRecordId(kind, v)) {
    errors.push(`${field} is invalid`);
    return null;
  }
  return v;
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;

export function parseTags(v: unknown, errors: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push('tags must be a list');
    return [];
  }
  if (v.length > LIMITS.tags) errors.push(`tags has more than ${LIMITS.tags} items`);
  const out: string[] = [];
  for (const item of v.slice(0, LIMITS.tags)) {
    const tag = typeof item === 'string' ? item.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    if (!tag || tag.length > LIMITS.tag || !TAG.test(tag)) {
      errors.push(`tags: each is 1-${LIMITS.tag} letters, digits, spaces, dots, dashes or underscores`);
      continue;
    }
    if (!out.includes(tag)) out.push(tag);
  }
  return out.sort();
}

function money(v: unknown, field: string, errors: string[]): Money | null {
  if (v === undefined || v === null || v === '') return null;
  if (isMoney(v)) return v;
  if (isObj(v)) {
    const m = parseMoney(v.amount, v.currency);
    if (m) return m;
  }
  errors.push(`${field} must be an amount and a three-letter currency code`);
  return null;
}

// --- objects -----------------------------------------------------------------------

export interface ObjectDraft {
  id: string | null;
  name: string;
  category: Category;
  make: string;
  model: string;
  serial: string;
  location: string;
  status: ObjectStatus;
  notes: string;
  tags: string[];
  parentId: string | null;
}

export function parseObjectInput(input: unknown): Parsed<ObjectDraft> {
  if (!isObj(input)) return { ok: false, errors: ['object must be an object'] };
  const errors: string[] = [];
  const draft: ObjectDraft = {
    id: objectRef(input.id, 'id', errors, false),
    name: line(input.name, 'name', LIMITS.name, errors, true),
    category: oneOf(input.category, CATEGORIES, 'category', errors, 'other'),
    make: line(input.make, 'make', LIMITS.short, errors),
    model: line(input.model, 'model', LIMITS.short, errors),
    serial: line(input.serial, 'serial', LIMITS.serial, errors),
    location: line(input.location, 'location', LIMITS.location, errors),
    status: oneOf(input.status, STATUSES, 'status', errors, 'active'),
    notes: text(input.notes, 'notes', LIMITS.notes, errors),
    tags: parseTags(input.tags, errors),
    parentId: objectRef(input.parentId, 'parentId', errors, false),
  };
  if (draft.id && draft.parentId === draft.id) errors.push('an object cannot be inside itself');
  return done(draft, errors);
}

export function parseStatus(v: unknown): Parsed<ObjectStatus> {
  const errors: string[] = [];
  const status = oneOf(v, STATUSES, 'status', errors, 'active');
  if (v === undefined || v === null || v === '') errors.push('status is required');
  return done(status, errors);
}

// --- state -------------------------------------------------------------------------

/** An empty value removes the fact. */
export interface StateInput {
  objectId: string;
  key: string;
  value: string;
}

export function parseStateInput(input: unknown): Parsed<StateInput> {
  if (!isObj(input)) return { ok: false, errors: ['state must be an object'] };
  const errors: string[] = [];
  const value: StateInput = {
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    key: line(input.key, 'key', LIMITS.stateKey, errors, true),
    value: line(input.value, 'value', LIMITS.stateValue, errors),
  };
  return done(value, errors);
}

// --- maintenance ---------------------------------------------------------------------

export interface ScheduleDraft {
  id: string | null;
  objectId: string;
  title: string;
  rule: ScheduleRule;
  startsAt: string;
  startReading: number | null;
  active: boolean;
  notes: string;
}

function parseRule(v: unknown, errors: string[]): ScheduleRule {
  const fallback: ScheduleRule = { kind: 'time', every: 1, unit: 'months' };
  if (!isObj(v)) {
    errors.push('rule is required');
    return fallback;
  }
  const every = num(v.every, 'rule.every', errors, { min: 1, max: LIMITS.interval, integer: v.kind === 'time', required: true }) ?? 1;
  if (v.kind === 'time') return { kind: 'time', every, unit: oneOf<IntervalUnit>(v.unit, INTERVAL_UNITS, 'rule.unit', errors, 'months') };
  if (v.kind === 'usage') return { kind: 'usage', every, measurementKey: line(v.measurementKey, 'rule.measurementKey', LIMITS.measurementKey, errors, true) };
  errors.push('rule.kind must be time or usage');
  return fallback;
}

export function parseScheduleInput(input: unknown, now: string): Parsed<ScheduleDraft> {
  if (!isObj(input)) return { ok: false, errors: ['schedule must be an object'] };
  const errors: string[] = [];
  const rule = parseRule(input.rule, errors);
  const draft: ScheduleDraft = {
    id: recordRef('schedule', input.id, 'id', errors),
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    title: line(input.title, 'title', LIMITS.title, errors, true),
    rule,
    startsAt: stamp(input.startsAt, 'startsAt', errors, now) ?? now,
    startReading: rule.kind === 'usage' ? num(input.startReading, 'startReading', errors, { min: -1e12, max: 1e12 }) : null,
    active: input.active !== false,
    notes: text(input.notes, 'notes', LIMITS.longText, errors),
  };
  return done(draft, errors);
}

export interface MaintenanceDraft {
  objectId: string;
  scheduleId: string | null;
  title: string;
  doneAt: string;
  doneBy: string;
  cost: Money | null;
  notes: string;
  usageReading: number | null;
  parts: PartUse[];
}

export function parseMaintenanceInput(input: unknown, now: string): Parsed<MaintenanceDraft> {
  if (!isObj(input)) return { ok: false, errors: ['maintenance must be an object'] };
  const errors: string[] = [];
  const parts: PartUse[] = [];
  if (input.parts !== undefined && input.parts !== null) {
    if (!Array.isArray(input.parts) || input.parts.length > LIMITS.partsPerEntry) errors.push(`parts must be a list of at most ${LIMITS.partsPerEntry}`);
    else
      for (const p of input.parts) {
        const partId = isObj(p) ? recordRef('part', p.partId, 'parts.partId', errors) : null;
        const quantity = isObj(p) ? num(p.quantity, 'parts.quantity', errors, { min: 0.001, max: LIMITS.quantity, required: true }) : null;
        if (!partId || quantity === null) {
          if (!isObj(p)) errors.push('parts: each is { partId, quantity }');
          continue;
        }
        if (parts.some((x) => x.partId === partId)) errors.push('parts: a part is listed twice');
        else parts.push({ partId, quantity });
      }
  }
  const draft: MaintenanceDraft = {
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    scheduleId: recordRef('schedule', input.scheduleId, 'scheduleId', errors),
    title: line(input.title, 'title', LIMITS.title, errors, true),
    doneAt: stamp(input.doneAt, 'doneAt', errors, now) ?? now,
    doneBy: line(input.doneBy, 'doneBy', LIMITS.short, errors),
    cost: money(input.cost, 'cost', errors),
    notes: text(input.notes, 'notes', LIMITS.longText, errors),
    usageReading: num(input.usageReading, 'usageReading', errors, { min: -1e12, max: 1e12 }),
    parts,
  };
  if (draft.doneAt > now) errors.push('doneAt is in the future');
  return done(draft, errors);
}

// --- modifications, settings -----------------------------------------------------------

export interface ModificationDraft {
  id: string | null;
  objectId: string;
  title: string;
  doneAt: string;
  reason: string;
  before: string;
  after: string;
  reversible: boolean;
  revertedAt: string | null;
}

export function parseModificationInput(input: unknown, now: string): Parsed<ModificationDraft> {
  if (!isObj(input)) return { ok: false, errors: ['modification must be an object'] };
  const errors: string[] = [];
  const draft: ModificationDraft = {
    id: recordRef('modification', input.id, 'id', errors),
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    title: line(input.title, 'title', LIMITS.title, errors, true),
    doneAt: stamp(input.doneAt, 'doneAt', errors, now) ?? now,
    reason: text(input.reason, 'reason', LIMITS.longText, errors),
    before: text(input.before, 'before', LIMITS.longText, errors),
    after: text(input.after, 'after', LIMITS.longText, errors),
    reversible: input.reversible === true,
    revertedAt: stamp(input.revertedAt, 'revertedAt', errors, null),
  };
  if (draft.revertedAt && !draft.reversible) errors.push('only a reversible modification can be reverted');
  if (draft.revertedAt && draft.revertedAt < draft.doneAt) errors.push('revertedAt is before doneAt');
  if (draft.doneAt > now) errors.push('doneAt is in the future');
  if (draft.revertedAt && draft.revertedAt > now) errors.push('revertedAt is in the future');
  return done(draft, errors);
}

export interface SettingsDraft {
  objectId: string;
  name: string;
  values: Record<string, string>;
  note: string;
}

export function parseSettingsValues(v: unknown, errors: string[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!isObj(v)) {
    errors.push('values must be an object of key: value');
    return {};
  }
  const entries = Object.entries(v);
  if (entries.length > LIMITS.settingsKeys) errors.push(`values has more than ${LIMITS.settingsKeys} keys`);
  for (const [key, value] of entries.slice(0, LIMITS.settingsKeys)) {
    const k = key.trim();
    if (!k || k.length > LIMITS.settingsKey || CONTROL.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') {
      errors.push('values: each key is 1-120 characters of text');
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      errors.push('values: each value is text, a number or true/false');
      continue;
    }
    const s = String(value);
    if (s.length > LIMITS.settingsValue || CONTROL.test(s)) {
      errors.push(`values: each value is at most ${LIMITS.settingsValue} characters`);
      continue;
    }
    out[k] = s;
  }
  // A plain object again, with sorted keys, so snapshots compare and serialise the same way.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function parseSettingsInput(input: unknown): Parsed<SettingsDraft> {
  if (!isObj(input)) return { ok: false, errors: ['settings must be an object'] };
  const errors: string[] = [];
  const draft: SettingsDraft = {
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    name: line(input.name, 'name', LIMITS.title, errors, true),
    values: parseSettingsValues(input.values, errors),
    note: text(input.note, 'note', LIMITS.longText, errors),
  };
  return done(draft, errors);
}

// --- parts -----------------------------------------------------------------------------

export interface PartDraft {
  id: string | null;
  name: string;
  partNumber: string;
  supplier: string;
  unit: string;
  quantity: number;
  lowStockAt: number | null;
  notes: string;
  fits: string[];
}

export function parsePartInput(input: unknown): Parsed<PartDraft> {
  if (!isObj(input)) return { ok: false, errors: ['part must be an object'] };
  const errors: string[] = [];
  const fits: string[] = [];
  if (input.fits !== undefined && input.fits !== null) {
    if (!Array.isArray(input.fits) || input.fits.length > LIMITS.fits) errors.push(`fits must be a list of at most ${LIMITS.fits} object ids`);
    else
      for (const f of input.fits) {
        const id = objectRef(f, 'fits', errors, true);
        if (id && !fits.includes(id)) fits.push(id);
      }
  }
  const draft: PartDraft = {
    id: recordRef('part', input.id, 'id', errors),
    name: line(input.name, 'name', LIMITS.name, errors, true),
    partNumber: line(input.partNumber, 'partNumber', LIMITS.short, errors),
    supplier: line(input.supplier, 'supplier', LIMITS.short, errors),
    unit: line(input.unit, 'unit', LIMITS.unit, errors) || 'pcs',
    quantity: num(input.quantity, 'quantity', errors, { min: 0, max: LIMITS.quantity }) ?? 0,
    lowStockAt: num(input.lowStockAt, 'lowStockAt', errors, { min: 0, max: LIMITS.quantity }),
    notes: text(input.notes, 'notes', LIMITS.longText, errors),
    fits: fits.sort(),
  };
  return done(draft, errors);
}

export const STOCK_REASONS = ['restocked', 'used', 'corrected'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export interface StockAdjustment {
  partId: string;
  delta: number;
  reason: StockReason;
}

export function parseStockAdjustment(input: unknown): Parsed<StockAdjustment> {
  if (!isObj(input)) return { ok: false, errors: ['adjustment must be an object'] };
  const errors: string[] = [];
  const delta = num(input.delta, 'delta', errors, { min: -LIMITS.quantity, max: LIMITS.quantity, required: true }) ?? 0;
  if (delta === 0) errors.push('delta must not be zero');
  const value: StockAdjustment = {
    partId: recordRef('part', input.partId, 'partId', errors) ?? (errors.push('partId is required'), ''),
    delta,
    reason: oneOf(input.reason, STOCK_REASONS, 'reason', errors, 'corrected'),
  };
  return done(value, errors);
}

/** Stock never goes below zero. */
export function applyStock(quantity: number, delta: number): Parsed<number> {
  const next = Math.round((quantity + delta) * 1000) / 1000;
  return next < 0 ? { ok: false, errors: ['not enough in stock'] } : { ok: true, value: next };
}

// --- measurements, purchase, files -------------------------------------------------------

export interface MeasurementDraft {
  objectId: string;
  key: string;
  value: number;
  unit: string;
  measuredAt: string;
  note: string;
}

export function parseMeasurementInput(input: unknown, now: string): Parsed<MeasurementDraft> {
  if (!isObj(input)) return { ok: false, errors: ['measurement must be an object'] };
  const errors: string[] = [];
  const draft: MeasurementDraft = {
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    key: line(input.key, 'key', LIMITS.measurementKey, errors, true),
    value: num(input.value, 'value', errors, { min: -1e12, max: 1e12, required: true }) ?? 0,
    unit: line(input.unit, 'unit', LIMITS.unit, errors),
    measuredAt: stamp(input.measuredAt, 'measuredAt', errors, now) ?? now,
    note: text(input.note, 'note', LIMITS.longText, errors),
  };
  if (draft.measuredAt > now) errors.push('measuredAt is in the future');
  return done(draft, errors);
}

/** A key keeps one unit: "tyre pressure" in bar stays in bar. */
export function unitConflict(existingUnit: string | null, unit: string): string | null {
  return existingUnit !== null && existingUnit !== unit ? `this measurement is recorded in "${existingUnit}"` : null;
}

export interface PurchaseDraft {
  objectId: string;
  purchasedOn: string | null;
  price: Money | null;
  shop: string;
  warrantyUntil: string | null;
}

export function parsePurchaseInput(input: unknown): Parsed<PurchaseDraft> {
  if (!isObj(input)) return { ok: false, errors: ['purchase must be an object'] };
  const errors: string[] = [];
  const draft: PurchaseDraft = {
    objectId: objectRef(input.objectId, 'objectId', errors, true) ?? '',
    purchasedOn: date(input.purchasedOn, 'purchasedOn', errors),
    price: money(input.price, 'price', errors),
    shop: line(input.shop, 'shop', LIMITS.short, errors),
    warrantyUntil: date(input.warrantyUntil, 'warrantyUntil', errors),
  };
  if (draft.purchasedOn && draft.warrantyUntil && draft.warrantyUntil < draft.purchasedOn) errors.push('warrantyUntil is before purchasedOn');
  return done(draft, errors);
}

export function parseFileRole(v: unknown): Parsed<FileRole> {
  const errors: string[] = [];
  const role = oneOf(v, FILE_ROLES, 'role', errors, 'other');
  return done(role, errors);
}

