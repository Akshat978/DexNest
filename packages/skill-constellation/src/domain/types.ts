/**
 * Skill Constellation's vocabulary.
 *
 * A skill exists only because Developer Intelligence observed something that
 * supports it. Every type here is either that evidence, a number computed from
 * it, or a way of drawing it. There is no field for a level, XP or a rating a
 * person typed in, and nothing here is guessed.
 *
 * Pure types: no I/O, nothing imported at runtime.
 */

export const SKILL_CATEGORIES = ['language', 'framework', 'library', 'runtime', 'tooling', 'packageManager'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const EVIDENCE_KINDS = [
  /** A manifest names it: a package.json dependency, Cargo.toml, go.mod, a Dockerfile. */
  'technology.manifest',
  /** A file with the language's extension is tracked in the repository. */
  'technology.extension',
  /** It was evidenced and has since been removed. Kept, and dated by the removal. */
  'technology.removed',
  /** An open TODO in a file of this language. */
  'todo.open',
  /** A TODO in a file of this language was resolved: dated activity. */
  'todo.resolved',
  /** A commit (by the owner, or of unknown author) in a repository that evidences this language. */
  'commit',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Activity kinds date when work happened, not merely that something is present. */
export const ACTIVITY_KINDS: ReadonlySet<EvidenceKind> = new Set<EvidenceKind>(['commit', 'todo.resolved']);

/** One reason a skill exists. */
export interface SkillEvidence {
  /** Deterministic from skill, kind and source: the same observation is one row. */
  id: string;
  skillId: string;
  kind: EvidenceKind;
  repositoryId: string;
  repositoryName: string | null;
  /** Repository-relative, forward slashes. Null for commits, which carry no file list. */
  path: string | null;
  /** ISO-8601; what the evidence is dated by. */
  at: string;
  /** The Developer Intelligence record: technology fact id, TODO id, or commit sha. */
  sourceRef: string;
  /**
   * Short structured detail, e.g. "package.json#dependencies ^18.2.0" or
   * "TODO line 12". Never a commit subject and never TODO text - those are
   * looked up from Developer Intelligence when displayed, not copied here.
   */
  detail: string | null;
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: SkillCategory;
}

/** A skill as the evidence describes it. */
export interface Skill extends SkillDefinition {
  evidenceCount: number;
  repositoryCount: number;
  /** Distinct evidence kinds. */
  evidenceKinds: number;
  firstEvidenceAt: string;
  lastEvidenceAt: string;
  /** Latest commit or resolved TODO; null when the only evidence is presence. */
  lastActivityAt: string | null;
}

/** Each component and the score are in [0, 1]. Computed when read, never stored. */
export interface SkillStrength {
  volume: number;
  recency: number;
  variety: number;
  score: number;
}

export type SkillLinkSource = 'evidence' | 'curated';

/** An undirected link; `a` sorts before `b`. */
export interface SkillLink {
  a: string;
  b: string;
  source: SkillLinkSource;
  /** Repositories both skills are evidenced in. Empty for a curated link with no overlap. */
  sharedRepositoryIds: string[];
  /** Jaccard overlap of the two skills' repositories, in [0, 1]. */
  weight: number;
}

/** A star's position in a 1000 x 1000 view box. */
export interface SkillLayoutPoint {
  skillId: string;
  x: number;
  y: number;
}

/** One history row: a skill's strength as of one build. */
export interface SkillStrengthSnapshot extends SkillStrength {
  buildId: string;
  skillId: string;
  at: string;
  evidenceCount: number;
}

// ---------------------------------------------------------------------------
// What the build is given. The engine fills these from Developer
// Intelligence's stores and the dev event stream; the domain never reads them.

export interface InputRepository {
  id: string;
  displayName: string | null;
}

export interface InputTechnology {
  id: string;
  repositoryId: string;
  category: string;
  name: string;
  version?: string;
  evidencePath: string;
  evidenceKind: string;
  status: 'observed' | 'removed';
  lastObservedAt: string;
  removedAt?: string;
}

export interface InputTodo {
  id: string;
  repositoryId: string;
  kind: string;
  status: 'open' | 'resolved';
  filePath: string;
  line?: number;
  firstObservedAt: string;
  resolvedAt?: string;
}

export interface InputCommit {
  repositoryId: string;
  sha: string;
  authorDate: string;
  /** Absent on events recorded before Developer Intelligence stored it. */
  authorEmail?: string;
}

export interface ConstellationInput {
  repositories: readonly InputRepository[];
  technologies: readonly InputTechnology[];
  todos: readonly InputTodo[];
  commits: readonly InputCommit[];
}
