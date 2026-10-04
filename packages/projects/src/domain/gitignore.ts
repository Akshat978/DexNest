// Adding paths to a repository's .gitignore.
//
// A pattern is written so it matches exactly the path it was made for:
// anchored to the repository root, with every character git would read as a
// wildcard or a comment escaped. "Ignore this file" must not also ignore a
// file of the same name three folders down, or everything matching `[ab]`.

import { checkRepoPath } from "./names.ts";

/** The .gitignore line for one repository-relative path (a folder keeps its trailing slash). */
export function ignorePattern(path: string): string {
  const folder = path.endsWith("/");
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  let escaped = clean.replace(/([\\*?[\]])/g, "\\$1");
  // A trailing space is dropped by git unless escaped; a leading # is a comment and a leading ! a negation.
  escaped = escaped.replace(/( +)$/, (spaces) => spaces.replace(/ /g, "\\ "));
  return `/${escaped}${folder ? "/" : ""}`;
}

export interface IgnoreEdit {
  /** The whole file, to be written back. Unchanged when nothing was added. */
  content: string;
  /** Patterns added, in order. */
  added: string[];
  /** Paths whose pattern was already there. */
  already: string[];
  /** Paths refused, with why. */
  refused: Array<{ path: string; reason: string }>;
}

/**
 * `existing` is the current .gitignore (null when there is none). Existing
 * lines are kept exactly, including their line endings; new patterns go at the
 * end under one comment.
 */
export function addIgnorePatterns(existing: string | null, paths: readonly string[]): IgnoreEdit {
  const text = existing ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const present = new Set(text.split(/\r?\n/).map((line) => line.trimEnd()));
  const added: string[] = [];
  const already: string[] = [];
  const refused: IgnoreEdit["refused"] = [];
  for (const path of [...new Set(paths)]) {
    const check = checkRepoPath(path.replace(/\/+$/, ""));
    if (!check.ok) {
      refused.push({ path, reason: check.reason });
      continue;
    }
    if (path.replace(/\/+$/, "") === ".gitignore") {
      refused.push({ path, reason: "DexNest won't make .gitignore ignore itself." });
      continue;
    }
    const pattern = ignorePattern(path);
    if (present.has(pattern) || added.includes(pattern)) already.push(path);
    else added.push(pattern);
  }
  if (added.length === 0) return { content: text, added, already, refused };
  const head = text.length === 0 || text.endsWith("\n") ? text : `${text}${eol}`;
  const marker = "# Added from DexNest";
  const block = `${present.has(marker) ? "" : `${head.length > 0 ? eol : ""}${marker}${eol}`}${added.join(eol)}${eol}`;
  return { content: `${head}${block}`, added, already, refused };
}
