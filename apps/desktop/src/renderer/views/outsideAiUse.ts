// One Outside AI button in a screen: whether it is shown, and what happens when it is clicked.
//
// A button is shown only when the user has switched its use on in Settings,
// with the data it needs and a key. The screen sends an id or a question; the
// main process gathers what is sent and checks the switches again itself.

import { useCallback, useEffect, useState } from "react";

import { canUse, type OutsideAiState, type OutsideAiUse } from "./outsideAiModel";

interface Bridge {
  getOutsideAiState?(): Promise<OutsideAiState>;
  runAction?(request: { actionId: string; source: "module_ui"; params: Record<string, unknown> }): Promise<unknown>;
}

function bridge(): Bridge {
  return (typeof window === "undefined" ? undefined : (window as unknown as { dexNest?: Bridge }).dexNest) ?? {};
}

export interface OutsideAiButton<R> {
  /** Whether the button is shown at all. */
  on: boolean;
  busy: boolean;
  /** Why the last click gave nothing, in words, or null. */
  error: string | null;
  /** Asks. Resolves to the answer, or null when there is none (and `error` says why). */
  ask(params?: Record<string, unknown>): Promise<R | null>;
}

export function useOutsideAi<R extends object>(use: OutsideAiUse, actionId: string): OutsideAiButton<R> {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (bridge().getOutsideAiState?.() ?? Promise.resolve(null))
      .then((state) => { if (live) setOn(canUse(state, use)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [use]);

  const ask = useCallback(async (params: Record<string, unknown> = {}): Promise<R | null> => {
    const run = bridge().runAction;
    if (!run) return null;
    setBusy(true);
    setError(null);
    try {
      const result = (await run({ actionId, source: "module_ui", params })) as ({ ok?: boolean; error?: string } & R) | null | undefined;
      if (!result || result.ok === false) {
        setError(result?.error ?? "Outside AI gave no answer.");
        return null;
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outside AI gave no answer.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [actionId]);

  return { on, busy, error, ask };
}
