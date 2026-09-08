// The phone's API, exercised at the HTTP boundary.
//
// Everything here was previously proved only by TypeScript, which checks that
// the routes are spelled consistently and nothing else. It does not check that
// an unpaired device is refused, that a read-only phone cannot pause a run, or
// that the action bridge is still an allowlist — and those are the properties
// the whole design rests on.
//
// Deliberately no Electron and no database. createCompanionApi takes its host
// and its action registry as injected dependencies, so the fakes below are the
// real seam rather than a mock of one.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createCompanionApi, hashToken } from "../src/main/companionApi.ts";

// --- fakes -------------------------------------------------------------------

const TOKEN = "a-real-looking-device-token";
const HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");

interface FakeDevice {
  id: string;
  label: string;
  capabilities: string[];
}

function makeHost(device: FakeDevice | null, over: Record<string, unknown> = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };

  const host = {
    devices: {
      byTokenHash: (hash: string) => (device && hash === HASH ? device : null),
      markSeen: record("markSeen"),
      completePairing: (input: Record<string, unknown>) => {
        calls.push({ name: "completePairing", args: [input] });
        if (input.code !== "123456") throw new Error("That pairing code is not one this machine issued.");
        return { id: "device-new", label: String(input.label), capabilities: ["read", "drop"] };
      },
      setPushToken: record("setPushToken")
    },
    attentionSnapshot: () => ({ deliver: [], hold: [], reason: [], summary: "" }),
    runsForPhone: () => [{ id: "run-1", label: "demo" }],
    snoozeAttention: record("snoozeAttention"),
    control: {
      pause: record("pause"),
      resume: async (...args: unknown[]) => { calls.push({ name: "resume", args }); },
      approve: (...args: unknown[]) => { calls.push({ name: "approve", args }); return {} as never; },
      acceptPlanComplete: record("acceptPlanComplete"),
      rejectPlanComplete: record("rejectPlanComplete")
    },
    ...over
  };
  return { host, calls };
}

/** A request whose body is delivered the way node's http server delivers one. */
function request(method: string, url: string, options: { token?: string; body?: unknown } = {}): IncomingMessage {
  const stream = new EventEmitter() as IncomingMessage & { setEncoding(): void };
  stream.method = method;
  stream.url = url;
  stream.headers = {
    host: "127.0.0.1:43217",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
  } as IncomingMessage["headers"];
  stream.setEncoding = () => {};
  // Emitted on the next tick so the handler has attached its listeners first,
  // exactly as a real socket would.
  queueMicrotask(() => {
    if (options.body !== undefined) stream.emit("data", JSON.stringify(options.body));
    stream.emit("end");
  });
  return stream;
}

interface Captured { status: number; body: Record<string, unknown> }

function response(): { res: ServerResponse; done: Promise<Captured> } {
  let settle: (value: Captured) => void;
  const done = new Promise<Captured>(resolve => { settle = resolve; });
  let status = 0;
  const res = {
    writeHead(code: number) { status = code; return res; },
    end(text?: string) {
      settle({ status, body: text ? JSON.parse(text) as Record<string, unknown> : {} });
      return res;
    }
  } as unknown as ServerResponse;
  return { res, done };
}

async function call(
  api: ReturnType<typeof createCompanionApi>,
  method: string,
  url: string,
  options: { token?: string; body?: unknown } = {}
): Promise<Captured & { handled: boolean }> {
  const { res, done } = response();
  const handled = await api(request(method, url, options), res);
  return { ...(await done), handled };
}

const paired = (capabilities: string[]) => ({ id: "device-1", label: "phone", capabilities });

// --- authentication ----------------------------------------------------------

test("every route but pairing refuses a request with no token", async () => {
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });

  for (const [method, path] of [
    ["GET", "/companion/whoami"], ["GET", "/companion/attention"], ["GET", "/companion/runs"],
    ["GET", "/companion/today"], ["GET", "/companion/usage"], ["GET", "/companion/health"],
    ["POST", "/companion/push-token"], ["POST", "/companion/control"], ["POST", "/companion/snooze"]
  ] as const) {
    const result = await call(api, method, path);
    assert.equal(result.status, 401, `${method} ${path}`);
  }
});

test("a token that is not a paired device is refused", async () => {
  const { host } = makeHost(null);
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "GET", "/companion/whoami", { token: TOKEN });
  assert.equal(result.status, 401);
});

