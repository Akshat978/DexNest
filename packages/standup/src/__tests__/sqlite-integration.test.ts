/**
 * Real sqlite file DB integration: history survives restart; lifecycle continues.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createStandupService } from '../service.js';
import {
  makeRepo,
  makeSnapshot,
  mutableClock,
} from './fakes.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('sqlite standup integration', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('10. history survives restart: reopen DB, list reports, lifecycle ONGOING not NEW', async () => {
    dir = await mkdtemp(join(tmpdir(), 'standup-int-'));
    const dbPath = join(dir, 'standup.sqlite');
    const clock = mutableClock('2026-09-20T12:00:00.000Z');

    const p1 = await createSqlitePersistence({ dbPath, migrationsDir });
    await p1.repositories.upsertRepository(makeRepo('r1'));
    await p1.repositories.saveSnapshot(
      makeSnapshot('r1', {
        conflicts: 1,
        samplePaths: ['conflict.ts'],
        capturedAt: '2026-09-20T11:00:00.000Z',
      }),
    );

    let nonce = 0;
    const svc1 = createStandupService({
      persistence: p1,
      standupStore: p1.standup,
      clock,
      timezone: 'UTC',
      manualNonce: () => String(++nonce),
    });

    const first = await svc1.generateStandup({ triggerKind: 'manual' });
    const fp = first.items.find(
      (i) => i.lifecycle === 'NEW' && i.issueIdentity?.kind === 'conflict',
    )?.issueIdentity?.fingerprint;
    expect(fp).toBeTruthy();

    p1.close();

    // Reopen
    const p2 = await createSqlitePersistence({ dbPath, migrationsDir });
    const listed = await p2.standup.listReports({ limit: 10 });
    expect(listed.reports.length).toBeGreaterThanOrEqual(1);
    expect(listed.reports.some((r) => r.id === first.id)).toBe(true);

    const open = await p2.standup.getIssueStates();
    expect(open.some((s) => s.identity.fingerprint === fp)).toBe(true);

    // Advance clock; conflicts still present → ONGOING
    clock.set('2026-09-21T12:00:00.000Z');
    await p2.repositories.saveSnapshot(
      makeSnapshot('r1', {
        conflicts: 1,
        samplePaths: ['conflict.ts'],
        capturedAt: '2026-09-21T11:00:00.000Z',
      }),
    );

    const svc2 = createStandupService({
      persistence: p2,
      standupStore: p2.standup,
      clock,
      timezone: 'UTC',
      manualNonce: () => String(++nonce),
    });
    const second = await svc2.generateStandup({ triggerKind: 'manual' });
    const ongoing = second.items.find(
      (i) =>
        i.lifecycle === 'ONGOING' && i.issueIdentity?.fingerprint === fp,
    );
    expect(ongoing).toBeTruthy();
    expect(
      second.items.some(
        (i) =>
          i.lifecycle === 'NEW' && i.issueIdentity?.fingerprint === fp,
      ),
    ).toBe(false);

    // Migration 010 applied
    const mig = p2.db.get<{ version: number; name: string }>(
      `SELECT version, name FROM dexnest_module_migrations WHERE module = 'standup' AND version = 10`,
    );
    expect(mig?.name).toBe('standup');

    p2.close();
  });

  it('scheduled save is idempotent in sqlite (INSERT OR IGNORE)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'standup-idem-'));
    const dbPath = join(dir, 't.sqlite');
    const clock = mutableClock('2026-09-20T12:00:00.000Z');
    const p = await createSqlitePersistence({ dbPath, migrationsDir });
    await p.repositories.upsertRepository(makeRepo('r1'));
    await p.repositories.saveSnapshot(makeSnapshot('r1'));

    const svc = createStandupService({
      persistence: p,
      standupStore: p.standup,
      clock,
      timezone: 'UTC',
    });
    const occ = 'standup:2026-09-20:since_last_standup';
    const a = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId: occ,
    });
    const b = await svc.generateStandup({
      triggerKind: 'scheduled',
      occurrenceId: occ,
    });
    expect(a.id).toBe(b.id);
    const all = await p.standup.listReports({});
    expect(all.reports.filter((r) => r.occurrenceId === occ)).toHaveLength(1);
    p.close();
  });
});
