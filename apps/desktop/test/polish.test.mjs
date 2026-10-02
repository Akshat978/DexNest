// Integration QA phase 4 (polish): layout rules that keep content inside its
// card and readable. CSS only, so checked in the stylesheets; the screens are
// in docs/integration/screenshots/after/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const renderer = fileURLToPath(new URL("../src/renderer/", import.meta.url));
const css = (file) => readFileSync(join(renderer, file), "utf8");
const rule = (text, selector) => {
  const m = text.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`));
  assert.ok(m, `missing ${selector}`);
  return m[2];
};

test("P3: a panel's single column may shrink, so Secure Vault's setup form and path stay inside their card at 1280", () => {
  const styles = css("styles.css");
  for (const selector of [".panel", ".panel__body"]) {
    const body = rule(styles, selector);
    assert.match(body, /grid-template-columns: minmax\(0, 1fr\);/, selector);
    assert.match(body, /min-width: 0;/, selector);
  }
  assert.match(rule(styles, ".panel .technical"), /overflow-wrap: anywhere;/);
});

test("P6: Audit's columns fit the content area at 1280, and action ids break only after . and _", async () => {
  const { idParts } = await import("../src/renderer/lib/idParts.ts");
  assert.deepEqual(idParts("heatmap.log_current_app"), ["heatmap.", "log_", "current_", "app"]);
  assert.deepEqual(idParts("skill_constellation.open"), ["skill_", "constellation.", "open"]);
  assert.deepEqual(idParts("deck"), ["deck"]);
  const styles = css("styles.css");
  const columns = rule(styles, ".audit-list .event-row").match(/grid-template-columns: ([^;]+);/)[1];
  // Fixed widths plus each minmax() minimum, at 16 px a rem, with five 12 px gaps and 32 px padding.
  const rem = [...columns.matchAll(/(?:minmax\()?(\d+(?:\.\d+)?)rem/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.ok(rem * 16 + 5 * 12 + 32 <= 975, `${rem}rem of columns does not fit 975 px`);
  assert.match(rule(styles, ".audit-list .event-row p"), /overflow-wrap: break-word;/);
  const view = readFileSync(join(renderer, "views/AuditView.tsx"), "utf8");
  assert.match(view, /<div className="event-list audit-list">/);
  assert.match(view, /idParts\(event\.actionId\)\.map\(\(part, i\) => \(\s*<React\.Fragment key=\{i\}>\s*\{i > 0 && <wbr \/>\}/);
});
