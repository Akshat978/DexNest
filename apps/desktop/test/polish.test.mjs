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
