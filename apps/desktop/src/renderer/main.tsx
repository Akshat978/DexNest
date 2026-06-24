import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@dexnest/shared-ui/tokens.css";
import "./styles.css";

type ViewId = "command" | "dev" | "deck" | "clipboard" | "drop" | "audit" | "settings";
type ActionStatus = "success" | "failed" | "skipped" | "cancelled" | "pending";

interface AppInfo {
  appName: string;
  dataRoot: string;
  dbPath: string;
  actionEndpoint: string;
  projectsConfigPath: string;
  commandResultsPath: string;
  pinnedActionsPath: string;
  projectCount: number;
  performanceMode: string;
}

interface ActionDefinition {
  id: string;
  title: string;
  module: string;
  moduleId: string;
  description: string;
  category: string;
  dangerLevel: string;
  handlerType: string;
  handlerRef: string;
  allowedTriggers: string[];
  reversible: boolean;
  status: string;
}

interface EventEntry {
  id: string;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
  timestamp: string;
  module: string;
  actionId?: string;
  eventType: string;
  status: ActionStatus;
  summary: string;
}

interface DexNestProject {
  id: string;
  name: string;
  path: string;
  description: string;
  accent: string;
  commands: {
    start: string;
    build: string;
    test: string;
    typecheck: string;
    custom: string;
  };
  urls: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

interface ProjectFormState {
  id?: string;
  name: string;
  path: string;
  description: string;
  accent: string;
  start: string;
  build: string;
  test: string;
  typecheck: string;
  custom: string;
  urls: string;
  notes: string;
}

interface ProjectCommandResult {
  actionId: string;
  projectId: string;
  projectName: string;
  commandKey: string;
  command: string;
  status: "idle" | "running" | "success" | "failed";
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number | null;
  finishedAt: string | null;
  errorMessage?: string | null;
}

interface DexNestBridge {
  getAppInfo: () => Promise<AppInfo>;
  listActions: () => Promise<ActionDefinition[]>;
  listProjects: () => Promise<DexNestProject[]>;
  listCommandResults: () => Promise<Record<string, ProjectCommandResult>>;
  clearCommandResult: (actionId: string) => Promise<void>;
  listPinnedActions: () => Promise<string[]>;
  savePinnedActions: (actionIds: string[]) => Promise<string[]>;
  saveProject: (payload: unknown) => Promise<DexNestProject>;
  deleteProject: (projectId: string) => Promise<void>;
  listEvents: () => Promise<EventEntry[]>;
  runAction: (payload: { actionId: string; source?: string; params?: unknown }) => Promise<{
    ok: boolean;
    error?: string;
    output?: string;
    stdout?: string;
    stderr?: string;
    summary?: string;
    status?: "success" | "failed";
    durationMs?: number | null;
  }>;
  logActionResult: (payload: {
    actionId: string;
    status: ActionStatus;
    source?: string;
    summary: string;
    errorMessage?: string | null;
    metadataJson?: Record<string, unknown>;
  }) => Promise<void>;
  logUiEvent: (payload: { view: string; target: string; summary: string }) => Promise<void>;
}

declare global {
  interface Window {
    dexNest?: DexNestBridge;
  }
}

const fallbackBridge: DexNestBridge = {
  getAppInfo: async () => ({
    appName: "DexNest",
    dataRoot: "./local-data",
    dbPath: "./local-data/data/dexnest.sqlite",
    actionEndpoint: "http://127.0.0.1:43217",
    projectsConfigPath: "./local-data/settings/projects.json",
    commandResultsPath: "./local-data/settings/project-command-results.json",
    pinnedActionsPath: "./local-data/settings/pinned-actions.json",
    projectCount: 0,
    performanceMode: "Bridge unavailable"
  }),
  listActions: async () => [],
  listProjects: async () => [],
  listCommandResults: async () => ({}),
  clearCommandResult: async () => undefined,
  listPinnedActions: async () => ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"],
  savePinnedActions: async (actionIds) => actionIds,
  saveProject: async (payload) => payload as DexNestProject,
  deleteProject: async () => undefined,
  listEvents: async () => [],
  runAction: async () => ({ ok: true }),
  logActionResult: async () => undefined,
  logUiEvent: async () => undefined
};

function getBridge(): DexNestBridge {
  return window.dexNest ?? fallbackBridge;
}

const views: Array<{ id: ViewId; label: string; accentClass: string; actionId: string }> = [
  { id: "command", label: "Command", accentClass: "accent-command", actionId: "command.open_home" },
  { id: "dev", label: "Dev", accentClass: "accent-dev", actionId: "dev.open_dashboard" },
  { id: "deck", label: "Deck", accentClass: "accent-deck", actionId: "deck.test_endpoint" },
  { id: "clipboard", label: "Clipboard", accentClass: "accent-clipboard", actionId: "clipboard.open_placeholder" },
  { id: "drop", label: "Drop", accentClass: "accent-drop", actionId: "drop.open_placeholder" },
  { id: "audit", label: "Audit", accentClass: "accent-command", actionId: "audit.open_history" },
  { id: "settings", label: "Settings", accentClass: "accent-command", actionId: "settings.open" }
];

const moduleCards = [
  ["command", "Command", "Action hub and dashboard.", "available"],
  ["dev", "Dev", "Project cards and local commands.", "placeholder"],
  ["deck", "Deck", "Stream Deck localhost action surface.", "placeholder"],
  ["clipboard", "Clipboard", "Clipboard listener and snippets later.", "placeholder"],
  ["drop", "Drop", "Local PC-phone bridge later.", "placeholder"]
] as const;

function viewFromAction(action?: ActionDefinition): ViewId | null {
  if (!action?.handlerRef.startsWith("desktop.view.")) {
    return null;
  }

  const viewId = action.handlerRef.replace("desktop.view.", "") as ViewId;
  return views.some((view) => view.id === viewId) ? viewId : null;
}

function DexNestApp() {
  const [activeView, setActiveView] = useState<ViewId>("command");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [projects, setProjects] = useState<DexNestProject[]>([]);
  const [commandResults, setCommandResults] = useState<Record<string, ProjectCommandResult>>({});
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);

