// Capability policy.
//
// Deterministic, pure, and the single place authority is decided. No LLM is
// consulted; the result depends only on the run's capabilities and the intent.
//
// SCOPE — read this before trusting it:
// This enforces what Autopilot itself will DO. It is an orchestrator policy, not
// an OS sandbox. Once a child process with full user rights is running, that
// process can reach anything the user can reach, and nothing here constrains it.
// See docs/AUTOPILOT_ARCHITECTURE.md section 11 for the exact boundary.

import { canonicalize, contains, samePath, type CanonicalPath } from "./paths.ts";
import { describeIntent, executableName, type Intent } from "./intent.ts";

export type PolicyDecisionKind = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  /** Stable identifier of the rule that decided, for audit and tests. */
  rule: string;
  reason: string;
  capability: string;
  risk: RiskLevel;
  /** Canonical target the decision was made about. */
  normalizedTarget: string | null;
  /** Present only for REQUIRE_APPROVAL: one line a human can act on. */
  approvalSummary?: string;
  /** Whether a DENY blocks run progress and therefore deserves attention. */
  blocking?: boolean;
}

export interface CommandRule {
  /** Executable name without extension, e.g. "git", "pnpm". */
  executable: string;
  /** First-argument subcommand, e.g. "push". Omit to match any. */
  subcommand?: string;
  /** Substring that must appear in the joined args for the rule to apply. */
  argContains?: string;
  decision: PolicyDecisionKind;
  reason: string;
  risk: RiskLevel;
}

/**
 * The enforced capability policy for a run.
 *
 * Immutable for the active Run Spec revision: the engine never rewrites it, and
 * an approval grants one operation, never a broader standing permission.
 */
export interface CapabilityPolicy {
  /** The run's isolated worktree. The only repository the run may write. */
  workspaceRoot: string | null;
  /** Run-scoped scratch/artifact directory. */
  scratchRoot: string | null;
  readRoots: string[];
  writeRoots: string[];
  denyRoots: string[];

  allowedCommands: CommandRule[];
  deniedCommands: CommandRule[];
  approvalCommands: CommandRule[];
  /** Executables with no matching rule: deny by default. */
  defaultCommandDecision: PolicyDecisionKind;

  git: {
    allowLocal: boolean;
    allowRemote: boolean;
    allowDestructive: boolean;
  };

  environment: {
    allow: string[];
    /** Matched case-insensitively as substrings of the variable name. */
    stripPatterns: string[];
  };

  /** Approval required before any external effect leaves the machine. */
  externalEffects: "forbidden" | "requires_approval";
}

/**
 * Roots denied for every run, regardless of Run Spec. The DexNest data root is
 * the important one: it holds the vault, finance records and the DPAPI
 * integration keychain, and source-code access never implies data access.
 *
 * The absolute path is included unconditionally because DexNest resolves
 * CANONICAL_DATA_ROOT by absolute path from any launch location (Phase 0
 * finding), so a run working inside a worktree elsewhere can still name it.
 */
export const ALWAYS_DENIED_ROOTS: readonly string[] = [
  "D:/DeskNest/local-data",
  "C:/Windows",
  "C:/Program Files",
  "C:/Program Files (x86)"
];

/** Path fragments that are denied wherever they appear. */
export const ALWAYS_DENIED_FRAGMENTS: readonly string[] = [".ssh", ".aws", ".gnupg", ".npmrc", ".git-credentials"];

/** Environment variables never passed to a dispatched command. */
export const DEFAULT_ENV_STRIP_PATTERNS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "DEXNEST_",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "APIKEY",
  "API_KEY",
  "CREDENTIAL",
  "PRIVATE_KEY"
];

/**
 * Minimal environment a toolchain genuinely needs on Windows.
 *
 * Tradeoff, stated plainly: USERPROFILE and APPDATA are preserved because most
 * toolchains fail without them, yet they also name directories this policy
 * denies. That is not a contradiction — path policy governs what Autopilot will
 * do, while these variables only tell a child process where its own config
 * lives. It does mean a future child process could use them to find files
 * Autopilot would not open itself. See section W of the Phase 2 report.
 */
export const DEFAULT_ENV_ALLOW: readonly string[] = [
  "PATH",
  "Path",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "LANG",
  "LC_ALL"
];

