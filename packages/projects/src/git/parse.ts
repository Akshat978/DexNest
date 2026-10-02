// Parsers for the read engine's git output. Pure; every format is chosen so
// that paths and subjects with spaces, quotes or non-ASCII characters
// survive (NUL or ASCII unit/record separators, never whitespace splitting).

import type { FileChange, FileStatus, InProgressOperation, WorkingTree } from "../domain/repoState.ts";
import { stripUrlCredentials } from "../domain/remote.ts";

// --- status --porcelain=v2 --branch --show-stash -z ---------------------------

export interface StatusResult {
  oid: string | null;
  /** null when detached. */
  head: string | null;
  detached: boolean;
  unborn: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  stashCount: number;
  tree: WorkingTree;
}

const STATUS_LETTERS: Record<string, FileStatus> = { M: "modified", T: "type_changed", A: "added", D: "deleted", R: "renamed", C: "copied" };

export function parseStatusV2(stdout: string, cap = 500): StatusResult {
  const out: StatusResult = {
    oid: null,
    head: null,
    detached: false,
    unborn: false,
    upstream: null,
    ahead: null,
    behind: null,
    stashCount: 0,
    tree: { staged: [], unstaged: [], untracked: [], conflicted: [], truncated: false, counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } }
  };
  const t = out.tree;
  const push = <T>(list: T[], item: T) => {
    if (list.length < cap) list.push(item);
    else t.truncated = true;
  };
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith("# ")) {
      const [key, ...valueParts] = record.slice(2).split(" ");
      const value = valueParts.join(" ");
      if (key === "branch.oid") {
        out.unborn = value === "(initial)";
        out.oid = out.unborn ? null : value;
      } else if (key === "branch.head") {
        out.detached = value === "(detached)";
        out.head = out.detached ? null : value;
      } else if (key === "branch.upstream") {
        out.upstream = value;
      } else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          out.ahead = Number(match[1]);
          out.behind = Number(match[2]);
        }
      } else if (key === "stash") {
        out.stashCount = Number(value) || 0;
      }
      continue;
    }
    const kind = record[0];
    if (kind === "?") {
      t.counts.untracked += 1;
      push(t.untracked, record.slice(2));
      continue;
    }
    if (kind === "!") continue;
    if (kind === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const path = record.split(" ").slice(10).join(" ");
      t.counts.conflicted += 1;
      push(t.conflicted, path);
      continue;
    }
    if (kind === "1" || kind === "2") {
      const fields = record.split(" ");
      const xy = fields[1] ?? "..";
      const path = fields.slice(kind === "1" ? 8 : 9).join(" ");
      let from: string | undefined;
      if (kind === "2") {
        from = records[i + 1];
        i += 1;
      }
      const make = (letter: string): FileChange => {
        const status = STATUS_LETTERS[letter] ?? "modified";
        return from !== undefined && (status === "renamed" || status === "copied") ? { path, status, from } : { path, status };
      };
      if (xy[0] !== ".") {
        t.counts.staged += 1;
        push(t.staged, make(xy[0]));
      }
      if (xy[1] !== ".") {
        t.counts.unstaged += 1;
        push(t.unstaged, make(xy[1]));
      }
    }
  }
  return out;
}

// --- for-each-ref ----------------------------------------------------------------

export const REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(upstream)",
  "%(upstream:remotename)",
  "%(upstream:remoteref)",
  "%(upstream:track,nobracket)",
  "%(committerdate:iso-strict)",
  "%(symref)",
  "%(HEAD)",
  "%(contents:subject)"
].join("%00") + "%1e";

export interface RefRow {
  refname: string;
  sha: string;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  track: { gone: boolean; ahead: number; behind: number } | null;
  committedAt: string | null;
  symref: string | null;
  isHead: boolean;
  subject: string;
}

