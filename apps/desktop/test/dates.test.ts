/** One way to write a date, shared by every screen that shows one. */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dayKey, dayLabel, dayTimeLabel, UNKNOWN_DATE } from "../src/renderer/lib/dates.ts";

test("a day is written day first, with the month as a word and the year", () => {
  assert.equal(dayLabel("2026-10-03T15:50:00.000Z"), "3 Oct 2026");
  assert.equal(dayLabel("2026-01-09"), "9 Jan 2026", "a plain day is taken as written");
  assert.equal(dayLabel("2025-12-31T23:59:59.000Z"), "31 Dec 2025");
  // An instant with an offset is the same instant, read in UTC like the rest.
  assert.equal(dayLabel("2026-10-03T22:30:00-06:00"), "4 Oct 2026");
});

test("a moment adds the time", () => {
  assert.equal(dayTimeLabel("2026-06-01T09:00:00.000Z"), "1 Jun 2026, 09:00");
  assert.equal(dayTimeLabel("2026-06-01T09:00:00+02:00"), "1 Jun 2026, 07:00");
});

test("what is not a date says so instead of printing rubbish", () => {
  for (const bad of ["", "never", "2026-13-40", null, undefined]) {
    assert.equal(dayLabel(bad), UNKNOWN_DATE, String(bad));
    assert.equal(dayTimeLabel(bad), UNKNOWN_DATE, String(bad));
  }
  assert.equal(dayKey("x"), null);
});

test("the key for grouping by day stays YYYY-MM-DD", () => {
  assert.equal(dayKey("2026-06-01T09:00:00.000Z"), "2026-06-01");
  assert.equal(dayKey("2026-06-01"), "2026-06-01");
});

test("the four module screens write their dates through it", () => {
  for (const model of ["ghostOsModel.ts", "objectOsModel.ts", "realityRpgModel.ts", "skillConstellationModel.ts"]) {
    const source = readFileSync(new URL(`../src/renderer/views/${model}`, import.meta.url), "utf8");
    assert.match(source, /from "\.\.\/lib\/dates\.ts"/, model);
    const shortDate = /export (?:function shortDate\(iso: string\): string \{\s*return ([^;]+);|const shortDate = \(iso: string\) => ([^;]+);)/.exec(source);
    assert.ok(shortDate, `${model} has shortDate`);
    assert.equal((shortDate[1] ?? shortDate[2]).trim(), "dayLabel(iso)", `${model} does not format dates its own way`);
  }
});
