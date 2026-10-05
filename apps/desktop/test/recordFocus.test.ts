/**
 * A link chip opens the record itself, not just the screen it is on; and
 * things sent to the Calendar before links were kept get their link.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearFocus, FOCUS_TTL_MS, focusMarker, pendingFocus, requestFocus, subscribeFocus } from "../src/renderer/views/recordFocus.ts";
import { addLink, backfillFromCalendar, chipsFor, type RecordLink, type RecordRef } from "../src/main/recordLinks.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(desktop, path), "utf8").replace(/\r\n/g, "\n");

test("a request names one record on one screen, and only that screen sees it", () => {
  requestFocus("finance", "f1", 1000);
  assert.equal(pendingFocus("finance", 1000), "f1");
  assert.equal(pendingFocus("vault", 1000), null, "another screen is not told");
  assert.equal(pendingFocus("finance", 1000), "f1", "reading it does not use it up: a screen may draw more than once first");
  clearFocus("finance", "f1");
  assert.equal(pendingFocus("finance", 1000), null);
});

test("a newer request replaces an older one, and finishing the old one does not lose the new", () => {
  requestFocus("calendar", "e1", 1000);
  requestFocus("calendar", "e2", 1001);
  assert.equal(pendingFocus("calendar", 1001), "e2");
  clearFocus("calendar", "e1");
  assert.equal(pendingFocus("calendar", 1001), "e2");
  requestFocus("object", "o1", 1002);
  assert.equal(pendingFocus("calendar", 1002), null, "one request at a time");
  clearFocus("object", "o1");
});

test("a request nobody takes is dropped, so it cannot fire on a later visit", () => {
  requestFocus("journal", "gone", 1000);
  assert.equal(pendingFocus("journal", 1000 + FOCUS_TTL_MS), "gone");
  assert.equal(pendingFocus("journal", 1000 + FOCUS_TTL_MS + 1), null);
  assert.equal(pendingFocus("journal", 1000), null, "and it stays dropped");
  requestFocus("", "x", 1);
  assert.equal(pendingFocus("", 1), null, "nothing is asked of no screen");
});

test("screens are told when a request arrives and when it is done", () => {
  let told = 0;
  const stop = subscribeFocus(() => { told += 1; });
  requestFocus("vault", "d1", 5);
  clearFocus("vault", "d1");
  clearFocus("vault", "d1");
  assert.equal(told, 2, "once for the request, once for its end, not again for nothing");
  stop();
  requestFocus("vault", "d2", 6);
  assert.equal(told, 2);
  clearFocus("vault", "d2");
  assert.equal(focusMarker("finance", "f1"), "finance:f1");
});

test("a chip asks for the record, and every linked screen answers", () => {
  const links = read("src/renderer/views/RecordLinks.tsx");
  assert.match(links, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openLinkedRecord\(chip\.other\.module, chip\.other\.id\); \}\}/);
  assert.match(links, /export function openLinkedRecord\(module: string, id: string\): void \{\s*requestFocus\(module, id\);\s*openLinkedScreen\(module\);/);
  assert.match(links, /<li key=\{`\$\{chip\.linkId\}-\$\{chip\.direction\}`\} data-record=\{focusMarker\(module, chip\.recordId\)\}>/);
  assert.match(links, /if \(wanted && !shown\.includes\(wanted\)\) shown\.push\(wanted\);/, "the record asked for is listed even past the limit");

  const shell = read("src/renderer/main.tsx");
  for (const module of ["vault", "journal", "calendar", "finance", "capture"]) assert.match(shell, new RegExp(`useRecordFocus\\("${module}"\\)`), module);
  assert.match(shell, /setDetailDocId\(vaultFocus\.id\);\s*vaultFocus\.shown\(\);/, "the Vault opens the document");
  assert.match(shell, /loadEntry\(wanted\);\s*journalFocus\.shown\(\);/, "the Journal loads the entry");
  assert.match(shell, /if \(isProviderEvent\(wanted\)\) \{ setSelectedDate\(wanted\.date\); setSelectedEventId\(wanted\.id\); \} else loadEvent\(wanted\);/, "the Calendar selects the event and moves to its day, as a click does");
  assert.match(shell, /if \(entry\) loadTransaction\(entry\); else if \(bill\) loadRecurring\(bill\);/, "Finance opens the entry, or the recurring bill");
  assert.match(shell, /data-record=\{focusMarker\("finance", t\.id\)\}/);
  assert.match(shell, /data-record=\{focusMarker\("journal", entry\.id\)\}/);
  assert.match(read("src/renderer/views/ObjectOsView.tsx"), /if \(!focus\.id \|\| !objects\.some\(\(o\) => o\.id === focus\.id\)\) return;\s*void openObject\(focus\.id\);\s*focus\.shown\(\);/);
  // A record that is not there is left alone: no screen opens something else in its place.
  assert.match(shell, /if \(!vaultFocus\.id \|\| !vaultState\.documents\.some\(\(d\) => d\.id === vaultFocus\.id\)\) return;/);
  assert.match(read("src/renderer/views/RecordLinks.css"), /\.record-focus \{\s*outline: 2px solid var\(--focus-ring\);/);
});

const ids = () => { let n = 0; return () => `link-${++n}`; };
const NOW = "2026-10-05T12:00:00.000Z";

test("events sent to the Calendar earlier get their link, from what the event already says", () => {
  const records: Record<string, RecordRef> = {
    "object:o1": { module: "object", id: "o1", title: "Cordless drill" },
    "capture:c1": { module: "capture", id: "c1", title: "Book the dentist" },
    "finance:r1": { module: "finance", id: "r1", title: "Rent" }
  };
  const resolve = (module: string, id: string) => records[`${module}:${id}`] ?? null;
  const events = [
    { id: "e1", title: "Warranty ends: Cordless drill", sourceModule: "object", sourceId: "o1", createdAt: "2026-09-01T10:00:00.000Z" },
    { id: "e2", title: "Book the dentist", sourceModule: "capture", sourceId: "c1" },
    { id: "e3", title: "Rent due", sourceModule: "finance", sourceId: "r1", createdAt: "2026-09-02T10:00:00.000Z" },
    { id: "e4", title: "Lunch", sourceModule: "calendar", sourceId: null },
    { id: "e5", title: "From a deleted note", sourceModule: "capture", sourceId: "gone" },
    { id: "e6", title: "Synced", sourceModule: "google", sourceId: "abc" },
    { id: "e7", title: "No source id", sourceModule: "journal" }
  ];
  const made = backfillFromCalendar([], events, resolve, NOW, ids());
  assert.deepEqual(made.map((l) => `${l.from.module}:${l.from.id}>${l.to.id}`).sort(), ["capture:c1>e2", "finance:r1>e3", "object:o1>e1"]);
  assert.equal(made.find((l) => l.to.id === "e1")!.createdAt, "2026-09-01T10:00:00.000Z", "dated when it was sent");
  assert.equal(made.find((l) => l.to.id === "e2")!.createdAt, NOW, "or now, when the event does not say");
  assert.deepEqual(chipsFor(made, "object").map((c) => [c.direction, c.other.module, c.other.title]), [["to", "calendar", "Warranty ends: Cordless drill"]]);

  // Run again, or over links made the usual way: nothing is doubled.
  assert.equal(backfillFromCalendar(made, events, resolve, NOW, ids()).length, 3);
  const already: RecordLink[] = addLink([], records["object:o1"]!, { module: "calendar", id: "e1", title: "Warranty ends: Cordless drill" }, NOW, ids());
  assert.equal(backfillFromCalendar(already, events, resolve, NOW, ids()).length, 3);
});

test("the back-fill runs once per start, reads only the Calendar's own record of the source, and cannot fail a screen", () => {
  const main = read("src/main/main.ts");
  const fn = main.slice(main.indexOf("function backfillRecordLinks"), main.indexOf("/** The links one screen shows"));
  assert.match(fn, /if \(recordLinksBackfilled\) return;\s*recordLinksBackfilled = true;/);
  assert.match(fn, /backfillFromCalendar\(links, loadCalendarEvents\(\), linkedRecordTitle,/);
  assert.match(fn, /if \(next\.length !== links\.length\) writeJsonFile\(recordLinksPath, next\);/);
  assert.match(fn, /\} catch \(error\) \{\s*console\.warn\(/);
  assert.match(main, /function recordLinkChips\(module: string\) \{\s*backfillRecordLinks\(\);/);
});
