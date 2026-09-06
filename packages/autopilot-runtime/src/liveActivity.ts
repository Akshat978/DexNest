// Watching a turn happen.
//
// WHY THIS IS NOT ON THE CRITICAL PATH
//
// A turn's outcome is decided by the completed CommandOutcome, exactly as it
// was before: the same result object, the same certain/uncertain
// classification, the same journal. Everything here reads the SAME bytes on
// their way past and turns them into something a person can look at.
//
// That separation is deliberate and load-bearing. A dropped chunk, a malformed
// line, a parser that does not recognise a new event type — none of it can
// change what a run decides. It can only cost visibility. So this file is
// allowed to be lenient in a way the rest of the runtime is not.
//
// WHAT IT DOES NOT KEEP
//
// Not a transcript. The conversation is already durable in the agent's own
// session, and that is where it should be read. This is a bounded window on the
// last few things that happened, held in memory, thrown away when the run
// settles. Nothing here is written to the database.

/** One thing worth showing a person. */
export interface ActivityEvent {
  at: string;
  kind: "thinking" | "text" | "tool" | "result" | "error";
  /** One line. Already trimmed and bounded. */
  label: string;
  /** Longer body, when there is one worth expanding. */
  detail?: string;
}

export const MAX_ACTIVITY_EVENTS = 200;
export const MAX_LABEL_CHARS = 160;
export const MAX_DETAIL_CHARS = 2_000;

const clean = (value: unknown, limit: number): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
    : "";

/** A tool call, said the way a person would say it. */
function describeTool(name: string, input: Record<string, unknown>): string {
  const path = clean(input.file_path ?? input.path ?? input.notebook_path, 120);
  switch (name) {
    case "Read": return path ? `Reading ${path}` : "Reading a file";
    case "Write": return path ? `Writing ${path}` : "Writing a file";
    case "Edit": return path ? `Editing ${path}` : "Editing a file";
    case "Bash": return `Running ${clean(input.command, 120) || "a command"}`;
    case "Glob": return `Looking for ${clean(input.pattern, 80) || "files"}`;
    case "Grep": return `Searching for ${clean(input.pattern, 80) || "something"}`;
    case "TodoWrite": return "Updating its task list";
    default: return `${name}${path ? ` ${path}` : ""}`;
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Turns one stream-json line into something worth showing, or nothing.
 *
 * Returning null for an unrecognised event is the correct behaviour, not a gap:
 * the CLI adds event types over time, and a viewer that breaks on an unfamiliar
 * one would be worse than a viewer that quietly skips it.
 */
export function readActivityLine(line: string, now: string): ActivityEvent | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  const event = object(value);
  if (!event.type) return null;

  if (event.type === "assistant" || event.type === "user") {
    const message = object(event.message);
    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const part = object(raw);
      if (part.type === "thinking") {
        const text = clean(part.thinking, MAX_LABEL_CHARS);
        if (text) return { at: now, kind: "thinking", label: text };
      }
      if (part.type === "text") {
        const text = clean(part.text, MAX_LABEL_CHARS);
        if (text) return { at: now, kind: "text", label: text, detail: clean(part.text, MAX_DETAIL_CHARS) };
      }
      if (part.type === "tool_use") {
        return {
          at: now, kind: "tool",
          label: describeTool(clean(part.name, 60) || "tool", object(part.input)),
          detail: clean(JSON.stringify(part.input ?? {}), MAX_DETAIL_CHARS)
        };
      }
    }
    return null;
  }

  if (event.type === "result") {
    // The authoritative outcome is read elsewhere, from the completed process.
    // This is the "it finished" line a watcher wants to see.
    const errored = event.is_error === true;
    return {
      at: now,
      kind: errored ? "error" : "result",
      label: errored ? "The turn ended with an error" : "The turn finished",
      detail: clean(event.result ?? (Array.isArray(event.errors) ? event.errors.join(" ") : ""), MAX_DETAIL_CHARS)
    };
  }

  return null;
}

/**
 * Accumulates stdout chunks and emits activity as whole lines arrive.
 *
 * Chunks split anywhere, including mid-character and mid-line, so a partial
 * tail is held back rather than parsed. Bounded: a runaway producer costs a
 * fixed amount of memory, not all of it.
 */
export class ActivityStream {
  private buffer = "";
  private readonly events: ActivityEvent[] = [];
  private readonly now: () => string;
  private readonly onEvent?: (event: ActivityEvent) => void;

  constructor(now: () => string, onEvent?: (event: ActivityEvent) => void) {
    this.now = now;
    this.onEvent = onEvent;
  }

  push(chunk: string): ActivityEvent[] {
    this.buffer += chunk;
    const produced: ActivityEvent[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const event = readActivityLine(line, this.now());
      if (!event) continue;
      produced.push(event);
      this.events.push(event);
      if (this.events.length > MAX_ACTIVITY_EVENTS) this.events.shift();
      this.onEvent?.(event);
    }
    // A single line longer than the cap is malformed for our purposes; drop the
    // buffer rather than growing it without limit.
    if (this.buffer.length > 512 * 1024) this.buffer = "";
    return produced;
  }

  /** The window a viewer shows. Newest last. */
  recent(): ActivityEvent[] {
    return [...this.events];
  }
}

/** In-memory, per run. Discarded when the app closes; nothing here is durable. */
export class LiveActivity {
  private readonly streams = new Map<string, ActivityStream>();
  private readonly now: () => string;
  private readonly onChange?: (runId: string) => void;

  constructor(now: () => string, onChange?: (runId: string) => void) {
    this.now = now;
    this.onChange = onChange;
  }

  /** Starts a fresh window for a turn. The previous turn's events are dropped. */
  begin(runId: string): (chunk: string) => void {
    const stream = new ActivityStream(this.now, () => this.onChange?.(runId));
    this.streams.set(runId, stream);
    return (chunk: string) => { stream.push(chunk); };
  }

  recent(runId: string): ActivityEvent[] {
    return this.streams.get(runId)?.recent() ?? [];
  }

  clear(runId: string): void {
    this.streams.delete(runId);
  }
}
