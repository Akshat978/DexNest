// Before "Commit all" or "Stash all" sweeps a folder up: what deserves a
// second look, what a .gitignore line for exactly one path looks like, and
// what the plans say and ask. No git here.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { addIgnorePatterns, ignorePattern } from "../src/domain/gitignore.ts";
import type { OperationPlan, Refusal } from "../src/domain/operations.ts";
import { planCommit, planStash } from "../src/domain/planners.ts";
import { formatBytes, isLarge, LARGE_BYTES, nameRisk, riskLines, riskyPaths, sizeNote } from "../src/domain/risk.ts";
import { repo, tree } from "./fixtures.ts";

const ok = (result: OperationPlan | Refusal): OperationPlan => {
  assert.equal(result.refused, false, result.refused ? result.reason : "");
  return result as OperationPlan;
};

// --- what deserves a look -------------------------------------------------------------------------

test("by name: secrets, documents and archives; code and templates are not flagged", () => {
  for (const path of [".env", "apps/api/.env", ".env.local", ".env.production", "keys/prod.pem", "id_rsa", "deploy/id_ed25519", "service-account-prod.json", "credentials.json", ".npmrc", "store.keystore", "cert.p12"]) {
    assert.equal(nameRisk(path), "secret", path);
  }
  for (const path of ["Alliance Grant.docx", "pitch/Deck.PPTX", "Landscape_Final.pdf", "budget.xlsx", "old.doc"]) assert.equal(nameRisk(path), "document", path);
  for (const path of ["skin_dataset_builder.zip", "backup.tar", "dump.7z", "x.tgz"]) assert.equal(nameRisk(path), "archive", path);
  for (const path of ["src/app.ts", "README.md", ".env.example", ".env.sample", "config/.env.template", "docs/key-concepts.md", "environment.ts", "package.json", ".gitignore", "data.csv"]) {
    assert.equal(nameRisk(path), null, path);
  }
  assert.equal(nameRisk("secrets/"), null, "a folder is judged by its size, not its name");
});

test("by size: large past 50 MB or 1,000 files, or when counting had to stop", () => {
  assert.equal(isLarge(undefined), false, "not measured: nothing is claimed");
  assert.equal(isLarge({ files: 3, bytes: 1024, truncated: false }), false);
  assert.equal(isLarge({ files: 1, bytes: LARGE_BYTES + 1, truncated: false }), true);
  assert.equal(isLarge({ files: 1001, bytes: 10, truncated: false }), true);
  assert.equal(isLarge({ files: 2000, bytes: 10, truncated: true }), true);
  assert.equal(sizeNote({ files: 1, bytes: 300 * 1024 * 1024, truncated: false }), "300 MB");
  assert.equal(sizeNote({ files: 3400, bytes: 1.2 * 1024 ** 3, truncated: false }), "1.2 GB in 3,400 files");
  assert.equal(sizeNote({ files: 2000, bytes: 900 * 1024 * 1024, truncated: true }), "more than 900 MB in more than 2,000 files");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
});

const messy = () =>
  tree({
    unstaged: [{ path: "apps/api/.env", status: "modified" }, { path: "src/app.ts", status: "modified" }],
    untracked: ["Alliance Grant.docx", "Articles.docx", "Landscape.pdf", "Deck.pptx", "skin_dataset_builder.zip", "skin_dataset_builder/", "scripts/audit.py", "notes/"]
  });

test("the risky paths of a sweep: secrets first, then large, documents, archives; code left out", () => {
  const t = { ...messy(), sizes: { "skin_dataset_builder/": { files: 2000, bytes: 4 * 1024 ** 3, truncated: true }, "notes/": { files: 4, bytes: 9000, truncated: false } } };
  const risky = riskyPaths(t, "all");
  assert.deepEqual(risky.map((r) => [r.kind, r.path]), [
    ["secret", "apps/api/.env"],
    ["large", "skin_dataset_builder/"],
    ["document", "Alliance Grant.docx"],
    ["document", "Articles.docx"],
    ["document", "Deck.pptx"],
    ["document", "Landscape.pdf"],
    ["archive", "skin_dataset_builder.zip"]
  ]);
  assert.deepEqual(riskyPaths(t, ["src/app.ts", "scripts/audit.py"]), [], "the files someone would mean to commit");
  assert.deepEqual(riskyPaths(t, "all", ["large"]).map((r) => r.path), ["skin_dataset_builder/"]);
  assert.deepEqual(riskLines(risky), [
    "apps/api/.env looks like a secrets file.",
    "skin_dataset_builder/ (more than 4.0 GB in more than 2,000 files) is very large.",
    "4 are documents, not code: Alliance Grant.docx, Articles.docx, Deck.pptx, and 1 more.",
    "skin_dataset_builder.zip is an archive."
  ]);
});

// --- the plans ------------------------------------------------------------------------------------

test("Commit all in a tidy folder is one click, exactly as before", () => {
  const plan = ok(planCommit(repo({ workingTree: tree({ unstaged: [{ path: "src/app.ts", status: "modified" }], untracked: ["src/new.ts"] }) }), { kind: "commit", message: "work", files: "all" }));
  assert.equal(plan.safety, "normal");
  assert.deepEqual(plan.confirm, { kind: "none" });
  assert.deepEqual(plan.details, ["Stages every change, including new files, then commits.", "Stays on this PC until you push. Can be undone until then."]);
});

