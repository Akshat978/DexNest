// Integration QA F3: Calendar logged duplicate React keys (today's nudges are
// also in upcomingNudges, so each showed twice) and a <button> nested in a
// <button> (an Upcoming row holding a PinButton).
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { uniqueById } from "../src/renderer/lib/uniqueById.ts";

test("uniqueById keeps the first of each id, in order", () => {
  const today = [{ id: "journal-daily-2026-10-02", n: 1 }, { id: "backup-reminder-2026-10-02", n: 2 }];
  const upcoming = [{ id: "journal-daily-2026-10-02", n: 3 }, { id: "finance-recurring-x", n: 4 }];
  assert.deepEqual(uniqueById([...today, ...upcoming]).map((i) => i.n), [1, 2, 4]);
  assert.deepEqual(uniqueById([]), []);
});

test("Calendar builds both reminder lists without duplicates", () => {
  const main = readFileSync(new URL("../src/renderer/main.tsx", import.meta.url), "utf8");
  assert.match(main, /calReminders = uniqueById\(\[\.\.\.calendarState\.todayNudges, \.\.\.calendarState\.upcomingNudges\]\)/);
  assert.match(main, /nudgeList = uniqueById\(\[\.\.\.calendarState\.todayNudges, \.\.\.calendarState\.upcomingNudges\]\)/);
});

// Every <button> element in the renderer, parsed with TypeScript's own TSX
// parser, must hold no other button or PinButton.
function nestedButtons(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const isButtonTag = (name: ts.JsxTagNameExpression) => name.getText(file) === "button" || name.getText(file) === "PinButton";
  const visit = (node: ts.Node, insideButton: boolean) => {
    let inside = insideButton;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
      if (insideButton && isButtonTag(tag)) lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      if (ts.isJsxElement(node) && tag.getText(file) === "button") inside = true;
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  return lines;
}

test("no button or PinButton is rendered inside a <button> anywhere in the renderer", () => {
  const root = fileURLToPath(new URL("../src/renderer", import.meta.url));
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
  walk(root);
  const found = files.flatMap((f) => nestedButtons(f, readFileSync(f, "utf8")).map((l) => `${f.slice(root.length + 1)}:${l}`));
  assert.deepEqual(found, []);
});
