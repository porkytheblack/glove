import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// One layered exchange, end to end, on the real runtime. With no API key the
// layers run scripted models, so this needs no network:
//   person → assistant → delegates to coder → coder asks which language →
//   assistant answers from what it knows → coder finishes → assistant relays.

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const dataDir = await mkdtemp(join(tmpdir(), "layered-assistant-"));
process.env.LAYERED_DATA_DIR = dataDir;
if (!process.env.ANTHROPIC_API_KEY) process.env.LAYERED_DEMO = "1";

const { FoundryRuntime } = await import("glove-foundry");
const { default: application } = await import("../foundry.application.js");
const { default: config } = await import("../foundry.config.js");

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
await runtime.start();

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

try {
  assert.deepEqual(runtime.agents.map((agent) => agent.route).sort(), ["assistant", "coder", "researcher"]);

  const maya = await runtime.createAgent("assistant", { id: "maya", context: { name: "Maya" } });
  const chat = await runtime.createConversation(maya.id, { id: "maya-chat", title: "Chat with Maya" });
  const first = await runtime.send(maya.id, chat.id, "Write me a slugify function, please.");
  const firstRun = await runtime.waitForRun(first.id, { timeoutMs: 60_000 });
  assert.equal(firstRun?.status, "completed", firstRun?.error);
  console.log(`assistant: ${String((firstRun?.output as { value?: unknown }).value)}`);

  const delegation = await until(async () => {
    const [item] = await runtime.listDelegations({ conversationId: chat.id, status: "completed" });
    return item;
  }, "the coder to finish");
  console.log(`coder (delegation ${delegation.id}): ${delegation.result}`);
  assert.match(delegation.result ?? "", /TypeScript/);

  const relay = await until(async () => {
    const runs = await runtime.listRuns("assistant");
    return runs.find((run) =>
      run.conversationId === chat.id
      && run.status === "completed"
      && /Your code is ready/.test(String((run.output as { value?: unknown } | undefined)?.value)));
  }, "the assistant to relay the result");
  console.log(`assistant: ${String((relay.output as { value?: unknown }).value)}`);

  const coderRuns = (await runtime.listRuns("coder")).filter((run) => run.conversationId === delegation.id);
  assert.equal(coderRuns.length, 1, "the answer reached the coder inside its waiting run");
  const worker = (await runtime.listAgentInstances("coder"))[0];
  assert.equal(worker?.id, "maya.coder");
  assert.equal(worker?.context.name, "Maya", "the worker instance carries the person's identity data");
  console.log("\nLayered exchange verified: delegate, ask, answer, result, relay.");
} finally {
  await runtime.stop();
  await rm(dataDir, { recursive: true, force: true });
}
