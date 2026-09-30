/**
 * The export file: everything GhostOS holds, as one JSON document, and the
 * check an import file must pass before a single row is written.
 *
 * An import is merged into what exists (PLAN.md Q1): the store skips a row
 * whose id is already present and reports it. Parsing here is all or
 * nothing - one bad row refuses the whole file - and every reference inside
 * the file must resolve inside the file or be left for the store to check
 * against what exists (`externalEntityIds`).
 */

import { isRowId } from './ids.ts';
import { normalizeTimestamp } from './time.ts';
import type { Derivation, Entity, FileDetails, Observation, Relation, RowRef, Tombstone } from './types.ts';
import { validateEntity, validateObservation, validateRelation, type Parsed } from './validation.ts';

export const EXPORT_FORMAT = 'dexnest.ghost_os';
export const EXPORT_VERSION = 1;

export const IMPORT_LIMITS = {
  /** The host refuses a bigger file before reading it. */
  maxBytes: 64 * 1024 * 1024,
  maxRows: 250_000,
  /** Errors reported back; the rest are counted. */
  maxErrors: 50,
} as const;

export interface GhostExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  entities: Entity[];
  relations: Relation[];
  observations: Observation[];
  derivations: Derivation[];
  tombstones: Tombstone[];
}

export interface ParsedImport {
  data: GhostExport;
  /** Entity ids referenced but not in the file: the store checks these exist. */
  externalEntityIds: string[];
  /** File-reference paths, for the host to re-check against the data boundary. */
  filePaths: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function list(v: unknown, field: string, errors: string[]): unknown[] {
  if (!Array.isArray(v)) {
    errors.push(`${field} must be a list`);
    return [];
  }
  return v;
}

function parseRef(v: unknown): RowRef | null {
  if (!isObj(v)) return null;
  const kind = v.kind;
  if (kind !== 'entity' && kind !== 'relation' && kind !== 'observation') return null;
  return isRowId(kind, v.id) ? { kind, id: v.id } : null;
}

export function parseExport(input: unknown): Parsed<ParsedImport> {
  const errors: string[] = [];
  const push = (msg: string) => {
    if (errors.length < IMPORT_LIMITS.maxErrors) errors.push(msg);
    else if (errors.length === IMPORT_LIMITS.maxErrors) errors.push('... more errors not shown');
  };
  if (!isObj(input)) return { ok: false, errors: ['the file is not a GhostOS export'] };
  if (input.format !== EXPORT_FORMAT) return { ok: false, errors: ['the file is not a GhostOS export'] };
  if (input.version !== EXPORT_VERSION) return { ok: false, errors: [`export version ${String(input.version)} is not supported`] };
  const exportedAt = normalizeTimestamp(input.exportedAt);
  if (!exportedAt) push('exportedAt is invalid');

  const raw = {
    entities: list(input.entities, 'entities', errors),
    relations: list(input.relations, 'relations', errors),
    observations: list(input.observations, 'observations', errors),
    derivations: list(input.derivations, 'derivations', errors),
    tombstones: list(input.tombstones, 'tombstones', errors),
  };
  const total = Object.values(raw).reduce((n, rows) => n + rows.length, 0);
  if (total > IMPORT_LIMITS.maxRows) return { ok: false, errors: [`the file has more than ${IMPORT_LIMITS.maxRows} rows`] };

  const collect = <T extends { id: string }>(rows: unknown[], label: string, validate: (v: unknown) => Parsed<T>): T[] => {
    const out: T[] = [];
    const ids = new Set<string>();
    rows.forEach((row, i) => {
      const r = validate(row);
      if (!r.ok) return push(`${label}[${i}]: ${r.errors.join('; ')}`);
      if (ids.has(r.value.id)) return push(`${label}[${i}]: duplicate id`);
      ids.add(r.value.id);
      out.push(r.value);
    });
    return out;
  };

  const entities = collect(raw.entities, 'entities', validateEntity);
  const relations = collect(raw.relations, 'relations', validateRelation);
  const observations = collect(raw.observations, 'observations', validateObservation);

  const entityIds = new Set(entities.map((e) => e.id));
  const external = new Set<string>();
  const needEntity = (id: string) => {
    if (!entityIds.has(id)) external.add(id);
  };
  for (const r of relations) {
    needEntity(r.fromId);
    needEntity(r.toId);
  }
  for (const o of observations) needEntity(o.entityId);

  const present = {
    entity: entityIds,
    relation: new Set(relations.map((r) => r.id)),
    observation: new Set(observations.map((o) => o.id)),
  };
  const derivations: Derivation[] = [];
  raw.derivations.forEach((row, i) => {
    const child = isObj(row) ? parseRef(row.child) : null;
    const parent = isObj(row) ? parseRef(row.parent) : null;
    if (!child || !parent) return push(`derivations[${i}]: child and parent must be row references`);
    // A derivation only ever describes rows in the same export; one pointing
    // outside the file could attach an imported fact to an unrelated row.
    if (!present[child.kind].has(child.id) || !present[parent.kind].has(parent.id)) return push(`derivations[${i}]: refers to a row not in the file`);
    derivations.push({ child, parent });
  });

  const tombstones: Tombstone[] = [];
  raw.tombstones.forEach((row, i) => {
    const forgottenAt = isObj(row) ? normalizeTimestamp(row.forgottenAt) : null;
    if (!isObj(row) || typeof row.sourceId !== 'string' || !/^(adapter|detector):[a-z][a-z0-9_]{0,39}$/.test(row.sourceId) || typeof row.sourceRef !== 'string' || row.sourceRef.length === 0 || row.sourceRef.length > 300 || !forgottenAt) {
      return push(`tombstones[${i}]: invalid`);
    }
    tombstones.push({ sourceId: row.sourceId, sourceRef: row.sourceRef, forgottenAt });
  });

  // Derived rows exist only because of what they came from.
  const derivedChildren = new Set(derivations.map((d) => `${d.child.kind}:${d.child.id}`));
  const rows: [RowRef['kind'], { id: string; provenance: { origin: string } }[]][] = [
    ['entity', entities],
    ['relation', relations],
    ['observation', observations],
  ];
  for (const [kind, list] of rows)
    for (const row of list) if (row.provenance.origin === 'derived' && !derivedChildren.has(`${kind}:${row.id}`)) push(`${kind} ${row.id}: a derived row needs its derivations`);

  if (errors.length) return { ok: false, errors };
  const filePaths = entities.filter((e) => e.type === 'file').map((e) => (e.details as FileDetails).path);
  return {
    ok: true,
    value: {
      data: { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: exportedAt ?? '', entities, relations, observations, derivations, tombstones },
      externalEntityIds: [...external].sort(),
      filePaths,
    },
  };
}
