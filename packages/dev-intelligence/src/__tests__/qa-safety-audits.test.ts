/**
 * Phase 6 QA — safety audits (EC-028, EC-035, EC-036, EC-037).
 * Static + executable checks; builder claims are not accepted as PASS.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import type {
  ProcessInvocationRequest,
  ProcessRunnerPort,
} from '@dexnest/dev-intelligence-contracts';
import {
  FORBIDDEN_GIT_VERBS,
  assertReadOnlyGitArgv,
  isForbiddenGitVerb,
} from '../git/forbidden.js';
import { listDiscoveredScriptCandidates } from '../health/auto-discover.js';
import { runEnabledHealthChecks } from '../health/runner.js';
import { scanTodos, isSecretLikePath } from '../todo/scan.js';
import { LocalProcessRunner } from '../domain/local-process-runner.js';
import {
  cleanup,
  createGitRepo,
  createTempWorkspace, gitFiles } from './fixture-repos.js';

const SRC_ROOT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
);
const migrationsDir = resolve(process.cwd(), '../../migrations');

const FORBIDDEN_LIST = [
  'pull',
  'fetch',
  'push',
  'checkout',
  'reset',
  'clean',
  'merge',
  'rebase',
  'commit',
] as const;

async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules' || e.name === 'dist')
          continue;
        await walk(p);
      } else if (extname(e.name) === '.ts') {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

class RecordingRunner implements ProcessRunnerPort {
  readonly calls: ProcessInvocationRequest[] = [];
  private readonly inner = new LocalProcessRunner();
  async run(req: ProcessInvocationRequest) {
    this.calls.push(req);
    return this.inner.run(req);
  }
}

describe('QA safety audits (EC-028/035/036/037)', () => {
  let workspace = '';

  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('EC-037: forbidden git verb denylist covers required verbs', () => {
    for (const v of FORBIDDEN_LIST) {
      expect(isForbiddenGitVerb(v)).toBe(true);
      expect(() => assertReadOnlyGitArgv(['git', v])).toThrow(/forbidden/);
    }
    expect(FORBIDDEN_GIT_VERBS.has('pull')).toBe(true);
    expect(isForbiddenGitVerb('status')).toBe(false);
    expect(isForbiddenGitVerb('log')).toBe(false);
    expect(isForbiddenGitVerb('rev-parse')).toBe(false);
  });

  it('EC-037 audit: DI runtime src never spawns forbidden git verbs', async () => {
    const files = await collectTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    // Match argv-like constructions: 'git', 'fetch' or ["git","pull"] etc.
    const patterns = FORBIDDEN_LIST.map(
      (v) =>
        new RegExp(
          String.raw`(?:['"]git['"]\s*,\s*['"]${v}['"])|(?:argv:\s*\[[^\]]*'${v}')|(?:\[['"]git['"]\s*,\s*['"]${v}['"]])`,
          'i',
        ),
    );
    // Also catch template: git(['fetch' or args: ['fetch'
    const soft = FORBIDDEN_LIST.map(
      (v) =>
        new RegExp(
          String.raw`(?:git\s*\(\s*(?:opts[^,]*,\s*)?\[\s*['"]${v}['"])|(?:runGit[^\n]*['"]${v}['"])`,
          'i',
        ),
    );

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      // Allow the denylist definition file itself to name verbs
      if (file.replace(/\\/g, '/').endsWith('git/forbidden.ts')) continue;
      for (const re of [...patterns, ...soft]) {
        if (re.test(text)) {
          offenders.push(`${file}: ${re}`);
        }
      }
      // Catch git(opts, ['fetch'...]) style used in readonly-git
      for (const v of FORBIDDEN_LIST) {
        const callRe = new RegExp(
          String.raw`git\(\s*opts\s*,\s*\[\s*['"]${v}['"]`,
        );
        if (callRe.test(text)) offenders.push(file + ": git(opts,['" + v + "']");
      }
    }
    expect(offenders).toEqual([]);
  });

  it('EC-028: discovered package scripts are never auto-executed', async () => {
    workspace = await createTempWorkspace('qa-ec028-');
    const repo = await createGitRepo(workspace, 'scripts', { commits: 1 });
    await writeFile(
      join(repo.path, 'package.json'),
      JSON.stringify({
        name: 'scripts',
        scripts: {
          deploy: 'node -e "require(\'fs\').writeFileSync(\'PWNED\',\'x\')"',
          release: 'node -e "require(\'fs\').writeFileSync(\'PWNED2\',\'x\')"',
          publish: 'echo no',
          'reset-db': 'echo no',
        },
      }),
      'utf8',
    );
    const candidates = await listDiscoveredScriptCandidates(repo.path);
    expect(candidates.map((c) => c.name).sort()).toEqual([
      'deploy',
      'publish',
      'release',
      'reset-db',
    ]);

    const persistence = await createSqlitePersistence({
      dbPath: resolve(workspace, 'di.sqlite'),
      migrationsDir,
    });
    const recorder = new RecordingRunner();
    const runs = await runEnabledHealthChecks({
      repositoryId: 'r',
      store: persistence.health,
      runner: recorder,
    });
    expect(runs).toHaveLength(0);
    expect(recorder.calls).toHaveLength(0);
    // Side-effect files must not exist
    await expect(
      readFile(join(repo.path, 'PWNED'), 'utf8'),
    ).rejects.toThrow();
    persistence.close();
  });

  it('EC-035: secret-like files not indexed by TODO scan', async () => {
    workspace = await createTempWorkspace('qa-ec035-');
    const repo = await createGitRepo(workspace, 'sec', { commits: 1 });
    await mkdir(join(repo.path, 'src'), { recursive: true });
    await writeFile(
      join(repo.path, 'src', 'app.ts'),
      '// TODO: real\n',
      'utf8',
    );
    await writeFile(join(repo.path, '.env'), 'TODO: secret\nAPI_KEY=x\n', 'utf8');
    await writeFile(
      join(repo.path, 'id_rsa'),
      'TODO: key material\n',
      'utf8',
    );
    await writeFile(
      join(repo.path, 'private.pem'),
      'TODO: pem\n',
      'utf8',
    );
    expect(isSecretLikePath('.env')).toBe(true);
    expect(isSecretLikePath('id_rsa')).toBe(true);
    expect(isSecretLikePath('private.pem')).toBe(true);

    const observed = await scanTodos({
      repositoryId: 'r',
      rootPath: repo.path,
      listFiles: gitFiles(repo.path),
    });
    expect(observed.some((o) => o.filePath.includes('.env'))).toBe(false);
    expect(observed.some((o) => o.filePath.includes('id_rsa'))).toBe(false);
    expect(observed.some((o) => o.filePath.includes('private.pem'))).toBe(
      false,
    );
    expect(observed.some((o) => o.filePath.includes('app.ts'))).toBe(true);
  });

  it('EC-036: no LLM / network client imports in DI, Standup or the store', async () => {
    const roots = [
      SRC_ROOT,
      resolve(process.cwd(), '../standup/src'),
      resolve(process.cwd(), '../dev-intelligence-store/src'),
    ];
    const bad: string[] = [];
    const deny =
      /\b(openai|anthropic|@ai-sdk|langchain|cohere|ollama)\b|from\s+['"]axios['"]|from\s+['"]got['"]|from\s+['"]node-fetch['"]|from\s+['"]undici['"]/i;
    for (const root of roots) {
      const files = await collectTsFiles(root);
      for (const file of files) {
        if (file.includes('__tests__')) continue;
        const text = await readFile(file, 'utf8');
        if (deny.test(text)) bad.push(file);
      }
    }
    expect(bad).toEqual([]);
  });
});
