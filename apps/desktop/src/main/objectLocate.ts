// Where things are, on top of ObjectOS.
//
// Finder used to keep "what is where" in a file of its own. That now lives in
// ObjectOS (an object plus its whereabouts), and this file is the small bridge
// the rest of the main process uses for it: the shape the search index, the
// nudges, voice and Capture already speak, mapped to and from ObjectOS, and the
// one-time move of the old file's items.
//
// Pure apart from the module calls it is handed: no file access of its own.

import type { LocatedObject, ObjectOsModule } from "@dexnest/object-os";

export type LocatedStatus = "at_home" | "lent_out" | "missing" | "archived";

/** One located thing, as the search index, nudges, voice and Capture read it. */
export interface LocatedItem {
  id: string;
  itemName: string;
  location: string;
  room?: string;
  container?: string;
  notes?: string;
  tags: string[];
  status: LocatedStatus;
  lentTo?: string | null;
  lentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An item as the old Finder file held it. Read once, by the migration. */
export interface LegacyFinderItem {
  id?: string;
  itemName?: string;
  location?: string;
  room?: string;
  container?: string;
  notes?: string;
  tags?: string[];
  status?: string;
  lentTo?: string | null;
  lentAt?: string | null;
  confidence?: string;
  createdAt?: string;
  updatedAt?: string;
}

type Locator = Pick<ObjectOsModule, "quickAdd" | "locateObject" | "saveObject" | "setStatus" | "deleteObject" | "findObjects" | "whatIsIn" | "whereabouts" | "store">;

export function statusOf(object: LocatedObject): LocatedStatus {
  if (object.whereabouts.missing) return "missing";
  if (object.status === "lent_out") return "lent_out";
  if (object.status === "sold" || object.status === "disposed") return "archived";
  return "at_home";
}

export function itemOf(object: LocatedObject): LocatedItem {
  const w = object.whereabouts;
  return {
    id: object.id,
    itemName: object.name,
    location: object.location,
    room: w.room,
    container: w.container,
    notes: object.notes,
    tags: object.tags,
    status: statusOf(object),
    lentTo: w.lentTo || null,
    lentAt: w.lentAt,
    createdAt: object.createdAt,
    // When its place last changed, if later than the record itself: "recently located" sorts by this.
    updatedAt: w.locatedAt && w.locatedAt > object.updatedAt ? w.locatedAt : object.updatedAt
  };
}

/** Every object with where it is. */
export function allItems(module: Locator): LocatedItem[] {
  return module.store.locate({ limit: 5000 }).map(itemOf);
}

const errorOf = (errors: readonly string[]) => new Error(errors.join("; "));

/** Tags as ObjectOS accepts them: lower case, plain characters, no empties, no repeats. */
export function cleanTags(tags: readonly unknown[] | undefined): string[] {
  const seen = new Set<string>();
  for (const tag of tags ?? []) {
    if (typeof tag !== "string") continue;
    const clean = tag.toLowerCase().replace(/[^a-z0-9 ._-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (clean) seen.add(clean);
  }
  return [...seen].slice(0, 20);
}

export interface RememberInput {
  itemName?: string;
  location?: string;
  room?: string;
  container?: string;
  notes?: string;
  tags?: string[];
  lentTo?: string | null;
}

/** A new thing and where it is. */
export function rememberItem(module: Locator, input: RememberInput): LocatedItem {
  const result = module.quickAdd({
    name: input.itemName?.trim() || "Untitled item",
    location: input.location?.trim() ?? "",
    room: input.room?.trim() ?? "",
    container: input.container?.trim() ?? "",
    notes: input.notes ?? "",
    tags: cleanTags(input.tags),
    ...(input.lentTo?.trim() ? { lentTo: input.lentTo.trim() } : {})
  });
  if (!result.ok) throw errorOf(result.errors);
  return itemOf(result.value);
}

/** Changes the name, notes or tags of a thing, and its place when given. */
export function reviseItem(module: Locator, id: string, input: RememberInput): LocatedItem {
  const found = module.whereabouts(id);
  if (!found.ok) throw new Error("That item was not found.");
  const before = found.value;
  const saved = module.saveObject({
    id: before.id,
    name: input.itemName?.trim() || before.name,
    category: before.category,
    make: before.make,
    model: before.model,
    serial: before.serial,
    location: input.location?.trim() ?? before.location,
    status: before.status,
    notes: input.notes ?? before.notes,
    tags: input.tags ? cleanTags(input.tags) : before.tags,
    parentId: before.parentId
  });
  if (!saved.ok) throw errorOf(saved.errors);
  if (input.room !== undefined || input.container !== undefined || input.location !== undefined) {
    const placed = module.locateObject({
      objectId: before.id,
      ...(input.location !== undefined ? { location: input.location.trim() } : {}),
      ...(input.room !== undefined ? { room: input.room.trim() } : {}),
      ...(input.container !== undefined ? { container: input.container.trim() } : {})
    });
    if (!placed.ok) throw errorOf(placed.errors);
    return itemOf(placed.value);
  }
  return itemOf({ ...saved.value, whereabouts: before.whereabouts });
}

export type PlaceChange =
  | { kind: "moved"; location?: string; room?: string; container?: string }
  | { kind: "lent"; to: string }
  | { kind: "returned" }
  | { kind: "missing"; missing: boolean }
  | { kind: "archived" };

export function changePlace(module: Locator, id: string, change: PlaceChange): LocatedItem {
  if (change.kind === "archived") {
    // "Archived" in Finder meant put away and out of the list: ObjectOS calls that stored.
    const stored = module.setStatus({ id, status: "stored" });
    if (!stored.ok) throw errorOf(stored.errors);
    const now = module.whereabouts(id);
    if (!now.ok) throw errorOf(now.errors);
    return itemOf(now.value);
  }
  const input =
    change.kind === "moved"
      ? {
          ...(change.location !== undefined ? { location: change.location } : {}),
          ...(change.room !== undefined ? { room: change.room } : {}),
          ...(change.container !== undefined ? { container: change.container } : {}),
          // Moved somewhere at home: it is no longer with whoever had it.
          returned: true
        }
      : change.kind === "lent"
        ? { lentTo: change.to.trim() || "someone" }
        : change.kind === "returned"
          ? { returned: true }
          : { missing: change.missing };
  const result = module.locateObject({ objectId: id, ...input });
  if (!result.ok) throw errorOf(result.errors);
  return itemOf(result.value);
}

export function forgetItem(module: Locator, id: string): void {
  const result = module.deleteObject({ id });
  if (!result.ok) throw errorOf(result.errors);
}

/** "Where is my…": every word must match. An empty question lists everything. */
export function findItems(module: Locator, query: string, status: LocatedStatus | "all" = "all"): LocatedItem[] {
  const text = query.trim();
  const found = text ? module.findObjects(text) : { ok: true as const, value: module.store.locate({ limit: 500 }) };
  const items = found.ok ? found.value.map(itemOf) : [];
  return status === "all" ? items : items.filter((item) => item.status === status);
}

/** "What is in…": things whose place, room or container matches. */
export function itemsIn(module: Locator, place: string): LocatedItem[] {
  const found = module.whatIsIn(place);
  return found.ok ? found.value.map(itemOf) : [];
}

export interface FinderMigration {
  moved: number;
  /** Items that could not be created, with why. Nothing is deleted when this is not empty. */
  failed: { name: string; reason: string }[];
}

/**
 * Moves the old Finder file's items into ObjectOS, each as an object with
 * only a name and a place. Nothing Finder held is dropped: what ObjectOS has
 * no field for (how sure the place was, that it was archived) goes into the
 * notes in words.
 */
export function migrateFinderItems(module: Locator, items: readonly LegacyFinderItem[]): FinderMigration {
  const out: FinderMigration = { moved: 0, failed: [] };
  for (const item of items) {
    const name = (item.itemName ?? "").trim() || "Untitled item";
    const extra: string[] = [];
    if (item.confidence === "maybe") extra.push("Finder: not sure this is where it is.");
    if (item.confidence === "old") extra.push("Finder: this place may be out of date.");
    if (item.status === "archived") extra.push("Finder: archived.");
    const notes = [item.notes?.trim(), ...extra].filter(Boolean).join("\n");
    const lent = item.status === "lent_out";
    const result = module.quickAdd({
      name,
      location: (item.location ?? "").trim() === "Unknown location" ? "" : (item.location ?? "").trim(),
      room: (item.room ?? "").trim(),
      container: (item.container ?? "").trim(),
      notes,
      tags: cleanTags(item.tags),
      ...(lent ? { lentTo: (item.lentTo ?? "").trim() || "someone", ...(item.lentAt ? { lentAt: item.lentAt } : {}) } : {}),
      ...(item.status === "missing" ? { missing: true } : {})
    });
    if (!result.ok) {
      out.failed.push({ name, reason: result.errors.join("; ") });
      continue;
    }
    if (item.status === "archived") module.setStatus({ id: result.value.id, status: "stored" });
    out.moved += 1;
  }
  return out;
}
