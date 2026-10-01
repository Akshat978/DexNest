// Shell styling that every module depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { accentTint, MODULE_META } from "../src/renderer/lib/moduleMeta.ts";

const renderer = fileURLToPath(new URL("../src/renderer", import.meta.url));

test("accent tints work for hex and for token accents", () => {
  assert.equal(accentTint("#22D3EE", 7), "color-mix(in srgb, #22D3EE 7%, transparent)");
  assert.equal(accentTint("var(--accent-tools)", 15), "color-mix(in srgb, var(--accent-tools) 15%, transparent)");
  for (const [id, meta] of Object.entries(MODULE_META)) assert.match(accentTint(meta.accent, 9), /^color-mix\(in srgb, .+ 9%, transparent\)$/, id);
});

test("the shell never appends hex alpha digits to a module accent (invalid CSS for token accents)", () => {
  const shell = readFileSync(join(renderer, "main.tsx"), "utf8");
  assert.deepEqual(shell.match(/\$\{meta\.accent\}[0-9a-fA-F]{2}/g) ?? [], []);
  assert.match(shell, /background: accentTint\(meta\.accent, 7\), borderColor: accentTint\(meta\.accent, 15\)/, "the active sidebar entry");
});

test("checkboxes and radios are not stretched to full width by the global input rule", () => {
  const css = readFileSync(join(renderer, "styles.css"), "utf8");
  const rule = css.match(/([^{}]*)\{\s*width: 100%;\s*min-width: 0;\s*padding: var\(--space-2\) var\(--space-3\);/);
  assert.ok(rule, "the global form-control rule");
  const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(selector, /^input:where\(:not\(\[type="checkbox"\], \[type="radio"\]\)\),\s*textarea,\s*select$/);
});
