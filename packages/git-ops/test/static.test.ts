// git-ops imports only what it needs: no network or LLM libraries, no shell.

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => join(SRC, f));

test("git-ops imports only the foundation, projects and node:crypto", () => {
  for (const file of files) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.ok(["@dexnest/foundation", "@dexnest/projects", "node:crypto"].includes(spec) || spec.startsWith("./"), `${file}: ${spec}`);
    }
  }
});

test("no shell, no network client, no LLM", () => {
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /shell:\s*true|child_process|\bfetch\(|https?:\/\/(?!github\.com)|\b(openai|anthropic|langchain|ollama)\b/i, file);
  }
});
