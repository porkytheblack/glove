// Separate OS process so verify-live exercises controller and worker restarts.
import { fileURLToPath } from "node:url";
import { FoundryRuntime, FoundryServer } from "glove-foundry";
import application from "../foundry.application.js";

if (!process.send || !process.env.RESEARCH_LIVE_TEST_ROOT) throw new Error("Run through verify:live.");
const runtime = await FoundryRuntime.discover({
  rootDir: process.env.RESEARCH_LIVE_TEST_ROOT,
  agentsDir: fileURLToPath(new URL("../agents/", import.meta.url)),
  applicationFilePath: fileURLToPath(new URL("../foundry.application.ts", import.meta.url)),
  application,
  config: { execution: { maxConcurrent: 4, pollIntervalMs: 50, idlePollIntervalMs: 50 } },
});
const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });
let finish!: () => void;
const stopped = new Promise<void>((resolve) => { finish = resolve; });
process.once("SIGTERM", finish);
process.once("SIGINT", finish);
process.once("disconnect", finish);
try {
  await runtime.start();
  const { url } = await server.listen();
  process.send({ url, pid: process.pid });
  await stopped;
} finally {
  await server.close();
  await runtime.stop();
  process.disconnect?.();
}
