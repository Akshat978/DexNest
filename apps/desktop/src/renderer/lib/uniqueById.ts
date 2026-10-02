/** The first item for each id, in order. Lists built from overlapping sources
 * (Calendar's today + upcoming nudges) would otherwise show an item twice. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}
