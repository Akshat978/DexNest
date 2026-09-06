import { openWorker } from "./workerHarness.ts";
const [root, mode] = process.argv.slice(2) as [string, string];
const h = openWorker(root, 99, mode === "intent"
  ? { beforeEffect: () => process.exit(9) }
  : { afterProcess: () => process.exit(9) });
await h.worker.sendPrompt({ runId: "worker-run", sendId: "send-crash", prompt: "Crash test" });
process.exit(2);