/** Commands denied for every run. Destructive, remote, or system-level. */
export const BASELINE_DENIED_COMMANDS: readonly CommandRule[] = [
  { executable: "git", subcommand: "push", decision: "DENY", reason: "Remote git operations are not permitted.", risk: "critical" },
  { executable: "git", subcommand: "remote", decision: "DENY", reason: "Remote configuration changes are not permitted.", risk: "high" },
  { executable: "git", subcommand: "clean", decision: "DENY", reason: "Destructive working-tree cleaning is not permitted.", risk: "high" },
  { executable: "git", subcommand: "reset", argContains: "--hard", decision: "DENY", reason: "Hard reset discards work irreversibly.", risk: "high" },
  { executable: "git", subcommand: "branch", argContains: "-D", decision: "DENY", reason: "Branch deletion is not permitted.", risk: "high" },
  { executable: "npm", subcommand: "publish", decision: "DENY", reason: "Publishing is not permitted.", risk: "critical" },
  { executable: "pnpm", subcommand: "publish", decision: "DENY", reason: "Publishing is not permitted.", risk: "critical" },
  { executable: "yarn", subcommand: "publish", decision: "DENY", reason: "Publishing is not permitted.", risk: "critical" },
  { executable: "gh", subcommand: "pr", argContains: "merge", decision: "DENY", reason: "Merging pull requests is not permitted.", risk: "critical" },
  { executable: "vercel", decision: "DENY", reason: "Deployment tooling is not permitted.", risk: "critical" },
  { executable: "netlify", decision: "DENY", reason: "Deployment tooling is not permitted.", risk: "critical" },
  { executable: "docker", decision: "DENY", reason: "Container tooling is not permitted.", risk: "high" },
  { executable: "kubectl", decision: "DENY", reason: "Cluster tooling is not permitted.", risk: "critical" },
  { executable: "shutdown", decision: "DENY", reason: "System power operations are not permitted.", risk: "critical" },
  { executable: "taskkill", decision: "DENY", reason: "Process termination must use the owned-process path.", risk: "high" },
  { executable: "reg", decision: "DENY", reason: "Registry access is not permitted.", risk: "critical" },
  { executable: "cipher", decision: "DENY", reason: "Disk-level tooling is not permitted.", risk: "critical" },
  { executable: "format", decision: "DENY", reason: "Disk-level tooling is not permitted.", risk: "critical" },
  { executable: "rd", decision: "DENY", reason: "Recursive directory removal is not permitted.", risk: "high" },
  { executable: "rmdir", decision: "DENY", reason: "Recursive directory removal is not permitted.", risk: "high" },
  { executable: "del", decision: "DENY", reason: "Shell deletion is not permitted.", risk: "high" },
  { executable: "curl", decision: "DENY", reason: "Arbitrary network transfer is not permitted.", risk: "high" },
  { executable: "wget", decision: "DENY", reason: "Arbitrary network transfer is not permitted.", risk: "high" },
  // Shells are denied because a shell defeats structured-argument policy
  // entirely: the arguments become an opaque program.
  { executable: "cmd", decision: "DENY", reason: "Shells bypass structured command policy.", risk: "critical" },
  { executable: "powershell", decision: "DENY", reason: "Shells bypass structured command policy.", risk: "critical" },
  { executable: "pwsh", decision: "DENY", reason: "Shells bypass structured command policy.", risk: "critical" },
  { executable: "bash", decision: "DENY", reason: "Shells bypass structured command policy.", risk: "critical" },
  { executable: "sh", decision: "DENY", reason: "Shells bypass structured command policy.", risk: "critical" },
  { executable: "wscript", decision: "DENY", reason: "Script hosts bypass structured command policy.", risk: "critical" },
  { executable: "cscript", decision: "DENY", reason: "Script hosts bypass structured command policy.", risk: "critical" }
];

/** Commands that are permitted only with explicit human approval. */
export const BASELINE_APPROVAL_COMMANDS: readonly CommandRule[] = [
  { executable: "npm", subcommand: "install", decision: "REQUIRE_APPROVAL", reason: "Installing packages changes the dependency tree.", risk: "medium" },
  { executable: "pnpm", subcommand: "install", decision: "REQUIRE_APPROVAL", reason: "Installing packages changes the dependency tree.", risk: "medium" },
  { executable: "pnpm", subcommand: "add", decision: "REQUIRE_APPROVAL", reason: "Adding a dependency changes the dependency tree.", risk: "medium" },
  { executable: "npm", subcommand: "add", decision: "REQUIRE_APPROVAL", reason: "Adding a dependency changes the dependency tree.", risk: "medium" }
];

