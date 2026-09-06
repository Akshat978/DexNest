// Watching a turn happen.
//
// The whole design claim here is that visibility is not on the critical path:
// the outcome is still read from the completed process, and this only reads the
// same bytes on their way past. So most of these tests are about what happens
// when the live view goes wrong — a malformed line, an unknown event type, a
// chunk split mid-JSON — and assert that none of it reaches a decision.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ActivityStream, LiveActivity, readActivityLine,
  MAX_ACTIVITY_EVENTS, MAX_LABEL_CHARS
} from "../src/liveActivity.ts";
import { claudeCodeProtocol, resultEvent } from "../src/claudeCodeWorker.ts";
import { agenticCapabilities } from "../src/worker.ts";

const NOW = "2026-09-06T12:00:00.000Z";
const line = (value: unknown) => JSON.stringify(value);

const assistant = (content: unknown[]) => line({ type: "assistant", message: { role: "assistant", content } });

// --- reading the stream -----------------------------------------------------

test("tool calls are described the way a person would say them", () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["Read", { file_path: "src/index.ts" }, /^Reading src\/index\.ts$/],
    ["Edit", { file_path: "src/app.ts" }, /^Editing src\/app\.ts$/],
    ["Write", { file_path: "src/new.ts" }, /^Writing src\/new\.ts$/],
    ["Bash", { command: "npm test" }, /^Running npm test$/],
    ["Grep", { pattern: "TODO" }, /^Searching for TODO$/],
    ["TodoWrite", {}, /task list/]
  ];
  for (const [name, input, expected] of cases) {
    const event = readActivityLine(assistant([{ type: "tool_use", name, input }]), NOW)!;
    assert.equal(event.kind, "tool");
    assert.match(event.label, expected);
  }
});

test("thinking and text come through, bounded to one line", () => {
  const thinking = readActivityLine(assistant([{ type: "thinking", thinking: "Let me look at the store first." }]), NOW)!;
  assert.equal(thinking.kind, "thinking");
  assert.match(thinking.label, /look at the store/);

  const long = readActivityLine(assistant([{ type: "text", text: "x".repeat(MAX_LABEL_CHARS + 500) }]), NOW)!;
  assert.equal(long.label.length, MAX_LABEL_CHARS);
  assert.ok(long.detail!.length > long.label.length, "the full text is still available to expand");

  // Newlines would break a one-line display.
  const wrapped = readActivityLine(assistant([{ type: "text", text: "first\nsecond" }]), NOW)!;
  assert.equal(wrapped.label, "first second");
});

test("an unknown event type is skipped, not an error", () => {
  // The CLI gains event types over time. A viewer that broke on an unfamiliar
  // one would be worse than a viewer that quietly ignores it.
  assert.equal(readActivityLine(line({ type: "something_new_in_a_later_version", detail: {} }), NOW), null);
  assert.equal(readActivityLine("{ not json", NOW), null);
  assert.equal(readActivityLine("", NOW), null);
  assert.equal(readActivityLine(line({ no: "type" }), NOW), null);
  assert.equal(readActivityLine(line({ type: "assistant", message: {} }), NOW), null);
});

test("the result line says the turn finished, and distinguishes an error", () => {
  const ok = readActivityLine(line({ type: "result", subtype: "success", is_error: false, result: "done" }), NOW)!;
  assert.equal(ok.kind, "result");
  assert.match(ok.label, /finished/);

  const bad = readActivityLine(line({ type: "result", is_error: true, errors: ["Usage limit reached"] }), NOW)!;
  assert.equal(bad.kind, "error");
  assert.match(bad.detail!, /Usage limit reached/);
});

// --- chunks arrive however they arrive --------------------------------------

test("a chunk split mid-line holds the tail back rather than parsing it", () => {
  const stream = new ActivityStream(() => NOW);
  const whole = assistant([{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }]) + "\n";

  assert.deepEqual(stream.push(whole.slice(0, 20)), [], "half a line is not an event");
  const produced = stream.push(whole.slice(20));
  assert.equal(produced.length, 1);
  assert.match(produced[0]!.label, /Reading a\.ts/);
});

test("the window is bounded, so a long turn costs a fixed amount of memory", () => {
  const stream = new ActivityStream(() => NOW);
  for (let index = 0; index < MAX_ACTIVITY_EVENTS + 50; index += 1) {
    stream.push(assistant([{ type: "text", text: `line ${index}` }]) + "\n");
  }
  const events = stream.recent();
  assert.equal(events.length, MAX_ACTIVITY_EVENTS);
  assert.match(events.at(-1)!.label, new RegExp(`line ${MAX_ACTIVITY_EVENTS + 49}`), "newest is kept");
});

test("a run's window is per run and thrown away on demand", () => {
  const live = new LiveActivity(() => NOW);
  const sink = live.begin("run-a");
  sink(assistant([{ type: "text", text: "hello" }]) + "\n");
  assert.equal(live.recent("run-a").length, 1);
  assert.deepEqual(live.recent("run-b"), []);

  // A new turn starts a fresh window rather than appending to the last one.
  live.begin("run-a");
  assert.deepEqual(live.recent("run-a"), []);
  live.clear("run-a");
  assert.deepEqual(live.recent("run-a"), []);
});

// --- and none of it decides anything ----------------------------------------

test("the outcome is read from the result event, whether streamed or buffered", () => {
  // json mode: the whole of stdout is the object.
  const buffered = JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" });
  assert.equal(resultEvent(buffered)?.result, "done");

  // stream-json mode: many lines, and the LAST result line is the outcome.
  const streamed = [
    line({ type: "system", subtype: "init" }),
    assistant([{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }]),
    assistant([{ type: "text", text: "Done." }]),
    line({ type: "result", subtype: "success", is_error: false, session_id: "s", result: "done" })
  ].join("\n");
  assert.equal(resultEvent(streamed)?.result, "done");
});

test("an incomplete stream is not read as a completed one", () => {
  // A killed process leaves a stream with no result line. That must read as no
  // completion at all, which the caller already treats as uncertain — never as
  // a success inferred from whatever text arrived first.
  const truncated = [
    line({ type: "system", subtype: "init" }),
    assistant([{ type: "text", text: "I have started" }])
  ].join("\n");
  assert.equal(resultEvent(truncated), null);
  assert.equal(resultEvent(""), null);
  assert.equal(resultEvent("{ half a line"), null);

  const completion = claudeCodeProtocol("C:/claude/claude.exe").completion(
    { ok: false, stdout: truncated, stderr: "", detail: { failure: "timeout" } } as never,
    "session-1"
  );
  assert.equal(completion.ok, false);
  assert.equal(completion.certain, false, "a half-written stream stays uncertain");
});

test("streaming is what the CLI is asked for, and it changes nothing else", () => {
  const args = claudeCodeProtocol("C:/claude/claude.exe", agenticCapabilities())
    .prompt({ runId: "r", provider: "claude", sessionId: "11111111-2222-4333-8444-555555555555", cwd: "D:/MyApp", established: false }, "go")
    .args;
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  // Not a debugging aid and not optional: the CLI refuses outright with
  // "When using --print, --output-format=stream-json requires --verbose".
  // The first real run died on this in 1.5 seconds, before any model call.
  assert.ok(args.includes("--verbose"), "stream-json without --verbose is rejected by the CLI");
  // The things that decide what a turn may do are untouched by streaming.
  assert.ok(args.includes("--safe-mode"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
});
