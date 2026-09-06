import type { ProcessConversation } from "./ports.ts";
import type { WorkerResult, WorkerFailure } from "./worker.ts";
import { classifyCodexFailure, CODEX_DISABLED_FEATURES, CODEX_RESTRICTED_CONFIG, CODEX_SUPPORTED_VERSION } from "./codexWorker.ts";
import { samePath } from "./paths.ts";

type ObjectValue = Record<string, any>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const rpc = (id: number, method: string, params: unknown) => JSON.stringify({ id, method, params }) + "\n";

/** Pure bounded RPC state machine. No tool request is ever approved or executed by this client. */
export class CodexConversation implements ProcessConversation {
  done = false;
  private readonly localId: string;
  private readonly expected: string | null;
  private readonly prompt: string;
  private readonly cwd: string;
  private readonly commitSession: (id: string) => void;
  private stage = 0;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private dispatched = false;
  private output: WorkerResult;
  private readonly messages = new Map<string, string>();

  constructor(stdin: string, cwd: string, commitSession: (id: string) => void) {
    const input = object(JSON.parse(stdin));
    if (typeof input.sessionId !== "string" || typeof input.prompt !== "string" || !input.prompt.trim() ||
      (input.providerSessionId !== null && typeof input.providerSessionId !== "string")) throw new Error("Invalid Codex conversation intent.");
    this.localId = input.sessionId; this.expected = input.providerSessionId; this.prompt = input.prompt;
    this.cwd = cwd; this.commitSession = commitSession;
    this.output = { ok: false, text: "", failure: "protocol", sessionId: this.localId, sessionConfirmed: false, certain: false };
  }

  start(): string[] { return [rpc(1, "initialize", { clientInfo: { name: "dexnest", version: "0.1.0" }, capabilities: { experimentalApi: true } })]; }
  result(): string { return JSON.stringify(this.output); }
  private fail(failure: WorkerFailure, text: string): string[] {
    this.output = { ...this.output, ok: false, failure, text, certain: !this.dispatched };
    this.done = true;
    return [];
  }

  receive(line: string): string[] {
    if (this.done) return [];
    const message = object(JSON.parse(line));
    if (message.method && message.id !== undefined) return this.fail("permission", "Codex requested a tool or approval; this controlled turn permits neither.");
    if (message.id !== undefined) {
      if (message.id !== this.stage + 1) throw new Error("Unexpected Codex response identity.");
      if (message.error) return this.fail(classifyCodexFailure(String(object(message.error).message ?? "")), "Codex rejected the session or turn request.");
      if (!message.result || typeof message.result !== "object") throw new Error("Missing Codex response.");
      const result = object(message.result);
      this.stage++;
      if (message.id === 1) {
        if (!String(result.userAgent ?? "").includes(`/${CODEX_SUPPORTED_VERSION} `) && !String(result.userAgent ?? "").endsWith(`/${CODEX_SUPPORTED_VERSION}`)) return this.fail("unsupported", "Codex app-server version changed; no prompt sent.");
        return [JSON.stringify({ method: "initialized" }) + "\n", rpc(2, "config/read", { includeLayers: true, cwd: this.cwd })];
      }
      if (message.id === 2) {
        const config = object(result.config);
        const features = object(config.features);
        const layers = Array.isArray(result.layers) ? result.layers.filter(layer => !object(layer).disabledReason) : [];
        const toolsDisabled = ["update_plan", "experimental_request_user_input"].every(name => {
          const toolLayers = layers.filter(layer => object(object(object(layer).config).tools)[name] !== undefined);
          return toolLayers.length > 0 && object(object(object(object(toolLayers.at(-1)).config).tools)[name]).enabled === false;
        });
        if (config.forced_login_method !== "chatgpt" || config.model_provider !== "openai" || config.web_search !== "disabled" ||
          config.sandbox_mode !== "read-only" || config.approval_policy !== "on-request" || config.approvals_reviewer !== "user" ||
          CODEX_DISABLED_FEATURES.some(name => features[name] !== false) ||
          !toolsDisabled ||
          Object.values(object(config.mcp_servers)).some(server => object(server).enabled !== false) ||
          Object.keys(object(object(config.model_providers).openai)).length > 0) {
          return this.fail("policy", "Codex effective configuration cannot attest the restricted tool and subscription settings.");
        }
        return [rpc(3, "account/read", { refreshToken: false })];
      }
      if (message.id === 3) {
        if (object(result.account).type !== "chatgpt") return this.fail("auth", "Codex requires an existing ChatGPT login; API-key accounts are not accepted.");
        const params = { cwd: this.cwd, modelProvider: "openai", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only", config: CODEX_RESTRICTED_CONFIG };
        return [this.expected ? rpc(4, "thread/resume", { ...params, threadId: this.expected, excludeTurns: true }) :
          rpc(4, "thread/start", { ...params, ephemeral: false, environments: [], dynamicTools: [], selectedCapabilityRoots: [], experimentalRawEvents: false })];
      }
      if (message.id === 4) {
        const thread = object(result.thread);
        if (typeof thread.id !== "string" || !/^[0-9a-f-]{36}$/i.test(thread.id) ||
          (this.expected && thread.id !== this.expected) || !samePath(String(thread.cwd ?? ""), this.cwd)) return this.fail("session", "Codex returned a different session or workspace.");
        this.threadId = thread.id;
        // This synchronous callback COMMITs identity before turn/start can reach stdin.
        this.commitSession(thread.id);
        this.output.providerSessionId = thread.id;
        this.dispatched = true;
        return [rpc(5, "turn/start", { threadId: thread.id, cwd: this.cwd, environments: [],
          approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly" }, input: [{ type: "text", text: this.prompt, text_elements: [] }] })];
      }
      if (message.id === 5) {
        const turn = object(result.turn);
        if (typeof turn.id !== "string") throw new Error("Missing Codex turn ID.");
        this.turnId = turn.id;
        return [];
      }
      throw new Error("Unexpected extra Codex response.");
    }
    const params = object(message.params);
    if (message.method === "item/started" || message.method === "item/completed") {
      if (params.threadId !== this.threadId) throw new Error("Foreign thread event.");
      const item = object(params.item);
      if (!["userMessage", "agentMessage", "reasoning"].includes(item.type)) return this.fail("permission", "Codex emitted a tool item; the restricted turn was stopped.");
      if (message.method === "item/completed" && item.type === "agentMessage" && typeof item.text === "string" && typeof item.id === "string") this.messages.set(item.id, item.text);
    }
    if (message.method === "turn/completed") {
      const turn = object(params.turn);
      if (!this.turnId || params.threadId !== this.threadId || turn.id !== this.turnId) throw new Error("Mismatched Codex completion.");
      const text = [...this.messages.values()].join("\n");
      if (turn.status === "completed" && this.messages.size > 0) {
        this.output = { ...this.output, ok: true, failure: null, text, certain: true, sessionConfirmed: true };
      } else if (turn.status === "failed") {
        this.output = { ...this.output, failure: classifyCodexFailure(JSON.stringify(turn.error ?? {})), text,
          certain: true, sessionConfirmed: true };
      } else this.output = { ...this.output, text, failure: turn.status === "interrupted" ? "interrupted" : "protocol" };
      this.done = true;
    }
    return [];
  }
}
