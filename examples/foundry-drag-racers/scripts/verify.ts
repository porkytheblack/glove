import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isS2SDrivenModel } from "glove-voice-s2s";
import { Effect } from "effect";
import { FoundryRuntime, toGloveMessage, type AgentAssemblyContext, type FoundryRequest } from "glove-foundry";
import jax from "../agents/jax-redline/agent.js";
import application from "../foundry.application.js";
import config from "../foundry.config.js";
import { RACERS } from "../lib/racers.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = await FoundryRuntime.discover({
  rootDir: root,
  agentsDir: resolve(root, "agents"),
  application,
  config,
});

assert.deepEqual(runtime.manifest.agents.map((agent) => agent.id), ["jax-redline", "kenji-ghost", "maya-nitro"]);
for (const racer of RACERS) {
  const instances = await runtime.listAgentInstances(racer.definitionId);
  assert.ok(instances.some((instance) => instance.id === racer.agentId));
  const conversations = await runtime.listConversations(racer.agentId);
  assert.ok(conversations.some((conversation) => conversation.id === racer.conversationId));
  const image = resolve(root, "public", racer.image.replace(/^\//, ""));
  await access(image);
  assert.ok((await stat(image)).size > 100_000, `${racer.image} is unexpectedly small`);
  assert.equal((await readFile(image)).subarray(1, 4).toString("ascii"), "PNG");
}

const request: FoundryRequest = {
  agentId: "jax-redline-demo",
  conversationId: "jax-redline-paddock",
  workspaceId: "drag-strip",
  message: "Start a diagnostic live paddock call.",
  payload: { port: 4701, token: "a".repeat(24) },
};
const message = toGloveMessage(request.message);
const context = {
  definitionId: "jax-redline",
  agentId: "jax-redline-demo",
  conversationId: "jax-redline-paddock",
  workspaceId: "drag-strip",
  name: "glove_foundry_agent__jax-redline",
  runId: "verify-run",
  mode: "agent",
  request,
  input: request,
  message,
  messageInput: "Start a diagnostic live paddock call.",
  messageText: message.text,
  history: [],
  messages: [message],
  installations: [],
  agentInstance: { context: {}, installations: [] },
  conversation: {},
  data: {},
  store: null,
  subscriber: {},
  controls: { signal: new AbortController().signal, commands: [], emit() {} },
} as unknown as AgentAssemblyContext<FoundryRequest>;

async function settle<T>(value: T | Promise<T> | Effect.Effect<T, unknown, never>): Promise<T> {
  const awaited = await value;
  return Effect.isEffect(awaited) ? Effect.runPromise(awaited) : awaited;
}

assert.equal(typeof jax.model, "function");
const modelResolver = jax.model;
if (typeof modelResolver !== "function") throw new Error("Jax model must be lazy.");
const model = await settle(modelResolver(jax, context));
assert.ok(isS2SDrivenModel(model));
assert.equal(model.s2s.provider, "gemini");
assert.equal(model.s2s.model, "models/gemini-3.1-flash-live-preview");

assert.equal(typeof jax.tools, "function");
const toolResolver = jax.tools;
if (typeof toolResolver !== "function") throw new Error("Jax tools must be lazy.");
const tools = await settle(toolResolver(jax, context));
assert.deepEqual(tools.map((tool) => tool.name), [
  "inspect_my_car",
  "share_garage_photo",
  "size_up_rival",
  "inspect_call_context",
]);

const ordinaryContext = { ...context, messageText: "Start a live paddock call." } as AgentAssemblyContext<FoundryRequest>;
const ordinaryTools = await settle(toolResolver(jax, ordinaryContext));
assert.equal(ordinaryTools.some((tool) => tool.name === "inspect_call_context"), false);

process.stdout.write("Foundry drag-racer offline verification passed.\n");
process.stdout.write(`Discovered ${runtime.manifest.agents.length} file-routed voice agents and ${RACERS.length} generated portraits.\n`);
process.stdout.write("Verified message-dependent lazy tool assembly and Gemini S2S model configuration.\n");
