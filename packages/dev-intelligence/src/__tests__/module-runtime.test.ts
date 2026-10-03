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
  type LinkedRepository,
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

  async function setup(options: { paused?: boolean; timers?: SchedulerTimers; dbName?: string; linked?: () => LinkedRepository[] } = {}) {
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
      ...(options.linked ? { linkedRepositories: options.linked } : {}),
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

  it('collapses duplicate triggers into one scan, and timer scans into one Standup a day', async () => {
    const timers = heldTimers();
    const { module, persistence } = await setup({ timers });
    module.updateSettings({ enabled: true, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });
    await module.start();
    const scans = () => persistence.db.all('SELECT id FROM dev_scan_runs').length;
    const reports = (kind: string) =>
      Number(persistence.db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM standup_reports WHERE trigger_kind = '${kind}'`)[0]!.n);

    // The timer fires again the same day: still one scheduled Standup, the same one.
    timers.fireAll();
    await waitFor(async () => scans() === 1 && reports('scheduled') === 1);
    const morning = (await module.latestStandup())!;
    timers.fireAll();
    await settle();
    await waitFor(async () => !(await module.status()).scanning);
    expect(reports('scheduled')).toBe(1);
    expect((await module.latestStandup())!.id).toBe(morning.id);

    // Two requests at once join one run.
    const before = scans();
    const [a, b] = await Promise.all([module.scanNow(), module.scanNow()]);
    expect(a?.scanRun.id).toBe(b?.scanRun.id);
    expect(scans()).toBe(before + 1);
    module.stop();
  });

  it('a scan the user asks for writes a fresh Standup that covers the same day', async () => {
    const timers = heldTimers();
    const { module, persistence } = await setup({ timers });
    module.updateSettings({ enabled: true, roots: [{ path: fixture!.workspace, domain: nativeDomain }] });
    await module.start();
    timers.fireAll();
    await waitFor(async () => (await module.latestStandup()) !== null && !(await module.status()).scanning);
    const morning = (await module.latestStandup())!;
    const changedIn = (report: { sections: readonly { kind: string; items: readonly { title: string }[] }[] }) =>
      report.sections.find((s) => s.kind === 'Changed')!.items.map((i) => i.title);
    expect(changedIn(morning), 'the first scan is a baseline: history is not news').toEqual(['No activity in window']);

    // Work, then "Scan now".
    await writeFile(join(fixture!.app, 'feature.ts'), 'export const f = 1;\n', 'utf8');
    git(fixture!.app, ['add', 'feature.ts']);
    git(fixture!.app, ['commit', '-m', 'app: the feature']);
    const first = await module.scanNow();
    const afterWork = (await module.latestStandup())!;
    expect(afterWork.id, 'not the morning report again').not.toBe(morning.id);
    expect(first?.standupReportId).toBe(afterWork.id);
    expect(afterWork.triggerKind).toBe('manual');
    expect(afterWork.timeWindow.from, "starts where the day's report started").toBe(morning.timeWindow.from);
    expect(changedIn(afterWork)).toContain('app: the feature');

    // Asking again keeps the whole day in view, not just the minutes since.
    const second = await module.scanNow();
    const again = (await module.latestStandup())!;
    expect(second?.standupReportId).toBe(again.id);
    expect(again.id).not.toBe(afterWork.id);
    expect(again.timeWindow.from).toBe(morning.timeWindow.from);
    expect(changedIn(again)).toContain('app: the feature');

    // "Write a new Standup" does the same without scanning.
    const written = await module.generateStandup();
    expect(written.timeWindow.from).toBe(morning.timeWindow.from);
    expect(changedIn(written)).toContain('app: the feature');
    expect(persistence.db.all(`SELECT id FROM standup_reports WHERE trigger_kind = 'scheduled'`)).toHaveLength(1);
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

  it("follows the host's project list: scanned without being configured, under the project's name", async () => {
    fixture = await buildFixture();
    let projects: LinkedRepository[] = [
      { path: fixture.app, domain: nativeDomain, displayName: 'My App' },
      { path: fixture.dexnest, domain: nativeDomain, displayName: 'dexnest' },
      // A project inside DexNest's data is left out, and nobody is told it was refused.
      { path: join(fixture.dataRoot, 'files'), domain: nativeDomain, displayName: 'private' },
    ];
    const { module, settings } = await setup({ linked: () => projects });
    // On, with no folder configured at all.
    module.updateSettings({ enabled: true });
    expect(settings.value.roots).toEqual([]);

    const first = await module.scanNow();
    expect(first?.scanRun.state).toBe('COMPLETED');
    expect(first?.refusedRoots).toEqual([]);
    expect((await module.listRepositories()).map((r) => r.displayName).sort()).toEqual(['My App', 'dexnest']);
    expect((await module.status()).repositories).toBe(2);

    // Renamed in Projects: the next scan carries the new name.
    projects = projects.map((p) => (p.displayName === 'My App' ? { ...p, displayName: 'Storefront' } : p));
    await module.scanNow();
    expect((await module.listRepositories()).map((r) => r.displayName).sort()).toEqual(['Storefront', 'dexnest']);

    // Archived or removed in Projects: it stops being followed, and stops appearing.
    projects = projects.filter((p) => p.displayName !== 'Storefront');
    await module.scanNow();
    expect((await module.listRepositories()).map((r) => r.displayName)).toEqual(['dexnest']);
    expect((await module.status()).repositories).toBe(1);
    const report = (await module.latestStandup())!;
    const states = report.sections.find((s) => s.kind === 'RepositoryState')!.items.map((i) => i.title);
    expect(states).toEqual(['dexnest @ main']);
    module.stop();
  });

  it('a project keeps its name when a watched folder also reaches it', async () => {
    fixture = await buildFixture();
    const { module } = await setup({ linked: () => [{ path: fixture!.app, domain: nativeDomain, displayName: 'My App' }] });
    // The folder above both repositories is watched too; the walk finds `app` again.
    module.updateSettings({ enabled: true, roots: [{ path: fixture.workspace, domain: nativeDomain }] });
    await module.scanNow();
    expect((await module.listRepositories()).map((r) => r.displayName).sort()).toEqual(['DeskNest', 'My App']);
    module.stop();
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