test("a paired device is let through, and its token never comes back", async () => {
  const { host, calls } = makeHost(paired(["read", "drop"]));
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "GET", "/companion/whoami", { token: TOKEN });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.device, { id: "device-1", label: "phone", capabilities: ["read", "drop"] });
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false, "a response must never echo the token");
  assert.ok(calls.some(entry => entry.name === "markSeen"), "and the device is marked seen");
});

test("hashToken is what the store is asked for, never the token", () => {
  assert.equal(hashToken(TOKEN), HASH);
  assert.equal(hashToken(TOKEN).includes(TOKEN), false);
});

// --- pairing -----------------------------------------------------------------

test("pairing needs no token, and returns one exactly once", async () => {
  const { host } = makeHost(null);
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/pair", { body: { code: "123456", label: "S24" } });

  assert.equal(result.status, 200);
  assert.equal(typeof result.body.token, "string");
  assert.ok((result.body.token as string).length >= 32, "long enough that guessing is hopeless");
});

test("a wrong pairing code is refused in the provider's own words", async () => {
  const { host } = makeHost(null);
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/pair", { body: { code: "000000" } });
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /not one this machine issued/);
});

// --- control gating ----------------------------------------------------------

test("a read-only phone cannot control a run", async () => {
  const { host, calls } = makeHost(paired(["read", "drop"]));
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "pause", runId: "run-1" } });

  assert.equal(result.status, 403);
  assert.match(String(result.body.error), /may read but not control/);
  assert.equal(calls.some(entry => entry.name === "pause"), false, "and nothing happened to the run");
});

test("drop does not stand in for control", async () => {
  // The two grants are independent, and receiving a photo must never imply
  // being able to stop a night's work.
  const { host } = makeHost(paired(["read", "drop"]));
  const api = createCompanionApi({ host: host as never });
  assert.equal((await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "resume", runId: "r" } })).status, 403);
});

test("a controlling phone reaches exactly the verb it named", async () => {
  const { host, calls } = makeHost(paired(["read", "control"]));
  const api = createCompanionApi({ host: host as never });

  assert.equal((await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "pause", runId: "run-1" } })).status, 200);
  assert.equal((await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "accept_plan", runId: "run-1" } })).status, 200);

  assert.deepEqual(calls.filter(e => e.name === "pause").length, 1);
  assert.deepEqual(calls.filter(e => e.name === "acceptPlanComplete").length, 1);
});

test("a verb that is not in the closed set is refused", async () => {
  // The property that stops a string off the network selecting a function.
  const { host, calls } = makeHost(paired(["read", "control"]));
  const api = createCompanionApi({ host: host as never });

  for (const verb of ["stop", "delete", "constructor", "__proto__", "toString", ""]) {
    const result = await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb, runId: "run-1" } });
    assert.equal(result.status, 400, verb);
  }
  // markSeen is recorded by authorise on every accepted token, so the check is
  // that no *control* method was reached — not that nothing was recorded.
  const acted = calls.filter(e => ["pause", "resume", "approve", "acceptPlanComplete", "rejectPlanComplete"].includes(e.name));
  assert.deepEqual(acted, [], "no host control method was reached by any of them");
});

test("rejecting a plan without a reason is refused", async () => {
  // Without one the worker is told to keep going with nothing to do
  // differently, which is how a run repeats the same phase twice.
  const { host, calls } = makeHost(paired(["read", "control"]));
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "reject_plan", runId: "run-1" } });

  assert.equal(result.status, 400);
  assert.equal(calls.some(e => e.name === "rejectPlanComplete"), false);
});

test("an engine that refuses a transition answers 409, not 500", async () => {
  const { host } = makeHost(paired(["read", "control"]), {
    control: { pause() { throw new Error("Primary can start or resume only from READY or PAUSED."); } }
  });
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/control", { token: TOKEN, body: { verb: "pause", runId: "run-1" } });

  assert.equal(result.status, 409);
  assert.match(String(result.body.error), /READY or PAUSED/);
});

// --- snooze ------------------------------------------------------------------

test("snoozing needs only read", async () => {
  // Putting a question off is a preference about being interrupted, not an act
  // on the run — so a read-only phone may do it.
  const { host, calls } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "POST", "/companion/snooze", {
    token: TOKEN, body: { groupKey: "run-1:action", question: "Run proposes it is done", minutes: 60 }
  });

  assert.equal(result.status, 200);
  assert.equal(calls.filter(e => e.name === "snoozeAttention").length, 1);
});

