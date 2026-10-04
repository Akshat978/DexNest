// Files that deserve a second look before they are swept into a commit or a
// stash: secrets, documents and archives that are not code, and very large
// new files or folders.
//
// "Commit all" takes everything git lists. In a folder that also holds a
// keys file, incorporation papers and a dataset, that is one click from
// putting all three on GitHub - and history is never rewritten here, so it
// would stay there. Nothing is refused: the plan says what it found and asks.

import type { WorkingTree } from "./repoState.ts";

export type RiskKind = "secret" | "document" | "archive" | "large";

export interface RiskyPath {
  path: string;
  kind: RiskKind;
  /** For `large`: "1.2 GB in 3,400 files". Empty otherwise. */
  note: string;
}

/** What a measured new file or folder holds. `truncated`: counting stopped at the cap, so it holds at least this. */
export interface PathSize {
  files: number;
  bytes: number;
  truncated: boolean;
}

/** A new file or folder is large beyond either of these. */
export const LARGE_BYTES = 50 * 1024 * 1024;
export const LARGE_FILES = 1000;

const SECRET_NAMES = new Set([
  ".envrc", ".npmrc", ".pypirc", ".netrc", ".git-credentials", "credentials", "credentials.json", "secrets.json", "secret.json",
  "secrets.yaml", "secrets.yml", "service-account.json", "id_rsa", "id_dsa", "id_ed25519", "id_ecdsa", "private.key", "private.pem"
]);
const SECRET_EXT = new Set([".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".kdbx"]);
const DOCUMENT_EXT = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".pages", ".numbers", ".keynote", ".pdf"]);
const ARCHIVE_EXT = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".iso", ".dmg"]);

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1).toLowerCase();
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** What a path looks like from its name alone. A folder (trailing slash) has no name-based risk. */
export function nameRisk(path: string): Exclude<RiskKind, "large"> | null {
  if (path.endsWith("/")) return null;
  const name = baseName(path);
  // `.env.example` and `.env.sample` are templates, written to be committed.
  if (name === ".env" || (name.startsWith(".env.") && !/\.(example|sample|template|dist)$/.test(name))) return "secret";
  if (SECRET_NAMES.has(name) || /^service-account.*\.json$/.test(name)) return "secret";
  const ext = extension(name);
  if (SECRET_EXT.has(ext)) return "secret";
  if (DOCUMENT_EXT.has(ext)) return "document";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  return null;
}

export function isLarge(size: PathSize | undefined): boolean {
  return size !== undefined && (size.truncated || size.bytes > LARGE_BYTES || size.files > LARGE_FILES);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function sizeNote(size: PathSize): string {
  const more = size.truncated ? "more than " : "";
  const files = size.files === 1 ? "1 file" : `${more}${size.files.toLocaleString("en")} files`;
  return size.files === 1 ? `${more}${formatBytes(size.bytes)}` : `${more}${formatBytes(size.bytes)} in ${files}`;
}

/**
 * The risky paths among those an operation would take. `files`: "all", or the
 * chosen ones. Sizes are known only for new files and folders the reader
 * measured; without them nothing is called large.
 */
export function riskyPaths(tree: WorkingTree, files: "all" | readonly string[], only?: readonly RiskKind[]): RiskyPath[] {
  const paths =
    files === "all"
      ? [...new Set([...tree.staged.map((f) => f.path), ...tree.unstaged.map((f) => f.path), ...tree.untracked])]
      : [...new Set(files)];
  const out: RiskyPath[] = [];
  for (const path of paths) {
    const byName = nameRisk(path);
    const size = tree.sizes?.[path];
    if (byName) out.push({ path, kind: byName, note: "" });
    else if (isLarge(size)) out.push({ path, kind: "large", note: sizeNote(size as PathSize) });
  }
  const wanted = only ? out.filter((risk) => only.includes(risk.kind)) : out;
  const order: Record<RiskKind, number> = { secret: 0, large: 1, document: 2, archive: 3 };
  return wanted.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
}

const KIND_WORDS: Record<RiskKind, [string, string]> = {
  secret: ["looks like a secrets file", "look like secrets files"],
  large: ["is very large", "are very large"],
  document: ["is a document, not code", "are documents, not code"],
  archive: ["is an archive", "are archives"]
};

/** One line per kind, naming up to three paths: "2 look like secrets files: .env, keys/prod.pem." */
export function riskLines(risky: readonly RiskyPath[]): string[] {
  const lines: string[] = [];
  for (const kind of ["secret", "large", "document", "archive"] as const) {
    const of = risky.filter((risk) => risk.kind === kind);
    if (of.length === 0) continue;
    const named = of.slice(0, 3).map((risk) => (risk.note ? `${risk.path} (${risk.note})` : risk.path));
    const rest = of.length > 3 ? `, and ${of.length - 3} more` : "";
    const [one, many] = KIND_WORDS[kind];
    lines.push(of.length === 1 ? `${named[0]} ${one}.` : `${of.length} ${many}: ${named.join(", ")}${rest}.`);
  }
  return lines;
}
