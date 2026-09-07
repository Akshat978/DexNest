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
import type { ActivityEvent, AttachedSessionRecord, DirectionDecision, GroupDigest, IterationRecord, MorningSummary, OperatorNoteRecord, PlanItemProgress, SessionCandidate, UsageReport } from "@dexnest/autopilot-runtime";

interface LiveBridge {
  autopilotActivity(runId: string): Promise<ActivityEvent[]>;
  autopilotMorningSummary(runId: string): Promise<MorningSummary>;
  /** retryProviderLimit is the deliberate "the limit has reset, carry on". */
  autopilotLoopRun(runId: string, input?: { retryProviderLimit?: boolean }): Promise<unknown>;
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
export function RunSummary({ runId, working, refreshedAt, onChanged }: { runId: string; working: boolean; refreshedAt: number; onChanged: () => void }) {
  const [summary, setSummary] = useState<MorningSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (working) { setSummary(null); return () => { alive = false; }; }
    void api().autopilotMorningSummary(runId)
      .then(value => { if (alive) setSummary(value); })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [runId, working, refreshedAt]);

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
      {/* Running out of capacity is the one obstacle that clears on its own,
          and by default the run no longer retries by itself — so the operator
          needs a way to say "it is back". Until this existed the signal was
          reachable only by the resume timer, which is why a run that hit its
          limit could not be continued at all without waiting for a backoff. */}
      {summary.action === "resume" && (
        <>
          {error && <p className="autopilot-error">{error}</p>}
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api().autopilotLoopRun(runId, { retryProviderLimit: true })
                  .then(() => onChanged())
                  .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Trying…" : "TRY AGAIN NOW"}
            </button>
          </div>
        </>
      )}
      <pre className="technical autopilot-where">{summary.whereToWatch}</pre>
    </div>
  );
}

// --- the morning ------------------------------------------------------------

interface MorningBridge {
  autopilotNotes(runId: string): Promise<OperatorNoteRecord[]>;
  autopilotAddNote(input: { runId: string; text: string }): Promise<OperatorNoteRecord>;
  autopilotPlanCompleteProposal(runId: string): Promise<DirectionDecision | null>;
  autopilotAcceptPlanComplete(runId: string): Promise<void>;
  autopilotRejectPlanComplete(input: { runId: string; reason: string }): Promise<OperatorNoteRecord>;
}
const morning = () => (window as unknown as { dexNest: MorningBridge }).dexNest;

/**
 * What a person does after reading a run.
 *
 * Two questions that are really one surface, which is why they are one
 * component: answer the run's claim to be finished, and say whatever reading
 * it made you want to say. Rejecting a completion IS writing a note, so
 * splitting them would leave the note list stale the moment it mattered most.
 *
 * Neither action starts a turn. Deciding what happens next and starting it are
 * separate, deliberate acts, and every other control in this view assumes that.
 */
