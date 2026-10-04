// What the Projects view can ask the main process for (preload.ts exposes
// these on window.dexNest; projectsHost.ts serves them to the trusted main
// frame only). Without the desktop bridge - a browser preview, a test - an
// empty fallback keeps the view rendering.

import type {
  CloneResult,
  ExecuteResult,
  InspectResult,
  LeftOff,
  OperationRecord,
  PreviewResult,
  Project,
  ProjectGroup,
  ProjectInput,
  ProjectSummary,
  ProjectsSettings,
  RepoState,
  SaveResult,
  Suggestion,
  AddManyResult,
  FolderScanResult,
  HistoryEntry,
  DiffStat,
  LegacyReimportResult
} from "@dexnest/projects";

export type OpenTarget = "vscode" | "terminal" | "folder" | "github";

export interface ProjectsActionOutcome {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface ProjectsBridge {
  projectsList(options?: { includeArchived?: boolean }): Promise<ProjectSummary[]>;
  projectsGet(projectId: string): Promise<Project | null>;
  projectsSettings(): Promise<ProjectsSettings>;
  projectsUpdateSettings(settings: Partial<ProjectsSettings>): Promise<ProjectsSettings>;
  projectsGroups(): Promise<ProjectGroup[]>;
  projectsSaveGroup(group: { id: string; name: string; position?: number }): Promise<ProjectGroup[]>;
  projectsDeleteGroup(groupId: string): Promise<ProjectGroup[]>;
  projectsRepoState(projectId: string, options?: { allBranches?: boolean; measureUntracked?: boolean; includeIgnored?: boolean }): Promise<RepoState>;
  projectsRepoStates(projectIds?: string[]): Promise<Record<string, RepoState | { error: string }>>;
  projectsHistory(projectId: string, limit?: number): Promise<HistoryEntry[]>;
  projectsDiffStat(projectId: string): Promise<DiffStat>;
  projectsOperations(projectId: string): Promise<OperationRecord[]>;
  projectsLeftOff(projectId: string): Promise<LeftOff | null>;
  projectsPickFolder(title?: string): Promise<string | null>;
  projectsInspect(path: string, options?: { projectId?: string }): Promise<InspectResult>;
  projectsAdd(input: ProjectInput, source?: "wizard" | "suggestion" | "clone"): Promise<SaveResult>;
  projectsUpdate(projectId: string, input: ProjectInput): Promise<SaveResult>;
  /** Opened in DexNest: "push current project" pushes the most recently opened one. */
  projectsTouch(projectId: string): Promise<void>;
  projectsArchive(projectId: string): Promise<Project>;
  projectsRestore(projectId: string): Promise<Project>;
  projectsRemove(projectId: string): Promise<void>;
  projectsSuggestions(): Promise<Suggestion[]>;
  projectsAddSuggestions(paths: string[]): Promise<AddManyResult>;
  /** Every repository under these folders (Developer Intelligence's walk), new or already added. */
  projectsScanFolders(roots: string[]): Promise<FolderScanResult>;
  projectsImportFolders(paths: string[]): Promise<AddManyResult>;
  projectsClone(input: { url: string; parentDir: string; folderName?: string }): Promise<CloneResult & { inspection?: InspectResult }>;
  projectsImportLegacy(): Promise<LegacyReimportResult>;
  projectsLegacyChanged(): Promise<boolean>;
  projectsPreview(projectId: string, request: unknown): Promise<PreviewResult>;
  projectsExecute(projectId: string, request: unknown, options?: { confirmation?: { confirmed?: boolean; typed?: string }; fingerprint?: string }): Promise<ExecuteResult>;
  projectsCancel(opId: string): Promise<boolean>;
  projectsFetchAll(): Promise<ProjectsActionOutcome>;
  projectsPullAll(): Promise<ProjectsActionOutcome>;
  projectsOpen(projectId: string, target: OpenTarget, options?: { path?: string; branch?: string; base?: string }): Promise<ProjectsActionOutcome>;
  projectsPathForFile?(file: File): string | null;
  onProjectsOutput(callback: (payload: { projectId: string; line: string }) => void): () => void;
}

const unavailable = "The desktop app isn't connected.";

export const fallbackProjectsBridge: ProjectsBridge = {
  projectsList: async () => [],
  projectsGet: async () => null,
  projectsSettings: async () => ({ schemaVersion: 1, staleDays: 30, scheduledFetch: { enabled: false, intervalMinutes: 30 }, fetchConcurrency: 4, terminal: "auto", vscodePath: null, layout: "grid", importRoots: [] }),
  projectsUpdateSettings: async (s) => ({ schemaVersion: 1, staleDays: 30, scheduledFetch: { enabled: false, intervalMinutes: 30 }, fetchConcurrency: 4, terminal: "auto", vscodePath: null, layout: "grid", importRoots: [], ...s }),
  projectsGroups: async () => [],
  projectsSaveGroup: async () => [],
  projectsDeleteGroup: async () => [],
  projectsRepoState: async () => ({ isRepo: false, reason: unavailable, readAt: new Date().toISOString() }),
  projectsRepoStates: async () => ({}),
  projectsHistory: async () => [],
  projectsDiffStat: async () => ({ staged: [], unstaged: [] }),
  projectsOperations: async () => [],
  projectsLeftOff: async () => null,
  projectsPickFolder: async () => null,
  projectsInspect: async () => ({ kind: "refused", code: "missing", reason: unavailable }),
  projectsAdd: async () => ({ ok: false, reason: unavailable }),
  projectsUpdate: async () => ({ ok: false, reason: unavailable }),
  projectsTouch: async () => undefined,
  projectsArchive: async () => {
    throw new Error(unavailable);
  },
  projectsRestore: async () => {
    throw new Error(unavailable);
  },
  projectsRemove: async () => undefined,
  projectsSuggestions: async () => [],
  projectsAddSuggestions: async () => ({ added: [], skipped: [] }),
  projectsScanFolders: async (roots) => ({ roots: [], candidates: [], refused: roots.map((path) => ({ path, reason: unavailable })), truncated: false, unreadable: 0 }),
  projectsImportFolders: async () => ({ added: [], skipped: [] }),
  projectsClone: async () => ({ status: "refused", reason: unavailable }),
  projectsImportLegacy: async () => ({ kind: "absent" }),
  projectsLegacyChanged: async () => false,
  projectsPreview: async () => ({ refused: true, refusal: { refused: true, kind: "unknown", code: "invalid_request", reason: unavailable, offers: [] } }),
  projectsExecute: async () => ({ status: "refused", opId: "", refusal: { refused: true, kind: "unknown", code: "invalid_request", reason: unavailable, offers: [] } }),
  projectsCancel: async () => false,
  projectsFetchAll: async () => ({ ok: false, message: unavailable }),
  projectsPullAll: async () => ({ ok: false, message: unavailable }),
  projectsOpen: async () => ({ ok: false, message: unavailable }),
  onProjectsOutput: () => () => undefined
};

export function getProjectsBridge(): ProjectsBridge {
  const candidate = (window as unknown as { dexNest?: Partial<ProjectsBridge> }).dexNest;
  return candidate && typeof candidate.projectsList === "function" ? (candidate as ProjectsBridge) : fallbackProjectsBridge;
}
