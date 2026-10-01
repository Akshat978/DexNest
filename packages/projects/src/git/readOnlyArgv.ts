// The read engine's allowlist. Every git command @dexnest/projects runs goes
// through assertReadOnlyGitArgv before it is spawned.
//
// An allowlist, not a denylist (Developer Intelligence's forbidden.ts is a
// denylist): a verb is accepted only if it is listed here, and several verbs
// that can both read and write (`stash`, `worktree`, `remote`, `config`) are
// accepted only in their reading form. Options that make a reading command run
// a program or write a file (`--output`, `--ext-diff`, `--textconv`,
// `--upload-pack`, `--exec`) are refused wherever they appear.

export class ReadOnlyGitViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyGitViolation";
  }
}

/** Global options the engine itself adds before the verb. Nothing else may precede it. */
const GLOBAL_OPTIONS: ReadonlyArray<readonly string[]> = [
  ["-c", "core.fsmonitor=false"],
  ["-c", "color.ui=false"],
  ["-c", "core.quotepath=false"],
  ["--no-optional-locks"]
];

const FORBIDDEN_ANYWHERE = [/^--output(=|$)/, /^--ext-diff$/, /^--textconv$/, /^--upload-pack/, /^--receive-pack/, /^--exec(=|$)/, /^--open-files-in-pager/];

type VerbRule = (rest: readonly string[]) => string | null;

const any: VerbRule = () => null;

const firstIn = (allowed: readonly string[]): VerbRule => (rest) =>
  rest.length > 0 && allowed.includes(rest[0]) ? null : `only '${allowed.join("', '")}' may follow`;

const READ_VERBS: Record<string, VerbRule> = {
  "rev-parse": any,
  status: (rest) => (rest.some((a) => a.startsWith("--porcelain")) ? null : "status must be --porcelain"),
  "for-each-ref": any,
  "rev-list": any,
  log: any,
  "merge-base": any,
  "ls-files": any,
  diff: (rest) =>
    rest.includes("--no-ext-diff") && rest.includes("--no-textconv") && rest.some((a) => ["--numstat", "--name-only", "--name-status", "--shortstat"].includes(a))
      ? null
      : "diff is for stats only, with --no-ext-diff --no-textconv",
  "cat-file": (rest) => (rest[0] === "-e" || rest[0] === "-t" ? null : "cat-file -e/-t only"),
  stash: firstIn(["list", "show"]),
  worktree: firstIn(["list"]),
  remote: (rest) => (rest.length === 0 || (rest.length === 1 && rest[0] === "-v") || rest[0] === "get-url" ? null : "remote: list or get-url only"),
  config: (rest) => {
    const getters = ["--get", "--get-all", "--get-regexp"];
    let i = 0;
    if (rest[i] === "--file" || rest[i] === "-f") i += 2;
    if (rest[i] === "--null" || rest[i] === "-z") i += 1;
    return getters.includes(rest[i] ?? "") ? null : "config: --get, --get-all or --get-regexp only";
  },
  version: any
};

export const READ_ONLY_GIT_VERBS: readonly string[] = Object.keys(READ_VERBS);

/** Throws ReadOnlyGitViolation unless `args` (without the leading `git`) is a reading command. */
export function assertReadOnlyGitArgv(args: readonly string[]): void {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const option = GLOBAL_OPTIONS.find((candidate) => candidate.every((part, k) => args[i + k] === part));
    if (!option) throw new ReadOnlyGitViolation(`git option not allowed before the verb: ${args[i]}`);
    i += option.length;
  }
  const verb = args[i];
  if (verb === undefined) throw new ReadOnlyGitViolation("no git verb");
  const rule = READ_VERBS[verb];
  if (!rule) throw new ReadOnlyGitViolation(`git verb not allowed in the read-only engine: ${verb}`);
  const rest = args.slice(i + 1);
  for (const arg of rest) {
    if (FORBIDDEN_ANYWHERE.some((pattern) => pattern.test(arg))) throw new ReadOnlyGitViolation(`git option not allowed: ${arg}`);
  }
  const problem = rule(rest);
  if (problem) throw new ReadOnlyGitViolation(`git ${verb}: ${problem}`);
}

export function isReadOnlyGitArgv(args: readonly string[]): boolean {
  try {
    assertReadOnlyGitArgv(args);
    return true;
  } catch {
    return false;
  }
}
