import { describe, it, expect } from 'vitest';
import { deriveEvidence, evidenceId } from '../domain/evidence.ts';
import { isPrivateLookingPath } from '../domain/privacy.ts';
import { resolveTechnologySkill } from '../domain/catalogue.ts';
import { commit, input, OPEN, T0, tech, todo } from './fixtures.ts';

const skillIds = (rows: { skillId: string }[]) => [...new Set(rows.map((r) => r.skillId))].sort();

describe('technology facts', () => {
  it('maps catalogue names to one canonical skill', () => {
    const { evidence } = deriveEvidence(
      input({
        technologies: [
          tech({ repositoryId: 'r-app', name: 'react' }),
          tech({ repositoryId: 'r-app', name: 'react-dom' }),
          tech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: 'src/a.ts', evidenceKind: 'file-extension' }),
          tech({ repositoryId: 'r-app', category: 'runtime', name: 'node', version: '>=20', evidenceKind: 'package.json#engines' }),
        ],
      }),
      { settings: OPEN },
    );
    expect(skillIds(evidence)).toEqual(['nodejs', 'react', 'typescript']);
    expect(evidence.filter((e) => e.skillId === 'react')).toHaveLength(2);
    const ts = evidence.find((e) => e.skillId === 'typescript')!;
    expect(ts.kind).toBe('technology.extension');
    expect(ts.path).toBe('src/a.ts');
    expect(ts.repositoryName).toBe('app');
    expect(evidence.find((e) => e.skillId === 'nodejs')!.detail).toBe('package.json#engines >=20');
  });

  it('never makes a skill of a project name, base image, toolchain or type package', () => {
    const { evidence } = deriveEvidence(
      input({
        technologies: [
          tech({ repositoryId: 'r-app', category: 'project', name: 'my-secret-project' }),
          tech({ repositoryId: 'r-app', category: 'baseImage', name: 'node:20-alpine' }),
          tech({ repositoryId: 'r-app', category: 'toolchain', name: 'rust-edition' }),
          tech({ repositoryId: 'r-app', name: '@types/node' }),
        ],
      }),
      { settings: { ...OPEN, includeUnmappedLibraries: true } },
    );
    expect(evidence).toEqual([]);
  });

  it('hides libraries the catalogue does not name unless asked', () => {
    const facts = [tech({ repositoryId: 'r-app', name: 'left-pad' })];
    expect(deriveEvidence(input({ technologies: facts }), { settings: OPEN }).evidence).toEqual([]);
    const shown = deriveEvidence(input({ technologies: facts }), { settings: { ...OPEN, includeUnmappedLibraries: true } });
    expect(skillIds(shown.evidence)).toEqual(['lib-left-pad']);
    expect(shown.definitions.get('lib-left-pad')).toEqual({ id: 'lib-left-pad', name: 'left-pad', category: 'library' });
  });

  it('an unmapped library can never take a catalogue id', () => {
    expect(resolveTechnologySkill('library', 'react-native-thing', { includeUnmappedLibraries: true })!.id).toBe('lib-react-native-thing');
    expect(resolveTechnologySkill('library', '   ', { includeUnmappedLibraries: true })).toBeUndefined();
  });

  it('keeps removed technology, dated by its removal', () => {
    const { evidence } = deriveEvidence(
      input({
        technologies: [
          tech({ repositoryId: 'r-app', name: 'vue', status: 'removed', removedAt: '2026-03-01T00:00:00.000Z' }),
        ],
      }),
      { settings: OPEN },
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ skillId: 'vue', kind: 'technology.removed', at: '2026-03-01T00:00:00.000Z' });
  });

  it('normalises Windows separators in evidence paths', () => {
    const { evidence } = deriveEvidence(
      input({ technologies: [tech({ repositoryId: 'r-app', name: 'react', evidencePath: 'apps\\web\\package.json' })] }),
      { settings: OPEN },
    );
    expect(evidence[0]!.path).toBe('apps/web/package.json');
  });
});

describe('TODO markers', () => {
  it("evidence their file's language, and never copy the TODO text", () => {
    // Developer Intelligence's markers carry their text; the domain must not keep it.
    const withText = { ...todo({ repositoryId: 'r-app', filePath: 'src/main.rs', line: 12 }), text: 'TODO: call the bank' };
    const { evidence } = deriveEvidence(
      input({
        todos: [
          withText,
          todo({ repositoryId: 'r-app', filePath: 'lib/x.py', status: 'resolved', resolvedAt: '2026-05-02T00:00:00.000Z' }),
          todo({ repositoryId: 'r-app', filePath: 'README.md' }),
        ],
      }),
      { settings: OPEN },
    );
    expect(skillIds(evidence)).toEqual(['python', 'rust']);
    const rust = evidence.find((e) => e.skillId === 'rust')!;
    expect(rust).toMatchObject({ kind: 'todo.open', path: 'src/main.rs', detail: 'TODO line 12' });
    expect(evidence.find((e) => e.skillId === 'python')).toMatchObject({ kind: 'todo.resolved', at: '2026-05-02T00:00:00.000Z' });
    expect(JSON.stringify(evidence)).not.toContain('bank');
  });
});

