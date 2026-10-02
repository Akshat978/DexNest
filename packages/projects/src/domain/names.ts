// Names that end up on a git command line: branch names and file paths.
//
// They come from the owner (a new branch name), from the view (files they
// ticked), or from git itself (a branch list). Each is checked before it
// reaches a plan, so a value can never be read by git as an option or escape
// the repository.

export type NameCheck = { ok: true } | { ok: false; reason: string };

const BAD_REF_CHARS = /[\x00-\x20\x7f~^:?*[\\]/;

/** git check-ref-format rules for a branch name, plus "never looks like an option". */
export function checkBranchName(name: string): NameCheck {
  if (name.length === 0) return { ok: false, reason: "A branch needs a name." };
  if (name.length > 200) return { ok: false, reason: "That branch name is too long." };
  if (name.startsWith("-")) return { ok: false, reason: "A branch name can't start with '-'." };
  // On a push command line a leading '+' turns the refspec into a force push.
  if (name.startsWith("+")) return { ok: false, reason: "A branch name can't start with '+'." };
  if (name === "@" || name === "HEAD") return { ok: false, reason: `'${name}' is reserved by git.` };
  if (BAD_REF_CHARS.test(name)) return { ok: false, reason: "Branch names can't contain spaces or any of ~ ^ : ? * [ \\." };
  if (name.includes("..")) return { ok: false, reason: "Branch names can't contain '..'." };
  if (name.includes("@{")) return { ok: false, reason: "Branch names can't contain '@{'." };
  if (name.includes("//") || name.startsWith("/") || name.endsWith("/")) return { ok: false, reason: "Branch names can't start or end with '/', or contain '//'." };
  if (name.endsWith(".") || name.endsWith(".lock")) return { ok: false, reason: "Branch names can't end with '.' or '.lock'." };
  if (name.split("/").some((part) => part.startsWith("."))) return { ok: false, reason: "No part of a branch name can start with '.'." };
  return { ok: true };
}

/** A path relative to the repository root, as git prints it. */
export function checkRepoPath(path: string): NameCheck {
  if (path.length === 0) return { ok: false, reason: "Empty file path." };
  if (/[\x00\r\n]/.test(path)) return { ok: false, reason: "File paths can't contain control characters." };
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return { ok: false, reason: "File paths must be inside the project." };
  if (path.split(/[\\/]/).some((part) => part === "..")) return { ok: false, reason: "File paths must be inside the project." };
  if (path.startsWith(":")) return { ok: false, reason: "Pathspec magic is not accepted." };
  return { ok: true };
}

/** Remote names come from git config; same shape rules as a branch component. */
export function checkRemoteName(name: string): NameCheck {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) return { ok: false, reason: `'${name}' is not a remote name DexNest will use.` };
  if (name.endsWith(".lock") || name.includes("..")) return { ok: false, reason: `'${name}' is not a remote name DexNest will use.` };
  return { ok: true };
}

export function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);
}
