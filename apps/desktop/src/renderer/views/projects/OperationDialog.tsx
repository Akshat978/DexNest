// Every git operation in the view goes through this dialog:
// preview in plain words -> the confirmation its safety class needs -> run,
// with git's output live in a collapsible monospace panel -> the result, and
// Undo when there is one. Nothing runs without the preview having been shown,
// and what runs is exactly what was previewed (the fingerprint travels along;
// a changed plan comes back as "stale" and is shown again).

import React, { useEffect, useRef, useState } from "react";

import type { ExecuteResult, OperationPlan, Refusal } from "@dexnest/projects/domain";
import { Badge, Button, Dialog } from "../../components/ui/kit";
import type { ProjectsBridge } from "./projectsBridge";
import { operationLabel } from "./projectsModel";

export type DialogPhase =
  | { kind: "loading" }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "preview"; plan: OperationPlan; fingerprint: string; stale?: boolean }
  | { kind: "running"; plan: OperationPlan }
  | { kind: "result"; result: ExecuteResult };

export interface OperationDialogProps {
  bridge: ProjectsBridge;
  projectId: string;
  projectName: string;
  request: Record<string, unknown>;
  onClose(): void;
  /** After anything ran (so the view re-reads git state). */
  onFinished(result: ExecuteResult): void;
  /** A refusal's offer was taken: open a new dialog for this request. */
  onRequest?(request: Record<string, unknown>): void;
  onOpenTerminal?(): void;
}

const OFFER_LABELS = {
  open_terminal: "Open a terminal here",
  push_set_upstream: "Push and set upstream",
  stash_and_switch: "Stash changes and switch",
  pull: "Pull first",
  fetch: "Fetch",
  refresh: "Refresh"
} as const;

const SAFETY_WORDS = { read: "Read only", normal: "Safe", caution: "Asks first", strong: "Type to confirm" } as const;

export function offerRequest(offer: keyof typeof OFFER_LABELS, request: Record<string, unknown>): Record<string, unknown> | null {
  switch (offer) {
    case "push_set_upstream":
      return { ...request, kind: "push", setUpstream: true };
    case "stash_and_switch":
      return { ...request, dirty: "stash" };
    case "pull":
      return { kind: "pull" };
    case "fetch":
      return { kind: "fetch" };
    case "refresh":
      return { ...request };
    default:
      return null;
  }
}

