/**
 * Hard denylist of destructive / network-mutating Git verbs.
 * Read-only inspection must never invoke these.
 */

const FORBIDDEN = new Set(
  [
    'pull',
    'fetch',
    'push',
    'checkout',
    'switch',
    'reset',
    'clean',
    'merge',
    'rebase',
    'commit',
    'add',
    'stash',
    'tag',
    'cherry-pick',
    'revert',
    'am',
    'bisect', // mutating start; we only *detect* bisect via files
  ].map((s) => s.toLowerCase()),
);

export function assertReadOnlyGitArgv(argv: readonly string[]): void {
  // Expect: git [<global opts>] <verb> ...
  let i = 0;
  if (argv[i]?.toLowerCase() === 'git') i += 1;
  while (i < argv.length && argv[i]!.startsWith('-')) {
    // skip global options like -C, -c; if -C takes a value, skip next
    const opt = argv[i]!;
    if (opt === '-C' || opt === '-c') {
      i += 2;
      continue;
    }
    i += 1;
  }
  const verb = (argv[i] ?? '').toLowerCase();
  if (FORBIDDEN.has(verb)) {
    throw new Error(`forbidden git verb in read-only path: ${verb}`);
  }
}

export function isForbiddenGitVerb(verb: string): boolean {
  return FORBIDDEN.has(verb.toLowerCase());
}

export { FORBIDDEN as FORBIDDEN_GIT_VERBS };
