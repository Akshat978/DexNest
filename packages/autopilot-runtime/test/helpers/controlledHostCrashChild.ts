import { openControlledHost } from "./controlledHostHarness.ts";
const [root, mode, runId, sendId] = process.argv.slice(2);
if (!root || !mode || !runId) throw new Error("Missing crash fixture arguments.");
const h = await openControlledHost(root, { afterProcess: () => { if (mode === "after_dispatch") process.exit(9); } });
if (mode === "intent") {
  const request = h.host.engine.effects!.request.bind(h.host.engine.effects!);
  h.host.engine.effects!.request = async input => {
    if (input.stepKey?.startsWith("worker:")) process.exit(9);
    return request(input);
  };
  await h.invoke("worker-prepare", { runId, prompt: "Crash prompt" });
} else {
  if (mode === "dispatch_mark") {
    const request = h.host.engine.effects!.request.bind(h.host.engine.effects!);
    h.host.engine.effects!.request = async input => request({ ...input, beforeDispatch: () => process.exit(9) });
  }
  if (mode === "session_bound") {
    const request = h.host.engine.effects!.request.bind(h.host.engine.effects!);
    h.host.engine.effects!.request = async input => request({ ...input, onWorkerSession: id => { input.onWorkerSession?.(id); process.exit(9); } });
  }
  await h.invoke("worker-send", { runId, sendId });
}
throw new Error("Crash fixture did not exit.");
