import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ControlledWorkerTurns, RunSpecInput, RunReport } from "@dexnest/autopilot-runtime";
import { AutopilotNewRun } from "./AutopilotNewRun";
import { LiveActivityPanel, PlanProgress, IterationList, RunSummary, MorningPanel, SessionAdoption, UsagePanel, AttentionPanel } from "./AutopilotLive";
import { AutopilotQueue } from "./AutopilotQueue";
import { AutopilotPush } from "./AutopilotPush";
import "./Autopilot.css";
import type { projectRun } from "@dexnest/autopilot-runtime";
import { PageHeader } from "../components/shared";

// The Autopilot Control Center.
//
// This is the user-facing surface for Autopilot, reached from the sidebar. It is
// deliberately plain rather than unfinished: the renderer holds NO authoritative
// run state — every value here is a snapshot pushed from the main process, so
// closing or reloading this window never disturbs a run.
//
// Real worker turns require explicit review and approval. Every effect still passes
// through capability policy; the UI never drives a multi-turn loop.

type RunState =
  | "CREATED" | "READY" | "RUNNING" | "PAUSE_REQUESTED" | "PAUSED"
  | "STOP_REQUESTED" | "STOPPED" | "RECONCILING" | "AWAITING_APPROVAL" | "NEEDS_REVIEW"
  | "COMPLETED" | "FAILED";

/** Mirrors RunChanges, kept here because the renderer imports no runtime types. */
/** One run's line in the brief. Mirrors MorningBriefEntry. */
interface BriefEntry {
  runId: string;
  label: string;
  goal: string;
  state: string;
  headline: string;
  action: string;
  detail: string;
  phasesDone: number;
  phasesTotal: number;
  costUsd: number;
  assumptions: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  finishedItself: boolean;
  lastActivityAt: string;
}

interface MorningBriefView {
  sinceHours: number;
  generatedAt: string;
  runs: BriefEntry[];
  needsYou: number;
  costUsd: number;
  filesChanged: number;
}

interface RunChangesView {
  files: number;
  insertions: number;
  deletions: number;
  phases: Array<{
    planItemId: string | null;
    title: string;
    ordinal: number;
    status: string;
    commitSha: string | null;
    files: Array<{ path: string; insertions: number | null; deletions: number | null }>;
    insertions: number;
    deletions: number;
    binaryFiles: number;
  }>;
}

interface RunRecord {
  spec: { workers: { primary: string } };
  id: string;
  state: RunState;
  goal: string;
  createdAt: string;
  updatedAt: string;
  reconcileReason: string | null;
  failureReason: string | null;
}

interface StepRecord {
  stepKey: string;
  ordinal: number;
  status: string;
  attempts: number;
  summary: string | null;
}

interface RunEventRecord {
  id: string;
  seq: number;
  type: string;
  fromState: string | null;
  toState: string | null;
  stepKey: string | null;
  createdAt: string;
}

interface OperationRecord {
  id: string;
  kind: string;
  summary: string;
  decision: string;
  decisionRule: string;
  decisionReason: string;
  risk: string;
  status: string;
}

interface ApprovalRecord {
  id: string;
  runId: string;
  operationId: string;
  summary: string;
  reason: string;
  capability: string;
  risk: string;
  status: string;
  requestedAt: string;
}

/** Mirrors the runtime's RunReport. Rebuilt from SQLite on every request. */
type RunReportShape = RunReport;
type DashboardRun = ReturnType<typeof projectRun>;

interface RunSnapshot {
  worker: ReturnType<ControlledWorkerTurns["snapshot"]>;
  loop: ReturnType<ControlledWorkerTurns["loopSnapshot"]>;
  run: RunRecord;
  steps: StepRecord[];
  events: RunEventRecord[];
  operations: OperationRecord[];
  pendingApprovals: ApprovalRecord[];
  /** Whether the operator may ask for a second opinion now, and why not. */
  consultationRequest?: { eligible: boolean; reason: string | null; busy: boolean };
  handoff?: ReturnType<ControlledWorkerTurns["handoffSnapshot"]>;
  /** The single current routing recommendation. Derived, never authoritative. */
  recovery?: ReturnType<ControlledWorkerTurns["recovery"]>;
}