export function defaultCapabilityPolicy(): CapabilityPolicy {
  return {
    workspaceRoot: null,
    scratchRoot: null,
    readRoots: [],
    writeRoots: [],
    denyRoots: [...ALWAYS_DENIED_ROOTS],
    allowedCommands: [],
    deniedCommands: [...BASELINE_DENIED_COMMANDS],
    approvalCommands: [...BASELINE_APPROVAL_COMMANDS],
    defaultCommandDecision: "DENY",
    git: { allowLocal: true, allowRemote: false, allowDestructive: false },
    environment: { allow: [...DEFAULT_ENV_ALLOW], stripPatterns: [...DEFAULT_ENV_STRIP_PATTERNS] },
    externalEffects: "requires_approval"
  };
}

function deny(rule: string, reason: string, capability: string, risk: RiskLevel, target: string | null): PolicyDecision {
  return { decision: "DENY", rule, reason, capability, risk, normalizedTarget: target, blocking: true };
}

function allow(rule: string, capability: string, target: string | null): PolicyDecision {
  return { decision: "ALLOW", rule, reason: "Permitted by the run's capabilities.", capability, risk: "low", normalizedTarget: target };
}

function requireApproval(
  rule: string,
  reason: string,
  capability: string,
  risk: RiskLevel,
  target: string | null,
  summary: string
): PolicyDecision {
  return { decision: "REQUIRE_APPROVAL", rule, reason, capability, risk, normalizedTarget: target, approvalSummary: summary, blocking: true };
}

/** Denied roots that apply to every run plus the run's own deny list. */
function effectiveDenyRoots(policy: CapabilityPolicy, windows: boolean): CanonicalPath[] {
  return [...ALWAYS_DENIED_ROOTS, ...policy.denyRoots].map((root) => canonicalize(root, { windows }));
}

export interface PathAccessRequest {
  path: string;
  mode: "read" | "write";
}

/**
 * Path authorization.
 *
 * Order matters: deny wins over allow, always. A path inside the workspace that
 * is also inside a denied root is denied.
 */
export function evaluatePathAccess(
  policy: CapabilityPolicy,
  request: PathAccessRequest,
  options: { windows?: boolean } = {}
): PolicyDecision {
  const windows = options.windows ?? true;
  const target = canonicalize(request.path, { windows });
  const capability = request.mode === "write" ? "fs.write" : "fs.read";

  if (!target.absolute || !target.key) {
    return deny("path.not-absolute", "Only absolute, canonical paths may be accessed.", capability, "medium", target.key || null);
  }

  for (const denied of effectiveDenyRoots(policy, windows)) {
    if (contains(denied, target, windows)) {
      const isDataRoot = samePath(denied, canonicalize("D:/DeskNest/local-data", { windows }), windows);
      return deny(
        isDataRoot ? "path.dexnest-local-data" : "path.denied-root",
        isDataRoot
          ? "DexNest local-data holds vault, finance and credential data. Source access never implies data access."
          : `Path is inside a denied root (${denied.display}).`,
        capability,
        "critical",
        target.display
      );
    }
  }

  for (const fragment of ALWAYS_DENIED_FRAGMENTS) {
    const needle = windows ? fragment.toLowerCase() : fragment;
    if (target.key.split("/").includes(needle)) {
      return deny("path.sensitive-fragment", `Paths containing "${fragment}" hold credentials and are never accessible.`, capability, "critical", target.display);
    }
  }

  const roots = request.mode === "write"
    ? [policy.workspaceRoot, policy.scratchRoot, ...policy.writeRoots]
    : [policy.workspaceRoot, policy.scratchRoot, ...policy.writeRoots, ...policy.readRoots];

  for (const root of roots) {
    if (!root) continue;
    if (contains(canonicalize(root, { windows }), target, windows)) {
      return allow(request.mode === "write" ? "path.write-root" : "path.read-root", capability, target.display);
    }
  }

  return deny(
    request.mode === "write" ? "path.outside-write-roots" : "path.outside-read-roots",
    `Path is outside every root this run may ${request.mode}.`,
    capability,
    "high",
    target.display
  );
}

