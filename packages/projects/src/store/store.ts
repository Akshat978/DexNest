// Projects persistence on the shared SqlDatabase. After the one-time
// projects.json migration this is the source of truth for every project.
//
// Reads load each child table once and group in memory, so listing 100+
// projects is a fixed handful of queries rather than one per project.

import { runModuleMigrations, withTransaction, type SqlDatabase } from "@dexnest/foundation";

import { PROJECTS_MODULE_ID, type EventPayload } from "../domain/events.ts";
import {
  COMMAND_SLOTS,
  isAccent,
  isProjectType,
  type CommandSlot,
  type Project
} from "../domain/project.ts";
import { remoteIdentity, stripUrlCredentials } from "../domain/remote.ts";
import type { SafetyClass } from "../domain/safety.ts";
import type { UndoRecord } from "../domain/operations.ts";
import { PROJECTS_MIGRATIONS } from "./migrations.ts";

export function runProjectsMigrations(db: SqlDatabase, now?: string) {
  return runModuleMigrations(db, PROJECTS_MODULE_ID, PROJECTS_MIGRATIONS, now);
}

export interface ProjectGroup {
  id: string;
  name: string;
  position: number;
}

export interface FetchState {
  lastFetchAt: string;
  outcome: string;
}

/** Branch names and shas before/after an operation, for undo and for the record. */
export interface RefSnapshot {
  head: string | null;
  branch: string | null;
  refs: Record<string, string>;
}

export type OperationState = "running" | "succeeded" | "failed" | "refused" | "interrupted";

export interface OperationRecord {
  id: string;
  projectId: string;
  verb: string;
  safety: SafetyClass;
  state: OperationState;
  outcome: string | null;
  /** Allowlisted fields only (journalParams): never messages, paths or URLs. */
  params: EventPayload;
  refsBefore: RefSnapshot | null;
  refsAfter: RefSnapshot | null;
  undo: UndoRecord | null;
  undoOf: string | null;
  undoneBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
}

export interface BeginOperation {
  id: string;
  projectId: string;
  verb: string;
  safety: SafetyClass;
  params: EventPayload;
  refsBefore: RefSnapshot | null;
  undoOf?: string | null;
}

export type BeginResult = { ok: true; record: OperationRecord } | { ok: false; busy: OperationRecord };

export interface FinishOperation {
  state: Exclude<OperationState, "running">;
  outcome: string;
  refsAfter?: RefSnapshot | null;
  undo?: UndoRecord | null;
  errorCode?: string | null;
}

export type ProjectStoreErrorCode = "not_found" | "not_archived" | "invalid";

export class ProjectStoreError extends Error {
  readonly code: ProjectStoreErrorCode;
  constructor(message: string, code: ProjectStoreErrorCode) {
    super(message);
    this.name = "ProjectStoreError";
    this.code = code;
  }
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  real_path: string | null;
  description: string;
  accent: string;
  project_type: string | null;
  group_id: string | null;
  favourite: number;
  pinned: number;
  archived_at: string | null;
  notes: string;
  health_url: string;
  stop_command: string;
  log_command: string;
  log_path: string;
  docker_compose: number;
  is_git: number | null;
  remote_name: string | null;
  remote_url: string | null;
  hosting_owner: string | null;
  hosting_repo: string | null;
  default_branch: string | null;
  package_manager: string | null;
  framework: string | null;
  workspace_file: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  last_activity_at: string | null;
  legacy_json: string | null;
}

interface CommandRow { project_id: string; kind: string; entry_id: string; label: string; command: string; requires_confirmation: number }
interface UrlRow { project_id: string; kind: string; label: string; url: string }
interface FolderRow { project_id: string; label: string; path: string }
interface PortRow { project_id: string; port: number }
interface TagRow { project_id: string; tag: string }

interface OperationRow {
  id: string;
  project_id: string;
  verb: string;
  safety: SafetyClass;
  state: OperationState;
  outcome: string | null;
  params_json: string;
  refs_before_json: string | null;
  refs_after_json: string | null;
  undo_json: string | null;
  undo_of: string | null;
  undone_by: string | null;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
}

