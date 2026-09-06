// The primary Selected Run view: what is happening, and what happened.
//
// The old Control Center was built around the mechanism — turns, sends,
// approvals, handoffs — because that is what existed. What an operator actually
// wants to know is smaller and different: is it working right now, how far
// through the plan is it, what did it decide without me, and where do I read
// the conversation. So that is what this shows, and the mechanism moves behind
// a details element for when something has gone wrong.
//
// The live panel is a window, not a transcript. The conversation is durable in
// the agent's own session and is better read there; this is the "it is alive
// and it is doing this" view that a buffered run could never give.

import React, { useEffect, useRef, useState } from "react";
import type { ActivityEvent, IterationRecord, MorningSummary, PlanItemProgress } from "@dexnest/autopilot-runtime";

interface LiveBridge {
  autopilotActivity(runId: string): Promise<ActivityEvent[]>;
  autopilotMorningSummary(runId: string): Promise<MorningSummary>;
}
const api = () => (window as unknown as { dexNest: LiveBridge }).dexNest;

const ICONS: Record<ActivityEvent["kind"], string> = {
  thinking: "…", text: "▸", tool: "⚙", result: "✓", error: "✕"
};

/**
 * What the agent is doing, as it does it.
 *
 * Polled rather than pushed: the host already emits a change notification per
 * event, and re-reading a bounded in-memory list is cheaper than plumbing a
 * second push channel. It stops polling the moment the run is not working, so
 * an idle DexNest does no work (AGENTS.md idle-resource rule).
 */
export function LiveActivityPanel({ runId, working }: { runId: string; working: boolean }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      void api().autopilotActivity(runId).then(value => { if (alive) setEvents(value); }).catch(() => {});
    };
    read();
    if (!working) return () => { alive = false; };
    const timer = setInterval(read, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [runId, working]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="card">
        <h4>Live</h4>
        <p className="technical">
          {working
            ? "Waiting for the agent's first move…"
            : "Nothing running. This fills in while a turn is in flight; the full conversation lives in the agent's own session."}
        </p>
      </div>
    );
  }

  return (
    <div className="card autopilot-live">
      <h4>Live{working ? " · working" : " · last turn"}</h4>
      <ol className="autopilot-activity">
        {events.map((event, index) => (
          <li key={`${event.at}-${index}`} className={`activity-${event.kind}`}>
            <span aria-hidden="true">{ICONS[event.kind]}</span> {event.label}
          </li>
        ))}
      </ol>
      <div ref={bottom} />
    </div>
  );
}

/** How far through the plan the run is. One line per item, nothing more. */
export function PlanProgress({ items }: { items: PlanItemProgress[] }) {
  if (items.length === 0) return null;
  const done = items.filter(item => item.status === "DONE").length;
  return (
    <div className="card">
      <h4>Plan · {done} of {items.length}</h4>
      <ol className="autopilot-plan">
        {items.map(item => (
          <li key={item.id} className={`plan-${item.status.toLowerCase()}`}>
            <strong>{item.title}</strong>
            {item.note && <span className="technical"> — {item.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Pieces of work, each with the checkpoint you can revert to. */
export function IterationList({ iterations }: { iterations: IterationRecord[] }) {
  if (iterations.length === 0) return null;
  return (
    <div className="card">
      <h4>Work done · {iterations.filter(entry => entry.status === "VERIFIED").length} verified</h4>
      <ol className="autopilot-iterations">
        {iterations.map(iteration => (
          <li key={iteration.id} className={`iteration-${iteration.status.toLowerCase()}`}>
            <strong>{iteration.ordinal}.</strong> {iteration.summary?.split("\n")[0] ?? iteration.status}
            {iteration.checkpointId && <span className="technical"> · committed</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What is true right now, in the words someone who has been away would want.
 *
 * Loaded on demand rather than with every refresh: it is derived from the whole
 * report and there is no reason to rebuild it while a run is mid-turn.
 */
export function RunSummary({ runId, working }: { runId: string; working: boolean }) {
  const [summary, setSummary] = useState<MorningSummary | null>(null);

  useEffect(() => {
    let alive = true;
    if (working) { setSummary(null); return () => { alive = false; }; }
    void api().autopilotMorningSummary(runId)
      .then(value => { if (alive) setSummary(value); })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [runId, working]);

  if (working) {
    return <div className="card"><h4>Status</h4><p><strong>Working.</strong></p></div>;
  }
  if (!summary) return null;

  const next: Record<MorningSummary["action"], string> = {
    nothing: "Nothing to do.",
    review: "Read what happened, then decide whether to continue.",
    resume: "Authorize more work to continue.",
    decide: "It needs an answer from you before it goes further.",
    sign_in: "Sign in to the provider, then resume.",
    waiting: "Nothing to do; it will pick itself back up."
  };

  return (
    <div className="card">
      <h4>Status</h4>
      <p><strong>{summary.headline}</strong></p>
      <p>{summary.detail}</p>
      <p className="technical">
        {summary.iterationsDone} of {summary.iterationsAttempted} piece(s) of work completed · {summary.checkpoints} checkpoint(s)
      </p>
      {summary.assumptions.length > 0 && (
        <>
          <p><strong>It decided {summary.assumptions.length} thing(s) on its own rather than stopping to ask:</strong></p>
          <ol className="autopilot-assumptions">
            {summary.assumptions.map((text, index) => <li key={index}>{text}</li>)}
          </ol>
        </>
      )}
      <p><strong>Next:</strong> {next[summary.action]}</p>
      <pre className="technical autopilot-where">{summary.whereToWatch}</pre>
    </div>
  );
}
