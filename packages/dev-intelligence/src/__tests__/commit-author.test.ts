/**
 * dev.commit.observed carries the commit's author email, so a consumer (Skill
 * Constellation) can tell the owner's commits from everyone else's. The
 * fingerprint is unchanged - still repository + sha - so adding the field
 * cannot duplicate a commit already recorded.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { createSqlitePersistence } from '@dexnest/dev-intelligence-store/testing';
import type { CommitObservedPayload } from '@dexnest/dev-intelligence-contracts';
import { createDomainRegistry } from '../domain/execution-domains.js';
import { defaultDiscoveryConfig } from '../config/roots.js';
import { ScanOrchestrator } from '../scan/orchestrator.js';
import { cleanup, createGitRepo, createTempWorkspace } from './fixture-repos.js';

describe('commit author on dev.commit.observed', () => {
  let workspace = '';
  afterEach(async () => {
    if (workspace) await cleanup(workspace);
    workspace = '';
  });

  it('records the author email and stays idempotent on rescan', async () => {
    workspace = await createTempWorkspace('commit-author-');
    const repo = await createGitRepo(workspace, 'alpha', { commits: 2 });
    const persistence = await createSqlitePersistence({ dbPath: resolve(workspace, 'di.sqlite') });
    try {
      const domains = createDomainRegistry();
      const orchestrator = () =>
        new ScanOrchestrator({
          persistence,
          domains,
          discovery: defaultDiscoveryConfig({
            roots: [],
            manualRepositories: [{ path: repo.path, domain: domains.defaultDomain() }],
            maxDepth: 2,
          }),
          runHealth: false,
          sourceIdentity: 'test-commit-author',
        });

      const first = await orchestrator().runScan();
      const repositoryId = first.repositories[0]!.id;
      const commits = (await persistence.events.listByRepository(repositoryId, { type: 'dev.commit.observed' }));
      expect(commits.length).toBe(2);
      for (const event of commits) {
        expect((event.payload as CommitObservedPayload).authorEmail).toBe('di-test@example.com');
      }

      await orchestrator().runScan();
      const again = await persistence.events.listByRepository(repositoryId, { type: 'dev.commit.observed' });
      expect(again.map((e) => e.eventId).sort()).toEqual(commits.map((e) => e.eventId).sort());
    } finally {
      persistence.close();
    }
  });
});
