/** Tiny bounded concurrency pool. */

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners: Promise<void>[] = [];
  const limit = Math.max(1, concurrency);

  const run = async () => {
    while (true) {
      if (shouldStop?.()) return;
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  };

  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(run());
  }
  await Promise.all(runners);
  return results;
}
