// Projects - every code project, its branches and how far they are from this
// PC (docs/modules/projects/PLAN.md, 15.2). Home: cards or rows, search,
// filters, "Needs attention" first, favourites next; quick buttons that say
// why when they can't run; an empty state that helps.
//
// Git state is read when the view opens, when the window regains focus
// (debounced) and after each operation - never on a timer.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderGit2, FolderPlus, FolderSearch, LayoutGrid, List, Plus, RefreshCw, Search } from "lucide-react";

import type { ProjectGroup, ProjectSummary, ProjectsSettings, RepoState } from "@dexnest/projects";
import type { ExecuteResult } from "@dexnest/projects/domain";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, SectionTitle, Segmented, Toasts, useToasts } from "../../components/ui/kit";
import { AddProjectWizard } from "./AddProjectWizard";
import { ImportProjectsDialog } from "./ImportProjectsDialog";
import { OperationDialog } from "./OperationDialog";
import { ProjectDetail, type RunActionResult } from "./ProjectDetail";
import type { RunResultView } from "./DetailTabs";
import { ProjectCard } from "./ProjectCard";
import { getProjectsBridge, type ProjectsBridge } from "./projectsBridge";
import {
  allTags,
  DEFAULT_FILTERS,
  headerSummary,
  homeSections,
  isSearchShortcut,
  moveFocus,
  SECTION_TITLES,
  STATUS_FILTERS,
  type HomeFilters,
  type QuickActionId,
  type ViewEntry,
  toggleWatched,
  watchCheckMessage
} from "./projectsModel";
import "./Projects.css";

export interface ProjectsHomeProps {
  entries: readonly ViewEntry[];
  groups: readonly ProjectGroup[];
  filters: HomeFilters;
  layout: "grid" | "list";
  now: string;
  staleDays: number;
  legacyChanged?: boolean;
  suggestionsCount?: number;
  searchRef?: React.Ref<HTMLInputElement>;
  onFilters(next: HomeFilters): void;
  onLayout(layout: "grid" | "list"): void;
  onAdd(): void;
  /** "Import projects": every repository under a folder, in one go. */
  onImport(): void;
  onFetchAll(): void;
  onPullAll(): void;
  onRefresh(): void;
  onImportLegacy?(): void;
  onOpen(entry: ViewEntry): void;
  onQuick(entry: ViewEntry, action: QuickActionId): void;
  onToggleFavourite(entry: ViewEntry): void;
}

