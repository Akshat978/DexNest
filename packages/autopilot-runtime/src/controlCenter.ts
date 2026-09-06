import type { RuntimePorts } from "./ports.ts";
import type { AutopilotEngine } from "./engine.ts";
import type { ControlledWorkerTurns } from "./controlledWorker.ts";
import type { WorkerAvailability } from "./worker.ts";
import { claudeCodeProtocol } from "./claudeCodeWorker.ts";
import { codexProtocol } from "./codexWorker.ts";
import { defaultCapabilityPolicy, evaluatePathAccess } from "./policy.ts";
import { validateRoles, rolesFor, type CodingProvider } from "./roles.ts";
import { buildRunReport } from "./report.ts";
import { canonicalize } from "./paths.ts";
import { parsePlanText, type WorkspaceMode, type WorkerProfile } from "./runSpec.ts";
import { ProjectBranchManager } from "./projectBranch.ts";

export const CONTROL_TIERS = ["typecheck", "lint", "test", "integration", "build"] as const;
export interface NewRunForm {
  goal: string; projectPath: string; projectId?: string; primary: CodingProvider; consultant: CodingProvider | null;
  maxTurns: number; maxFailures: number; constraints: string[]; nonGoals: string[];
  /** Distinct pieces of work to authorize. Omit to bound by turns alone. */
  maxIterations?: number;
  /** The chat that writes assignments. Null keeps the agent self-directed. */
  director?: CodingProvider | null;
  /** Model alias or full name. Empty leaves the provider's own default. */
  model?: string;
  /** How hard the worker thinks per turn. Empty leaves the default. */
  effort?: string;
  acceptance: Array<{ text: string; tier: string | null }>;
  verification: Array<{ tier: string; enabled: boolean; executable: string; args: string[] }>;
  /** Defaults to the isolated worktree; see WorkspaceMode. */
  workspaceMode?: WorkspaceMode;
  /** Whether the worker gets its real tools. Defaults to mediated. */
  workerProfile?: WorkerProfile;
  /** The written plan, parsed into ordered items. Optional. */
  planText?: string;
}
export function validateNewRun(form: NewRunForm): NewRunForm {
  validateRoles(form?.primary, form?.consultant);
  if (typeof form.goal !== "string" || !form.goal.trim() || form.goal.length > 16000) throw new Error("Describe the task (up to 16000 characters).");
  if (typeof form.projectPath !== "string" || !/^(?:[A-Za-z]:[\\/]|\/)/.test(form.projectPath)) throw new Error("Choose an absolute project path.");
  const policy = defaultCapabilityPolicy(); policy.readRoots = [form.projectPath];
  if (evaluatePathAccess(policy, { path: form.projectPath, mode: "read" }).decision !== "ALLOW") throw new Error("Project path is denied by policy.");
  if (form.workspaceMode !== undefined && !["worktree", "project-branch"].includes(form.workspaceMode)) throw new Error("Choose a supported workspace mode.");
  if (form.workerProfile !== undefined && !["mediated", "agentic"].includes(form.workerProfile)) throw new Error("Choose a supported worker profile.");
  if (form.director != null && !["claude", "codex"].includes(form.director)) throw new Error("Choose a supported director.");
  if (form.model !== undefined && (typeof form.model !== "string" || form.model.length > 80 || /[\s"']/.test(form.model))) throw new Error("A model is a single name, with no spaces or quotes.");
  if (form.effort !== undefined && form.effort !== "" && !["low", "medium", "high", "xhigh", "max"].includes(form.effort)) throw new Error("Choose a supported effort level.");
  // A chat that is also doing the coding is not the split that makes chat
  // direction worth its extra call; it is the same session paying twice.
  if (form.director != null && form.director === form.primary) throw new Error("The director must be a different provider from the worker.");
  if (form.workerProfile === "agentic" && form.primary !== "claude") throw new Error("Only Claude Code can run with tools enabled today.");
  if (form.planText !== undefined && (typeof form.planText !== "string" || form.planText.length > 200_000)) throw new Error("The plan must be text of up to 200000 characters.");
  if (!Number.isInteger(form.maxTurns) || form.maxTurns < 1 || form.maxTurns > 50) throw new Error("Authorize 1 to 50 turns.");
  if (form.maxIterations !== undefined && (!Number.isInteger(form.maxIterations) || form.maxIterations < 1 || form.maxIterations > 50)) throw new Error("Authorize 1 to 50 iterations.");
  if (form.maxIterations !== undefined && form.maxIterations > form.maxTurns) throw new Error("The turn ceiling must be at least the number of iterations, since a piece of work can take several turns.");
  if (!Number.isInteger(form.maxFailures) || form.maxFailures < 1 || form.maxFailures > 20) throw new Error("Failure limit must be 1 to 20.");
  if (![form.constraints, form.nonGoals].every(list => Array.isArray(list) && list.length <= 30 && list.every(value => typeof value === "string" && value.length <= 2000))) throw new Error("Invalid constraints or non-goals.");
  if (!Array.isArray(form.verification) || form.verification.length > 5) throw new Error("Configure verification tiers.");
  const tiers = new Set<string>();
  for (const item of form.verification) {
    if (!(CONTROL_TIERS as readonly string[]).includes(item.tier) || tiers.has(item.tier)) throw new Error("Invalid or duplicate verification tier.");
    tiers.add(item.tier);
    if (!item.enabled) continue;
    if (!item.executable?.trim() || /[\r\n]/.test(item.executable) || !Array.isArray(item.args) || item.args.length > 40 || item.args.some(arg => typeof arg !== "string" || arg.length > 2000 || /[\r\n]/.test(arg))) throw new Error("Use an executable and separate arguments for verification.");
    if (/(?:^|[\\/])(cmd|powershell|pwsh|sh|bash)(?:\.exe)?$/i.test(item.executable) || /\.(cmd|bat|ps1)$/i.test(item.executable)) throw new Error("Shell commands and shell shims are not supported.");
  }
  if (!form.verification.some(item => item.enabled)) throw new Error("Enable at least one verification tier.");
  if (!Array.isArray(form.acceptance) || !form.acceptance.length || form.acceptance.length > 30 || form.acceptance.some(item => !item.text?.trim() || item.text.length > 2000 || (item.tier !== null && !form.verification.some(tier => tier.tier === item.tier && tier.enabled)))) throw new Error("Each acceptance criterion needs text and an enabled check or human judgment.");
  return form;
}
export type Readiness = WorkerAvailability & { available: boolean; provider: CodingProvider };
export function readiness(provider: CodingProvider, value: WorkerAvailability): Readiness {
  return { ...value, provider, available: value.installed === true && value.authenticated === true && !value.failure };
}
export function dashboardCategory(state: string, pendingApproval = false) {
  if (state === "NEEDS_REVIEW" || state === "AWAITING_APPROVAL" || pendingApproval) return "NEEDS ATTENTION";
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "STOPPED" || state === "FAILED") return "STOPPED / FAILED";
  return "ACTIVE";
}
export function projectRun(ports: RuntimePorts, runId: string) {
  const report = buildRunReport(ports, runId);
  const grant = report.loop.grants.at(-1);
  const latest = report.loop.turns.filter(turn => turn.verification).at(-1)?.verification ?? null;
  const approval = report.humanActions.approvals.some(item => item.status === "PENDING");
  const needsIntervention = approval || (report.run.state === "PAUSED" && (grant?.status !== "ACTIVE" || latest?.outcome === "INDETERMINATE"));
  return { id: runId, goal: report.run.goal, project: report.spec.projectPath,
    ...rolesFor(report.spec), state: report.run.state, category: dashboardCategory(report.run.state, needsIntervention),
    attention: report.run.state === "NEEDS_REVIEW" || needsIntervention || report.run.state === "AWAITING_APPROVAL",
    turn: report.loop.turns.length, maxTurns: grant?.maxTurns ?? 0, consumed: grant?.turnsUsed ?? 0,
    latestVerification: latest?.outcome ?? null, createdAt: report.run.createdAt, updatedAt: report.run.updatedAt };
}
/** Bounded, credential-free text for a user-visible failure reason. */
function prose(value: string, limit = 400): string {
  return value
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g, "[redacted credential]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[redacted authorization]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

export class AutopilotControlCenter {
  private readonly options: { ports: RuntimePorts; engine: AutopilotEngine; workers: ControlledWorkerTurns; executable(provider: CodingProvider): string };
  constructor(options: AutopilotControlCenter["options"]) { this.options = options; }

  dashboard() { return this.options.engine.listRuns(10000).filter(run => !run.id.startsWith("readiness-")).map(run => projectRun(this.options.ports, run.id)); }

  async detect(projectPath: string): Promise<Readiness[]> {
    const { engine, ports } = this.options;
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(projectPath)) throw new Error("Choose an absolute project path before checking readiness.");
    const policy = defaultCapabilityPolicy(); policy.workspaceRoot = projectPath; policy.readRoots = [projectPath];
    if (evaluatePathAccess(policy, { path: projectPath, mode: "read" }).decision !== "ALLOW") throw new Error("Project path is denied.");
    // A durable probe-only audit run grants no model or implementation authority.
    const probe = engine.createRun({ id: ports.ids.next("readiness"), goal: "Provider readiness check", workers: { primary: "scripted", sticky: true, fallback: null, consultantMode: false } });
    const result: Readiness[] = [];
    for (const provider of ["claude", "codex"] as const) {
      const executable = this.options.executable(provider);
      if (!executable) { result.push(readiness(provider, { installed: false, authenticated: null, version: null, failure: "not_installed" })); continue; }
      policy.allowedCommands = [{ executable: provider, subcommand: "--version", decision: "ALLOW", risk: "low", reason: "Provider version" }, { executable: provider, subcommand: provider === "claude" ? "auth" : "login", decision: "ALLOW", risk: "low", reason: "Provider login status" }];
      const protocol = provider === "claude" ? claudeCodeProtocol(executable) : codexProtocol(executable);
      const execute = (intent: ReturnType<typeof protocol.installation>) => engine.effects!.request({ runId: probe.id, stepKey: ports.ids.next("readiness-probe"), policy, intent,
        diagnostics: { provider, role: "PROBE" } });
      const version = await execute(protocol.installation(projectPath));
      const installed = "result" in version ? protocol.parseInstallation(version.result) : { installed: null, version: null, failure: "policy" as const };
      if (!installed.installed || installed.failure) { result.push(readiness(provider, { ...installed, authenticated: null })); continue; }
      const auth = await execute(protocol.authentication(projectPath));
      result.push(readiness(provider, { ...installed, ...("result" in auth ? protocol.parseAuthentication(auth.result) : { authenticated: null, failure: "policy" as const }) }));
    }
    await engine.requestStop(probe.id);
    return result;
  }

  async create(form: NewRunForm) {
    validateNewRun(form);
    const { engine, ports, workers } = this.options;
    const available = await this.detect(form.projectPath);
    const primary = available.find(value => value.provider === form.primary)!;
    if (!primary.available) throw new Error(`${form.primary} unavailable: ${primary.failure ?? "login required"}`);
    const id = ports.ids.next("coding-run");
    const project = canonicalize(form.projectPath).display.replace(/[\\/]$/, "");
    // canonicalize().display is backslash-separated on Windows, so the parent
    // must be found on a slash-normalized copy. Splitting the display form on
    // "/" alone finds nothing and silently truncates the project's last
    // character, putting the worktree in a near-miss sibling directory.
    const inProject = form.workspaceMode === "project-branch";
    let workspaceRoot = project;
    if (!inProject) {
      const separated = project.replace(/\\/g, "/");
      const cut = separated.lastIndexOf("/");
      if (cut <= 0) throw new Error("Choose a project directory inside a parent directory, not a drive root.");
      workspaceRoot = `${separated.slice(0, cut)}/dexnest-worktrees/${id}`;
    }
    const structuredCommands = Object.fromEntries(form.verification.filter(item => item.enabled).map(item => [item.tier, { executable: item.executable.trim(), args: item.args }]));
    const run = engine.createRun({ id, goal: form.goal, projectPath: project, projectId: form.projectId,
      workers: { primary: form.primary, consultant: form.consultant, sticky: true, fallback: null, consultantMode: false },
      constraints: form.constraints, nonGoals: form.nonGoals,
      acceptanceCriteria: form.acceptance.map((item, index) => ({ id: `acceptance-${index + 1}`, text: item.text, kind: item.tier ? "automated" : "judgment", ...(item.tier ? { checkCommand: structuredCommands[item.tier] } : {}) })),
      verification: { tiers: Object.keys(structuredCommands), commands: {}, structuredCommands },
      failurePolicy: { maxConsecutiveFailures: form.maxFailures, maxAttemptsPerStep: form.maxFailures },
      ...(form.planText?.trim() ? { plan: parsePlanText(form.planText).items } : {}),
      ...(inProject ? { workspaceMode: "project-branch" as const } : {}),
      ...(form.workerProfile === "agentic" ? { workerProfile: "agentic" as const } : {}),
      ...(form.director ? { supervisor: { provider: form.director } } : {}),
      ...(form.model?.trim() ? { model: form.model.trim() } : {}),
      ...(form.effort ? { effort: form.effort } : {}),
      capabilities: { workspaceRoot, allowedPaths: [workspaceRoot], forbiddenPaths: ["local-data"], allowedCommands: [], forbiddenCommands: ["git push", "npm publish", "gh pr merge"], requiresApproval: [] } });
    const policy = defaultCapabilityPolicy(); policy.workspaceRoot = workspaceRoot; policy.readRoots = [project];

    // Working in the project has no worktree to create: the equivalent step is
    // branching away from the operator's work, which refuses on a dirty tree.
    if (inProject) {
      try {
        await new ProjectBranchManager({ ports, effects: engine.effects! }).ensureBranch({ runId: id, repoRoot: project, policy });
      } catch (error) {
        const reason = prose(error instanceof Error ? error.message : String(error), 400);
        engine.store.appendEvent(id, { type: "RUN_FAILED", toState: "FAILED", failureReason: `Could not prepare the project branch: ${reason}` });
        throw new Error(`Could not prepare the project branch: ${reason} (run ${id})`);
      }
      engine.store.appendEvent(id, { type: "WORKSPACE_CREATED", payload: { workspaceRoot, mode: "project-branch" } });
      try { workers.authorizeLoop({ runId: id, maxTurns: form.maxTurns, ...(form.maxIterations !== undefined ? { maxIterations: form.maxIterations } : {}), grantedBy: "desktop_ui" }); }
      catch (error) {
        engine.store.appendEvent(id, { type: "RUN_FAILED", toState: "FAILED", failureReason: "Primary setup failed. Select a canonical primary Git repository root and check provider readiness." });
        throw error;
      }
      return run;
    }

    const outcome = await engine.effects!.request({ runId: run.id, stepKey: "control-center-workspace", policy,
      intent: { kind: "CREATE_WORKTREE", repoRoot: project, worktreePath: workspaceRoot, branch: `autopilot/${id}`, baseRef: "HEAD", purpose: "Prepare the primary coding workspace" } });
    if (!("result" in outcome) || !outcome.result.ok) {
      // Surface the reason the runtime already recorded. The first dogfood run
      // failed on a real path bug, and the only thing the operator saw was
      // "inspect run <id>" — the actual sentence was sitting in the operation.
      const detail = "decision" in outcome ? outcome.decision.reason
        : "result" in outcome ? outcome.result.summary || outcome.operation.resultSummary || ""
        : outcome.operation.resultSummary || "";
      const reason = prose(detail, 400);
      engine.store.appendEvent(id, { type: "RUN_FAILED", toState: "FAILED",
        failureReason: reason
          ? `Workspace preparation did not complete: ${reason}`
          : "Workspace preparation did not complete; inspect the blocked/failed operation." });
      throw new Error(
        reason
          ? `Workspace preparation did not complete: ${reason} (run ${id})`
          : `Workspace preparation did not complete. Inspect run ${id}.`
      );
    }
    engine.store.appendEvent(id, { type: "WORKSPACE_CREATED", payload: { workspaceRoot } });
    try { workers.authorizeLoop({ runId: id, maxTurns: form.maxTurns, ...(form.maxIterations !== undefined ? { maxIterations: form.maxIterations } : {}), grantedBy: "desktop_ui" }); }
    catch (error) {
      engine.store.appendEvent(id, { type: "RUN_FAILED", toState: "FAILED", failureReason: "Primary setup failed. Select a canonical primary Git repository root and check provider readiness." });
      throw error;
    }
    return run;
  }
}