function groupBy<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.project_id);
    if (list) list.push(row);
    else out.set(row.project_id, [row]);
  }
  return out;
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  return JSON.parse(text) as T;
}

function toRecord(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    verb: row.verb,
    safety: row.safety,
    state: row.state,
    outcome: row.outcome,
    params: JSON.parse(row.params_json) as EventPayload,
    refsBefore: parseJson<RefSnapshot>(row.refs_before_json),
    refsAfter: parseJson<RefSnapshot>(row.refs_after_json),
    undo: parseJson<UndoRecord>(row.undo_json),
    undoOf: row.undo_of,
    undoneBy: row.undone_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code
  };
}

const bit = (value: boolean) => (value ? 1 : 0);

export interface ProjectsStore {
  list(options?: { includeArchived?: boolean }): Project[];
  get(id: string): Project | null;
  /** Every id in use, archived included. */
  ids(): Set<string>;
  /** Insert or replace a project and all its child rows, in one transaction. */
  save(project: Project): void;
  saveMany(projects: readonly Project[]): void;
  archive(id: string, at: string): Project;
  restore(id: string, at: string): Project;
  /** Permanent removal of an archived project's entry. Never touches files. */
  remove(id: string): void;
  touch(id: string, at: string): void;
  noteActivity(id: string, at: string): void;
  findByRealPath(realPath: string): Project | null;
  findByRemote(remoteUrl: string): Project | null;

  listGroups(): ProjectGroup[];
  saveGroup(group: ProjectGroup): void;
  deleteGroup(id: string): void;

  recordFetch(projectId: string, at: string, outcome: string): void;
  fetchState(projectId: string): FetchState | null;
  allFetchStates(): Map<string, FetchState>;

  beginOperation(input: BeginOperation, now: string): BeginResult;
  finishOperation(id: string, result: FinishOperation, now: string): OperationRecord;
  recordRefusal(input: BeginOperation, code: string, now: string): OperationRecord;
  markUndone(id: string, undoOpId: string): void;
  getOperation(id: string): OperationRecord | null;
  runningOperation(projectId: string): OperationRecord | null;
  listOperations(projectId: string, limit?: number): OperationRecord[];
  /** The project's most recent finished operation, if it succeeded, has an undo and was not undone yet. */
  latestUndoable(projectId: string): OperationRecord | null;
  /** On start: any operation still "running" was cut short by a crash or quit. */
  recoverInterrupted(now: string): OperationRecord[];

  getMeta<T>(key: string): T | null;
  setMeta(key: string, value: unknown, now: string): void;
}