export function parseTrack(track: string): { gone: boolean; ahead: number; behind: number } {
  if (track === "gone") return { gone: true, ahead: 0, behind: 0 };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { gone: false, ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}

export function parseRefs(stdout: string): RefRow[] {
  const rows: RefRow[] = [];
  for (const raw of stdout.split("\x1e")) {
    const record = raw.replace(/^\r?\n/, "");
    if (!record) continue;
    const f = record.split("\0");
    if (f.length < 10) continue;
    const upstream = f[2] || null;
    rows.push({
      refname: f[0],
      sha: f[1],
      upstream,
      upstreamRemote: f[3] || null,
      upstreamBranch: f[4] ? f[4].replace(/^refs\/heads\//, "") : null,
      track: upstream ? parseTrack(f[5]) : null,
      committedAt: f[6] || null,
      symref: f[7] || null,
      isHead: f[8] === "*",
      subject: f.slice(9).join("\0")
    });
  }
  return rows;
}

// --- worktree list --porcelain -z -------------------------------------------------

export interface WorktreeRow {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export function parseWorktrees(stdout: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  let current: WorktreeRow | null = null;
  for (const field of stdout.split("\0")) {
    if (field === "") {
      if (current) rows.push(current);
      current = null;
      continue;
    }
    const space = field.indexOf(" ");
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? "" : field.slice(space + 1);
    if (key === "worktree") {
      if (current) rows.push(current);
      current = { path: value, head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
    } else if (current) {
      if (key === "HEAD") current.head = value;
      else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") current.bare = true;
      else if (key === "detached") current.detached = true;
      else if (key === "locked") current.locked = true;
      else if (key === "prunable") current.prunable = true;
    }
  }
  if (current) rows.push(current);
  return rows;
}

// --- stash list ---------------------------------------------------------------

export const STASH_FORMAT = "%H%x1f%gd%x1f%cI%x1f%gs%x1e";

export interface StashRow {
  index: number;
  sha: string;
  createdAt: string | null;
  message: string;
  branch: string | null;
}

export function parseStashList(stdout: string): StashRow[] {
  const rows: StashRow[] = [];
  for (const raw of stdout.split("\x1e")) {
    const record = raw.replace(/^\r?\n/, "");
    if (!record) continue;
    const [sha, selector, createdAt, ...rest] = record.split("\x1f");
    const message = rest.join("\x1f");
    const index = /stash@\{(\d+)\}/.exec(selector ?? "");
    if (!sha || !index) continue;
    const branch = /^(?:WIP on|On) ([^:]+):/.exec(message);
    rows.push({ index: Number(index[1]), sha, createdAt: createdAt || null, message, branch: branch ? branch[1] : null });
  }
  return rows;
}

// --- remote -v ------------------------------------------------------------------

export function parseRemotes(stdout: string): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\S+)\t(.+) \(fetch\)$/.exec(line);
    if (match && !out.some((r) => r.name === match[1])) out.push({ name: match[1], url: stripUrlCredentials(match[2]) });
  }
  return out;
}

// --- log ------------------------------------------------------------------------

export const LOG_FORMAT = "%H%x1f%P%x1f%cI%x1f%an%x1f%s%x1e";

export interface CommitRow {
  sha: string;
  parents: string[];
  committedAt: string;
  author: string;
  subject: string;
}

export function parseLog(stdout: string): CommitRow[] {
  const rows: CommitRow[] = [];
  for (const raw of stdout.split("\x1e")) {
    const record = raw.replace(/^\r?\n/, "");
    if (!record) continue;
    const [sha, parents, committedAt, author, ...subject] = record.split("\x1f");
    if (!sha) continue;
    rows.push({ sha, parents: parents ? parents.split(" ") : [], committedAt: committedAt ?? "", author: author ?? "", subject: subject.join("\x1f") });
  }
  return rows;
}

// --- diff --numstat -z ------------------------------------------------------------

export interface NumstatRow {
  path: string;
  from?: string;
  /** null for binary files. */
  added: number | null;
  deleted: number | null;
}

export function parseNumstat(stdout: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  const fields = stdout.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field) continue;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(field);
    if (!match) continue;
    const added = match[1] === "-" ? null : Number(match[1]);
    const deleted = match[2] === "-" ? null : Number(match[2]);
    if (match[3] === "") {
      rows.push({ from: fields[i + 1], path: fields[i + 2], added, deleted });
      i += 2;
    } else {
      rows.push({ path: match[3], added, deleted });
    }
  }
  return rows;
}

// --- in-progress operations ---------------------------------------------------------

/** Files in the git dir that mean an operation is half-way through, checked in this order. */
export const IN_PROGRESS_MARKERS: ReadonlyArray<[string, InProgressOperation]> = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry_pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"]
];
