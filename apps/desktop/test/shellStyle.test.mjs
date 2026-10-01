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

const repo = fileURLToPath(new URL("../../..", import.meta.url));

test("Inter and JetBrains Mono are bundled and loaded locally, never from the network", () => {
  const css = readFileSync(join(repo, "packages/shared-ui/src/fonts.css"), "utf8");
  const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map((m) => m[1]);
  const families = new Set(faces.map((f) => f.match(/font-family: "([^"]+)"/)?.[1]));
  assert.deepEqual([...families].sort(), ["Inter", "JetBrains Mono"]);
  assert.doesNotMatch(css, /https?:|\/\/fonts\./, "no remote font URLs");
  for (const f of faces) {
    for (const [, file] of f.matchAll(/url\("\.\/(fonts\/[^"]+\.woff2)"\)/g)) {
      assert.ok(readFileSync(join(repo, "packages/shared-ui/src", file)).length > 1000, file);
    }
  }
  for (const lic of ["inter-LICENSE.txt", "jetbrains-mono-LICENSE.txt"]) {
    assert.match(readFileSync(join(repo, "packages/shared-ui/src/fonts", lic), "utf8"), /SIL Open Font License/);
  }
  // The token names the families exactly as declared.
  const tokens = readFileSync(join(repo, "packages/shared-ui/src/tokens.css"), "utf8");
  assert.match(tokens, /--font-ui: Inter,/);
  assert.match(tokens, /--font-tech: "JetBrains Mono",/);
  const shell = readFileSync(join(renderer, "main.tsx"), "utf8");
  assert.ok(shell.indexOf('import "@dexnest/shared-ui/fonts.css";') >= 0 && shell.indexOf('import "@dexnest/shared-ui/fonts.css";') < shell.indexOf('import "@dexnest/shared-ui/tokens.css";'));
});

test("focus outlines are solid and control outlines meet 3:1", () => {
  const tokens = readFileSync(join(repo, "packages/shared-ui/src/tokens.css"), "utf8");
  assert.match(tokens, /--focus-outline: var\(--accent\);/);
  assert.match(tokens, /--border-strong: #666666;/);
  const css = readFileSync(join(renderer, "styles.css"), "utf8");
  assert.doesNotMatch(css, /outline: 2px solid var\(--focus-ring\)/, "the 40% ring is a glow, not an outline");
  assert.match(css, /select \{\s*width: 100%;[\s\S]*?border: 1px solid var\(--border-strong\);/);
});

test("every view is wrapped in the error boundary, keyed by the view", () => {
  const shell = readFileSync(join(renderer, "main.tsx"), "utf8");
  const open = shell.indexOf("<ViewErrorBoundary");
  const close = shell.indexOf("</ViewErrorBoundary>");
  assert.ok(open > 0 && close > open);
  assert.match(shell.slice(open, open + 120), /key=\{activeView\}/);
  const inside = shell.slice(open, close);
  const allViews = [...shell.matchAll(/\{activeView === "([a-z]+)" &&/g)].map((m) => m[1]);
  const wrapped = [...inside.matchAll(/\{activeView === "([a-z]+)" &&/g)].map((m) => m[1]);
  assert.ok(wrapped.length >= 20, `${wrapped.length} views wrapped`);
  assert.deepEqual(allViews.filter((v) => !wrapped.includes(v)), []);
});
