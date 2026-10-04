// One project: header with quick actions, then Overview, Branches, Changes,
// History, Run, Links and Settings. Keyboard: F fetch, P pull, U push (each
// opens the operation dialog), 1-7 switch tabs, Esc goes back.
//
// Git state is read when the project opens, when the window regains focus,
// and whenever `version` changes (after every operation) - never on a timer.

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Code2, Download, ExternalLink, FolderOpen, RefreshCw, SquareTerminal, Upload } from "lucide-react";

import type { DiffStat, HistoryEntry, LeftOff, OperationRecord, ProjectGroup } from "@dexnest/projects";
import { fetchedAgoText, githubLinks, projectBadge, type Project, type RepoState } from "@dexnest/projects/domain";
import { Badge, Button, Dialog, TabPanel, Tabs, Technical } from "../../components/ui/kit";
import { PinButton } from "../../components/pins";
import { BranchesTab, ChangesTab, HistoryTab, LinksTab, OverviewTab, RunTab, SettingsTab, type RunResultView } from "./DetailTabs";
import type { ProjectsBridge } from "./projectsBridge";
import { availability, detailShortcut, DETAIL_TABS, inputFromForm, operationLines, projectTypeLabel, type DetailTab, type LifecycleAction, type OperationRequestLike, type RunCommand } from "./projectsModel";

export interface RunActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface ProjectDetailProps {
  bridge: ProjectsBridge;
  project: Project;
  groups: readonly ProjectGroup[];
  now: string;
  staleDays: number;
  /** Bumped after every operation: re-read git state. */
  version: number;
  /** A dialog is open over the view: shortcuts pause. */
  dialogOpen: boolean;
  commandResults: Readonly<Record<string, RunResultView>>;
  runAction(actionId: string, params?: Record<string, unknown>): Promise<RunActionResult>;
  clearCommandResult(actionId: string): Promise<void>;
  onBack(): void;
  onAsk(request: OperationRequestLike): void;
  onToast(tone: "success" | "error" | "info", text: string): void;
  onChanged(): void;
  onGroups(groups: ProjectGroup[]): void;
}

type Pending = { title: string; body: string; action: () => void } | null;

