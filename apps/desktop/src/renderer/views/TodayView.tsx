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
  extraFolderKind,
  extraFolders,
  lifecycleTone,
  observedAt,
  projectIdForPath,
  repoLabels,
  repoName,
  repoStateBadge,
  repoStateLine,
  repoStateTitle,
  SECTION_PREVIEW,
  sectionItems,
  sectionOmitted,
  sectionTotal,
  settingsWithout,
  severityTone,
  todayStats,
  viewState,
  watchedProjects,
  watchingLine,
  whenLabel,
  windowLine,
  type ChangeKind,
  type ExtraFolder,
  type WatchedProject,
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
  projectsList?(options?: { includeArchived?: boolean }): Promise<Array<{ project: { id: string; name: string; path: string; git?: { isRepo: boolean | null } } }>>;
}

interface Loaded {
  status: TodayStatus | null;
  report: StandupReport | null;
  repositories: Repository[];
  /** Projects' list: what the scan follows, and the names it uses. */
  projects: Array<{ id: string; name: string; path: string; isRepo: boolean | null }>;
  /** Folders watched by their own setting, from before the scan followed Projects. */
  watched: Pick<TodaySettings, "roots" | "manualRepositories"> | null;
}

export interface TodayViewProps {
  bridge: TodayBridge;
  /** Runs a registered action (dev.scan_repositories, standup.generate, projects.open_vscode). */
  onAction(actionId: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Tests only: start from a known state instead of loading. */
  initial?: Partial<Loaded> & { error?: string | null };
}

const EMPTY: Loaded = { status: null, report: null, repositories: [], projects: [], watched: null };

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const projectsBridge = bridge as TodayBridge & ProjectsReads;
      const [status, report, repositories, watched, projects] = await Promise.all([
        bridge.devIntelligenceStatus(),
        bridge.standupLatest(),
        bridge.devIntelligenceRepositories(),
        bridge.devIntelligenceSettings().catch(() => null),
        // Projects is optional here: without it the hero's button is simply not offered.
        projectsBridge.projectsList ? projectsBridge.projectsList().catch(() => []) : Promise.resolve([])
      ]);
      setData({
        status,
        report,
        repositories,
        projects: (projects ?? []).map((p) => ({ id: p.project.id, name: p.project.name, path: p.project.path, isRepo: p.project.git?.isRepo ?? null })),
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

  const { status, report, repositories, projects, watched } = data;
  const state = viewState({ loading, error, status, report });
  const labels = repoLabels(repositories, projects);
  const following = watchedProjects(projects);
  const extras = extraFolders(watched, projects);

  /** Turns the repository scan on, then runs the first scan. What it reads is Projects' list; nothing is chosen here. */
  const turnOn = useCallback(async () => {
    setBusy("setup");
    setNotice(null);
    try {
      await bridge.devIntelligenceUpdateSettings({ ...(await bridge.devIntelligenceSettings()), enabled: true });
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) });
      setBusy(null);
      return;
    }
    await run("dev.scan_repositories");
  }, [bridge, run]);

  /** Stops watching a folder that was configured by hand. Projects are managed in Projects. */
  const stopWatching = useCallback(
    async (path: string) => {
      setBusy("watch");
      setNotice(null);
      try {
        await bridge.devIntelligenceUpdateSettings(settingsWithout(await bridge.devIntelligenceSettings(), path));
        setNotice({ ok: true, text: "No longer watched. It drops out of the report at the next scan." });
        await load();
      } catch (e) {
        setNotice({ ok: false, text: errorText(e) });
      } finally {
        setBusy(null);
      }
    },
    [bridge, load]
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
            following.length > 0 ? (
              <Button variant="primary" disabledReason={busy ? "Working…" : null} onClick={() => void turnOn()}>
                {busy === "setup" || busy === "dev.scan_repositories" ? "Scanning…" : `Turn on and scan ${following.length === 1 ? "1 project" : `${following.length} projects`}`}
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
          {following.length > 0 ? (
            <div className="today-setup" role="group" aria-label="Projects Today will read">
              <p className="today-setup__title">It reads your projects, from Projects</p>
              {following.map((project) => (
                <p key={project.id} className="today-setup__row">
                  <span className="today-setup__name">{project.name}</span>
                  <Technical>{project.path}</Technical>
                </p>
              ))}
            </div>
          ) : (
            <p>Add your projects first, then come back here: Today reads whatever is in Projects, under the names you gave them there.</p>
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

      {state === "ready" && report && <Report report={report} status={status} labels={labels} projects={projects} following={following} extras={extras} emptyFolders={emptyWatchedFolders(extras, repositories)} busy={busy !== null} run={run} onStopWatching={stopWatching} />}
    </section>
  );
}

function Report({
  report,
  status,
  labels,
  projects,
  following,
  extras,
  emptyFolders,
  busy,
  run,
  onStopWatching
}: {
  following: readonly WatchedProject[];
  extras: readonly ExtraFolder[];
  onStopWatching(path: string): Promise<void>;
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
                    return <ListRow key={item.id} icon={<GitBranch />} tone={badge.tone} title={repoStateTitle(item, labels)} meta={repoStateLine(item.summary)} trailing={<Badge tone={badge.tone}>{badge.label}</Badge>} />;
                  }}
                />
              )}
            </Card>
            <Card aria-labelledby="today-watching">
              <SectionTitle id="today-watching">Watching</SectionTitle>
              <p className="today-note">
                {watchingLine(following.length, extras.length)}. Projects are followed automatically: add, archive or remove one in Projects to change what is read.
              </p>
              <Button size="sm" variant="ghost" onClick={() => void run("dev.open_dashboard", {}, false)}>Manage in Projects</Button>
              {extras.length > 0 && (
                <div className="today-rows today-watching">
                  {extras.map((folder) => (
                    <ListRow
                      key={folder.path}
                      icon={<FolderGit2 />}
                      tone="neutral"
                      title={<Technical>{folder.path}</Technical>}
                      meta={extraFolderKind(folder)}
                      trailing={
                        <Button size="sm" variant="ghost" disabledReason={busy ? "Working…" : null} onClick={() => void onStopWatching(folder.path)}>
                          Stop watching
                        </Button>
                      }
                    />
                  ))}
                </div>
              )}
            </Card>
          </>
        }
      />
    </>
  );
}
