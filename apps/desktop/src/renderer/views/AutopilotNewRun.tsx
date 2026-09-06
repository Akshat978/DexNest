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
  goal: "", projectPath: "", primary: "claude", consultant: null, maxTurns: 30, maxIterations: 10, maxFailures: 3,
  workspaceMode: "worktree", workerProfile: "mediated", planText: "", director: null, model: "", effort: "",
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
export function AutopilotNewRun({ onCreated }: { onCreated(id: string): void }) {
  const [form, setForm] = useState<NewRunForm>(initial);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [providers, setProviders] = useState<Readiness[]>([]);
  const [checkedPath, setCheckedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => { let live = true; void api().listProjects().then(value => { if (live) setProjects(value); }).catch(() => {}); return () => { live = false; sequence.current++; }; }, []);
  const update = (patch: Partial<NewRunForm>) => setForm(current => ({ ...current, ...patch }));
  async function check() {
    const current = ++sequence.current; const path = form.projectPath;
    setBusy(true); setError(null);
    try { const values = await api().autopilotReadiness(path); if (current === sequence.current) { setProviders(values); setCheckedPath(path); } }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const ready = checkedPath === form.projectPath && providers.find(item => item.provider === form.primary)?.available;
  return <section className="view-stack" aria-label="New Run">
    <h2>New Run</h2>
    <form className="view-stack" onSubmit={event => { event.preventDefault(); if (busy || !ready) return; setBusy(true); setError(null);
      void api().autopilotCreateAutomation(form).then(run => onCreated(run.id)).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>
      <label>Task / Goal<textarea required rows={4} maxLength={16000} value={form.goal} onChange={event => update({ goal: event.target.value })} placeholder="What should the coding agent accomplish?" /></label>
      <label>Dev project<select value={form.projectId ?? ""} onChange={event => { const project = projects.find(item => item.id === event.target.value); update({ projectId: project?.id, projectPath: project?.path ?? "" }); }}>
        <option value="">Choose a project or enter a path</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label>Project path<input required value={form.projectPath} onChange={event => update({ projectPath: event.target.value, projectId: undefined })} /></label>
      <button type="button" disabled={busy} onClick={() => { void api().chooseToolsOutputFolder().then(value => { if (value.ok && value.path) update({ projectPath: value.path, projectId: undefined }); }).catch(cause => setError(String(cause))); }}>Choose project folder</button>
      <label>Where the agent works<select value={form.workspaceMode ?? "worktree"} onChange={event => update({ workspaceMode: event.target.value as NewRunForm["workspaceMode"] })}>
        <option value="worktree">Separate worktree (your project is untouched)</option>
        <option value="project-branch">In the project, on its own branch</option>
      </select></label>
      <p className="technical">{form.workspaceMode === "project-branch"
        ? `Changes appear in ${form.projectPath || "your project"} on branch dexnest/<run id>, with a commit after every verified step. Your current branch is never committed to, but there is no separate copy to throw away, so the project must have no uncommitted changes before starting.`
        : `Project: ${form.projectPath || "Not selected"}. DexNest creates a separate worktree in a sibling dexnest-worktrees folder.`}</p>
      <label>Worker capability<select value={form.workerProfile ?? "mediated"} onChange={event => update({ workerProfile: event.target.value as NewRunForm["workerProfile"] })}>
        <option value="mediated">Mediated — no tools, DexNest writes every file</option>
        <option value="agentic">Agentic — the worker reads, edits and runs tests itself</option>
      </select></label>
      <p className="technical">{form.workerProfile === "agentic"
        ? "The worker gets real tools inside the workspace, so it works like Claude Code does for you: no pasted files, no whole-file rewrites. DexNest no longer checks each individual write — the workspace directory, the run's branch and per-step commits are what contain it. Requires Claude Code, and is refused for a project containing DexNest local-data."
        : "Every tool is disabled. The worker returns files as text and DexNest writes them through policy, so each write is checked individually. Slower, and it re-sends whole files to change one line."}</p>
      <label>Plan (optional)<textarea rows={6} maxLength={200000} value={form.planText ?? ""} onChange={event => update({ planText: event.target.value })} placeholder={"Paste the phase-wise plan you agreed elsewhere. Headings become ordered items:\n\n### Phase 1 — ...\n### Phase 2 — ..."} /></label>
      <label>Primary worker<select value={form.primary} onChange={event => update({ primary: event.target.value as CodingProvider })}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
      <label>Who decides the next step<select value={form.director ?? ""} onChange={event => update({ director: (event.target.value || null) as CodingProvider | null })}>
        <option value="">The coding agent decides for itself</option>
        <option value="codex">ChatGPT (via Codex) writes each assignment</option>
        <option value="claude">Claude writes each assignment, in a separate session</option>
      </select></label>
      <p className="technical">{form.director
        ? "A separate read-only session holds the plan and writes each assignment. One extra call per piece of work \u2014 in exchange, the coding subscription is spent on coding. You can switch this mid-run."
        : "The agent ends each turn saying what it would do next. No extra call, but its own capacity pays for the planning. You can switch this mid-run."}</p>
      <label>Consultant<select value={form.consultant ?? ""} onChange={event => update({ consultant: (event.target.value || null) as CodingProvider | null })}><option value="">None</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
      <p>Primary owns all coding turns. A consultant is saved configuration only and will not start.</p>
      <button type="button" disabled={busy || !form.projectPath} onClick={() => void check()}>Refresh provider readiness</button>
      {providers.map(item => <p key={item.provider} className="technical">{item.provider}: {item.installed === null ? "installation unknown" : item.installed ? "installed" : "not installed"} · {item.authenticated === null ? "login unknown" : item.authenticated ? "authenticated" : "not authenticated"} · {checkedPath !== form.projectPath ? "refresh required" : item.available ? "available" : `unavailable: ${item.failure ?? "unknown"}`}</p>)}
      <label>Model<select value={form.model ?? ""} onChange={event => update({ model: event.target.value })}>
        <option value="">Provider default</option>
        <option value="opus">Opus (latest)</option>
        <option value="sonnet">Sonnet (latest)</option>
        <option value="haiku">Haiku (latest)</option>
      </select></label>
      <label>Effort<select value={form.effort ?? ""} onChange={event => update({ effort: event.target.value })}>
        <option value="">Provider default</option>
        {["low", "medium", "high", "xhigh", "max"].map(level => <option key={level} value={level}>{level}</option>)}
      </select></label>
      <p className="technical">Effort trades cost against how hard the worker thinks per turn. Both apply to the agentic profile only.</p>
      <label>Stop at (optional)<input type="datetime-local" value={form.stopAt ?? ""} onChange={event => update({ stopAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></label>
      <label>Spend limit (optional)<input type="number" min={0} step={1} placeholder="no limit" value={form.maxCostUsd ?? ""} onChange={event => update({ maxCostUsd: event.target.value ? Number(event.target.value) : undefined })} /></label>
      <p className="technical">The two bounds you can answer honestly before starting. Spend is what the provider reports per turn — on a subscription that is a usage figure, not a bill. Whichever is reached first stops the run, and whatever had started finishes.</p>
      <label>Stop after this many turns with nothing verified<input type="number" min={1} max={20} value={form.maxIdleTurns ?? 3} onChange={event => update({ maxIdleTurns: Number(event.target.value) })} /></label>
      <label>Pieces of work to authorize<input type="number" min={1} max={50} required value={form.maxIterations ?? 10} onChange={event => update({ maxIterations: Number(event.target.value) })} /></label>
      <p className="technical">Each is one assignment: the agent does it, DexNest verifies it and commits a checkpoint, then the agent says what is next. Repairs and follow-up turns belong to the piece of work that caused them.</p>
      <label>Turn ceiling (safety limit)<input type="number" min={1} max={50} required value={form.maxTurns} onChange={event => update({ maxTurns: Number(event.target.value) })} /></label>
      <p className="technical">A hard stop on total provider calls, so a piece of work that keeps failing cannot run forever. Must be at least the number of pieces of work.</p>
      <label>Consecutive failure limit<input type="number" min={1} max={20} required value={form.maxFailures} onChange={event => update({ maxFailures: Number(event.target.value) })} /></label>
      <details><summary>Verification</summary><p>Commands run in the new worktree. Review these examples for your project. Existing dependencies must be available; no packages are installed automatically. Enter each argument on its own line.</p>
        {form.verification.map((item, index) => <fieldset key={item.tier}><legend>{item.tier === "test" ? "Tests" : item.tier === "integration" ? "Integration tests" : item.tier}</legend>
          <label><input type="checkbox" checked={item.enabled} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, enabled: event.target.checked } : value) })} />Enabled</label>
          <label>Executable<input disabled={!item.enabled} value={item.executable} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, executable: event.target.value } : value) })} /></label>
          <label>Arguments (one per line)<textarea disabled={!item.enabled} rows={2} value={item.args.join("\n")} onChange={event => update({ verification: form.verification.map((value, i) => i === index ? { ...value, args: event.target.value.split("\n") } : value) })} /></label>
        </fieldset>)}
      </details>
      <details><summary>Advanced Run Spec</summary>
        <label>Constraints (one per line)<textarea value={form.constraints.join("\n")} onChange={event => update({ constraints: event.target.value.split("\n") })} /></label>
        <label>Non-goals (one per line)<textarea value={form.nonGoals.join("\n")} onChange={event => update({ nonGoals: event.target.value.split("\n") })} /></label>
        {form.acceptance.map((item, index) => <fieldset key={index}><legend>Acceptance criterion {index + 1}</legend>
          <label>Criterion<input required value={item.text} onChange={event => update({ acceptance: form.acceptance.map((value, i) => i === index ? { ...value, text: event.target.value } : value) })} /></label>
          <label>Check<select value={item.tier ?? ""} onChange={event => update({ acceptance: form.acceptance.map((value, i) => i === index ? { ...value, tier: event.target.value || null } : value) })}><option value="">Human judgment (holds for review)</option>{form.verification.filter(value => value.enabled).map(value => <option key={value.tier} value={value.tier}>{value.tier}</option>)}</select></label>
          <button type="button" disabled={form.acceptance.length === 1} onClick={() => update({ acceptance: form.acceptance.filter((_, i) => i !== index) })}>Remove criterion</button>
        </fieldset>)}
        <button type="button" onClick={() => update({ acceptance: [...form.acceptance, { text: "", tier: null }] })}>Add criterion</button>
      </details>
      <p>Start authorizes at most {form.maxTurns} primary turns using your existing subscription login. This sends project context to the selected provider and may consume usage. Worker filesystem tools remain disabled.</p>
      {error && <p role="alert">{error}</p>}
      {form.primary === form.consultant && <p role="alert">Choose different primary and consultant providers.</p>}
      <button type="submit" disabled={busy || !ready || form.primary === form.consultant}>{busy ? "Working…" : "Create and start"}</button>
    </form>
  </section>;
}
