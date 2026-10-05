// Pure planners: repository state + requested operation -> a plain-words
// preview with the steps to run, or a refusal saying why not.
//
// The safety rules live here, once, where they can be tested without git:
// push refuses when behind or diverged, pull is fast-forward only, nothing
// touches a branch checked out in another worktree (Autopilot's), deleting an
// unmerged branch needs the branch name typed, and so on. git-ops (Phase 4)
// re-reads state right before running and re-plans, so a stale view can never
// authorise something the fresh state would refuse.

import { checkBranchName, checkRemoteName, checkRepoPath } from "./names.ts";
import {
  refuse,
  type OperationPlan,
  type OperationRequest,
  type PlanResult,
  type Refusal,
  type UndoRecord
} from "./operations.ts";
import { changedPaths, currentBranch, isDirty, type LocalBranch, type RepoState, type RepoStateOk } from "./repoState.ts";
import { riskLines, riskyPaths, type RiskKind } from "./risk.ts";

/**
 * What a plan says and asks when it would take something risky. Nothing is
 * refused: the owner may well mean it. It stops being one click.
 */
function riskGuard(state: RepoStateOk, files: "all" | readonly string[], only?: readonly RiskKind[]): { safety: "caution"; confirm: { kind: "dialog" }; lines: string[] } | null {
  const risky = riskyPaths(state.workingTree, files, only);
  if (risky.length === 0) return null;
  return { safety: "caution", confirm: { kind: "dialog" }, lines: riskLines(risky) };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const IN_PROGRESS_WORDS = {
  merge: "A merge",
  rebase: "A rebase",
  cherry_pick: "A cherry-pick",
  revert: "A revert",
  bisect: "A bisect"
} as const;

function plan(fields: Omit<OperationPlan, "refused">): OperationPlan {
  return { refused: false, ...fields };
}

/** Refusals every changing operation shares. Fetch is allowed through all of these: it only updates remote-tracking refs. */
function commonBlockers(state: RepoStateOk, kind: string, options: { allowDetached?: boolean } = {}): Refusal | null {
  if (state.inProgress) {
    return refuse(kind, "in_progress", `${IN_PROGRESS_WORDS[state.inProgress]} is in progress here. Finish or abort it in a terminal first.`, ["open_terminal"]);
  }
  if (state.workingTree.counts.conflicted > 0) {
    return refuse(kind, "conflicts", `${plural(state.workingTree.counts.conflicted, "file has", "files have")} conflicts. Resolve them in your editor first.`, ["open_terminal"]);
  }
  if (!options.allowDetached && state.head.detached) {
    return refuse(kind, "detached_head", "HEAD is detached (not on a branch). Switch to a branch first.");
  }
  return null;
}

function elsewhereRefusal(kind: string, branch: LocalBranch): Refusal | null {
  if (!branch.checkedOutElsewhere) return null;
  const who = branch.checkedOutElsewhere.owner === "autopilot" ? "an Autopilot worktree" : "another worktree";
  return refuse(kind, "other_worktree", `${branch.name} is checked out in ${who} (${branch.checkedOutElsewhere.path}). DexNest won't touch it.`);
}

function pickRemote(state: RepoStateOk, requested: string | undefined): string | Refusal {
  if (requested !== undefined) {
    const check = checkRemoteName(requested);
    if (!check.ok) return refuse("push", "invalid_name", check.reason);
    if (!state.remotes.some((r) => r.name === requested)) return refuse("push", "not_found", `There is no remote called ${requested}.`);
    return requested;
  }
  if (state.remotes.some((r) => r.name === "origin")) return "origin";
  if (state.remotes.length === 1) return state.remotes[0].name;
  if (state.remotes.length === 0) return refuse("push", "no_remote", "This repository has no remote to push to.");
  return refuse("push", "needs_choice", "This repository has several remotes. Choose one.");
}

export function planFetch(state: RepoStateOk, request: Extract<OperationRequest, { kind: "fetch" }>): PlanResult {
  if (state.remotes.length === 0) return refuse("fetch", "no_remote", "This repository has no remote to fetch from.");
  let remote: string | null = null;
  if (request.remote !== undefined) {
    const check = checkRemoteName(request.remote);
    if (!check.ok) return refuse("fetch", "invalid_name", check.reason);
    if (!state.remotes.some((r) => r.name === request.remote)) return refuse("fetch", "not_found", `There is no remote called ${request.remote}.`);
    remote = request.remote;
  }
  const from = remote ?? (state.remotes.length === 1 ? state.remotes[0].name : `${state.remotes.length} remotes`);
  return plan({
    kind: "fetch",
    safety: "normal",
    title: "Fetch",
    summary: `Fetch from ${from}.`,
    details: ["Downloads new commits and branches. Your branches and files are not changed.", "Remote branches that were deleted are marked as gone."],
    network: true,
    confirm: { kind: "none" },
    steps: [{ op: "fetch", remote, prune: true }],
    undo: null,
    branch: null,
    counts: {},
    expectHead: null
  });
}

export function planPull(state: RepoStateOk): PlanResult {
  const blocked = commonBlockers(state, "pull");
  if (blocked) return blocked;
  if (state.head.unborn) return refuse("pull", "unborn", "This repository has no commits yet.");
  const branch = currentBranch(state);
  if (!branch) return refuse("pull", "detached_head", "Switch to a branch first.");
  if (!branch.upstream) return refuse("pull", "no_upstream", `${branch.name} has no upstream branch to pull from.`, ["push_set_upstream"]);
  if (branch.upstream.gone) return refuse("pull", "upstream_gone", `${branch.upstream.ref} no longer exists on the remote.`);
  const counts = branch.upstream.counts;
  if (counts && counts.ahead > 0 && counts.behind > 0) {
    return refuse(
      "pull",
      "diverged",
      `${branch.name} has ${plural(counts.ahead, "local commit")} and ${branch.upstream.ref} has ${plural(counts.behind, "new one")} - they have diverged. DexNest won't merge or rebase for you; open a terminal here.`,
      ["open_terminal"]
    );
  }
  const details = ["Fast-forward only: if your branch can't simply move forward, nothing changes and DexNest says why."];
  if (isDirty(state.workingTree)) details.push("You have uncommitted changes. Git stops without changing anything if the new commits touch the same files.");
  const known = counts && counts.behind > 0 ? `${plural(counts.behind, "commit")} ` : "new commits ";
  return plan({
    kind: "pull",
    safety: "normal",
    title: "Pull",
    summary: `Pull ${known}from ${branch.upstream.ref} into ${branch.name}.`,
    details,
    network: true,
    confirm: { kind: "none" },
    steps: [{ op: "pull_ff", remote: branch.upstream.remote, branch: branch.upstream.branch }],
    undo: null,
    branch: branch.name,
    counts: { commits: counts?.behind ?? 0 },
    expectHead: state.head.sha
  });
}

/**
 * Move a branch forward without checking it out.
 *
 * Two forms, both forward-only:
 *   - to its upstream: local `main` catches up with `origin/main` as of the
 *     last fetch. Nothing is downloaded.
 *   - the default branch up to another local branch: `main` moves to where
 *     `develop` is, when everything on `main` is already on `develop`.
 *
 * The branch must not be checked out, here or in another worktree: moving a
 * checked-out branch changes files, and that is what Pull and Switch are for.
 * Git refuses anything that is not a fast-forward on its own; the plan
 * refuses first, in words.
 */
export function planFastForward(state: RepoStateOk, request: Extract<OperationRequest, { kind: "fast_forward" }>): PlanResult {
  const kind = "fast_forward";
  const blocked = commonBlockers(state, kind, { allowDetached: true });
  if (blocked) return blocked;
  const check = checkBranchName(request.branch);
  if (!check.ok) return refuse(kind, "invalid_name", check.reason);
  const branch = state.branches.find((b) => b.name === request.branch);
  if (!branch) return refuse(kind, "not_found", `There is no local branch called ${request.branch}.`);
  if (branch.isCurrent || (!state.head.detached && state.head.branch === branch.name)) {
    return refuse(kind, "current_branch", `You're on ${branch.name}. Use Pull to bring it up to date; this is for a branch you are not on.`, ["pull"]);
  }
  const elsewhere = elsewhereRefusal(kind, branch);
  if (elsewhere) return elsewhere;

  const base = { kind: "fast_forward" as const, network: false, undo: null, branch: branch.name, expectHead: state.head.sha };
  const nothingLost = "The branch only moves forward: nothing on it is lost, and none of your files change.";

  if (request.from === undefined) {
    const upstream = branch.upstream;
    if (!upstream) return refuse(kind, "no_upstream", `${branch.name} has no upstream branch to catch up with.`);
    if (upstream.gone) return refuse(kind, "upstream_gone", `${upstream.ref} no longer exists on the remote.`);
    const tip = state.remoteBranches.find((b) => b.ref === upstream.ref)?.tipSha;
    const counts = upstream.counts;
    if (!tip || !counts) return refuse(kind, "stale_state", `DexNest can't see where ${upstream.ref} is. Fetch first.`, ["fetch"]);
    if (counts.behind === 0) return refuse(kind, "nothing_to_do", `${branch.name} already has everything on ${upstream.ref}, as of the last fetch.`, ["fetch"]);
    if (counts.ahead > 0) {
      return refuse(
        kind,
        "diverged",
        `${branch.name} has ${plural(counts.ahead, "commit")} that ${upstream.ref} doesn't, and is ${plural(counts.behind, "commit")} behind it - they have diverged. DexNest won't merge or rebase for you; open a terminal here.`,
        ["open_terminal"]
      );
    }
    return plan({
      ...base,
      safety: "normal",
      title: "Update branch",
      summary: `Move ${branch.name} forward ${plural(counts.behind, "commit")} to ${upstream.ref}, without switching to it.`,
      details: [nothingLost, `Uses what the last fetch downloaded; nothing is fetched now.`],
      confirm: { kind: "none" },
      steps: [{ op: "ff_branch", branch: branch.name, source: `refs/remotes/${upstream.ref}`, expectSha: branch.tipSha, toSha: tip }],
      counts: { commits: counts.behind }
    });
  }

  const fromCheck = checkBranchName(request.from);
  if (!fromCheck.ok) return refuse(kind, "invalid_name", fromCheck.reason);
  if (request.from === branch.name) return refuse(kind, "nothing_to_do", `${branch.name} is already where ${branch.name} is.`);
  const source = state.branches.find((b) => b.name === request.from);
  if (!source) return refuse(kind, "not_found", `There is no local branch called ${request.from}.`);
  if (source.tipSha === branch.tipSha) return refuse(kind, "nothing_to_do", `${branch.name} and ${source.name} are at the same commit already.`);
  // How far the source is from the default branch is part of every read. For
  // any other pair it is measured when the operation is previewed and run.
  const isDefault = Boolean(state.defaultBranch) && branch.name === state.defaultBranch;
  const measured = state.between && state.between.branch === branch.name && state.between.from === source.name ? state.between : null;
  const vs = isDefault ? source.vsDefault : measured ? { ahead: measured.ahead, behind: measured.behind } : null;
  if (!vs) {
    return isDefault
      ? refuse(kind, "stale_state", `DexNest hasn't compared ${source.name} with ${branch.name}. Open the Branches tab and compare all branches first.`, ["refresh"])
      : refuse(kind, "stale_state", `DexNest hasn't compared ${source.name} with ${branch.name} yet.`, ["refresh"]);
  }
  if (vs.behind > 0) {
    return refuse(
      kind,
      "diverged",
      `${branch.name} has ${plural(vs.behind, "commit")} that ${source.name} doesn't, so it can't simply move forward to it. DexNest won't merge for you; open a terminal here.`,
      ["open_terminal"]
    );
  }
  if (vs.ahead === 0) return refuse(kind, "nothing_to_do", `${source.name} has nothing that ${branch.name} doesn't.`);
  const behindRemote = branch.upstream?.counts?.ahead === 0 && (branch.upstream?.counts?.behind ?? 0) > 0;
  const details = [nothingLost, `Only this PC changes. ${branch.name} is not pushed until you push it.`];
  if (behindRemote) details.push(`${branch.name} is also behind ${branch.upstream!.ref}; ${source.name} already contains those commits, so this covers them too.`);
  return plan({
    ...base,
    safety: "caution",
    title: `Bring ${branch.name} up to ${source.name}`,
    summary: `Move ${branch.name} forward to where ${source.name} is, without switching to it.`,
    details,
    confirm: { kind: "dialog" },
    steps: [{ op: "ff_branch", branch: branch.name, source: `refs/heads/${source.name}`, expectSha: branch.tipSha, toSha: source.tipSha }],
    counts: { commits: vs.ahead }
  });
}

export function planPush(state: RepoStateOk, request: Extract<OperationRequest, { kind: "push" }>): PlanResult {
  const blocked = commonBlockers(state, "push");
  if (blocked) return blocked;
  if (state.head.unborn) return refuse("push", "unborn", "This repository has no commits to push yet.");
  const name = request.branch ?? state.head.branch;
  if (!name) return refuse("push", "detached_head", "Switch to a branch first.");
  const nameCheck = checkBranchName(name);
  if (!nameCheck.ok) return refuse("push", "invalid_name", nameCheck.reason);
  const branch = state.branches.find((b) => b.name === name);
  if (!branch) return refuse("push", "not_found", `There is no local branch called ${name}.`);
  const elsewhere = elsewhereRefusal("push", branch);
  if (elsewhere) return elsewhere;

  if (!branch.upstream || branch.upstream.gone) {
    if (!request.setUpstream) {
      const why = branch.upstream?.gone ? `${branch.upstream.ref} was deleted on the remote.` : `${branch.name} isn't on the remote yet.`;
      return refuse("push", branch.upstream?.gone ? "upstream_gone" : "no_upstream", `${why} Push it and set its upstream?`, ["push_set_upstream"]);
    }
    const remote = pickRemote(state, request.remote);
    if (typeof remote !== "string") return { ...remote, kind: "push" };
    const commits = branch.vsDefault?.ahead;
    return plan({
      kind: "push",
      safety: "normal",
      title: "Push and set upstream",
      summary: `Push ${branch.name} to ${remote} as a new branch and track it.`,
      details: [
        commits !== undefined ? `${plural(commits, "commit")} not on the default branch.` : "Creates the branch on the remote.",
        "Nothing on the remote is overwritten."
      ],
      network: true,
      confirm: { kind: "none" },
      steps: [{ op: "push", remote, branch: branch.name, setUpstream: true }],
      undo: null,
      branch: branch.name,
      counts: { commits: commits ?? 0 },
      expectHead: state.head.sha
    });
  }

  if (request.setUpstream) return refuse("push", "invalid_request", `${branch.name} already tracks ${branch.upstream.ref}.`);
  if (request.remote !== undefined && request.remote !== branch.upstream.remote) {
    return refuse("push", "invalid_request", `${branch.name} tracks ${branch.upstream.ref}; DexNest pushes it there only.`);
  }
  const counts = branch.upstream.counts;
  if (!counts) return refuse("push", "stale_state", "Couldn't compare with the remote. Refresh and try again.", ["refresh"]);
  if (counts.ahead > 0 && counts.behind > 0) {
    return refuse("push", "diverged", `${branch.name} and ${branch.upstream.ref} have diverged (${counts.ahead} ahead, ${counts.behind} behind). DexNest never force-pushes; open a terminal to reconcile them.`, ["open_terminal"]);
  }
  if (counts.behind > 0) {
    return refuse("push", "behind", `${branch.upstream.ref} has ${plural(counts.behind, "commit")} you don't have. Pull first.`, ["pull"]);
  }
  if (counts.ahead === 0) return refuse("push", "nothing_to_do", `Nothing to push: ${branch.name} matches ${branch.upstream.ref} as of the last fetch.`, ["fetch"]);
  const details = ["Nothing on the remote is overwritten."];
  const dirty = state.workingTree.counts.staged + state.workingTree.counts.unstaged + state.workingTree.counts.untracked;
  if (dirty > 0) details.push(`${plural(dirty, "uncommitted change")} stay${dirty === 1 ? "s" : ""} on this PC.`);
  return plan({
    kind: "push",
    safety: "normal",
    title: "Push",
    summary: `Push ${plural(counts.ahead, "commit")} from ${branch.name} to ${branch.upstream.ref}.`,
    details,
    network: true,
    confirm: { kind: "none" },
    steps: [{ op: "push", remote: branch.upstream.remote, branch: branch.name, setUpstream: false }],
    undo: null,
    branch: branch.name,
    counts: { commits: counts.ahead },
    expectHead: state.head.sha
  });
}

function checkFileList(kind: string, state: RepoStateOk, files: readonly string[]): Refusal | null {
  if (files.length === 0) return refuse(kind, "invalid_request", "Choose at least one file.");
  const changed = changedPaths(state.workingTree);
  for (const file of files) {
    const check = checkRepoPath(file);
    if (!check.ok) return refuse(kind, "invalid_request", `${file}: ${check.reason}`);
    if (!changed.has(file)) return refuse(kind, "stale_state", `${file} has no changes any more. Refresh and try again.`, ["refresh"]);
  }
  return null;
}

export function planCommit(state: RepoStateOk, request: Extract<OperationRequest, { kind: "commit" }>): PlanResult {
  const blocked = commonBlockers(state, "commit");
  if (blocked) return blocked;
  const message = request.message.trim();
  if (!message) return refuse("commit", "invalid_request", "Write a commit message.");
  if (message.length > 10_000) return refuse("commit", "invalid_request", "That commit message is too long.");
  const branchName = state.head.branch;
  if (!branchName) return refuse("commit", "detached_head", "Switch to a branch first.");
  const tree = state.workingTree;
  const branch = currentBranch(state);
  if (branch) {
    const elsewhere = elsewhereRefusal("commit", branch);
    if (elsewhere) return elsewhere;
  }
  const subject = message.split(/\r?\n/)[0];
  if (request.files === "all") {
    const total = tree.counts.staged + tree.counts.unstaged + tree.counts.untracked;
    if (total === 0) return refuse("commit", "nothing_to_do", "Nothing to commit.");
    const files = changedPaths(tree).size;
    const guard = riskGuard(state, "all");
    return plan({
      kind: "commit",
      safety: guard?.safety ?? "normal",
      title: "Commit",
      summary: `Commit all ${plural(files, "changed file")} to ${branchName}: "${subject}".`,
      details: [
        ...(guard ? [...guard.lines, "\"Commit all\" takes these too. To leave them out, cancel and tick only the files you mean, or ignore them first."] : []),
        "Stages every change, including new files, then commits.",
        "Stays on this PC until you push. Can be undone until then."
      ],
      network: false,
      confirm: guard?.confirm ?? { kind: "none" },
      steps: [{ op: "stage", paths: "all" }, { op: "commit", message, only: null }],
      undo: state.head.unborn ? null : "uncommit",
      branch: branchName,
      counts: { files },
      expectHead: state.head.sha
    });
  }
  const files = [...new Set(request.files)];
  const listProblem = checkFileList("commit", state, files);
  if (listProblem) return listProblem;
  const untracked = new Set(tree.untracked);
  const toAdd = files.filter((file) => untracked.has(file));
  const steps: OperationPlan["steps"] = [];
  if (toAdd.length > 0) steps.push({ op: "stage", paths: toAdd });
  steps.push({ op: "commit", message, only: files });
  // Ticked on purpose, but still worth a second look before it is in history.
  const guard = riskGuard(state, files);
  return plan({
    kind: "commit",
    safety: guard?.safety ?? "normal",
    title: "Commit",
    summary: `Commit ${plural(files.length, "file")} to ${branchName}: "${subject}".`,
    details: [...(guard?.lines ?? []), "Only the chosen files are committed; other changes stay as they are.", "Stays on this PC until you push. Can be undone until then."],
    network: false,
    confirm: guard?.confirm ?? { kind: "none" },
    steps,
    undo: state.head.unborn ? null : "uncommit",
    branch: branchName,
    counts: { files: files.length },
    expectHead: state.head.sha
  });
}

export function planStash(state: RepoStateOk, request: Extract<OperationRequest, { kind: "stash" }>): PlanResult {
  const blocked = commonBlockers(state, "stash", { allowDetached: true });
  if (blocked) return blocked;
  if (state.head.unborn) return refuse("stash", "unborn", "Git can't stash before the first commit.");
  const includeUntracked = request.includeUntracked ?? true;
  const c = state.workingTree.counts;
  const files = c.staged + c.unstaged + (includeUntracked ? c.untracked : 0);
  if (files === 0) return refuse("stash", "nothing_to_do", "Nothing to stash.");
  // A stash stays on this PC, so a secrets file in it is no leak. A very large
  // new folder is the problem: git copies all of it into the stash.
  const guard = includeUntracked ? riskGuard(state, "all", ["large"]) : null;
  return plan({
    kind: "stash",
    safety: guard?.safety ?? "normal",
    title: "Stash",
    summary: `Stash ${plural(changedPaths(state.workingTree).size, "changed file")}${includeUntracked ? ", including new files" : ""}.`,
    details: [
      ...(guard ? [...guard.lines, "Git copies everything it stashes, so this may take a long time and a lot of disk. To leave it out, cancel and ignore it first."] : []),
      "Puts your changes aside and leaves the folder clean. Pop the stash to bring them back."
    ],
    network: false,
    confirm: guard?.confirm ?? { kind: "none" },
    steps: [{ op: "stash_push", label: "stash", paths: null, includeUntracked }],
    undo: "pop_stash",
    branch: state.head.branch,
    counts: { files },
    expectHead: state.head.sha
  });
}

export function planStashPop(state: RepoStateOk, request: Extract<OperationRequest, { kind: "stash_pop" }>): PlanResult {
  const blocked = commonBlockers(state, "stash_pop", { allowDetached: true });
  if (blocked) return blocked;
  const entry = state.stashes.find((s) => s.index === request.index);
  if (!entry || entry.sha !== request.sha) return refuse("stash_pop", "stale_state", "The stash list has changed. Refresh and try again.", ["refresh"]);
  const changed = changedPaths(state.workingTree);
  const overlap = entry.files === null ? changed.size > 0 : entry.files.some((file) => changed.has(file));
  const label = `stash@{${entry.index}}`;
  return plan({
    kind: "stash_pop",
    safety: overlap ? "caution" : "normal",
    title: overlap ? "Pop stash (may conflict)" : "Pop stash",
    summary: `Bring back ${label}${entry.branch ? ` (from ${entry.branch})` : ""}.`,
    details: overlap
      ? [
          "Some of your current changes touch the same files, so this may stop with conflicts.",
          "If it does, the stash is kept so nothing is lost; resolve the conflicts in your editor."
        ]
      : ["The stash is removed once it applies cleanly."],
    network: false,
    confirm: overlap ? { kind: "dialog" } : { kind: "none" },
    steps: [{ op: "stash_apply", sha: entry.sha }, { op: "stash_drop_if_clean", sha: entry.sha }],
    undo: null,
    branch: state.head.branch,
    counts: { stashes: 1 },
    expectHead: state.head.sha
  });
}

export function planSwitch(state: RepoStateOk, request: Extract<OperationRequest, { kind: "switch" }>): PlanResult {
  const blocked = commonBlockers(state, "switch", { allowDetached: true });
  if (blocked) return blocked;
  const check = checkBranchName(request.branch);
  if (!check.ok) return refuse("switch", "invalid_name", check.reason);
  if (state.head.branch === request.branch && !state.head.detached) return refuse("switch", "nothing_to_do", `You're already on ${request.branch}.`);

  let track: string | undefined;
  const local = state.branches.find((b) => b.name === request.branch);
  if (local) {
    const elsewhere = elsewhereRefusal("switch", local);
    if (elsewhere) return elsewhere;
  } else {
    const remoteName = request.remote ?? "origin";
    const remote = state.remoteBranches.find((b) => b.remote === remoteName && b.name === request.branch);
    if (!remote) return refuse("switch", "not_found", `There is no branch called ${request.branch}.`);
    track = remote.ref;
  }

  const steps: OperationPlan["steps"] = [];
  const details: string[] = [];
  if (isDirty(state.workingTree)) {
    if (request.dirty !== "stash") {
      return refuse("switch", "needs_choice", "You have uncommitted changes. Stash them and switch, or cancel?", ["stash_and_switch"]);
    }
    steps.push({ op: "stash_push", label: "switch", paths: null, includeUntracked: true });
    details.push("Your uncommitted changes are stashed first; pop the stash to bring them back.");
  }
  steps.push(track ? { op: "switch", branch: request.branch, track } : { op: "switch", branch: request.branch });
  if (track) details.push(`Creates a local ${request.branch} that tracks ${track}.`);
  return plan({
    kind: "switch",
    safety: "normal",
    title: "Switch branch",
    summary: `Switch from ${state.head.branch ?? "a detached HEAD"} to ${request.branch}.`,
    details,
    network: false,
    confirm: { kind: "none" },
    steps,
    undo: state.head.branch && !state.head.detached ? "switch_back" : null,
    branch: request.branch,
    counts: {},
    expectHead: state.head.sha
  });
}

export function planCreateBranch(state: RepoStateOk, request: Extract<OperationRequest, { kind: "create_branch" }>): PlanResult {
  const blocked = commonBlockers(state, "create_branch", { allowDetached: true });
  if (blocked) return blocked;
  if (state.head.unborn) return refuse("create_branch", "unborn", "Make a first commit before creating branches.");
  const check = checkBranchName(request.name);
  if (!check.ok) return refuse("create_branch", "invalid_name", check.reason);
  if (state.branches.some((b) => b.name === request.name)) return refuse("create_branch", "exists", `${request.name} already exists.`);
  let startPoint: string;
  let from: string;
  if (request.startPoint === undefined) {
    if (!state.head.sha) return refuse("create_branch", "unborn", "There is no commit to branch from.");
    startPoint = state.head.sha;
    from = state.head.branch ?? state.head.sha.slice(0, 7);
  } else {
    const local = state.branches.find((b) => b.name === request.startPoint);
    const remote = state.remoteBranches.find((b) => b.ref === request.startPoint);
    if (!local && !remote) return refuse("create_branch", "not_found", `There is no branch called ${request.startPoint}.`);
    startPoint = (local ?? remote)!.tipSha;
    from = request.startPoint;
  }
  const steps: OperationPlan["steps"] = [{ op: "branch_create", name: request.name, startPoint }];
  if (request.switchTo) steps.push({ op: "switch", branch: request.name });
  return plan({
    kind: "create_branch",
    safety: "normal",
    title: "Create branch",
    summary: `Create ${request.name} from ${from}${request.switchTo ? " and switch to it" : ""}.`,
    details: request.switchTo && isDirty(state.workingTree) ? ["Your uncommitted changes come with you."] : [],
    network: false,
    confirm: { kind: "none" },
    steps,
    undo: request.switchTo ? null : "delete_created_branch",
    branch: request.name,
    counts: { branches: 1 },
    expectHead: state.head.sha
  });
}

export function planDeleteBranch(state: RepoStateOk, request: Extract<OperationRequest, { kind: "delete_branch" }>): PlanResult {
  const check = checkBranchName(request.name);
  if (!check.ok) return refuse("delete_branch", "invalid_name", check.reason);
  const branch = state.branches.find((b) => b.name === request.name);
  if (!branch) return refuse("delete_branch", "not_found", `There is no local branch called ${request.name}.`);
  if (branch.isCurrent || state.head.branch === branch.name) return refuse("delete_branch", "current_branch", `You're on ${branch.name}. Switch to another branch first.`);
  if (state.defaultBranch && branch.name === state.defaultBranch) return refuse("delete_branch", "default_branch", `${branch.name} is the default branch. DexNest won't delete it.`);
  const elsewhere = elsewhereRefusal("delete_branch", branch);
  if (elsewhere) return elsewhere;
  const merged = branch.mergedIntoDefault === true;
  const short = branch.tipSha.slice(0, 7);
  const details = [`Can be undone: DexNest recreates it at ${short}.`];
  if (!merged) {
    const ahead = branch.vsDefault?.ahead;
    details.unshift(
      branch.mergedIntoDefault === null
        ? "DexNest can't tell whether it was merged (no default branch)."
        : `It has ${ahead !== undefined ? plural(ahead, "commit") : "commits"} not in ${state.defaultBranch}.`
    );
    if (!branch.upstream || branch.upstream.gone) details.push("It isn't on the remote either.");
  }
  return plan({
    kind: "delete_branch",
    safety: merged ? "caution" : "strong",
    title: merged ? "Delete merged branch" : "Delete unmerged branch",
    summary: `Delete the local branch ${branch.name}${merged ? ` (merged into ${state.defaultBranch})` : ""}.`,
    details,
    network: false,
    confirm: merged ? { kind: "dialog" } : { kind: "type", text: branch.name },
    steps: [{ op: "branch_delete", name: branch.name, expectSha: branch.tipSha }],
    undo: "recreate_branch",
    branch: branch.name,
    counts: { branches: 1 },
    expectHead: state.head.sha
  });
}

export function planDeleteRemoteBranch(state: RepoStateOk, request: Extract<OperationRequest, { kind: "delete_remote_branch" }>): PlanResult {
  const nameCheck = checkBranchName(request.name);
  if (!nameCheck.ok) return refuse("delete_remote_branch", "invalid_name", nameCheck.reason);
  const remoteCheck = checkRemoteName(request.remote);
  if (!remoteCheck.ok) return refuse("delete_remote_branch", "invalid_name", remoteCheck.reason);
  const branch = state.remoteBranches.find((b) => b.remote === request.remote && b.name === request.name);
  if (!branch) return refuse("delete_remote_branch", "not_found", `There is no ${request.remote}/${request.name} as of the last fetch.`, ["fetch"]);
  if (request.name === "HEAD" || (state.defaultBranch && request.name === state.defaultBranch)) {
    return refuse("delete_remote_branch", "default_branch", `${branch.ref} is the default branch. DexNest won't delete it.`);
  }
  const usedElsewhere = state.branches.find((b) => b.upstream?.ref === branch.ref && b.checkedOutElsewhere);
  if (usedElsewhere) {
    const elsewhere = elsewhereRefusal("delete_remote_branch", usedElsewhere);
    if (elsewhere) return elsewhere;
  }
  return plan({
    kind: "delete_remote_branch",
    safety: "strong",
    title: "Delete remote branch",
    summary: `Delete ${branch.name} on ${branch.remote}.`,
    details: [
      "Removes the branch for everyone who uses this remote.",
      branch.trackedBy ? `Your local ${branch.trackedBy} is kept.` : "There is no local copy of this branch.",
      `Can be undone while ${branch.tipSha.slice(0, 7)} is still on this PC.`
    ],
    network: true,
    confirm: { kind: "type", text: branch.name },
    steps: [{ op: "push_delete", remote: branch.remote, branch: branch.name }],
    undo: "restore_remote_branch",
    branch: branch.name,
    counts: { branches: 1 },
    expectHead: null
  });
}

export function planDiscard(state: RepoStateOk, request: Extract<OperationRequest, { kind: "discard" }>): PlanResult {
  if (state.inProgress) {
    return refuse("discard", "in_progress", `${IN_PROGRESS_WORDS[state.inProgress]} is in progress here. Finish or abort it in a terminal first.`, ["open_terminal"]);
  }
  if (state.head.unborn) return refuse("discard", "unborn", "Git can't keep a backup before the first commit, so DexNest won't discard anything yet.");
  const files = [...new Set(request.files)];
  const listProblem = checkFileList("discard", state, files);
  if (listProblem) return listProblem;
  const conflicted = new Set(state.workingTree.conflicted);
  const inConflict = files.filter((file) => conflicted.has(file));
  if (inConflict.length > 0) return refuse("discard", "conflicts", `${inConflict[0]} has conflicts. Resolve them in your editor instead.`, ["open_terminal"]);
  const untracked = new Set(state.workingTree.untracked);
  const includesNew = files.some((file) => untracked.has(file));
  return plan({
    kind: "discard",
    safety: "caution",
    title: "Discard changes",
    summary: `Discard changes in ${plural(files.length, "file")}.`,
    details: [
      includesNew ? "Changed files go back to the last commit; new files are removed." : "The files go back to how they were at the last commit.",
      "A backup stash is made first, so this can be undone."
    ],
    network: false,
    confirm: { kind: "dialog" },
    steps: [{ op: "stash_push", label: "discard", paths: files, includeUntracked: includesNew }],
    undo: "apply_stash",
    branch: state.head.branch,
    counts: { files: files.length },
    expectHead: state.head.sha
  });
}

/** Facts the planner can't see in RepoState, looked up by the read engine for one undo. */
export interface UndoFacts {
  /** Whether any remote-tracking ref contains the commit (null = couldn't tell). */
  commitOnRemote: boolean | null;
  /** Whether the recorded object still exists locally (null = couldn't tell). */
  objectExists: boolean | null;
}

export function planUndo(state: RepoStateOk, record: UndoRecord, facts: UndoFacts): PlanResult {
  const kind = "undo";
  const blocked = commonBlockers(state, kind, { allowDetached: true });
  if (blocked) return blocked;
  const gone = () => refuse(kind, "cannot_undo", "What this would restore is no longer on this PC.");
  const base = { kind: "undo" as const, safety: "normal" as const, network: false, confirm: { kind: "none" } as const, undo: null, counts: {}, expectHead: state.head.sha };
  switch (record.kind) {
    case "uncommit": {
      if (state.head.detached || state.head.branch !== record.branch || state.head.sha !== record.commitSha) {
        return refuse(kind, "cannot_undo", `${record.branch} has moved on since that commit. It can't be undone safely.`);
      }
      if (facts.commitOnRemote !== false) {
        return refuse(kind, "cannot_undo", facts.commitOnRemote ? "That commit has been pushed. DexNest never rewrites pushed history." : "DexNest can't tell whether that commit was pushed, so it won't undo it.");
      }
      return plan({ ...base, title: "Undo commit", summary: `Undo the last commit on ${record.branch}. Its changes stay in your files.`, details: ["Nothing is lost: the changes come back as staged."], steps: [{ op: "reset_soft", to: record.parentSha, expectHead: record.commitSha }], branch: record.branch });
    }
    case "recreate_branch": {
      if (state.branches.some((b) => b.name === record.name)) return refuse(kind, "exists", `${record.name} exists again already.`);
      if (facts.objectExists === false) return gone();
      return plan({ ...base, title: "Restore branch", summary: `Recreate ${record.name} at ${record.sha.slice(0, 7)}.`, details: [], steps: [{ op: "branch_create", name: record.name, startPoint: record.sha }], branch: record.name, counts: { branches: 1 } });
    }
    case "apply_stash":
    case "pop_stash": {
      if (facts.objectExists === false) return gone();
      const entry = state.stashes.find((s) => s.sha === record.sha);
      const steps: OperationPlan["steps"] = [{ op: "stash_apply", sha: record.sha }];
      if (entry) steps.push({ op: "stash_drop_if_clean", sha: record.sha });
      const words = record.kind === "apply_stash" ? "Bring back the discarded changes." : "Bring back the stashed changes.";
      // Only ask when today's changes may collide with the backup (unknown files count as "may").
      const changed = changedPaths(state.workingTree);
      const dirty = entry?.files ? entry.files.some((file) => changed.has(file)) : isDirty(state.workingTree);
      return plan({
        ...base,
        safety: dirty ? "caution" : "normal",
        confirm: dirty ? { kind: "dialog" } : { kind: "none" },
        title: "Undo",
        summary: words,
        details: dirty ? ["You have changes now; if they touch the same files this stops with conflicts and the backup is kept."] : [],
        steps,
        branch: state.head.branch,
        counts: { stashes: 1 }
      });
    }
    case "switch_back": {
      const branch = state.branches.find((b) => b.name === record.branch);
      if (!branch) return refuse(kind, "not_found", `${record.branch} no longer exists.`);
      if (state.head.branch === record.branch && !state.head.detached) return refuse(kind, "nothing_to_do", `You're already on ${record.branch}.`);
      const elsewhere = elsewhereRefusal(kind, branch);
      if (elsewhere) return elsewhere;
      if (isDirty(state.workingTree)) return refuse(kind, "dirty", "You have uncommitted changes. Commit or stash them first.");
      return plan({ ...base, title: "Switch back", summary: `Switch back to ${record.branch}.`, details: [], steps: [{ op: "switch", branch: record.branch }], branch: record.branch });
    }
    case "delete_created_branch": {
      const branch = state.branches.find((b) => b.name === record.name);
      if (!branch) return refuse(kind, "nothing_to_do", `${record.name} is already gone.`);
      if (branch.tipSha !== record.sha) return refuse(kind, "cannot_undo", `${record.name} has new commits now. Delete it from the Branches tab if you mean to.`);
      if (branch.isCurrent) return refuse(kind, "current_branch", `You're on ${record.name}. Switch to another branch first.`);
      const elsewhere = elsewhereRefusal(kind, branch);
      if (elsewhere) return elsewhere;
      return plan({ ...base, title: "Undo create branch", summary: `Delete ${record.name}, which has nothing new on it.`, details: [], steps: [{ op: "branch_delete", name: record.name, expectSha: record.sha }], branch: record.name, counts: { branches: 1 } });
    }
    case "restore_remote_branch": {
      if (state.remoteBranches.some((b) => b.remote === record.remote && b.name === record.name)) return refuse(kind, "exists", `${record.remote}/${record.name} exists again already.`);
      if (facts.objectExists === false) return gone();
      return plan({ ...base, network: true, title: "Restore remote branch", summary: `Push ${record.sha.slice(0, 7)} back to ${record.remote} as ${record.name}.`, details: ["Creates the branch again; nothing is overwritten."], steps: [{ op: "push_sha", remote: record.remote, sha: record.sha, branch: record.name }], branch: record.name, counts: { branches: 1 } });
    }
  }
}

/** One entry point for every request except undo (which needs its journal record). */
export function planOperation(state: RepoState, request: OperationRequest): PlanResult {
  if (!state.isRepo) return refuse(request.kind, "not_a_repo", state.reason);
  switch (request.kind) {
    case "fetch":
      return planFetch(state, request);
    case "pull":
      return planPull(state);
    case "fast_forward":
      return planFastForward(state, request);
    case "push":
      return planPush(state, request);
    case "commit":
      return planCommit(state, request);
    case "stash":
      return planStash(state, request);
    case "stash_pop":
      return planStashPop(state, request);
    case "switch":
      return planSwitch(state, request);
    case "create_branch":
      return planCreateBranch(state, request);
    case "delete_branch":
      return planDeleteBranch(state, request);
    case "delete_remote_branch":
      return planDeleteRemoteBranch(state, request);
    case "discard":
      return planDiscard(state, request);
    case "undo":
      return refuse("undo", "invalid_request", "Undo is planned from its journal record.");
  }
}

export interface BulkCandidate {
  projectId: string;
  state: RepoState;
}

export interface PullAllSelection {
  pull: Array<{ projectId: string; plan: OperationPlan }>;
  skipped: Array<{ projectId: string; reason: string }>;
}

/** "Pull all": only clean projects that can fast-forward; everything else is reported with its reason. */
export function selectPullAll(candidates: readonly BulkCandidate[]): PullAllSelection {
  const out: PullAllSelection = { pull: [], skipped: [] };
  for (const { projectId, state } of candidates) {
    if (!state.isRepo) {
      out.skipped.push({ projectId, reason: state.reason });
      continue;
    }
    if (isDirty(state.workingTree)) {
      out.skipped.push({ projectId, reason: "has uncommitted changes" });
      continue;
    }
    const branch = currentBranch(state);
    const counts = branch?.upstream?.counts;
    if (counts && counts.behind === 0) {
      out.skipped.push({ projectId, reason: "nothing to pull as of the last fetch" });
      continue;
    }
    if (counts && counts.ahead > 0) {
      out.skipped.push({ projectId, reason: counts.behind > 0 ? "diverged" : "has commits to push" });
      continue;
    }
    const result = planPull(state);
    if (result.refused) out.skipped.push({ projectId, reason: result.reason });
    else out.pull.push({ projectId, plan: result });
  }
  return out;
}