/** The home screen for given data. No bridge, no effects - what tests render. */
export function ProjectsHome(props: ProjectsHomeProps) {
  const { entries, groups, filters, layout, now, staleDays } = props;
  const sections = useMemo(() => homeSections(entries, filters, now, staleDays), [entries, filters, now, staleDays]);
  const flat = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const tags = useMemo(() => allTags(entries.map((e) => e.project)), [entries]);
  const [focused, setFocused] = useState(0);
  const nameRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const live = entries.filter((e) => e.project.archivedAt === null);

  const columns = () => {
    if (layout === "list" || !gridRef.current) return 1;
    const style = window.getComputedStyle(gridRef.current.querySelector(".projects-grid") ?? gridRef.current);
    return Math.max(1, style.gridTemplateColumns.split(" ").filter(Boolean).length);
  };
  const onKeyDownName = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = moveFocus(index, event.key, flat.length, columns());
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    nameRefs.current[next]?.focus();
  };

  if (live.length === 0) {
    return (
      <div className="projects">
        <PageHeader icon={<FolderGit2 />} title="Projects" subtitle="Your code projects, their branches and how far they are from GitHub." accent="dev" />
        <EmptyState
          icon={<FolderPlus />}
          title="Bring in your projects"
          actions={
            <>
              <Button variant="primary" icon={<FolderSearch />} onClick={props.onImport}>
                Import projects
              </Button>
              <Button variant="secondary" icon={<Plus />} onClick={props.onAdd}>
                Add one project
              </Button>
              {(props.suggestionsCount ?? 0) > 0 && (
                <Button variant="secondary" onClick={props.onAdd}>
                  Review {props.suggestionsCount} suggestion{props.suggestionsCount === 1 ? "" : "s"}
                </Button>
              )}
            </>
          }
        >
          <p>Choose the folder you keep your code in (for example <code className="kit-tech">D:\code</code>) and DexNest imports every Git repository inside it in one click. Or add a single project, or drop folders anywhere on this window.</p>
          {(props.suggestionsCount ?? 0) > 0 && (
            <p>
              The repository scan found {props.suggestionsCount} repositor{props.suggestionsCount === 1 ? "y" : "ies"} you can add in one go.
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  let index = -1;
  return (
    <div className="projects">
      <PageHeader
        icon={<FolderGit2 />}
        title="Projects"
        subtitle={headerSummary(entries, now, staleDays)}
        accent="dev"
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw />} onClick={props.onFetchAll} title="Fetch every project's remotes (network)">
              Fetch all
            </Button>
            <Button variant="ghost" icon={<Download />} onClick={props.onPullAll} title="Pull every clean project that can fast-forward">
              Pull all
            </Button>
            <Button variant="secondary" icon={<FolderSearch />} onClick={props.onImport} title="Import every repository inside a folder, in one go">
              Import projects
            </Button>
            <Button variant="primary" icon={<Plus />} onClick={props.onAdd}>
              Add project
            </Button>
          </>
        }
      />

      {props.legacyChanged && (
        <div className="projects-banner" role="status">
          <span>projects.json has changed since it was imported.</span>
          <Button size="sm" variant="secondary" onClick={props.onImportLegacy}>
            Import new projects
          </Button>
        </div>
      )}

      <div className="projects-toolbar" role="search">
        <div className="projects-search">
          <Search aria-hidden="true" />
          <label htmlFor="projects-search" className="kit-visually-hidden">
            Search projects
          </label>
          <input
            id="projects-search"
            ref={props.searchRef}
            type="search"
            placeholder="Search projects…"
            aria-keyshortcuts="/"
            value={filters.query}
            onChange={(e) => props.onFilters({ ...filters, query: e.target.value })}
          />
          <kbd className="projects-search__key" aria-hidden="true">
            /
          </kbd>
        </div>
        <label className="projects-filter">
          <span>Group</span>
          <select value={filters.group} onChange={(e) => props.onFilters({ ...filters, group: e.target.value })}>
            <option value="all">All</option>
            <option value="none">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="projects-filter">
          <span>Tag</span>
          <select value={filters.tag} onChange={(e) => props.onFilters({ ...filters, tag: e.target.value })}>
            <option value="all">All</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="projects-filter">
          <span>Status</span>
          <select value={filters.status} onChange={(e) => props.onFilters({ ...filters, status: e.target.value as HomeFilters["status"] })}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="projects-filter">
          <span>Sort</span>
          <select value={filters.sort} onChange={(e) => props.onFilters({ ...filters, sort: e.target.value === "name" ? "name" : "activity" })}>
            <option value="activity">Last activity</option>
            <option value="name">Name</option>
          </select>
        </label>
        <div className="projects-toolbar__end">
          <Button variant="ghost" size="sm" icon={<RefreshCw />} onClick={props.onRefresh} aria-label="Read git state again" title="Read git state again (no network)">
            Refresh
          </Button>
          <Segmented
            label="Layout"
            value={layout}
            onChange={props.onLayout}
            options={[
              { value: "grid", label: "Cards", icon: <LayoutGrid /> },
              { value: "list", label: "List", icon: <List /> }
            ]}
          />
        </div>
      </div>

      <div ref={gridRef}>
        {sections.length === 0 && <p className="projects-none">No projects match these filters.</p>}
        {sections.map((section) => (
          <section key={section.section} aria-labelledby={`projects-section-${section.section}`}>
            <SectionTitle id={`projects-section-${section.section}`} count={section.entries.length}>
              {filters.status === "archived" ? "Archived" : SECTION_TITLES[section.section]}
            </SectionTitle>
            <ul className={layout === "grid" ? "projects-grid" : "projects-list"}>
              {section.entries.map((entry) => {
                index += 1;
                const i = index;
                return (
                  <li key={entry.project.id}>
                    <ProjectCard
                      entry={entry as ViewEntry}
                      layout={layout}
                      now={now}
                      tabbable={i === Math.min(focused, flat.length - 1)}
                      nameRef={(node) => {
                        nameRefs.current[i] = node;
                      }}
                      onKeyDownName={onKeyDownName(i)}
                      onOpen={props.onOpen}
                      onQuick={props.onQuick}
                      onToggleFavourite={props.onToggleFavourite}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export interface ProjectsViewProps {
  bridge?: ProjectsBridge;
  /** The Run tab: the shell's registered-action runner and the Dev dashboard's command results. */
  runAction?(actionId: string, source?: string, params?: unknown): Promise<RunActionResult>;
  commandResults?: Readonly<Record<string, RunResultView>>;
  clearCommandResult?(actionId: string): Promise<void>;
  /** Projects changed (saved, archived...): the shell refreshes its own list (Deck, actions, search). */
  onProjectsChanged?(): void;
}

const FILTERS_KEY = "dexnest.projects.filters";

function loadFilters(): HomeFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    return raw ? { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<HomeFilters>), query: "" } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function hasDraggedFiles(event: DragEvent): boolean {
  return Boolean(event.dataTransfer && [...event.dataTransfer.types].includes("Files"));
}

export function ProjectsView({ bridge: given, runAction, commandResults, clearCommandResult, onProjectsChanged }: ProjectsViewProps) {
  const bridge = useMemo(() => given ?? getProjectsBridge(), [given]);
  const [summaries, setSummaries] = useState<ProjectSummary[] | null>(null);
  const [states, setStates] = useState<Record<string, RepoState | { error: string }>>({});
  const [settings, setSettings] = useState<ProjectsSettings | null>(null);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<HomeFilters>(loadFilters);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [legacyChanged, setLegacyChanged] = useState(false);
  const [suggestionsCount, setSuggestionsCount] = useState(0);
  const [wizard, setWizard] = useState<{ open: boolean; path: string | null }>({ open: false, path: null });
  const [importer, setImporter] = useState<{ open: boolean; roots: string[] | null }>({ open: false, roots: null });
  const importerOpen = useRef(false);
  importerOpen.current = importer.open;
  const [dragging, setDragging] = useState(false);
  const [operation, setOperation] = useState<{ projectId: string; name: string; request: Record<string, unknown>; key: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const readStates = useCallback(
    async (ids?: string[]) => {
      try {
        const next = await bridge.projectsRepoStates(ids);
        setStates((current) => ({ ...current, ...next }));
        setNow(new Date().toISOString());
      } catch (e) {
        push("error", `Couldn't read git state: ${(e as Error).message}`);
      }
    },
    [bridge, push]
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, s, g] = await Promise.all([bridge.projectsList({ includeArchived: true }), bridge.projectsSettings(), bridge.projectsGroups()]);
      setSummaries(list);
      setSettings(s);
      setGroups(g);
      setNow(new Date().toISOString());
      void bridge.projectsLegacyChanged().then(setLegacyChanged, () => setLegacyChanged(false));
      if (list.every((x) => x.project.archivedAt !== null)) void bridge.projectsSuggestions().then((x) => setSuggestionsCount(x.length), () => setSuggestionsCount(0));
      void readStates();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bridge, readStates]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening Projects is when the watched folders are looked in (not more than every ten minutes, and never on a timer).
  // Once per opening: the look itself adds the projects, so its answer must not be dropped
  // (React runs an effect twice in development, and the second look would find nothing new).
  const watchChecked = useRef(false);
  useEffect(() => {
    if (watchChecked.current) return;
    watchChecked.current = true;
    void (bridge.projectsCheckWatched?.() ?? Promise.resolve(null)).then(
      (check) => {
        const message = watchCheckMessage(check);
        if (!message) return;
        push("success", message);
        void load();
      },
      () => undefined
    );
  }, [bridge]);

  // Window focus: re-read git state, at most once every 2 s. No timers otherwise.
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      void readStates();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readStates]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...filters, query: "" }));
    } catch {
      // Remembering filters is a convenience only.
    }
  }, [filters]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isSearchShortcut(event.key, target?.tagName, Boolean(target?.isContentEditable)) && !operation && !wizard.open && !importer.open) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [operation, wizard.open, importer.open]);

  // Drop a folder anywhere on the window -> the wizard, already inspecting it.
  // Several folders, or any drop while Import is open -> Import, looking inside them.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      const paths = files.map((file) => (bridge.projectsPathForFile ? bridge.projectsPathForFile(file) : null)).filter((p): p is string => Boolean(p));
      if (paths.length === 0) push("error", "DexNest couldn't read the dropped folder's path. Use Choose folder instead.");
      else if (importerOpen.current || paths.length > 1) setImporter({ open: true, roots: paths });
      else setWizard({ open: true, path: paths[0]! });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [bridge, push]);

  const entries: ViewEntry[] = useMemo(
    () =>
      (summaries ?? []).map(({ project }) => {
        const state = states[project.id];
        return {
          project,
          state: state && "isRepo" in state ? state : null,
          readError: state && "error" in state ? state.error : undefined,
          busy: busy.has(project.id)
        };
      }),
    [summaries, states, busy]
  );

  const finished = (projectId: string) => (result: ExecuteResult) => {
    setBusy((b) => {
      const next = new Set(b);
      next.delete(projectId);
      return next;
    });
    if (result.status === "done") push(result.outcome === "succeeded" ? "success" : "error", result.message);
    setVersion((v) => v + 1);
    void readStates([projectId]);
  };

  const quick = async (entry: ViewEntry, action: QuickActionId) => {
    const p = entry.project;
    if (action === "vscode" || action === "terminal") {
      const outcome = await bridge.projectsOpen(p.id, action);
      push(outcome.ok ? "success" : "error", outcome.message);
      return;
    }
    // Fetch, pull and push all open the operation dialog: nothing runs without its preview.
    setBusy((b) => new Set(b).add(p.id));
    setOperation({ projectId: p.id, name: p.name, request: { kind: action }, key: Date.now() });
  };

  const changed = () => {
    void load();
    onProjectsChanged?.();
  };
  const selectedProject = selected ? summaries?.find((x) => x.project.id === selected)?.project ?? null : null;

  if (error) return <ErrorState title="Projects couldn't load" message={error} onRetry={() => void load()} />;
  if (summaries === null || settings === null) return <LoadingState label="Loading projects" rows={6} />;

  const dialogs = (
    <>
      {operation && (
        <OperationDialog
          key={operation.key}
          bridge={bridge}
          projectId={operation.projectId}
          projectName={operation.name}
          request={operation.request}
          onClose={() => {
            setBusy((b) => {
              const next = new Set(b);
              next.delete(operation.projectId);
              return next;
            });
            setOperation(null);
          }}
          onFinished={finished(operation.projectId)}
          onRequest={(request) => setOperation({ ...operation, request, key: Date.now() })}
          onOpenTerminal={() => void bridge.projectsOpen(operation.projectId, "terminal").then((o) => push(o.ok ? "success" : "error", o.message))}
        />
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );

  if (selectedProject) {
    return (
      <>
        <ProjectDetail
          bridge={bridge}
          project={selectedProject}
          groups={groups}
          now={now}
          staleDays={settings.staleDays}
          version={version}
          dialogOpen={operation !== null}
          commandResults={commandResults ?? {}}
          runAction={async (actionId, params) => (runAction ? runAction(actionId, "module_ui", params) : { ok: false, error: "Commands run in the desktop app only." })}
          clearCommandResult={async (actionId) => clearCommandResult?.(actionId)}
          onBack={() => setSelected(null)}
          onAsk={(request) => {
            setBusy((b) => new Set(b).add(selectedProject.id));
            setOperation({ projectId: selectedProject.id, name: selectedProject.name, request, key: Date.now() });
          }}
          onToast={push}
          onChanged={changed}
          onGroups={setGroups}
        />
        {dialogs}
      </>
    );
  }

  return (
    <>
      <ProjectsHome
        entries={entries}
        groups={groups}
        filters={filters}
        layout={settings.layout}
        now={now}
        staleDays={settings.staleDays}
        legacyChanged={legacyChanged}
        suggestionsCount={suggestionsCount}
        searchRef={searchRef}
        onFilters={setFilters}
        onLayout={(layout) => void bridge.projectsUpdateSettings({ layout }).then(setSettings)}
        onAdd={() => setWizard({ open: true, path: null })}
        onImport={() => setImporter({ open: true, roots: null })}
        onFetchAll={async () => {
          push("info", "Fetching all projects…");
          const outcome = await bridge.projectsFetchAll();
          push(outcome.ok ? "success" : "error", outcome.message);
          void readStates();
        }}
        onPullAll={async () => {
          const outcome = await bridge.projectsPullAll();
          push(outcome.ok ? "success" : "error", outcome.message);
          void readStates();
        }}
        onRefresh={() => void readStates()}
        onImportLegacy={async () => {
          const result = await bridge.projectsImportLegacy();
          push(result.kind === "imported" ? "success" : "error", result.kind === "imported" ? `Imported ${result.added.length} new project(s).` : result.kind === "absent" ? "projects.json is gone." : result.reason);
          void load();
        }}
        onOpen={(entry) => {
          void bridge.projectsTouch(entry.project.id).catch(() => undefined);
          setSelected(entry.project.id);
        }}
        onQuick={(entry, action) => void quick(entry, action)}
        onToggleFavourite={async (entry) => {
          const result = await bridge.projectsUpdate(entry.project.id, { favourite: !entry.project.favourite });
          if (!result.ok) push("error", result.reason);
          changed();
        }}
      />
      {wizard.open && (
        <AddProjectWizard
          bridge={bridge}
          groups={groups}
          initialPath={wizard.path}
          dragging={dragging}
          onClose={() => setWizard({ open: false, path: null })}
          onAdded={(message) => {
            setWizard({ open: false, path: null });
            push("success", message);
            changed();
          }}
          onOpenExisting={(projectId) => {
            setWizard({ open: false, path: null });
            setSelected(projectId);
          }}
        />
      )}
      {importer.open && (
        <ImportProjectsDialog
          bridge={bridge}
          initialRoots={importer.roots}
          rememberedRoots={settings.importRoots ?? []}
          watchedRoots={settings.watchedRoots ?? []}
          onWatch={(root, on) => void bridge.projectsUpdateSettings({ watchedRoots: toggleWatched(settings.watchedRoots ?? [], root, on) }).then(setSettings, () => undefined)}
          dragging={dragging}
          onClose={() => setImporter({ open: false, roots: null })}
          onImported={(message) => {
            push("success", message);
            changed();
            void bridge.projectsSettings().then(setSettings, () => undefined);
          }}
        />
      )}
      {dragging && !wizard.open && !importer.open && (
        <div className="projects-dropzone" aria-hidden="true">
          Drop a folder to add it as a project
        </div>
      )}
      {dialogs}
    </>
  );
}
