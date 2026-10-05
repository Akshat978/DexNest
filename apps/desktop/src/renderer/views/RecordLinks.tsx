/**
 * Where a record went, and where it came from.
 *
 * A capture filed in Finance shows "Sent to Finance"; the Finance entry shows
 * "From Capture". Clicking either opens the other module's screen. The chip
 * carries the other record's title so it can be found there.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { clearFocus, focusMarker, pendingFocus, requestFocus, subscribeFocus } from "./recordFocus";
import { moduleName } from "../lib/activityLabels";
import "./RecordLinks.css";

export interface RecordLinkChip {
  linkId: string;
  recordId: string;
  recordTitle: string;
  direction: "to" | "from";
  other: { module: string; id: string; title: string };
  createdAt: string;
}

export interface RecordLinksBridge {
  getRecordLinks?(module: string): Promise<RecordLinkChip[]>;
}

/** The event the shell listens for to change screen. */
export const NAVIGATE_EVENT = "dexnest:navigate";

export function openLinkedScreen(module: string): void {
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: module }));
}

/** Opens the other module's screen on that record: the screen picks it up with `useRecordFocus`. */
export function openLinkedRecord(module: string, id: string): void {
  requestFocus(module, id);
  openLinkedScreen(module);
}

/**
 * The record this screen was asked to open, or null. The screen selects it
 * (opens the document, loads the entry) in an effect and then calls
 * `shown`, which also scrolls to the record's row and marks it for a moment.
 */
export function useRecordFocus(module: string): { id: string | null; shown(): void } {
  const id = useSyncExternalStore(subscribeFocus, () => pendingFocus(module), () => null);
  return {
    id,
    shown() {
      if (!id) return;
      clearFocus(module, id);
      markRecord(module, id);
    }
  };
}

/** Scrolls to the row carrying this record's marker and outlines it briefly. Tries for a moment, since the row may not be drawn yet. */
function markRecord(module: string, id: string, attempt = 0): void {
  const row = document.querySelector<HTMLElement>(`[data-record="${CSS.escape(focusMarker(module, id))}"]`);
  if (!row) {
    if (attempt < 12) window.setTimeout(() => markRecord(module, id, attempt + 1), 120);
    return;
  }
  row.scrollIntoView({ block: "center" });
  row.classList.add("record-focus");
  window.setTimeout(() => row.classList.remove("record-focus"), 2600);
}

/** What the chip says: "Sent to Finance: Hardware store". */
export function chipLabel(chip: Pick<RecordLinkChip, "direction" | "other">): string {
  const where = `${chip.direction === "to" ? "Sent to" : "From"} ${moduleName(chip.other.module)}`;
  return chip.other.title ? `${where}: ${chip.other.title}` : where;
}

/** One screen's links, read when it opens and whenever `refreshKey` changes. */
export function useRecordLinks(bridge: RecordLinksBridge, module: string, refreshKey: unknown = 0): RecordLinkChip[] {
  const [chips, setChips] = useState<RecordLinkChip[]>([]);
  useEffect(() => {
    let live = true;
    void (bridge.getRecordLinks?.(module) ?? Promise.resolve([]))
      .then((next) => { if (live) setChips(Array.isArray(next) ? next : []); })
      .catch(() => { if (live) setChips([]); });
    return () => { live = false; };
  }, [bridge, module, refreshKey]);
  return chips;
}

export function RecordLinkChips({ chips, recordId }: { chips: readonly RecordLinkChip[]; recordId: string }) {
  const mine = chips.filter((chip) => chip.recordId === recordId);
  if (mine.length === 0) return null;
  return (
    <span className="record-links">
      {mine.map((chip) => (
        <button
          key={`${chip.linkId}-${chip.direction}`}
          type="button"
          className="record-link"
          title={`${chipLabel(chip)}. Opens it in ${moduleName(chip.other.module)}.`}
          onClick={(event) => { event.stopPropagation(); openLinkedRecord(chip.other.module, chip.other.id); }}
        >
          <span className="record-link-title">{chipLabel(chip)}</span>
        </button>
      ))}
    </span>
  );
}

/** Every linked record on one screen, for screens that do not list their records one by one. */
export function RecordLinksList({ chips, module, limit = 8, focusId = null }: { chips: readonly RecordLinkChip[]; module: string; limit?: number; focusId?: string | null }) {
  if (chips.length === 0) return null;
  // The record a chip elsewhere pointed at is listed even when it is past the limit.
  const shown = chips.slice(0, limit);
  const wanted = focusId ? chips.find((chip) => chip.recordId === focusId) : undefined;
  if (wanted && !shown.includes(wanted)) shown.push(wanted);
  return (
    <ul className="record-links-list">
      {shown.map((chip) => (
        <li key={`${chip.linkId}-${chip.direction}`} data-record={focusMarker(module, chip.recordId)}>
          <span>{chip.recordTitle || "Untitled"}</span>
          <RecordLinkChips chips={[chip]} recordId={chip.recordId} />
        </li>
      ))}
    </ul>
  );
}
