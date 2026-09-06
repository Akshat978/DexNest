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
  goal: "", projectPath: "", primary: "claude", consultant: null, maxTurns: 5, maxFailures: 3,
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
      <p className="technical">Project: {form.projectPath || "Not selected"}. DexNest creates a separate worktree in a sibling dexnest-worktrees folder.</p>
      <label>Primary worker<select value={form.primary} onChange={event => update({ primary: event.target.value as CodingProvider })}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
      <label>Consultant<select value={form.consultant ?? ""} onChange={event => update({ consultant: (event.target.value || null) as CodingProvider | null })}><option value="">None</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
      <p>Primary owns all coding turns. A consultant is saved configuration only and will not start.</p>
      <button type="button" disabled={busy || !form.projectPath} onClick={() => void check()}>Refresh provider readiness</button>
      {providers.map(item => <p key={item.provider} className="technical">{item.provider}: {item.installed === null ? "installation unknown" : item.installed ? "installed" : "not installed"} · {item.authenticated === null ? "login unknown" : item.authenticated ? "authenticated" : "not authenticated"} · {checkedPath !== form.projectPath ? "refresh required" : item.available ? "available" : `unavailable: ${item.failure ?? "unknown"}`}</p>)}
      <label>Maximum autonomous turns<input type="number" min={1} max={50} required value={form.maxTurns} onChange={event => update({ maxTurns: Number(event.target.value) })} /></label>
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
