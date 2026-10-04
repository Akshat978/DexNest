/**
 * What the scanner reports must be what happened:
 *  - a TODO is a comment someone wrote, not the word appearing somewhere;
 *  - what a repository already held when first inspected is history, not news;
 *  - a push or a pull is seen wherever it was made.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CommitObservedPayload, RefTransferPayload } from '@dexnest/dev-intelligence-contracts';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { parseReflog, readCommitHistory } from '../git/readonly-git.js';
import { extractMarkersFromText, looseMarkerFingerprints, scanTodoCandidates } from '../todo/scan.js';
import { reconcileTodos } from '../todo/lifecycle.js';
import { cleanup, createGitRepo, createTempWorkspace, gitFiles, gitIn } from './fixture-repos.js';

const migrationsDir = resolve(process.cwd(), '../../migrations');

const kinds = (text: string, file: string) => extractMarkersFromText(text, file).map((m) => `${m.kind}:${m.text}`);

describe('a TODO is a comment someone wrote', () => {
  it('counts the marker as the first word of a comment, in each language\'s own syntax', () => {
    expect(kinds('// TODO: ship it', 'a.ts')).toEqual(['TODO:ship it']);
    expect(kinds('  const x = 1; // FIXME rounding', 'a.ts')).toEqual(['FIXME:rounding']);
    expect(kinds('/* HACK: until the API lands */', 'a.ts')).toEqual(['HACK:until the API lands */']);
    expect(kinds('/**\n * TODO(akshat): split this file\n */', 'a.ts')).toEqual(['TODO:(akshat): split this file']);
    expect(kinds('# TODO: retry on 429', 'job.py')).toEqual(['TODO:retry on 429']);
    expect(kinds('x = 1  # XXX magic number', 'job.py')).toEqual(['XXX:magic number']);
    expect(kinds('<!-- TODO: alt text -->', 'page.html')).toEqual(['TODO:alt text -->']);
    expect(kinds('-- TODO: add an index', 'schema.sql')).toEqual(['TODO:add an index']);
    expect(kinds('/* FIXME: contrast */', 'site.css')).toEqual(['FIXME:contrast */']);
    expect(kinds('# TODO: pin the image', 'Dockerfile')).toEqual(['TODO:pin the image']);
  });

  it('does not count the word in a string, a test name, an identifier or a sentence', () => {
    for (const line of [
      "it('TODO created / renamed / resolved with fingerprint stability', async () => {",
      'description: "Run over the roots: repository state, TODOs, technologies and health checks.",',
      "await writeFile(file, '// TODO: first\\n');",
      'const TODO_LIMIT = 5;',
      'parts.push(`${n} open TODO${n === 1 ? "" : "s"}`);',
      '// counts open TODOs per repository',
      '// the TODO scanner reads tracked files',
      'const url = "http://example.com/TODO";',
    ]) {
      expect(kinds(line, 'a.ts'), line).toEqual([]);
    }
    expect(kinds('{ "note": "TODO: remove" }', 'data.json'), 'JSON has no comments').toEqual([]);
    expect(kinds('# TODO: python comment', 'a.ts'), 'a hash is not a TypeScript comment').toEqual([]);
  });

  it('in prose, counts a line that starts with the marker and a colon, not a mention', () => {
    expect(kinds('TODO: write the intro', 'README.md')).toEqual(['TODO:write the intro']);
    expect(kinds('- [ ] TODO: record a demo', 'README.md')).toEqual(['TODO:record a demo']);
    expect(kinds('## FIXME: broken link below', 'notes.md')).toEqual(['FIXME:broken link below']);
    expect(kinds('The scanner finds TODO: and FIXME: markers.', 'README.md')).toEqual([]);
    expect(kinds('- TODO markers are read from tracked files', 'README.md')).toEqual([]);
  });

  it('knows what the first detector would have recorded, so it can be withdrawn', () => {
    const text = "it('TODO created', () => {});\n// TODO: real one\n";
    expect(extractMarkersFromText(text, 'a.test.ts')).toHaveLength(1);
    expect(looseMarkerFingerprints(text)).toHaveLength(2);
  });
});

