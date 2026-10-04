// Plan steps -> git argv, and the validator every mutating argv must pass
// before it is spawned.
//
// Two independent layers: stepToArgv only ever builds the shapes below, and
// assertSafeMutatingArgv re-checks the finished argv against an allowlist of
// shapes and the NEVER list - so a bug in one layer (or a value that slipped
// past the planner) still can't produce a force push, a hard reset, a clean or
// a rebase.

import { checkBranchName, checkRemoteName, checkRepoPath, isFullSha, type GitStep } from "@dexnest/projects";

export class UnsafeGitArgv extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeGitArgv";
  }
}

/** Global options git-ops puts before every verb. Nothing else may precede it. */
export const MUTATING_PREFIX: readonly string[] = [
  "-c", "core.fsmonitor=false",
  "-c", "color.ui=false",
  "-c", "core.quotepath=false",
  "-c", "protocol.ext.allow=never",
  "-c", "credential.interactive=never"
];

/** Anything that turns an allowed command into one DexNest never runs. Checked against every argument. */
const NEVER_TOKENS: ReadonlyArray<[RegExp, string]> = [
  [/^(--force|--force-with-lease|--force-if-includes)(=.*)?$/, "force"],
  [/^-[a-zA-Z]*f[a-zA-Z]*$/, "force (-f)"],
  [/^--mirror$/, "mirror"],
  [/^--hard$/, "reset --hard"],
  [/^--(mixed|merge|keep)$/, "reset modes other than --soft"],
  [/^--rebase(=.*)?$/, "rebase"],
  [/^-r$/, "rebase (-r)"],
  [/^--amend$/, "amend"],
  [/^--no-verify$/, "skipping hooks"],
  [/^--prune(=.*)?$/, "prune (except fetch --prune)"],
  [/^\+/, "a '+' refspec (force)"],
  [/^--(upload-pack|receive-pack|exec)(=.*)?$/, "running a remote program"],
  [/^--(template|separate-git-dir|config)(=.*)?$/, "unusual clone options"],
  [/^--all$/, "--all (except fetch --all)"],
  [/^-D$/, "-D (except deleting a verified branch)"],
  [/^--delete$/, "--delete (except deleting a remote branch)"]
];

function prefixEnd(args: readonly string[]): number {
  for (let i = 0; i < MUTATING_PREFIX.length; i += 1) {
    if (args[i] !== MUTATING_PREFIX[i]) throw new UnsafeGitArgv("git-ops argv must start with its own fixed options");
  }
  return MUTATING_PREFIX.length;
}

/** Exact shapes, after the prefix. `B` is a checked branch name, `S` a full sha, `R` a remote, `P` a path. */
type Token = string | { kind: "branch" | "sha" | "remote" | "refspec" | "ffspec" | "message" | "label" | "stashref" | "remoteref" };

