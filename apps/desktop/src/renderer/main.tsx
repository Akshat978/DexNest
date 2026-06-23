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

interface DexNestBridge {
  getAppInfo: () => Promise<AppInfo>;
  listActions: () => Promise<ActionDefinition[]>;
  listEvents: () => Promise<EventEntry[]>;
  runAction: (payload: { actionId: string; source?: string; params?: unknown }) => Promise<{ ok: boolean; error?: string }>;
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
    performanceMode: "Bridge unavailable"
  }),
  listActions: async () => [],
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

function DexNestApp() {
  const [activeView, setActiveView] = useState<ViewId>("command");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actions, setActions] = useState<ActionDefinition[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);

  const activeLabel = useMemo(
    () => views.find((view) => view.id === activeView)?.label ?? "Command",
    [activeView]
  );

  useEffect(() => {
    void getBridge().getAppInfo().then(setAppInfo);
    void getBridge().listActions().then(setActions);
    void refreshEvents();
  }, []);

  async function refreshEvents(): Promise<void> {
    const recentEvents = await getBridge().listEvents();
    setEvents(recentEvents);
  }

  async function runAction(actionId: string, source = "module_ui", params: unknown = {}): Promise<void> {
    await getBridge().runAction({ actionId, source, params });
    await refreshEvents();
  }

  async function navigate(view: ViewId): Promise<void> {
    const actionId = views.find((item) => item.id === view)?.actionId;
    setActiveView(view);
    if (actionId) {
      await runAction(actionId);
    }
  }

  async function handleAction(actionId: string): Promise<void> {
    await runAction(actionId);
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
          {activeView === "command" && <CommandView actions={actions} onAction={handleAction} />}
          {activeView === "dev" && <DevView onAction={handleAction} />}
          {activeView === "deck" && <DeckView endpoint={appInfo?.actionEndpoint} refreshEvents={refreshEvents} />}
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
  onAction
}: {
  actions: ActionDefinition[];
  onAction: (actionId: string) => Promise<void>;
}) {
  const pinnedActions = actions.filter((action) =>
    ["command.open_home", "dev.open_dashboard", "deck.test_endpoint"].includes(action.id)
  );

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
          {pinnedActions.map((action) => (
            <button type="button" key={action.id} onClick={() => void onAction(action.id)}>
              {action.title}
            </button>
          ))}
        </Panel>
        <Panel title="Stats">
          <p>Stats will summarize local event activity after the spine settles.</p>
        </Panel>
        <Panel title="Recent Actions">
          <p>Recent safe clicks and endpoint calls appear in Audit.</p>
        </Panel>
      </div>

      <Panel title="Action Registry">
        <div className="action-list">
          {actions.length === 0 ? (
            <p>No registered actions found.</p>
          ) : (
            actions.map((action) => (
              <article className={`action-row accent-${action.moduleId}`} key={action.id}>
                <div>
                  <h3>{action.title}</h3>
                  <p>{action.description}</p>
                  <p className="technical">{action.id}</p>
                </div>
                <div>
                  <span>{action.module}</span>
                  <span>{action.dangerLevel}</span>
                  <button type="button" onClick={() => void onAction(action.id)}>
                    Run
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

function DevView({ onAction }: { onAction: (actionId: string) => Promise<void> }) {
  return (
    <section className="view-stack" aria-labelledby="dev-title">
      <div className="section-heading">
        <p>DexNest Dev</p>
        <h2 id="dev-title">Project Cards</h2>
      </div>
      <div className="dashboard-grid">
        {["Pinned Projects", "Recent Workspaces", "Local Tools"].map((title) => (
          <Panel title={title} key={title}>
            <p>No project data yet. Dev actions remain placeholder-only.</p>
            <button type="button" onClick={() => void onAction("dev.open_dashboard")}>
              Mark placeholder viewed
            </button>
          </Panel>
        ))}
      </div>
    </section>
  );
}

function DeckView({
  endpoint,
  refreshEvents
}: {
  endpoint?: string;
  refreshEvents: () => Promise<void>;
}) {
  async function runTestAction(): Promise<void> {
    const actionId = "deck.test_endpoint";
    try {
      const response = await fetch(`${endpoint ?? "http://127.0.0.1:43217"}/actions/${actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true })
      });

      if (!response.ok) {
        await getBridge().logActionResult({
          actionId,
          status: "failed",
          source: "module_ui",
          summary: "Deck endpoint test failed.",
          errorMessage: `HTTP ${response.status}`
        });
      }
    } catch (error) {
      await getBridge().logActionResult({
        actionId,
        status: "failed",
        source: "module_ui",
        summary: "Deck endpoint test failed.",
        errorMessage: error instanceof Error ? error.message : "Unknown endpoint failure."
      });
    }

    await refreshEvents();
  }

  return (
    <section className="view-stack" aria-labelledby="deck-title">
      <div className="section-heading">
        <p>Local action surface</p>
        <h2 id="deck-title">Deck Endpoint</h2>
      </div>
      <Panel title="Deck localhost endpoint">
        <p className="technical">{endpoint ? `${endpoint}/actions/deck.test_endpoint` : "Loading endpoint"}</p>
        <button type="button" onClick={() => void runTestAction()}>
          Run test action
        </button>
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
