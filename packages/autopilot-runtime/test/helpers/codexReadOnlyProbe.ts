// Manual compatibility probe: never transmits thread/start, thread/resume or turn/start.
import { createProcessPort } from "../../../../apps/desktop/src/main/autopilotPlatform.ts";
import { CodexConversation } from "../../src/codexConversation.ts";
import { codexProtocol, codexConfigArgs } from "../../src/codexWorker.ts";
import { buildEnvironment, defaultCapabilityPolicy } from "../../src/policy.ts";
const [executable, cwd] = process.argv.slice(2);
if (!executable || !cwd) throw new Error("Native executable and scratch cwd required.");
const ambient = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const processPort = createProcessPort();
const mcp = await processPort.run({ runId: "read-only-probe", operationId: "mcp-probe", executable, args: ["mcp", "list", "--json", ...codexConfigArgs()], cwd,
  env: buildEnvironment(defaultCapabilityPolicy(), ambient), timeoutMs: 15000 });
if (mcp.exitCode !== 0) throw new Error("Could not inspect configured MCP names.");
const disabledMcpServers = (JSON.parse(mcp.stdout) as { name: string }[]).map(server => server.name);
const session = { runId: "read-only-probe", provider: "codex", sessionId: "11111111-2222-4333-8444-555555555555", cwd, established: false, disabledMcpServers };
const intent = codexProtocol(executable).prompt(session, "This prompt must never be transmitted");
const inner = new CodexConversation(intent.stdin!, cwd, () => { throw new Error("Probe must never bind a thread"); });
let verified = false;
const conversation = {
  start: () => inner.start(),
  receive(line: string) {
    const responses = inner.receive(line);
    if (responses.some(response => /"method":"thread\/(start|resume)"/.test(response))) { verified = true; return []; }
    return responses;
  },
  get done() { return verified || inner.done; },
  result: () => JSON.stringify({ verified, failure: verified ? null : JSON.parse(inner.result()).failure })
};
const result = await processPort.run({ runId: "read-only-probe", operationId: "read-only-probe", executable, args: intent.args, cwd,
  env: buildEnvironment(defaultCapabilityPolicy(), ambient), conversation, timeoutMs: 15000 });
console.log(JSON.stringify({ exitCode: result.exitCode, transportFailure: result.failure ?? null, ...JSON.parse(result.stdout) }));
