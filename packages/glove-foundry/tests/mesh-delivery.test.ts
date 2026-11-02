import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "glove-core";
import { InMemoryMeshAdapter, MeshNetwork } from "glove-mesh";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import { defineAgent, FOUNDRY_EXECUTION_MARKER } from "../src/definition.js";

for (const delivery of [undefined, "inbox", "events"] as const) test(`mesh delivery ${delivery ?? "default"} handles messages after the final turn`, async () => {
  const network = new MeshNetwork();
  const adapter = new InMemoryMeshAdapter(network, "receiver");
  const store = new MemoryStore("mesh-regression");
  let calls = 0;
  const definition = defineAgent({
    description: "Mesh receiver", systemPrompt: "Finish the turn.", store: () => store,
    model: { name: "mock", setSystemPrompt() {}, async prompt() {
      calls++;
      return { messages: [{ sender: "agent" as const, text: "done" }], tokens_in: 1, tokens_out: 1 };
    } },
    mesh: { adapter, ...(delivery ? { delivery } : {}) },
    run: async (_agent, ctx) => {
      await ctx.defaultRun();
      // A peer can still send while the run is finishing, before unregister.
      await network.deliverDirect({ id: "late", from: "sender", to: "receiver", content: "late finding", created_at: new Date().toISOString() });
      return "done";
    },
  });
  const now = new Date().toISOString();
  await compileAgentDefinition(definition, "receiver").handler!({
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: { agentId: "receiver", conversationId: "conversation", workspaceId: "workspace", message: "finish", source: { kind: "direct" } },
    agent: { id: "receiver", definitionId: "receiver", workspaceId: "workspace", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
    conversation: { id: "conversation", agentId: "receiver", workspaceId: "workspace", context: {}, createdAt: now, updatedAt: now },
  });
  assert.equal(calls, 1);
  const inbox = await store.getInboxItems();
  assert.equal(inbox.length, delivery === "events" ? 0 : 1, "legacy mesh persists late messages; native live events are explicit");
  if (inbox.length) assert.match(JSON.stringify(inbox[0]), /late finding/);
  assert.deepEqual(await adapter.listAgents(), [], "the receiver unregisters after the run");
});
