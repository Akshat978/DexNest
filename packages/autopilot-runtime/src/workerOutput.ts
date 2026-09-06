// Worker output as data, not as actions.
//
// The worker runs with its tools disabled, so it cannot read or write anything
// itself. Instead:
//
//   DexNest reads the workspace  -> embeds it in the prompt
//   worker returns whole files   -> as text, in a strict envelope
//   DexNest parses them          -> WRITE_FILE intents
//                                -> policy -> dispatcher -> disk
//
// Every byte the worker causes to be written therefore still passes the
// capability policy. The worktree stays an enforced boundary rather than a
// convention, which is the whole reason for doing it this way instead of
// handing the worker an Edit tool.
//
// Whole files, not diffs: applying a diff needs fuzzy context matching and can
// half-succeed. A whole file either parses and writes or it does not.

const OPEN = /^<<<DEXNEST_FILE\s+path="([^"\n]+)"\s*>>>$/;
const CLOSE = "<<<END_DEXNEST_FILE>>>";

/** Bounds so a runaway response cannot fill the disk or the journal. */
export const MAX_OUTPUT_FILES = 20;
export const MAX_OUTPUT_FILE_BYTES = 128 * 1024;

/** Bounds on what one turn may ask to see. */
export const MAX_REQUESTED_FILES = 5;
export const MAX_REQUESTED_BYTES = 60 * 1024;

export interface ParsedFile {
  /** Workspace-relative, normalized to forward slashes. */
  path: string;
  contents: string;
}

export interface ParsedWorkerOutput {
  files: ParsedFile[];
  /** Workspace-relative paths the worker asked to be shown next turn. */
  requests: string[];
  /** Why a block or request was refused. Fed back to the worker verbatim. */
  issues: string[];
}

/**
 * Extracts file blocks from a worker response.
 *
 * Everything outside a block is ignored, so the worker may narrate freely.
 * A block whose path is absolute, escapes the workspace, or is oversized is
 * refused here with a reason rather than being passed to policy — the operator
 * gets a clearer message, and policy still re-checks whatever survives.
 */
export function parseWorkerOutput(text: string): ParsedWorkerOutput {
  const files: ParsedFile[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();

  const lines = (text ?? "").split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const opened = OPEN.exec(lines[index]!.trim());
    if (!opened) {
      index += 1;
      continue;
    }

    const rawPath = opened[1]!.trim();
    const body: string[] = [];
    let closed = false;
    index += 1;

    while (index < lines.length) {
      if (lines[index]!.trim() === CLOSE) {
        closed = true;
        index += 1;
        break;
      }
      body.push(lines[index]!);
      index += 1;
    }

    if (!closed) {
      issues.push(`The block for "${rawPath}" was never closed with ${CLOSE}.`);
      continue;
    }

    const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");

    if (!normalized) {
      issues.push("A file block had an empty path.");
      continue;
    }
    if (/^([a-zA-Z]:|\/|\\\\)/.test(rawPath.replace(/\\/g, "\\"))) {
      issues.push(`"${rawPath}" is an absolute path. Use a path relative to the project root.`);
      continue;
    }
    if (normalized.split("/").includes("..")) {
      issues.push(`"${rawPath}" escapes the project root. Use a path inside it.`);
      continue;
    }
    if (seen.has(normalized)) {
      issues.push(`"${normalized}" appeared more than once; only the first block was used.`);
      continue;
    }

    const contents = `${body.join("\n")}\n`;
    if (Buffer.byteLength(contents, "utf8") > MAX_OUTPUT_FILE_BYTES) {
      issues.push(`"${normalized}" exceeds the ${MAX_OUTPUT_FILE_BYTES}-byte limit for one file.`);
      continue;
    }

    seen.add(normalized);
    files.push({ path: normalized, contents });

    if (files.length >= MAX_OUTPUT_FILES) {
      issues.push(`Only the first ${MAX_OUTPUT_FILES} files were taken from this response.`);
      break;
    }
  }

  return { files, requests: parseRequests(text, issues), issues };
}

const REQUEST = /<<<DEXNEST_REQUEST\s+path="([^"\n]*)"\s*>>>/g;
/** An opening marker with no valid closing form, so a malformed one is reported. */
const REQUEST_MALFORMED = /<<<DEXNEST_REQUEST(?![^\n]*?path="[^"\n]*"\s*>>>)/g;