test("a snooze must name the question, and a sane duration", async () => {
  const { host, calls } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });

  for (const body of [
    { groupKey: "g", minutes: 60 },
    { question: "q", minutes: 60 },
    { groupKey: "g", question: "q", minutes: 0 },
    { groupKey: "g", question: "q", minutes: -5 },
    { groupKey: "g", question: "q", minutes: 60 * 25 },
    { groupKey: "g", question: "q", minutes: Number.NaN }
  ]) {
    assert.equal((await call(api, "POST", "/companion/snooze", { token: TOKEN, body })).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.some(e => e.name === "snoozeAttention"), false);
});

// --- the action bridge -------------------------------------------------------

const action = (over: Record<string, unknown>) => ({
  id: "x.y", title: "X", moduleId: "command", description: "", enabled: true, ...over
}) as unknown as DexNestActionDefinitionLike;
type DexNestActionDefinitionLike = Parameters<NonNullable<Parameters<typeof createCompanionApi>[0]["actions"]>["list"]>[never];

test("an action that has not opted in is unreachable, and answers like an unknown one", async () => {
  // Identical answers on purpose: a difference between "does not exist" and
  // "exists but is not for you" is a way to enumerate the registry.
  const ran: string[] = [];
  const { host } = makeHost(paired(["read", "control"]));
  const api = createCompanionApi({
    host: host as never,
    actions: {
      list: () => [action({ id: "vault.secure.copy_username", dangerLevel: "safe" })] as never,
      run: async (id: string) => { ran.push(id); return null; }
    }
  });

  const hidden = await call(api, "POST", "/companion/action", { token: TOKEN, body: { actionId: "vault.secure.copy_username" } });
  const unknown = await call(api, "POST", "/companion/action", { token: TOKEN, body: { actionId: "no.such.action" } });

  assert.equal(hidden.status, 404);
  assert.equal(unknown.status, 404);
  assert.equal(hidden.body.error, unknown.body.error, "the two must be indistinguishable");
  assert.equal(String(hidden.body.error).includes("vault"), false, "and name nothing about what was refused");
  assert.deepEqual(ran, [], "nothing was executed");
});

test("a declared read action runs, and the listing agrees with the gate", async () => {
  const ran: string[] = [];
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({
    host: host as never,
    actions: {
      list: () => [
        action({ id: "command.refresh_stats", phone: "read" }),
        action({ id: "some.control_thing", phone: "control" }),
        action({ id: "hidden.thing" })
      ] as never,
      run: async (id: string) => { ran.push(id); return { ok: true }; }
    }
  });

  const listed = await call(api, "GET", "/companion/actions", { token: TOKEN });
  assert.deepEqual((listed.body.actions as Array<{ id: string }>).map(a => a.id), ["command.refresh_stats"],
    "a read-only device is not offered the control action, nor the undeclared one");

  assert.equal((await call(api, "POST", "/companion/action", { token: TOKEN, body: { actionId: "command.refresh_stats" } })).status, 200);
  assert.equal((await call(api, "POST", "/companion/action", { token: TOKEN, body: { actionId: "some.control_thing" } })).status, 403);
  assert.deepEqual(ran, ["command.refresh_stats"]);
});

// --- shape -------------------------------------------------------------------

test("anything outside /companion is left for the rest of the server", async () => {
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });
  const { res } = response();
  assert.equal(await api(request("GET", "/drop/api/state"), res), false);
  assert.equal(await api(request("GET", "/health"), res), false);
});

test("an unknown companion path is a 404, not a fall-through", async () => {
  // Falling through would hand a phone's request to the Stream Deck endpoint,
  // which authorises on a completely different rule.
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });
  const result = await call(api, "GET", "/companion/nope", { token: TOKEN });
  assert.equal(result.handled, true);
  assert.equal(result.status, 404);
});

test("today, usage and health are served when the host offers them", async () => {
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({
    host: host as never,
    today: () => ({ date: "2026-09-08", items: [], counts: { events: 0, blocks: 0, nudges: 0, needsAction: 0 }, generatedAt: "" }) as never,
    planUsage: async () => ({ generatedAt: "", providers: [] }),
    weather: () => ({ configured: false }),
    health: () => ({ status: "pass", checkedAt: null, summary: null, failing: [] })
  });

  for (const path of ["/companion/today", "/companion/usage", "/companion/weather", "/companion/health"]) {
    assert.equal((await call(api, "GET", path, { token: TOKEN })).status, 200, path);
  }
});

test("a host with nothing to offer says so rather than pretending", async () => {
  const { host } = makeHost(paired(["read"]));
  const api = createCompanionApi({ host: host as never });
  assert.equal((await call(api, "GET", "/companion/today", { token: TOKEN })).status, 503);
  assert.equal((await call(api, "GET", "/companion/usage", { token: TOKEN })).status, 503);
});