describe('scans', () => {
  let workspace = '';

  let close: (() => void) | undefined;

  afterEach(async () => {
    close?.();
    close = undefined;
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  async function setup(prefix: string, name: string, commits: number) {
    workspace = await createTempWorkspace(prefix);
    const repo = await createGitRepo(workspace, name, { commits });
    const persistence = await createSqlitePersistence({ dbPath: resolve(workspace, 'di.sqlite'), migrationsDir });
    close = () => persistence.close();
    const domains = createDomainRegistry();
    let scans = 0;
    const scan = () =>
      new ScanOrchestrator({
        persistence,
        domains,
        discovery: defaultDiscoveryConfig({ manualRepositories: [{ path: repo.path, domain: domains.defaultDomain() }] }),
        runHealth: false,
        sourceIdentity: `truth-${++scans}`,
      }).runScan();
    return { repo, persistence, scan };
  }

  it('a marker the old detector recorded wrongly is withdrawn, not reported as resolved', async () => {
    const { repo, persistence, scan } = await setup('di-truth-todo-', 'todo', 1);
    await mkdir(join(repo.path, 'src'), { recursive: true });
    await writeFile(join(repo.path, 'src', 'a.test.ts'), "it('TODO created / resolved', () => {});\n// TODO: a real one\n", 'utf8');

    // What the first detector left behind: two open markers, one of them not a marker.
    const first = await scanTodoCandidates({ repositoryId: 'seed', rootPath: repo.path, listFiles: gitFiles(repo.path) });
    expect(first.todos).toHaveLength(1);
    expect(first.retracted).toHaveLength(1);

    const outcome = await scan();
    const id = outcome.repositories[0]!.id;
    const seeded = await reconcileTodos({
      repositoryId: id,
      store: persistence.todos,
      observed: [
        ...first.todos,
        { kind: 'TODO', filePath: 'src/a.test.ts', line: 1, column: 5, text: "created / resolved', () => {});", fingerprint: first.retracted[0]! },
      ],
    });
    expect(seeded.open).toHaveLength(2);

    const again = await scanTodoCandidates({ repositoryId: id, rootPath: repo.path, listFiles: gitFiles(repo.path) });
    const result = await reconcileTodos({ repositoryId: id, store: persistence.todos, observed: again.todos, retracted: again.retracted });

    expect(result.retracted).toHaveLength(1);
    expect(result.resolved, 'nobody resolved anything').toHaveLength(0);
    expect(result.results.some((r) => r.action === 'resolved')).toBe(false);
    expect(await persistence.todos.listByRepository(id, { status: 'open' })).toHaveLength(1);
    expect(await persistence.todos.listByRepository(id, { status: 'resolved' })).toHaveLength(0);
    expect(await persistence.todos.listByRepository(id, { status: 'retracted' })).toHaveLength(1);
  });

  it('the first inspection is a baseline: its commits are marked as history, and it is stamped once', async () => {
    const { repo, persistence, scan } = await setup('di-truth-base-', 'base', 3);

    const first = await scan();
    const id = first.repositories[0]!.id;
    const stamped = (await persistence.repositories.getRepository(id))!.baselinedAt;
    expect(stamped, 'the repository records when its baseline finished').toBeTruthy();

    const history = await persistence.events.listByRepository(id, { type: 'dev.commit.observed' });
    expect(history).toHaveLength(3);
    for (const event of history) {
      expect((event.payload as CommitObservedPayload).baseline, 'already there when first seen').toBe(true);
      expect(event.observedAt <= stamped!, 'observed before the baseline closed').toBe(true);
    }

    await writeFile(join(repo.path, 'new.txt'), 'new work\n', 'utf8');
    gitIn(repo.path, ['add', 'new.txt']);
    gitIn(repo.path, ['commit', '-m', 'base: new work']);

    await scan();
    const all = await persistence.events.listByRepository(id, { type: 'dev.commit.observed' });
    const fresh = all.filter((event) => (event.payload as CommitObservedPayload).subject === 'base: new work');
    expect(all).toHaveLength(4);
    expect(fresh).toHaveLength(1);
    expect((fresh[0]!.payload as CommitObservedPayload).baseline, 'made after the baseline: news').toBeUndefined();
    expect(fresh[0]!.occurredAt, 'when it was made, in UTC, not when it was seen').toBe(new Date((fresh[0]!.payload as CommitObservedPayload).authorDate).toISOString());
    expect((await persistence.repositories.getRepository(id))!.baselinedAt, 'the baseline is never moved').toBe(stamped);
  });

  it('the whole history is read once: older than the latest few commits, as baseline, and never again', async () => {
    const { repo, persistence, scan } = await setup('di-truth-history-', 'history', 27);

    const first = await scan();
    const id = first.repositories[0]!.id;
    const read = (await persistence.repositories.getRepository(id))!.historyReadAt;
    expect(read, 'the repository records that its history was read').toBeTruthy();

    // A scan looks at the latest 20 commits; the history read brings the other 7.
    const history = await persistence.events.listByRepository(id, { type: 'dev.commit.observed' });
    expect(history).toHaveLength(27);
    expect(history.every((event) => (event.payload as CommitObservedPayload).baseline === true), 'history, not news').toBe(true);
    expect(new Set(history.map((event) => (event.payload as CommitObservedPayload).sha)).size).toBe(27);
    const oldest = history.find((event) => (event.payload as CommitObservedPayload).subject === 'history: commit 1')!;
    expect((oldest.payload as CommitObservedPayload).authorEmail, 'with its author, so "my commits" can be told apart').toBeTruthy();
    expect(JSON.stringify(history)).not.toContain('"body"');

    await writeFile(join(repo.path, 'new.txt'), 'new work\n', 'utf8');
    gitIn(repo.path, ['add', 'new.txt']);
    gitIn(repo.path, ['commit', '-m', 'history: new work']);
    await scan();
    const all = await persistence.events.listByRepository(id, { type: 'dev.commit.observed' });
    expect(all).toHaveLength(28);
    expect(all.filter((event) => (event.payload as CommitObservedPayload).baseline !== true).map((event) => (event.payload as CommitObservedPayload).subject)).toEqual(['history: new work']);
    expect((await persistence.repositories.getRepository(id))!.historyReadAt, 'read once').toBe(read);
  });

  it('a repository baselined before the history was read gets it on its next scan, and what was news stays news', async () => {
    const { repo, persistence, scan } = await setup('di-truth-backfill-', 'backfill', 25);
    const first = await scan();
    const id = first.repositories[0]!.id;
    // As the previous version left it: baselined, the latest 20 commits recorded, the history never read.
    persistence.database.prepare('UPDATE dev_repositories SET history_read_at = NULL WHERE id = ?').run([id]);
    for (let n = 1; n <= 5; n += 1) {
      persistence.database.prepare("DELETE FROM event_log WHERE type = 'dev.commit.observed' AND payload_json LIKE ?").run([`%backfill: commit ${n}"%`]);
    }
    expect(await persistence.events.listByRepository(id, { type: 'dev.commit.observed' })).toHaveLength(20);

    await writeFile(join(repo.path, 'new.txt'), 'new work\n', 'utf8');
    gitIn(repo.path, ['add', 'new.txt']);
    gitIn(repo.path, ['commit', '-m', 'backfill: new work']);
    await scan();

    const all = await persistence.events.listByRepository(id, { type: 'dev.commit.observed' });
    expect(all).toHaveLength(26);
    const news = all.filter((event) => (event.payload as CommitObservedPayload).baseline !== true);
    expect(news.map((event) => (event.payload as CommitObservedPayload).subject), 'the backfill did not turn a new commit into history').toEqual(['backfill: new work']);
    expect((await persistence.repositories.getRepository(id))!.historyReadAt).toBeTruthy();
  });

  it('a history longer than the cap is read up to the cap, in pages', async () => {
    const { repo } = await setup('di-truth-pages-', 'pages', 7);
    const domains = createDomainRegistry();
    const git = { cwd: repo.path, domain: domains.defaultDomain(), runner: domains.get(domains.defaultDomain()).processRunner };
    expect(await readCommitHistory(git, { pageSize: 3, max: 100 })).toMatchObject({ complete: true, truncated: false, commits: { length: 7 } });
    const capped = await readCommitHistory(git, { pageSize: 3, max: 6 });
    expect(capped).toMatchObject({ complete: true, truncated: true });
    expect(capped.commits.map((c) => c.subject)).toEqual(['pages: commit 7', 'pages: commit 6', 'pages: commit 5', 'pages: commit 4', 'pages: commit 3', 'pages: commit 2']);
  });

  it('leaving a project with nothing uncommitted is its own event, once, and never on a first look', async () => {
    const { repo, persistence, scan } = await setup('di-truth-clean-', 'tidy', 1);
    const first = await scan();
    const id = first.repositories[0]!.id;
    const cleaned = async () => (await persistence.events.listByRepository(id, { type: 'dev.working_tree.cleaned' })).length;
    expect(await cleaned(), 'clean when first seen: nothing was tidied').toBe(0);

    await writeFile(join(repo.path, 'wip.txt'), 'half done\n', 'utf8');
    await scan();
    expect(await cleaned(), 'still dirty').toBe(0);

    gitIn(repo.path, ['add', 'wip.txt']);
    gitIn(repo.path, ['commit', '-m', 'tidy: finish it']);
    await scan();
    expect(await cleaned()).toBe(1);
    await scan();
    expect(await cleaned(), 'seen clean again: still one').toBe(1);
    const [event] = await persistence.events.listByRepository(id, { type: 'dev.working_tree.cleaned' });
    expect(event!.payload, 'no payload: the type says it all').toEqual({});
  });

  it('a push and a pull are seen from the reflog, however they were made; none during the baseline', async () => {
    const { repo, persistence, scan } = await setup('di-truth-xfer-', 'work', 1);
    const remote = join(workspace, 'remote.git');
    gitIn(workspace, ['init', '--bare', '--initial-branch=main', 'remote.git']);
    gitIn(repo.path, ['remote', 'add', 'origin', remote]);
    gitIn(repo.path, ['push', '-u', 'origin', 'main']);

    const first = await scan();
    const id = first.repositories[0]!.id;
    expect(await persistence.events.listByRepository(id, { type: 'dev.push.observed' }), 'the earlier push is history').toHaveLength(0);

    // A push from the command line.
    await new Promise((r) => setTimeout(r, 1100));
    await writeFile(join(repo.path, 'feature.txt'), 'feature\n', 'utf8');
    gitIn(repo.path, ['add', 'feature.txt']);
    gitIn(repo.path, ['commit', '-m', 'work: feature']);
    gitIn(repo.path, ['push']);

    await scan();
    const pushes = await persistence.events.listByRepository(id, { type: 'dev.push.observed' });
    expect(pushes).toHaveLength(1);
    expect((pushes[0]!.payload as RefTransferPayload).ref).toBe('origin/main');
    expect((pushes[0]!.payload as RefTransferPayload).detail).toBe('update by push');

    // Reading the same reflog again adds nothing.
    await scan();
    expect(await persistence.events.listByRepository(id, { type: 'dev.push.observed' })).toHaveLength(1);

    // Someone else pushes; a pull from the command line brings it in.
    gitIn(workspace, ['clone', remote, 'other']);
    const other = join(workspace, 'other');
    await writeFile(join(other, 'theirs.txt'), 'theirs\n', 'utf8');
    gitIn(other, ['add', 'theirs.txt']);
    gitIn(other, ['commit', '-m', 'other: theirs']);
    gitIn(other, ['push']);
    await new Promise((r) => setTimeout(r, 1100));
    gitIn(repo.path, ['pull', '--ff-only']);

    await scan();
    const pulls = await persistence.events.listByRepository(id, { type: 'dev.pull.observed' });
    expect(pulls).toHaveLength(1);
    expect((pulls[0]!.payload as RefTransferPayload).ref).toBe('main');
    expect((pulls[0]!.payload as RefTransferPayload).detail).toMatch(/^pull/);
    expect(await persistence.events.listByRepository(id, { type: 'dev.push.observed' }), 'a fetch is not a push').toHaveLength(1);
  }, 60_000);
});

describe('reflog parsing', () => {
  it('reads commit, ref, time and subject; skips what it cannot read', () => {
    const out = [
      'aaa\x1frefs/remotes/origin/main@{2026-10-03T15:20:11+05:30}\x1fupdate by push\x1e',
      '\nbbb\x1fHEAD@{2026-10-03T09:00:00Z}\x1fpull: Fast-forward\x1e',
      '\nccc\x1fHEAD@{not a date}\x1fcommit: x\x1e',
      '\nbroken\x1e',
    ].join('');
    expect(parseReflog(out)).toEqual([
      { sha: 'aaa', ref: 'refs/remotes/origin/main', at: '2026-10-03T09:50:11.000Z', subject: 'update by push' },
      { sha: 'bbb', ref: 'HEAD', at: '2026-10-03T09:00:00.000Z', subject: 'pull: Fast-forward' },
    ]);
  });
});
