/**
 * TODO lifecycle reconcile: created / unchanged / moved / renamed / resolved.
 * Does not store whole source files — markers only.
 */

import type {
  TodoLifecycleResult,
  TodoMarker,
  TodoStore,
} from '@dexnest/dev-intelligence-contracts';
import {
  observationToMarker,
  type ObservedTodo,
} from './scan.js';

function sameDirDifferentName(a: string, b: string): boolean {
  const ai = a.lastIndexOf('/');
  const bi = b.lastIndexOf('/');
  const ad = ai >= 0 ? a.slice(0, ai) : '';
  const bd = bi >= 0 ? b.slice(0, bi) : '';
  const an = ai >= 0 ? a.slice(ai + 1) : a;
  const bn = bi >= 0 ? b.slice(bi + 1) : b;
  return ad === bd && an !== bn;
}

export interface ReconcileTodosResult {
  results: TodoLifecycleResult[];
  open: TodoMarker[];
  resolved: TodoMarker[];
}

export async function reconcileTodos(options: {
  repositoryId: string;
  observed: ObservedTodo[];
  store: TodoStore;
  now?: string;
  /**
   * Whether `observed` covers every candidate file. When false, markers not
   * seen are left open rather than resolved: a partial scan says nothing about
   * the files it did not read. Defaults to true for existing callers.
   */
  complete?: boolean;
}): Promise<ReconcileTodosResult> {
  const now = options.now ?? new Date().toISOString();
  const existing = await options.store.listByRepository(options.repositoryId);
  const byFp = new Map(existing.map((m) => [m.fingerprint, m]));
  const seen = new Set<string>();
  const results: TodoLifecycleResult[] = [];
  const open: TodoMarker[] = [];
  const resolved: TodoMarker[] = [];

  for (const obs of options.observed) {
    seen.add(obs.fingerprint);
    const prev = byFp.get(obs.fingerprint);
    const marker = observationToMarker(
      options.repositoryId,
      obs,
      now,
      prev && prev.status === 'open' ? prev : prev,
    );

    let action: TodoLifecycleResult['action'];
    if (!prev || prev.status === 'resolved') {
      // re-open or create
      const created: TodoMarker = {
        ...marker,
        firstObservedAt: prev?.firstObservedAt ?? now,
        status: 'open',
        resolvedAt: undefined,
      };
      action = 'created';
      await options.store.upsert(created);
      results.push({ action, marker: created });
      open.push(created);
      continue;
    }

    if (prev.filePath === obs.filePath && prev.line === obs.line) {
      action = 'unchanged';
    } else if (sameDirDifferentName(prev.filePath, obs.filePath)) {
      action = 'renamed';
    } else if (prev.filePath !== obs.filePath) {
      action = 'moved';
    } else {
      action = 'unchanged'; // line-only shift
    }

    const updated: TodoMarker = {
      ...marker,
      firstObservedAt: prev.firstObservedAt,
      previousFilePath:
        prev.filePath !== obs.filePath ? prev.filePath : prev.previousFilePath,
      status: 'open',
      resolvedAt: undefined,
    };
    await options.store.upsert(updated);
    results.push({ action, marker: updated });
    open.push(updated);
  }

  for (const prev of existing) {
    if (options.complete === false) break;
    if (prev.status !== 'open') continue;
    if (seen.has(prev.fingerprint)) continue;
    const closed: TodoMarker = {
      ...prev,
      status: 'resolved',
      resolvedAt: now,
      lastObservedAt: prev.lastObservedAt,
    };
    await options.store.upsert(closed);
    results.push({ action: 'resolved', marker: closed });
    resolved.push(closed);
  }

  return { results, open, resolved };
}
