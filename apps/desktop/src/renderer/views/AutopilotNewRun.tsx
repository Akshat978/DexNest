// Starting a run, at three in the morning, without reading anything.
//
// The form grew a field per phase until it asked fourteen questions, most of
// which have one sensible answer and none of which a tired person should have
// to think about. Three of them are genuinely yours:
//
//   what should it build
//   where
//   when should it stop
//
// Everything else moved behind Advanced with the default already correct. That
// is only true because the defaults changed too: the shipped defaults were
// worktree + mediated, which is the safe pair for a workspace DexNest cannot
// fully trust, but it is not the pair this workflow uses. Leaving them meant
// the primary path required changing two dropdowns before it could do the job
// at all, and a default you must change is not a default.

import React, { useEffect, useRef, useState } from "react";
import type { NewRunForm, Readiness, CodingProvider } from "@dexnest/autopilot-runtime";

interface CreationBridge {
  listProjects(): Promise<Array<{ id: string; name: string; path: string }>>;
  chooseToolsOutputFolder(): Promise<{ ok: boolean; path?: string }>;
  autopilotReadiness(project: string): Promise<Readiness[]>;
  autopilotCreateAutomation(form: NewRunForm): Promise<{ id: string }>;
}
const api = () => (window as unknown as { dexNest: CreationBridge }).dexNest;

