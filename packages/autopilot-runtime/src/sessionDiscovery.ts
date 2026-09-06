// Finding the agent sessions the operator already has.
//
// WHY THIS EXISTS
//
// The design work that produces a plan — the architecture argument, the ideas
// that were rejected, the constraints nobody wrote down — happens in a session
// the human opened themselves, usually the VS Code panel. DexNest cannot
// reconstruct that from a plan document, and seeding a fresh session throws it
// away. So instead of starting a session, DexNest continues one.
//
// WHAT THIS READS, AND WHAT IT REFUSES TO READ
//
// Claude Code stores each session as JSONL under
// <home>/.claude/projects/<mangled cwd>/<session uuid>.jsonl. This module reads
// those transcripts and NOTHING else in that tree: never .credentials.json,
// never anything outside the projects directory. It is scoped by construction —
// the only paths built here are <root>/<dir>/<uuid>.jsonl.
//
// It also does not keep what it reads. Transcripts are the operator's own
// conversations; only metadata leaves this module (id, title, timestamps, size,
// origin). Nothing durable ever holds transcript content.
//
// Files run to tens of megabytes, so nothing is loaded whole: a bounded head
// sample carries the identifying records, and a bounded tail sample carries the
// last activity.

import type { FileSystemPort, EnvironmentPort } from "./ports.ts";
import { canonicalize, samePath } from "./paths.ts";

/**
 * Head sampling is escalating rather than fixed.
 *
 * A transcript's identifying record is the first user message, and in a DexNest
 * transcript that message is the whole prompt — tens of kilobytes on ONE line,
 * with an equally large queue-operation record ahead of it. A fixed 64 KB window
 * was cut in the middle of that line on a real session, so cwd and entrypoint
 * came back null and the session was invisible. Read further only when the
 * first window did not answer, and stop at a cap so no file is ever loaded whole
 * by accident.
 */
export const SESSION_HEAD_SAMPLE_BYTES = 64 * 1024;
export const SESSION_HEAD_ESCALATION_BYTES: readonly number[] = [64 * 1024, 256 * 1024, 1024 * 1024];
export const SESSION_TAIL_SAMPLE_BYTES = 16 * 1024;

/**
 * A transcript touched this recently is assumed to still be open somewhere.
 * Two writers appending to one JSONL is not a situation to recover from.
 */
export const SESSION_LIVE_WINDOW_MS = 10 * 60 * 1000;

const SESSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Where the session came from. "vscode" is the panel a human types into. */
export type SessionOrigin = "vscode" | "cli" | "unknown";

export interface DiscoveredSession {
  sessionId: string;
  transcriptPath: string;
  /** The working directory recorded inside the transcript, not guessed from the directory name. */
  projectPath: string | null;
  origin: SessionOrigin;
  /** The agent's own title for the conversation. Absent on very short sessions. */
  title: string | null;
  cliVersion: string | null;
  gitBranch: string | null;
  firstActivity: string | null;
  lastActivity: string | null;
  sizeBytes: number;
  /** Recently written, so probably still open in another window. */
  live: boolean;
}

function records(sample: string, dropFirst: boolean, complete = false): Array<Record<string, unknown>> {
  const lines = sample.split("\n");
  // A byte-bounded sample clips a line at the cut, so that line is unparseable.
  // A sample covering the whole file has no cut and must keep every line.
  if (!complete) {
    if (dropFirst) lines.shift();
    else lines.pop();
  }
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed.push(value as Record<string, unknown>);
    } catch { /* A truncated or malformed line is skipped, not fatal. */ }
  }
  return parsed;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function originOf(entrypoint: string | null): SessionOrigin {
  if (!entrypoint) return "unknown";
  if (/vscode|jetbrains|ide/i.test(entrypoint)) return "vscode";
  if (/cli|sdk/i.test(entrypoint)) return "cli";
  return "unknown";
}

export interface SessionDiscoveryOptions {
  fs: FileSystemPort;
  env: EnvironmentPort;
  now: () => string;
  windows?: boolean;
  /** Overrides <home>/.claude/projects. For tests. */
  root?: string;
}

export class SessionDiscovery {
  private readonly fs: FileSystemPort;
  private readonly env: EnvironmentPort;
  private readonly now: () => string;
  private readonly windows: boolean;
  private readonly override: string | null;

  constructor(options: SessionDiscoveryOptions) {
    this.fs = options.fs;
    this.env = options.env;
    this.now = options.now;
    this.windows = options.windows ?? true;
    this.override = options.root ?? null;
  }

