// Several projects in one night.
//
// The New Run form asks three questions about one project. This asks the same
// three about a list of them, and then gets out of the way: the queue starts
// the first project immediately and every later one when the previous run
// settles, so there is nothing to click again until morning.
//
// The budget is the point, and it is stated where it is set: the deadline and
// the spend cap span the whole queue, not each project. Three projects share
// one night, not three nights' worth of spend.

import React, { useEffect, useState } from "react";
import type { RunQueueItemRecord, RunQueueRecord, QueueProgress } from "@dexnest/autopilot-runtime";

interface QueueSnapshot {
  queue: RunQueueRecord;
  items: RunQueueItemRecord[];
  progress: QueueProgress;
  spentUsd: number;
  summary: string;
}

interface QueueBridge {
  autopilotQueue(): Promise<QueueSnapshot | null>;
  autopilotQueueCreate(input: {
    items: Array<{ projectPath: string; goal: string; label?: string }>;
    budget?: { deadline?: string; maxCostUsd?: number; maxConsecutiveFailures?: number };
    template?: { model?: string | null; effort?: string | null };
  }): Promise<RunQueueRecord | null>;
  autopilotQueueClose(queueId: string): Promise<unknown>;
}
const api = () => (window as unknown as { dexNest: QueueBridge }).dexNest;

const MARK: Record<string, string> = {
  PENDING: "waiting",
  RUNNING: "working",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
  ABANDONED: "left unfinished"
};

/** 7am tomorrow, or today if it has not happened yet. Same rule as New Run. */
function nextSevenAm(now: Date): string {
  const at = new Date(now);
  at.setHours(7, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

export function AutopilotQueue({ refreshedAt, onChanged }: { refreshedAt: number; onChanged: () => void }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [paths, setPaths] = useState("");
  const [goal, setGoal] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [spend, setSpend] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api().autopilotQueue().then(setSnapshot).catch(() => setSnapshot(null));
  };
  // Keyed on the parent's refresh counter, never on onChanged — that is a new
  // function every render and would refetch forever.
  useEffect(load, [refreshedAt]);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void fn()
      .then(() => { load(); onChanged(); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  if (snapshot) {
    const { queue, items, progress, spentUsd } = snapshot;
    return (
      <section className="view-stack" aria-label="Run Queue">
        <div className="card">
          <h3>Tonight's queue</h3>
          <p className="technical">
            {progress.done} done · {progress.failed} failed · {progress.remaining} waiting ·
            {" "}${spentUsd.toFixed(2)} spent so far, as the provider reports it
          </p>
          <ol className="autopilot-queue">
            {items.map(item => (
              <li key={item.id} className={`queue-${item.status.toLowerCase()}`}>
                <strong>{item.label ?? item.projectPath}</strong>
                <span className="technical"> — {MARK[item.status] ?? item.status}</span>
                {item.reason && <p className="technical">{item.reason}</p>}
              </li>
            ))}
          </ol>
          {queue.budget.deadline && (
            <p className="technical">Stops at {new Date(queue.budget.deadline).toLocaleString()}, between projects — never mid-run.</p>
          )}
          {error && <p className="autopilot-error">{error}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => act(() => api().autopilotQueueClose(queue.id))}>
              CLOSE QUEUE
            </button>
          </div>
        </div>
      </section>
    );
  }

  const projects = paths.split("\n").map(line => line.trim()).filter(line => line);

  return (
    <section className="view-stack" aria-label="Run Queue">
      <div className="card">
        <h3>Work through several projects tonight</h3>
        <p className="technical">
          One project at a time, in this order, on one shared budget. The first starts now; each later one starts
          when the previous finishes. Nothing to click again until morning.
        </p>
        <label>
          Projects, one absolute path per line
          <textarea
            rows={4}
            value={paths}
            disabled={busy}
            placeholder={"D:\\astro-yogi\nD:\\portfolio-v2"}
            onChange={event => setPaths(event.target.value)}
          />
        </label>
        <label>
          What should it do to each of them?
          <textarea
            rows={3}
            value={goal}
            disabled={busy}
            placeholder="e.g. Update dependencies to their latest compatible versions and fix whatever the update breaks. Commit only when the tests pass."
            onChange={event => setGoal(event.target.value)}
          />
        </label>
        <div className="row">
          <label>
            Model
            <input list="dexnest-queue-models" value={model} disabled={busy} placeholder="Provider default"
              onChange={event => setModel(event.target.value)} />
            <datalist id="dexnest-queue-models">
              <option value="fable" />
              <option value="opus" />
              <option value="sonnet" />
            </datalist>
          </label>
          <label>
            Effort
            <select value={effort} disabled={busy} onChange={event => setEffort(event.target.value)}>
              <option value="">Provider default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
              <option value="max">Max</option>
            </select>
          </label>
          <label>
            Spend limit for the whole night (optional)
            <input
              type="number"
              min={0}
              step={1}
              placeholder="no limit"
              value={spend}
              disabled={busy}
              onChange={event => setSpend(event.target.value)}
            />
          </label>
        </div>
        {error && <p className="autopilot-error">{error}</p>}
        <div className="row">
          <button
            type="button"
            disabled={busy || projects.length === 0 || !goal.trim()}
            onClick={() => act(() => api().autopilotQueueCreate({
              items: projects.map(path => ({
                projectPath: path.replace(/\\/g, "/"),
                goal,
                label: path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path
              })),
              budget: {
                deadline: nextSevenAm(new Date()),
                maxConsecutiveFailures: 3,
                ...(spend ? { maxCostUsd: Number(spend) } : {})
              },
              template: { model: model || null, effort: effort || null }
            }))}
          >
            {busy ? "Starting…" : `START ${projects.length || ""} PROJECT${projects.length === 1 ? "" : "S"}`.trim()}
          </button>
        </div>
        <p className="technical">
          Stops at 7am, or when the spend limit is reached, or after three projects fail in a row — whichever comes
          first. A time or spend limit always waits for the project in flight to finish.
        </p>
      </div>
    </section>
  );
}
