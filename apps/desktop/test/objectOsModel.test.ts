/**
 * ObjectOS view model. The lists and formatters the renderer mirrors (it may
 * not bundle the package) are compared with the package's own.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CATEGORIES,
  FILE_ROLES,
  INTERVAL_UNITS,
  OBJECT_LIST_PAGE,
  STATUSES,
  TIMELINE_KINDS,
  decimalsOf as packageDecimals,
  formatMoney as packageFormatMoney,
  formatObjectId as packageFormatObjectId,
  type AttentionView,
  type DueStatus,
  type Measurement,
  type ObjectRecord,
  type SettingsSnapshot
} from "@dexnest/object-os";
import {
  actionMessage,
  attentionLabel,
  attentionSummaryText,
  CATEGORY_LABELS,
  CATEGORY_LIST,
  dateToStamp,
  decimalsOf,
  deleteObjectConfirm,
  dueLabel,
  EMPTY_OBJECT_FORM,
  fileSize,
  LIST_LIMIT,
  formatMoney,
  formatObjectId,
  formFromObject,
  measurementGroups,
  moneyAmountText,
  nextTab,
  objectFromForm,
  overviewRows,
  parseSettingsText,
  ROLE_LABELS,
  ROLE_LIST,
  settingsGroups,
  settingsText,
  STATUS_LABELS,
  STATUS_LIST,
  TABS,
  TIMELINE_KIND_LABELS,
  UNIT_LIST,
  viewState,
  warrantyLabel
} from "../src/renderer/views/objectOsModel.ts";

const T = "2026-06-01T09:00:00.000Z";

test("the mirrored lists equal the package's", () => {
  assert.deepEqual([...CATEGORY_LIST], [...CATEGORIES]);
  assert.deepEqual([...STATUS_LIST], [...STATUSES]);
  assert.deepEqual([...ROLE_LIST], [...FILE_ROLES]);
  assert.deepEqual([...UNIT_LIST], [...INTERVAL_UNITS]);
  assert.deepEqual(Object.keys(TIMELINE_KIND_LABELS).sort(), [...TIMELINE_KINDS].sort());
  assert.deepEqual(Object.keys(CATEGORY_LABELS).sort(), [...CATEGORIES].sort());
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), [...STATUSES].sort());
  assert.deepEqual(Object.keys(ROLE_LABELS).sort(), [...FILE_ROLES].sort());
});

test("money and ids format exactly as the package does", () => {
  const codes = ["EUR", "USD", "GBP", "JPY", "KRW", "VND", "CLP", "ISK", "HUF", "XOF", "XAF", "UGX", "PYG", "BHD", "KWD", "OMR", "JOD", "TND", "LYD", "IQD", "CHF", "INR", "TWD"];
  for (const currency of codes) {
    assert.equal(decimalsOf(currency), packageDecimals(currency), currency);
    for (const amount of [0, 1, 9, 10, 99, 100, 1234, 1_000_000]) {
      assert.equal(formatMoney({ amount, currency }), packageFormatMoney({ amount, currency }), `${amount} ${currency}`);
    }
  }
  assert.equal(moneyAmountText({ amount: 1250, currency: "EUR" }), "12.50");
  assert.equal(moneyAmountText({ amount: 1250, currency: "JPY" }), "1250");
  assert.equal(moneyAmountText(null), "");
  assert.equal(formatObjectId("7K3F9QXM"), packageFormatObjectId("7K3F9QXM"));
  assert.equal(formatObjectId("7K3F9QXM"), "7K3F-9QXM");
});

test("tabs: nine, in the brief's order, with wrapping arrows and Home/End", () => {
  assert.deepEqual([...TABS], ["overview", "maintenance", "parts", "modifications", "settings", "measurements", "files", "purchase", "history"]);
  assert.equal(nextTab("overview", "ArrowRight"), "maintenance");
  assert.equal(nextTab("overview", "ArrowLeft"), "history");
  assert.equal(nextTab("history", "ArrowRight"), "overview");
  assert.equal(nextTab("parts", "Home"), "overview");
  assert.equal(nextTab("parts", "End"), "history");
  assert.equal(nextTab("parts", "a"), null);
});

test("view state: error beats loading; zero objects is empty", () => {
  const status = { remindersEnabled: false, lastReminder: null, lastError: null, objects: 0 };
  assert.deepEqual(viewState({ loading: true, error: null, status: null }), { kind: "loading" });
  assert.deepEqual(viewState({ loading: true, error: "locked", status: null }), { kind: "error", message: "locked" });
  assert.deepEqual(viewState({ loading: false, error: null, status }), { kind: "empty" });
  assert.deepEqual(viewState({ loading: false, error: null, status: { ...status, objects: 2 } }), { kind: "ready" });
});

test("action results become notices; a cancelled dialog says nothing", () => {
  assert.deepEqual(actionMessage({ ok: true, message: "Saved." }), { ok: true, text: "Saved." });
  assert.deepEqual(actionMessage({ ok: false, error: "name is required" }), { ok: false, text: "name is required" });
  assert.deepEqual(actionMessage({ ok: false, cancelled: true, error: "Attach cancelled." }), { ok: true, text: null });
  assert.deepEqual(actionMessage(undefined), { ok: false, text: "ObjectOS did not answer." });
});

test("due labels, for time and usage schedules", () => {
  const time = (state: "ok" | "due_soon" | "overdue", daysLeft: number): DueStatus => ({ state, kind: "time", dueAt: "2026-07-10T00:00:00.000Z", daysLeft, lastDoneAt: null });
  assert.equal(dueLabel(time("overdue", -3)), "Overdue by 3 days");
  assert.equal(dueLabel(time("overdue", -1)), "Overdue by 1 day");
  assert.equal(dueLabel(time("overdue", 0)), "Due today");
  assert.equal(dueLabel(time("due_soon", 10)), "Due in 10 days");
  assert.equal(dueLabel(time("ok", 40)), "OK, next 2026-07-10");
  const usage = (state: "ok" | "due_soon" | "overdue", left: number): DueStatus => ({ state, kind: "usage", measurementKey: "print hours", dueAtReading: 400, latestReading: 400 - left, left, lastDoneAt: null });
  // With the reading's unit (Integration QA F11: it used to say "Overdue by 12.5").
  assert.equal(dueLabel(usage("overdue", -12.5)), "Overdue by 12.5 print hours");
  assert.equal(dueLabel(usage("due_soon", 8)), "Due in 8 print hours");
  assert.equal(dueLabel(usage("ok", 150)), "OK, next at 400 print hours");
  assert.equal(dueLabel({ state: "no_reading", measurementKey: "print hours" }), "Waiting for a print hours reading");
  assert.equal(dueLabel({ state: "inactive" }), "Paused");
});

test("warranty and attention lines use names from the view's own read only", () => {
  assert.equal(warrantyLabel({ state: "none", daysLeft: null }), "No warranty recorded");
  assert.equal(warrantyLabel({ state: "ending", daysLeft: 12 }), "Warranty ends in 12 days");
  assert.equal(warrantyLabel({ state: "ending", daysLeft: 0 }), "Warranty ends today");
  assert.equal(warrantyLabel({ state: "expired", daysLeft: -2 }), "Warranty ended 2 days ago");
  assert.equal(warrantyLabel({ state: "active", daysLeft: 100 }), "Under warranty for 100 more days");

  const names: AttentionView["names"] = { "7K3F9QXM": "Printer", sch_nozzle001: "Replace nozzle", prt_filter01: "Filter" };
  assert.deepEqual(attentionLabel({ kind: "maintenance", objectId: "7K3F9QXM", scheduleId: "sch_nozzle001", status: { state: "overdue", kind: "time", dueAt: T, daysLeft: -4, lastDoneAt: null } }, names), {
    objectId: "7K3F9QXM", title: "Printer", detail: "Replace nozzle: Overdue by 4 days", tone: "bad"
  });
  assert.deepEqual(attentionLabel({ kind: "warranty", objectId: "7K3F9QXM", state: "ending", daysLeft: 5 }, names), { objectId: "7K3F9QXM", title: "Printer", detail: "Warranty ends in 5 days", tone: "warn" });
  assert.deepEqual(attentionLabel({ kind: "stock", partId: "prt_filter01", quantity: 1, lowStockAt: 2 }, names), { objectId: null, title: "Filter", detail: "Low stock: 1 left (restock at 2)", tone: "warn" });
  // A name the read did not supply falls back to the label id, never to anything else.
  assert.equal(attentionLabel({ kind: "warranty", objectId: "ABCD1234", state: "expired", daysLeft: -1 }, {}).title, "ABCD-1234");

  assert.equal(attentionSummaryText({ overdue: 0, dueSoon: 0, warrantyEnding: 0, lowStock: 0 }), "Nothing needs attention.");
  assert.equal(attentionSummaryText({ overdue: 2, dueSoon: 1, warrantyEnding: 1, lowStock: 3 }), "2 overdue, 1 due soon, 1 warranty ending, 3 low on stock");
  assert.equal(attentionSummaryText({ overdue: 0, dueSoon: 0, warrantyEnding: 2, lowStock: 0 }), "2 warranties ending");
});

test("dates from a form: today is now (never in the future), earlier days are noon UTC", () => {
  const now = new Date(2026, 5, 30, 1, 30);
  const today = `2026-06-30`;
  assert.equal(dateToStamp(today, now), now.toISOString());
  assert.equal(dateToStamp("2026-07-02", now), now.toISOString());
  assert.equal(dateToStamp("2026-06-01", now), "2026-06-01T12:00:00.000Z");
  assert.equal(dateToStamp("", now), undefined);
});

test("object form round trip, tags split on commas, empty parent is none", () => {
  const o: ObjectRecord = {
    id: "7K3F9QXM", name: "Printer", category: "printer", make: "Prusa", model: "MK4", serial: "SN-1", location: "Workshop", status: "active",
    notes: "n", tags: ["3d", "work"], parentId: null, photoFileId: null, createdAt: T, updatedAt: T
  };
  const form = formFromObject(o);
  assert.equal(form.tags, "3d, work");
  const input = objectFromForm({ ...form, tags: " 3d , , work ,x " });
  assert.deepEqual(input, { id: "7K3F9QXM", name: "Printer", category: "printer", make: "Prusa", model: "MK4", serial: "SN-1", location: "Workshop", status: "active", parentId: null, tags: ["3d", "work", "x"], notes: "n" });
  assert.equal("id" in objectFromForm(EMPTY_OBJECT_FORM), false);
  assert.equal(objectFromForm({ ...EMPTY_OBJECT_FORM, parentId: " 7K3F9QXM " }).parentId, "7K3F9QXM");
  assert.deepEqual(overviewRows({ ...o, make: "", serial: "" }).map((r) => r.label), ["Category", "Status", "Model", "Location"]);
  assert.equal(overviewRows(o).find((r) => r.label === "Serial")?.technical, true);
});

test("settings text: key = value per line, problems reported by line, round trip", () => {
  const parsed = parseSettingsText("layer_height = 0.2\n\ninfill=15%\nbroken line\nurl = http://a/?x=1\n");
  assert.deepEqual(parsed.values, { layer_height: "0.2", infill: "15%", url: "http://a/?x=1" });
  assert.deepEqual(parsed.problems, [4]);
  assert.deepEqual(parseSettingsText(settingsText(parsed.values)).values, parsed.values);
  assert.deepEqual(parseSettingsText("= no key").problems, [1]);
});

test("settings and measurements are grouped, newest first", () => {
  const snap = (id: string, name: string, version: number): SettingsSnapshot => ({ id, objectId: "7K3F9QXM", name, version, values: {}, note: "", createdAt: T });
  assert.deepEqual(settingsGroups([snap("set_a0000001", "Slicer", 1), snap("set_b0000001", "BIOS", 1), snap("set_a0000002", "Slicer", 2)]).map((g) => [g.name, g.versions.map((v) => v.version)]), [["BIOS", [1]], ["Slicer", [2, 1]]]);
  const m = (id: string, key: string, at: string, value: number): Measurement => ({ id, objectId: "7K3F9QXM", key, value, unit: "h", measuredAt: at, note: "", createdAt: at });
  const groups = measurementGroups({ measurements: [m("msr_a0000001", "hours", "2026-01-01T00:00:00.000Z", 10), m("msr_a0000002", "hours", "2026-03-01T00:00:00.000Z", 30), m("msr_b0000001", "bed", "2026-02-01T00:00:00.000Z", 60)] });
  assert.deepEqual(groups.map((g) => [g.key, g.readings.map((r) => r.value)]), [["bed", [60]], ["hours", [30, 10]]]);
});

test("the list limit is the store's default page", () => {
  assert.equal(LIST_LIMIT, OBJECT_LIST_PAGE);
});

test("file sizes read as people read them", () => {
  assert.equal(fileSize(512), "512 B");
  assert.equal(fileSize(2048), "2.0 KB");
  assert.equal(fileSize(5 * 1024 * 1024), "5.0 MB");
});

test("deleting: components are mentioned only when there are some (Integration QA F10)", () => {
  assert.deepEqual(deleteObjectConfirm("Kitchen scale", 0), { title: "Delete Kitchen scale?", detail: "All its records and attached files are deleted. This cannot be undone." });
  assert.deepEqual(deleteObjectConfirm("Printer", 1), { title: "Delete Printer?", detail: "All its records and attached files are deleted. Its 1 component will be kept. This cannot be undone." });
  assert.deepEqual(deleteObjectConfirm("Car", 3), { title: "Delete Car?", detail: "All its records and attached files are deleted. Its 3 components will be kept. This cannot be undone." });
});

test("the last action's notice clears when the user opens another object or tab (Integration QA F9)", async () => {
  const { readFileSync } = await import("node:fs");
  const view = readFileSync(new URL("../src/renderer/views/ObjectOsView.tsx", import.meta.url), "utf8");
  assert.match(view, /function showObject\(id: string\) \{\s*setNotice\(null\);\s*void openObject\(id\);/);
  assert.match(view, /function selectTab\(next: Tab\) \{\s*setNotice\(null\);/);
  // Every place the user opens an object goes through showObject; only the
  // reopen after an action (which should keep its notice) calls openObject.
  assert.equal((view.match(/onClick=\{\(\) => showObject\(/g) ?? []).length, 2);
  assert.match(view, /onOpen=\{\(id\) => showObject\(id\)\}/);
  assert.doesNotMatch(view, /onClick=\{\(\) => void openObject\(/);
});
