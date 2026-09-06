// Architectural guards.
//
// These are cheap, mechanical checks for the invariants that keep the runtime
// extractable into a separate process later. They fail loudly rather than
// letting the boundary erode quietly, which is how this repository previously
// ended up with a 21,000-line main.ts.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "src");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("runtime package boundaries", () => {
  test("the runtime never imports Electron", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, "utf8");
      if (/\bfrom\s+["']electron["']/.test(contents) || /\brequire\(\s*["']electron["']\s*\)/.test(contents)) {
        offenders.push(relative(SRC, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "packages/autopilot-runtime must contain zero Electron imports (see docs/AUTOPILOT_ARCHITECTURE.md section 4)"
    );
  });

  test("the runtime reaches the platform only through injected ports", () => {
    // node:sqlite / better-sqlite3, fs, child_process and os would each couple
    // the runtime to a host it must stay independent of.
    const forbidden = [
      /\bfrom\s+["']node:fs["']/,
      /\bfrom\s+["']node:child_process["']/,
      /\bfrom\s+["']node:os["']/,
      /\bfrom\s+["']node:sqlite["']/,
      /\bfrom\s+["']better-sqlite3["']/
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(contents)) {
          offenders.push(`${relative(SRC, file)} matches ${pattern}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "platform access belongs behind a port in src/ports.ts");
  });

  test("only the dispatcher touches the platform ports", () => {
    // Effects must flow Intent -> Policy -> [Approval] -> Dispatcher -> Port.
    // Any other module reaching platform.process / platform.fs / platform.git
    // would be a route around policy.
    const allowed = new Set(["dispatcher.ts", "workspace.ts", "engine.ts", "effects.ts", "ports.ts"]);
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const name = relative(SRC, file);
      if (allowed.has(name)) continue;
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "");
      if (/\bplatform\.(process|fs|git|env)\b/.test(code)) {
        offenders.push(`${name} reaches a platform port directly`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("the policy layer is pure and never dispatches", () => {
    const code = readFileSync(join(SRC, "policy.ts"), "utf8");
    assert.ok(!/Dispatcher/.test(code), "policy must not know about the dispatcher");
    assert.ok(!/await /.test(code), "policy evaluation is synchronous and deterministic");
  });

  test("the always-denied roots cannot be emptied by configuration", () => {
    const code = readFileSync(join(SRC, "policy.ts"), "utf8");
    assert.match(code, /ALWAYS_DENIED_ROOTS/);
    assert.match(code, /D:\/DeskNest\/local-data/, "the DexNest data root deny is hard-coded, not configured");
    // effectiveDenyRoots must always union the constant, never replace it.
    assert.match(code, /\[\.\.\.ALWAYS_DENIED_ROOTS,\s*\.\.\.policy\.denyRoots\]/);
  });

  test("the runtime does not read the clock, randomness or the process directly", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, "utf8");
      // Comments legitimately mention these; only flag real call sites.
      const code = contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
      if (/\bDate\.now\(/.test(code) || /\bnew Date\(\)/.test(code)) {
        offenders.push(`${relative(SRC, file)}: use the Clock port, not Date`);
      }
      if (/\bMath\.random\(/.test(code)) {
        offenders.push(`${relative(SRC, file)}: use the IdGenerator port, not Math.random`);
      }
      if (/\bprocess\.(env|exit|argv|cwd)\b/.test(code)) {
        offenders.push(`${relative(SRC, file)}: the runtime must not touch process`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
