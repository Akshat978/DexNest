/**
 * Developer Intelligence as DexNest runs it: the module runtime over the
 * shared foundation - one database, the shared event log, the host scheduler
 * and DexNest's data boundary - against real repositories and real git.
 *
 * The fixture is the shape that matters: a DexNest checkout whose local-data
 * folder holds private notes with TODO lines, and a second private folder
 * outside any repository that holds a Git repository of its own. Pointing
 * Developer Intelligence at the folder above both must surface the code and
 * nothing from the data.
 *
 * The checkout deliberately does NOT gitignore local-data. With the ignore
 * rule in place Git alone would hide it, and these tests would pass without
 * the boundary doing anything; the boundary has to hold when that rule is lost.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createDataBoundary,
  createHostScheduler,
  type ModuleSettings,
  type SchedulerTimers,
} from '@dexnest/foundation';
import { createSqlitePersistence, type TestPersistence } from '@dexnest/dev-intelligence-store/testing';
import {
  createDevIntelligenceModule,
  defaultDevIntelligenceSettings,
  type DevIntelligenceSettings,
} from '../module/runtime.js';
import { cleanup, createGitRepo, createTempWorkspace, linkDirectory, nativeDomain } from './fixture-repos.js';

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function memorySettings(initial = defaultDevIntelligenceSettings()): ModuleSettings<DevIntelligenceSettings> & {
  value: DevIntelligenceSettings;
} {
  const store = {
    value: initial,
    read: () => store.value,
    write: (next: DevIntelligenceSettings) => {
      store.value = next;
    },
  };
  return store;
}

/** Timers that fire only when a test says so. */
function heldTimers(): SchedulerTimers & { fireAll(): void; count(): number } {
  const pending = new Map<number, () => void>();
  let seq = 0;
  return {
    set(callback) {
      seq += 1;
      pending.set(seq, callback);
      return seq;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
    fireAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, callback] of due) callback();
    },
    count: () => pending.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface Fixture {
  workspace: string;
  dexnest: string;
  dataRoot: string;
  /** Another sensitive root, outside any repository. */
  privateRoot: string;
  app: string;
}

async function buildFixture(): Promise<Fixture> {
  const workspace = realpathSync.native(await createTempWorkspace('di-module-'));

  const dexnest = (await createGitRepo(workspace, 'DeskNest')).path;
  await writeFile(join(dexnest, '.gitignore'), 'node_modules/\n', 'utf8');
  await mkdir(join(dexnest, 'src'), { recursive: true });
  await writeFile(join(dexnest, 'src', 'shell.ts'), '// TODO: code todo in DexNest itself\n', 'utf8');
  git(dexnest, ['add', '.gitignore', 'src/shell.ts']);
  git(dexnest, ['commit', '-m', 'shell']);

  // Private data: notes with TODO lines and a source file; and, in a second
  // private root outside any repository, a Git repository of its own.
  const dataRoot = join(dexnest, 'local-data');
  await mkdir(join(dataRoot, 'files', 'vault'), { recursive: true });
  await writeFile(join(dataRoot, 'files', 'vault', 'journal.md'), 'TODO: call the bank about the loan\n', 'utf8');
  // The leak the Electron smoke test caught: a file here recorded as
  // technology evidence by a detector that walked the tree on its own.
  await mkdir(join(dataRoot, 'files', 'speech', 'temp'), { recursive: true });
  await writeFile(join(dataRoot, 'files', 'speech', 'temp', 'sidecar.py'), 'print("private")\n', 'utf8');

  const privateRoot = join(workspace, 'private');
  await createGitRepo(privateRoot, 'wallet');

  const app = (await createGitRepo(join(workspace, 'projects'), 'app')).path;
  await writeFile(join(app, 'index.ts'), '// TODO: app todo\n', 'utf8');
  git(app, ['add', 'index.ts']);
  git(app, ['commit', '-m', 'index']);

  return { workspace, dexnest, dataRoot, privateRoot, app };
}

