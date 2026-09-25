/**
 * Fail-closed argv policy for configured health checks (EC-049).
 * Reject interactive / watch-mode misconfigs before spawn so they cannot hang
 * a scan waiting only on timeout/cancel.
 */

export type ArgvRejectReason =
  | 'interactive_flag'
  | 'watch_mode'
  | 'repl_shell'
  | 'infinite_serve'
  | 'empty_argv';

export interface ArgvPolicyResult {
  allowed: boolean;
  reason?: ArgvRejectReason;
  detail?: string;
}

const INTERACTIVE_FLAGS = new Set([
  '-i',
  '--interactive',
  '--stdin',
  '-it',
  '-ti',
]);

const WATCH_FLAGS = new Set([
  '--watch',
  '-w',
  '--watchall',
  '--watch-all',
  '--watchmode',
  '--watch-mode',
  '--hot',
  '--hmr',
]);

const REPL_OR_SHELL = new Set([
  'repl',
  'node-repl',
  'python-repl',
  'irb',
  'pry',
]);

const LONG_LIVED_TOOLS = new Set([
  'nodemon',
  'webpack-dev-server',
  'vite',
  'next',
  'storybook',
  'parcel',
  'chokidar',
]);

const LONG_LIVED_SUBCOMMANDS = new Set([
  'serve',
  'dev',
  'start:dev',
  'start-dev',
  'develop',
]);

const ONE_SHOT_SUBCOMMANDS = new Set([
  'build',
  'lint',
  'test',
  'check',
  'typecheck',
  '--version',
  '-v',
  'version',
]);

function basename(t: string): string {
  const parts = t.split(/[/\\]/);
  return (parts[parts.length - 1] ?? t).toLowerCase();
}

/**
 * Returns whether a configured health argv is safe to run as a bounded check.
 */
export function evaluateHealthArgv(argv: readonly string[]): ArgvPolicyResult {
  if (!argv.length || !argv[0]) {
    return { allowed: false, reason: 'empty_argv', detail: 'empty argv' };
  }

  const tokens = argv.map((t) => t.trim()).filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase());

  for (const t of tokens) {
    const l = t.toLowerCase();
    if (INTERACTIVE_FLAGS.has(l)) {
      return {
        allowed: false,
        reason: 'interactive_flag',
        detail: `interactive flag: ${t}`,
      };
    }
    if (WATCH_FLAGS.has(l)) {
      return {
        allowed: false,
        reason: 'watch_mode',
        detail: `watch flag: ${t}`,
      };
    }
  }

  // npm/pnpm/yarn/npx/bun run <script>
  for (let i = 0; i < lower.length; i++) {
    const t = lower[i]!;
    if (
      (t === 'npm' ||
        t === 'pnpm' ||
        t === 'yarn' ||
        t === 'npx' ||
        t === 'bun') &&
      lower[i + 1] === 'run' &&
      lower[i + 2]
    ) {
      const script = lower[i + 2]!;
      if (
        script.includes('watch') ||
        script === 'dev' ||
        script === 'serve' ||
        script.startsWith('dev:') ||
        script.startsWith('serve:')
      ) {
        return {
          allowed: false,
          reason: 'watch_mode',
          detail: `package script looks long-lived: ${tokens[i + 2]}`,
        };
      }
    }
  }

  for (const t of lower) {
    if (REPL_OR_SHELL.has(t)) {
      return {
        allowed: false,
        reason: 'repl_shell',
        detail: `repl/shell token: ${t}`,
      };
    }
  }

  const exe0 = basename(tokens[0]!);
  if (LONG_LIVED_TOOLS.has(exe0)) {
    const hasOneShot = lower.some((x) => ONE_SHOT_SUBCOMMANDS.has(x));
    if (!hasOneShot) {
      return {
        allowed: false,
        reason: 'infinite_serve',
        detail: `long-lived tool without one-shot subcommand: ${tokens[0]}`,
      };
    }
  }

  for (let i = 1; i < lower.length; i++) {
    if (LONG_LIVED_SUBCOMMANDS.has(lower[i]!)) {
      return {
        allowed: false,
        reason: 'infinite_serve',
        detail: `long-lived subcommand: ${tokens[i]}`,
      };
    }
  }

  return { allowed: true };
}

export function assertHealthArgvAllowed(argv: readonly string[]): void {
  const r = evaluateHealthArgv(argv);
  if (!r.allowed) {
    throw new HealthArgvRejectedError(
      r.reason ?? 'interactive_flag',
      r.detail,
    );
  }
}

export class HealthArgvRejectedError extends Error {
  readonly code = 'HEALTH_ARGV_REJECTED' as const;
  constructor(
    readonly reason: ArgvRejectReason,
    detail?: string,
  ) {
    super(
      `health argv rejected (${reason})${detail ? `: ${detail}` : ''} — fail-closed`,
    );
    this.name = 'HealthArgvRejectedError';
  }
}
