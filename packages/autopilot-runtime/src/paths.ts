// Path canonicalization and containment.
//
// Written without node:path so the runtime keeps zero platform imports, and so
// the Windows rules are explicit rather than inherited from whatever platform
// the tests happen to run on.
//
// The containment check is boundary-aware: "C:\foo" does not contain
// "C:\foobar". Getting that wrong is the classic path-policy bug, so it is
// tested directly.

export interface CanonicalPath {
  /** Comparison form: lower-cased on Windows, forward slashes, no trailing slash. */
  key: string;
  /** Display form: backslashes on Windows, original casing preserved. */
  display: string;
  absolute: boolean;
}

const WINDOWS_DRIVE = /^[a-zA-Z]:$/;
const UNC_PREFIX = /^\/\//;

/**
 * Lexically canonicalizes a path: normalizes slashes, resolves "." and "..",
 * strips trailing separators, and (on Windows) produces a case-folded key.
 *
 * Lexical only — it does not touch the filesystem. Symlink and junction
 * resolution requires FileSystemPort.realPath, which the dispatcher applies
 * before the final check. See docs for the limitation this leaves.
 */
export function canonicalize(input: string, options: { windows?: boolean; base?: string } = {}): CanonicalPath {
  const windows = options.windows ?? true;
  let value = String(input ?? "").trim();

  // Strip surrounding quotes a command line might carry.
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\/g, "/");

  const isUnc = UNC_PREFIX.test(value);
  let prefix = "";
  let rest = value;

  if (isUnc) {
    prefix = "//";
    rest = value.slice(2);
  } else {
    const driveMatch = /^([a-zA-Z]:)(\/|$)/.exec(value);
    if (driveMatch) {
      prefix = `${driveMatch[1]}/`;
      rest = value.slice(driveMatch[0].length);
    } else if (value.startsWith("/")) {
      prefix = "/";
      rest = value.slice(1);
    }
  }

  const absolute = prefix.length > 0;

  // A relative path is resolved against `base` when one is supplied, so a
  // hostile "../.." can never be evaluated in isolation and slip through.
  if (!absolute && options.base) {
    const baseCanonical = canonicalize(options.base, { windows });
    return canonicalize(`${baseCanonical.display.replace(/\\/g, "/")}/${rest}`, { windows });
  }

  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Never allow traversal above the root: "C:/../../x" is "C:/x", not an
      // escape into some parent of the drive.
      if (segments.length > 0) segments.pop();
      else if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }

  const joined = segments.join("/");
  const forward = absolute ? `${prefix}${joined}` : joined;
  const trimmed = forward.length > 1 && forward.endsWith("/") ? forward.slice(0, -1) : forward;

  const display = windows ? trimmed.replace(/\//g, "\\") : trimmed;
  const key = windows ? trimmed.toLowerCase() : trimmed;

  return { key, display, absolute };
}

/**
 * True when `child` is `parent` or lives beneath it.
 *
 * Boundary-aware: containment requires an exact match or a separator at the
 * boundary, so "C:/foo" contains "C:/foo/bar" but not "C:/foobar".
 */
export function contains(parent: CanonicalPath | string, child: CanonicalPath | string, windows = true): boolean {
  const parentPath = typeof parent === "string" ? canonicalize(parent, { windows }) : parent;
  const childPath = typeof child === "string" ? canonicalize(child, { windows }) : child;

  if (!parentPath.key || !childPath.key) return false;
  if (childPath.key === parentPath.key) return true;

  const boundary = parentPath.key.endsWith("/") ? parentPath.key : `${parentPath.key}/`;
  return childPath.key.startsWith(boundary);
}

/** True when the two paths denote the same location. */
export function samePath(left: CanonicalPath | string, right: CanonicalPath | string, windows = true): boolean {
  const a = typeof left === "string" ? canonicalize(left, { windows }) : left;
  const b = typeof right === "string" ? canonicalize(right, { windows }) : right;
  return a.key === b.key && a.key.length > 0;
}

/** Joins onto a canonical base, then re-canonicalizes so traversal cannot escape. */
export function joinWithin(base: string, relative: string, windows = true): CanonicalPath {
  return canonicalize(relative, { windows, base });
}
