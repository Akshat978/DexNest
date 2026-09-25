/**
 * Observed technology / toolchain facts with provenance.
 * Consumers may interpret these; DI must not infer skill proficiency.
 */
export type TechnologyFactStatus = 'observed' | 'removed';

export interface TechnologyFact {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  /** e.g. language, framework, packageManager, runtime */
  category: string;
  name: string;
  version?: string;
  /** Where the fact was observed (e.g. package.json, go.mod, Cargo.toml). */
  evidencePath: string;
  evidenceKind: string;
  fingerprint: string;
  status: TechnologyFactStatus;
  firstObservedAt: string;
  lastObservedAt: string;
  removedAt?: string;
  /** @deprecated Prefer lastObservedAt; kept for older call sites. */
  observedAt: string;
}