export function createProjectsStore(db: SqlDatabase): ProjectsStore {
  function assemble(rows: ProjectRow[], filterIds: string[] | null): Project[] {
    if (rows.length === 0) return [];
    const where = filterIds ? ` WHERE project_id IN (${filterIds.map(() => "?").join(",")})` : "";
    const params = filterIds ?? [];
    const commands = groupBy(db.prepare(`SELECT * FROM proj_commands${where} ORDER BY position`).all<CommandRow>(params));
    const urls = groupBy(db.prepare(`SELECT * FROM proj_urls${where} ORDER BY position`).all<UrlRow>(params));
    const folders = groupBy(db.prepare(`SELECT * FROM proj_folders${where} ORDER BY position`).all<FolderRow>(params));
    const ports = groupBy(db.prepare(`SELECT * FROM proj_ports${where} ORDER BY position`).all<PortRow>(params));
    const tags = groupBy(db.prepare(`SELECT * FROM proj_tags${where} ORDER BY position`).all<TagRow>(params));

    return rows.map((row) => {
      const slots = {} as Record<CommandSlot, string>;
      for (const slot of COMMAND_SLOTS) slots[slot] = "";
      const commandList: Project["commandList"] = [];
      for (const c of commands.get(row.id) ?? []) {
        if (c.kind === "list") commandList.push({ id: c.entry_id, label: c.label, command: c.command, requiresConfirmation: c.requires_confirmation === 1 });
        else slots[c.kind as CommandSlot] = c.command;
      }
      const urlRows = urls.get(row.id) ?? [];
      return {
        id: row.id,
        name: row.name,
        path: row.path,
        realPath: row.real_path,
        description: row.description,
        accent: isAccent(row.accent) ? row.accent : "dev",
        projectType: isProjectType(row.project_type) ? row.project_type : null,
        groupId: row.group_id,
        tags: (tags.get(row.id) ?? []).map((t) => t.tag),
        favourite: row.favourite === 1,
        pinned: row.pinned === 1,
        archivedAt: row.archived_at,
        notes: row.notes,
        commands: slots,
        commandList,
        localUrls: urlRows.filter((u) => u.kind === "local").map((u) => u.url),
        links: urlRows.filter((u) => u.kind === "link").map((u) => ({ label: u.label, url: u.url })),
        folders: (folders.get(row.id) ?? []).map((f) => ({ label: f.label, path: f.path })),
        ports: (ports.get(row.id) ?? []).map((p) => p.port),
        healthUrl: row.health_url,
        stopCommand: row.stop_command,
        logCommand: row.log_command,
        logPath: row.log_path,
        dockerCompose: row.docker_compose === 1,
        git: {
          isRepo: row.is_git === null ? null : row.is_git === 1,
          remoteName: row.remote_name,
          remoteUrl: row.remote_url,
          hosting: row.hosting_owner && row.hosting_repo ? { kind: "github", owner: row.hosting_owner, repo: row.hosting_repo } : null,
          defaultBranch: row.default_branch
        },
        tooling: { packageManager: row.package_manager, framework: row.framework, workspaceFile: row.workspace_file },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastOpenedAt: row.last_opened_at,
        lastActivityAt: row.last_activity_at,
        legacy: parseJson<Record<string, unknown>>(row.legacy_json)
      };
    });
  }

  function get(id: string): Project | null {
    const row = db.prepare("SELECT * FROM proj_projects WHERE id = ?").get<ProjectRow>([id]);
    return row ? assemble([row], [id])[0] : null;
  }

  function mustGet(id: string): Project {
    const project = get(id);
    if (!project) throw new ProjectStoreError(`No project with id ${id}.`, "not_found");
    return project;
  }

  function writeProject(p: Project): void {
    const remoteUrl = p.git.remoteUrl === null ? null : stripUrlCredentials(p.git.remoteUrl);
    db.prepare(`
      INSERT INTO proj_projects (
        id, name, path, real_path, remote_identity, description, accent, project_type, group_id, favourite, pinned,
        archived_at, notes, health_url, stop_command, log_command, log_path, docker_compose, is_git, remote_name,
        remote_url, hosting_owner, hosting_repo, default_branch, package_manager, framework, workspace_file,
        created_at, updated_at, last_opened_at, last_activity_at, legacy_json
      ) VALUES (
        :id, :name, :path, :real_path, :remote_identity, :description, :accent, :project_type, :group_id, :favourite, :pinned,
        :archived_at, :notes, :health_url, :stop_command, :log_command, :log_path, :docker_compose, :is_git, :remote_name,
        :remote_url, :hosting_owner, :hosting_repo, :default_branch, :package_manager, :framework, :workspace_file,
        :created_at, :updated_at, :last_opened_at, :last_activity_at, :legacy_json
      )
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name, path = excluded.path, real_path = excluded.real_path, remote_identity = excluded.remote_identity,
        description = excluded.description, accent = excluded.accent, project_type = excluded.project_type,
        group_id = excluded.group_id, favourite = excluded.favourite, pinned = excluded.pinned,
        archived_at = excluded.archived_at, notes = excluded.notes, health_url = excluded.health_url,
        stop_command = excluded.stop_command, log_command = excluded.log_command, log_path = excluded.log_path,
        docker_compose = excluded.docker_compose, is_git = excluded.is_git, remote_name = excluded.remote_name,
        remote_url = excluded.remote_url, hosting_owner = excluded.hosting_owner, hosting_repo = excluded.hosting_repo,
        default_branch = excluded.default_branch, package_manager = excluded.package_manager,
        framework = excluded.framework, workspace_file = excluded.workspace_file, created_at = excluded.created_at,
        updated_at = excluded.updated_at, last_opened_at = excluded.last_opened_at,
        last_activity_at = excluded.last_activity_at, legacy_json = excluded.legacy_json
    `).run({
      id: p.id,
      name: p.name,
      path: p.path,
      real_path: p.realPath,
      remote_identity: remoteUrl === null ? null : remoteIdentity(remoteUrl),
      description: p.description,
      accent: p.accent,
      project_type: p.projectType,
      group_id: p.groupId,
      favourite: bit(p.favourite),
      pinned: bit(p.pinned),
      archived_at: p.archivedAt,
      notes: p.notes,
      health_url: p.healthUrl,
      stop_command: p.stopCommand,
      log_command: p.logCommand,
      log_path: p.logPath,
      docker_compose: bit(p.dockerCompose),
      is_git: p.git.isRepo === null ? null : bit(p.git.isRepo),
      remote_name: p.git.remoteName,
      remote_url: remoteUrl,
      hosting_owner: p.git.hosting?.owner ?? null,
      hosting_repo: p.git.hosting?.repo ?? null,
      default_branch: p.git.defaultBranch,
      package_manager: p.tooling.packageManager,
      framework: p.tooling.framework,
      workspace_file: p.tooling.workspaceFile,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
      last_opened_at: p.lastOpenedAt,
      last_activity_at: p.lastActivityAt,
      legacy_json: p.legacy === null ? null : JSON.stringify(p.legacy)
    });

    for (const table of ["proj_commands", "proj_urls", "proj_folders", "proj_ports", "proj_tags"]) {
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run([p.id]);
    }
    const command = db.prepare("INSERT INTO proj_commands (project_id, kind, entry_id, label, command, requires_confirmation, position) VALUES (?, ?, ?, ?, ?, ?, ?)");
    COMMAND_SLOTS.forEach((slot, i) => {
      if (p.commands[slot]) command.run([p.id, slot, "", slot, p.commands[slot], 0, i]);
    });
    p.commandList.forEach((c, i) => command.run([p.id, "list", c.id, c.label, c.command, bit(c.requiresConfirmation), i]));
    const url = db.prepare("INSERT INTO proj_urls (project_id, kind, label, url, position) VALUES (?, ?, ?, ?, ?)");
    p.localUrls.forEach((u, i) => url.run([p.id, "local", "", u, i]));
    p.links.forEach((l, i) => url.run([p.id, "link", l.label, l.url, i]));
    const folder = db.prepare("INSERT INTO proj_folders (project_id, label, path, position) VALUES (?, ?, ?, ?)");
    p.folders.forEach((f, i) => folder.run([p.id, f.label, f.path, i]));
    const port = db.prepare("INSERT INTO proj_ports (project_id, port, position) VALUES (?, ?, ?)");
    p.ports.forEach((n, i) => port.run([p.id, n, i]));
    const tag = db.prepare("INSERT INTO proj_tags (project_id, tag, position) VALUES (?, ?, ?)");
    p.tags.forEach((t, i) => tag.run([p.id, t, i]));
  }

  function getOperation(id: string): OperationRecord | null {
    const row = db.prepare("SELECT * FROM proj_operations WHERE id = ?").get<OperationRow>([id]);
    return row ? toRecord(row) : null;
  }

  function runningOperation(projectId: string): OperationRecord | null {
    const row = db.prepare("SELECT * FROM proj_operations WHERE project_id = ? AND state = 'running'").get<OperationRow>([projectId]);
    return row ? toRecord(row) : null;
  }

  function insertOperation(input: BeginOperation, state: OperationState, now: string, extra: { outcome?: string; errorCode?: string; finishedAt?: string } = {}): void {
    db.prepare(`
      INSERT INTO proj_operations (id, project_id, verb, safety, state, outcome, params_json, refs_before_json, undo_of, started_at, finished_at, error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run([
      input.id,
      input.projectId,
      input.verb,
      input.safety,
      state,
      extra.outcome ?? null,
      JSON.stringify(input.params),
      input.refsBefore === null ? null : JSON.stringify(input.refsBefore),
      input.undoOf ?? null,
      now,
      extra.finishedAt ?? null,
      extra.errorCode ?? null
    ]);
  }

  return {
    list(options = {}) {
      const rows = db
        .prepare(`SELECT * FROM proj_projects${options.includeArchived ? "" : " WHERE archived_at IS NULL"} ORDER BY name COLLATE NOCASE, id`)
        .all<ProjectRow>();
      return assemble(rows, null);
    },
    get,
    ids() {
      return new Set(db.prepare("SELECT id FROM proj_projects").all<{ id: string }>().map((r) => r.id));
    },
    save(project) {
      withTransaction(db, () => writeProject(project));
    },
    saveMany(projects) {
      withTransaction(db, () => {
        for (const project of projects) writeProject(project);
      });
    },
    archive(id, at) {
      return withTransaction(db, () => {
        const project = mustGet(id);
        const next = { ...project, archivedAt: project.archivedAt ?? at, updatedAt: at };
        writeProject(next);
        return next;
      });
    },
    restore(id, at) {
      return withTransaction(db, () => {
        const next = { ...mustGet(id), archivedAt: null, updatedAt: at };
        writeProject(next);
        return next;
      });
    },
    remove(id) {
      withTransaction(db, () => {
        const project = mustGet(id);
        if (project.archivedAt === null) throw new ProjectStoreError("Archive a project before removing it.", "not_archived");
        for (const table of ["proj_commands", "proj_urls", "proj_folders", "proj_ports", "proj_tags", "proj_fetch_state"]) {
          db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run([id]);
        }
        db.prepare("DELETE FROM proj_projects WHERE id = ?").run([id]);
      });
    },
    touch(id, at) {
      const changed = db.prepare("UPDATE proj_projects SET last_opened_at = ?, last_activity_at = ?, updated_at = ? WHERE id = ?").run([at, at, at, id]).changes;
      if (changed === 0) throw new ProjectStoreError(`No project with id ${id}.`, "not_found");
    },
    noteActivity(id, at) {
      db.prepare("UPDATE proj_projects SET last_activity_at = ? WHERE id = ? AND (last_activity_at IS NULL OR last_activity_at < ?)").run([at, id, at]);
    },
    findByRealPath(realPath) {
      const row = db.prepare("SELECT * FROM proj_projects WHERE real_path = ? ORDER BY archived_at IS NOT NULL, id LIMIT 1").get<ProjectRow>([realPath]);
      return row ? assemble([row], [row.id])[0] : null;
    },
    findByRemote(remoteUrl) {
      const identity = remoteIdentity(remoteUrl);
      if (!identity) return null;
      const row = db.prepare("SELECT * FROM proj_projects WHERE remote_identity = ? ORDER BY archived_at IS NOT NULL, id LIMIT 1").get<ProjectRow>([identity]);
      return row ? assemble([row], [row.id])[0] : null;
    },

    listGroups() {
      return db.prepare("SELECT id, name, position FROM proj_groups ORDER BY position, name COLLATE NOCASE").all<ProjectGroup>();
    },
    saveGroup(group) {
      const name = group.name.trim();
      if (!name) throw new ProjectStoreError("A group needs a name.", "invalid");
      db.prepare("INSERT INTO proj_groups (id, name, position) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position").run([group.id, name, group.position]);
    },
    deleteGroup(id) {
      withTransaction(db, () => {
        db.prepare("UPDATE proj_projects SET group_id = NULL WHERE group_id = ?").run([id]);
        db.prepare("DELETE FROM proj_groups WHERE id = ?").run([id]);
      });
    },

    recordFetch(projectId, at, outcome) {
      db.prepare("INSERT INTO proj_fetch_state (project_id, last_fetch_at, outcome) VALUES (?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET last_fetch_at = excluded.last_fetch_at, outcome = excluded.outcome").run([projectId, at, outcome]);
    },
    fetchState(projectId) {
      const row = db.prepare("SELECT last_fetch_at, outcome FROM proj_fetch_state WHERE project_id = ?").get<{ last_fetch_at: string; outcome: string }>([projectId]);
      return row ? { lastFetchAt: row.last_fetch_at, outcome: row.outcome } : null;
    },
    allFetchStates() {
      const out = new Map<string, FetchState>();
      for (const row of db.prepare("SELECT project_id, last_fetch_at, outcome FROM proj_fetch_state").all<{ project_id: string; last_fetch_at: string; outcome: string }>()) {
        out.set(row.project_id, { lastFetchAt: row.last_fetch_at, outcome: row.outcome });
      }
      return out;
    },

    beginOperation(input, now) {
      return withTransaction(db, (): BeginResult => {
        const busy = runningOperation(input.projectId);
        if (busy) return { ok: false, busy };
        insertOperation(input, "running", now);
        return { ok: true, record: getOperation(input.id)! };
      });
    },
    finishOperation(id, result, now) {
      return withTransaction(db, () => {
        const changed = db.prepare(`
          UPDATE proj_operations SET state = ?, outcome = ?, refs_after_json = ?, undo_json = ?, finished_at = ?, error_code = ?
          WHERE id = ? AND state = 'running'
        `).run([
          result.state,
          result.outcome,
          result.refsAfter ? JSON.stringify(result.refsAfter) : null,
          result.undo ? JSON.stringify(result.undo) : null,
          now,
          result.errorCode ?? null,
          id
        ]).changes;
        if (changed === 0) throw new ProjectStoreError(`Operation ${id} is not running.`, "not_found");
        return getOperation(id)!;
      });
    },
    recordRefusal(input, code, now) {
      insertOperation(input, "refused", now, { outcome: "refused", errorCode: code, finishedAt: now });
      return getOperation(input.id)!;
    },
    markUndone(id, undoOpId) {
      const changed = db.prepare("UPDATE proj_operations SET undone_by = ? WHERE id = ? AND undone_by IS NULL").run([undoOpId, id]).changes;
      if (changed === 0) throw new ProjectStoreError(`Operation ${id} can't be marked undone.`, "not_found");
    },
    getOperation,
    runningOperation,
    listOperations(projectId, limit = 50) {
      return db
        .prepare("SELECT * FROM proj_operations WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?")
        .all<OperationRow>([projectId, Math.max(1, Math.min(500, limit))])
        .map(toRecord);
    },
    latestUndoable(projectId) {
      const row = db
        .prepare("SELECT * FROM proj_operations WHERE project_id = ? AND state IN ('succeeded', 'failed', 'interrupted') ORDER BY started_at DESC, rowid DESC LIMIT 1")
        .get<OperationRow>([projectId]);
      if (!row || row.state !== "succeeded" || row.undo_json === null || row.undone_by !== null) return null;
      return toRecord(row);
    },
    recoverInterrupted(now) {
      return withTransaction(db, () => {
        const rows = db.prepare("SELECT * FROM proj_operations WHERE state = 'running'").all<OperationRow>();
        db.prepare("UPDATE proj_operations SET state = 'interrupted', outcome = 'interrupted', finished_at = ? WHERE state = 'running'").run([now]);
        return rows.map((row) => ({ ...toRecord(row), state: "interrupted" as const, outcome: "interrupted", finishedAt: now }));
      });
    },

    getMeta<T>(key: string) {
      const row = db.prepare("SELECT value_json FROM proj_meta WHERE key = ?").get<{ value_json: string }>([key]);
      return row ? (JSON.parse(row.value_json) as T) : null;
    },
    setMeta(key, value, now) {
      db.prepare("INSERT INTO proj_meta (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run([key, JSON.stringify(value), now]);
    }
  };
}