function matchesRule(rule: CommandRule, name: string, args: string[], windows: boolean): boolean {
  if (executableName(rule.executable, windows) !== name) return false;
  if (rule.subcommand) {
    const first = (args[0] ?? "").toLowerCase();
    if (first !== rule.subcommand.toLowerCase()) return false;
  }
  if (rule.argContains) {
    const joined = args.join(" ").toLowerCase();
    if (!joined.includes(rule.argContains.toLowerCase())) return false;
  }
  return true;
}

/**
 * Command authorization.
 *
 * Evaluation order: working directory, then deny rules, then approval rules,
 * then allow rules, then the default. Arguments that name a path are checked
 * against path policy — an honest, bounded check, not general command
 * semantics: an argument that only implies a path (a config file naming another
 * file, say) is not analysed, and that limitation is documented rather than
 * papered over.
 */
export function evaluateCommand(
  policy: CapabilityPolicy,
  intent: { executable: string; args: string[]; cwd: string },
  options: { windows?: boolean } = {}
): PolicyDecision {
  const windows = options.windows ?? true;
  const name = executableName(intent.executable, windows);
  const target = `${name} ${intent.args.join(" ")}`.trim();

  // The working directory must itself be a permitted write root: a safe command
  // run in the wrong place is not a safe command.
  const cwdDecision = evaluatePathAccess(policy, { path: intent.cwd, mode: "write" }, { windows });
  if (cwdDecision.decision !== "ALLOW") {
    return deny("command.cwd-outside-workspace", `Working directory is not writable by this run: ${cwdDecision.reason}`, "command.run", "high", target);
  }

  if (!name) {
    return deny("command.no-executable", "A command intent must name an executable.", "command.run", "medium", target);
  }

  for (const rule of [...policy.deniedCommands, ...BASELINE_DENIED_COMMANDS]) {
    if (matchesRule(rule, name, intent.args, windows)) {
      return deny("command.denied", rule.reason, "command.run", rule.risk, target);
    }
  }

  // Any argument that looks like an absolute path must survive path policy.
  for (const arg of intent.args) {
    if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(arg)) continue;
    const argDecision = evaluatePathAccess(policy, { path: arg, mode: "write" }, { windows });
    if (argDecision.decision === "DENY" && argDecision.rule.startsWith("path.")) {
      const critical = argDecision.risk === "critical";
      if (critical) {
        return deny("command.arg-denied-path", `A command argument targets a denied path: ${argDecision.reason}`, "command.run", "critical", target);
      }
    }
  }

  for (const rule of [...policy.approvalCommands, ...BASELINE_APPROVAL_COMMANDS]) {
    if (matchesRule(rule, name, intent.args, windows)) {
      return requireApproval("command.requires-approval", rule.reason, "command.run", rule.risk, target, `Run: ${target}`);
    }
  }

  for (const rule of policy.allowedCommands) {
    if (matchesRule(rule, name, intent.args, windows)) {
      return allow("command.allowed", "command.run", target);
    }
  }

  if (policy.defaultCommandDecision === "ALLOW") {
    return allow("command.default-allow", "command.run", target);
  }
  if (policy.defaultCommandDecision === "REQUIRE_APPROVAL") {
    return requireApproval("command.default-approval", "This command is not in the run's allowed set.", "command.run", "medium", target, `Run: ${target}`);
  }
  return deny("command.default-deny", "This command is not in the run's allowed set.", "command.run", "high", target);
}

const REMOTE_GIT_OPERATIONS = new Set(["push", "fetch", "pull", "clone", "remote", "submodule"]);
const DESTRUCTIVE_GIT_OPERATIONS = new Set(["clean", "reset", "rebase", "filter-branch", "gc", "prune"]);

export function evaluateGitOperation(
  policy: CapabilityPolicy,
  intent: { operation: string; args: string[]; cwd: string },
  options: { windows?: boolean } = {}
): PolicyDecision {
  const windows = options.windows ?? true;
  const operation = intent.operation.toLowerCase();
  const target = `git ${operation} ${intent.args.join(" ")}`.trim();

  const cwdDecision = evaluatePathAccess(policy, { path: intent.cwd, mode: "write" }, { windows });
  if (cwdDecision.decision !== "ALLOW") {
    return deny("git.cwd-outside-workspace", `Git working directory is not writable by this run: ${cwdDecision.reason}`, "git", "high", target);
  }
  if (REMOTE_GIT_OPERATIONS.has(operation) && !policy.git.allowRemote) {
    return deny("git.remote-forbidden", "This run may not perform remote git operations.", "git.remote", "critical", target);
  }
  if (DESTRUCTIVE_GIT_OPERATIONS.has(operation) && !policy.git.allowDestructive) {
    return deny("git.destructive-forbidden", "This run may not perform destructive git operations.", "git.destructive", "high", target);
  }
  if (!policy.git.allowLocal) {
    return deny("git.local-forbidden", "This run may not perform git operations.", "git.local", "medium", target);
  }
  return allow("git.allowed", "git.local", target);
}

