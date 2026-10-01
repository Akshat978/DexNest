/**
 * Objects inside objects. Moving one is refused when it would put an object
 * inside itself or inside one of its own components.
 */

export const MAX_COMPONENT_DEPTH = 32;

/**
 * True when making `parentId` the parent of `objectId` would create a cycle
 * (or a chain deeper than MAX_COMPONENT_DEPTH). `parentOf` answers for the
 * current tree.
 */
export function wouldCreateCycle(objectId: string, parentId: string | null, parentOf: (id: string) => string | null): boolean {
  if (parentId === null) return false;
  if (parentId === objectId) return true;
  const seen = new Set<string>([objectId]);
  let current: string | null = parentId;
  for (let depth = 0; current !== null; depth++) {
    if (seen.has(current) || depth >= MAX_COMPONENT_DEPTH) return true;
    seen.add(current);
    current = parentOf(current);
  }
  return false;
}