export function MorningPanel({ runId, working, refreshedAt, onChanged }: { runId: string; working: boolean; refreshedAt: number; onChanged: () => void }) {
  const [proposal, setProposal] = useState<DirectionDecision | null>(null);
  const [notes, setNotes] = useState<OperatorNoteRecord[]>([]);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void morning().autopilotPlanCompleteProposal(runId).then(setProposal).catch(() => setProposal(null));
    void morning().autopilotNotes(runId).then(setNotes).catch(() => setNotes([]));
  };

  // Keyed on runId, whether a turn is in flight, and the parent's refresh
  // counter — NOT on onChanged, which is a new function every render and would
  // refetch forever. Without the counter, pressing Refresh updated the rest of
  // the page and left this panel showing what it read when it mounted.
  useEffect(load, [runId, working, refreshedAt]);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void fn()
      .then(() => { setReason(""); setText(""); load(); onChanged(); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const pending = [...notes].reverse().find(note => !note.consumedTurnId) ?? null;

  return (
    <>
      {proposal && (
        <div className="card autopilot-decision">
          <h4>It says the work is done</h4>
          <p className="technical">Its reason: {proposal.reason ?? "none given"}</p>
          <p>It did not finish the run itself. Accepting completes it; rejecting sends what you write below as the next instruction.</p>
          <label>
            What is still missing (needed only to reject)
            <textarea rows={3} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
          </label>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => act(() => morning().autopilotAcceptPlanComplete(runId))}>
              ACCEPT — the run is done
            </button>
            {/* Handing back the same evidence that produced "I am finished"
                produces "I am finished" again, so the reason is not a
                formality — it is the instruction for the next turn. */}
            <button type="button" disabled={busy || !reason.trim()} onClick={() => act(() => morning().autopilotRejectPlanComplete({ runId, reason }))}>
              REJECT — keep going
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h4>Before it carries on</h4>
        <p className="technical">
          Goes in front of the next prompt, once. It outranks what the agent said it would do next; it does not change
          the goal or the acceptance criteria.
        </p>
        <label>
          <textarea
            rows={3}
            value={text}
            disabled={busy}
            placeholder="e.g. The error handling is the wrong shape — use Result, not exceptions."
            onChange={event => setText(event.target.value)}
          />
        </label>
        {error && <p className="autopilot-error">{error}</p>}
        <div className="row">
          <button type="button" disabled={busy || !text.trim()} onClick={() => act(() => morning().autopilotAddNote({ runId, text }))}>
            SAVE NOTE
          </button>
        </div>
        {pending && <p><strong>Waiting to be sent:</strong> {pending.text}</p>}
        {notes.length > 0 && (
          <details className="autopilot-mechanism">
            <summary>Notes on this run ({notes.length})</summary>
            <ol className="autopilot-assumptions">
              {notes.map(note => (
                <li key={note.id}>
                  {note.text}
                  <span className="technical"> — {note.author}, {note.consumedTurnId ? "sent" : "not sent yet"}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </>
  );
}

// --- continuing a session you primed ----------------------------------------

interface SessionBridge {
  autopilotSessionCandidates(runId: string): Promise<SessionCandidate[]>;
  autopilotAttachedSession(runId: string): Promise<AttachedSessionRecord | null>;
  autopilotAttachSession(input: { runId: string; sessionId: string }): Promise<AttachedSessionRecord>;
}
const sessions = () => (window as unknown as { dexNest: SessionBridge }).dexNest;

const BLOCKER_TEXT: Record<string, string> = {
  live: "Still open somewhere — close it in your editor",
  attached_elsewhere: "Another run is already continuing it",
  project_mismatch: "It was working in a different project",
  run_has_session: "This run already has a session"
};

const ago = (iso: string | null) => {
  if (!iso) return "unknown";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "unknown";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

/**
 * Adopting the conversation you already had.
 *
 * The workflow this is for: explain the job to Claude Code in the editor, where
 * explaining is easy and you can see the answers, then hand that same
 * conversation to DexNest to carry on unattended. The session is shared — the
 * panel and DexNest's CLI read and write the same transcript files — so this is
 * adoption, not a copy.
 *
 * Which is also why a session that has been written to in the last few minutes
 * is refused. A transcript has one writer; two would interleave into something
 * neither side can reason about, and there is no recovery from that. So the
 * refusal is loud and says what to do about it.
 */
export function SessionAdoption({ runId, working, refreshedAt, onChanged }: { runId: string; working: boolean; refreshedAt: number; onChanged: () => void }) {
  const [candidates, setCandidates] = useState<SessionCandidate[] | null>(null);
  const [attached, setAttached] = useState<AttachedSessionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void sessions().autopilotAttachedSession(runId).then(setAttached).catch(() => setAttached(null));
    void sessions().autopilotSessionCandidates(runId).then(setCandidates).catch(() => setCandidates([]));
  };
  // The refresh counter is what makes Refresh work here. onChanged cannot be
  // a dependency (new function every render, so it would refetch forever), and
  // runId/working alone never change while an operator waits for a session's
  // ten-minute liveness window to expire — which is exactly when they press it.
  useEffect(load, [runId, working, refreshedAt]);

  if (attached) {
    return (
      <div className="card">
        <h4>Continuing a conversation you started</h4>
        <p>
          {attached.title ? <strong>{attached.title}</strong> : <em>untitled session</em>}
          {" — started in "}
          {attached.origin === "vscode" ? "your editor" : attached.origin === "cli" ? "a terminal" : "an unknown client"}
        </p>
        <p className="technical">Session {attached.sessionId} · adopted {attached.attachedAt}</p>
      </div>
    );
  }

  // Nothing to offer and nothing gone wrong: a run with a session of its own is
  // the normal case and does not need a card explaining that.
  if (candidates !== null && candidates.length === 0) return null;

  const adopt = (sessionId: string) => {
    setBusy(true);
    setError(null);
    void sessions().autopilotAttachSession({ runId, sessionId })
      .then(() => { load(); onChanged(); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <h4>Continue a conversation instead</h4>
      <p className="technical">
        Explain the job to Claude Code in your editor, then hand that session here. DexNest resumes it rather than
        starting cold, so everything you already said still counts.
      </p>
      {error && <p className="autopilot-error">{error}</p>}
      {candidates === null && <p className="technical">Looking…</p>}
      <ul className="autopilot-sessions">
        {(candidates ?? []).map(({ session, blockers, attachable }) => (
          <li key={session.sessionId} className={attachable ? undefined : "session-blocked"}>
            <div>
              <strong>{session.title ?? "untitled session"}</strong>
              <span className="technical">
                {" "}— {session.origin === "vscode" ? "editor" : session.origin === "cli" ? "terminal" : "unknown"}
                , last active {ago(session.lastActivity)}
              </span>
            </div>
            {blockers.length > 0
              ? <p className="technical">{blockers.map(blocker => BLOCKER_TEXT[blocker] ?? blocker).join(" · ")}</p>
              : <button type="button" disabled={busy} onClick={() => adopt(session.sessionId)}>CONTINUE THIS ONE</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}


// --- what the night cost ----------------------------------------------------

/**
 * Where the usage went, per phase.
 *
 * The provider's per-turn figure has been recorded since the cost budget
 * existed and shown nowhere, so the obvious question after an expensive night —
 * which phase was it? — had no answer, and the obvious theory ("we send too
 * much context") could be neither confirmed nor ruled out.
 *
 * DexNest's own prompt sits beside the cost deliberately. It is about a
 * thousand tokens, and seeing that next to a turn that cost real money is what
 * shows the two are unrelated: the expense is the conversation being resumed,
 * not the assignment being sent.
 */
export function UsagePanel({ usage }: { usage: UsageReport | null }) {
  if (!usage || usage.turns.length === 0) return null;

  const dearest = [...usage.phases]
    .filter(phase => phase.costUsd !== null)
    .sort((left, right) => (right.costUsd ?? 0) - (left.costUsd ?? 0))[0];

  return (
    <div className="card">
      <h4>What it cost</h4>
      <p>
        <strong>${usage.totalUsd.toFixed(2)}</strong> across {usage.turns.length} turn(s),
        as the provider reports it — a usage proxy on a subscription, not a bill.
      </p>
      {usage.unreportedTurns > 0 && (
        <p className="technical">{usage.unreportedTurns} turn(s) reported nothing and are not counted.</p>
      )}

      {usage.growth && (
        <p className={usage.growth.ratio >= 1.5 ? undefined : "technical"}>
          {usage.growth.ratio >= 1.5
            ? `The last turn cost ${usage.growth.ratio.toFixed(1)}x the first. A run whose turns get dearer is paying for its own history — every phase re-sends the ones before it.`
            : `Cost per turn stayed roughly level (${usage.growth.first.toFixed(2)} then ${usage.growth.last.toFixed(2)}).`}
        </p>
      )}

      {dearest && (
        <p className="technical">
          Dearest phase: {dearest.ordinal} — ${dearest.costUsd!.toFixed(2)} over {dearest.turns} turn(s).
        </p>
      )}

      <details className="autopilot-mechanism">
        <summary>Per phase, and per turn</summary>
        <ol className="autopilot-usage">
          {usage.phases.map(phase => (
            <li key={phase.ordinal}>
              Phase {phase.ordinal}
              <span className="technical">
                {" — "}{phase.costUsd === null ? "not reported" : `$${phase.costUsd.toFixed(2)}`}
                {" over "}{phase.turns} turn(s){phase.summary ? ` · ${phase.summary}` : ""}
              </span>
            </li>
          ))}
        </ol>
        <table className="autopilot-usage-turns">
          <thead>
            <tr><th>Turn</th><th>Cost</th><th>Cumulative</th><th>DexNest prompt</th></tr>
          </thead>
          <tbody>
            {usage.turns.map(entry => (
              <tr key={entry.turnId}>
                <td>{entry.ordinal}</td>
                <td>{entry.costUsd === null ? "—" : `$${entry.costUsd.toFixed(2)}`}</td>
                <td>${entry.cumulativeUsd.toFixed(2)}</td>
                <td>{entry.promptChars.toLocaleString()} chars</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// --- what needs a person ----------------------------------------------------

interface AttentionSnapshot {
  deliver: GroupDigest[];
  hold: GroupDigest[];
  reason: Array<{ groupKey: string; reason: string; coolsDownAt: string | null; quietEndsAt: string | null }>;
  summary: string;
}

interface AttentionBridge {
  autopilotAttention(runId?: string): Promise<AttentionSnapshot>;
}
const attention = () => (window as unknown as { dexNest: AttentionBridge }).dexNest;

const PRIORITY_WORD: Record<string, string> = {
  INFO: "for information",
  ATTENTION: "worth seeing soon",
  ACTION_REQUIRED: "needs an answer",
  URGENT: "urgent"
};

const HOLD_WORD: Record<string, string> = {
  cooling_down: "already said recently",
  quiet_hours: "held until quiet hours end",
  "cooling_down+quiet_hours": "already said recently, and it is quiet hours"
};

/**
 * What needs a person, decided by the attention engine.
 *
 * This is the desktop half of the mobile companion, and it exists before the
 * phone on purpose. The engine's mapping from run states to priorities is the
 * part most likely to feel wrong in practice — too much noise, or something
 * important classed as routine. Getting that wrong on a screen you are already
 * looking at costs nothing; getting it wrong on a phone at 3am costs trust in
 * the whole thing.
 *
 * What is HELD is shown too, with the reason. A quiet system must never be a
 * silent one, and the only way to know it is being quiet rather than broken is
 * to be able to see what it is holding back.
 */
export function AttentionPanel({ refreshedAt }: { refreshedAt: number }) {
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    void attention().autopilotAttention()
      .then(value => { if (alive) setSnapshot(value); })
      .catch(() => { if (alive) setSnapshot(null); });
    return () => { alive = false; };
  }, [refreshedAt]);

  if (!snapshot || (snapshot.deliver.length === 0 && snapshot.hold.length === 0)) return null;
  const reasonFor = (groupKey: string) => snapshot.reason.find(entry => entry.groupKey === groupKey);

  return (
    <div className="card">
      <h4>What needs you</h4>
      {snapshot.deliver.length === 0 && <p className="technical">Nothing right now.</p>}

      <ul className="autopilot-attention">
        {snapshot.deliver.map(group => (
          <li key={group.groupKey} className={`attention-${group.priority.toLowerCase()}`}>
            <strong>{group.headline}</strong>
            <span className="technical"> — {PRIORITY_WORD[group.priority] ?? group.priority}</span>
            {group.count > 1 && <span className="technical"> · {group.count} together</span>}
            {group.latest && <p className="technical">{group.latest}</p>}
          </li>
        ))}
      </ul>

      {snapshot.hold.length > 0 && (
        <details className="autopilot-mechanism">
          <summary>Being held back ({snapshot.hold.length})</summary>
          <ul className="autopilot-attention">
            {snapshot.hold.map(group => {
              const why = reasonFor(group.groupKey);
              return (
                <li key={group.groupKey} className="attention-held">
                  {group.headline}
                  <span className="technical"> — {why ? HOLD_WORD[why.reason] ?? why.reason : "waiting"}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