test("Commit all with a secrets file, documents and an archive in the folder: says which, and asks", () => {
  const plan = ok(planCommit(repo({ workingTree: messy() }), { kind: "commit", message: "work", files: "all" }));
  assert.equal(plan.safety, "caution");
  assert.deepEqual(plan.confirm, { kind: "dialog" });
  assert.equal(plan.details[0], "apps/api/.env looks like a secrets file.");
  assert.match(plan.details.join("\n"), /4 are documents, not code/);
  assert.match(plan.details.join("\n"), /"Commit all" takes these too\. To leave them out, cancel and tick only the files you mean, or ignore them first\./);
  // The steps are unchanged: it warns and asks, it does not quietly leave anything out.
  assert.deepEqual(plan.steps, [{ op: "stage", paths: "all" }, { op: "commit", message: "work", only: null }]);
});

test("committing ticked files: clean ones are one click; a ticked secrets file still asks", () => {
  const state = repo({ workingTree: messy() });
  const clean = ok(planCommit(state, { kind: "commit", message: "audit", files: ["scripts/audit.py", "src/app.ts"] }));
  assert.deepEqual(clean.confirm, { kind: "none" });
  assert.equal(clean.safety, "normal");
  const risky = ok(planCommit(state, { kind: "commit", message: "env", files: ["apps/api/.env", "src/app.ts"] }));
  assert.deepEqual(risky.confirm, { kind: "dialog" });
  assert.equal(risky.details[0], "apps/api/.env looks like a secrets file.");
});

test("Stash all: a secrets file is no reason to ask (a stash stays here); a very large new folder is", () => {
  const plain = ok(planStash(repo({ workingTree: messy() }), { kind: "stash" }));
  assert.deepEqual(plain.confirm, { kind: "none" });
  const big = { ...messy(), sizes: { "skin_dataset_builder/": { files: 2000, bytes: 4 * 1024 ** 3, truncated: true } } };
  const plan = ok(planStash(repo({ workingTree: big }), { kind: "stash" }));
  assert.deepEqual(plan.confirm, { kind: "dialog" });
  assert.equal(plan.safety, "caution");
  assert.match(plan.details.join("\n"), /skin_dataset_builder\/ \(more than 4\.0 GB in more than 2,000 files\) is very large\./);
  assert.match(plan.details.join("\n"), /may take a long time and a lot of disk/);
  // Leaving new files out of the stash leaves the folder out, so there is nothing to ask about.
  assert.deepEqual(ok(planStash(repo({ workingTree: big }), { kind: "stash", includeUntracked: false })).confirm, { kind: "none" });
});

// --- .gitignore -----------------------------------------------------------------------------------

test("a pattern matches exactly the path it was made for", () => {
  assert.equal(ignorePattern("Alliance Grant.docx"), "/Alliance Grant.docx");
  assert.equal(ignorePattern("skin_dataset_builder/"), "/skin_dataset_builder/");
  assert.equal(ignorePattern("docs/report.md"), "/docs/report.md");
  assert.equal(ignorePattern("data\\raw\\"), "/data/raw", "a Windows path as typed");
  // Characters git reads as wildcards are escaped, so only this file is ignored.
  assert.equal(ignorePattern("notes [draft].txt"), "/notes \\[draft\\].txt");
  assert.equal(ignorePattern("what?.md"), "/what\\?.md");
  assert.equal(ignorePattern("a*b.txt"), "/a\\*b.txt");
  // The leading slash already stops '#' and '!' being read as a comment or a negation.
  assert.equal(ignorePattern("#notes.txt"), "/#notes.txt");
  assert.equal(ignorePattern("!important.txt"), "/!important.txt");
  assert.equal(ignorePattern("trailing "), "/trailing\\ ");
});

test("adding to no .gitignore, to one with content, and to one without a final newline", () => {
  assert.deepEqual(addIgnorePatterns(null, ["a.docx", "data/"]), { content: "# Added from DexNest\n/a.docx\n/data/\n", added: ["/a.docx", "/data/"], already: [], refused: [] });
  assert.equal(addIgnorePatterns("node_modules/\n", ["a.docx"]).content, "node_modules/\n\n# Added from DexNest\n/a.docx\n");
  assert.equal(addIgnorePatterns("node_modules/", ["a.docx"]).content, "node_modules/\n\n# Added from DexNest\n/a.docx\n");
  // A file with Windows line endings keeps them.
  assert.equal(addIgnorePatterns("node_modules/\r\ndist/\r\n", ["a.docx"]).content, "node_modules/\r\ndist/\r\n\r\n# Added from DexNest\r\n/a.docx\r\n");
});

test("a second addition goes under the same heading; a path already there is not added twice", () => {
  const first = addIgnorePatterns("node_modules/\n", ["a.docx"]).content;
  const second = addIgnorePatterns(first, ["b.pdf", "a.docx", "b.pdf"]);
  assert.equal(second.content, "node_modules/\n\n# Added from DexNest\n/a.docx\n/b.pdf\n");
  assert.deepEqual(second.added, ["/b.pdf"]);
  assert.deepEqual(second.already, ["a.docx"]);
  const none = addIgnorePatterns(first, ["a.docx"]);
  assert.equal(none.content, first, "nothing to add: the file is not rewritten");
  assert.deepEqual(none.added, []);
});

test("paths that are not inside the project, and .gitignore itself, are refused", () => {
  const edit = addIgnorePatterns("", ["../outside.txt", "C:/abs.txt", "/etc/passwd", ".gitignore", "ok.txt"]);
  assert.deepEqual(edit.added, ["/ok.txt"]);
  assert.deepEqual(edit.refused.map((r) => r.path), ["../outside.txt", "C:/abs.txt", "/etc/passwd", ".gitignore"]);
});