/**
 * Extracts the files the worker asked to be shown next turn.
 *
 * Only this exact envelope counts. A path mentioned in prose is never treated
 * as a request, so ordinary narration cannot cause a read.
 *
 * Validation here is lexical only; the path is additionally checked against the
 * tracked file list and then read through a READ_FILE intent, so policy remains
 * the authority.
 */
export function parseRequests(text: string, issues: string[]): string[] {
  const requests: string[] = [];
  const seen = new Set<string>();

  const malformed = (text ?? "").match(REQUEST_MALFORMED);
  if (malformed) {
    issues.push(`${malformed.length} context request(s) were malformed and ignored. Use <<<DEXNEST_REQUEST path="dir/file.ts">>> exactly.`);
  }

  for (const match of (text ?? "").matchAll(REQUEST)) {
    const raw = match[1]!.trim();
    const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "");

    if (!normalized) {
      issues.push("A context request had an empty path.");
      continue;
    }
    if (/^([a-zA-Z]:|\/|\\\\)/.test(raw)) {
      issues.push(`Context request "${raw}" is an absolute path. Request a path relative to the project root.`);
      continue;
    }
    if (normalized.split("/").includes("..")) {
      issues.push(`Context request "${raw}" escapes the project root and was denied.`);
      continue;
    }
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    if (requests.length >= MAX_REQUESTED_FILES) {
      issues.push(`Only the first ${MAX_REQUESTED_FILES} context request(s) were accepted this turn.`);
      break;
    }
    requests.push(normalized);
  }

  return requests;
}

/** The contract shown to the worker. Kept in one place so it cannot drift. */
export function outputProtocolInstructions(): string {
  return [
    "HOW TO MAKE CHANGES",
    "",
    "You have no file tools in this session. Do not describe edits and do not use",
    "a tool. Instead, return the COMPLETE new contents of every file you want",
    "changed, each wrapped exactly like this:",
    "",
    '<<<DEXNEST_FILE path="src/example.ts">>>',
    "...the entire file, exactly as it should be written...",
    "<<<END_DEXNEST_FILE>>>",
    "",
    "Rules:",
    "- Whole files only. Never a diff, a patch, or a fragment.",
    "- Paths are relative to the project root shown above. No absolute paths, no \"..\".",
    "- Only include files you are actually changing.",
    "- Anything outside these blocks is ignored, so explain yourself freely.",
    "",
    "DexNest writes these files for you and then runs the verification commands.",
    "",
    "IF YOU NEED TO SEE ANOTHER FILE",
    "",
    "Only the files above are visible to you. If you need one that is not shown,",
    "ask for it and DexNest will include it next turn:",
    "",
    '<<<DEXNEST_REQUEST path="src/other.ts">>>',
    "",
    `- At most ${MAX_REQUESTED_FILES} requests per turn, relative paths only.`,
    "- A request costs a turn, so ask only for files you genuinely need.",
    "- You may request files and return changed files in the same response."
  ].join("\n");
}

/** Tells the worker what happened to the files it asked for last turn. */
export function renderRequestOutcomes(
  outcomes: Array<{ path: string; allowed: boolean; reason: string | null }>
): string {
  if (outcomes.length === 0) return "";
  const lines = ["YOUR PREVIOUS CONTEXT REQUESTS", ""];
  for (const outcome of outcomes) {
    lines.push(
      outcome.allowed
        ? `- ${outcome.path}: included below.`
        : `- ${outcome.path}: DENIED — ${outcome.reason ?? "not permitted"}. Do not ask again.`
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Renders the workspace files DexNest read, as the worker's only view of the code. */
export function renderWorkspaceContext(files: ParsedFile[], truncatedNote: string | null): string {
  if (files.length === 0) {
    return "PROJECT FILES\n\n(No readable files were found in the project.)";
  }
  const lines = ["PROJECT FILES", "", "These are the current contents. This is your only view of the code.", ""];
  for (const file of files) {
    lines.push(`<<<DEXNEST_FILE path="${file.path}">>>`);
    lines.push(file.contents.replace(/\n$/, ""));
    lines.push("<<<END_DEXNEST_FILE>>>");
    lines.push("");
  }
  if (truncatedNote) lines.push(truncatedNote, "");
  return lines.join("\n");
}
