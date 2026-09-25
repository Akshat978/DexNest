/**
 * Technology observe/remove lifecycle. Provenance retained; no skill/XP.
 */

import {
  fingerprintTechnologyFact,
  type TechnologyFact,
  type TechnologyStore,
} from '@dexnest/dev-intelligence-contracts';
import {
  detectTechnologies,
  observationToFact,
} from './detect.js';

export interface ReconcileTechResult {
  observed: TechnologyFact[];
  removed: TechnologyFact[];
  unchanged: TechnologyFact[];
}

export async function reconcileTechnologies(options: {
  repositoryId: string;
  rootPath: string;
  /** Vetted repository-relative paths; see detectTechnologies. */
  files: readonly string[];
  /**
   * False when `files` is not the whole repository (a capped listing). A fact
   * not seen in a partial list is not evidence it was removed, so nothing is
   * marked removed. Default true.
   */
  complete?: boolean;
  store: TechnologyStore;
  now?: string;
}): Promise<ReconcileTechResult> {
  const now = options.now ?? new Date().toISOString();
  const raw = await detectTechnologies(options.rootPath, options.files);
  const existing = await options.store.listByRepository(options.repositoryId);
  const byFp = new Map(existing.map((f) => [f.fingerprint, f]));
  const seen = new Set<string>();
  const observed: TechnologyFact[] = [];
  const unchanged: TechnologyFact[] = [];
  const removed: TechnologyFact[] = [];

  for (const obs of raw) {
    const fp = fingerprintTechnologyFact(
      obs.category,
      obs.name,
      obs.version,
      obs.evidencePath,
    );
    seen.add(fp);
    const prev = byFp.get(fp);
    const fact = observationToFact(options.repositoryId, obs, now, prev);
    if (prev && prev.status === 'observed') {
      const updated = {
        ...fact,
        firstObservedAt: prev.firstObservedAt,
        id: prev.id,
      };
      await options.store.upsert(updated);
      unchanged.push(updated);
    } else {
      await options.store.upsert(fact);
      observed.push(fact);
    }
  }

  for (const prev of options.complete === false ? [] : existing) {
    if (prev.status !== 'observed') continue;
    if (seen.has(prev.fingerprint)) continue;
    const marked = await options.store.markRemoved(
      options.repositoryId,
      prev.fingerprint,
      now,
    );
    if (marked) removed.push(marked);
  }

  return { observed, removed, unchanged };
}
