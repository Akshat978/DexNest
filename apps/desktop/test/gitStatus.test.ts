/**
 * Reading git's porcelain v2 output.
 *
 * The fixtures below are real `git status --porcelain=v2 --branch` output,
 * captured rather than imagined. A parser tested against output invented by
 * the person who wrote the parser proves only that the two agree.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { canPush, describe as describeStatus, parseCommit, parseStatus, type GitPresent } from "../src/main/gitStatus.ts";

const CLEAN_AHEAD = [
  "# branch.oid b9b73c36c1da68e1cc78da33b7a4f5b00afdee2d",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +3 -0"
].join("\n");

test("a clean branch ahead of its upstream", () => {
  const status = parseStatus(CLEAN_AHEAD);
  assert.equal(status.branch, "main");
  assert.equal(status.upstream, "origin/main");
  assert.equal(status.ahead, 3);
  assert.equal(status.behind, 0);
  assert.equal(status.clean, true);
});

test("untracked files make a tree dirty", () => {
  // The case that decides whether "clean" can be trusted before a commit: a
  // brand-new file is invisible to the index and is exactly what gets left
  // behind when a tree is called clean on the strength of tracked files alone.
  const status = parseStatus(`${CLEAN_AHEAD}\n? apps/desktop/src/main/gitStatus.ts\n`);
  assert.equal(status.untracked, 1);
  assert.equal(status.changed, 0);
  assert.equal(status.clean, false);
});

test("modified and renamed entries both count as changed", () => {
  const status = parseStatus([
    CLEAN_AHEAD,
    "1 .M N... 100644 100644 100644 aaa bbb apps/desktop/src/main/main.ts",
    "2 R. N... 100644 100644 100644 ccc ddd R100 new/path.ts\told/path.ts"
  ].join("\n"));
  assert.equal(status.changed, 2);
  assert.equal(status.untracked, 0);
});

test("unmerged entries are reported apart from ordinary changes", () => {
  // A merge in progress is not the same problem as uncommitted work, and a
  // push button that treated them alike would offer to push a conflicted tree.
  const status = parseStatus([
    CLEAN_AHEAD,
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc packages/thing.ts"
  ].join("\n"));
  assert.equal(status.conflicted, 1);
  assert.equal(status.changed, 0);
  assert.equal(status.clean, false);
});

test("a branch with no upstream reports null divergence, not zero", () => {
  // Zero would say "level with the remote" about a branch that has never been
  // pushed. Null is the difference between nothing to push and nowhere to.
  const status = parseStatus("# branch.oid aaa\n# branch.head feature/new\n# branch.upstream\n");
  assert.equal(status.upstream, null);
  assert.equal(status.ahead, null);
  assert.equal(status.behind, null);
});

test("a detached HEAD has no branch name", () => {
  const status = parseStatus("# branch.oid aaa\n# branch.head (detached)\n");
  assert.equal(status.branch, null);
  assert.equal(status.upstream, null);
});

test("unknown header lines are ignored rather than fatal", () => {
  // porcelain v2 is additive. A git that adds a header should not turn every
  // project's status into an error over a line that changes nothing.
  const status = parseStatus(`${CLEAN_AHEAD}\n# branch.somethingNew value\n`);
  assert.equal(status.branch, "main");
  assert.equal(status.clean, true);
});

test("CRLF output parses the same as LF", () => {
  // git on Windows can hand back CRLF, and a stray carriage return would
  // otherwise end up inside the branch name.
  const status = parseStatus(CLEAN_AHEAD.split("\n").join("\r\n"));
  assert.equal(status.branch, "main");
  assert.equal(status.upstream, "origin/main");
});

test("a commit subject containing punctuation survives", () => {
  // NUL separators exist for this: a subject may contain tabs, pipes and
  // anything else a person types, and splitting on those would truncate it.
  // \u0000 rather than \0 here: \0 immediately followed by a digit is a legacy
  // octal escape, which strict mode rejects outright.
  const commit = parseCommit("abc123\u0000feat(x): a | b\tc - d\u00002026-09-09T10:00:00+05:30\n");
  assert.equal(commit?.sha, "abc123");
  assert.equal(commit?.subject, "feat(x): a | b\tc - d");
});

test("an empty log means no commit, not a broken one", () => {
  assert.equal(parseCommit(""), null);
  assert.equal(parseCommit("\n"), null);
});

test("the one-line description leads with what is wrong", () => {
  assert.equal(describeStatus(parseStatus(CLEAN_AHEAD)), "main · 3 ahead");
  assert.equal(
    describeStatus(parseStatus("# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n")),
    "main · clean"
  );
  assert.equal(
    describeStatus(parseStatus(`${CLEAN_AHEAD}\n? a.ts\n1 .M N... 1 1 1 a b c.ts`)),
    "main · 3 ahead · 2 uncommitted"
  );
});

test("clean is not appended to a line that already lists problems", () => {
  // "main · 2 uncommitted · clean" describes two different repositories.
  const line = describeStatus(parseStatus("# branch.head main\n? a.ts\n? b.ts\n"));
  assert.equal(line, "main · no upstream · 2 uncommitted");
});

test("a project that is not a repository says so", () => {
  assert.equal(describeStatus({ repo: false }), "not a git repository");
  assert.equal(describeStatus({ repo: false, problem: "git is not installed" }), "git is not installed");
});


// --- whether to push ----------------------------------------------------------
//
// Every case here is a state where pushing would either fail at git or succeed
// at something that was not asked for. The predicate exists so those are
// decided once, in one place, rather than in whichever surface pressed the
// button.

const repo = (over: Partial<GitPresent> = {}): GitPresent => ({
  repo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 0,
  changed: 0,
  untracked: 0,
  conflicted: 0,
  clean: true,
  ...over
});

test("commits ahead of a clean upstream are pushed", () => {
  const verdict = canPush(repo());
  assert.equal(verdict.push, true);
  assert.match(verdict.reason, /2 commits to origin\/main/);
});

test("uncommitted work does not block the push, but is named", () => {
  // The line this feature is built on: it pushes what is committed and does
  // not commit for you. Staying silent about the rest would let "pushed" read
  // as "everything here is on the remote".
  const verdict = canPush(repo({ changed: 3, untracked: 1, clean: false }));
  assert.equal(verdict.push, true);
  assert.match(verdict.reason, /4 uncommitted files stay behind/);
});

test("a diverged branch is refused rather than forced", () => {
  // git rejects this, and the only thing that would make it succeed is a
  // force-push - which would discard whatever is on the remote.
  const verdict = canPush(repo({ ahead: 2, behind: 3 }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /diverged/);
  assert.match(verdict.reason, /Pull first/);
});

test("a branch level with its upstream has nothing to push", () => {
  const verdict = canPush(repo({ ahead: 0 }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /already level/);
});

test("a branch behind but not ahead is nothing to push, not a divergence", () => {
  const verdict = canPush(repo({ ahead: 0, behind: 4 }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /already level/);
});

test("a branch with no upstream is refused rather than given one", () => {
  // Choosing a remote and a remote branch name is a decision, not a step.
  const verdict = canPush(repo({ upstream: null, ahead: null, behind: null }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /no upstream/);
});

test("a conflicted tree is refused even when commits are ahead", () => {
  // Ahead and conflicted at once: pushing here publishes half a resolution.
  const verdict = canPush(repo({ conflicted: 2, clean: false }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /conflicted/);
});

test("a detached HEAD is refused rather than resolved to a branch", () => {
  const verdict = canPush(repo({ branch: null }));
  assert.equal(verdict.push, false);
  assert.match(verdict.reason, /detached/);
});

test("something that is not a repository is refused with its own reason", () => {
  assert.deepEqual(
    canPush({ repo: false, problem: "Project folder not found." }),
    { push: false, reason: "Project folder not found." }
  );
});
