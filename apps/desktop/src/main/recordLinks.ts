// Links between records in different modules.
//
// When one module sends something to another (a capture filed in Finance, an
// object's warranty end put in Calendar), the two records are remembered as a
// pair, so each can show where it came from or where it went. A link holds two
// ids and the two titles as they were when it was made; it copies nothing else
// and gives neither module a way to read the other.
//
// Electron-free: main.ts reads and writes the file.

export interface RecordRef {
  /** The id of the screen the record lives in: capture, journal, calendar, finance, vault, object. */
  module: string;
  id: string;
  title: string;
}

export interface RecordLink {
  id: string;
  from: RecordRef;
  to: RecordRef;
  createdAt: string;
}

/** One end of a link, as the screen showing the other end needs it. */
export interface RecordLinkChip {
  linkId: string;
  /** The record on this screen. */
  recordId: string;
  recordTitle: string;
  /** "to": this record was sent there. "from": this record came from there. */
  direction: "to" | "from";
  other: RecordRef;
  createdAt: string;
}

export const LINK_MODULES: readonly string[] = ["capture", "journal", "calendar", "finance", "vault", "object"];

const MAX_LINKS = 5000;
const MAX_TITLE = 120;

function ref(value: unknown): RecordRef | null {
  if (typeof value !== "object" || value === null) return null;
  const { module, id, title } = value as Record<string, unknown>;
  if (typeof module !== "string" || !LINK_MODULES.includes(module)) return null;
  if (typeof id !== "string" || !id || id.length > 200) return null;
  return { module, id, title: typeof title === "string" ? title.slice(0, MAX_TITLE) : "" };
}

/** What the file holds, with anything malformed left out. */
export function normalizeLinks(value: unknown): RecordLink[] {
  if (!Array.isArray(value)) return [];
  const links: RecordLink[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const from = ref(raw.from);
    const to = ref(raw.to);
    if (!from || !to || typeof raw.id !== "string" || typeof raw.createdAt !== "string") continue;
    links.push({ id: raw.id, from, to, createdAt: raw.createdAt });
  }
  return links;
}

const same = (a: RecordRef, b: RecordRef) => a.module === b.module && a.id === b.id;

/**
 * The list with one more link, newest first. The same pair is not recorded
 * twice, a record is not linked to itself, and an end that is not a known
 * module is refused: the list comes back unchanged.
 */
export function addLink(links: readonly RecordLink[], from: RecordRef, to: RecordRef, now: string, newId: () => string): RecordLink[] {
  const a = ref(from);
  const b = ref(to);
  if (!a || !b || same(a, b)) return [...links];
  if (links.some((link) => same(link.from, a) && same(link.to, b))) return [...links];
  return [{ id: newId(), from: a, to: b, createdAt: now }, ...links].slice(0, MAX_LINKS);
}

/** Links whose two records both still exist. */
export function pruneLinks(links: readonly RecordLink[], exists: (ref: RecordRef) => boolean): RecordLink[] {
  return links.filter((link) => exists(link.from) && exists(link.to));
}

/** Every link with an end in this module, from that module's side. */
export function chipsFor(links: readonly RecordLink[], module: string): RecordLinkChip[] {
  const chips: RecordLinkChip[] = [];
  for (const link of links) {
    if (link.from.module === module) chips.push({ linkId: link.id, recordId: link.from.id, recordTitle: link.from.title, direction: "to", other: link.to, createdAt: link.createdAt });
    if (link.to.module === module) chips.push({ linkId: link.id, recordId: link.to.id, recordTitle: link.to.title, direction: "from", other: link.from, createdAt: link.createdAt });
  }
  return chips;
}
