/**
 * How sure GhostOS is, by rule. PLAN.md section 7. Every number here is
 * documented there; nothing is tuned by what the data looks like.
 */

import type { Evidence } from './types.ts';

export const CONFIDENCE = {
  manual: 1,
  /** A project from a Developer Intelligence repository record. */
  repositoryProject: 1,
  /** project -uses-> skill from a manifest (package.json, go.mod, ...). */
  technologyManifest: 0.9,
  /** project -uses-> skill from file extensions only. */
  technologyExtension: 0.7,
  /**
   * "Commits observed in a repository on a day": a commit in a repository
   * that uses X, not proof the commit touched X, and on `main` DI does not
   * say who wrote it.
   */
  commitsObserved: 0.6,
  /** Detected habits never claim more than this. */
  habitCeiling: 0.95,
} as const;

export function technologyConfidence(evidenceKind: string): number {
  return evidenceKind === 'file-extension' ? CONFIDENCE.technologyExtension : CONFIDENCE.technologyManifest;
}

/** Technology categories that become skills. Libraries, base images and project names do not. */
export const SKILL_CATEGORIES = ['language', 'runtime', 'toolchain', 'tooling', 'packageManager'] as const;

export function isSkillCategory(category: string): boolean {
  return (SKILL_CATEGORIES as readonly string[]).includes(category);
}

export const MANUAL_EVIDENCE: readonly Evidence[] = Object.freeze([{ kind: 'manual' } as const]);