function matchShape(rest: readonly string[], shape: readonly Token[], tail?: "paths"): boolean {
  if (tail === "paths") {
    if (rest.length <= shape.length) return false;
  } else if (rest.length !== shape.length) {
    return false;
  }
  for (let i = 0; i < shape.length; i += 1) {
    const want = shape[i];
    const got = rest[i];
    if (typeof want === "string") {
      if (got !== want) return false;
      continue;
    }
    switch (want.kind) {
      case "branch":
        if (!checkBranchName(got).ok) return false;
        break;
      case "sha":
        if (!isFullSha(got)) return false;
        break;
      case "remote":
        if (!checkRemoteName(got).ok) return false;
        break;
      case "refspec": {
        // <branch>:refs/heads/<same branch>, or <sha>:refs/heads/<branch>
        const m = /^([^:]+):refs\/heads\/(.+)$/.exec(got);
        if (!m || !checkBranchName(m[2]).ok) return false;
        if (!(isFullSha(m[1]) || (checkBranchName(m[1]).ok && m[1] === m[2]))) return false;
        break;
      }
      case "ffspec": {
        // refs/heads/<branch>:refs/heads/<branch> or refs/remotes/<remote>/<branch>:refs/heads/<branch>.
        // Full ref names on both sides and no leading '+': git itself then refuses anything but a fast-forward.
        const m = /^(refs\/heads\/|refs\/remotes\/)([^:]+):refs\/heads\/(.+)$/.exec(got);
        if (!m || !checkBranchName(m[3]).ok) return false;
        if (m[1] === "refs/heads/") {
          if (!checkBranchName(m[2]).ok || m[2] === m[3]) return false;
        } else {
          const slash = m[2].indexOf("/");
          if (slash < 1 || !checkRemoteName(m[2].slice(0, slash)).ok || !checkBranchName(m[2].slice(slash + 1)).ok) return false;
        }
        break;
      }
      case "message":
        if (got.length === 0 || got.includes("\0")) return false;
        break;
      case "label":
        if (!/^dexnest-(stash|switch|discard)-[A-Za-z0-9_-]+$/.test(got)) return false;
        break;
      case "stashref":
        if (!/^stash@\{\d+\}$/.test(got)) return false;
        break;
      case "remoteref": {
        const slash = got.indexOf("/");
        if (slash < 1 || !checkRemoteName(got.slice(0, slash)).ok || !checkBranchName(got.slice(slash + 1)).ok) return false;
        break;
      }
    }
  }
  if (tail === "paths") {
    for (const path of rest.slice(shape.length)) if (!checkRepoPath(path).ok) return false;
  }
  return true;
}

const B = { kind: "branch" } as const;
const S = { kind: "sha" } as const;
const R = { kind: "remote" } as const;
const REFSPEC = { kind: "refspec" } as const;
const FFSPEC = { kind: "ffspec" } as const;
const MSG = { kind: "message" } as const;
const LABEL = { kind: "label" } as const;
const STASHREF = { kind: "stashref" } as const;

const SHAPES: ReadonlyArray<{ shape: readonly Token[]; tail?: "paths"; allow?: readonly string[] }> = [
  { shape: ["fetch", "--prune", "--all"], allow: ["--prune", "--all"] },
  { shape: ["fetch", "--prune", R], allow: ["--prune"] },
  { shape: ["pull", "--ff-only", "--no-rebase", R, B] },
  // A fetch from this repository into itself: the one way to move a branch that
  // is not checked out, and only forward. No remote is contacted, FETCH_HEAD is
  // left alone (it is how "last fetched" is known), and no tags are touched.
  { shape: ["fetch", "--no-tags", "--no-write-fetch-head", ".", FFSPEC] },
  { shape: ["push", R, REFSPEC] },
  { shape: ["push", "--set-upstream", R, REFSPEC] },
  { shape: ["push", R, "--delete", B], allow: ["--delete"] },
  { shape: ["add", "--all", "--"], allow: ["--all"] },
  { shape: ["add", "--"], tail: "paths" },
  { shape: ["commit", "--quiet", "--file=-"] },
  { shape: ["commit", "--quiet", "--file=-", "--only", "--"], tail: "paths" },
  { shape: ["stash", "push", "--include-untracked", "--message", LABEL] },
  { shape: ["stash", "push", "--message", LABEL] },
  { shape: ["stash", "push", "--include-untracked", "--message", LABEL, "--"], tail: "paths" },
  { shape: ["stash", "push", "--message", LABEL, "--"], tail: "paths" },
  { shape: ["stash", "apply", "--index", S] },
  { shape: ["stash", "apply", S] },
  { shape: ["stash", "drop", "--quiet", STASHREF] },
  { shape: ["switch", "--no-guess", B] },
  { shape: ["switch", "--no-guess", "--track", "-c", B, { kind: "remoteref" }] },
  { shape: ["branch", "--no-track", B, S] },
  { shape: ["branch", "-D", B], allow: ["-D"] },
  { shape: ["reset", "--soft", S] }
];

