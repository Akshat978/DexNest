import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
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
  clipboardHistoryPath: string;
  clipboardSnippetsPath: string;
  dropShelfPath: string;
  dropIncomingPath: string;
  dropReceiveFolderPath: string;
  dropOutgoingFolderPath: string;
  dropTempFolderPath: string;
  dropLocalUrl: string;
  dropPhoneUrl: string;
  lanIp: string | null;
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

interface ClipboardHistoryItem {
  id: string;
  text: string;
  preview: string;
  byteLength: number;
  createdAt: string;
}

interface ClipboardSnippet {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface ClipboardState {
  history: ClipboardHistoryItem[];
  snippets: ClipboardSnippet[];
  snippetsPath: string;
  historyPath: string;
}

interface DropShelfItem {
  id: string;
  type: "text" | "file";
  text?: string;
  preview?: string;
  fileName?: string;
  originalName?: string;
  path?: string;
  byteLength: number;
  source: "manual" | "clipboard" | "phone" | "desktop";
  direction: "outgoing" | "incoming";
  createdAt: string;
  expiresAt: string | null;
}

interface DropState {
  shelf: DropShelfItem[];
  outgoing: DropShelfItem[];
  outgoingText: DropShelfItem[];
  outgoingFiles: DropShelfItem[];
  incoming: DropShelfItem[];
  shelfPath: string;
  incomingPath: string;
  receiveFolderPath: string;
  defaultReceiveFolderPath: string;
  customReceiveFolderPath: string | null;
  outgoingFolderPath: string;
  tempFolderPath: string;
  localUrl: string;
  phoneUrl: string;
  lanIp: string | null;
}

interface DexNestBridge {
  getAppInfo: () => Promise<AppInfo>;
  listActions: () => Promise<ActionDefinition[]>;
  listProjects: () => Promise<DexNestProject[]>;
  listCommandResults: () => Promise<Record<string, ProjectCommandResult>>;
  clearCommandResult: (actionId: string) => Promise<void>;
  listPinnedActions: () => Promise<string[]>;
  savePinnedActions: (actionIds: string[]) => Promise<string[]>;
  getClipboardState: () => Promise<ClipboardState>;
  getDropState: () => Promise<DropState>;
  copyDropIncomingText: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  chooseDropReceiveFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  resetDropReceiveFolder: () => Promise<{ ok: boolean; path: string }>;
  logDropAutoRefresh: (enabled: boolean) => Promise<void>;
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
    clipboardHistoryPath: "./local-data/settings/clipboard-history.json",
    clipboardSnippetsPath: "./local-data/settings/clipboard-snippets.json",
    dropShelfPath: "./local-data/settings/drop-shelf.json",
    dropIncomingPath: "./local-data/settings/drop-incoming.json",
    dropReceiveFolderPath: "./local-data/files/drop/incoming",
    defaultReceiveFolderPath: "./local-data/files/drop/incoming",
    customReceiveFolderPath: null,
    dropOutgoingFolderPath: "./local-data/files/drop/outgoing",
    dropTempFolderPath: "./local-data/files/drop/temp",
    dropLocalUrl: "http://127.0.0.1:43217/drop",
    dropPhoneUrl: "http://127.0.0.1:43217/drop",
    lanIp: null,
    projectCount: 0,
    performanceMode: "Bridge unavailable"
  }),
  listActions: async () => [],
  listProjects: async () => [],
  listCommandResults: async () => ({}),
  clearCommandResult: async () => undefined,
  listPinnedActions: async () => ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"],
  savePinnedActions: async (actionIds) => actionIds,
  getClipboardState: async () => ({ history: [], snippets: [], snippetsPath: "./local-data/settings/clipboard-snippets.json", historyPath: "./local-data/settings/clipboard-history.json" }),
  getDropState: async () => ({
    shelf: [],
    outgoing: [],
    outgoingText: [],
    outgoingFiles: [],
    incoming: [],
    shelfPath: "./local-data/settings/drop-shelf.json",
    incomingPath: "./local-data/settings/drop-incoming.json",
    receiveFolderPath: "./local-data/files/drop/incoming",
    defaultReceiveFolderPath: "./local-data/files/drop/incoming",
    customReceiveFolderPath: null,
    outgoingFolderPath: "./local-data/files/drop/outgoing",
    tempFolderPath: "./local-data/files/drop/temp",
    localUrl: "http://127.0.0.1:43217/drop",
    phoneUrl: "http://127.0.0.1:43217/drop",
    lanIp: null
  }),
  copyDropIncomingText: async () => ({ ok: true }),
  chooseDropReceiveFolder: async () => ({ ok: false, error: "Bridge unavailable" }),
  resetDropReceiveFolder: async () => ({ ok: true, path: "./local-data/files/drop/incoming" }),
  logDropAutoRefresh: async () => undefined,
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
  { id: "clipboard", label: "Clipboard", accentClass: "accent-clipboard", actionId: "clipboard.open" },
  { id: "drop", label: "Drop", accentClass: "accent-drop", actionId: "drop.open" },
  { id: "audit", label: "Audit", accentClass: "accent-command", actionId: "audit.open_history" },
  { id: "settings", label: "Settings", accentClass: "accent-command", actionId: "settings.open" }
];

