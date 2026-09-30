/**
 * GhostOS data model. See docs/modules/ghost_os/PLAN.md section 6.
 *
 * Three kinds of row - entities, relations, observations - and every one
 * carries its provenance: where it came from (origin, source, the source's
 * own reference), the evidence behind it, and how sure it is. A fact with no
 * evidence does not exist; manual rows carry `{ kind: "manual" }`.
 */

export const ENTITY_TYPES = [
  'person',
  'project',
  'skill',
  'knowledge',
  'memory',
  'event',
  'habit',
  'decision',
  'file',
  'conversation',
  'place',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ROW_KINDS = ['entity', 'relation', 'observation'] as const;
export type RowKind = (typeof ROW_KINDS)[number];

export interface RowRef {
  kind: RowKind;
  id: string;
}

/** manual: the owner typed it. adapter: a source adapter read it. derived: GhostOS worked it out (habits). */
export const ORIGINS = ['manual', 'adapter', 'derived'] as const;
export type Origin = (typeof ORIGINS)[number];

/**
 * One piece of evidence. Each says where to look; none copies private text.
 * - manual: entered by the owner.
 * - repository / technology / commit: a Developer Intelligence record.
 * - observation: another GhostOS observation (habits cite what they counted).
 */
export type Evidence =
  | { kind: 'manual' }
  | { kind: 'repository'; repositoryId: string }
  | { kind: 'technology'; factId: string; repositoryId: string; evidencePath: string; evidenceKind: string }
  | { kind: 'commit'; repositoryId: string; sha: string; at: string }
  | { kind: 'observation'; observationId: string };

export type EvidenceKind = Evidence['kind'];

export interface Provenance {
  origin: Origin;
  /** null for manual rows; `adapter:<id>` or `detector:<id>` otherwise. */
  sourceId: string | null;
  /** The source's own stable reference for this fact; null for manual rows. */
  sourceRef: string | null;
  evidence: Evidence[];
  /** 0..1. Manual rows are 1 unless the owner says otherwise. */
  confidence: number;
}

export type HabitCadence = 'daily' | 'weekly' | 'monthly' | 'irregular';

export interface MemoryDetails {
  text: string;
  occurredAt: string;
}

export interface DecisionDetails {
  decidedAt: string;
  choice: string;
  alternatives: string[];
  rationale: string;
  outcome: string | null;
  outcomeAt: string | null;
  reviewAt: string | null;
}

export interface HabitDetails {
  cadence: HabitCadence;
  mode: 'declared' | 'detected';
  /** Set for detected habits: which detector, and the numbers it found. */
  detectorId: string | null;
  parameters: Record<string, number | string>;
}

/** A reference to a file: path and label. Never the contents. */
export interface FileDetails {
  path: string;
  label: string;
}

/** Only ever what the owner pasted or imported. */
export interface ConversationDetails {
  text: string;
  participants: string[];
  importedAt: string;
  sourceLabel: string;
}

export interface EventDetails {
  occurredAt: string;
  endedAt: string | null;
}

export interface EntityDetailsByType {
  person: Record<string, never>;
  project: Record<string, never>;
  skill: Record<string, never>;
  knowledge: Record<string, never>;
  memory: MemoryDetails;
  event: EventDetails;
  habit: HabitDetails;
  decision: DecisionDetails;
  file: FileDetails;
  conversation: ConversationDetails;
  place: Record<string, never>;
}

export type EntityDetails = EntityDetailsByType[EntityType];

export interface Entity {
  id: string;
  type: EntityType;
  title: string;
  notes: string;
  tags: string[];
  details: EntityDetails;
  /** The time span the timeline uses. Point-in-time things set occurredAt only. */
  occurredAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

/** Typed, directed: from -type-> to. */
export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  /** 0..1: how strong the connection is (not how sure - that is confidence). */
  strength: number;
  validFrom: string | null;
  /** null = still true. */
  validTo: string | null;
  notes: string;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

/** A dated fact about one entity. */
export interface Observation {
  id: string;
  entityId: string;
  statement: string;
  observedAt: string;
  provenance: Provenance;
  createdAt: string;
}

/** child was derived from parent: forgetting parent removes child. */
export interface Derivation {
  child: RowRef;
  parent: RowRef;
}

/** A forgotten non-manual fact. The source may not bring it back. */
export interface Tombstone {
  sourceId: string;
  sourceRef: string;
  forgottenAt: string;
}
