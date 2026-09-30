import { describe, expect, it } from 'vitest';
import {
  AUDIT_SUMMARIES,
  defaultObjectOsSettings,
  normalizeObjectOsSettings,
  OBJECT_EVENT_TYPES,
  PUBLIC_OBJECT_FIELDS,
  toPublicObject,
  type ObjectRecord,
} from '../domain/index.ts';
import { OBJ, T0 } from './fixtures.ts';

describe('settings', () => {
  it('reminders are off by default; only a literal true turns them on', () => {
    expect(defaultObjectOsSettings().reminders.enabled).toBe(false);
    expect(normalizeObjectOsSettings(null).reminders.enabled).toBe(false);
    expect(normalizeObjectOsSettings({ reminders: { enabled: 'yes' } }).reminders.enabled).toBe(false);
    expect(normalizeObjectOsSettings({ reminders: { enabled: true } }).reminders.enabled).toBe(true);
  });
});

describe('events and audit', () => {
  it('are all in the object namespace; audit summaries are fixed text', () => {
    expect(OBJECT_EVENT_TYPES.every((t) => t.startsWith('object.'))).toBe(true);
    expect(new Set(OBJECT_EVENT_TYPES).size).toBe(OBJECT_EVENT_TYPES.length);
    for (const summary of Object.values(AUDIT_SUMMARIES)) expect(summary).toMatch(/^ObjectOS [a-z ]+$/);
  });
});

describe('read API for other modules', () => {
  const full: ObjectRecord = { id: OBJ, name: 'Printer', category: 'printer', make: 'Prusa', model: 'MK4', serial: 'SECRET-SERIAL', location: 'desk', status: 'active', notes: 'SECRET notes', tags: ['workshop'], parentId: null, photoFileId: 'fil_secret01', createdAt: T0, updatedAt: T0 };

  it('never carries serial numbers, notes or files', () => {
    const pub = toPublicObject(full);
    expect(Object.keys(pub).sort()).toEqual([...PUBLIC_OBJECT_FIELDS].sort());
    expect(JSON.stringify(pub)).not.toMatch(/SECRET|fil_/);
    for (const f of ['serial', 'notes', 'photoFileId']) expect(PUBLIC_OBJECT_FIELDS as readonly string[]).not.toContain(f);
  });

  it('does not share the tag list with the record', () => {
    const pub = toPublicObject(full);
    pub.tags.push('changed');
    expect(full.tags).toEqual(['workshop']);
  });
});