  const activeLabel = useMemo(
    () => views.find((view) => view.id === activeView)?.label ?? "Command",
    [activeView]
  );

  useEffect(() => {
    void refreshShellData();
  }, []);

  async function refreshShellData(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextEvents] = await Promise.all([
      getBridge().getAppInfo(),
      getBridge().listActions(),
      getBridge().listProjects(),
      getBridge().listCommandResults(),
      getBridge().listPinnedActions(),
      getBridge().listEvents()
    ]);

    setAppInfo(info);
    setActions(nextActions);
    setProjects(nextProjects);
    setCommandResults(nextCommandResults);
    setPinnedActionIds(nextPinnedActionIds);
    setEvents(nextEvents);
  }

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function refreshProjectsAndActions(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextEvents] = await Promise.all([
      getBridge().getAppInfo(),
      getBridge().listActions(),
      getBridge().listProjects(),
      getBridge().listCommandResults(),
      getBridge().listPinnedActions(),
      getBridge().listEvents()
    ]);

    setAppInfo(info);
    setActions(nextActions);
    setProjects(nextProjects);
    setCommandResults(nextCommandResults);
    setPinnedActionIds(nextPinnedActionIds);
    setEvents(nextEvents);
  }

  async function runAction(actionId: string, source = "module_ui", params: unknown = {}) {
    const result = await getBridge().runAction({ actionId, source, params });
    await refreshShellData();
    return result;
  }

  async function runUiAction(actionId: string, source = "module_ui", params: unknown = {}) {
    const action = actions.find((item) => item.id === actionId);
    const result = await runAction(actionId, source, params);
    const targetView = viewFromAction(action);

    if (targetView) {
      setActiveView(targetView);
    }

    return result;
  }

  async function navigate(view: ViewId): Promise<void> {
    const actionId = views.find((item) => item.id === view)?.actionId;
    setActiveView(view);
    if (actionId) {
      await runAction(actionId);
    }
  }

  async function handleAction(actionId: string): Promise<void> {
    await runUiAction(actionId);
  }

  async function savePinnedActionIds(actionIds: string[]): Promise<void> {
    const savedActionIds = await getBridge().savePinnedActions(actionIds);
    setPinnedActionIds(savedActionIds);
    await refreshShellData();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="DexNest navigation">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <p>DexNest</p>
            <strong>Command Center</strong>
          </div>
        </div>

        <nav className="sidebar__nav">
          {views.map((view) => (
            <button
              className={`nav-button ${view.accentClass}`}
              data-active={activeView === view.id}
              key={view.id}
              type="button"
              onClick={() => void navigate(view.id)}
            >
              <span aria-hidden="true" />
              {view.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p>DexNest / {activeLabel}</p>
            <h1>{activeLabel}</h1>
          </div>
          <div className="endpoint-pill">{appInfo?.actionEndpoint ?? "Loading endpoint"}</div>
        </header>

        <main className="content">
          {activeView === "command" && (
            <CommandView
              actions={actions}
              pinnedActionIds={pinnedActionIds}
              onAction={runUiAction}
              onPinnedActionsChange={savePinnedActionIds}
            />
          )}
          {activeView === "dev" && (
            <DevView
              projects={projects}
              commandResults={commandResults}
              onAction={runAction}
              onProjectsChanged={refreshProjectsAndActions}
            />
          )}
          {activeView === "deck" && (
            <DeckView
              actions={actions}
              projects={projects}
              endpoint={appInfo?.actionEndpoint}
              refreshEvents={refreshEvents}
            />
          )}
          {activeView === "clipboard" && <PlaceholderView id="clipboard" title="Clipboard" onAction={handleAction} />}
          {activeView === "drop" && <PlaceholderView id="drop" title="Drop" onAction={handleAction} />}
          {activeView === "audit" && <AuditView events={events} onRefresh={handleAction} refreshEvents={refreshEvents} />}
          {activeView === "settings" && <SettingsView appInfo={appInfo} />}
        </main>
      </div>
    </div>
  );
}

function CommandView({
  actions,
  pinnedActionIds,
  onAction,
  onPinnedActionsChange
}: {
  actions: ActionDefinition[];
  pinnedActionIds: string[];
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onPinnedActionsChange: (actionIds: string[]) => Promise<void>;
}) {
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionSearch, setActionSearch] = useState("");
  const modules = [...new Set(actions.map((action) => action.module).filter(Boolean))].sort();
  const pinnedActions = pinnedActionIds
    .map((actionId) => actions.find((action) => action.id === actionId))
    .filter((action): action is ActionDefinition => Boolean(action));
  const filteredActions = actions.filter((action) => {
    const query = actionSearch.trim().toLowerCase();
    const matchesModule = moduleFilter === "all" || action.module === moduleFilter;
    const matchesSearch = !query || action.id.toLowerCase().includes(query) || action.title.toLowerCase().includes(query);
    return matchesModule && matchesSearch;
  });

  function canRunWithoutConfirmation(action: ActionDefinition): boolean {
    return action.dangerLevel === "safe" || action.dangerLevel === "caution";
  }

  async function runRegistryAction(action: ActionDefinition): Promise<void> {
    if (!canRunWithoutConfirmation(action)) {
      const confirmed = window.confirm(`Run ${action.title}? Danger level: ${action.dangerLevel}.`);
      if (!confirmed) {
        return;
      }
    }

    await onAction(action.id, "module_ui", { confirmedDangerous: !canRunWithoutConfirmation(action) });
  }

  async function togglePinnedAction(actionId: string): Promise<void> {
    const nextPinnedActionIds = pinnedActionIds.includes(actionId)
      ? pinnedActionIds.filter((id) => id !== actionId)
      : [...pinnedActionIds, actionId];

    await onPinnedActionsChange(nextPinnedActionIds);
  }

  return (
    <section className="view-stack" aria-labelledby="command-title">
      <div className="section-heading">
        <p>Offline-first spine</p>
        <h2 id="command-title">Command Home</h2>
      </div>

      <div className="module-grid">
        {moduleCards.map(([id, title, description, status]) => (
          <article className={`module-card accent-${id}`} key={id}>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <span>{status}</span>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <Panel title="Pinned Actions">
          <div className="action-list action-list--compact">
            {pinnedActions.length === 0 ? (
              <p>No pinned actions yet.</p>
            ) : (
              pinnedActions.map((action) => (
                <article className={`action-row accent-${action.moduleId}`} key={action.id}>
                  <div>
                    <h3>{action.title}</h3>
                    <p className="technical">{action.id}</p>
                  </div>
                  <div>
                    <button type="button" onClick={() => void runRegistryAction(action)}>
                      {viewFromAction(action) ? "Open" : "Run"}
                    </button>
                    <button type="button" onClick={() => void togglePinnedAction(action.id)}>
                      Unpin
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Stats">
          <p>Stats will summarize local event activity after the spine settles.</p>
        </Panel>
        <Panel title="Recent Actions">
          <p>Recent safe clicks and endpoint calls appear in Audit.</p>
        </Panel>
      </div>

      <Panel title="Action Registry">
        <div className="registry-controls">
          <label>
            Module
            <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
              <option value="all">All modules</option>
              {modules.map((module) => (
                <option value={module} key={module}>{module}</option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input
              value={actionSearch}
              onChange={(event) => setActionSearch(event.target.value)}
              placeholder="Action ID or title"
            />
          </label>
        </div>
        <div className="action-list">
          {filteredActions.length === 0 ? (
            <p>No registered actions found.</p>
          ) : (
            filteredActions.map((action) => (
              <article className={`action-row accent-${action.moduleId}`} key={action.id}>
                <div>
                  <h3>{action.title}</h3>
                  <p>{action.description}</p>
                  <p className="technical">{action.id}</p>
                </div>
                <div>
                  <span>{action.module}</span>
                  <span>{action.dangerLevel}</span>
                  <span>{action.reversible ? "reversible" : "not reversible"}</span>
                  <button type="button" onClick={() => void runRegistryAction(action)}>
                    {viewFromAction(action) ? "Open" : "Run"}
                  </button>
                  <button type="button" onClick={() => void togglePinnedAction(action.id)}>
                    {pinnedActionIds.includes(action.id) ? "Unpin" : "Pin"}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
    </section>
  );
}

const emptyProjectForm: ProjectFormState = {
  name: "",
  path: "",
  description: "",
  accent: "dev",
  start: "",
  build: "",
  test: "",
  typecheck: "",
  custom: "",
  urls: "",
  notes: ""
};

function projectToForm(project: DexNestProject): ProjectFormState {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.description,
    accent: project.accent,
    start: project.commands.start,
    build: project.commands.build,
    test: project.commands.test,
    typecheck: project.commands.typecheck,
    custom: project.commands.custom,
    urls: project.urls.join("\n"),
    notes: project.notes
  };
}

function formToProjectInput(form: ProjectFormState) {
  return {
    id: form.id,
    name: form.name,
    path: form.path,
    description: form.description,
    accent: form.accent,
    commands: {
      start: form.start,
      build: form.build,
      test: form.test,
      typecheck: form.typecheck,
      custom: form.custom
    },
    urls: form.urls.split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean),
    notes: form.notes
  };
}

function isDangerousCommand(command: string): boolean {
  return /\b(rm\s+-rf|del\s+\/|rmdir\s+\/s|format\b|diskpart\b|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i.test(
    command
  );
}

function stripAnsiForDisplay(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function DevView({
  projects,
  commandResults,
  onAction,
  onProjectsChanged
}: {
  projects: DexNestProject[];
  commandResults: Record<string, ProjectCommandResult>;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    output?: string;
    stdout?: string;
    stderr?: string;
    summary?: string;
    status?: "success" | "failed";
    durationMs?: number | null;
  }>;
  onProjectsChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProjectFormState>(emptyProjectForm);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [commandRunResults, setCommandRunResults] = useState<Record<string, ProjectCommandResult>>(commandResults);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setCommandRunResults((current) => ({ ...commandResults, ...current }));
  }, [commandResults]);

  function updateForm(field: keyof ProjectFormState, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveProject(): Promise<void> {
    if (!form.name.trim() || !form.path.trim()) {
      setSaveStatus({ tone: "error", message: "Project name and path are required." });
      return;
    }

    try {
      setSaveStatus(null);
      const savedProject = await getBridge().saveProject(formToProjectInput(form));

      if (!savedProject?.id) {
        throw new Error("DexNest desktop bridge did not return a saved project.");
      }

      setForm(emptyProjectForm);
      setActiveProjectId(null);
      setSaveStatus({ tone: "success", message: `Saved ${savedProject.name}.` });
      await onProjectsChanged();
    } catch (error) {
      setSaveStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "DexNest could not save this project."
      });
    }
  }

  async function deleteProject(project: DexNestProject): Promise<void> {
    if (!window.confirm(`Delete ${project.name} from DexNest Dev? This does not delete files.`)) {
      return;
    }

    await getBridge().deleteProject(project.id);
    await onProjectsChanged();
  }

  async function runProjectAction(project: DexNestProject, actionId: string, command?: string): Promise<void> {
    const confirmedDangerous = command && isDangerousCommand(command)
      ? window.confirm("This command looks destructive. Run it anyway?")
      : false;

    if (command && isDangerousCommand(command) && !confirmedDangerous) {
      return;
    }

    const commandKey = actionId.split(".").at(-1)?.replace("run_", "") ?? "custom";
    const previousResult = commandRunResults[actionId];

    setCommandRunResults((current) => ({
      ...current,
      [actionId]: {
        actionId,
        projectId: project.id,
        projectName: project.name,
        commandKey,
        command: command ?? "",
        status: "running",
        stdout: previousResult?.stdout ?? "",
        stderr: previousResult?.stderr ?? "",
        summary: "Running command.",
        durationMs: null,
        finishedAt: null,
        errorMessage: null
      }
    }));

    const result = await onAction(actionId, "module_ui", { confirmedDangerous });

    setCommandRunResults((current) => ({
      ...current,
      [actionId]: {
        actionId,
        projectId: project.id,
        projectName: project.name,
        commandKey,
        command: command ?? "",
        status: result.ok ? "success" : "failed",
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        summary: result.summary ?? (result.ok ? "Command completed." : result.error ?? "Command failed."),
        durationMs: result.durationMs ?? null,
        finishedAt: new Date().toISOString(),
        errorMessage: result.ok ? null : result.error ?? null
      }
    }));
  }

  async function copyCommandOutput(actionId: string): Promise<void> {
    const result = commandRunResults[actionId];
    const output = [result?.stdout, result?.stderr].filter(Boolean).map(stripAnsiForDisplay).join("\n\n").trim();

    if (output) {
      await navigator.clipboard.writeText(output);
    }
  }

  async function clearCommandOutput(actionId: string): Promise<void> {
    await getBridge().clearCommandResult(actionId);
    setCommandRunResults((current) => {
      const next = { ...current };
      delete next[actionId];
      return next;
    });
  }

  function toggleCommandLog(actionId: string): void {
    setExpandedLogIds((current) => ({
      ...current,
      [actionId]: !current[actionId]
    }));
  }

  function toggleProject(projectId: string): void {
    setExpandedProjectIds((current) => ({
      ...current,
      [projectId]: !current[projectId]
    }));
  }

  return (
    <section className="view-stack" aria-labelledby="dev-title">
      <div className="section-heading">
        <p>DexNest Dev</p>
        <h2 id="dev-title">Project Dashboard</h2>
      </div>

      <Panel title={form.id ? "Edit Project" : "Add Project"}>
        <div className="project-form">
          <label>
            Name
            <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
          </label>
          <label>
            Path
            <input className="technical" value={form.path} onChange={(event) => updateForm("path", event.target.value)} />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
          </label>
          <label>
            Local URLs
            <textarea className="technical" value={form.urls} onChange={(event) => updateForm("urls", event.target.value)} />
          </label>
          {(["start", "build", "test", "typecheck", "custom"] as const).map((key) => (
            <label key={key}>
              {key} command
              <input className="technical" value={form[key]} onChange={(event) => updateForm(key, event.target.value)} />
            </label>
          ))}
          <label>
            Notes
            <textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void saveProject()}>
            {form.id ? "Save Project" : "Add Project"}
          </button>
          {form.id && (
            <button type="button" onClick={() => { setForm(emptyProjectForm); setActiveProjectId(null); }}>
              Cancel Edit
            </button>
          )}
        </div>
        {saveStatus && <p className={`form-status form-status--${saveStatus.tone}`}>{saveStatus.message}</p>}
      </Panel>

      <div className="project-grid">
        {projects.length === 0 ? (
          <p className="empty-state">No Dev projects yet. Add a local project path to generate Dev and Deck actions.</p>
        ) : (
          projects.map((project) => {
            const base = `dev.project.${project.id}`;
            const commandEntries = Object.entries(project.commands).filter(([, command]) => command.trim());
            const isExpanded = Boolean(expandedProjectIds[project.id]);

            return (
              <article className={`project-card accent-dev ${isExpanded ? "project-card--expanded" : ""}`} key={project.id}>
                <div className="project-card__header">
                  <button
                    type="button"
                    className="project-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={`project-details-${project.id}`}
                    onClick={() => toggleProject(project.id)}
                  >
                    <span className="project-toggle__arrow" aria-hidden="true">
                      {isExpanded ? "v" : ">"}
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <span>{project.description || "No description yet."}</span>
                      <span className="technical">{project.path}</span>
                    </span>
                  </button>
                  <div className="button-row project-card__tools">
                    <button type="button" onClick={() => { setForm(projectToForm(project)); setActiveProjectId(project.id); }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteProject(project)}>
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="project-card__details" id={`project-details-${project.id}`}>
                    <div className="button-row">
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_folder`)}>
                        Open Folder
                      </button>
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_vscode`)}>
                        VS Code
                      </button>
                      <button type="button" onClick={() => void runProjectAction(project, `${base}.open_terminal`)}>
                        Terminal
                      </button>
                      {project.urls.length > 0 && (
                        <button type="button" onClick={() => void runProjectAction(project, `${base}.open_url`)}>
                          Open URL
                        </button>
                      )}
                    </div>

                    {commandEntries.length > 0 && (
                      <div className="command-list">
                        {commandEntries.map(([key, command]) => {
                          const actionId = `${base}.run_${key}`;
                          const result = commandRunResults[actionId];
                          const status = result?.status ?? "idle";
                          const hasOutput = Boolean(result?.stdout || result?.stderr || result?.summary || result?.errorMessage);
                          const isLogExpanded = Boolean(expandedLogIds[actionId]);
                          return (
                            <div className="command-row" key={key}>
                              <div className="command-row__main">
                                <div className="command-row__summary">
                                  <div>
                                    <strong>{key}</strong>
                                    <p className="technical">{command}</p>
                                  </div>
                                  <span className={`command-status command-status--${status}`}>{status}</span>
                                </div>
                                {result?.durationMs !== null && result?.durationMs !== undefined && (
                                  <p className="command-meta">Last run: {result.durationMs}ms</p>
                                )}
                              </div>
                              <div className="command-row__actions">
                                {hasOutput && (
                                  <button type="button" onClick={() => toggleCommandLog(actionId)}>
                                    {isLogExpanded ? "Hide Log" : "Show Log"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={status === "running"}
                                  onClick={() => void runProjectAction(project, actionId, command)}
                                >
                                  {status === "running" ? "Running" : "Run"}
                                </button>
                              </div>
                              {hasOutput && isLogExpanded && (
                                <div className="command-log">
                                  <div className="button-row">
                                    <button type="button" onClick={() => void copyCommandOutput(actionId)}>
                                      Copy output
                                    </button>
                                    <button type="button" onClick={() => void clearCommandOutput(actionId)}>
                                      Clear output
                                    </button>
                                  </div>
                                  <pre className="technical">{[
                                    result?.summary,
                                    result?.errorMessage,
                                    result?.stdout ? `stdout:\n${stripAnsiForDisplay(result.stdout)}` : "",
                                    result?.stderr ? `stderr:\n${stripAnsiForDisplay(result.stderr)}` : ""
                                  ].filter(Boolean).join("\n\n")}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="notes-box">
                      <strong>Notes</strong>
                      <p>{project.notes || "No notes saved."}</p>
                    </div>
                    {activeProjectId === project.id && <p className="technical">Editing {project.id}</p>}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function DeckView({
  actions,
  projects,
  endpoint,
  refreshEvents
}: {
  actions: ActionDefinition[];
  projects: DexNestProject[];
  endpoint?: string;
  refreshEvents: () => Promise<void>;
}) {
  const projectActions = actions.filter((action) => action.id.startsWith("dev.project."));
  const [endpointStatuses, setEndpointStatuses] = useState<Record<string, string>>({});
  const projectActionGroups = projects.map((project) => ({
    project,
    actions: projectActions.filter((action) => action.id.startsWith(`dev.project.${project.id}.`))
  })).filter((group) => group.actions.length > 0);

  function endpointForAction(actionId: string): string {
    return `${endpoint ?? "http://127.0.0.1:43217"}/actions/${actionId}`;
  }

  async function runEndpointAction(actionId: string): Promise<void> {
    const action = actions.find((item) => item.id === actionId);
    const needsConfirmation = action?.dangerLevel === "danger" || action?.dangerLevel === "critical";
    const confirmedDangerous = needsConfirmation
      ? window.confirm(`Run ${action?.title ?? actionId}? Danger level: ${action?.dangerLevel}.`)
      : false;

    if (needsConfirmation && !confirmedDangerous) {
      return;
    }

    setEndpointStatuses((current) => ({ ...current, [actionId]: "Running..." }));

    try {
      const response = await fetch(endpointForAction(actionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, confirmedDangerous })
      });

      if (!response.ok) {
        await getBridge().logActionResult({
          actionId,
          status: "failed",
          source: "module_ui",
          summary: `${actionId} endpoint test failed.`,
          errorMessage: `HTTP ${response.status}`
        });
        setEndpointStatuses((current) => ({ ...current, [actionId]: `Failed: HTTP ${response.status}` }));
      } else {
        setEndpointStatuses((current) => ({ ...current, [actionId]: "Success" }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown endpoint failure.";
      await getBridge().logActionResult({
        actionId,
        status: "failed",
        source: "module_ui",
        summary: `${actionId} endpoint test failed.`,
        errorMessage
      });
      setEndpointStatuses((current) => ({ ...current, [actionId]: `Failed: ${errorMessage}` }));
    }

    await refreshEvents();
  }

  async function copyEndpoint(actionId: string): Promise<void> {
    await navigator.clipboard.writeText(endpointForAction(actionId));
    setEndpointStatuses((current) => ({ ...current, [actionId]: "Endpoint copied" }));
  }

  return (
    <section className="view-stack" aria-labelledby="deck-title">
      <div className="section-heading">
        <p>Local action surface</p>
        <h2 id="deck-title">Deck Endpoint</h2>
      </div>
      <Panel title="Deck localhost endpoint">
        <p className="technical">{endpoint ? `${endpoint}/actions/deck.test_endpoint` : "Loading endpoint"}</p>
        <button type="button" onClick={() => void runEndpointAction("deck.test_endpoint")}>
          Run test action
        </button>
      </Panel>

      <Panel title="Dev Project Actions">
        <div className="project-action-groups">
          {projectActionGroups.length === 0 ? (
            <p>No Dev project actions yet. Add a project in Dev to generate Deck endpoints.</p>
          ) : (
            projectActionGroups.map((group) => (
              <section className="project-action-group" key={group.project.id}>
                <div className="project-action-group__header">
                  <h3>{group.project.name}</h3>
                  <p className="technical">{group.project.path}</p>
                </div>
                <div className="action-list">
                  {group.actions.map((action) => (
                    <article className="action-row accent-dev" key={action.id}>
                      <div>
                        <h3>{action.title}</h3>
                        <p className="technical">{action.id}</p>
                        <p className="technical">{endpointForAction(action.id)}</p>
                        {endpointStatuses[action.id] && <p>{endpointStatuses[action.id]}</p>}
                      </div>
                      <div>
                        <span>{action.dangerLevel}</span>
                        <button type="button" onClick={() => void runEndpointAction(action.id)}>
                          Run/Test
                        </button>
                        <button type="button" onClick={() => void copyEndpoint(action.id)}>
                          Copy endpoint
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </Panel>
    </section>
  );
}

function PlaceholderView({
  id,
  title,
  onAction
}: {
  id: "clipboard" | "drop";
  title: string;
  onAction: (actionId: string) => Promise<void>;
}) {
  const actionId = id === "clipboard" ? "clipboard.open_placeholder" : "drop.open_placeholder";

  return (
    <section className="view-stack" aria-labelledby={`${id}-title`}>
      <div className="section-heading">
        <p>Placeholder</p>
        <h2 id={`${id}-title`}>{title}</h2>
      </div>
      <Panel title={`${title} is reserved`}>
        <p>This module stays placeholder-only until the spine is stable.</p>
        <button type="button" onClick={() => void onAction(actionId)}>
          Record safe {title} click
        </button>
      </Panel>
    </section>
  );
}

function AuditView({
  events,
  onRefresh,
  refreshEvents
}: {
  events: EventEntry[];
  onRefresh: (actionId: string) => Promise<void>;
  refreshEvents: () => Promise<void>;
}) {
  async function refresh(): Promise<void> {
    await onRefresh("audit.open_history");
    await refreshEvents();
  }

  return (
    <section className="view-stack" aria-labelledby="audit-title">
      <div className="section-heading section-heading--row">
        <div>
          <p>SQLite event log</p>
          <h2 id="audit-title">Recent Events</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="event-list">
        {events.length === 0 ? (
          <p className="empty-state">No events yet. Run an action to populate Audit.</p>
        ) : (
          events.map((event) => (
            <article className="event-row" key={event.id}>
              <p className="technical">{new Date(event.timestamp).toLocaleTimeString()}</p>
              <p>{event.module}</p>
              <p className="technical">{event.actionId ?? "none"}</p>
              <p>{event.status}</p>
              <p>{event.source}</p>
              <p>{event.summary}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function SettingsView({ appInfo }: { appInfo: AppInfo | null }) {
  const rows = [
    ["Data root", appInfo?.dataRoot ?? "Loading"],
    ["Database", appInfo?.dbPath ?? "Loading"],
    ["Local endpoint", appInfo?.actionEndpoint ?? "Loading"],
    ["Projects config", appInfo?.projectsConfigPath ?? "Loading"],
    ["Saved projects", String(appInfo?.projectCount ?? 0)],
    ["App version", "0.1.0"],
    ["Performance mode", appInfo?.performanceMode ?? "Loading"]
  ];

  return (
    <section className="view-stack" aria-labelledby="settings-title">
      <div className="section-heading">
        <p>Local-only configuration</p>
        <h2 id="settings-title">Settings</h2>
      </div>

      <div className="settings-list">
        {rows.map(([label, value]) => (
          <div className="settings-row" key={label}>
            <span>{label}</span>
            <strong className="technical">{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="panel">
      <h3>{title}</h3>
      <div className="panel__body">{children}</div>
    </article>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("DexNest root element was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <DexNestApp />
  </React.StrictMode>
);
