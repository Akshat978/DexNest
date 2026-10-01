/**
 * What other modules may see of an object (GhostOS, RoomCompiler, Reality
 * RPG, later). Enough to show, place or reward an object - never its serial
 * number, price, shop, notes, receipt or files.
 */

import type { ObjectRecord } from './types.ts';

export const PUBLIC_OBJECT_FIELDS = ['id', 'name', 'category', 'make', 'model', 'location', 'status', 'tags', 'parentId', 'createdAt', 'updatedAt'] as const;

export type PublicObject = Pick<ObjectRecord, (typeof PUBLIC_OBJECT_FIELDS)[number]>;

/** Copies only the public fields: nothing else can slip through by being added to ObjectRecord later. */
export function toPublicObject(o: ObjectRecord): PublicObject {
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    make: o.make,
    model: o.model,
    location: o.location,
    status: o.status,
    tags: [...o.tags],
    parentId: o.parentId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
