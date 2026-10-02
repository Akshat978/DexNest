// The project detail's tabs (docs/modules/projects/PLAN.md 15.3). Each is a
// pure component over data its container loaded; anything that changes a
// repository goes through onOperation, i.e. the operation dialog.

import React, { useState } from "react";
import { Activity, Box, Code2, Cpu, ExternalLink, FileText, FolderOpen, GitBranch, Play, Plug, Power, RotateCcw, SquareTerminal, Undo2 } from "lucide-react";

import type { HistoryEntry, LeftOff, ProjectGroup } from "@dexnest/projects";
import { githubLinks, isDirty, projectBadge, type Project, type RepoState } from "@dexnest/projects/domain";
import { Badge, Button, Card, SectionTitle, Technical } from "../../components/kit";
import { ProjectFormFields } from "./ProjectForm";
import {
  availability,
  branchRows,
  changeRows,
  formFromProject,
  formProblems,
  inputFromForm,
  lifecycleActions,
  operationLabel,
  relativeTime,
  runCommands,
  stripAnsi,
  type ChangeRowView,
  type LifecycleAction,
  type OperationLine,
  type OperationRequestLike,
  type ProjectForm,
  type RunCommand
} from "./projectsModel";

export type Ask = (request: OperationRequestLike) => void;

// --- Overview -----------------------------------------------------------------------

