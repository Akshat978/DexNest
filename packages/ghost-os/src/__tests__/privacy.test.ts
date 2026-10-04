import { describe, expect, it } from 'vitest';
import {
  DI_EVENT_READ,
  GHOST_EVENT_TYPES,
  NEVER_READ,
  adapterSourceId,
  anyAdapterEnabled,
  defaultGhostOsSettings,
  isRowId,
  isSkillCategory,
  newRowId,
  normalizeGhostOsSettings,
  projectCommit,
  refuseEventRead,
  sourceRowId,
  technologyConfidence,
  type EventEnvelopeLike,
} from '../domain/index.ts';

describe('what GhostOS may read from the event log', () => {
  it('allows exactly dev.commit.observed from developer_intelligence in the dev stream', () => {
    expect(refuseEventRead({ stream: 'dev', module: 'developer_intelligence', types: ['dev.commit.observed'] })).toBeNull();
  });

  it('refuses any other stream, module or type, and a query that names no type', () => {
    const refused = [
      { stream: 'dev', module: 'developer_intelligence' },
      { stream: 'dev', module: 'developer_intelligence', types: [] },
      { stream: 'dev', module: 'developer_intelligence', types: ['dev.commit.observed', 'dev.todo.observed'] },
      { stream: 'dev', types: ['dev.commit.observed'] },
      { module: 'developer_intelligence', types: ['dev.commit.observed'] },
      { stream: 'audit', module: 'developer_intelligence', types: ['dev.commit.observed'] },
      ...NEVER_READ.map((name) => ({ stream: name, module: name, types: [`${name}.item.saved`] })),
      ...NEVER_READ.map((name) => ({ stream: 'dev', module: 'developer_intelligence', types: [`${name}.item.saved`] })),
    ];
    for (const q of refused) expect(refuseEventRead(q), JSON.stringify(q)).not.toBeNull();
  });

  it('the allowlist is one type', () => {
    expect(DI_EVENT_READ.types).toEqual(['dev.commit.observed']);
  });
});

describe('commit projection', () => {
  const commit = (over: Partial<EventEnvelopeLike> = {}): EventEnvelopeLike => ({
    seq: 7,
    type: 'dev.commit.observed',
    stream: 'dev',
    module: 'developer_intelligence',
    subject: 'repo-1',
    payload: { sha: 'abcdef1234', subject: 'SECRET subject line', authorDate: '2026-06-01T20:00:00+02:00', branch: 'main', authorEmail: 'me@example.test' },
    ...over,
  });

  it('keeps the repository, sha and time - never the subject line or anything else', () => {
    const p = projectCommit(commit());
    expect(p).toEqual({ seq: 7, repositoryId: 'repo-1', sha: 'abcdef1234', at: '2026-06-01T18:00:00.000Z' });
    expect(JSON.stringify(p)).not.toMatch(/SECRET|example\.test|main/);
  });

  it('re-checks the envelope and the payload', () => {
    expect(projectCommit(commit({ type: 'vault.item.saved' }))).toBeNull();
    expect(projectCommit(commit({ stream: 'vault' }))).toBeNull();
    expect(projectCommit(commit({ module: 'finance' }))).toBeNull();
    expect(projectCommit(commit({ subject: null }))).toBeNull();
    expect(projectCommit(commit({ payload: null }))).toBeNull();
    expect(projectCommit(commit({ payload: { sha: 'not-a-sha', authorDate: '2026-06-01T00:00:00Z' } }))).toBeNull();
    expect(projectCommit(commit({ payload: { sha: 'abcdef1', authorDate: 'soon' } }))).toBeNull();
  });
});

describe('ids', () => {
  it('source rows get the same id every time, distinct per kind and source', () => {
    const a = sourceRowId('entity', adapterSourceId('developer_intelligence'), 'repo:1');
    expect(a).toBe(sourceRowId('entity', 'adapter:developer_intelligence', 'repo:1'));
    expect(a).not.toBe(sourceRowId('entity', 'adapter:developer_intelligence', 'repo:2'));
    expect(sourceRowId('observation', 'adapter:developer_intelligence', 'repo:1')).toMatch(/^obs_/);
    expect(isRowId('entity', a)).toBe(true);
    expect(isRowId('relation', a)).toBe(false);
  });

  it('new ids are prefixed and refuse short tokens', () => {
    expect(newRowId('relation', '0b6e3f0e-1c2d-4c1e-9a7a-6f1c0d2e3b4a')).toMatch(/^rel_[0-9a-f-]+$/);
    expect(() => newRowId('entity', 'abc')).toThrow();
  });
});

describe('confidence rules', () => {
  it('what a repository holds is a fact, however it was seen: a manifest line and a file extension are equally sure', () => {
    // They were 0.9 and 0.7, which made GhostOS surer of pnpm than of TypeScript.
    expect(technologyConfidence('file-extension')).toBe(1);
    expect(technologyConfidence('package.json')).toBe(1);
  });

  it('languages, runtimes and tooling become skills; libraries do not', () => {
    for (const c of ['language', 'runtime', 'toolchain', 'tooling', 'packageManager']) expect(isSkillCategory(c), c).toBe(true);
    for (const c of ['library', 'project', 'baseImage']) expect(isSkillCategory(c), c).toBe(false);
  });
});

describe('settings', () => {
  it('every adapter is off by default', () => {
    expect(anyAdapterEnabled(defaultGhostOsSettings())).toBe(false);
    expect(anyAdapterEnabled(normalizeGhostOsSettings(null))).toBe(false);
  });

  it('only a literal true turns an adapter on; the interval has a floor', () => {
    expect(normalizeGhostOsSettings({ adapters: { developer_intelligence: { enabled: 'yes' } } }).adapters.developer_intelligence.enabled).toBe(false);
    expect(normalizeGhostOsSettings({ adapters: { developer_intelligence: { enabled: true } } }).adapters.developer_intelligence.enabled).toBe(true);
    expect(normalizeGhostOsSettings({ syncIntervalMinutes: 1 }).syncIntervalMinutes).toBe(15);
    expect(normalizeGhostOsSettings({ adapters: { vault: { enabled: true } } }).adapters).toEqual({ developer_intelligence: { enabled: false } });
  });
});

describe('events', () => {
  it('are all in the ghost namespace', () => {
    expect(GHOST_EVENT_TYPES.every((t) => t.startsWith('ghost.'))).toBe(true);
  });
});