const moduleCards = [
  ["command", "Command", "Action hub and dashboard.", "available"],
  ["dev", "Dev", "Project cards and local commands.", "placeholder"],
  ["deck", "Deck", "Stream Deck localhost action surface.", "placeholder"],
  ["clipboard", "Clipboard", "Manual history and snippets.", "available"],
  ["drop", "Drop", "Local handoff shelf foundation.", "available"]
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
  const [clipboardState, setClipboardState] = useState<ClipboardState>({ history: [], snippets: [], snippetsPath: "", historyPath: "" });
  const [dropState, setDropState] = useState<DropState>({
    shelf: [],
    outgoing: [],
    outgoingText: [],
    outgoingFiles: [],
    incoming: [],
    shelfPath: "",
    incomingPath: "",
    receiveFolderPath: "",
    defaultReceiveFolderPath: "",
    customReceiveFolderPath: null,
    outgoingFolderPath: "",
    tempFolderPath: "",
    localUrl: "",
    phoneUrl: "",
    lanIp: null
  });
  const [events, setEvents] = useState<EventEntry[]>([]);

  const activeLabel = useMemo(
    () => views.find((view) => view.id === activeView)?.label ?? "Command",
    [activeView]
  );

  useEffect(() => {
    void refreshShellData();
  }, []);

  async function refreshShellData(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextEvents] = await Promise.all([
      getBridge().getAppInfo(),
      getBridge().listActions(),
      getBridge().listProjects(),
      getBridge().listCommandResults(),
      getBridge().listPinnedActions(),
      getBridge().getClipboardState(),
      getBridge().getDropState(),
      getBridge().listEvents()
    ]);

    setAppInfo(info);
    setActions(nextActions);
    setProjects(nextProjects);
    setCommandResults(nextCommandResults);
    setPinnedActionIds(nextPinnedActionIds);
    setClipboardState(nextClipboardState);
    setDropState(nextDropState);
    setEvents(nextEvents);
  }

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function refreshProjectsAndActions(): Promise<void> {
    const [info, nextActions, nextProjects, nextCommandResults, nextPinnedActionIds, nextClipboardState, nextDropState, nextEvents] = await Promise.all([
      getBridge().getAppInfo(),
      getBridge().listActions(),
      getBridge().listProjects(),
      getBridge().listCommandResults(),
      getBridge().listPinnedActions(),
      getBridge().getClipboardState(),
      getBridge().getDropState(),
      getBridge().listEvents()
    ]);

    setAppInfo(info);
    setActions(nextActions);
    setProjects(nextProjects);
    setCommandResults(nextCommandResults);
    setPinnedActionIds(nextPinnedActionIds);
    setClipboardState(nextClipboardState);
    setDropState(nextDropState);
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
          {activeView === "clipboard" && (
            <ClipboardView
              clipboardState={clipboardState}
              onAction={runAction}
            />
          )}
          {activeView === "drop" && (
            <DropView
              dropState={dropState}
              endpoint={appInfo?.actionEndpoint}
              onAction={runAction}
              onRefresh={refreshShellData}
            />
          )}
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

const emptySnippetForm = {
  id: "",
  title: "",
  text: ""
};

function ClipboardView({
  clipboardState,
  onAction
}: {
  clipboardState: ClipboardState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
}) {
  const [activeTab, setActiveTab] = useState<"history" | "snippets" | "rules">("history");
  const [snippetForm, setSnippetForm] = useState(emptySnippetForm);

  async function saveCurrentClipboard(): Promise<void> {
    await onAction("clipboard.save_current");
  }

  async function pasteAsPlainText(): Promise<void> {
    await onAction("clipboard.copy_plain_text");
  }

  async function saveSnippet(): Promise<void> {
    await onAction("clipboard.create_snippet", "module_ui", snippetForm);
    setSnippetForm(emptySnippetForm);
  }

  async function deleteSnippet(snippetId: string): Promise<void> {
    const confirmed = window.confirm("Delete this DexNest Clipboard snippet?");
    if (!confirmed) {
      return;
    }

    await onAction("clipboard.delete_snippet", "module_ui", { id: snippetId, confirmedDangerous: true });
  }

  return (
    <section className="view-stack" aria-labelledby="clipboard-title">
      <div className="section-heading">
        <p>Manual local clipboard</p>
        <h2 id="clipboard-title">Clipboard</h2>
      </div>

      <Panel title="Manual Clipboard Actions">
        <div className="button-row">
          <button type="button" onClick={() => void saveCurrentClipboard()}>
            Save current clipboard
          </button>
          <button type="button" onClick={() => void pasteAsPlainText()}>
            Paste as plain text
          </button>
        </div>
        <p>No listener is running. Clipboard entries are saved only when you click.</p>
      </Panel>

      <div className="tabs" role="tablist" aria-label="Clipboard sections">
        <button type="button" data-active={activeTab === "history"} onClick={() => setActiveTab("history")}>
          History
        </button>
        <button type="button" data-active={activeTab === "snippets"} onClick={() => setActiveTab("snippets")}>
          Snippets
        </button>
        <button type="button" data-active={activeTab === "rules"} onClick={() => setActiveTab("rules")}>
          Rules
        </button>
      </div>

      {activeTab === "history" && (
        <Panel title="Clipboard History">
          <p className="technical">{clipboardState.historyPath}</p>
          <div className="item-list">
            {clipboardState.history.length === 0 ? (
              <p>No clipboard history yet.</p>
            ) : (
              clipboardState.history.map((item) => (
                <article className="data-item accent-clipboard" key={item.id}>
                  <div>
                    <h3>{item.preview || "Saved clipboard text"}</h3>
                    <p>{item.byteLength} bytes saved at {new Date(item.createdAt).toLocaleString()}</p>
                    <p className="technical">{item.id}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
      )}

      {activeTab === "snippets" && (
        <Panel title="Snippets and Templates">
          <p className="technical">{clipboardState.snippetsPath}</p>
          <div className="project-form">
            <label>
              Title
              <input value={snippetForm.title} onChange={(event) => setSnippetForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Snippet text
              <textarea className="technical" value={snippetForm.text} onChange={(event) => setSnippetForm((current) => ({ ...current, text: event.target.value }))} />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void saveSnippet()}>
              {snippetForm.id ? "Save snippet" : "Create snippet"}
            </button>
            {snippetForm.id && (
              <button type="button" onClick={() => setSnippetForm(emptySnippetForm)}>
                Cancel edit
              </button>
            )}
          </div>
          <div className="item-list">
            {clipboardState.snippets.length === 0 ? (
              <p>No snippets yet.</p>
            ) : (
              clipboardState.snippets.map((snippet) => (
                <article className="data-item accent-clipboard" key={snippet.id}>
                  <div>
                    <h3>{snippet.title}</h3>
                    <p>{previewForUi(snippet.text)}</p>
                    <p className="technical">{snippet.id}</p>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => setSnippetForm({ id: snippet.id, title: snippet.title, text: snippet.text })}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteSnippet(snippet.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>
      )}

      {activeTab === "rules" && (
        <div className="dashboard-grid">
          <Panel title="Per-App Rules">
            <p>Placeholder only. No app monitoring or clipboard listener is active yet.</p>
          </Panel>
          <Panel title="Secret Protection">
            <p>Placeholder only. Future rules can flag passwords, tokens, and sensitive snippets before saving.</p>
          </Panel>
        </div>
      )}
    </section>
  );
}

function DropView({
  dropState,
  endpoint,
  onAction,
  onRefresh
}: {
  dropState: DropState;
  endpoint?: string;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [dropText, setDropText] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: "success" | "error" }>>([]);

  useEffect(() => {
    if (!dropState.phoneUrl) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(dropState.phoneUrl, { margin: 1, width: 180 }).then(setQrDataUrl);
  }, [dropState.phoneUrl]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = window.setInterval(() => {
      void onRefresh();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [autoRefresh, onRefresh]);

  function showToast(message: string, tone: "success" | "error" = "success"): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  async function toggleAutoRefresh(enabled: boolean): Promise<void> {
    setAutoRefresh(enabled);
    await getBridge().logDropAutoRefresh(enabled);
    showToast(`Auto-refresh ${enabled ? "enabled" : "disabled"}`);
  }

  async function copyTextToClipboard(value: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showToast(message);
    } catch {
      showToast("Copy failed", "error");
    }
  }

  async function createTextDrop(): Promise<void> {
    const result = await onAction("drop.create_text_drop", "module_ui", { text: dropText }) as { ok?: boolean; error?: string };
    if (result?.ok === false) {
      showToast(result.error ?? "Text send failed", "error");
      return;
    }
    setDropText("");
    showToast("Text sent");
  }

  async function sendClipboardToDrop(): Promise<void> {
    const result = await onAction("drop.send_clipboard_to_drop") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clipboard send failed" : "Text sent", result?.ok === false ? "error" : "success");
  }

  async function addOutgoingFile(): Promise<void> {
    const result = await onAction("drop.add_outgoing_file") as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File add failed" : "File added", result?.ok === false ? "error" : "success");
  }

  async function removeOutgoingFile(fileId: string): Promise<void> {
    const confirmed = window.confirm("Remove this outgoing Drop file copy?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.remove_outgoing_file", "module_ui", { id: fileId, confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "File remove failed" : "File removed", result?.ok === false ? "error" : "success");
  }

  async function clearOutgoing(): Promise<void> {
    const confirmed = window.confirm("Clear outgoing DexNest Drop text and file items?");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_outgoing", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear outgoing failed" : "Outgoing cleared", result?.ok === false ? "error" : "success");
  }

  async function clearIncoming(): Promise<void> {
    const confirmed = window.confirm("Clear incoming DexNest Drop metadata? Received files stay on disk.");
    if (!confirmed) {
      return;
    }

    const result = await onAction("drop.clear_incoming", "module_ui", { confirmedDangerous: true }) as { ok?: boolean; error?: string };
    showToast(result?.ok === false ? result.error ?? "Clear incoming failed" : "Incoming list cleared", result?.ok === false ? "error" : "success");
  }

  async function copyIncomingText(itemId: string): Promise<void> {
    const result = await getBridge().copyDropIncomingText(itemId);
    showToast(result.ok ? "Copied incoming text" : result.error ?? "Copy failed", result.ok ? "success" : "error");
  }

  async function chooseReceiveFolder(): Promise<void> {
    const result = await getBridge().chooseDropReceiveFolder();
    if (result.ok) {
      await onRefresh();
      showToast("Receive folder changed");
    } else {
      showToast(result.error ?? "Receive folder change cancelled", "error");
    }
  }

  async function resetReceiveFolder(): Promise<void> {
    const result = await getBridge().resetDropReceiveFolder();
    await onRefresh();
    showToast(result.ok ? "Receive folder changed" : "Receive folder reset failed", result.ok ? "success" : "error");
  }

  const outgoingCount = dropState.outgoingText.length + dropState.outgoingFiles.length;
  const incomingText = dropState.incoming.filter((item) => item.type === "text");
  const incomingFiles = dropState.incoming.filter((item) => item.type === "file");

  return (
    <section className="view-stack drop-view accent-drop" aria-labelledby="drop-title">
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className="toast" data-tone={toast.tone} key={toast.id}>{toast.message}</div>
        ))}
      </div>

      <section className="drop-hero" aria-labelledby="drop-title">
        <div className="drop-hero__main">
          <div className="section-heading">
            <p>Two-way local Wi-Fi transfer</p>
            <h2 id="drop-title">DexNest Drop</h2>
          </div>
          <div className="status-pills" aria-label="Drop status">
            <span>Local only</span>
            <span>Same Wi-Fi required</span>
            <span>Server running</span>
            <span>Auto-refresh {autoRefresh ? "on" : "off"}</span>
          </div>
          <div className="drop-connection">
            <div>
              <span>LAN IP</span>
              <strong className="technical">{dropState.lanIp ?? "not detected"}</strong>
            </div>
            <div>
              <span>Phone URL</span>
              <strong className="technical">{dropState.phoneUrl || "Loading"}</strong>
            </div>
            <div>
              <span>Local URL</span>
              <strong className="technical">{dropState.localUrl || endpoint || "Loading"}</strong>
            </div>
          </div>
          <div className="button-row">
            <button className="button-primary" type="button" onClick={() => void onAction("drop.copy_phone_url").then(() => showToast("Drop URL copied"))}>
              Copy phone URL
            </button>
            <button className="button-secondary" type="button" onClick={() => void onRefresh().then(() => showToast("Drop refreshed"))}>
              Refresh
            </button>
            <button className="button-secondary" type="button" onClick={() => void toggleAutoRefresh(!autoRefresh)}>
              Auto-refresh {autoRefresh ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div className="drop-hero__qr">
          {qrDataUrl ? <img className="qr-code" src={qrDataUrl} alt="DexNest Drop phone URL QR code" /> : <div className="qr-code qr-code--empty" />}
          <p>Scan from Android Chrome on the same Wi-Fi. No cloud relay is used.</p>
        </div>
      </section>

      <section className="drop-transfer-grid" aria-label="Drop transfer directions">
        <article className="drop-panel">
          <div className="drop-panel__header">
            <div>
              <p>PC to Phone</p>
              <h3>Send to phone</h3>
            </div>
            <span>{outgoingCount} ready</span>
          </div>
          <textarea
            className="technical"
            placeholder="Write text to make available on your phone"
            value={dropText}
            onChange={(event) => setDropText(event.target.value)}
          />
          <div className="button-row">
            <button className="button-primary" type="button" onClick={() => void createTextDrop()}>
              Send text
            </button>
            <button className="button-secondary" type="button" onClick={() => void sendClipboardToDrop()}>
              Send clipboard
            </button>
            <button className="button-secondary" type="button" onClick={() => void addOutgoingFile()}>
              Add file
            </button>
            <button className="button-danger" type="button" onClick={() => void clearOutgoing()}>
              Clear outgoing
            </button>
          </div>
          <p>Text drops include expiry metadata. Files are copied into the outgoing shelf.</p>
          <p className="technical">{dropState.outgoingFolderPath}</p>
        </article>

        <article className="drop-panel">
          <div className="drop-panel__header">
            <div>
              <p>Phone to PC</p>
              <h3>Receive from phone</h3>
            </div>
            <span>{dropState.incoming.length} incoming</span>
          </div>
          <div className="drop-folder-card">
            <span>Current receive folder</span>
            <strong className="technical">{dropState.receiveFolderPath}</strong>
          </div>
          <div className="button-row">
            <button className="button-primary" type="button" onClick={() => void chooseReceiveFolder()}>
              Choose receive folder
            </button>
            <button className="button-secondary" type="button" onClick={() => void onAction("drop.open_incoming_folder")}>
              Open folder
            </button>
            <button className="button-secondary" type="button" onClick={() => void resetReceiveFolder()}>
              Reset default
            </button>
            <button className="button-danger" type="button" onClick={() => void clearIncoming()}>
              Clear incoming list
            </button>
          </div>
          <p>Default folder:</p>
          <p className="technical">{dropState.defaultReceiveFolderPath}</p>
          {dropState.customReceiveFolderPath && (
            <>
              <p>Custom folder:</p>
              <p className="technical">{dropState.customReceiveFolderPath}</p>
            </>
          )}
          <p>PIN placeholder: not enforced in this MVP.</p>
        </article>
      </section>

      <section className="drop-shelf-grid" aria-label="Drop shelves">
        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Outgoing text</h3>
            <span>{dropState.outgoingText.length}</span>
          </div>
          {dropState.outgoingText.length === 0 ? (
            <p className="empty-inline">No outgoing text drops yet.</p>
          ) : (
            dropState.outgoingText.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Send to phone</p>
                  <h4>{item.preview || "Text drop"}</h4>
                  <p>{formatBytes(item.byteLength)} from {item.source}</p>
                  <p>Expires: {item.expiresAt ? formatDate(item.expiresAt) : "not set"}</p>
                  <p className="technical">{item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void copyTextToClipboard(item.id, "Drop ID copied")}>
                  Copy ID
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Outgoing files</h3>
            <span>{dropState.outgoingFiles.length}</span>
          </div>
          {dropState.outgoingFiles.length === 0 ? (
            <p className="empty-inline">No outgoing files yet.</p>
          ) : (
            dropState.outgoingFiles.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Send to phone</p>
                  <h4>{item.originalName ?? item.fileName ?? "Outgoing file"}</h4>
                  <p>{formatBytes(item.byteLength)}. Phone can download this file.</p>
                  <p className="technical">{item.id}</p>
                </div>
                <button className="button-danger" type="button" onClick={() => void removeOutgoingFile(item.id)}>
                  Remove
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Incoming text</h3>
            <span>{incomingText.length}</span>
          </div>
          {incomingText.length === 0 ? (
            <p className="empty-inline">No incoming phone text yet.</p>
          ) : (
            incomingText.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Receive from phone</p>
                  <h4>{item.preview ?? "Incoming text"}</h4>
                  <p>{formatBytes(item.byteLength)} from phone</p>
                  <p>{formatDate(item.createdAt)}</p>
                  <p className="technical">{item.path ?? item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void copyIncomingText(item.id)}>
                  Copy
                </button>
              </div>
            ))
          )}
        </article>

        <article className="drop-shelf">
          <div className="drop-shelf__header">
            <h3>Incoming files</h3>
            <span>{incomingFiles.length}</span>
          </div>
          {incomingFiles.length === 0 ? (
            <p className="empty-inline">No incoming phone files yet.</p>
          ) : (
            incomingFiles.map((item) => (
              <div className="drop-card" key={item.id}>
                <div>
                  <p className="drop-card__eyebrow">Receive from phone</p>
                  <h4>{item.originalName ?? item.fileName ?? "Incoming file"}</h4>
                  <p>{formatBytes(item.byteLength)} from phone</p>
                  <p>{formatDate(item.createdAt)}</p>
                  <p className="technical">{item.path ?? item.id}</p>
                </div>
                <button className="button-secondary" type="button" onClick={() => void onAction("drop.open_incoming_folder")}>
                  Open folder
                </button>
              </div>
            ))
          )}
        </article>
      </section>
    </section>
  );
}

function previewForUi(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
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
  const clipboardDropActions = actions.filter((action) => action.module === "clipboard" || action.module === "drop");
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

      <Panel title="Clipboard and Drop Actions">
        <div className="action-list">
          {clipboardDropActions.length === 0 ? (
            <p>No Clipboard or Drop actions registered.</p>
          ) : (
            clipboardDropActions.map((action) => (
              <article className={`action-row accent-${action.moduleId}`} key={action.id}>
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
    ["Clipboard history", appInfo?.clipboardHistoryPath ?? "Loading"],
    ["Clipboard snippets", appInfo?.clipboardSnippetsPath ?? "Loading"],
    ["Drop shelf", appInfo?.dropShelfPath ?? "Loading"],
    ["Drop incoming metadata", appInfo?.dropIncomingPath ?? "Loading"],
    ["Drop receive folder", appInfo?.dropReceiveFolderPath ?? "Loading"],
    ["Drop outgoing folder", appInfo?.dropOutgoingFolderPath ?? "Loading"],
    ["Drop temp folder", appInfo?.dropTempFolderPath ?? "Loading"],
    ["Drop phone URL", appInfo?.dropPhoneUrl ?? "Loading"],
    ["Detected LAN IP", appInfo?.lanIp ?? "Not detected"],
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