/** The single entry point. Every intent is evaluated here before dispatch. */
export function evaluateIntent(
  policy: CapabilityPolicy,
  intent: Intent,
  context: { ownedPids?: number[]; windows?: boolean } = {}
): PolicyDecision {
  const windows = context.windows ?? true;

  switch (intent.kind) {
    case "READ_FILE":
      return evaluatePathAccess(policy, { path: intent.path, mode: "read" }, { windows });
    case "WRITE_FILE":
      return evaluatePathAccess(policy, { path: intent.path, mode: "write" }, { windows });
    case "RUN_COMMAND":
      return evaluateCommand(policy, intent, { windows });
    case "GIT_OPERATION":
      return evaluateGitOperation(policy, intent, { windows });
    case "CREATE_WORKTREE": {
      const repo = canonicalize(intent.repoRoot, { windows });
      const worktree = canonicalize(intent.worktreePath, { windows });
      for (const denied of effectiveDenyRoots(policy, windows)) {
        if (contains(denied, worktree, windows)) {
          return deny("worktree.inside-denied-root", `A worktree may not be created inside ${denied.display}.`, "worktree.create", "critical", worktree.display);
        }
      }
      if (samePath(repo, worktree, windows) || contains(worktree, repo, windows)) {
        return deny(
          "worktree.equals-primary-checkout",
          "The primary checkout may never be used as an autonomous writable workspace.",
          "worktree.create",
          "critical",
          worktree.display
        );
      }
      if (contains(repo, worktree, windows)) {
        return deny(
          "worktree.inside-primary-checkout",
          "A run worktree must live outside the primary checkout so the primary checkout stays clean.",
          "worktree.create",
          "high",
          worktree.display
        );
      }
      return allow("worktree.create-allowed", "worktree.create", worktree.display);
    }
    case "REMOVE_WORKTREE": {
      const worktree = canonicalize(intent.worktreePath, { windows });
      if (policy.workspaceRoot && !samePath(canonicalize(policy.workspaceRoot, { windows }), worktree, windows)) {
        return deny("worktree.remove-foreign", "A run may only remove its own worktree.", "worktree.remove", "high", worktree.display);
      }
      return requireApproval(
        "worktree.remove-requires-approval",
        "Removing a worktree discards uncommitted work, so it is never automatic.",
        "worktree.remove",
        "high",
        worktree.display,
        `Remove worktree ${worktree.display}`
      );
    }
    case "TERMINATE_PROCESS": {
      const owned = context.ownedPids ?? [];
      if (!owned.includes(intent.pid)) {
        return deny(
          "process.not-owned",
          "A run may only terminate processes it started.",
          "process.terminate",
          "critical",
          String(intent.pid)
        );
      }
      return allow("process.owned", "process.terminate", String(intent.pid));
    }
    default: {
      const exhaustive: never = intent;
      return deny("intent.unknown", `Unknown intent: ${describeIntent(exhaustive as Intent)}`, "unknown", "critical", null);
    }
  }
}

/**
 * Builds the environment a dispatched command receives.
 *
 * Allowlist first, then strip patterns applied on top — so a variable that is
 * both allowed and secret-looking is still removed. Nothing is inherited
 * implicitly.
 */
export function buildEnvironment(policy: CapabilityPolicy, ambient: Record<string, string>): Record<string, string> {
  const allow = new Set(policy.environment.allow.map((name) => name.toLowerCase()));
  const strip = policy.environment.stripPatterns.map((pattern) => pattern.toLowerCase());
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(ambient)) {
    const lower = name.toLowerCase();
    if (!allow.has(lower)) continue;
    if (strip.some((pattern) => lower.includes(pattern))) continue;
    result[name] = value;
  }

  return result;
}