export function OverviewTab({
  project,
  state,
  leftOff,
  operations,
  now,
  onAsk
}: {
  project: Project;
  state: RepoState | null;
  leftOff: LeftOff | null | undefined;
  operations: readonly OperationLine[];
  now: string;
  onAsk: Ask;
}) {
  const badge = projectBadge(state);
  const repo = state?.isRepo ? state : null;
  const current = repo?.branches.find((b) => b.isCurrent) ?? null;
  return (
    <div className="projects-detail__grid">
      <Card className="projects-detail__card">
        <SectionTitle>Status</SectionTitle>
        <dl className="projects-facts">
          <dt>State</dt>
          <dd>
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </dd>
          {repo && (
            <>
              <dt>Branch</dt>
              <dd>
                <Technical>{repo.head.detached ? `detached at ${(repo.head.sha ?? "").slice(0, 7)}` : repo.head.branch ?? "-"}</Technical>
              </dd>
              <dt>Upstream</dt>
              <dd>
                {current?.upstream ? (
                  <>
                    <Technical>{current.upstream.ref}</Technical>
                    {current.upstream.counts && ` · ${current.upstream.counts.ahead} ahead · ${current.upstream.counts.behind} behind`}
                    {current.upstream.gone && " · gone on the remote"}
                  </>
                ) : (
                  "none"
                )}
              </dd>
              <dt>Changes</dt>
              <dd>{isDirty(repo.workingTree) ? `${repo.workingTree.counts.staged} staged · ${repo.workingTree.counts.unstaged} changed · ${repo.workingTree.counts.untracked} new` : "clean"}</dd>
              <dt>Stashes</dt>
              <dd>{repo.stashes.length}</dd>
              {repo.inProgress && (
                <>
                  <dt>In progress</dt>
                  <dd>
                    <Badge tone="error">{repo.inProgress.replace("_", "-")}</Badge> finish or abort it in a terminal
                  </dd>
                </>
              )}
              <dt>Last commit</dt>
              <dd>{repo.lastCommit ? `${repo.lastCommit.subject} · ${relativeTime(repo.lastCommit.committedAt, now)}` : "none yet"}</dd>
              <dt>Default branch</dt>
              <dd>
                <Technical>{repo.defaultBranch ?? "unknown"}</Technical>
              </dd>
            </>
          )}
          {!repo && state && !state.isRepo && (
            <>
              <dt>Git</dt>
              <dd>{state.reason}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card className="projects-detail__card">
        <SectionTitle>Where you left off</SectionTitle>
        {leftOff === undefined ? (
          <p className="projects-muted">Asking Developer Intelligence…</p>
        ) : leftOff === null ? (
          <p className="projects-muted">Developer Intelligence has nothing on this repository yet (it's turned off, or hasn't scanned it).</p>
        ) : (
          <>
            <p className="projects-leftoff">{leftOff.reason}</p>
            {leftOff.latestActivityAt && <p className="projects-muted">Last activity {relativeTime(leftOff.latestActivityAt, now)}</p>}
            {leftOff.evidence.length > 0 && (
              <ul className="projects-evidence">
                {leftOff.evidence.map((e) => (
                  <li key={e}>
                    <Technical>{e}</Technical>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {repo && repo.worktrees.length > 1 && (
        <Card className="projects-detail__card">
          <SectionTitle count={repo.worktrees.length}>Worktrees</SectionTitle>
          <ul className="projects-rows">
            {repo.worktrees.map((w) => (
              <li key={w.path}>
                <Technical title={w.path}>{w.branch ?? "(detached)"}</Technical>
                {w.owner === "autopilot" && <Badge tone="accent">Autopilot</Badge>}
                {w.isCurrent && <Badge tone="neutral">this one</Badge>}
                <Technical className="projects-muted projects-ellipsis" title={w.path}>
                  {w.path}
                </Technical>
              </li>
            ))}
          </ul>
          {repo.worktrees.some((w) => w.owner === "autopilot") && <p className="projects-muted">DexNest never touches a branch checked out in an Autopilot worktree.</p>}
        </Card>
      )}

      {repo && repo.submodules.length > 0 && (
        <Card className="projects-detail__card">
          <SectionTitle count={repo.submodules.length}>Submodules</SectionTitle>
          <ul className="projects-rows">
            {repo.submodules.map((s) => (
              <li key={s}>
                <Technical>{s}</Technical>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="projects-detail__card">
        <SectionTitle>Recent operations</SectionTitle>
        {operations.length === 0 ? (
          <p className="projects-muted">Nothing yet. Fetch, pull, push and everything else you do here is listed.</p>
        ) : (
          <ul className="projects-rows">
            {operations.slice(0, 8).map((op) => (
              <li key={op.id}>
                <span className="projects-op-verb">{operationLabel(op.verb)}</span>
                <Badge tone={op.outcome === "succeeded" ? "success" : op.state === "refused" ? "neutral" : op.outcome === "auth_needed" ? "warning" : "error"}>{op.undone ? "undone" : op.outcome ?? op.state}</Badge>
                <span className="projects-muted">{relativeTime(op.startedAt, now)}</span>
                {op.undoable && (
                  <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => onAsk({ kind: "undo", opId: op.id })}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(project.description || project.notes || project.tags.length > 0) && (
        <Card className="projects-detail__card">
          <SectionTitle>About</SectionTitle>
          {project.description && <p>{project.description}</p>}
          {project.tags.length > 0 && (
            <ul className="projects-card__tags" aria-label="Tags">
              {project.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {project.notes && <p className="projects-notes">{project.notes}</p>}
        </Card>
      )}
    </div>
  );
}

// --- Branches -------------------------------------------------------------------------

export function BranchesTab({
  project,
  state,
  now,
  staleDays,
  allBranches,
  onShowAll,
  onAsk,
  onOpenGithub
}: {
  project: Project;
  state: RepoState | null;
  now: string;
  staleDays: number;
  allBranches: boolean;
  onShowAll(): void;
  onAsk: Ask;
  onOpenGithub(branch: string, base?: string): void;
}) {
  const [newBranch, setNewBranch] = useState("");
  const rows = branchRows(state, now, staleDays);
  const gh = githubLinks(project.git.remoteUrl);
  const repo = state?.isRepo ? state : null;
  const defaultBranch = repo?.defaultBranch ?? null;
  if (!repo) return <p className="projects-muted">{state && !state.isRepo ? state.reason : "Reading git state…"}</p>;
  const create = availability(state, { kind: "create_branch", name: newBranch.trim() || "x", switchTo: true });
  return (
    <div className="projects-branches">
      <form
        className="projects-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newBranch.trim()) onAsk({ kind: "create_branch", name: newBranch.trim(), switchTo: true });
        }}
      >
        <label htmlFor="projects-new-branch">New branch from {repo.head.branch ?? "HEAD"}</label>
        <input id="projects-new-branch" className="kit-tech" value={newBranch} placeholder="feature/my-change" onChange={(e) => setNewBranch(e.target.value)} />
        <Button type="submit" variant="secondary" icon={<GitBranch />} disabledReason={!newBranch.trim() ? "Type a branch name." : create}>
          Create and switch
        </Button>
      </form>
      <div className="projects-table-wrap">
        <table className="projects-table">
          <caption className="kit-visually-hidden">Branches</caption>
          <thead>
            <tr>
              <th scope="col">Branch</th>
              <th scope="col">Upstream</th>
              <th scope="col">vs upstream</th>
              <th scope="col">vs {defaultBranch ?? "default"}</th>
              <th scope="col">Last commit</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="kit-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const local = row.kind === "local";
              const switchReq = local ? { kind: "switch", branch: row.name } : { kind: "switch", branch: row.name, remote: row.remote ?? undefined };
              const pushReq = row.upstream && !row.upstream.endsWith("(gone)") ? { kind: "push", branch: row.name } : { kind: "push", branch: row.name, setUpstream: true };
              const deleteReq = local ? { kind: "delete_branch", name: row.name } : { kind: "delete_remote_branch", remote: row.remote ?? "origin", name: row.name };
              return (
                <tr key={row.key} className={row.current ? "projects-table__current" : undefined}>
                  <th scope="row">
                    <Technical>{row.name}</Technical>
                  </th>
                  <td>{row.upstream ? <Technical>{row.upstream}</Technical> : <span className="projects-muted">-</span>}</td>
                  <td>{row.vsUpstream}</td>
                  <td>{row.vsDefault}</td>
                  <td>
                    <span className="projects-ellipsis" title={row.subject ?? undefined}>
                      {row.subject}
                    </span>
                    <span className="projects-muted"> · {relativeTime(row.lastCommitAt, now)}</span>
                  </td>
                  <td className="projects-table__state">
                    <span>
                    {row.current && <Badge tone="accent">current</Badge>}
                    {row.kind === "remote" && <Badge tone="info">remote only</Badge>}
                    {row.merged === true && !row.current && <Badge tone="success">merged</Badge>}
                    {row.merged === false && <Badge tone="neutral">not merged</Badge>}
                    {row.stale && <Badge tone="warning">stale</Badge>}
                    {row.elsewhere && <Badge tone="accent">{row.elsewhere === "autopilot" ? "Autopilot worktree" : "other worktree"}</Badge>}
                    </span>
                  </td>
                  <td className="projects-table__actions">
                    <span>
                    {!row.current && (
                      <Button size="sm" variant="ghost" disabledReason={availability(state, switchReq)} onClick={() => onAsk(switchReq)}>
                        {local ? "Switch" : "Check out"}
                      </Button>
                    )}
                    {local && (
                      <Button size="sm" variant="ghost" disabledReason={availability(state, pushReq)} onClick={() => onAsk(pushReq)}>
                        {pushReq.setUpstream ? "Push + upstream" : "Push"}
                      </Button>
                    )}
                    {row.name !== defaultBranch && (
                      <Button size="sm" variant="ghost" disabledReason={availability(state, deleteReq)} onClick={() => onAsk(deleteReq)}>
                        {local ? "Delete…" : "Delete remote…"}
                      </Button>
                    )}
                    {gh && (
                      <Button size="sm" variant="ghost" icon={<ExternalLink />} aria-label={`${row.name} on GitHub`} title="Open on GitHub" onClick={() => onOpenGithub(row.name, row.name !== defaultBranch && defaultBranch ? defaultBranch : undefined)} />
                    )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!allBranches && (
        <Button size="sm" variant="ghost" onClick={onShowAll}>
          Compare all branches with {defaultBranch ?? "the default branch"}
        </Button>
      )}
      <p className="projects-muted">Remote branches are as of the last fetch. A branch checked out in another worktree (Autopilot's) is never switched, pushed or deleted.</p>
    </div>
  );
}

// --- Changes ---------------------------------------------------------------------------

const GROUP_TITLES: Record<ChangeRowView["group"], string> = { conflicted: "Conflicts", staged: "Staged", unstaged: "Changed", untracked: "New files" };

export function ChangesTab({
  state,
  stat,
  onAsk,
  onOpenVsCode
}: {
  state: RepoState | null;
  stat: Parameters<typeof changeRows>[1];
  onAsk: Ask;
  onOpenVsCode(): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const rows = changeRows(state, stat);
  const repo = state?.isRepo ? state : null;
  if (!repo) return <p className="projects-muted">{state && !state.isRepo ? state.reason : "Reading git state…"}</p>;
  const chosen = [...selected].filter((p) => rows.some((r) => r.path === p && r.group !== "conflicted"));
  const toggle = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const commitReq = { kind: "commit", message: message.trim() || "x", files: chosen.length > 0 ? chosen : "all" } as const;
  const commitReason = !message.trim() ? "Write a commit message first." : availability(state, commitReq);
  const groups = (["conflicted", "staged", "unstaged", "untracked"] as const).map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0);
  return (
    <div className="projects-changes">
      {rows.length === 0 && <p className="projects-muted">No uncommitted changes. Everything is committed.</p>}
      {groups.map(({ group, rows: list }) => (
        <section key={group} aria-labelledby={`projects-changes-${group}`}>
          <SectionTitle id={`projects-changes-${group}`} count={list.length}>
            {GROUP_TITLES[group]}
          </SectionTitle>
          {group === "conflicted" && (
            <p className="projects-muted">
              Resolve conflicts in your editor; DexNest won't pick sides.{" "}
              <Button size="sm" variant="ghost" icon={<Code2 />} onClick={onOpenVsCode}>
                Open in VS Code
              </Button>
            </p>
          )}
          <ul className="projects-files">
            {list.map((row) => (
              <li key={`${group}:${row.path}`}>
                {group === "conflicted" ? (
                  <span className="projects-files__status projects-files__status--U">U</span>
                ) : (
                  <input type="checkbox" aria-label={`Select ${row.path}`} checked={selected.has(row.path)} onChange={() => toggle(row.path)} />
                )}
                {group !== "conflicted" && <span className={`projects-files__status projects-files__status--${row.status === "?" ? "N" : row.status}`}>{row.status}</span>}
                <Technical className="projects-files__path" title={row.from ? `${row.from} → ${row.path}` : row.path}>
                  {row.from ? `${row.from} → ${row.path}` : row.path}
                </Technical>
                {(row.added !== null || row.deleted !== null) && (
                  <span className="projects-files__stat">
                    <span className="projects-files__add">+{row.added}</span> <span className="projects-files__del">-{row.deleted}</span>
                  </span>
                )}
                {row.added === null && row.deleted === null && row.group !== "untracked" && row.group !== "conflicted" && stat && <span className="projects-muted">binary</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {rows.length > 0 && (
        <Card className="projects-commit">
          <label htmlFor="projects-commit-message">Commit message</label>
          <textarea id="projects-commit-message" rows={3} value={message} placeholder="Describe the change" onChange={(e) => setMessage(e.target.value)} />
          <div className="projects-commit__actions">
            <Button variant="primary" disabledReason={commitReason} onClick={() => onAsk({ ...commitReq, message })}>
              {chosen.length > 0 ? `Commit ${chosen.length} selected` : "Commit all"}
            </Button>
            <Button variant="ghost" disabledReason={availability(state, { kind: "stash" })} onClick={() => onAsk({ kind: "stash" })}>
              Stash all
            </Button>
            <Button variant="danger" disabledReason={chosen.length === 0 ? "Select the files to discard." : availability(state, { kind: "discard", files: chosen })} onClick={() => onAsk({ kind: "discard", files: chosen })}>
              Discard selected…
            </Button>
          </div>
        </Card>
      )}

      {repo.stashes.length > 0 && (
        <section aria-labelledby="projects-stashes">
          <SectionTitle id="projects-stashes" count={repo.stashes.length}>
            Stashes
          </SectionTitle>
          <ul className="projects-rows">
            {repo.stashes.map((s) => (
              <li key={s.sha}>
                <Technical>{`stash@{${s.index}}`}</Technical>
                <span className="projects-ellipsis" title={s.message}>
                  {s.message}
                </span>
                {s.files && <span className="projects-muted">{s.files.length} file{s.files.length === 1 ? "" : "s"}</span>}
                <Button size="sm" variant="ghost" disabledReason={availability(state, { kind: "stash_pop", index: s.index, sha: s.sha })} onClick={() => onAsk({ kind: "stash_pop", index: s.index, sha: s.sha })}>
                  Pop
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --- History ---------------------------------------------------------------------------

export function HistoryTab({ entries, now, loading }: { entries: readonly HistoryEntry[]; now: string; loading: boolean }) {
  if (loading) return <p className="projects-muted">Reading history…</p>;
  if (entries.length === 0) return <p className="projects-muted">No commits yet.</p>;
  return (
    <ol className="projects-history">
      {entries.map((c) => (
        <li key={c.sha}>
          <Technical className="projects-history__sha" title={c.sha}>
            {c.sha.slice(0, 7)}
          </Technical>
          <span className="projects-history__subject" title={c.subject}>
            {c.subject}
          </span>
          <span className="projects-muted">{c.author}</span>
          <span className="projects-muted">{relativeTime(c.committedAt, now)}</span>
          <Badge tone={c.onRemote ? "success" : "warning"}>{c.onRemote ? "pushed" : "local"}</Badge>
        </li>
      ))}
    </ol>
  );
}

// --- Run --------------------------------------------------------------------------------

export interface RunResultView {
  actionId: string;
  projectId: string;
  status: "idle" | "running" | "success" | "failed";
  stdout: string;
  stderr: string;
  summary: string;
  durationMs: number | null;
  finishedAt: string | null;
  errorMessage?: string | null;
  commandKey?: string;
}

const LIFECYCLE_ICONS: Record<LifecycleAction["op"], React.ReactNode> = {
  stop: <Power />,
  restart: <RotateCcw />,
  check_health: <Activity />,
  kill_ports: <Plug />,
  show_processes: <Cpu />,
  docker_down: <Box />,
  open_logs: <FileText />,
  open_urls: <ExternalLink />
};

export function RunTab({
  project,
  results,
  running,
  now,
  onRun,
  onLifecycle,
  onClear
}: {
  project: Project;
  results: Readonly<Record<string, RunResultView>>;
  running: ReadonlySet<string>;
  now: string;
  onRun(command: RunCommand): void;
  onLifecycle(action: LifecycleAction): void;
  onClear(actionId: string): void;
}) {
  const commands = runCommands(project);
  const lifecycle = lifecycleActions(project);
  const runs = Object.values(results)
    .filter((r) => r.projectId === project.id && r.finishedAt)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  const latest = runs[0];
  return (
    <div className="projects-run">
      <section aria-labelledby="projects-run-commands">
        <SectionTitle id="projects-run-commands" count={commands.length}>
          Commands
        </SectionTitle>
        {commands.length === 0 ? (
          <p className="projects-muted">No commands yet. Add them in Settings.</p>
        ) : (
          <ul className="projects-commands">
            {commands.map((c) => (
              <li key={c.actionId}>
                <Button variant="secondary" icon={<Play />} disabledReason={running.has(c.actionId) ? "Running…" : null} title={c.command} onClick={() => onRun(c)}>
                  {c.label}
                  {c.confirm && <span className="projects-asks"> · asks first</span>}
                </Button>
                <Technical className="projects-muted projects-ellipsis" title={c.command}>
                  {c.command}
                </Technical>
              </li>
            ))}
          </ul>
        )}
      </section>

      {lifecycle.length > 0 && (
        <section aria-labelledby="projects-run-lifecycle">
          <SectionTitle id="projects-run-lifecycle" action={project.ports.length > 0 ? <Technical className="projects-muted">ports {project.ports.join(", ")}</Technical> : undefined}>
            Lifecycle
          </SectionTitle>
          <div className="projects-lifecycle">
            {lifecycle.map((a) => (
              <Button key={a.op} variant={a.dangerous ? "danger" : "ghost"} icon={LIFECYCLE_ICONS[a.op]} disabledReason={running.has(`dev.project.${project.id}.${a.op}`) ? "Running…" : null} onClick={() => onLifecycle(a)}>
                {a.label}
                {a.dangerous ? "…" : ""}
              </Button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="projects-run-output">
        <SectionTitle
          id="projects-run-output"
          action={
            latest && (
              <Button size="sm" variant="ghost" onClick={() => onClear(latest.actionId)}>
                Clear
              </Button>
            )
          }
        >
          Output
        </SectionTitle>
        {!latest ? (
          <p className="projects-muted">Run a command to see its output here.</p>
        ) : (
          <Card className="projects-output">
            <p className="projects-output__head">
              <Badge tone={latest.status === "success" ? "success" : latest.status === "failed" ? "error" : "info"}>{latest.status}</Badge>
              <Technical>{latest.actionId.split(".").at(-1)}</Technical>
              {latest.durationMs !== null && <span className="projects-muted">{(latest.durationMs / 1000).toFixed(1)} s</span>}
              <span className="projects-muted">{relativeTime(latest.finishedAt, now)}</span>
            </p>
            <p>{latest.summary}</p>
            {latest.errorMessage && <p className="projects-output__error">{latest.errorMessage}</p>}
            {(latest.stdout || latest.stderr) && <pre className="projects-op__log">{stripAnsi([latest.stdout, latest.stderr].filter(Boolean).join("\n\n"))}</pre>}
          </Card>
        )}
      </section>

      {runs.length > 1 && (
        <section aria-labelledby="projects-run-recent">
          <SectionTitle id="projects-run-recent">Recent runs</SectionTitle>
          <ul className="projects-rows">
            {runs.slice(0, 6).map((r) => (
              <li key={r.actionId}>
                <Badge tone={r.status === "success" ? "success" : "error"}>{r.status}</Badge>
                <Technical>{r.actionId.split(".").at(-1)}</Technical>
                <span className="projects-ellipsis">{r.summary}</span>
                <span className="projects-muted">{relativeTime(r.finishedAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --- Links -------------------------------------------------------------------------------

export function LinksTab({
  project,
  onOpenApp,
  onOpenLink,
  onOpenFolder
}: {
  project: Project;
  onOpenApp(): void;
  onOpenLink(url: string): void;
  onOpenFolder(path: string, target: "folder" | "vscode" | "terminal"): void;
}) {
  const folders = project.folders.length > 0 ? project.folders : [{ label: "Project", path: project.path }];
  return (
    <div className="projects-detail__grid">
      <Card className="projects-detail__card">
        <SectionTitle count={project.localUrls.length}>Local URLs</SectionTitle>
        {project.localUrls.length === 0 ? (
          <p className="projects-muted">None. Add http://localhost URLs in Settings.</p>
        ) : (
          <>
            <ul className="projects-rows">
              {project.localUrls.map((u) => (
                <li key={u}>
                  <Technical>{u}</Technical>
                </li>
              ))}
            </ul>
            <Button variant="secondary" icon={<ExternalLink />} onClick={onOpenApp}>
              Open app
            </Button>
          </>
        )}
      </Card>
      <Card className="projects-detail__card">
        <SectionTitle count={project.links.length}>Links</SectionTitle>
        {project.links.length === 0 ? (
          <p className="projects-muted">None. Add links in Settings.</p>
        ) : (
          <ul className="projects-rows">
            {project.links.map((l) => (
              <li key={l.url}>
                <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => onOpenLink(l.url)}>
                  {l.label}
                </Button>
                <Technical className="projects-muted projects-ellipsis" title={l.url}>
                  {l.url}
                </Technical>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="projects-detail__card projects-detail__card--wide">
        <SectionTitle count={folders.length}>Folders</SectionTitle>
        <ul className="projects-rows">
          {folders.map((f) => (
            <li key={f.path}>
              <span className="projects-folder-label">{f.label}</span>
              <Technical className="projects-muted projects-ellipsis" title={f.path}>
                {f.path}
              </Technical>
              <Button size="sm" variant="ghost" icon={<FolderOpen />} onClick={() => onOpenFolder(f.path, "folder")}>
                Folder
              </Button>
              <Button size="sm" variant="ghost" icon={<Code2 />} onClick={() => onOpenFolder(f.path, "vscode")}>
                VS Code
              </Button>
              <Button size="sm" variant="ghost" icon={<SquareTerminal />} onClick={() => onOpenFolder(f.path, "terminal")}>
                Terminal
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// --- Settings ------------------------------------------------------------------------------

export function SettingsTab({
  project,
  groups,
  saving,
  saveError,
  onSave,
  onArchive,
  onRestore,
  onRemove,
  onAddGroup
}: {
  project: Project;
  groups: readonly ProjectGroup[];
  saving: boolean;
  saveError: string | null;
  onSave(form: ProjectForm): void;
  onArchive(): void;
  onRestore(): void;
  onRemove(): void;
  onAddGroup(name: string): void;
}) {
  const [form, setForm] = useState<ProjectForm>(() => formFromProject(project));
  const [groupName, setGroupName] = useState("");
  const problems = formProblems(form);
  const changed = JSON.stringify(inputFromForm(form)) !== JSON.stringify(inputFromForm(formFromProject(project)));
  return (
    <div className="projects-settings">
      <ProjectFormFields form={form} onChange={setForm} groups={groups} pathEditable idPrefix="project-settings" />
      <form
        className="projects-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (groupName.trim()) onAddGroup(groupName.trim());
          setGroupName("");
        }}
      >
        <label htmlFor="projects-new-group">New group</label>
        <input id="projects-new-group" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Work" />
        <Button type="submit" variant="ghost" disabledReason={groupName.trim() ? null : "Type a group name."}>
          Add group
        </Button>
      </form>
      {(problems.length > 0 || saveError) && (
        <ul className="projects-wizard__problems" role="alert">
          {saveError && <li>{saveError}</li>}
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="projects-settings__actions">
        <Button variant="primary" disabledReason={saving ? "Saving…" : problems[0] ?? (changed ? null : "Nothing has changed.")} onClick={() => onSave(form)}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={() => setForm(formFromProject(project))} disabledReason={changed ? null : "Nothing has changed."}>
          Revert
        </Button>
        <span className="projects-settings__spacer" />
        {project.archivedAt === null ? (
          <Button variant="ghost" onClick={onArchive}>
            Archive project
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onRestore}>
              Restore
            </Button>
            <Button variant="danger" onClick={onRemove}>
              Remove from DexNest…
            </Button>
          </>
        )}
      </div>
      <p className="projects-muted">Archiving hides the project and keeps everything; nothing on disk is touched. Removing (from the archive) deletes only DexNest's entry - never the folder.</p>
    </div>
  );
}
