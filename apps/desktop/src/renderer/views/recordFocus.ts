// The record a link chip asked another screen to open.
//
// One request at a time: clicking a chip names a module and a record, the
// shell changes screen, and that screen takes the request, shows the record
// and clears it. A request nobody takes (the record was deleted meanwhile)
// is dropped after a few seconds so it cannot fire on a later visit.
//
// No React and no DOM, so it can be tested on its own.

export interface FocusRequest {
  module: string;
  id: string;
  at: number;
}

/** How long a request waits for its screen. */
export const FOCUS_TTL_MS = 8000;

let pending: FocusRequest | null = null;
const listeners = new Set<() => void>();
const tell = () => { for (const listener of listeners) listener(); };

export function requestFocus(module: string, id: string, now: number = Date.now()): void {
  pending = module && id ? { module, id, at: now } : null;
  tell();
}

/** The record id waiting for this module's screen, or null. */
export function pendingFocus(module: string, now: number = Date.now()): string | null {
  if (!pending || pending.module !== module) return null;
  if (now - pending.at > FOCUS_TTL_MS) {
    pending = null;
    return null;
  }
  return pending.id;
}

/** Done with: only the request it names is cleared, so a newer one is not lost. */
export function clearFocus(module: string, id: string): void {
  if (pending && pending.module === module && pending.id === id) {
    pending = null;
    tell();
  }
}

export function subscribeFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The value of the `data-record` attribute on a record's row. */
export function focusMarker(module: string, id: string): string {
  return `${module}:${id}`;
}
