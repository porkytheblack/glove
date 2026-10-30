import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { FoundryRuntime, FoundryServer } from "glove-foundry";
import config from "../foundry.config.js";
import application from "../foundry.application.js";
import { researchProvider } from "../lib/models.js";

const keyName = researchProvider() === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
if (!process.env[keyName]) throw new Error(`Set ${keyName} in .env before starting the live example.`);
process.env.RESEARCH_ROOM_TOKEN = randomUUID(); // Ephemeral transport secret, never persisted in a request.
const runtime = await FoundryRuntime.discover({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
  agentsDir: fileURLToPath(new URL("../agents/", import.meta.url)),
  applicationFilePath: fileURLToPath(new URL("../foundry.application.ts", import.meta.url)),
  application, config,
});
const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 4143 });
try {
  await runtime.start(); await server.listen();
  const front = await Effect.runPromise(runtime.data.provisionAgent({
    definitionId: "front", id: "demo-front", provisioningKey: "durable-research-demo",
    workspaceId: "demo", context: { name: "Ada", preference: "EU hosting" },
    installations: [{ kind: "application", id: "library" }],
  }));
  const existing = await Effect.runPromise(runtime.data.getConversation("demo-live"));
  const conversation = existing ?? await runtime.createConversation(front.id, { id: "demo-live" });
  const run = await runtime.send(front.id, conversation.id, "Start the research session.", { payload: { mode: "live" } });
  const deadline = Date.now() + 60_000;
  while (true) {
    const ready = await fetch("http://127.0.0.1:8787/").then((response) => response.ok, () => false);
    if (ready) break;
    const status = await runtime.getRun(run.id);
    if (status && ["completed", "failed", "cancelled"].includes(status.status)) throw new Error(`Live run ended before the room opened: ${status.status}`);
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the realtime room.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log("Foundry: http://127.0.0.1:4143 · front=demo-front · conversation=demo-live");
  console.log(`Open http://127.0.0.1:8787/#${process.env.RESEARCH_ROOM_TOKEN}`);
  console.log(`Live run: ${run.id}. End the room to close only the front; Ctrl-C stops the controller.`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve); process.once("SIGTERM", resolve);
  });
} finally { await server.close(); await runtime.stop(); }