/** The dialog's body for a phase. Pure, so it can be rendered and tested without a bridge. */
export function OperationBody({
  phase,
  typed,
  onTyped,
  output,
  showOutput,
  onToggleOutput
}: {
  phase: DialogPhase;
  typed: string;
  onTyped(value: string): void;
  output: readonly string[];
  showOutput: boolean;
  onToggleOutput(): void;
}) {
  const outputPanel = output.length > 0 && (
    <div className="projects-op__output">
      <button type="button" className="projects-op__output-toggle" aria-expanded={showOutput} onClick={onToggleOutput}>
        {showOutput ? "Hide" : "Show"} git output ({output.length} line{output.length === 1 ? "" : "s"})
      </button>
      {showOutput && (
        <pre className="projects-op__log" aria-label="Git output">
          {output.join("\n")}
        </pre>
      )}
    </div>
  );
  switch (phase.kind) {
    case "loading":
      return <p className="projects-op__muted" role="status">Checking the repository…</p>;
    case "refused":
      return (
        <div className="projects-op__refusal" role="alert">
          <p>{phase.refusal.reason}</p>
        </div>
      );
    case "preview": {
      const plan = phase.plan;
      return (
        <div className="projects-op__preview">
          {phase.stale && <p className="projects-op__stale" role="alert">The project changed since you opened this. Here is what would happen now.</p>}
          <p className="projects-op__summary">{plan.summary}</p>
          {plan.details.length > 0 && (
            <ul className="projects-op__details">
              {plan.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <div className="projects-op__chips">
            <Badge tone={plan.safety === "strong" ? "error" : plan.safety === "caution" ? "warning" : "success"}>{SAFETY_WORDS[plan.safety]}</Badge>
            {plan.network && <Badge tone="info">Uses the network</Badge>}
            {plan.undo && <Badge tone="neutral">Can be undone</Badge>}
          </div>
          {plan.confirm.kind === "type" && (
            <label className="projects-op__type">
              <span>
                Type <code className="kit-tech">{plan.confirm.text}</code> to confirm
              </span>
              <input value={typed} onChange={(e) => onTyped(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="projects-op-type-hint" className="projects-op__type-input" />
              <span id="projects-op-type-hint" className="projects-op__muted">
                Exactly as shown.
              </span>
            </label>
          )}
        </div>
      );
    }
    case "running":
      return (
        <div className="projects-op__running">
          <p role="status">
            <span className="projects-op__spinner" aria-hidden="true" /> {phase.plan.summary.replace(/\.$/, "")}…
          </p>
          {outputPanel}
        </div>
      );
    case "result": {
      const r = phase.result;
      const ok = r.status === "done" && r.outcome === "succeeded";
      const text =
        r.status === "done" ? r.message : r.status === "refused" ? r.refusal.reason : r.status === "busy" ? `Another operation (${r.runningVerb}) is running in this project.` : "The project changed; nothing ran.";
      return (
        <div className="projects-op__result">
          <p className={ok ? "projects-op__ok" : "projects-op__fail"} role={ok ? "status" : "alert"}>
            {text}
          </p>
          {outputPanel}
        </div>
      );
    }
  }
}

export function OperationDialog({ bridge, projectId, projectName, request, onClose, onFinished, onRequest, onOpenTerminal }: OperationDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [showOutput, setShowOutput] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void bridge.projectsPreview(projectId, request).then(
      (preview) => {
        if (!live) return;
        setPhase(preview.refused ? { kind: "refused", refusal: preview.refusal } : { kind: "preview", plan: preview.plan, fingerprint: preview.fingerprint });
      },
      (error: unknown) => live && setPhase({ kind: "refused", refusal: { refused: true, kind: "unknown", code: "invalid_request", reason: (error as Error).message, offers: [] } })
    );
    return () => {
      live = false;
    };
  }, [bridge, projectId, request]);

  useEffect(
    () =>
      bridge.onProjectsOutput((payload) => {
        if (payload.projectId === projectId && running.current) setOutput((lines) => [...lines.slice(-399), payload.line]);
      }),
    [bridge, projectId]
  );

  const run = async (extra: Record<string, unknown> = request) => {
    if (phase.kind !== "preview") return;
    running.current = true;
    setPhase({ kind: "running", plan: phase.plan });
    try {
      const result = await bridge.projectsExecute(projectId, extra, {
        confirmation: { confirmed: true, typed: phase.plan.confirm.kind === "type" ? typed : undefined },
        fingerprint: phase.fingerprint
      });
      if (result.status === "stale") {
        setTyped("");
        setPhase({ kind: "preview", plan: result.plan, fingerprint: result.fingerprint, stale: true });
        return;
      }
      if (result.status === "done" && result.output.length > 0) setOutput(result.output);
      setPhase({ kind: "result", result });
      onFinished(result);
    } catch (error) {
      setPhase({ kind: "refused", refusal: { refused: true, kind: "unknown", code: "invalid_request", reason: (error as Error).message, offers: [] } });
    } finally {
      running.current = false;
    }
  };

  const title = phase.kind === "preview" || phase.kind === "running" ? phase.plan.title : phase.kind === "result" && phase.result.status === "done" ? phase.result.plan.title : operationLabel(String(request.kind ?? ""));
  const canRun = phase.kind === "preview" && (phase.plan.confirm.kind !== "type" || typed === phase.plan.confirm.text);
  const runLabel = phase.kind === "preview" ? (phase.plan.confirm.kind === "none" ? phase.plan.title : `Yes, ${phase.plan.title.toLowerCase()}`) : "Run";
  const result = phase.kind === "result" ? phase.result : null;
  const undoable = result?.status === "done" && result.undoAvailable ? result.opId : null;
  const authNeeded = result?.status === "done" && result.outcome === "auth_needed";

  const footer = (
    <>
      {phase.kind === "refused" &&
        phase.refusal.offers.map((offer) =>
          offer === "open_terminal" ? (
            <Button key={offer} variant="ghost" onClick={() => onOpenTerminal?.()}>
              {OFFER_LABELS[offer]}
            </Button>
          ) : (
            <Button
              key={offer}
              variant="secondary"
              onClick={() => {
                const next = offerRequest(offer, request);
                if (next) onRequest?.(next);
              }}
            >
              {OFFER_LABELS[offer]}
            </Button>
          )
        )}
      {authNeeded && (
        <Button variant="secondary" onClick={() => onOpenTerminal?.()}>
          Open a terminal here
        </Button>
      )}
      {undoable && (
        <Button variant="ghost" onClick={() => onRequest?.({ kind: "undo", opId: undoable })}>
          Undo
        </Button>
      )}
      <Button variant="ghost" onClick={onClose} disabledReason={phase.kind === "running" ? "Wait for git to finish." : null}>
        {phase.kind === "result" || phase.kind === "refused" ? "Close" : "Cancel"}
      </Button>
      {phase.kind === "preview" && (
        <Button
          variant={phase.plan.safety === "caution" || phase.plan.safety === "strong" ? "danger" : "primary"}
          disabledReason={canRun ? null : "Type the name exactly as shown first."}
          onClick={() => void run()}
          data-run
        >
          {runLabel}
        </Button>
      )}
    </>
  );

  return (
    <Dialog
      title={title}
      description={projectName}
      onClose={phase.kind === "running" ? () => undefined : onClose}
      footer={footer}
      // Caution and strong confirmations start on Cancel, never on the destructive button.
      initialFocus={phase.kind === "preview" && phase.plan.confirm.kind === "type" ? ".projects-op__type-input" : undefined}
    >
      <OperationBody phase={phase} typed={typed} onTyped={setTyped} output={output} showOutput={showOutput} onToggleOutput={() => setShowOutput((s) => !s)} />
    </Dialog>
  );
}