describe('commits', () => {
  const languages = [
    tech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: 'a.ts', evidenceKind: 'file-extension' }),
    tech({ repositoryId: 'r-app', category: 'language', name: 'Go', evidencePath: 'go.mod', evidenceKind: 'go.mod' }),
    tech({ repositoryId: 'r-app', name: 'react' }),
  ];

  it("credit the repository's languages only", () => {
    const { evidence } = deriveEvidence(
      input({ technologies: languages, commits: [commit({ repositoryId: 'r-app', sha: 'aaa', authorDate: '2026-06-10T00:00:00.000Z' })] }),
      { settings: OPEN },
    );
    const commits = evidence.filter((e) => e.kind === 'commit');
    expect(commits.map((e) => e.skillId).sort()).toEqual(['go', 'typescript']);
    expect(commits.every((e) => e.path === null && e.detail === null && e.sourceRef === 'aaa')).toBe(true);
  });

  it('in a repository with no evidenced language, evidence nothing', () => {
    const { evidence } = deriveEvidence(
      input({ technologies: languages, commits: [commit({ repositoryId: 'r-api', sha: 'bbb' })] }),
      { settings: OPEN },
    );
    expect(evidence.filter((e) => e.kind === 'commit')).toEqual([]);
  });

  it('count only my commits when my emails are set; unknown authors still count', () => {
    const commits = [
      commit({ repositoryId: 'r-app', sha: 'mine', authorEmail: 'Me@Example.com' }),
      commit({ repositoryId: 'r-app', sha: 'theirs', authorEmail: 'colleague@example.com' }),
      commit({ repositoryId: 'r-app', sha: 'old' }),
    ];
    const filtered = deriveEvidence(input({ technologies: languages, commits }), {
      settings: { ...OPEN, myEmails: ['me@example.com'] },
    });
    const shas = [...new Set(filtered.evidence.filter((e) => e.kind === 'commit').map((e) => e.sourceRef))].sort();
    expect(shas).toEqual(['mine', 'old']);
    expect(filtered.othersCommits).toBe(1);

    const unfiltered = deriveEvidence(input({ technologies: languages, commits }), { settings: OPEN });
    expect(new Set(unfiltered.evidence.filter((e) => e.kind === 'commit').map((e) => e.sourceRef)).size).toBe(3);
    expect(unfiltered.othersCommits).toBe(0);
  });
});

describe('private paths', () => {
  const bait = [
    'local-data/files/vault/journal.md',
    'local-data\\data\\dexnest.sqlite',
    '.env',
    'config/.env.production',
    'secrets/id_rsa',
    'deploy/server.pem',
    'finance/receipts.ts',
    'notes/vault/plan.py',
    'db/app.sqlite',
    'keys/prod.key',
    '.ssh/config.ts',
  ];

  it.each(bait)('treats %s as private', (path) => {
    expect(isPrivateLookingPath(path)).toBe(true);
  });

  it.each(['src/app.ts', 'package.json', 'docs/environment.md', 'src/keyboard.ts', 'vaulted/x.ts'])('treats %s as ordinary', (path) => {
    expect(isPrivateLookingPath(path)).toBe(false);
  });

  it('are never recorded as evidence, from any source, and are counted', () => {
    const technologies = bait.map((path) =>
      tech({ repositoryId: 'r-app', category: 'language', name: 'TypeScript', evidencePath: path, evidenceKind: 'file-extension' }),
    );
    // TODOs only count in source files, so their bait is private by folder.
    const todoBait = ['local-data/files/vault/journal.ts', 'secrets/rotate.py', 'finance/receipts.ts', 'notes/vault/plan.go', '.ssh/x.rs'];
    const todos = todoBait.map((path) => todo({ repositoryId: 'r-app', filePath: path }));
    const derived = deriveEvidence(input({ technologies, todos }), { settings: OPEN });
    expect(derived.evidence).toEqual([]);
    expect(derived.refusedPrivate).toBe(bait.length + todoBait.length);
    for (const path of bait) expect(JSON.stringify(derived)).not.toContain(path.split(/[\\/]/).pop()!);
  });

  it("honour the host's boundary for paths that look ordinary", () => {
    const derived = deriveEvidence(
      input({
        technologies: [
          tech({ repositoryId: 'r-app', name: 'react', evidencePath: 'package.json' }),
          tech({ repositoryId: 'r-api', name: 'react', evidencePath: 'package.json' }),
        ],
      }),
      { settings: OPEN, isSensitive: (repositoryId) => repositoryId === 'r-api' },
    );
    expect(derived.evidence.map((e) => e.repositoryId)).toEqual(['r-app']);
    expect(derived.refusedPrivate).toBe(1);
  });
});

describe('identity', () => {
  it('the same observation is one row, with a deterministic id', () => {
    const fact = tech({ repositoryId: 'r-app', name: 'react' });
    const a = deriveEvidence(input({ technologies: [fact, fact] }), { settings: OPEN });
    const b = deriveEvidence(input({ technologies: [fact] }), { settings: OPEN });
    expect(a.evidence).toHaveLength(1);
    expect(a.evidence[0]!.id).toBe(b.evidence[0]!.id);
    expect(a.evidence[0]!.id).toBe(evidenceId('react', 'technology.manifest', fact.id));
    expect(a.evidence[0]!.at).toBe(T0);
  });
});