const initial: NewRunForm = {
  goal: "", projectPath: "", primary: "claude", consultant: null,
  // Ceilings, not budgets. Phase 13 established that "how many iterations" is
  // unanswerable before the work exists; these sit high enough not to end a
  // real overnight run early, and the honest bounds are time, spend and
  // no-progress.
  maxTurns: 50, maxIterations: 25, maxFailures: 3,
  // The pair this workflow actually uses. Agentic is refused outright by
  // assertAgenticWorkspace when the workspace contains a root DexNest would
  // otherwise have denied per-write, so choosing it by default cannot quietly
  // widen access — it either works in an ordinary project or it stops.
  workspaceMode: "project-branch", workerProfile: "agentic",
  planText: "", director: null, model: "", effort: "",
  stopAt: "", maxIdleTurns: 3,
  constraints: [], nonGoals: [], acceptance: [{ text: "Configured tests pass", tier: "test" }],
  verification: [
    { tier: "typecheck", enabled: false, executable: "node", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
    { tier: "lint", enabled: false, executable: "node", args: ["node_modules/eslint/bin/eslint.js", "."] },
    { tier: "test", enabled: true, executable: "node", args: ["--test"] },
    { tier: "integration", enabled: false, executable: "node", args: ["--test", "test/integration.test.js"] },
    { tier: "build", enabled: false, executable: "node", args: ["node_modules/vite/bin/vite.js", "build"] }
  ]
};

/** For the datetime input, which wants local wall-clock rather than an instant. */
const toLocalInput = (iso: string) => {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/**
 * "Stop at 7am" is the answer a person actually has at midnight.
 *
 * Typing it into a datetime field means picking a date as well as a time, and
 * getting the date wrong past midnight is the obvious mistake — 7am today is in
 * the past, and the run would stop before it started. So the presets do the
 * date arithmetic, and the field stays for anything else.
 */
function stopPresets(now: Date): Array<{ label: string; iso: string }> {
  const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const nextMorning = new Date(now);
  nextMorning.setHours(7, 0, 0, 0);
  if (nextMorning.getTime() <= now.getTime()) nextMorning.setDate(nextMorning.getDate() + 1);
  return [
    { label: "In 2 hours", iso: inHours(2) },
    { label: "In 6 hours", iso: inHours(6) },
    { label: "At 7am", iso: nextMorning.toISOString() }
  ];
}

export function AutopilotNewRun({ onCreated }: { onCreated(id: string): void }) {
  const [form, setForm] = useState<NewRunForm>(initial);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [providers, setProviders] = useState<Readiness[]>([]);
  const [checkedPath, setCheckedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    let live = true;
    void api().listProjects().then(value => { if (live) setProjects(value); }).catch(() => {});
    return () => { live = false; sequence.current++; };
  }, []);

  const update = (patch: Partial<NewRunForm>) => setForm(current => ({ ...current, ...patch }));

  async function check() {
    const current = ++sequence.current;
    const path = form.projectPath;
    setBusy(true); setError(null);
    try {
      const values = await api().autopilotReadiness(path);
      if (current === sequence.current) { setProviders(values); setCheckedPath(path); }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  const ready = checkedPath === form.projectPath && providers.find(item => item.provider === form.primary)?.available;
  const inProject = (form.workspaceMode ?? "project-branch") === "project-branch";
  const presets = stopPresets(new Date());

  return <section className="view-stack" aria-label="New Run">
    <h2>New Run</h2>
    <form className="view-stack" onSubmit={event => {
      event.preventDefault();
      if (busy || !ready) return;
      setBusy(true); setError(null);
      void api().autopilotCreateAutomation(form).then(run => onCreated(run.id)).catch(cause => setError(String(cause))).finally(() => setBusy(false));
    }}>

      {/* 1 — what */}
      <div className="card">
        <h3>What should it build?</h3>
        <label>
          <textarea required rows={4} maxLength={16000} value={form.goal}
            onChange={event => update({ goal: event.target.value })}
            placeholder="Describe the finished thing, not the first step. It works out the steps." />
        </label>
        <label>
          Plan (optional)
          <textarea rows={5} maxLength={200000} value={form.planText ?? ""}
            onChange={event => update({ planText: event.target.value })}
            placeholder={"Paste a phase-wise plan if you have one. Headings become ordered items:\n\n### Phase 1 — ...\n### Phase 2 — ..."} />
        </label>
        <p className="technical">
          Without a plan it decides its own next step after each verified piece of work. With one, it works through
          the items in your order.
        </p>
      </div>

      {/* 2 — where */}
      <div className="card">
        <h3>Where?</h3>
        <label>
          Project
          <select value={form.projectId ?? ""} onChange={event => {
            const project = projects.find(item => item.id === event.target.value);
            update({ projectId: project?.id, projectPath: project?.path ?? "" });
          }}>
            <option value="">Choose a project, or type a path below</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          Path
          <input required value={form.projectPath}
            onChange={event => update({ projectPath: event.target.value, projectId: undefined })} />
        </label>
        <p className="technical">
          {inProject
            ? "It works in the project itself, on its own branch, committing after each piece of work that passes verification. Your branch is untouched and the tree must be clean to start."
            : "It works in a separate worktree beside the project, so your checkout is never touched. Dependencies already installed in the project will not be there."}
          {" Change this in Advanced."}
        </p>
        <div className="row">
          <button type="button" disabled={busy || !form.projectPath} onClick={() => void check()}>CHECK</button>
          {checkedPath === form.projectPath && providers.map(item => (
            <span key={item.provider} className="technical">
              {item.provider === "claude" ? "Claude Code" : "Codex"}: {item.available ? "ready" : `unavailable: ${item.failure ?? "not found"}`}
            </span>
          ))}
        </div>
      </div>

      {/* 3 — when to stop */}
      <div className="card">
        <h3>When should it stop?</h3>
        <div className="row">
          {presets.map(preset => (
            <button key={preset.label} type="button"
              className={form.stopAt === preset.iso ? "preset-chosen" : undefined}
              onClick={() => update({ stopAt: preset.iso })}>{preset.label}</button>
          ))}
          <button type="button" className={!form.stopAt ? "preset-chosen" : undefined}
            onClick={() => update({ stopAt: "" })}>No time limit</button>
        </div>
        <label>
          Or a specific time
          <input type="datetime-local" value={toLocalInput(form.stopAt ?? "")}
            onChange={event => update({ stopAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} />
        </label>
        <label>
          Spend limit (optional)
          <input type="number" min={0} step={1} placeholder="no limit" value={form.maxCostUsd ?? ""}
            onChange={event => update({ maxCostUsd: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <p className="technical">
          A time limit waits for the piece of work in flight to finish, so you never wake up to something half-done.
          The spend figure is what the provider reports, which on a subscription is a usage proxy rather than a bill.
          It also stops on its own after {form.maxIdleTurns ?? 3} turns with nothing passing verification.
        </p>
      </div>

      <details className="autopilot-mechanism">
        <summary>Advanced</summary>
        <div className="view-stack">
          <label>Where the agent works
            <select value={form.workspaceMode ?? "project-branch"} onChange={event => update({ workspaceMode: event.target.value as NewRunForm["workspaceMode"] })}>
              <option value="project-branch">In the project, on its own branch</option>
              <option value="worktree">In a separate worktree</option>
            </select>
          </label>
          <label>Worker capability
            <select value={form.workerProfile ?? "agentic"} onChange={event => update({ workerProfile: event.target.value as NewRunForm["workerProfile"] })}>
              <option value="agentic">Agentic — it edits files itself</option>
              <option value="mediated">Mediated — DexNest writes every file through policy</option>
            </select>
          </label>
          <label>Primary worker
            <select value={form.primary} onChange={event => update({ primary: event.target.value as CodingProvider })}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label>Who decides the next step
            <select value={form.director ?? ""} onChange={event => update({ director: (event.target.value || null) as CodingProvider | null })}>
              <option value="">The agent itself</option>
              <option value="claude">A Claude Code chat</option>
              <option value="codex">A Codex chat</option>
            </select>
          </label>
          <label>Consultant
            <select value={form.consultant ?? ""} onChange={event => update({ consultant: (event.target.value || null) as CodingProvider | null })}>
              <option value="">None</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label>Model
            <select value={form.model ?? ""} onChange={event => update({ model: event.target.value })}>
              <option value="">Provider default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>
          <label>Effort
            <select value={form.effort ?? ""} onChange={event => update({ effort: event.target.value })}>
              <option value="">Provider default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>Stop after this many turns with nothing verified
            <input type="number" min={1} max={20} value={form.maxIdleTurns ?? 3} onChange={event => update({ maxIdleTurns: Number(event.target.value) })} />
          </label>
          <label>Pieces of work to authorize (ceiling)
            <input type="number" min={1} max={50} required value={form.maxIterations ?? 25} onChange={event => update({ maxIterations: Number(event.target.value) })} />
          </label>
          <label>Turn ceiling (safety limit)
            <input type="number" min={1} max={50} required value={form.maxTurns} onChange={event => update({ maxTurns: Number(event.target.value) })} />
          </label>
          <label>Consecutive failure limit
            <input type="number" min={1} max={20} required value={form.maxFailures} onChange={event => update({ maxFailures: Number(event.target.value) })} />
          </label>

          <details><summary>Verification</summary>
            <p>Commands run in the workspace. Existing dependencies must be available; no packages are installed automatically. Enter each argument on its own line.</p>
            {form.verification.map((item, index) => <fieldset key={item.tier}>
              <legend>{item.tier === "test" ? "Tests" : item.tier === "integration" ? "Integration tests" : item.tier}</legend>
              <label><input type="checkbox" checked={item.enabled} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, enabled: event.target.checked } : value) })} />Enabled</label>
              <label>Executable<input disabled={!item.enabled} value={item.executable} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, executable: event.target.value } : value) })} /></label>
              <label>Arguments (one per line)<textarea disabled={!item.enabled} rows={2} value={item.args.join("\n")} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, args: event.target.value.split("\n") } : value) })} /></label>
            </fieldset>)}
          </details>

          <details><summary>Run Spec</summary>
            <label>Constraints (one per line)<textarea value={form.constraints.join("\n")} onChange={event => update({ constraints: event.target.value.split("\n") })} /></label>
            <label>Non-goals (one per line)<textarea value={form.nonGoals.join("\n")} onChange={event => update({ nonGoals: event.target.value.split("\n") })} /></label>
            {form.acceptance.map((item, index) => <fieldset key={index}>
              <legend>Acceptance criterion {index + 1}</legend>
              <label>Criterion<input required value={item.text} onChange={event => update({ acceptance: form.acceptance.map((value, i) => i === index ? { ...value, text: event.target.value } : value) })} /></label>
              <label>Check<select value={item.tier ?? ""} onChange={event => update({ acceptance: form.acceptance.map((value, i) => i === index ? { ...value, tier: event.target.value || null } : value) })}>
                <option value="">Human judgment (holds for review)</option>
                {form.verification.filter(value => value.enabled).map(value => <option key={value.tier} value={value.tier}>{value.tier}</option>)}
              </select></label>
              <button type="button" disabled={form.acceptance.length === 1} onClick={() => update({ acceptance: form.acceptance.filter((_, i) => i !== index) })}>Remove criterion</button>
            </fieldset>)}
            <button type="button" onClick={() => update({ acceptance: [...form.acceptance, { text: "", tier: null }] })}>Add criterion</button>
          </details>
        </div>
      </details>

      <p className="technical">
        Starting authorizes at most {form.maxTurns} turns on your existing subscription login, and sends project
        context to {form.primary === "claude" ? "Claude Code" : "Codex"}.
      </p>
      {error && <p role="alert" className="autopilot-error">{error}</p>}
      {form.primary === form.consultant && <p role="alert" className="autopilot-error">Choose different primary and consultant providers.</p>}
      <button type="submit" disabled={busy || !ready || form.primary === form.consultant}>
        {busy ? "Working…" : "CREATE AND START"}
      </button>
    </form>
  </section>;
}
