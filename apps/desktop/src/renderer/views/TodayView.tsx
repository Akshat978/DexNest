import React, { useCallback, useEffect, useState } from "react";
import type { Repository, StandupItem, StandupReport } from "@dexnest/dev-intelligence-contracts";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Code2, FolderGit2, GitBranch, GitCommitHorizontal, ListTodo, PencilLine, RefreshCw, Sunrise } from "lucide-react";
import {
  accentStyle,
  Badge,
  Button,
  Card,
  DashboardGrid,
  EmptyNote,
  EmptyState,
  ErrorState,
  Hero,
  InlineError,
  ListRow,
  LoadingState,
  Notice,
  PageHeader,
  SectionTitle,
  StatGrid,
  StatTile,
  Technical
} from "../components/ui/kit";
import {
  actionMessage,
  attentionTitle,
  changeKind,
  changeTitle,
  continuations,
  emptyWatchedFolders,
  lifecycleTone,
  observedAt,
  projectIdForPath,
  repoLabels,
  repoName,
  repoStateBadge,
  repoStateLine,
  SECTION_PREVIEW,
  sectionItems,
  sectionOmitted,
  sectionTotal,
  settingsWithFolders,
  setupFolders,
  severityTone,
  todayStats,
  viewState,
  whenLabel,
  windowLine,
  type ChangeKind,
  type SetupFolder,
  type TodaySettings,
  type TodayStatus
} from "./todayModel";
import "./Today.css";

// Today: the morning screen.
//
// A reading of the latest Standup report: where you left off, what changed
// since the last one, what needs attention, and the state of each repository.
// Nothing is computed here and nothing runs on a timer; the report is whatever
// Developer Intelligence last wrote, and a scan happens only when asked for.

/** The preload methods this view uses. */
export interface TodayBridge {
  devIntelligenceStatus(): Promise<TodayStatus>;
  devIntelligenceSettings(): Promise<TodaySettings>;
  devIntelligenceUpdateSettings(settings: TodaySettings): Promise<TodaySettings>;
  devIntelligenceRepositories(): Promise<Repository[]>;
  standupLatest(): Promise<StandupReport | null>;
}

/** What Projects already knows, read through its own bridge when it is there. */
interface ProjectsReads {
  projectsList?(options?: { includeArchived?: boolean }): Promise<Array<{ project: { id: string; path: string } }>>;
  projectsSettings?(): Promise<{ importRoots?: string[] }>;
}

interface Loaded {
  status: TodayStatus | null;
  report: StandupReport | null;
  repositories: Repository[];
  projects: Array<{ id: string; path: string }>;
  importRoots: string[];
  /** The folders being watched, to name any that yielded no repository. */
  watched: Pick<TodaySettings, "roots" | "manualRepositories"> | null;
}

export interface TodayViewProps {
  bridge: TodayBridge;
  /** Runs a registered action (dev.scan_repositories, standup.generate, projects.open_vscode). */
  onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: Partial<Loaded> & { error?: string | null };
}

const EMPTY: Loaded = { status: null, report: null, repositories: [], projects: [], importRoots: [], watched: null };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

const CHANGE_ICONS: Record<ChangeKind, React.ComponentType> = {
  commit: GitCommitHorizontal,
  push: ArrowUpFromLine,
  pull: ArrowDownToLine,
  branch: GitBranch,
  "todo-new": ListTodo,
  "todo-resolved": CheckCircle2,
  other: PencilLine
};

