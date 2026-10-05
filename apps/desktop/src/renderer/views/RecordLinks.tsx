/**
 * Where a record went, and where it came from.
 *
 * A capture filed in Finance shows "Sent to Finance"; the Finance entry shows
 * "From Capture". Clicking either opens the other module's screen. The chip
 * carries the other record's title so it can be found there.
 */

import { useEffect, useState } from "react";
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
          title={`${chipLabel(chip)}. Opens ${moduleName(chip.other.module)}.`}
          onClick={(event) => { event.stopPropagation(); openLinkedScreen(chip.other.module); }}
        >
          <span className="record-link-title">{chipLabel(chip)}</span>
        </button>
      ))}
    </span>
  );
}

/** Every linked record on one screen, for screens that do not list their records one by one. */
export function RecordLinksList({ chips, limit = 8 }: { chips: readonly RecordLinkChip[]; limit?: number }) {
  if (chips.length === 0) return null;
  return (
    <ul className="record-links-list">
      {chips.slice(0, limit).map((chip) => (
        <li key={`${chip.linkId}-${chip.direction}`}>
          <span>{chip.recordTitle || "Untitled"}</span>
          <RecordLinkChips chips={[chip]} recordId={chip.recordId} />
        </li>
      ))}
    </ul>
  );
}
