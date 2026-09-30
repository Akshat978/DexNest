/**
 * Everything that reaches GhostOS - from the view, an adapter, a detector or
 * an import file - passes through here first.
 *
 * Two entry points per row kind:
 * - `parse*Input`: what the owner typed. The result is a manual row.
 * - `validate*`: a complete row (adapter, detector, import). Its provenance
 *   must hold: a non-manual fact with no evidence is refused, a confidence
 *   outside 0..1 is refused, and a manual row must say it is manual.
 */

import { CONFIDENCE, MANUAL_EVIDENCE } from './confidence.ts';
import { isRowId } from './ids.ts';
import { isRelationType } from './relations.ts';
import { normalizeTimestamp } from './time.ts';
import {
  ENTITY_TYPES,
  ORIGINS,
  type ConversationDetails,
  type DecisionDetails,
  type Entity,
  type EntityDetails,
  type EntityType,
  type EventDetails,
  type Evidence,
  type FileDetails,
  type HabitCadence,
  type HabitDetails,
  type MemoryDetails,
  type Observation,
  type Provenance,
  type Relation,
} from './types.ts';

export const LIMITS = {
  title: 200,
  notes: 20_000,
  tags: 30,
  tag: 40,
  statement: 500,
  memoryText: 20_000,
  conversationText: 200_000,
  participants: 50,
  participant: 100,
  sourceLabel: 80,
  choice: 500,
  alternatives: 20,
  alternative: 200,
  rationale: 5_000,
  outcome: 5_000,
  path: 1_024,
  label: 200,
  relationNotes: 2_000,
  evidence: 1_000,
  sourceRef: 300,
  parameters: 20,
} as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const done = <T>(value: T, errors: string[]): Parsed<T> => (errors.length ? { ok: false, errors } : { ok: true, value });

// NUL and the other C0 controls (tab, newline and carriage return aside) have no place in owner text.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function text(v: unknown, field: string, max: number, errors: string[], required: boolean): string {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') {
    errors.push(`${field} must be text`);
    return '';
  }
  const t = v.trim();
  if (required && t.length === 0) errors.push(`${field} is required`);
  if (t.length > max) errors.push(`${field} is longer than ${max} characters`);
  if (CONTROL.test(t)) errors.push(`${field} contains control characters`);
  return t;
}

