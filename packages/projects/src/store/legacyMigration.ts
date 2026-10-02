// The one-time move from settings/projects.json into proj_ tables.
//
// Order matters, so that nothing can be lost:
//   1. read the file; corrupt or not a list -> import nothing, mark nothing
//      (the next start tries again; the file is left exactly as it was);
//   2. write a backup copy and verify its hash - if that fails, stop;
//   3. one transaction: insert every project and the `legacy_import` marker.
// A crash between 2 and 3 leaves a backup and no marker, so the next start
// simply does it again. The original file is never modified or deleted; after
// the marker exists it is no longer read, except to tell the owner it changed.

import { createHash } from "node:crypto";

import { withTransaction, type SqlDatabase } from "@dexnest/foundation";

import { importLegacyProjects } from "../domain/legacy.ts";
import type { ProjectsStore } from "./store.ts";

export const LEGACY_IMPORT_KEY = "legacy_import";

export type LegacyRead = { kind: "missing" } | { kind: "text"; text: string };

/** The file side, supplied by the host (node implementation in ../node/legacyFile.ts). */
export interface LegacySource {
  read(): LegacyRead;
  /** Write a copy of exactly `text`, verify it hashes to `sha256`, return where it went. Throws on any failure. */
  backup(text: string, sha256: string): string;
}

export interface LegacyImportMarker {
  /** null when there was no projects.json to import. */
  sha256: string | null;
  count: number;
  skipped: number;
  importedAt: string;
  backupPath: string | null;
}

export type LegacyMigrationResult =
  | { kind: "imported"; count: number; skipped: Array<{ index: number; reason: string }>; backupPath: string; sha256: string }
  | { kind: "absent" }
  | { kind: "corrupt"; reason: string }
  | { kind: "already"; changedSinceImport: boolean };

export interface LegacyMigrationContext {
  now: string;
  newCommandId: () => string;
}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parse(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    // The old reader tolerated a UTF-8 BOM through JSON.parse failing; be kinder.
    return { ok: true, value: JSON.parse(text.replace(/^﻿/, "")) as unknown };
  } catch (error) {
    return { ok: false, reason: `projects.json is not valid JSON (${(error as Error).message})` };
  }
}

/** Whether projects.json now differs from what was imported (or appeared after an empty start). */
export function legacyChangedSinceImport(store: ProjectsStore, source: LegacySource): boolean {
  const marker = store.getMeta<LegacyImportMarker>(LEGACY_IMPORT_KEY);
  if (!marker) return false;
  const read = source.read();
  if (read.kind === "missing") return false;
  return sha256Of(read.text) !== marker.sha256;
}

export function migrateLegacyProjects(
  db: SqlDatabase,
  store: ProjectsStore,
  source: LegacySource,
  ctx: LegacyMigrationContext
): LegacyMigrationResult {
  if (store.getMeta<LegacyImportMarker>(LEGACY_IMPORT_KEY)) {
    return { kind: "already", changedSinceImport: legacyChangedSinceImport(store, source) };
  }
  const read = source.read();
  if (read.kind === "missing") {
    store.setMeta(LEGACY_IMPORT_KEY, { sha256: null, count: 0, skipped: 0, importedAt: ctx.now, backupPath: null } satisfies LegacyImportMarker, ctx.now);
    return { kind: "absent" };
  }
  const parsed = parse(read.text);
  if (!parsed.ok) return { kind: "corrupt", reason: parsed.reason };
  if (!Array.isArray(parsed.value)) return { kind: "corrupt", reason: "projects.json is not a list" };

  const sha256 = sha256Of(read.text);
  const backupPath = source.backup(read.text, sha256);
  const { projects, skipped } = importLegacyProjects(parsed.value, ctx, store.ids());
  withTransaction(db, () => {
    store.saveMany(projects);
    store.setMeta(LEGACY_IMPORT_KEY, { sha256, count: projects.length, skipped: skipped.length, importedAt: ctx.now, backupPath } satisfies LegacyImportMarker, ctx.now);
  });
  return { kind: "imported", count: projects.length, skipped, backupPath, sha256 };
}

export type LegacyReimportResult =
  | { kind: "imported"; added: string[]; alreadyPresent: number; skipped: Array<{ index: number; reason: string }>; backupPath: string }
  | { kind: "absent" }
  | { kind: "corrupt"; reason: string };

/**
 * "Import projects.json" after the first migration (the owner clicked it,
 * usually after being told the file changed). Adds only entries whose id is
 * not already a project; never overwrites or removes anything.
 */
export function reimportLegacyProjects(
  db: SqlDatabase,
  store: ProjectsStore,
  source: LegacySource,
  ctx: LegacyMigrationContext
): LegacyReimportResult {
  const read = source.read();
  if (read.kind === "missing") return { kind: "absent" };
  const parsed = parse(read.text);
  if (!parsed.ok) return { kind: "corrupt", reason: parsed.reason };
  if (!Array.isArray(parsed.value)) return { kind: "corrupt", reason: "projects.json is not a list" };
  const sha256 = sha256Of(read.text);
  const backupPath = source.backup(read.text, sha256);
  const existing = store.ids();
  const fresh = parsed.value.filter((entry) => {
    const id = typeof entry === "object" && entry !== null && "id" in entry ? (entry as { id: unknown }).id : undefined;
    return !(typeof id === "string" && existing.has(id.trim()));
  });
  const { projects, skipped } = importLegacyProjects(fresh, ctx, existing);
  withTransaction(db, () => {
    store.saveMany(projects);
    store.setMeta(LEGACY_IMPORT_KEY, { sha256, count: projects.length, skipped: skipped.length, importedAt: ctx.now, backupPath } satisfies LegacyImportMarker, ctx.now);
  });
  return { kind: "imported", added: projects.map((p) => p.id), alreadyPresent: parsed.value.length - fresh.length, skipped, backupPath };
}
