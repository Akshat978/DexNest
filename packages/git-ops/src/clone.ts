// "Clone from GitHub": paste a URL, pick a parent folder, clone - network,
// and only when the owner clicks. The new folder then goes through the
// add-project wizard like any other.
//
// Checked before git runs: the URL (https or ssh only, no credentials in
// it, never a transport that runs a program), the parent folder (exists,
// is a folder, not inside DexNest's data root - by path or through a link),
// the new folder's name (one plain path segment that doesn't exist yet), and
// whether the same repository is already a project.

import { join } from "node:path";

import type { EventLog } from "@dexnest/foundation";
import {
  checkCloneUrl,
  redactCredentials,
  PROJECTS_EVENT_STREAM,
  PROJECTS_MODULE_ID,
  type CloneRequest,
  type CloneResult,
  type DuplicateLookup,
  type GitRunner,
  type InspectFsPort
} from "@dexnest/projects";

import { MUTATING_PREFIX, UnsafeGitArgv } from "./argv.ts";
import { classifyFailure, mutatingEnv, type FailureCode } from "./env.ts";

export interface CloneDeps {
  runner: GitRunner;
  fs: Pick<InspectFsPort, "kind" | "realpath">;
  isSensitive(path: string): boolean;
  store: DuplicateLookup;
  events: EventLog;
  /** Tests clone from a local bare repository. Never set in the app. */
  allowLocalUrls?: boolean;
  environmentSetsSsh?: boolean;
  timeoutMs?: number;
  newOpId?: () => string;
}

export type CloneInput = CloneRequest;
export type { CloneResult };

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function checkFolderName(name: string): { ok: true } | { ok: false; reason: string } {
  if (!name || name.length > 120) return { ok: false, reason: "Give the new folder a name." };
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return { ok: false, reason: "Folder names can't contain < > : \" / \\ | ? * or control characters." };
  if (name === "." || name === ".." || name.startsWith("-") || name.endsWith(".") || name.endsWith(" ")) return { ok: false, reason: "That isn't a folder name DexNest will use." };
  if (WINDOWS_RESERVED.test(name)) return { ok: false, reason: `${name} is a reserved name on Windows.` };
  return { ok: true };
}

/** The one clone shape git-ops runs: `clone --no-recurse-submodules -- <checked url> <absolute new folder>`. */
export function cloneArgv(url: string, dest: string): string[] {
  return [...MUTATING_PREFIX, "clone", "--no-recurse-submodules", "--", url, dest];
}

export function assertSafeCloneArgv(args: readonly string[], options: { allowLocal?: boolean } = {}): void {
  for (let i = 0; i < MUTATING_PREFIX.length; i += 1) {
    if (args[i] !== MUTATING_PREFIX[i]) throw new UnsafeGitArgv("git-ops argv must start with its own fixed options");
  }
  const rest = args.slice(MUTATING_PREFIX.length);
  if (rest.length !== 5 || rest[0] !== "clone" || rest[1] !== "--no-recurse-submodules" || rest[2] !== "--") throw new UnsafeGitArgv("git-ops refuses this clone shape");
  if (!checkCloneUrl(rest[3], { allowLocal: options.allowLocal }).ok) throw new UnsafeGitArgv("git-ops refuses this clone URL");
  if (rest[4].startsWith("-")) throw new UnsafeGitArgv("git-ops refuses this clone destination");
}

export async function cloneRepository(input: CloneInput, deps: CloneDeps): Promise<CloneResult> {
  const url = checkCloneUrl(input.url, { allowLocal: deps.allowLocalUrls });
  if (!url.ok) return { status: "refused", reason: url.reason };
  const existing = deps.store.findByRemote(url.url);
  if (existing) return { status: "refused", reason: `${existing.name} is already a project for this repository.`, duplicateOf: { id: existing.id, name: existing.name } };

  const parent = input.parentDir.trim();
  if (!parent) return { status: "refused", reason: "Choose a folder to clone into." };
  if (deps.isSensitive(parent)) return { status: "refused", reason: "That folder is inside DexNest's own data folder. Projects never go there." };
  if (deps.fs.kind(parent) !== "dir") return { status: "refused", reason: "That folder doesn't exist." };
  let realParent: string;
  try {
    realParent = deps.fs.realpath(parent);
  } catch {
    return { status: "refused", reason: "That folder can't be opened." };
  }
  if (deps.isSensitive(realParent)) return { status: "refused", reason: "That folder leads into DexNest's own data folder (through a link). Projects never go there." };

  const folderName = (input.folderName ?? url.parsed?.repo ?? url.parsed?.path.split("/").pop() ?? "").trim();
  const nameCheck = checkFolderName(folderName);
  if (!nameCheck.ok) return { status: "refused", reason: nameCheck.reason };
  const dest = join(realParent, folderName);
  if (deps.fs.kind(dest) !== "missing") return { status: "refused", reason: `${folderName} already exists in that folder. Choose another name, or add the existing folder instead.` };

  const args = cloneArgv(url.url, dest);
  assertSafeCloneArgv(args, { allowLocal: deps.allowLocalUrls });
  const opId = deps.newOpId?.() ?? `clone_${Date.now()}`;
  const emit = (type: string, payload: Record<string, string | number | boolean | null>) =>
    deps.events.append({ type, stream: PROJECTS_EVENT_STREAM, module: PROJECTS_MODULE_ID, subject: null, source: input.source, payload });
  emit("projects.op.started", { opId, projectId: null, verb: "clone", network: true });

  const started = Date.now();
  const output: string[] = [];
  const result = await deps.runner.run({
    cwd: realParent,
    args,
    env: mutatingEnv({ overrideSsh: !deps.environmentSetsSsh }),
    timeoutMs: deps.timeoutMs ?? 30 * 60_000,
    maxBytes: 1024 * 1024,
    signal: input.signal
  });
  for (const line of redactCredentials(`${result.stdout}\n${result.stderr}`).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (output.length < 400) output.push(line);
    input.onOutput?.(line);
  }
  let outcome: Extract<CloneResult, { status: "done" }>["outcome"] = "succeeded";
  let message = `Cloned into ${dest}.`;
  let errorCode: FailureCode | null = null;
  if (result.cancelled) {
    outcome = "cancelled";
    message = "Cancelled. Git removes a partly cloned folder itself; check the folder before trying again.";
  } else if (result.timedOut) {
    outcome = "timed_out";
    message = "The clone took too long and was stopped.";
  } else if (result.notFound) {
    outcome = "failed";
    errorCode = "failed";
    message = "Git isn't installed, or isn't on PATH.";
  } else if (result.exitCode !== 0) {
    const failure = classifyFailure(result.stderr, result.stdout);
    outcome = failure.code === "auth_needed" ? "auth_needed" : "failed";
    errorCode = failure.code;
    message = failure.code === "auth_needed" ? "Authentication needed - open a terminal in the parent folder and clone once yourself." : failure.message;
  }
  emit("projects.op.finished", { opId, projectId: null, verb: "clone", outcome, durationMs: Date.now() - started, errorCode });
  return { status: "done", outcome, path: dest, message, errorCode, output };
}