export function ProjectDetail(props: ProjectDetailProps) {
  const { bridge, project, now } = props;
  const [tab, setTab] = useState<DetailTab>("overview");
  const [state, setState] = useState<RepoState | null>(null);
  const [allBranches, setAllBranches] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [stat, setStat] = useState<DiffStat | null>(null);
  const [ops, setOps] = useState<OperationRecord[]>([]);
  const [leftOff, setLeftOff] = useState<LeftOff | null | undefined>(undefined);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([bridge.projectsRepoState(project.id, { allBranches }), bridge.projectsOperations(project.id)]);
      setState(s);
      setOps(o);
    } catch (e) {
      props.onToast("error", `Couldn't read git state: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, project.id, allBranches]);

  useEffect(() => {
    void read();
  }, [read, props.version]);

  useEffect(() => {
    void bridge.projectsLeftOff(project.id).then(setLeftOff, () => setLeftOff(null));
  }, [bridge, project.id]);

  useEffect(() => {
    if (tab === "history") void bridge.projectsHistory(project.id, 100).then(setHistory, () => setHistory([]));
    if (tab === "changes") void bridge.projectsDiffStat(project.id).then(setStat, () => setStat(null));
  }, [bridge, project.id, tab, props.version]);

  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      void read();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [read]);

  const ask = useCallback(
    (request: OperationRequestLike) => {
      const reason = availability(state, request);
      if (reason) props.onToast("info", reason);
      else props.onAsk(request);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, props.onAsk, props.onToast]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (props.dialogOpen || pending) return;
      const target = event.target as HTMLElement | null;
      const shortcut = detailShortcut(event.key, target?.tagName, Boolean(target?.isContentEditable), event.ctrlKey || event.metaKey || event.altKey);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.kind === "back") props.onBack();
      else if (shortcut.kind === "tab") setTab(shortcut.tab);
      else ask(shortcut.request);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, pending, props]);

  const open = async (target: "vscode" | "terminal" | "folder" | "github", options: { path?: string; branch?: string; base?: string } = {}) => {
    const outcome = await bridge.projectsOpen(project.id, target, options);
    props.onToast(outcome.ok ? "success" : "error", outcome.message);
  };

  /** Marks the deployed branch (or none). A project setting, not a git operation: nothing in the repository changes. */
  const setDeployed = async (branch: string | null) => {
    const result = await bridge.projectsUpdate(project.id, { deployedBranch: branch });
    if (result.ok) {
      props.onToast("success", branch ? `${branch} is marked as the deployed branch.` : "No branch is marked as deployed.");
      props.onChanged();
      void read();
    } else props.onToast("error", result.reason);
  };

  const run = async (actionId: string, params: Record<string, unknown> = {}) => {
    setRunning((r) => new Set(r).add(actionId));
    try {
      const result = await props.runAction(actionId, params);
      props.onToast(result.ok ? "success" : "error", result.message ?? result.error ?? (result.ok ? "Done." : "That didn't work."));
    } finally {
      // A command or lifecycle action may have changed the repository (a build
      // that writes files, the old git_push): read git state again, as the
      // old Dev view did after every action.
      void read();
      setRunning((r) => {
        const next = new Set(r);
        next.delete(actionId);
        return next;
      });
    }
  };

  const onRun = (command: RunCommand) => {
    if (command.confirm) {
      setPending({
        title: `Run ${command.label}?`,
        body: `${command.command}\n\nThis command is marked "ask before running", or looks destructive.`,
        action: () => void run(command.actionId, { confirmedDangerous: true })
      });
    } else void run(command.actionId);
  };
  const onLifecycle = (action: LifecycleAction) => {
    const actionId = `dev.project.${project.id}.${action.op}`;
    if (action.dangerous) {
      setPending({ title: `${action.label} ${project.name}?`, body: "This stops or kills processes for this project.", action: () => void run(actionId, { confirmedDangerous: true }) });
    } else void run(actionId);
  };

  const badge = projectBadge(state);
  const typeLabel = projectTypeLabel(project.projectType);
  const gh = githubLinks(project.git.remoteUrl);
  const repo = state?.isRepo ? state : null;
  const tabs = DETAIL_TABS.map((t) => ({
    ...t,
    badge:
      t.id === "changes" && repo && repo.workingTree.counts.staged + repo.workingTree.counts.unstaged + repo.workingTree.counts.untracked + repo.workingTree.counts.conflicted > 0 ? (
        <span className="projects-tab-count">{repo.workingTree.counts.staged + repo.workingTree.counts.unstaged + repo.workingTree.counts.untracked + repo.workingTree.counts.conflicted}</span>
      ) : undefined
  }));

  return (
    <div className="projects projects-detail">
      <div className="projects-detail__top">
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={props.onBack} title="Back to Projects (Esc)">
          Projects
        </Button>
      </div>
      <header className="projects-detail__header">
        <div className="projects-detail__identity">
          <h1 className="projects-detail__name">{project.name}</h1>
          <Badge tone={badge.tone}>{badge.text}</Badge>
          {typeLabel && <Badge tone="neutral">{typeLabel}</Badge>}
          {repo && <Technical className="projects-detail__branch">{repo.head.detached ? `detached ${(repo.head.sha ?? "").slice(0, 7)}` : repo.head.branch}</Technical>}
          <PinButton input={{ type: "project", module: "dev", entityId: project.id, title: project.name, subtitle: "Project", actionId: `dev.project.${project.id}.open_folder` }} />
        </div>
        <p className="projects-detail__path">
          <Technical title={project.path}>{project.path}</Technical>
          {repo && repo.remotes.length > 0 && <span className="projects-muted"> · {fetchedAgoText(repo.lastFetchAt, now)}</span>}
          {project.archivedAt && <Badge tone="warning">archived</Badge>}
        </p>
        <div className="projects-detail__actions">
          <Button variant="ghost" icon={<Code2 />} onClick={() => void open("vscode")}>
            VS Code
          </Button>
          <Button variant="ghost" icon={<SquareTerminal />} onClick={() => void open("terminal")}>
            Terminal
          </Button>
          <Button variant="ghost" icon={<FolderOpen />} onClick={() => void open("folder")}>
            Folder
          </Button>
          {gh && (
            <Button variant="ghost" icon={<ExternalLink />} onClick={() => void open("github")}>
              GitHub
            </Button>
          )}
          <span className="projects-detail__spacer" />
          <Button variant="secondary" icon={<RefreshCw />} disabledReason={availability(state, { kind: "fetch" })} onClick={() => ask({ kind: "fetch" })} title="Fetch (F)">
            Fetch
          </Button>
          <Button variant="secondary" icon={<Download />} disabledReason={availability(state, { kind: "pull" })} onClick={() => ask({ kind: "pull" })} title="Pull (P)">
            Pull
          </Button>
          <Button variant="secondary" icon={<Upload />} disabledReason={availability(state, { kind: "push" })} onClick={() => ask({ kind: "push" })} title="Push (U)">
            Push
          </Button>
        </div>
      </header>

      <Tabs label={`${project.name} sections`} tabs={tabs} value={tab} onChange={setTab} idPrefix="project-detail" />
      <TabPanel idPrefix="project-detail" id={tab}>
        {tab === "overview" && <OverviewTab project={project} state={state} leftOff={leftOff} operations={operationLines(ops)} now={now} onAsk={ask} />}
        {tab === "branches" && (
          <BranchesTab project={project} state={state} now={now} staleDays={props.staleDays} allBranches={allBranches} onShowAll={() => setAllBranches(true)} onAsk={ask} onOpenGithub={(branch, base) => void open("github", { branch, base })} onSetDeployed={(branch) => void setDeployed(branch)} />
        )}
        {tab === "changes" && <ChangesTab state={state} stat={stat} onAsk={ask} onOpenVsCode={() => void open("vscode")} />}
        {tab === "history" && <HistoryTab entries={history ?? []} now={now} loading={history === null} />}
        {tab === "run" && (
          <RunTab
            project={project}
            results={props.commandResults}
            running={running}
            now={now}
            onRun={onRun}
            onLifecycle={onLifecycle}
            onClear={(actionId) => void props.clearCommandResult(actionId)}
          />
        )}
        {tab === "links" && (
          <LinksTab
            project={project}
            onOpenApp={() => void run(`dev.project.${project.id}.open_url`)}
            onOpenLink={(url) => void run(`dev.project.${project.id}.open_link`, { url })}
            onOpenFolder={(path, target) => void open(target, { path })}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            key={project.updatedAt}
            project={project}
            groups={props.groups}
            saving={saving}
            saveError={saveError}
            onSave={async (form) => {
              setSaving(true);
              setSaveError(null);
              const result = await bridge.projectsUpdate(project.id, inputFromForm(form));
              setSaving(false);
              if (result.ok) {
                props.onToast("success", `Saved ${result.project.name}.`);
                props.onChanged();
              } else setSaveError(result.reason);
            }}
            onArchive={async () => {
              await bridge.projectsArchive(project.id);
              props.onToast("success", `Archived ${project.name}. Find it under Status: Archived.`);
              props.onChanged();
              props.onBack();
            }}
            onRestore={async () => {
              await bridge.projectsRestore(project.id);
              props.onToast("success", `Restored ${project.name}.`);
              props.onChanged();
            }}
            onRemove={() =>
              setPending({
                title: `Remove ${project.name} from DexNest?`,
                body: "Only DexNest's entry is removed. The folder and everything in it stay exactly as they are.",
                action: async () => {
                  await bridge.projectsRemove(project.id);
                  props.onToast("success", `Removed ${project.name} from DexNest.`);
                  props.onChanged();
                  props.onBack();
                }
              })
            }
            onAddGroup={async (name) => {
              const id = `group-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now()}`;
              props.onGroups(await bridge.projectsSaveGroup({ id, name, position: props.groups.length }));
            }}
          />
        )}
      </TabPanel>

      {pending && (
        <Dialog
          title={pending.title}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const action = pending.action;
                  setPending(null);
                  action();
                }}
              >
                Yes, continue
              </Button>
            </>
          }
        >
          <p className="projects-confirm-body">{pending.body}</p>
        </Dialog>
      )}
    </div>
  );
}