function time(v: unknown, field: string, errors: string[], required: boolean): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${field} is required`);
    return null;
  }
  const t = normalizeTimestamp(v);
  if (t === null) errors.push(`${field} must be a date and time (ISO 8601)`);
  return t;
}

function unit(v: unknown, field: string, errors: string[], fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    errors.push(`${field} must be a number from 0 to 1`);
    return fallback;
  }
  return v;
}

function textList(v: unknown, field: string, maxItems: number, maxEach: number, errors: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push(`${field} must be a list`);
    return [];
  }
  if (v.length > maxItems) errors.push(`${field} has more than ${maxItems} items`);
  const out: string[] = [];
  for (const item of v.slice(0, maxItems)) {
    const t = text(item, `${field} item`, maxEach, errors, true);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;

export function parseTags(v: unknown, errors: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push('tags must be a list');
    return [];
  }
  if (v.length > LIMITS.tags) errors.push(`tags has more than ${LIMITS.tags} items`);
  const out: string[] = [];
  for (const item of v.slice(0, LIMITS.tags)) {
    const tag = typeof item === 'string' ? item.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    if (!tag || tag.length > LIMITS.tag || !TAG.test(tag)) {
      errors.push(`tags: each tag is 1-${LIMITS.tag} letters, digits, spaces, dots, dashes or underscores`);
      continue;
    }
    if (!out.includes(tag)) out.push(tag);
  }
  return out.sort();
}

/** POSIX absolute, Windows drive-absolute, or UNC. Relative paths mean nothing out of context. */
export function isAbsoluteFilePath(path: string): boolean {
  return /^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

// ---------------------------------------------------------------------------
// Evidence and provenance

const REF = /^[A-Za-z0-9][A-Za-z0-9_:.@/-]{0,127}$/;
const SHA = /^[0-9a-f]{7,64}$/;
const SOURCE_ID = /^(adapter|detector):[a-z][a-z0-9_]{0,39}$/;

function parseEvidenceItem(v: unknown, errors: string[]): Evidence | null {
  if (!isObj(v)) {
    errors.push('evidence items must be objects');
    return null;
  }
  const bad = (what: string) => {
    errors.push(`evidence (${String(v.kind)}): ${what}`);
    return null;
  };
  switch (v.kind) {
    case 'manual':
      return { kind: 'manual' };
    case 'repository':
      return typeof v.repositoryId === 'string' && REF.test(v.repositoryId) ? { kind: 'repository', repositoryId: v.repositoryId } : bad('repositoryId is invalid');
    case 'technology': {
      if (typeof v.factId !== 'string' || !REF.test(v.factId)) return bad('factId is invalid');
      if (typeof v.repositoryId !== 'string' || !REF.test(v.repositoryId)) return bad('repositoryId is invalid');
      if (typeof v.evidencePath !== 'string' || v.evidencePath.length > 500 || CONTROL.test(v.evidencePath)) return bad('evidencePath is invalid');
      if (typeof v.evidenceKind !== 'string' || v.evidenceKind.length === 0 || v.evidenceKind.length > 80 || CONTROL.test(v.evidenceKind)) return bad('evidenceKind is invalid');
      return { kind: 'technology', factId: v.factId, repositoryId: v.repositoryId, evidencePath: v.evidencePath, evidenceKind: v.evidenceKind };
    }
    case 'commit': {
      if (typeof v.repositoryId !== 'string' || !REF.test(v.repositoryId)) return bad('repositoryId is invalid');
      if (typeof v.sha !== 'string' || !SHA.test(v.sha)) return bad('sha must be 7-64 lowercase hex digits');
      const at = normalizeTimestamp(v.at);
      if (at === null) return bad('at must be a date and time');
      return { kind: 'commit', repositoryId: v.repositoryId, sha: v.sha, at };
    }
    case 'observation':
      return isRowId('observation', v.observationId) ? { kind: 'observation', observationId: v.observationId } : bad('observationId is invalid');
    default:
      errors.push('evidence kind is unknown');
      return null;
  }
}

export function parseEvidence(v: unknown, errors: string[]): Evidence[] {
  if (!Array.isArray(v)) {
    errors.push('evidence must be a list');
    return [];
  }
  if (v.length > LIMITS.evidence) errors.push(`evidence has more than ${LIMITS.evidence} items`);
  const out: Evidence[] = [];
  for (const item of v.slice(0, LIMITS.evidence)) {
    const e = parseEvidenceItem(item, errors);
    if (e) out.push(e);
  }
  return out;
}

/**
 * The rule the brief states: every fact says where it came from and how
 * sure it is, and a fact with no evidence does not exist.
 */
export function validateProvenance(v: unknown, errors: string[]): Provenance {
  const fallback: Provenance = { origin: 'manual', sourceId: null, sourceRef: null, evidence: [...MANUAL_EVIDENCE], confidence: 1 };
  if (!isObj(v)) {
    errors.push('provenance is required');
    return fallback;
  }
  const origin = v.origin;
  if (typeof origin !== 'string' || !(ORIGINS as readonly string[]).includes(origin)) {
    errors.push('provenance.origin must be manual, adapter or derived');
    return fallback;
  }
  const evidence = parseEvidence(v.evidence, errors);
  const confidence = unit(v.confidence, 'provenance.confidence', errors, 0);
  if (v.confidence === undefined) errors.push('provenance.confidence is required');

  if (origin === 'manual') {
    if (v.sourceId !== null || v.sourceRef !== null) errors.push('a manual row has no source id or reference');
    if (evidence.length !== 1 || evidence[0]?.kind !== 'manual') errors.push('a manual row carries exactly the manual evidence');
    return { origin: 'manual', sourceId: null, sourceRef: null, evidence: [{ kind: 'manual' }], confidence };
  }

  const expectedPrefix = origin === 'adapter' ? 'adapter:' : 'detector:';
  if (typeof v.sourceId !== 'string' || !SOURCE_ID.test(v.sourceId) || !v.sourceId.startsWith(expectedPrefix)) {
    errors.push(`provenance.sourceId must be ${expectedPrefix}<id>`);
  }
  if (typeof v.sourceRef !== 'string' || v.sourceRef.length === 0 || v.sourceRef.length > LIMITS.sourceRef || CONTROL.test(v.sourceRef)) {
    errors.push('provenance.sourceRef is required');
  }
  if (evidence.length === 0) errors.push('a fact with no evidence does not exist');
  if (evidence.some((e) => e.kind === 'manual')) errors.push('only the owner can give manual evidence');
  if (confidence <= 0) errors.push('provenance.confidence must be above 0');
  if (origin === 'derived' && confidence > CONFIDENCE.habitCeiling) errors.push(`a derived fact is never more than ${CONFIDENCE.habitCeiling} sure`);

  return {
    origin: origin as 'adapter' | 'derived',
    sourceId: typeof v.sourceId === 'string' ? v.sourceId : null,
    sourceRef: typeof v.sourceRef === 'string' ? v.sourceRef : null,
    evidence,
    confidence,
  };
}

export function manualProvenance(confidence: number = CONFIDENCE.manual): Provenance {
  return { origin: 'manual', sourceId: null, sourceRef: null, evidence: [...MANUAL_EVIDENCE], confidence };
}

// ---------------------------------------------------------------------------
// Entity details, per type

const HABIT_CADENCES: readonly HabitCadence[] = ['daily', 'weekly', 'monthly', 'irregular'];
const PARAM_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

function parseDetails(type: EntityType, v: unknown, errors: string[], ctx: { now: string; manual: boolean }): EntityDetails {
  const d: Obj = v === undefined || v === null ? {} : isObj(v) ? v : (errors.push('details must be an object'), {});
  switch (type) {
    case 'memory': {
      const value: MemoryDetails = {
        text: text(d.text, 'memory text', LIMITS.memoryText, errors, true),
        occurredAt: time(d.occurredAt, 'memory occurredAt', errors, true) ?? ctx.now,
      };
      return value;
    }
    case 'decision': {
      const value: DecisionDetails = {
        decidedAt: time(d.decidedAt, 'decidedAt', errors, true) ?? ctx.now,
        choice: text(d.choice, 'choice', LIMITS.choice, errors, true),
        alternatives: textList(d.alternatives, 'alternatives', LIMITS.alternatives, LIMITS.alternative, errors),
        rationale: text(d.rationale, 'rationale', LIMITS.rationale, errors, false),
        outcome: text(d.outcome, 'outcome', LIMITS.outcome, errors, false) || null,
        outcomeAt: time(d.outcomeAt, 'outcomeAt', errors, false),
        reviewAt: time(d.reviewAt, 'reviewAt', errors, false),
      };
      if (value.outcomeAt && !value.outcome) errors.push('outcomeAt needs an outcome');
      if (value.outcomeAt && value.outcomeAt < value.decidedAt) errors.push('outcomeAt is before decidedAt');
      return value;
    }
    case 'habit': {
      const cadence = HABIT_CADENCES.includes(d.cadence as HabitCadence) ? (d.cadence as HabitCadence) : (errors.push('cadence must be daily, weekly, monthly or irregular'), 'irregular');
      if (ctx.manual) {
        if (d.mode !== undefined && d.mode !== 'declared') errors.push('only GhostOS detects habits; a habit you enter is declared');
        const value: HabitDetails = { cadence, mode: 'declared', detectorId: null, parameters: {} };
        return value;
      }
      const mode = d.mode === 'declared' || d.mode === 'detected' ? d.mode : (errors.push('habit mode must be declared or detected'), 'declared');
      const detectorId = d.detectorId === null || d.detectorId === undefined ? null : typeof d.detectorId === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(d.detectorId) ? d.detectorId : (errors.push('detectorId is invalid'), null);
      if (mode === 'detected' && detectorId === null) errors.push('a detected habit names its detector');
      const parameters: Record<string, number | string> = {};
      if (d.parameters !== undefined) {
        if (!isObj(d.parameters) || Object.keys(d.parameters).length > LIMITS.parameters) errors.push('parameters must be a small object');
        else
          for (const [key, value] of Object.entries(d.parameters)) {
            if (!PARAM_KEY.test(key)) errors.push('parameter names are letters and digits');
            else if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 80 && !CONTROL.test(value))) parameters[key] = value;
            else errors.push(`parameter ${key} must be a number or short text`);
          }
      }
      const value: HabitDetails = { cadence, mode, detectorId, parameters };
      return value;
    }
    case 'file': {
      const path = text(d.path, 'path', LIMITS.path, errors, true);
      if (path && !isAbsoluteFilePath(path)) errors.push('path must be absolute');
      const value: FileDetails = { path, label: text(d.label, 'label', LIMITS.label, errors, false) };
      return value;
    }
    case 'conversation': {
      const value: ConversationDetails = {
        text: text(d.text, 'conversation text', LIMITS.conversationText, errors, true),
        participants: textList(d.participants, 'participants', LIMITS.participants, LIMITS.participant, errors),
        importedAt: ctx.manual ? ctx.now : (time(d.importedAt, 'importedAt', errors, true) ?? ctx.now),
        sourceLabel: text(d.sourceLabel, 'sourceLabel', LIMITS.sourceLabel, errors, false) || 'pasted',
      };
      return value;
    }
    case 'event': {
      const value: EventDetails = {
        occurredAt: time(d.occurredAt, 'event occurredAt', errors, true) ?? ctx.now,
        endedAt: time(d.endedAt, 'event endedAt', errors, false),
      };
      if (value.endedAt && value.endedAt < value.occurredAt) errors.push('event endedAt is before occurredAt');
      return value;
    }
    default:
      if (Object.keys(d).length > 0) errors.push(`a ${type} has no details`);
      return {};
  }
}

/** The time span the timeline uses: point-in-time types take it from their details. */
function timeSpan(type: EntityType, details: EntityDetails, raw: Obj, errors: string[]) {
  switch (type) {
    case 'memory':
      return { occurredAt: (details as MemoryDetails).occurredAt, startedAt: null, endedAt: null };
    case 'event':
      return { occurredAt: (details as EventDetails).occurredAt, startedAt: null, endedAt: (details as EventDetails).endedAt };
    case 'decision':
      return { occurredAt: (details as DecisionDetails).decidedAt, startedAt: null, endedAt: null };
    case 'conversation':
      return { occurredAt: (details as ConversationDetails).importedAt, startedAt: null, endedAt: null };
    default: {
      const startedAt = time(raw.startedAt, 'startedAt', errors, false);
      const endedAt = time(raw.endedAt, 'endedAt', errors, false);
      if (startedAt && endedAt && endedAt < startedAt) errors.push('endedAt is before startedAt');
      return { occurredAt: time(raw.occurredAt, 'occurredAt', errors, false), startedAt, endedAt };
    }
  }
}

function entityType(v: unknown, errors: string[]): EntityType {
  if (typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v)) return v as EntityType;
  errors.push(`type must be one of: ${ENTITY_TYPES.join(', ')}`);
  return 'knowledge';
}

// ---------------------------------------------------------------------------
// Entities

/** What the owner typed. `id` is null for a new entity. Provenance and times are the caller's. */
export interface EntityDraft {
  id: string | null;
  type: EntityType;
  title: string;
  notes: string;
  tags: string[];
  details: EntityDetails;
  occurredAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export function parseEntityInput(input: unknown, now: string): Parsed<EntityDraft> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['entity must be an object'] };
  const id = input.id === undefined || input.id === null ? null : isRowId('entity', input.id) ? input.id : (errors.push('id is invalid'), null);
  const type = entityType(input.type, errors);
  const details = parseDetails(type, input.details, errors, { now, manual: true });
  const draft: EntityDraft = {
    id,
    type,
    title: text(input.title, 'title', LIMITS.title, errors, true),
    notes: text(input.notes, 'notes', LIMITS.notes, errors, false),
    tags: parseTags(input.tags, errors),
    details,
    ...timeSpan(type, details, input, errors),
  };
  return done(draft, errors);
}

/** A complete entity from an adapter, a detector or an import file. */
export function validateEntity(input: unknown): Parsed<Entity> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['entity must be an object'] };
  if (!isRowId('entity', input.id)) errors.push('id is invalid');
  const type = entityType(input.type, errors);
  const provenance = validateProvenance(input.provenance, errors);
  const createdAt = time(input.createdAt, 'createdAt', errors, true) ?? '';
  const details = parseDetails(type, input.details, errors, { now: createdAt, manual: false });
  if (type === 'habit' && provenance.origin === 'derived' && (details as HabitDetails).mode !== 'detected') errors.push('a derived habit is detected');
  if (type === 'habit' && provenance.origin !== 'derived' && (details as HabitDetails).mode === 'detected') errors.push('only a derived habit is detected');
  if (provenance.origin === 'derived' && type !== 'habit') errors.push('GhostOS derives habits only');
  const entity: Entity = {
    id: String(input.id),
    type,
    title: text(input.title, 'title', LIMITS.title, errors, true),
    notes: text(input.notes, 'notes', LIMITS.notes, errors, false),
    tags: parseTags(input.tags, errors),
    details,
    ...timeSpan(type, details, input, errors),
    provenance,
    createdAt,
    updatedAt: time(input.updatedAt, 'updatedAt', errors, true) ?? '',
  };
  if (entity.updatedAt && entity.createdAt && entity.updatedAt < entity.createdAt) errors.push('updatedAt is before createdAt');
  return done(entity, errors);
}

// ---------------------------------------------------------------------------
// Relations

export interface RelationDraft {
  id: string | null;
  fromId: string;
  toId: string;
  type: string;
  strength: number;
  validFrom: string | null;
  validTo: string | null;
  notes: string;
}

function relationCore(input: Obj, errors: string[]) {
  if (!isRowId('entity', input.fromId)) errors.push('fromId is invalid');
  if (!isRowId('entity', input.toId)) errors.push('toId is invalid');
  if (input.fromId === input.toId) errors.push('a relation joins two different entities');
  if (!isRelationType(input.type)) errors.push('relation type is lowercase letters, digits and underscores, starting with a letter');
  const validFrom = time(input.validFrom, 'validFrom', errors, false);
  const validTo = time(input.validTo, 'validTo', errors, false);
  if (validFrom && validTo && validTo < validFrom) errors.push('validTo is before validFrom');
  return {
    fromId: String(input.fromId),
    toId: String(input.toId),
    type: String(input.type),
    strength: unit(input.strength, 'strength', errors, 1),
    validFrom,
    validTo,
    notes: text(input.notes, 'notes', LIMITS.relationNotes, errors, false),
  };
}

export function parseRelationInput(input: unknown): Parsed<RelationDraft> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['relation must be an object'] };
  const id = input.id === undefined || input.id === null ? null : isRowId('relation', input.id) ? input.id : (errors.push('id is invalid'), null);
  return done({ id, ...relationCore(input, errors) }, errors);
}

export function validateRelation(input: unknown): Parsed<Relation> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['relation must be an object'] };
  if (!isRowId('relation', input.id)) errors.push('id is invalid');
  const core = relationCore(input, errors);
  if (input.strength === undefined) errors.push('strength is required');
  const relation: Relation = {
    id: String(input.id),
    ...core,
    provenance: validateProvenance(input.provenance, errors),
    createdAt: time(input.createdAt, 'createdAt', errors, true) ?? '',
    updatedAt: time(input.updatedAt, 'updatedAt', errors, true) ?? '',
  };
  return done(relation, errors);
}

// ---------------------------------------------------------------------------
// Observations

export interface ObservationDraft {
  entityId: string;
  statement: string;
  observedAt: string;
  confidence: number;
}

export function parseObservationInput(input: unknown, now: string): Parsed<ObservationDraft> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['observation must be an object'] };
  if (!isRowId('entity', input.entityId)) errors.push('entityId is invalid');
  const draft: ObservationDraft = {
    entityId: String(input.entityId),
    statement: text(input.statement, 'statement', LIMITS.statement, errors, true),
    observedAt: time(input.observedAt, 'observedAt', errors, false) ?? now,
    confidence: unit(input.confidence, 'confidence', errors, CONFIDENCE.manual),
  };
  return done(draft, errors);
}

export function validateObservation(input: unknown): Parsed<Observation> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['observation must be an object'] };
  if (!isRowId('observation', input.id)) errors.push('id is invalid');
  if (!isRowId('entity', input.entityId)) errors.push('entityId is invalid');
  const observation: Observation = {
    id: String(input.id),
    entityId: String(input.entityId),
    statement: text(input.statement, 'statement', LIMITS.statement, errors, true),
    observedAt: time(input.observedAt, 'observedAt', errors, true) ?? '',
    provenance: validateProvenance(input.provenance, errors),
    createdAt: time(input.createdAt, 'createdAt', errors, true) ?? '',
  };
  return done(observation, errors);
}

// ---------------------------------------------------------------------------
// Decision outcome (recorded later)

export interface DecisionOutcomeInput {
  id: string;
  outcome: string;
  outcomeAt: string;
}

export function parseDecisionOutcome(input: unknown, now: string): Parsed<DecisionOutcomeInput> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['outcome must be an object'] };
  if (!isRowId('entity', input.id)) errors.push('id is invalid');
  const value: DecisionOutcomeInput = {
    id: String(input.id),
    outcome: text(input.outcome, 'outcome', LIMITS.outcome, errors, true),
    outcomeAt: time(input.outcomeAt, 'outcomeAt', errors, false) ?? now,
  };
  return done(value, errors);
}

/** Applies a recorded outcome to a decision's details, refusing one dated before the decision. */
export function withOutcome(details: DecisionDetails, outcome: DecisionOutcomeInput): Parsed<DecisionDetails> {
  if (outcome.outcomeAt < details.decidedAt) return { ok: false, errors: ['outcomeAt is before decidedAt'] };
  return { ok: true, value: { ...details, outcome: outcome.outcome, outcomeAt: outcome.outcomeAt } };
}