  /** The transcript root, or null when Claude Code has never run here. */
  root(): string | null {
    if (this.override) return this.fs.exists(this.override) ? this.override : null;
    const home = this.env.snapshot().USERPROFILE ?? this.env.snapshot().HOME;
    if (!home) return null;
    const root = `${home.replace(/[\\/]+$/, "")}/.claude/projects`;
    return this.fs.exists(root) ? root : null;
  }

  /** Reads one transcript's metadata. Never returns its content. */
  describe(transcriptPath: string, sessionId: string): DiscoveredSession | null {
    const info = this.fs.stat(transcriptPath);
    if (!info || info.directory || info.sizeBytes === 0) return null;

    let projectPath: string | null = null;
    let entrypoint: string | null = null;
    let title: string | null = null;
    let cliVersion: string | null = null;
    let gitBranch: string | null = null;
    let firstActivity: string | null = null;
    let head: Array<Record<string, unknown>> = [];
    let readWholeFile = false;

    for (const window of SESSION_HEAD_ESCALATION_BYTES) {
      const complete = window >= info.sizeBytes;
      head = records(this.fs.readFileHead(transcriptPath, window), false, complete);
      projectPath = null; entrypoint = null; title = null;
      cliVersion = null; gitBranch = null; firstActivity = null;
      for (const record of head) {
        projectPath ??= text(record.cwd);
        entrypoint ??= text(record.entrypoint);
        cliVersion ??= text(record.version);
        gitBranch ??= text(record.gitBranch);
        firstActivity ??= text(record.timestamp);
        if (record.type === "ai-title") title ??= text(record.aiTitle);
      }
      readWholeFile = complete;
      // cwd is what identifies a session; anything else may legitimately be absent.
      if (projectPath || complete) break;
    }

    // The tail is only consulted for recency; a fully read file is covered.
    let lastActivity = firstActivity;
    const tail = readWholeFile
      ? head
      : records(this.fs.readFileTail(transcriptPath, SESSION_TAIL_SAMPLE_BYTES), true);
    for (const record of tail) lastActivity = text(record.timestamp) ?? lastActivity;

    const age = lastActivity ? Date.parse(this.now()) - Date.parse(lastActivity) : Number.POSITIVE_INFINITY;
    return {
      sessionId,
      transcriptPath,
      projectPath,
      origin: originOf(entrypoint),
      title,
      cliVersion,
      gitBranch,
      firstActivity,
      lastActivity: lastActivity ?? info.modifiedAt,
      sizeBytes: info.sizeBytes,
      live: Number.isFinite(age) && age >= 0 && age < SESSION_LIVE_WINDOW_MS
    };
  }

  /**
   * Sessions whose recorded working directory is this project.
   *
   * Directory names are a lossy encoding of the path — the same project appears
   * under different names depending on the drive-letter case it was launched
   * with — so every candidate directory is opened and matched on the cwd the
   * transcript itself records. Newest first.
   */
  forProject(projectPath: string): DiscoveredSession[] {
    const root = this.root();
    if (!root) return [];
    const target = canonicalize(projectPath, { windows: this.windows });

    const found: DiscoveredSession[] = [];
    for (const directory of this.fs.listDirectory(root)) {
      if (directory.startsWith(".")) continue;
      const base = `${root}/${directory}`;
      for (const entry of this.fs.listDirectory(base)) {
        const match = SESSION_FILE.exec(entry);
        if (!match) continue;
        const session = this.describe(`${base}/${entry}`, match[1]!.toLowerCase());
        if (!session?.projectPath) continue;
        if (!samePath(canonicalize(session.projectPath, { windows: this.windows }), target, this.windows)) continue;
        found.push(session);
      }
    }
    return found.sort((left, right) => (right.lastActivity ?? "").localeCompare(left.lastActivity ?? ""));
  }
}

/** One line per session, for a picker. Content is never included. */
export function describeSession(session: DiscoveredSession): string {
  const size = session.sizeBytes >= 1024 * 1024
    ? `${(session.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(session.sizeBytes / 1024))} KB`;
  const origin = session.origin === "vscode" ? "your editor" : session.origin === "cli" ? "a command line" : "an unknown client";
  return [
    session.title ?? "Untitled session",
    `${session.sessionId.slice(0, 8)} · from ${origin} · ${size}`,
    session.lastActivity ? `last active ${session.lastActivity}` : "never active",
    session.live ? "· open somewhere right now" : ""
  ].filter(Boolean).join(" · ");
}