/** A section's rows, the first few until asked for the rest. */
function Rows<T>({ items, row, label, omitted = 0 }: { items: readonly T[]; row(item: T): React.ReactNode; label: string; omitted?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SECTION_PREVIEW);
  return (
    <>
      <div className="today-rows">{shown.map(row)}</div>
      {items.length > SECTION_PREVIEW && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${items.length.toLocaleString("en")} ${label}`}
        </Button>
      )}
      {omitted > 0 && (all || items.length <= SECTION_PREVIEW) && (
        <EmptyNote>
          {omitted.toLocaleString("en")} more {label} are not listed: a Standup keeps the first {items.length.toLocaleString("en")}.
        </EmptyNote>
      )}
    </>
  );
}

export function TodayView({ bridge, onAction, initial }: TodayViewProps) {
  const [data, setData] = useState<Loaded>({ ...EMPTY, ...initial });
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectsBridge = bridge as TodayBridge & ProjectsReads;
      const [status, report, repositories, watched, projects, projectsSettings] = await Promise.all([
        bridge.devIntelligenceStatus(),
        bridge.standupLatest(),
        bridge.devIntelligenceRepositories(),
        bridge.devIntelligenceSettings().catch(() => null),
        // Projects is optional here: without it the hero's button is simply not offered.
        projectsBridge.projectsList ? projectsBridge.projectsList().catch(() => []) : Promise.resolve([]),
        projectsBridge.projectsSettings ? projectsBridge.projectsSettings().catch(() => null) : Promise.resolve(null)
      ]);
      setData({
        status,
        report,
        repositories,
        projects: (projects ?? []).map((p) => ({ id: p.project.id, path: p.project.path })),
        importRoots: projectsSettings?.importRoots ?? [],
        watched
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (initial === undefined) void load();
  }, [initial, load]);

  const run = useCallback(
    async (actionId: string, params: Record<string, unknown> = {}, reload = true) => {
      setBusy(actionId);
      setNotice(null);
      try {
        const outcome = actionMessage(await onAction(actionId, params));
        if (outcome.text) setNotice({ ok: outcome.ok, text: outcome.text });
        if (reload) await load();
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
      } finally {
        setBusy(null);
      }
    },
    [onAction, load]
  );

  const { status, report, repositories, projects, importRoots, watched } = data;
  const state = viewState({ loading, error, status, report });
  const labels = repoLabels(repositories);
  const folders = setupFolders(importRoots, projects);
  const chosen = folders.filter((f) => !unchecked.has(f.path));

  /** Turns Developer Intelligence on with the chosen folders, then runs the first scan. */
  const turnOn = useCallback(
    async (selected: readonly SetupFolder[]) => {
      setBusy("setup");
      setNotice(null);
      try {
        await bridge.devIntelligenceUpdateSettings(settingsWithFolders(await bridge.devIntelligenceSettings(), selected));
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
        setBusy(null);
        return;
      }
      await run("dev.scan_repositories");
    },
    [bridge, run]
  );

  const scanning = busy === "dev.scan_repositories" || busy === "setup" || status?.scanning === true;

  return (
    <section className="view-stack today" style={accentStyle("today")} aria-labelledby="today-title" aria-busy={state === "loading"}>
      <PageHeader
        icon={<Sunrise />}
        title="Today"
        titleId="today-title"
        subtitle={state === "ready" && report ? windowLine(report) : "Where you left off, and what changed since."}
        actions={
          (state === "ready" || state === "waiting") && (
            <>
              <Button icon={<RefreshCw />} disabledReason={scanning ? "A scan is running." : null} onClick={() => void run("dev.scan_repositories")}>
                {scanning ? "Scanning…" : "Scan now"}
              </Button>
              {state === "ready" && (
                <Button variant="ghost" disabledReason={busy ? "Working…" : null} onClick={() => void run("standup.generate")}>
                  Write a new Standup
                </Button>
              )}
            </>
          )
        }
      />

      {notice && (notice.ok ? <Notice>{notice.text}</Notice> : <InlineError>{notice.text}</InlineError>)}

      {state === "loading" && <LoadingState label="Reading your Standup" rows={4} />}
      {state === "error" && <ErrorState title="Today could not be read" message="DexNest could not read the Standup report." detail={error} onRetry={() => void load()} />}

      {state === "off" && (
        <EmptyState
          icon={<Sunrise />}
          title="Start your mornings here"
          actions={
            folders.length > 0 ? (
              <Button variant="primary" disabledReason={busy ? "Working…" : chosen.length === 0 ? "Choose at least one folder." : null} onClick={() => void turnOn(chosen)}>
                {busy === "setup" || busy === "dev.scan_repositories" ? "Scanning…" : `Turn on and scan ${chosen.length === 1 ? "1 folder" : `${chosen.length} folders`}`}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void run("dev.open_dashboard", {}, false)}>Open Projects</Button>
            )
          }
        >
          <p>
            Today reads your repositories and writes a Standup: where you left off, what changed since the last one, and what needs attention. It stays on this
            computer, reads through git without changing anything, and never looks inside DexNest's own data.
          </p>
          {folders.length > 0 ? (
            <fieldset className="today-setup">
              <legend>Folders to watch, from Projects</legend>
              {folders.map((folder) => (
                <label key={folder.path} className="today-setup__row">
                  <input
                    type="checkbox"
                    checked={!unchecked.has(folder.path)}
                    onChange={(event) => {
                      const next = new Set(unchecked);
                      if (event.target.checked) next.delete(folder.path);
                      else next.add(folder.path);
                      setUnchecked(next);
                    }}
                  />
                  <Technical>{folder.path}</Technical>
                  <span className="today-setup__kind">{folder.kind === "root" ? "every repository inside" : "this repository"}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p>Add your projects first, then come back here: Today offers their folders as the places to watch.</p>
          )}
        </EmptyState>
      )}

      {state === "waiting" && (
        <EmptyState
          icon={<Sunrise />}
          title={scanning ? "Reading your repositories…" : "No Standup yet"}
          actions={
            <Button variant="primary" icon={<RefreshCw />} disabledReason={scanning ? "A scan is running." : null} onClick={() => void run("dev.scan_repositories")}>
              {scanning ? "Scanning…" : "Scan now"}
            </Button>
          }
        >
          <p>The first scan writes the first Standup. It runs on its own schedule, or now if you ask.</p>
          {status?.lastError && <InlineError>The last scan failed: {status.lastError}</InlineError>}
        </EmptyState>
      )}

      {state === "ready" && report && <Report report={report} status={status} labels={labels} projects={projects} emptyFolders={emptyWatchedFolders(watched, repositories)} busy={busy !== null} run={run} />}
    </section>
  );
}

function Report({
  report,
  status,
  labels,
  projects,
  emptyFolders,
  busy,
  run
}: {
  /** Watched folders the last scan found no repository in. */
  emptyFolders: readonly string[];
  report: StandupReport;
  status: TodayStatus | null;
  labels: ReturnType<typeof repoLabels>;
  projects: Loaded["projects"];
  busy: boolean;
  run(actionId: string, params?: Record<string, unknown>, reload?: boolean): Promise<void>;
}) {
  const stats = todayStats(report, status);
  const [top, ...others] = continuations(report, labels);
  const topProject = top ? projectIdForPath(projects, top.path) : null;
  const changed = sectionItems(report, "Changed");
  const attention = sectionItems(report, "NeedsAttention");
  const states = sectionItems(report, "RepositoryState");
  const zone = report.timeWindow.timezone;
  const where = (item: StandupItem) => [repoName(labels, item.repositoryId), whenLabel(observedAt(item), zone)].filter(Boolean).join(" · ");

  return (
    <>
      {status?.lastError && <InlineError>The last scan failed, so this may be out of date: {status.lastError}</InlineError>}
      {emptyFolders.length > 0 && (
        <p className="today-note">
          No repository was found in {emptyFolders.length === 1 ? "this watched folder" : "these watched folders"}:{" "}
          {emptyFolders.map((folder, i) => (
            <React.Fragment key={folder}>
              {i > 0 && ", "}
              <Technical>{folder}</Technical>
            </React.Fragment>
          ))}
        </p>
      )}

      {top ? (
        <Hero
          eyebrow="Where you left off"
          title={top.name}
          actions={
            topProject ? (
              <Button variant="primary" icon={<Code2 />} disabledReason={busy ? "Working…" : null} onClick={() => void run("projects.open_vscode", { projectId: topProject }, false)}>
                Open in VS Code
              </Button>
            ) : (
              <Button onClick={() => void run("dev.open_dashboard", {}, false)}>Open Projects</Button>
            )
          }
        >
          <p className="today-reason">{top.reason}</p>
          {top.path && <Technical className="today-path">{top.path}</Technical>}
        </Hero>
      ) : (
        <Hero eyebrow="Where you left off" title="Nothing in motion">
          <p className="today-reason">No repository has recent activity or uncommitted work to pick up.</p>
        </Hero>
      )}

      <StatGrid columns={4}>
        <StatTile label="Repositories" value={stats.repositories.toLocaleString("en")} icon={<FolderGit2 />} />
        <StatTile label="Changes" value={stats.changes.toLocaleString("en")} icon={<GitCommitHorizontal />} tone="info" hint="since the last Standup" />
        <StatTile
          label="Needs attention"
          value={stats.attention.toLocaleString("en")}
          icon={<AlertTriangle />}
          tone={stats.attention > 0 ? "warning" : "success"}
          hint={stats.attention === 0 ? "all clear" : stats.newIssues > 0 ? `${stats.newIssues.toLocaleString("en")} new` : "none new"}
        />
        <StatTile label="Uncommitted" value={stats.uncommitted.toLocaleString("en")} icon={<PencilLine />} tone={stats.uncommitted > 0 ? "warning" : "success"} hint={`${stats.clean.toLocaleString("en")} clean`} />
      </StatGrid>

      <DashboardGrid
        main={
          <>
            <Card aria-labelledby="today-attention">
              <SectionTitle id="today-attention" count={sectionTotal(report, "NeedsAttention")}>Needs attention</SectionTitle>
              {attention.length === 0 ? (
                <EmptyNote>No failing health checks, conflicts or unfinished git operations.</EmptyNote>
              ) : (
                <Rows
                  items={attention}
                  label="issues"
                  omitted={sectionOmitted(report, "NeedsAttention")}
                  row={(item) => (
                    <ListRow
                      key={item.id}
                      icon={item.lifecycle === "RESOLVED" ? <CheckCircle2 /> : <AlertTriangle />}
                      tone={item.lifecycle === "RESOLVED" ? "success" : severityTone(item.severity)}
                      title={attentionTitle(item)}
                      meta={[item.summary, repoName(labels, item.repositoryId)].filter(Boolean).join(" · ")}
                      trailing={item.lifecycle && <Badge tone={lifecycleTone(item.lifecycle)}>{item.lifecycle}</Badge>}
                    />
                  )}
                />
              )}
            </Card>

            <Card aria-labelledby="today-changed">
              <SectionTitle id="today-changed" count={sectionTotal(report, "Changed")}>Changed since the last Standup</SectionTitle>
              {changed.length === 0 ? (
                <EmptyNote>No commits, branch changes or TODO changes in this window.</EmptyNote>
              ) : (
                <Rows
                  items={changed}
                  label="changes"
                  omitted={sectionOmitted(report, "Changed")}
                  row={(item) => {
                    const kind = changeKind(item);
                    const Icon = CHANGE_ICONS[kind];
                    return <ListRow key={item.id} icon={<Icon />} tone={kind === "todo-resolved" ? "success" : "accent"} title={changeTitle(item)} meta={where(item)} />;
                  }}
                />
              )}
            </Card>
          </>
        }
        side={
          <>
            {others.length > 0 && (
              <Card aria-labelledby="today-also">
                <SectionTitle id="today-also">Also in motion</SectionTitle>
                <div className="today-rows">
                  {others.slice(0, 4).map((c) => (
                    <ListRow key={c.repositoryId} icon={<FolderGit2 />} title={c.name} meta={c.reason} />
                  ))}
                </div>
              </Card>
            )}
            <Card aria-labelledby="today-repos">
              <SectionTitle id="today-repos" count={sectionTotal(report, "RepositoryState")}>Repositories</SectionTitle>
              {states.length === 0 ? (
                <EmptyNote>No repositories were found in the folders being watched.</EmptyNote>
              ) : (
                <Rows
                  items={states}
                  label="repositories"
                  omitted={sectionOmitted(report, "RepositoryState")}
                  row={(item) => {
                    const badge = repoStateBadge(item);
                    return <ListRow key={item.id} icon={<GitBranch />} tone={badge.tone} title={item.title} meta={repoStateLine(item.summary)} trailing={<Badge tone={badge.tone}>{badge.label}</Badge>} />;
                  }}
                />
              )}
            </Card>
          </>
        }
      />
    </>
  );
}
