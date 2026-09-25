/**
 * Rel: duplicate Standup trigger remains idempotent (EC-033 / Rel checklist).
 */
import { describe, it, expect } from 'vitest';
import { createStandupService } from '../service.js';
import {
  createFakePersistence,
  createFakeStandupStore,
  makeRepo,
  makeSnapshot,
  mutableClock,
} from './fakes.js';

describe('Rel duplicate Standup trigger', () => {
  it('two identical scheduled triggers yield one consequential report id', async () => {
    const clock = mutableClock('2026-09-23T18:00:00.000Z');
    const store = createFakeStandupStore();
    const persistence = createFakePersistence({
      repositories: [makeRepo('r1'), makeRepo('r2')],
      snapshots: [makeSnapshot('r1'), makeSnapshot('r2')],
    });
    const svc = createStandupService({
      persistence,
      standupStore: store,
      clock,
      timezone: 'America/Regina',
      manualNonce: () => 'rel1',
    });

    const occurrenceId = 'occ_rel_dup_1';
    const a = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId,
      window: { kind: 'last_24_hours' },
    });
    const b = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId,
      window: { kind: 'last_24_hours' },
    });
    expect(b.id).toBe(a.id);
    const listed = await store.listReports({ occurrenceId, limit: 10 });
    expect(listed.reports).toHaveLength(1);
    expect(listed.total).toBe(1);
  });
});
