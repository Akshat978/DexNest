// Prompt timeout vs. the output budget DexNest itself asks for.
//
// From the first real dogfood run. Worker tools are disabled, so a worker can
// only change a file by re-emitting that file in full, and workerOutput accepts
// up to MAX_OUTPUT_FILE_BYTES per file. Turn 3 of that run asked Claude to
// rewrite a 34,683-byte source file with a 120s budget. Claude's own transcript
// shows the prompt arrived and no assistant message was ever produced: the
// process was killed mid-generation, and the send settled UNCERTAIN because
// DexNest correctly refuses to guess whether a killed send was delivered.
//
// The defect was not the uncertain-send handling, which behaved exactly as
// designed. It was that the time budget was smaller than the output budget, so
// a healthy provider doing the work asked of it looked like a hung process.
//
// These assertions tie the two budgets together so they cannot drift apart
// again, and pin the probe timeouts short so a missing CLI still fails fast.

import { test } from "node:test";
import assert from "node:assert/strict";

import { WORKER_PROMPT_TIMEOUT_MS, WORKER_PROBE_TIMEOUT_MS } from "../src/worker.ts";
import { MAX_OUTPUT_FILE_BYTES } from "../src/workerOutput.ts";
import { claudeCodeProtocol } from "../src/claudeCodeWorker.ts";
import { codexProtocol } from "../src/codexWorker.ts";
import type { WorkerSession } from "../src/workerStore.ts";

/**
 * A deliberately pessimistic floor for sustained code generation. Real output
 * is faster; the point is that the budget must not depend on it being fast.
 */
const FLOOR_BYTES_PER_SECOND = 120;

/** The file turn 3 was actually asked to re-emit. */
const OBSERVED_WHOLE_FILE_BYTES = 34_683;

const session = (provider: string): WorkerSession => ({
  runId: "coding-run-timeout", provider, sessionId: "11111111-2222-3333-4444-555555555555",
  cwd: "D:/dexnest-worktrees/coding-run-timeout", established: false, disabledMcpServers: []
});

test("the prompt budget covers the whole-file emit that actually timed out", () => {
  const needed = (OBSERVED_WHOLE_FILE_BYTES / FLOOR_BYTES_PER_SECOND) * 1000;
  assert.ok(WORKER_PROMPT_TIMEOUT_MS >= needed,
    `${WORKER_PROMPT_TIMEOUT_MS}ms cannot emit ${OBSERVED_WHOLE_FILE_BYTES}B; needs >= ${Math.ceil(needed)}ms`);

  // The old value is the regression being pinned.
  assert.ok(WORKER_PROMPT_TIMEOUT_MS > 120_000, "120s was below DexNest's own output protocol");
});

test("the prompt budget is stated against the output budget, not a round number", () => {
  // A worker may legitimately emit several files in one turn, so the budget is
  // not required to cover MAX_OUTPUT_FILE_BYTES; it must cover a substantial
  // fraction of it, or the accepted-file limit is advertising a lie.
  const maxFileMs = (MAX_OUTPUT_FILE_BYTES / FLOOR_BYTES_PER_SECOND) * 1000;
  assert.ok(WORKER_PROMPT_TIMEOUT_MS >= maxFileMs / 2,
    `a ${MAX_OUTPUT_FILE_BYTES}B file is accepted but ${WORKER_PROMPT_TIMEOUT_MS}ms cannot produce half of one`);
});

test("probes still fail fast, and are far shorter than a prompt", () => {
  assert.equal(WORKER_PROBE_TIMEOUT_MS, 15_000);
  assert.ok(WORKER_PROBE_TIMEOUT_MS * 4 < WORKER_PROMPT_TIMEOUT_MS,
    "a missing or unauthenticated CLI must not block for a prompt-length window");
});

test("both providers apply the prompt budget to sends and the probe budget to probes", () => {
  for (const protocol of [claudeCodeProtocol("C:/claude/claude.exe"), codexProtocol("C:/codex/codex.exe")]) {
    const cwd = session(protocol.id).cwd;
    assert.equal(protocol.installation(cwd).timeoutMs, WORKER_PROBE_TIMEOUT_MS, `${protocol.id} installation`);
    assert.equal(protocol.authentication(cwd).timeoutMs, WORKER_PROBE_TIMEOUT_MS, `${protocol.id} authentication`);

    const prompt = protocol.prompt(session(protocol.id), "rewrite report.ts in full");
    assert.equal(prompt.timeoutMs, WORKER_PROMPT_TIMEOUT_MS, `${protocol.id} prompt`);
    assert.notEqual(prompt.stdin, undefined, `${protocol.id} prompt must send stdin`);
  }
});
