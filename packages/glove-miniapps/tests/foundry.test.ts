/**
 * Mini apps through a real Foundry agent run: the layer mounts the tools, the
 * agent builds an app in one conversation, and in the next conversation it is
 * told about that app before it says anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type ModelAdapter } from "glove-core";
// Foundry's agent compiler is internal, so the run is driven the way
// Foundry's own tests drive it.
import { defineAgentFromModule, FOUNDRY_EXECUTION_MARKER } from "../../glove-foundry/src/definition.js";
import { compileAgentDefinition } from "../../glove-foundry/src/agent-runtime.js";
import { defineLayer } from "../../glove-foundry/src/surfaces.js";
import { composeAgent } from "../../glove-foundry/src/composition.js";
import { miniAppsLayer } from "../src/foundry";
import { createAppHost, EXAMPLE_APP, memoryBackend } from "../src/index";

function envelope(conversationId: string, message: string) {
  const now = new Date().toISOString();
  return {
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: { agentId: "coach", conversationId, workspaceId: "workspace", message, source: { kind: "direct" } },
    agent: { id: "coach", definitionId: "coach", workspaceId: "workspace", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
    conversation: { id: conversationId, agentId: "coach", workspaceId: "workspace", context: {}, createdAt: now, updatedAt: now },
  };
}

test("a Foundry agent builds an app in one conversation and finds it in the next", async () => {
  const host = await createAppHost({ backend: memoryBackend(), clock: () => new Date("2026-10-19T12:00:00Z") });
  const layer = defineLayer({ id: "miniapps", ...miniAppsLayer({ host }) });
  const contexts: string[] = [];
  const results: unknown[] = [];
  let round = 0;

  const model: ModelAdapter = {
    name: "scripted",
    setSystemPrompt() {},
    async prompt(input) {
      const runtime = input.messages.filter((m) => m.framework_context === "runtime").map((m) => m.text).join("\n");
      for (const m of input.messages) {
        for (const r of m.tool_results ?? []) results.push(r.result);
      }
      contexts.push(runtime);
      switch (round++) {
        case 0: // first conversation: build the app and use it
          return {
            messages: [{
              sender: "agent", text: "", tool_calls: [
                { id: "d", tool_name: "glove_miniapps_deploy", input_args: { definition: EXAMPLE_APP } },
                { id: "c", tool_name: "glove_miniapps_call", input_args: { app: "habits", method: "check_in", args: { habit: "run", day: "2026-10-19" } } },
              ],
            }],
            tokens_in: 1, tokens_out: 1,
          };
        case 2: // second conversation: it already knows the app
          return {
            messages: [{ sender: "agent", text: "", tool_calls: [{ id: "s", tool_name: "glove_miniapps_call", input_args: { app: "habits", method: "streak", args: { habit: "run" } } }] }],
            tokens_in: 1, tokens_out: 1,
          };
        default:
          return { messages: [{ sender: "agent", text: "done" }], tokens_in: 1, tokens_out: 1 };
      }
    },
  };

  const stores = new Map<string, MemoryStore>();
  const definition = defineAgentFromModule("coach", {
    description: "Keeps the user on track",
    systemPrompt: "Help the user keep their habits.",
    model,
    store: ({ conversationId }) => {
      if (!stores.has(conversationId)) stores.set(conversationId, new MemoryStore(conversationId));
      return stores.get(conversationId)!;
    },
    components: composeAgent(layer),
    layers: [layer],
  });

  await compileAgentDefinition(definition, "coach").handler!(envelope("first", "Track my running"));
  await compileAgentDefinition(definition, "coach").handler!(envelope("second", "How am I doing?"));

  assert.match(contexts[0], /no mini apps yet/);
  assert.match(contexts[2], /- habits v1 — Habits I'm tracking/, "the second conversation starts knowing the app");
  // The app belongs to the agent instance, not to a conversation.
  assert.deepEqual((await host.list({ as: "agent:coach" })).map((a) => [a.name, a.owner]), [["habits", "agent:coach"]]);
  assert.equal((await host.call("habits", "streak", { habit: "run" }, { as: "agent:coach" })).value, 1);
  assert.ok(results.some((r) => (r as { data?: unknown }).data === 1), "the streak call in the second conversation returned 1");
});
