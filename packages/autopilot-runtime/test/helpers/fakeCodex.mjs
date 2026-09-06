import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, appendFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const read = (name, fallback) => existsSync(resolve(name)) ? JSON.parse(readFileSync(resolve(name), "utf8")) : fallback;
if (args[0] === "--version") { console.log("codex-cli 0.153.0"); process.exit(0); }
if (args[0] === "login") {
  const method = read(".fake-codex-auth", "ChatGPT");
  console.error(method === "none" ? "Not logged in" : `Logged in using ${method}`);
  process.exit(method === "none" ? 1 : 0);
}
if (args[0] === "mcp") { console.log(JSON.stringify(read(".fake-codex-mcp", [{ name: "inherited", enabled: true, transport: { url: "https://secret.invalid", token: "never-persist-this-token" } }]))); process.exit(0); }
if (args[0] !== "app-server") process.exit(2);
const config = { mcp_servers: { inherited: { enabled: true } } };
for (let index = 0; index < args.length; index++) {
  if (args[index] !== "-c") continue;
  const setting = args[++index]; const separator = setting.indexOf("=");
  const path = setting.slice(0, separator).split(".");
  let target = config;
  for (const key of path.slice(0,-1)) target = target[key] ??= {};
  target[path.at(-1)] = JSON.parse(setting.slice(separator + 1));
}
const reply = (id, result) => console.log(JSON.stringify({ id, result }));
const error = (id, message) => console.log(JSON.stringify({ id, error: { code: -32600, message } }));
const notify = (method, params) => console.log(JSON.stringify({ method, params }));
let threadId;
let resumed = false;
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  const request = JSON.parse(line);
  appendFileSync(resolve(".fake-codex-rpc"), JSON.stringify({ method: request.method, params: request.params }) + "\n");
  if (request.method === "initialize") return reply(request.id, { userAgent: "codex-cli/0.153.0" });
  if (request.method === "initialized") return;
  if (request.method === "config/read") {
    if (read(".fake-codex-unsafe", false)) config.mcp_servers.unexpected = { enabled: true };
    return reply(request.id, { config, origins: {}, layers: [{ name: { type: "sessionFlags" }, config, version: "1" }] });
  }
  if (request.method === "account/read") return reply(request.id, { account: { type: read(".fake-codex-account", "chatgpt"), planType: "pro" }, requiresOpenaiAuth: true });
  if (request.method === "thread/start") {
    threadId = randomUUID(); writeFileSync(resolve(`.fake-codex-session-${threadId}`), "session");
    return reply(request.id, { thread: { id: threadId, cwd: process.cwd() } });
  }
  if (request.method === "thread/resume") {
    threadId = request.params.threadId; resumed = true;
    if (!existsSync(resolve(`.fake-codex-session-${threadId}`))) return error(request.id, "Thread not found");
    return reply(request.id, { thread: { id: threadId, cwd: process.cwd() } });
  }
  if (request.method === "turn/start") {
    const prompt = request.params.input[0].text;
    // Sentinels may appear inside a long prompt (the consultant prompt is
    // assembled by DexNest), so match by containment rather than equality.
    const mode = ["__block__", "__truncated__", "__tool__", "__auth__", "__quota__", "__diag__"].find(name => prompt.includes(name)) ?? prompt;
    appendFileSync(resolve(".fake-codex-dispatches"), JSON.stringify({ threadId, resumed, prompt, cwd: process.cwd(),
      apiKeyPresent: Object.keys(process.env).some(key => key.toUpperCase() === "OPENAI_API_KEY"), params: request.params }) + "\n");
    const turnId = randomUUID();
    reply(request.id, { turn: { id: turnId, status: "inProgress" } });
    if (mode === "__block__") {
      const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, stdio: "ignore" });
      writeFileSync(resolve(".fake-codex-tree"), JSON.stringify({ parent: process.pid, child: child.pid }));
      return;
    }
    if (mode === "__truncated__") { process.stdout.write('{"method":'); process.exit(0); }
    if (mode === "__diag__") {
      const spec = read(".fake-diag.json", {});
      if (spec.stdout) writeSync(1, spec.stdout);
      if (spec.stderr) writeSync(2, spec.stderr);
      process.exit(spec.exitCode ?? 1);
    }
    if (mode === "__tool__") return notify("item/started", { threadId, turnId, item: { type: "commandExecution", id: "forbidden" } });
    if (mode === "__auth__" || mode === "__quota__") return notify("turn/completed", { threadId, turn: { id: turnId, status: "failed", error: { message: mode === "__auth__" ? "Authentication failed 401" : "Usage limit exceeded 429" } } });
    // Take part in the loop plan exactly as the fake Claude worker does, so a
    // handed-off run can actually be driven by this provider.
    appendFileSync(resolve(".fake-codex-loop-dispatches"), JSON.stringify({ threadId, prompt }) + "\n");
    let answer = read(".fake-codex-answer", null);
    if (answer === null && existsSync(resolve(".loop-plan.json"))) {
      const dispatches = existsSync(resolve(".loop-dispatches.json")) ? JSON.parse(readFileSync(resolve(".loop-dispatches.json"), "utf8")) : [];
      const index = dispatches.length;
      dispatches.push({ index, sessionId: threadId, resumed, prompt, cwd: process.cwd() });
      writeFileSync(resolve(".loop-dispatches.json"), JSON.stringify(dispatches, null, 2));
      const plan = JSON.parse(readFileSync(resolve(".loop-plan.json"), "utf8"));
      const step = plan[index] ?? plan[plan.length - 1] ?? {};
      if (step.verify) writeFileSync(resolve(".verify-state.json"), JSON.stringify(step.verify));
      const emitted = Array.isArray(step.emitFiles) ? step.emitFiles : null;
      if (!emitted) writeFileSync(resolve(`work-${index}.txt`), `turn ${index}\n`);
      answer = emitted && emitted.length
        ? `Here are the updated files.\n\n` + emitted.map(file => `<<<DEXNEST_FILE path="${file.path}">>>\n${file.contents}\n<<<END_DEXNEST_FILE>>>`).join("\n")
        : `Applied turn ${index}`;
    }
    notify("item/completed", { threadId, turnId, item: { id: "answer", type: "agentMessage", text: answer ?? `Received ${prompt}` } });
    notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  }
});