describe('Developer Intelligence module runtime', () => {
  let fixture: Fixture | undefined;
  let persistence: TestPersistence | undefined;

  afterEach(async () => {
    persistence?.close();
    persistence = undefined;
    if (fixture) await cleanup(fixture.workspace);
    fixture = undefined;
  });

  async function setup(options: { paused?: boolean; timers?: SchedulerTimers; dbName?: string } = {}) {
    fixture ??= await buildFixture();
    persistence = await createSqlitePersistence({ dbPath: join(fixture.workspace, 'db', options.dbName ?? 'dexnest.sqlite') });
    const settings = memorySettings();
    const audit: Array<{ summary: string; status: string }> = [];
    const scheduler = createHostScheduler({
      timers: options.timers ?? heldTimers(),
      isPaused: (job) => Boolean(job.heavy) && options.paused === true,
    });
    const module = createDevIntelligenceModule({
      database: persistence.database,
      events: persistence.eventLog,
      boundary: createDataBoundary({
        dataRoot: fixture.dataRoot,
        extraSensitiveRoots: [fixture.privateRoot],
        realpath: realpathSync.native,
      }),
      scheduler,
      settings,
      timezone: 'UTC',
      audit: (summary, _metadata, status) => {
        audit.push({ summary, status });
      },
    });
    return { module, settings, scheduler, audit, fixture, persistence };
  }

  it('does nothing until turned on', async () => {
    const timers = heldTimers();
    const { module } = await setup({ timers });
    await module.start();
    expect(timers.count()).toBe(0);
    expect((await module.status()).enabled).toBe(false);
    expect(await module.listRepositories()).toEqual([]);
  });

  it("refuses a root inside DexNest's data, by path and through a junction", async () => {
    const { module, fixture } = await setup();
    expect(() =>
      module.updateSettings({ enabled: true, roots: [{ path: join(fixture.dataRoot, 'files'), domain: nativeDomain }] }),
    ).toThrow(/private data/);

    const alias = join(fixture.workspace, 'innocent-looking');
    await linkDirectory(fixture.dataRoot, alias);
    expect(() => module.updateSettings({ enabled: true, roots: [{ path: alias, domain: nativeDomain }] })).toThrow(
      /private data/,
    );
    expect(module.getSettings().enabled).toBe(false);
  });

  it('scans the code around the data root and nothing inside it', async () => {
    const { module, audit, persistence } = await setup();
    module.updateSettings({ enabled: false, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });

    const outcome = await module.scanNow();
    expect(outcome?.scanRun.state).toBe('COMPLETED');

    const repos = await module.listRepositories();
    expect(repos.map((r) => r.displayName).sort()).toEqual(['DeskNest', 'app']);

    const todos = [];
    for (const repo of repos) todos.push(...(await persistence.todos.listByRepository(repo.id)));
    const texts = todos.map((t) => t.text);
    expect(texts.some((t) => t.includes('code todo in DexNest itself'))).toBe(true);
    expect(texts.some((t) => t.includes('app todo'))).toBe(true);
    expect(texts.some((t) => t.includes('bank'))).toBe(false);

    // Nothing recorded anywhere names a file inside either private root -
    // checked by name, because evidence paths are repository-relative
    // ("local-data/..."), not absolute. An absolute-path check missed exactly
    // that leak once.
    const technologies = [];
    for (const repo of repos) technologies.push(...(await persistence.technologies.listByRepository(repo.id)));
    expect(technologies.length).toBeGreaterThan(0);
    const events = persistence.eventLog.query({ stream: 'dev', limit: 1000 });
    expect(events.length).toBeGreaterThan(0);
    const recorded = JSON.stringify([events.map((e) => e.payload), todos, technologies, repos]).toLowerCase();
    expect(recorded).not.toContain('local-data');
    expect(recorded).not.toContain('journal.md');
    expect(recorded).not.toContain('sidecar');
    expect(recorded).not.toContain('wallet');

    expect(outcome?.standupReportId).toBeTruthy();
    expect(audit.map((a) => a.status)).toEqual(['success']);
  });

  it('collapses duplicate triggers into one scan and one Standup a day', async () => {
    const { module, persistence } = await setup();
    module.updateSettings({ enabled: true, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });

    // Two manual triggers at once join one run.
    const [a, b] = await Promise.all([module.scanNow(), module.scanNow()]);
    expect(a?.scanRun.id).toBe(b?.scanRun.id);
    const runs = persistence.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM dev_scan_runs');
    expect(Number(runs[0]!.n)).toBe(1);

    // A second scan the same day reuses the day's scheduled Standup.
    const c = await module.scanNow();
    expect(c?.scanRun.id).not.toBe(a?.scanRun.id);
    expect(c?.standupReportId).toBe(a?.standupReportId);
    const scheduled = persistence.db.all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM standup_reports WHERE trigger_kind = 'scheduled'`,
    );
    expect(Number(scheduled[0]!.n)).toBe(1);
    module.stop();
  });

  it('keeps what it learned across a restart, and a rescan adds no duplicate facts', async () => {
    const first = await setup();
    first.module.updateSettings({ enabled: false, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });
    const scanned = await first.module.scanNow();
    const discovered = first.persistence.eventLog.query({ stream: 'dev', types: ['dev.repo.discovered'] }).length;
    const todosBefore = first.persistence.db.all('SELECT id FROM dev_todos').length;
    first.persistence.close();
    persistence = undefined;

    const second = await setup();
    second.module.updateSettings({ enabled: false, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });
    await second.module.start();
    expect((await second.module.latestStandup())?.id).toBe(scanned?.standupReportId);
    expect((await second.module.listRepositories()).length).toBe(2);

    await second.module.scanNow();
    expect(second.persistence.eventLog.query({ stream: 'dev', types: ['dev.repo.discovered'] }).length).toBe(discovered);
    expect(second.persistence.db.all('SELECT id FROM dev_todos').length).toBe(todosBefore);
  });

  it('holds scheduled scans off in Performance Mode, but not a scan the user asks for', async () => {
    const timers = heldTimers();
    const { module, persistence } = await setup({ paused: true, timers });
    module.updateSettings({ enabled: true, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });
    await module.start();
    expect(timers.count()).toBe(1);

    timers.fireAll(); // the startup slot
    await settle();
    expect(persistence.db.all('SELECT id FROM dev_scan_runs')).toHaveLength(0);

    const outcome = await module.scanNow();
    expect(outcome?.scanRun.state).toBe('COMPLETED');
    await waitFor(async () => persistence.db.all('SELECT id FROM dev_scan_runs').length === 1);
    module.stop();
    expect(timers.count()).toBe(0);
  });
});
