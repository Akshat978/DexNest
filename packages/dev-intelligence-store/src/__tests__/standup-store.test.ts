import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '../testing.ts';
import type { StandupReport } from '@dexnest/dev-intelligence-contracts';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('standup store', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('applies 010_standup migration and saveReport is idempotent on occurrence', async () => {
    dir = await mkdtemp(join(tmpdir(), 'standup-store-'));
    const p = await createSqlitePersistence({
      dbPath: join(dir, 't.sqlite'),
      migrationsDir,
    });

    const mig = p.db.get<{ name: string }>(
      `SELECT name FROM dexnest_module_migrations WHERE module = 'standup' AND version = 10`,
    );
    expect(mig?.name).toBe('standup');

    const report: StandupReport = {
      id: 'rpt1',
      occurrenceId: 'occ-sched-1',
      triggerKind: 'scheduled',
      generatedAt: '2026-09-20T12:00:00.000Z',
      timeWindow: {
        kind: 'since_last_standup',
        from: '2026-09-19T12:00:00.000Z',
        to: '2026-09-20T12:00:00.000Z',
        timezone: 'UTC',
      },
      schemaVersion: 1,
      sections: [],
      items: [
        {
          id: 'item1',
          section: 'Changed',
          title: 't',
          evidence: [],
        },
      ],
    };

    const saved = await p.standup.saveReport(report);
    expect(saved.id).toBe('rpt1');
    const dup = await p.standup.saveReport({
      ...report,
      id: 'rpt1-dup',
      items: [{ id: 'other', section: 'Changed', title: 'x', evidence: [] }],
    });
    expect(dup.id).toBe('rpt1');
    expect(dup.items).toHaveLength(1);

    const latest = await p.standup.getLatestSuccessfulReport();
    expect(latest?.id).toBe('rpt1');

    await p.standup.upsertIssueStates([
      {
        identity: { id: 'i1', fingerprint: 'fp1', kind: 'conflict' },
        lifecycle: 'ONGOING',
        firstObservedAt: '2026-09-20T12:00:00.000Z',
        lastObservedAt: '2026-09-20T12:00:00.000Z',
        firstReportId: 'rpt1',
      },
    ]);
    const states = await p.standup.getIssueStates();
    expect(states).toHaveLength(1);
    expect(states[0]!.identity.fingerprint).toBe('fp1');

    p.close();
  });
});