/** The second layer. Throws unless `args` is exactly one of the allowed shapes and contains nothing on the NEVER list. */
export function assertSafeMutatingArgv(args: readonly string[]): void {
  const rest = args.slice(prefixEnd(args));
  const match = SHAPES.find((candidate) => matchShape(rest, candidate.shape, candidate.tail));
  if (!match) throw new UnsafeGitArgv(`git-ops refuses this command shape: git ${rest.slice(0, 3).join(" ")}...`);
  // Paths and messages are data: check only the option positions (everything before a literal "--", minus the message).
  const optionEnd = rest.indexOf("--");
  const optionArgs = (optionEnd < 0 ? rest : rest.slice(0, optionEnd)).filter((arg, i, all) => all[i - 1] !== "--message");
  for (const arg of optionArgs) {
    if (match.allow?.includes(arg)) continue;
    const hit = NEVER_TOKENS.find(([pattern]) => pattern.test(arg));
    if (hit) throw new UnsafeGitArgv(`git-ops never runs ${hit[1]}`);
  }
  // "clean", "rebase" and friends can't even be expressed: no shape starts with them.
  const verb = rest[0];
  if (["clean", "rebase", "filter-branch", "filter-repo", "update-ref", "reflog", "gc", "checkout", "restore", "merge", "cherry-pick", "revert", "am", "replace"].includes(verb)) {
    throw new UnsafeGitArgv(`git-ops never runs ${verb}`);
  }
}

export interface BuiltCommand {
  args: string[];
  /** Fed to git on stdin (commit messages - never on the command line, never logged). */
  stdin?: string;
  network: boolean;
}

/** Build the argv for one step. `opId` names DexNest's stashes; `stashRef` resolves a drop. */
export function stepToArgv(step: GitStep, context: { opId: string; stashRef?: string }): BuiltCommand {
  const p = [...MUTATING_PREFIX];
  switch (step.op) {
    case "fetch":
      return { args: step.remote === null ? [...p, "fetch", "--prune", "--all"] : [...p, "fetch", "--prune", step.remote], network: true };
    case "pull_ff":
      return { args: [...p, "pull", "--ff-only", "--no-rebase", step.remote, step.branch], network: true };
    case "ff_branch":
      return { args: [...p, "fetch", "--no-tags", "--no-write-fetch-head", ".", `${step.source}:refs/heads/${step.branch}`], network: false };
    case "push":
      return {
        args: step.setUpstream
          ? [...p, "push", "--set-upstream", step.remote, `${step.branch}:refs/heads/${step.branch}`]
          : [...p, "push", step.remote, `${step.branch}:refs/heads/${step.branch}`],
        network: true
      };
    case "push_sha":
      return { args: [...p, "push", step.remote, `${step.sha}:refs/heads/${step.branch}`], network: true };
    case "push_delete":
      return { args: [...p, "push", step.remote, "--delete", step.branch], network: true };
    case "stage":
      return { args: step.paths === "all" ? [...p, "add", "--all", "--"] : [...p, "add", "--", ...step.paths], network: false };
    case "commit":
      return {
        args: step.only === null ? [...p, "commit", "--quiet", "--file=-"] : [...p, "commit", "--quiet", "--file=-", "--only", "--", ...step.only],
        stdin: step.message,
        network: false
      };
    case "stash_push": {
      const label = `dexnest-${step.label}-${context.opId}`;
      const base = step.includeUntracked ? ["stash", "push", "--include-untracked", "--message", label] : ["stash", "push", "--message", label];
      return { args: step.paths === null ? [...p, ...base] : [...p, ...base, "--", ...step.paths], network: false };
    }
    case "stash_apply":
      return { args: [...p, "stash", "apply", step.sha], network: false };
    case "stash_drop_if_clean":
      if (!context.stashRef) throw new UnsafeGitArgv("stash drop needs the stash's current position");
      return { args: [...p, "stash", "drop", "--quiet", context.stashRef], network: false };
    case "switch":
      return {
        args: step.track ? [...p, "switch", "--no-guess", "--track", "-c", step.branch, step.track] : [...p, "switch", "--no-guess", step.branch],
        network: false
      };
    case "branch_create":
      return { args: [...p, "branch", "--no-track", step.name, step.startPoint], network: false };
    case "branch_delete":
      // -D only after git-ops has verified the tip is still the sha the plan (and the owner) saw.
      return { args: [...p, "branch", "-D", step.name], network: false };
    case "reset_soft":
      return { args: [...p, "reset", "--soft", step.to], network: false };
  }
}
