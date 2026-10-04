// "Commit all" and "Stash all" against real repositories that hold things
// nobody meant to commit: they stop being one click, and say why.

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { done, P, world, type World } from "./helpers.ts";

let worlds: World[] = [];
afterEach(() => {
  for (const w of worlds) w.dispose();
  worlds = [];
});
function w0(): World {
  const w = world();
  worlds.push(w);
  return w;
}

const commits = (w: World) => Number(w.b.git(w.app, "rev-list", "--count", "HEAD").trim());

test("Commit all with a secrets file and a document present: nothing is committed until the owner says yes", async () => {
  const w = w0();
  writeFileSync(join(w.app, ".env"), "KEY=secret\n");
  writeFileSync(join(w.app, "Grant.docx"), "x");
  writeFileSync(join(w.app, "code.ts"), "export {};\n");
  const before = commits(w);
  const request = { kind: "commit", message: "work", files: "all" } as const;

  const preview = await w.ops.preview({ projectId: P, path: w.app, request });
  assert.equal(preview.refused, false);
  if (preview.refused) return;
  assert.deepEqual(preview.plan.confirm, { kind: "dialog" });
  assert.equal(preview.plan.details[0], ".env looks like a secrets file.");
  assert.equal(preview.plan.details[1], "Grant.docx is a document, not code.");

  const asked = await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui" });
  assert.equal(asked.status, "needs_confirmation");
  assert.equal(commits(w), before, "nothing was committed");
  assert.equal(w.b.git(w.app, "status", "--porcelain").includes(".env"), true);

  // The other way out: commit only the code. One click, and the secrets file stays out.
  const only = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "code", files: ["code.ts"] }, source: "module_ui" }));
  assert.equal(only.outcome, "succeeded", only.message);
  assert.equal(commits(w), before + 1);
  assert.deepEqual(w.b.git(w.app, "show", "--name-only", "--format=", "HEAD").trim().split(/\r?\n/), ["code.ts"]);

  // And saying yes does commit everything, as asked.
  const yes = done(await w.ops.execute({ projectId: P, path: w.app, request, source: "module_ui", confirmation: { confirmed: true } }));
  assert.equal(yes.outcome, "succeeded", yes.message);
  assert.equal(commits(w), before + 2);
});

test("a background trigger cannot commit a secrets file by saying nothing", async () => {
  const w = w0();
  writeFileSync(join(w.app, ".env"), "KEY=secret\n");
  const before = commits(w);
  const r = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "work", files: "all" }, source: "command", nonInteractive: true });
  assert.equal(r.status === "refused" && r.refusal.code, "needs_choice");
  assert.equal(commits(w), before);
});

test("a very large new folder: the size is measured when the commit or stash is planned, not guessed", async () => {
  const w = w0();
  mkdirSync(join(w.app, "dataset"));
  for (let i = 0; i < 1100; i += 1) writeFileSync(join(w.app, "dataset", `f${i}.bin`), "x");

  const commit = await w.ops.preview({ projectId: P, path: w.app, request: { kind: "commit", message: "work", files: "all" } });
  assert.equal(!commit.refused && commit.plan.confirm.kind, "dialog");
  assert.match(!commit.refused ? commit.plan.details[0] : "", /^dataset\/ \(1 KB in 1,100 files\) is very large\.$/);

  const stash = await w.ops.execute({ projectId: P, path: w.app, request: { kind: "stash" }, source: "module_ui" });
  assert.equal(stash.status, "needs_confirmation");
  assert.equal(w.b.git(w.app, "stash", "list").trim(), "", "nothing was stashed");
});

test("a tidy folder commits and stashes in one click, as before", async () => {
  const w = w0();
  writeFileSync(join(w.app, "code.ts"), "export {};\n");
  const stash = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "stash" }, source: "module_ui" }));
  assert.equal(stash.outcome, "succeeded", stash.message);
  writeFileSync(join(w.app, "more.ts"), "export {};\n");
  const commit = done(await w.ops.execute({ projectId: P, path: w.app, request: { kind: "commit", message: "work", files: "all" }, source: "module_ui" }));
  assert.equal(commit.outcome, "succeeded", commit.message);
});
