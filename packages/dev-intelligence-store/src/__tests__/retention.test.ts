import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSqlitePersistence } from '../testing.ts';

const migrationsDir = resolve(process.cwd(), '../../migrations');

describe('retention foundations', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('bounds raw health output and prunes runs/diagnostics via policy hooks', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sqlite-ret-'));
    const p = await createSqlitePersistence({
      dbPath: join(dir, 't.sqlite'),
      migrationsDir,
    });

    await p.retention.setPolicy({
      schemaVersion: 1,
      maxHealthOutputBytes: 32,
      maxHealthRunsPerCheck: 2,
      maxDiagnosticAgeMs: 1,
      maxDiagnosticRows: 2,
    });

    const now = new Date().toISOString();
    await p.health.upsertCheck({
      schemaVersion: 1,
      id: 'hc1',
      repositoryId: 'r1',
      name: 'c',
      enabled: true,
      cwd: '/tmp',
      domain: 'wsl',
      argv: ['true'],
      timeoutMs: 1000,
      maxStdoutBytes: 10_000,
      maxStderrBytes: 10_000,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < 5; i++) {
      await p.health.saveRun({
        schemaVersion: 1,
        id: `run_${i}`,
        healthCheckId: 'hc1',
        repositoryId: 'r1',
        status: 'PASS',
        startedAt: `2026-01-0${i + 1}T00:00:00Z`,
        finishedAt: `2026-01-0${i + 1}T00:00:01Z`,
        stdoutPreview: 'Y'.repeat(200),
        stderrPreview: 'Z'.repeat(200),
      });
    }

    await p.retention.saveDiagnostic({
      schemaVersion: 1,
      id: 'd1',
      scanRunId: 's1',
      kind: 'test',
      message: 'old',
      createdAt: '2020-01-01T00:00:00Z',
    });
    await p.retention.saveDiagnostic({
      schemaVersion: 1,
      id: 'd2',
      scanRunId: 's1',
      kind: 'test',
      message: 'new',
      createdAt: now,
    });
    await p.retention.saveDiagnostic({
      schemaVersion: 1,
      id: 'd3',
      scanRunId: 's1',
      kind: 'test',
      message: 'newer',
      createdAt: now,
    });

    const result = await p.retention.applyRetention();
    expect(result.healthRunsDeleted).toBeGreaterThanOrEqual(3);
    expect(result.healthOutputsTrimmed).toBeGreaterThan(0);
    expect(result.diagnosticsDeleted).toBeGreaterThan(0);

    const runs = await p.health.listRuns('hc1', { limit: 50 });
    expect(runs.length).toBeLessThanOrEqual(2);
    for (const r of runs) {
      expect(Buffer.byteLength(r.stdoutPreview ?? '', 'utf8')).toBeLessThanOrEqual(
        32,
      );
    }

    const diags = await p.retention.listDiagnostics({ limit: 50 });
    expect(diags.length).toBeLessThanOrEqual(2);

    p.close();
  });
});
