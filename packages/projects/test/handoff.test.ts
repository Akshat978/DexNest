// Phase 11: the handoff carries the "Needs Windows check" list the brief asks
// for, and every Windows item recorded elsewhere made it onto that list.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const doc = (name: string) => readFileSync(new URL(`../../../docs/modules/projects/${name}`, import.meta.url), "utf8");

test("HANDOFF.md has the Needs Windows check list with the brief's five areas, as tickable items", () => {
  const handoff = doc("HANDOFF.md");
  const list = handoff.slice(handoff.indexOf("## 6. Needs Windows check"));
  assert.ok(list.length > 0 && handoff.includes("## 6. Needs Windows check"));
  for (const area of [/Git Credential Manager/, /### VS Code launch/, /### Terminal launch/, /### Windows paths and junctions/, /mklink \/J/]) assert.match(list, area);
  assert.ok((list.match(/^- \[ \] /gm) ?? []).length >= 30, "each check is a checkbox");
});

test("every 'needs Windows check' in PARITY.md is on the handoff list", () => {
  const list = doc("HANDOFF.md").split("## 6. Needs Windows check")[1] ?? "";
  const parity = doc("PARITY.md");
  const needs: Array<[string, RegExp]> = [
    ["F9", /VS Code/],
    ["F10", /Windows Terminal|PowerShell/],
    ["F16", /Processes.*netstat/],
    ["F17", /Kill ports.*taskkill/],
    ["junctions", /junction/i]
  ];
  for (const [id, onList] of needs) {
    assert.match(parity, new RegExp(`${id === "junctions" ? "junctions" : `\\| ${id} \\|`}[^\\n]*[Nn]eeds Windows check`), `${id} is marked in PARITY.md`);
    assert.match(list, onList, `${id} is on the handoff list`);
  }
});
