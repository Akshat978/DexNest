// The node file side of the projects.json migration: read the file, and
// write a verified backup copy next to the other settings backups. The
// original is never written, renamed or deleted.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LegacyRead, LegacySource } from "../store/legacyMigration.ts";

export interface LegacyFileOptions {
  /** settings/projects.json */
  file: string;
  /** settings/backups */
  backupDir: string;
  /** For the backup's name; defaults to the current time. */
  stamp?: () => string;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}

export function createLegacyFileSource(options: LegacyFileOptions): LegacySource {
  const stamp = options.stamp ?? (() => new Date().toISOString().replace(/[:.]/g, "-"));
  return {
    read(): LegacyRead {
      try {
        return { kind: "text", text: readFileSync(options.file, "utf8") };
      } catch (error) {
        if (isNotFound(error)) return { kind: "missing" };
        throw error;
      }
    },
    backup(text, sha256) {
      mkdirSync(options.backupDir, { recursive: true });
      const base = join(options.backupDir, `projects.json.${stamp()}`);
      let target = `${base}.bak`;
      for (let n = 2; ; n += 1) {
        try {
          // "wx": never overwrite an earlier backup.
          writeFileSync(target, text, { encoding: "utf8", flag: "wx" });
          break;
        } catch (error) {
          if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST") {
            target = `${base}-${n}.bak`;
            continue;
          }
          throw error;
        }
      }
      const written = createHash("sha256").update(readFileSync(target, "utf8"), "utf8").digest("hex");
      if (written !== sha256) throw new Error("The projects.json backup does not match the original; nothing was imported.");
      return target;
    }
  };
}