interface AutopilotBridge {
  autopilotDashboard(): Promise<DashboardRun[]>;
  autopilotRunPrimary(runId: string): Promise<void>;
  autopilotApproveConsultation(scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotCancelConsultation(scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotConsultationRun(scope: { runId: string; requestId: string; consultantProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotConsultationRequest(input: { runId: string; consultantProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotDirectionSwitch(input: { runId: string; source: "self" | "chat"; reason: string }): Promise<unknown>;
  autopilotHandoffPropose(input: { runId: string; toProvider: "claude" | "codex"; reason?: string }): Promise<unknown>;
  autopilotHandoffApprove(scope: { runId: string; handoffId: string; toProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotHandoffCancel(scope: { runId: string; handoffId: string; toProvider: "claude" | "codex" }): Promise<unknown>;
  autopilotHandoffActivate(input: { runId: string; handoffId: string; toProvider: "claude" | "codex"; maxTurns: number }): Promise<unknown>;
  autopilotWorkerConfig(): Promise<{ executables: Record<string, string> }>;
  autopilotWorkerPrepare(input: { runId: string; prompt: string; retryOf?: string }): Promise<unknown>;
  autopilotWorkerSend(input: { runId: string; sendId: string }): Promise<unknown>;
  autopilotWorkerResolve(input: { runId: string; sendId: string; decision: "completed" | "not_sent" | "keep_unresolved"; evidence: string }): Promise<unknown>;
  autopilotWorkerInterrupt(runId: string): Promise<void>;
  autopilotLoopAuthorize(input: { runId: string; maxTurns: number }): Promise<unknown>;
  autopilotLoopRevoke(runId: string): Promise<unknown>;
  autopilotLoopRun(runId: string): Promise<{ reason: string; turnsRun: number; detail: string }>;
  autopilotReport(runId: string): Promise<RunReportShape>;
  autopilotReportExport(runId: string): Promise<{ written: string[]; refused: string[] }>;
  autopilotListRuns(): Promise<RunRecord[]>;
  autopilotGetRun(runId: string): Promise<RunSnapshot>;
  autopilotCreateRun(input: RunSpecInput): Promise<RunRecord>;
  autopilotStartRun(runId: string): Promise<RunRecord>;
  autopilotPauseRun(runId: string): Promise<RunRecord>;
  autopilotResumeRun(runId: string): Promise<RunRecord>;
  autopilotStopRun(runId: string): Promise<RunRecord>;
  autopilotDraftPlan(runId: string): Promise<{ text: string; phases: number; problem: string | null }>;
  autopilotRunChanges(runId: string): Promise<RunChangesView>;
  autopilotMorningBrief(options?: { sinceHours?: number }): Promise<MorningBriefView>;
  autopilotResolveUncertain(input: { runId: string; stepKey: string; resolution: "completed" | "not_performed" }): Promise<RunRecord>;
  autopilotResolveApproval(input: { approvalId: string; decision: "APPROVED" | "REJECTED" }): Promise<ApprovalRecord>;
  onAutopilotChanged(callback: (payload: { runId: string }) => void): () => void;
}

function bridge(): AutopilotBridge {
  return (window as unknown as { dexNest: AutopilotBridge }).dexNest;
}

const ACTIVE_STATES: RunState[] = ["RUNNING", "PAUSE_REQUESTED", "RECONCILING"];
const HANDOFF_STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Handoff proposed", APPROVED: "Handoff approved", ACTIVATING: "Handoff activating",
  ACTIVE: "Handoff active", CANCELLED: "Handoff cancelled", SUPERSEDED: "Handoff superseded", FAILED: "Handoff failed"
};

export function AutopilotView() {
  const [area, setArea] = useState("Runs");
  // A run whose settings the New Run form should start from. Set by "Run
  // again", cleared by the form once it has read it.
  const [cloneOf, setCloneOf] = useState<string | null>(null);
  // A drafted plan, held here until the operator accepts or discards it. Never
  // written straight into the run: a model asked to break up work it has not
  // seen will produce confident phases for some of it, and only the person who
  // chose the goal can tell which.
  const [draft, setDraft] = useState<{ text: string; phases: number; problem: string | null } | null>(null);
  const [drafting, setDrafting] = useState(false);
  // Carried alongside cloneOf, because a drafted plan is not yet on the run —
  // rerunForm reads the run's stored plan, which is empty, since being empty is
  // why it was drafted at all.
  const [clonePlan, setClonePlan] = useState<string | null>(null);
  const [changes, setChanges] = useState<RunChangesView | null>(null);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [brief, setBrief] = useState<MorningBriefView | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [runs, setRuns] = useState<DashboardRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loopTurns, setLoopTurns] = useState(5);
  const [report, setReport] = useState<RunReportShape | null>(null);
  // Bumped by every successful refresh, and passed to the panels that fetch
  // their own data. They cannot depend on the refresh CALLBACK — it is a new
  // function on every render, so depending on it refetches forever — but with
  // nothing in its place, Refresh moved the rest of the page and left those
  // panels showing whatever they read when they mounted. A counter is stable
  // between refreshes and changes exactly once per refresh.
  const [refreshedAt, setRefreshedAt] = useState(0);

  // Loaded whenever the dashboard is refreshed, because this is the first
  // thing looked at and a button between the operator and it would be one
  // press every morning for information they always want.
  useEffect(() => {
    if (area !== "Runs") return;
    let cancelled = false;
    void bridge().autopilotMorningBrief()
      .then(loaded => { if (!cancelled) setBrief(loaded); })
      .catch(() => { /* the panel simply does not appear */ });
    return () => { cancelled = true; };
  }, [area, refreshedAt]);
  const [exported, setExported] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = useRef<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (runId?: string | null) => {
    const sequence = ++refreshSequence.current;
    if (runId) selected.current = runId;
    try {
      const list = await bridge().autopilotDashboard();
      const target = selected.current ?? list[0]?.id ?? null;
      const [next, nextReport] = target ? await Promise.all([bridge().autopilotGetRun(target), bridge().autopilotReport(target)]) : [null, null];
      if (sequence !== refreshSequence.current) return;
      setRuns(list);
      selected.current = target;
      setSelectedId(target);
      setSnapshot(next);
      setReport(nextReport);
      setRefreshedAt(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Push-driven, not polled: Autopilot stays dormant when nothing is running.
    return bridge().onAutopilotChanged(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => { setPrompt(""); setEvidence(""); }, [selectedId]);

  async function guard(work: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const run = snapshot?.run ?? null;
  const uncertainStep = snapshot?.steps.find((step) => step.status === "UNCERTAIN") ?? null;
  const approvals = snapshot?.pendingApprovals ?? [];
  const denials = (snapshot?.operations ?? []).filter((operation) => operation.decision === "DENY");
  const isRealWorker = ["claude", "codex"].includes(run?.spec.workers.primary ?? "");
  const workerName = run?.spec.workers.primary === "codex" ? "Codex" : "Claude Code";
  const worker = snapshot?.worker;
  const loop = snapshot?.loop;
  const pendingSend = worker?.sends.find(send => ["INTENT", "AWAITING_APPROVAL", "DISPATCHING", "UNCERTAIN"].includes(send.status));
  const held = run && ["READY", "PAUSED"].includes(run.state);

  return (
    <section className="view-stack" aria-labelledby="autopilot-title">
      <PageHeader
        eyebrow="Plan → iterations → checkpoints · your project, on its own branch"
        title="Autopilot Control Center"
        titleId="autopilot-title"
        actions={(
          <button type="button" onClick={() => void refresh()}>Refresh</button>
        )}
      />

      {error && <p className="empty-state" role="alert">{error}</p>}

      <nav className="autopilot-areas" aria-label="Autopilot areas">
        {["New Run", "Queue", "Runs", "Selected Run", "Notifications"].map(value => <button type="button" key={value} aria-pressed={area === value} disabled={value === "Selected Run" && !run} onClick={() => setArea(value)}>{value}</button>)}
      </nav>
      <div hidden={area !== "New Run"}>
        <AutopilotNewRun
          cloneOf={cloneOf}
          clonePlan={clonePlan}
          onCloned={() => { setCloneOf(null); setClonePlan(null); }}
          onCreated={id => { selected.current = id; setArea("Selected Run"); void refresh(id); }}
        />
      </div>
      {/* Several projects in one night, on one budget. The New Run form
          asks the same three questions about a single project. */}
      <div hidden={area !== "Queue"}><AutopilotQueue refreshedAt={refreshedAt} onChanged={() => void refresh()} /></div>
      {/* Where what needs you actually reaches you. */}
      <div hidden={area !== "Notifications"}><AutopilotPush refreshedAt={refreshedAt} /></div>
      <section hidden={area !== "Runs"} aria-label="Runs dashboard">
        {brief && brief.runs.length > 0 && (
          <div className="card">
            <h3>Last night</h3>
            <p>
              {brief.needsYou === 0
                ? "Nothing needs you."
                : <strong>{brief.needsYou} run{brief.needsYou === 1 ? "" : "s"} need{brief.needsYou === 1 ? "s" : ""} you.</strong>}
              {" "}
              {brief.runs.length} run{brief.runs.length === 1 ? "" : "s"} moved in the last {brief.sinceHours} hours
              {brief.filesChanged > 0 ? `, touching ${brief.filesChanged} file${brief.filesChanged === 1 ? "" : "s"}` : ""}
              {brief.costUsd > 0 ? ` for $${brief.costUsd.toFixed(2)}` : ""}.
            </p>
            <ul className="autopilot-devices">
              {brief.runs.map(entry => (
                <li key={entry.runId}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => { setArea("Selected Run"); void refresh(entry.runId); }}
                  >
                    <strong>{entry.label}</strong>
                  </button>
                  {" — "}{entry.headline}
                  {entry.finishedItself && <span className="technical"> · finished itself</span>}
                  <p className="technical">
                    {entry.phasesTotal > 0 ? `${entry.phasesDone}/${entry.phasesTotal} phases · ` : ""}
                    {entry.filesChanged} file{entry.filesChanged === 1 ? "" : "s"}
                    {" "}+{entry.insertions} −{entry.deletions}
                    {entry.costUsd > 0 ? ` · $${entry.costUsd.toFixed(2)}` : ""}
                    {entry.assumptions > 0 ? ` · ${entry.assumptions} assumption${entry.assumptions === 1 ? "" : "s"}` : ""}
                  </p>
                  {entry.action === "decide" && <p>{entry.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      <h2>Runs</h2>
      <label>Filter runs<select value={filter} onChange={event => setFilter(event.target.value)}>
        {["ACTIVE", "NEEDS ATTENTION", "COMPLETED", "STOPPED / FAILED", "ALL"].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <div className="event-list">
        {runs.length === 0 ? (
          <p className="empty-state">No Autopilot runs yet. Create a coding automation above.</p>
        ) : (
          runs.filter(item => filter === "ALL" || item.category === filter).map((item) => (
            <button type="button"
              className="event-row autopilot-run-card"
              key={item.id}
              aria-current={item.id === selectedId}
              onClick={() => { setArea("Selected Run"); void refresh(item.id); }}
            >
              <div><strong>{item.goal.slice(0, 150)}</strong>
                <p>{item.project ?? "No project"}</p>
                <p className="technical">PRIMARY {item.primary} · CONSULTANT {item.consultant ?? "None"}</p>
                <p>Turns {item.turn} · grant {item.consumed}/{item.maxTurns} · verification {item.latestVerification ?? "not run"}</p>
                <p className="technical">Created {item.createdAt} · Last activity {item.updatedAt}</p>
              </div>
              <span>{item.state}{item.attention ? " · Needs attention" : ""}</span>
            </button>
          ))
        )}
      </div>

      </section>
      {run && area === "Selected Run" && (
        <>
          <h2>Selected Run</h2>
          <p>{run.goal}</p>
          <PageHeader eyebrow={`Run ${run.id}`} title={run.state} titleId="autopilot-run-title" />

          {run.reconcileReason && <p className="empty-state">Reconciliation: {run.reconcileReason}</p>}
          {run.failureReason && <p className="empty-state">Failure: {run.failureReason}</p>}

          <div className="event-row" style={{ gap: "0.5rem" }}>
            {isRealWorker && <>
              <button type="button" disabled={busy || !held || !loop?.grant || loop.busy || Boolean(report?.primaryProgress && report.primaryProgress.status !== "PROGRESSING")} onClick={() => void guard(() => bridge().autopilotRunPrimary(run.id))}>{run.state === "READY" ? "Start" : "Resume"} primary</button>
              <button type="button" disabled={run.state !== "RUNNING"} onClick={() => void guard(() => bridge().autopilotPauseRun(run.id))}>Pause</button>
            </>}
            {!isRealWorker && <>
              <button type="button" disabled={run.state !== "READY"} onClick={() => void guard(() => bridge().autopilotStartRun(run.id))}>Start</button>
              <button type="button" disabled={run.state !== "RUNNING"} onClick={() => void guard(() => bridge().autopilotPauseRun(run.id))}>Pause</button>
              <button type="button" disabled={run.state !== "PAUSED"} onClick={() => void guard(() => bridge().autopilotResumeRun(run.id))}>Resume</button>
            </>}
            {/* Available in any state, including mid-run. "Same project, same
                checks, different goal" is a thing to want while watching one
                work, and it starts a form rather than a run — so it cannot
                disturb what is already going. */}
            <button type="button" onClick={() => { setCloneOf(run.id); setArea("New Run"); }}>
              Run again
            </button>
            <button
              type="button"
              disabled={["STOPPED", "COMPLETED", "FAILED"].includes(run.state)}
              onClick={() => void guard(() => bridge().autopilotStopRun(run.id))}
            >
              Stop
            </button>
          </div>

          {/* What is happening, and what happened. The mechanism below is
              for when something has gone wrong; this is the run. */}
          {/* What needs a person, on the desktop first. The engine's mapping
              gets proved here, where being wrong is cheap. */}
          <AttentionPanel refreshedAt={refreshedAt} />
          <LiveActivityPanel runId={run.id} working={Boolean(worker?.busy || loop?.busy)} />
          <RunSummary runId={run.id} working={Boolean(worker?.busy || loop?.busy)} refreshedAt={refreshedAt} onChanged={() => void refresh(run.id)} />
          {/* The morning: answer its claim to be finished, and say whatever
              reading it made you want to say. Neither starts a turn. */}
          {/* Explaining a job is easy in the editor and awkward in a form,
              so the explaining can happen there and the carrying-on here. */}
          <SessionAdoption runId={run.id} working={Boolean(worker?.busy || loop?.busy)} refreshedAt={refreshedAt} onChanged={() => void refresh(run.id)} />
          <MorningPanel runId={run.id} working={Boolean(worker?.busy || loop?.busy)} refreshedAt={refreshedAt} onChanged={() => void refresh(run.id)} />
          {/* Measured, not assumed: which phase was expensive, and whether
              the turns are getting dearer as the session grows. */}
          <UsagePanel usage={report?.usage ?? null} />
          {/* Offered only while the run has no plan and has not started. A
              plan arriving mid-run would describe work already done, and
              accepting it would renumber phases the worker is referring to. */}
          {!report?.plan?.items?.length && ["READY", "CREATED"].includes(run.state) && (
            <div className="card">
              <h4>Plan</h4>
              <p>This run has no plan. It will work from the goal alone, or you can have one drafted and edit it.</p>
              <div className="event-row" style={{ gap: "0.5rem" }}>
                <button
                  type="button"
                  disabled={drafting}
                  onClick={() => {
                    setDrafting(true);
                    setDraft(null);
                    void bridge().autopilotDraftPlan(run.id)
                      .then(setDraft)
                      .catch((error: unknown) => setDraft({
                        text: "", phases: 0,
                        problem: error instanceof Error ? error.message : String(error)
                      }))
                      .finally(() => setDrafting(false));
                  }}
                >
                  {drafting ? "Drafting…" : "Draft a plan"}
                </button>
              </div>
              <p className="technical">
                One turn, no tools, no workspace. It reads nothing — it plans from the goal, the
                constraints and how the run is verified.
              </p>

              {draft?.problem && <p className="autopilot-error">{draft.problem}</p>}
              {draft && !draft.problem && (
                <>
                  <p><strong>{draft.phases} phase{draft.phases === 1 ? "" : "s"}</strong> — edit before accepting.</p>
                  <textarea
                    rows={14}
                    value={draft.text}
                    onChange={event => setDraft({ ...draft, text: event.target.value })}
                    aria-label="Drafted plan"
                  />
                  <div className="event-row" style={{ gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => { setClonePlan(draft.text); setCloneOf(run.id); setArea("New Run"); }}
                    >
                      Use it in a new run
                    </button>
                    <button type="button" onClick={() => setDraft(null)}>Discard</button>
                  </div>
                  <p className="technical">
                    A plan belongs to a run before it starts, so accepting one means creating the run
                    with it. "Use it in a new run" carries this run's settings and the plan across.
                  </p>
                </>
              )}
            </div>
          )}
          {/* What it actually wrote. Loaded on request rather than with the
              run: it shells out to git once per phase, and most visits to a
              run are not a review. */}
          <div className="card">
            <h4>What changed</h4>
            {changesFor !== run.id ? (
              <>
                <p>The files each phase touched, and how much of each.</p>
                <button
                  type="button"
                  onClick={() => {
                    setChangesFor(run.id);
                    setChanges(null);
                    void bridge().autopilotRunChanges(run.id).then(setChanges).catch(() => setChanges(null));
                  }}
                >
                  Show changes
                </button>
              </>
            ) : !changes ? (
              <p className="technical">Reading the repository…</p>
            ) : changes.phases.length === 0 ? (
              <p className="empty-state">Nothing has been checkpointed yet.</p>
            ) : (
              <>
                <p>
                  <strong>{changes.files} file{changes.files === 1 ? "" : "s"}</strong>
                  {" · "}<span style={{ color: "#22C55E" }}>+{changes.insertions}</span>
                  {" "}<span style={{ color: "#EF4444" }}>−{changes.deletions}</span>
                </p>
                {changes.phases.map(phase => (
                  <details key={`${phase.planItemId ?? phase.ordinal}`} className="autopilot-mechanism">
                    <summary>
                      {phase.ordinal}. {phase.title}
                      {" — "}
                      {phase.commitSha
                        ? `${phase.files.length} file${phase.files.length === 1 ? "" : "s"} +${phase.insertions} −${phase.deletions}`
                        : "no checkpoint"}
                    </summary>
                    {phase.files.length === 0 ? (
                      <p className="technical">
                        {phase.commitSha ? "The commit is no longer readable." : "This phase never earned a checkpoint."}
                      </p>
                    ) : (
                      <ul className="autopilot-devices">
                        {phase.files.map(file => (
                          <li key={file.path}>
                            <span className="technical">{file.path}</span>
                            {file.insertions === null
                              ? <span className="technical"> — binary</span>
                              : <span className="technical"> — +{file.insertions} −{file.deletions}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                ))}
              </>
            )}
          </div>
          {report?.plan && <PlanProgress items={report.plan.items} />}
          {report?.iterations && <IterationList iterations={report.iterations} />}

          {report?.direction && <div className="card">
            <h4>Who decides what happens next</h4>
            <p><strong>{report.direction.source === "chat" ? "A chat writes the assignments" : "The coding agent decides for itself"}</strong></p>
            <p className="technical">{report.direction.source === "chat"
              ? "A separate read-only session holds the plan and writes each assignment. One extra call per piece of work, and the coding subscription is spent on coding."
              : "The agent ends each turn saying what it would do next. No extra call, but its own capacity pays for the planning."}</p>
            <button type="button" disabled={busy || Boolean(worker?.busy)}
              onClick={() => void guard(() => bridge().autopilotDirectionSwitch({
                runId: run.id,
                source: report.direction.source === "chat" ? "self" : "chat",
                reason: report.direction.source === "chat" ? "Operator moved planning back to the agent." : "Operator moved planning to the chat."
              }))}>
              {report.direction.source === "chat" ? "LET THE AGENT DECIDE" : "LET A CHAT DECIDE"}
            </button>
            <p className="technical">Takes effect at the next piece of work; a turn already running finishes under the decider it started with.</p>
            {report.direction.authority.length > 0 && report.direction.authority.map(entry =>
              <p key={entry.id} className="technical">{entry.ordinal}. {entry.source} — {entry.reason} ({entry.changedBy})</p>)}
          </div>}


          {isRealWorker && worker && <details className="autopilot-mechanism" open={Boolean(pendingSend && pendingSend.status === "UNCERTAIN")}><summary>Manual worker controls and send history</summary><section className="view-stack" aria-label={`Controlled ${workerName} turn`}>
            <PageHeader eyebrow={`${workerName} · sticky session · ${report?.spec.workerProfile === "agentic" ? "tools enabled in the workspace" : "tools disabled"}`} title="Controlled prompt and send resolution" titleId="autopilot-worker-title" />
            <p className="technical">Session: {worker.session?.sessionId ?? "Not started"} · {worker.session?.established ? "Previously confirmed" : "Reserved on first preparation"} · {worker.busy ? "Worker action in progress" : "Held"}</p>
            <p className="technical">Worker cwd: {worker.session?.cwd ?? "Run worktree (validated before preparation)"}</p>
            {worker.session?.provider === "codex" && <p className="technical">Codex thread: {worker.session.providerSessionId ?? "Assigned and journaled before the first prompt is sent"}</p>}
            <label>Prompt<textarea value={prompt} maxLength={128000} disabled={busy || Boolean(pendingSend)} onChange={event => setPrompt(event.target.value)} rows={5} /></label>
            <button type="button" disabled={busy || worker.busy || !held || Boolean(pendingSend) || !prompt.trim()}
              onClick={() => void guard(() => bridge().autopilotWorkerPrepare({ runId: run.id, prompt }))}>Prepare prompt for review</button>
            {pendingSend && <div className="view-stack">
              <p className="technical">Send {pendingSend.id} · {pendingSend.status} · operation {pendingSend.operationId ?? "Not yet recorded"}</p>
              <details><summary>Review saved prompt</summary><pre className="technical" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "20rem", overflow: "auto" }}>{pendingSend.prompt}</pre></details>
              {pendingSend.result && <>
                <p className="technical">Failure: {pendingSend.result.failure ?? "None"} · confirmed outcome: {String(pendingSend.result.certain)}</p>
                <details><summary>Provider output</summary><pre className="technical">{pendingSend.result.text || "No provider output captured."}</pre></details>
              </>}
              {pendingSend.status === "AWAITING_APPROVAL" && <>
                <p>Approve this exact saved prompt to send it once to {workerName}. This may consume subscription usage. {report?.spec.workerProfile === "agentic" ? "It can read, edit and run commands inside the workspace." : "Tools remain disabled."}</p>
                <button type="button" disabled={busy || worker.busy || ["STOPPED", "FAILED", "COMPLETED"].includes(run.state)}
                  onClick={() => void guard(() => bridge().autopilotWorkerSend({ runId: run.id, sendId: pendingSend.id }))}>Approve and send once</button>
              </>}
              {pendingSend.status === "UNCERTAIN" && <>
                <p role="alert">NEEDS_REVIEW: this specific prompt may have reached {workerName}. Inspect its session before settling it. Nothing will resend automatically.</p>
                <label>Evidence for your decision<textarea value={evidence} maxLength={4000} rows={3} onChange={event => setEvidence(event.target.value)} /></label>
                {([['completed', 'Completed'], ['not_sent', 'Not sent / safe to retry'], ['keep_unresolved', 'Keep unresolved']] as const).map(([decision, label]) =>
                  <button key={decision} type="button" disabled={busy || worker.busy || (decision !== "keep_unresolved" && !evidence.trim())}
                    onClick={() => void guard(() => bridge().autopilotWorkerResolve({ runId: run.id, sendId: pendingSend.id, decision, evidence }))}>{label}</button>)}
              </>}
              {!["UNCERTAIN"].includes(pendingSend.status) && <button type="button"
                onClick={() => void guard(() => bridge().autopilotWorkerInterrupt(run.id))}>Cancel / interrupt owned worker</button>}
            </div>}
            {worker.sends.filter(send => !pendingSend || send.id !== pendingSend.id).map(send => {
              const resolutions = worker.resolutions.filter(resolution => resolution.sendId === send.id);
              const safeRetry = resolutions.some(resolution => resolution.decision === "not_sent") && !worker.sends.some(other => other.retryOf === send.id);
              return <details key={send.id}>
                <summary>{send.id} · {send.status}{send.retryOf ? ` · retry of ${send.retryOf}` : ""}</summary>
                <p className="technical">Operation: {send.operationId ?? "None"} · failure: {send.result?.failure ?? "None"} · confirmed outcome: {String(send.result?.certain ?? false)}</p>
                <p>Saved prompt</p><pre className="technical" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "15rem", overflow: "auto" }}>{send.prompt}</pre>
                <p>Returned output (untrusted text)</p><pre className="technical" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "25rem", overflow: "auto" }}>{send.result?.text || "No output captured."}</pre>
                {resolutions.map(resolution => <p key={resolution.id}>Human resolution: {resolution.decision} · {resolution.createdAt} · {resolution.evidence}</p>)}
                {safeRetry && <button type="button" disabled={busy || worker.busy || !held || Boolean(pendingSend)}
                  onClick={() => void guard(() => bridge().autopilotWorkerPrepare({ runId: run.id, prompt: send.prompt, retryOf: send.id }))}>Prepare one explicit retry for review</button>}
              </details>;
            })}
            {pendingSend && worker.resolutions.filter(resolution => resolution.sendId === pendingSend.id).map(resolution => <p key={resolution.id}>Human resolution: {resolution.decision} · {resolution.createdAt} · {resolution.evidence}</p>)}
          </section></details>}

          <section className="view-stack" aria-label="Run report">
            <PageHeader
              eyebrow="Rebuilt from the durable journal on every request"
              title="Run report"
              titleId="autopilot-report-title"
              actions={(
                <button type="button" disabled={busy} onClick={() => void guard(async () => setReport(await bridge().autopilotReport(run.id)))}>
                  {report ? "Refresh report" : "Build report"}
                </button>
              )}
            />
            {report && <>
              <p className="technical">Project: {report.spec.projectPath} · Worktree: {report.provider.workspaceRoot}</p>
              {/* The mechanism: sessions, recovery routing, ownership,
                  consultations, provider diagnostics, verification detail,
                  context requests. Still the thing to read when a run goes
                  wrong — but it is not what the run IS, so it does not lead. */}
              <details className="autopilot-mechanism">
                <summary>Diagnostics — sessions, recovery, verification detail</summary>
              <p className="technical">PRIMARY {report.roles.primary.provider} · Session {report.roles.primary.sessionId ?? "Not started"} · Provider session {report.roles.primary.providerSessionId ?? "Not recorded"} · Established {String(report.roles.primary.established)} · Restored {String(report.roles.primary.restored)}</p>
              <p className="technical">CONSULTANT {report.roles.consultant.provider ?? "None"} · {report.roles.consultant.provider ? "Not started" : "No session"}</p>
              <p>Primary status: {report.primaryProgress ? ({ PROGRESSING: "Progressing", STALLED: "Stalled", BLOCKED: "Blocked" }[report.primaryProgress.status]) : "Progressing (not evaluated yet)"}</p>
              {report.primaryProgress && <p>{report.primaryProgress.reason}; Equivalent comparisons: {report.primaryProgress.consecutiveStalled}</p>}
              {report.primaryProgress?.consultantRecommended && report.roles.consultant.provider && <p>Consultant recommended: {report.roles.consultant.provider === "codex" ? "Codex" : "Claude"}</p>}
              {snapshot?.recovery && (() => {
                const decision = snapshot.recovery;
                const label = (p: string | null) => p === "codex" ? "Codex" : p === "claude" ? "Claude" : "None";
                const headline: Record<string, string> = {
                  CONTINUE_PRIMARY: `Continue ${label(decision.currentPrimary)} PRIMARY`,
                  RETRY_PRIMARY: `Retry ${label(decision.currentPrimary)} PRIMARY`,
                  RECOMMEND_CONSULTATION: `Ask ${label(decision.alternateProvider)} for a second opinion`,
                  RECOMMEND_HANDOFF: `Handoff from ${label(decision.currentPrimary)} to ${label(decision.alternateProvider)}`,
                  RESOLVE_UNCERTAIN: `Resolve uncertain ${label(decision.currentPrimary)} send`,
                  WAIT_FOR_OPERATOR: "Operator attention required",
                  COMPLETE: "Run completed",
                  NO_ACTION: "No recovery action required"
                };
                const consultationReady = snapshot.consultationRequest?.eligible && !snapshot.consultationRequest?.busy;
                const handoffTarget = snapshot.handoff?.eligibility.target ?? null;
                return <section aria-label="Recovery" className="notice-card">
                  <h3>Recovery</h3>
                  <p>Current recommendation: {headline[decision.action] ?? decision.action}</p>
                  <p>{decision.summary}</p>
                  <p className="technical">Reason: {decision.reason} · PRIMARY {label(decision.currentPrimary)}{decision.alternateProvider ? ` · alternate ${label(decision.alternateProvider)}` : ""}</p>
                  {decision.action === "RECOMMEND_HANDOFF" && decision.alternatePreflight && <p className="technical">
                    {label(decision.alternateProvider)} available locally: {decision.alternatePreflight.availableLocally ? "yes" : "no"} · usage/quota unknown until a provider call
                  </p>}
                  {decision.action === "RECOMMEND_CONSULTATION" && consultationReady && snapshot.handoff?.currentPrimary && report.roles.consultant.provider &&
                    <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotConsultationRequest({ runId: run.id, consultantProvider: report.roles.consultant.provider as "claude" | "codex" }))}>REQUEST SECOND OPINION</button>}
                  {decision.action === "RECOMMEND_HANDOFF" && snapshot.handoff?.eligibility.eligible && handoffTarget &&
                    <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotHandoffPropose({ runId: run.id, toProvider: handoffTarget as "claude" | "codex" }))}>REQUEST HANDOFF</button>}
                </section>;
              })()}
              {snapshot?.handoff && (() => {
                const view = snapshot.handoff;
                const open = view.open;
                const reasons: Record<string, string> = {
                  run_finished: "This run has finished",
                  no_alternate_provider: "No second provider is configured",
                  target_is_current_primary: "That provider already owns this run",
                  target_not_configured: "That provider is not configured for this run",
                  no_primary_evidence: "PRIMARY has not completed a turn yet",
                  primary_turn_in_flight: "Current PRIMARY turn still running",
                  handoff_already_open: "A handoff is already in progress",
                  workspace_missing: "This run has no validated workspace"
                };
                const target = view.eligibility.target ?? open?.toProvider ?? null;
                const label = (p: string | null) => p === "codex" ? "Codex" : p === "claude" ? "Claude" : "None";
                return <section aria-label="Ownership" className="notice-card">
                  <h3>Implementation ownership</h3>
                  <p>Current PRIMARY: {label(view.currentPrimary)}</p>
                  {view.ownership.length > 1 && <details>
                    <summary>Ownership history</summary>
                    {view.ownership.map(period => <p key={period.id} className="technical">
                      #{period.ordinal} {label(period.provider)} · {period.status} · session {period.sessionId ?? "none"} · from {period.startedAt}{period.retiredAt ? ` to ${period.retiredAt}` : " (current)"}
                    </p>)}
                  </details>}

                  {!open && view.recommendation.recommended && <p>Handoff recommended: {view.recommendation.reason}</p>}
                  {!open && (view.eligibility.eligible && target
                    ? <>
                        <p>Hand implementation ownership to {label(target)}. The work stays in the same worktree.</p>
                        {view.preflight && <p className="technical">
                          {label(target)} available locally: {view.preflight.availableLocally ? "yes" : "no"} · usage/quota unknown until a provider call
                        </p>}
                        <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotHandoffPropose({ runId: run.id, toProvider: target as "claude" | "codex" }))}>REQUEST HANDOFF</button>
                      </>
                    : <p className="technical">Handoff unavailable: {reasons[view.eligibility.reason ?? ""] ?? view.eligibility.reason}</p>)}

                  {open && <>
                    <p>Proposed new PRIMARY: {label(open.toProvider)} (from {label(open.fromProvider)})</p>
                    <p>Status: {(HANDOFF_STATUS_LABELS[open.status] ?? open.status)}</p>
                    <p>Reason: {open.reason}</p>
                    <p>Source: {open.source === "OPERATOR" ? "Operator requested" : "System recommended"}</p>
                    {!open.fresh && <p>The frozen evidence no longer matches this run; propose a fresh handoff.</p>}
                    <details>
                      <summary>Frozen handoff package ({open.packageFingerprint})</summary>
                      <p>Goal: {open.package.goal}</p>
                      <p>Run state: {open.package.runState}{open.package.progress ? ` · ${open.package.progress.status}: ${open.package.progress.reason}` : ""}</p>
                      <p>Latest verification: {open.package.latestVerification?.outcome ?? "none"}{open.package.latestVerification?.failingTier ? ` · failing ${open.package.latestVerification.failingTier}` : ""}</p>
                      <p>Changed files: {open.package.changedPaths.join(", ") || "none recorded"}</p>
                      <p>Latest checkpoint: {open.package.latestCheckpoint?.commitSha ?? open.package.latestCheckpoint?.status ?? "none"}</p>
                      <p>Prior diagnosis included: {open.package.consultantDiagnosis ? `yes (from ${open.package.consultantDiagnosis.provider})` : "no"}</p>
                      <p className="technical">Outgoing session {open.fromSessionId ?? "none"} · incoming session {open.toSessionId ?? "not created yet"}</p>
                    </details>
                    {view.preflight && <p className="technical">
                      {label(open.toProvider)} available locally: {view.preflight.availableLocally ? "yes" : "no"} · usage/quota unknown until a provider call
                    </p>}
                    {open.canApprove && <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotHandoffApprove({ runId: run.id, handoffId: open.id, toProvider: open.toProvider }))}>APPROVE HANDOFF</button>}
                    {open.canActivate && <>
                      <p>Activating handoff changes implementation ownership. The previous PRIMARY will no longer be allowed to modify this run.</p>
                      <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotHandoffActivate({ runId: run.id, handoffId: open.id, toProvider: open.toProvider, maxTurns: loopTurns }))}>ACTIVATE HANDOFF</button>
                    </>}
                    {open.canCancel && <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotHandoffCancel({ runId: run.id, handoffId: open.id, toProvider: open.toProvider }))}>CANCEL HANDOFF</button>}
                  </>}

                  {view.handoffs.filter(entry => entry.status === "ACTIVE").slice(-1).map(entry => <p key={entry.id}>
                    Handoff active: {label(entry.fromProvider)} handed ownership to {label(entry.toProvider)} at {entry.activatedAt}.
                  </p>)}
                </section>;
              })()}
              {snapshot?.consultationRequest && (() => {
                const request = snapshot.consultationRequest;
                const consultant = report.roles.consultant.provider;
                const reasons: Record<string, string> = {
                  no_consultant_configured: "Consultant not configured",
                  consultant_is_primary: "Consultant must differ from PRIMARY",
                  run_finished: "This run has finished",
                  no_primary_evidence: "PRIMARY has not completed a turn yet",
                  primary_turn_in_flight: "Current PRIMARY turn still running",
                  consultation_already_active: "Consultation already active",
                  diagnosis_already_pending: "Diagnosis already pending"
                };
                const blocked = request.busy ? "primary_turn_in_flight" : request.reason;
                const eligible = request.eligible && !request.busy;
                if (!consultant) return null;
                return <section aria-label="Second opinion" className="notice-card">
                  <h3>Second opinion</h3>
                  <p>Ask {consultant === "codex" ? "Codex" : "Claude"} to review this run. PRIMARY keeps ownership; the consultant is read-only and you approve before it runs.</p>
                  {eligible
                    ? <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotConsultationRequest({ runId: run.id, consultantProvider: consultant as "claude" | "codex" }))}>REQUEST SECOND OPINION</button>
                    : <p className="technical">Unavailable: {reasons[blocked ?? ""] ?? blocked}</p>}
                </section>;
              })()}
              {report.consultations?.slice(-1).map(consultation => (
                <section key={consultation.id} aria-label="Consultation" className="notice-card">
                  <h3>Consultation</h3>
                  <p>Primary: {consultation.triggerType} ({consultation.primaryProvider === "codex" ? "Codex" : "Claude"})</p>
                  <p>Consultant: {consultation.consultantProvider === "codex" ? "Codex" : "Claude"}</p>
                  <p>Reason: {consultation.triggerReason}</p>
                  <p>Trigger: {consultation.triggerType === "OPERATOR" ? "Operator requested" : consultation.triggerType === "BLOCKED" ? "Blocked (automatic)" : "Stalled (automatic)"}</p>
                  <p>{({ RECOMMENDED: "Consultation recommended", APPROVED: "Consultation approved", CANCELLED: "Consultation cancelled", SUPERSEDED: "Consultation superseded" })[consultation.status]}</p>
                  {consultation.status === "APPROVED" && <p>{consultation.executionEligible ? "Waiting for consultant execution" : "Authorization is no longer eligible"}</p>}
                  <details open={consultation.status === "RECOMMENDED"}>
                    <summary>Read-only consultation preview</summary>
                    <p>Goal: {consultation.preview.goal}</p>
                    <p>Constraints: {consultation.preview.constraints.join("; ") || "None"}</p>
                    <p>Acceptance criteria: {consultation.preview.acceptanceCriteria.join("; ") || "None"}</p>
                    <p>Triggering turn: {consultation.preview.triggeringTurn ?? "Not started"}; failing tier: {consultation.preview.failingTier ?? "None recorded"}</p>
                    <p>{consultation.preview.failureSummary}</p>
                    <p>Changed paths: {consultation.preview.changedPaths.join(", ") || "None recorded"}</p>
                    <p>Latest checkpoint: {consultation.preview.latestCheckpoint?.commitSha ?? consultation.preview.latestCheckpoint?.status ?? "None"}</p>
                    {consultation.preview.contextRequests.map((request, index) => <p key={`${request.requestedTurnId}-${index}`}>
                      {request.path}: {request.status}; {request.bytesSupplied} bytes; {request.reason ?? "No denial"}; originating turn {request.requestedTurnId}; consuming turn {request.consumedTurnId ?? "Pending"}
                    </p>)}
                  </details>
                  {report.diagnoses.filter(entry => entry.consultationId === consultation.id).map(entry => (
                    <article key={entry.id} aria-label="Consultant diagnosis" className="event-row">
                      <strong>{({ INTENT: "Consultant running", COMPLETED: "Diagnosis complete", FAILED: "Consultant failed", UNCERTAIN: "Consultant send uncertain" })[entry.status]}</strong>
                      <p>Consultant: {entry.consultantProvider === "codex" ? "Codex" : "Claude"} (read-only advisor)</p>
                      <p className="technical">Consultant session {entry.consultantSessionId} · triggering PRIMARY turn {consultation.preview.triggeringTurn ?? "Not recorded"} · {entry.completedAt ? `completed ${entry.completedAt}` : `started ${entry.startedAt}`}</p>
                      {entry.failure && <p>{entry.failure}</p>}
                      {entry.refusedFileBlocks > 0 && <p>{entry.refusedFileBlocks} file change block(s) returned by the consultant were refused and discarded. Consultant output is never written.</p>}
                      {entry.status === "COMPLETED" && <p>{entry.suppliedToTurnId
                        ? `Diagnosis was supplied to PRIMARY turn ${entry.suppliedToTurnId}.`
                        : `Diagnosis will be supplied to the same ${consultation.primaryProvider === "codex" ? "Codex" : "Claude"} PRIMARY session on retry.`}</p>}
                      {entry.diagnosis && <details><summary>Diagnosis</summary><pre className="technical">{entry.diagnosis.slice(0, 4000)}</pre></details>}
                    </article>
                  ))}
                  {consultation.status === "APPROVED" && consultation.executionEligible && !report.diagnoses.some(entry => entry.consultationId === consultation.id) && <>
                    <p>Runs exactly one read-only diagnosis. The consultant cannot write files, checkpoint, or take over the run.</p>
                    <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotConsultationRun({ runId: run.id, requestId: consultation.id, consultantProvider: consultation.consultantProvider }))}>RUN DIAGNOSIS</button>
                  </>}
                  {consultation.canApprove && <>
                    <p>Authorize one future diagnosis for this request and consultant. Approval does not start execution.</p>
                    <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotApproveConsultation({ runId: run.id, requestId: consultation.id, consultantProvider: consultation.consultantProvider }))}>APPROVE CONSULTATION</button>
                  </>}
                  {consultation.canCancel && <button type="button" disabled={busy} onClick={() => void guard(() => bridge().autopilotCancelConsultation({ runId: run.id, requestId: consultation.id, consultantProvider: consultation.consultantProvider }))}>CANCEL</button>}
                </section>
              ))}
              {report.workerDiagnostics?.slice(-1).map(diagnostic => (
                <section key={diagnostic.id} aria-label="Provider failure" className="notice-card">
                  <h3>Provider failure</h3>
                  <p>Provider: {diagnostic.provider === "codex" ? "Codex" : "Claude"} ({diagnostic.role === "CONSULTANT" ? "consultant" : diagnostic.role === "PROBE" ? "readiness probe" : "worker"})</p>
                  <p>Exit code: {diagnostic.exitCode ?? "none"}{diagnostic.signal ? ` · signal ${diagnostic.signal}` : ""}</p>
                  <p>Category: {diagnostic.categoryLabel}</p>
                  {diagnostic.stderrTail.trim() && <details>
                    <summary>stderr ({diagnostic.stderrBytes} bytes{diagnostic.stderrTruncated ? ", showing the tail" : ""})</summary>
                    <pre className="technical">{diagnostic.stderrTail}</pre>
                  </details>}
                  {diagnostic.stdoutTail.trim() && <details>
                    <summary>stdout ({diagnostic.stdoutBytes} bytes{diagnostic.stdoutTruncated ? ", showing the tail" : ""})</summary>
                    <pre className="technical">{diagnostic.stdoutTail}</pre>
                  </details>}
                  <p className="technical">Operation {diagnostic.operationId} · recorded {diagnostic.createdAt}</p>
                </section>
              ))}
              <p>Consecutive failures: {report.execution.consecutiveFailures} / {report.execution.failureLimit} · Latest activity: {report.run.updatedAt}</p>
              {report.loop.turns.filter(turn => turn.verification).slice(-1).map(turn => <section key={turn.turnId} aria-label="Latest verification"><h3>Latest verification: {turn.verification!.outcome}</h3>
                {turn.verification!.tiers.map(tier => <article key={tier.tier} className="event-row"><strong>{tier.tier}: {tier.ok ? "passed" : tier.ran ? "failed" : "not run"}</strong><p className="technical">{tier.command} · Exit {tier.exitCode ?? "unknown"}</p>{!tier.ok && <details><summary>Bounded failure evidence</summary><pre className="technical">{tier.detail.slice(0, 4000)}</pre></details>}</article>)}
              </section>)}
              <p className="technical">
                {report.outcome.classification.toUpperCase()} · {report.loop.turns.length} turn(s) ·{" "}
                {report.checkpoints.filter(entry => entry.commitSha).length} checkpoint(s) ·{" "}
                {report.humanActions.interventionCount} human intervention(s) · {report.eventCount} events
              </p>
              <p>{report.outcome.reason}</p>

              {report.loop.turns.length > 0 && <div className="event-list">
                {report.loop.turns.map(turn => (
                  <article className="event-row" key={turn.ordinal}>
                    <p className="technical">#{turn.ordinal} {turn.kind}</p>
                    <p className="technical">{turn.sendStatus ?? "—"}{turn.sendFailure ? ` (${turn.sendFailure})` : ""}</p>
                    <p>{turn.verification ? `${turn.verification.outcome}: ${turn.verification.summary}` : "Not verified"}</p>
                    <p className="technical">{turn.checkpoint?.commitSha ? turn.checkpoint.commitSha.slice(0, 12) : turn.checkpoint?.status ?? "no checkpoint"}</p>
                  </article>
                ))}
              </div>}

              <section className="view-stack" aria-label="Context requests">
                <h3>Context requests</h3>
                {report.contextRequests.length === 0 ? <p>No context requests recorded.</p> :
                  <div className="event-list">{report.contextRequests.map(request => (
                    <article className="event-row" key={request.id}>
                      <div>
                        <strong className="technical">{request.path}</strong>
                        <p className="technical">From turn {request.requestedTurnOrdinal ?? request.requestedTurnId} · {request.status} · {request.bytesSupplied} {request.bytesUnit === "utf8_bytes" ? "bytes" : "legacy UTF-16 units"} · Consuming turn: {request.consumedTurnOrdinal ?? request.consumedTurnId ?? "none yet"}</p>
                        <p>{request.denialReason ?? request.availabilityReason}</p>
                      </div>
                    </article>
                  ))}</div>}
              </section>

              </details>

              {report.acceptanceCriteria.length > 0 && <div className="event-list">
                {report.acceptanceCriteria.map(criterion => (
                  <article className="event-row" key={criterion.id}>
                    <p className="technical">{criterion.status}</p>
                    <p>{criterion.text}</p>
                    <p className="technical">{criterion.kind}</p>
                  </article>
                ))}
              </div>}

              <p className="technical">
                Final workspace: HEAD {report.workspace.headSha?.slice(0, 12) ?? "unknown"} ·{" "}
                {report.workspace.changedFiles} uncommitted path(s) · captured {report.workspace.capturedAt ?? "never"}
              </p>
              {report.deniedOperations.length > 0 && <p className="technical">Blocked by policy: {report.deniedOperations.length} operation(s)</p>}

              <button type="button" disabled={busy}
                onClick={() => void guard(async () => {
                  const result = await bridge().autopilotReportExport(run.id);
                  setExported(result.written.length ? `Exported to ${result.written.join(", ")}` : `Export refused by policy for ${result.refused.length} file(s).`);
                })}>Export JSON + Markdown</button>
              {exported && <p className="technical">{exported}</p>}
            </>}
          </section>

          {isRealWorker && loop && <section className="view-stack" aria-label="Autonomous loop">
            <PageHeader
              eyebrow={`${workerName} · sticky session · mechanical verification`}
              title="Autonomous loop"
              titleId="autopilot-loop-title"
            />
            {loop.grant ? (
              <>
                <p className="technical">
                  Consumed {loop.grant.turnsUsed} / {loop.grant.maxTurns} turn(s) · Remaining {loop.grant.maxTurns - loop.grant.turnsUsed} · granted by {loop.grant.grantedBy} · PRIMARY {loop.grant.provider}
                </p>
                <p>
                  Each turn still creates its own approval, resolved by this authorization and recorded against it.
                  Revoking stops the loop at the next turn boundary.
                </p>
                <div className="event-row" style={{ gap: "0.5rem" }}>
                  <button type="button" disabled={busy || worker?.busy || loop.busy || !held}
                    onClick={() => void guard(() => bridge().autopilotRunPrimary(run.id))}>Resume authorized primary turns</button>
                  <button type="button" disabled={busy || loop.busy}
                    onClick={() => void guard(() => bridge().autopilotLoopRevoke(run.id))}>Revoke authorization</button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Authorize a bounded number of turns. The loop sends a prompt, runs the configured
                  verification, and feeds failures back to the same session until the acceptance criteria
                  pass or the budget runs out. It never declares success it cannot verify.
                </p>
                <div className="event-row" style={{ gap: "0.5rem", alignItems: "center" }}>
                  <label>Turns
                    <input type="number" min={1} max={50} value={loopTurns}
                      onChange={event => setLoopTurns(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
                  </label>
                  <button type="button" disabled={busy || worker?.busy || Boolean(pendingSend) || !held}
                    onClick={() => void guard(() => bridge().autopilotLoopAuthorize({ runId: run.id, maxTurns: loopTurns }))}>
                    Authorize {loopTurns} turn(s)
                  </button>
                </div>
              </>
            )}
            {loop.turns.length > 0 && <div className="event-list">
              {loop.turns.map(turn => {
                const verification = loop.verifications.find(entry => entry.turnId === turn.id);
                return (
                  <article className="event-row" key={turn.id}>
                    <p className="technical">#{turn.ordinal} {turn.kind}</p>
                    <p className="technical">{turn.status}</p>
                    <p>{verification ? verification.summary : "Not verified"}</p>
                  </article>
                );
              })}
            </div>}
          </section>}

          {approvals.filter(approval => approval.operationId !== pendingSend?.operationId).length > 0 && (
            <>
              <PageHeader
                eyebrow={`Blocked · ${approvals.length} pending`}
                title="Approval required"
                titleId="autopilot-approvals-title"
              />
              {approvals.filter(approval => approval.operationId !== pendingSend?.operationId).map((approval) => (
                <div className="event-row" style={{ gap: "0.5rem", flexWrap: "wrap" }} key={approval.id}>
                  <p><strong>{approval.summary}</strong></p>
                  <p>{approval.reason}</p>
                  <p className="technical">risk {approval.risk} · {approval.capability}</p>
                  <button type="button" onClick={() => void guard(() => bridge().autopilotResolveApproval({ approvalId: approval.id, decision: "APPROVED" }))}>
                    Approve
                  </button>
                  <button type="button" onClick={() => void guard(() => bridge().autopilotResolveApproval({ approvalId: approval.id, decision: "REJECTED" }))}>
                    Reject
                  </button>
                </div>
              ))}
              <p className="empty-state">
                Approving authorizes this one operation. It never grants standing permission,
                and the exact command is re-checked before it runs.
              </p>
            </>
          )}

          {denials.length > 0 && (
            <>
              <PageHeader eyebrow="Policy" title={`Blocked operations (${denials.length})`} titleId="autopilot-denials-title" />
              <div className="event-list">
                {denials.map((operation) => (
                  <article className="event-row" key={operation.id}>
                    <p className="technical">{operation.decisionRule}</p>
                    <p>{operation.summary}</p>
                    <p>{operation.decisionReason}</p>
                    <p className="technical">{operation.risk}</p>
                  </article>
                ))}
              </div>
            </>
          )}

          {uncertainStep && (
            <div className="event-row" style={{ gap: "0.5rem" }}>
              <p>
                Step <span className="technical">{uncertainStep.stepKey}</span> could not be verified after a restart.
                State what actually happened — Autopilot will not guess.
              </p>
              <button type="button" onClick={() => void guard(() => bridge().autopilotResolveUncertain({ runId: run.id, stepKey: uncertainStep.stepKey, resolution: "completed" }))}>
                It completed
              </button>
              <button type="button" onClick={() => void guard(() => bridge().autopilotResolveUncertain({ runId: run.id, stepKey: uncertainStep.stepKey, resolution: "not_performed" }))}>
                It never ran
              </button>
            </div>
          )}

          {!isRealWorker && <>
          <PageHeader eyebrow="Steps" title="Execution" titleId="autopilot-steps-title" />
          <div className="event-list">
            {snapshot!.steps.length === 0 ? (
              <p className="empty-state">No steps recorded yet.</p>
            ) : (
              snapshot!.steps.map((step) => (
                <article className="event-row" key={step.stepKey}>
                  <p className="technical">{step.ordinal}</p>
                  <p className="technical">{step.stepKey}</p>
                  <p>{step.status}</p>
                  <p className="technical">attempts {step.attempts}</p>
                  <p>{step.summary ?? ""}</p>
                </article>
              ))
            )}
          </div>

          </>}
          <h3>Activity</h3>
          <div className="event-list autopilot-timeline">{report?.activity.slice(-100).map(event => <article className="event-row" key={event.id}><p>{event.label}</p><time>{event.at}</time></article>)}</div>

          {ACTIVE_STATES.includes(run.state) && (
            <p className="empty-state">
              This run continues in the background. Closing this window does not stop it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
