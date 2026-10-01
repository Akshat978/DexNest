import { strict as assert } from "node:assert";
import { test } from "node:test";

import { checkCloneUrl, githubLinks, parseRemote, redactCredentials, remoteIdentity, stripUrlCredentials } from "../src/domain/remote.ts";
import { checkBranchName, checkRemoteName, checkRepoPath } from "../src/domain/names.ts";

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

test("credentials are stripped from remote URLs; ssh login names are kept", () => {
  assert.equal(stripUrlCredentials(`https://me:${TOKEN}@github.com/me/app.git`), "https://github.com/me/app.git");
  assert.equal(stripUrlCredentials(`https://${TOKEN}@github.com/me/app.git`), "https://github.com/me/app.git");
  assert.equal(stripUrlCredentials("https://x-access-token:abc@ghe.local:8443/a/b"), "https://ghe.local:8443/a/b");
  assert.equal(stripUrlCredentials("ssh://git@github.com/me/app.git"), "ssh://git@github.com/me/app.git");
  assert.equal(stripUrlCredentials("ssh://git:pw@host/x"), "ssh://host/x");
  assert.equal(stripUrlCredentials("git@github.com:me/app.git"), "git@github.com:me/app.git");
  assert.equal(stripUrlCredentials("https://github.com/me/app"), "https://github.com/me/app");
});

test("credentials are redacted inside free text such as git's stderr", () => {
  const stderr = `fatal: unable to access 'https://me:${TOKEN}@github.com/me/app.git/': 403\nremote: token ${TOKEN} revoked`;
  const out = redactCredentials(stderr);
  assert.equal(out.includes(TOKEN), false);
  assert.match(out, /https:\/\/github\.com\/me\/app\.git/);
  assert.equal(redactCredentials("github_pat_11ABCDEFG0123456789_abcdefghijklmnop").includes("github_pat_11"), false);
});

test("GitHub remotes are recognised in every common form, others are not", () => {
  for (const url of [
    "https://github.com/Me/App.git",
    "https://www.github.com/Me/App",
    "git@github.com:Me/App.git",
    "ssh://git@github.com/Me/App.git",
    `https://${TOKEN}@github.com/Me/App.git`
  ]) {
    const parsed = parseRemote(url);
    assert.deepEqual(parsed && { hosting: parsed.hosting, owner: parsed.owner, repo: parsed.repo }, { hosting: "github", owner: "Me", repo: "App" }, url);
  }
  assert.equal(parseRemote("https://gitlab.com/group/sub/repo.git")?.hosting, "other");
  assert.equal(parseRemote("not a url"), null);
  assert.equal(parseRemote("https://github.com/"), null);
  assert.equal(parseRemote("https://github.com/a/../b"), null);
});

test("the same repository over https and ssh is a duplicate", () => {
  assert.equal(remoteIdentity("https://github.com/Me/App.git"), remoteIdentity("git@github.com:me/app"));
  assert.notEqual(remoteIdentity("https://github.com/me/app"), remoteIdentity("https://github.com/me/app2"));
});

test("GitHub links: repo, branch (with slashes) and compare; nothing for other hosts", () => {
  const links = githubLinks("git@github.com:me/app.git")!;
  assert.equal(links.repo, "https://github.com/me/app");
  assert.equal(links.branch("feature/a b"), "https://github.com/me/app/tree/feature/a%20b");
  assert.equal(links.compare("main", "feature/x"), "https://github.com/me/app/compare/main...feature/x");
  assert.equal(githubLinks("https://gitlab.com/me/app"), null);
  assert.equal(githubLinks(null), null);
});

test("clone URLs: https and ssh only; never ext::/fd::, options, or embedded tokens", () => {
  assert.equal(checkCloneUrl("https://github.com/me/app.git").ok, true);
  assert.equal(checkCloneUrl("git@github.com:me/app.git").ok, true);
  assert.equal(checkCloneUrl("ssh://git@github.com/me/app.git").ok, true);
  for (const bad of [
    "ext::sh -c touch% /tmp/pwned",
    "fd::17",
    "--upload-pack=touch /tmp/x",
    "-u x",
    "file:///etc",
    "/home/me/repo",
    "C:\\code\\repo",
    "http://github.com/me/app",
    `https://me:${TOKEN}@github.com/me/app`,
    "https://github.com/me/app\nevil",
    ""
  ]) {
    assert.equal(checkCloneUrl(bad).ok, false, bad);
  }
  assert.equal(checkCloneUrl("/tmp/origin.git", { allowLocal: true }).ok, true);
  assert.equal(checkCloneUrl("ext::x", { allowLocal: true }).ok, false);
});

test("names that reach a git command line can't be options or escape the repo", () => {
  assert.equal(checkBranchName("feature/new-thing_2").ok, true);
  assert.equal(checkBranchName("-f").ok, false);
  assert.equal(checkBranchName("--delete").ok, false);
  assert.equal(checkBranchName("a\u0000b").ok, false);
  assert.equal(checkRepoPath("src/a b/ü.ts").ok, true);
  assert.equal(checkRepoPath("-dash-file.txt").ok, true, "paths always follow -- so a leading dash is fine");
  for (const bad of ["", "/etc/passwd", "\\\\server\\x", "D:/x", "a/../../b", ":(top)x", "a\nb"]) assert.equal(checkRepoPath(bad).ok, false, bad);
  assert.equal(checkRemoteName("origin").ok, true);
  for (const bad of ["--mirror", "-o", "a b", "a..b", ""]) assert.equal(checkRemoteName(bad).ok, false, bad);
});
