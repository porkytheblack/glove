import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { MemoryStore, type ModelAdapter } from "glove-core";
import { z } from "zod";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import { defineMemory } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import {
  FOUNDRY_EXECUTION_MARKER,
  defineAgent,
  defineCall,
  isFoundryAgentDefinition,
} from "../src/definition.js";

test("assembly resolves from validated context for every run", async () => {
  const phases: string[] = [];
  const requestMemory = defineMemory({
    id: "request-memory",
    description: "Agent definition memory",
    mount: () => Effect.sync(() => { phases.push("memory-mount"); }),
  });
  const definition = defineAgent({
    id: "lazy",
    description: "Context-lazy fixture",
    components: composeAgent(requestMemory),
    compactionLimit: (_agent, { request }) =>
      Effect.succeed((request.payload as { privileged: boolean }).privileged ? 80_000 : 20_000),
    memory: (_agent, { request }) => {
      const payload = request.payload as { privileged: boolean };
      phases.push(`memory:${payload.privileged}`);
      return [requestMemory];
    },
    inboxes: (_agent, { conversationId }) => {
      phases.push(`inboxes:${conversationId}`);
      return [{
        id: "request-inbox-item",
        tag: "test",
        request: "Review the lazy assembly",
        response: null,
        status: "pending" as const,
        blocking: false,
        created_at: "2026-01-01T00:00:00.000Z",
        resolved_at: null,
      }];
    },
    tools: (_agent, { request }) => {
      const payload = request.payload as { privileged: boolean };
      phases.push(`tools:${payload.privileged}`);
      return payload.privileged
        ? [
            {
              name: "privileged_tool",
              description: "Only present for privileged requests",
              inputSchema: z.object({}),
              async do() {
                return { status: "success" as const, data: true };
              },
            },
          ]
        : [];
    },
    calls: (_agent, context) => [
      defineCall({
        name: "normalize_value",
        description: "Normalize the validated route value",
        input: z.object({ suffix: z.string() }),
        output: z.string(),
        exposeToAgent: false,
        handler: ({ suffix }) => `${(context.input.payload as { value: string }).value.trim()}${suffix}`,
      }),
    ],
    build: (agent) => {
      phases.push("build");
      return agent;
    },
    run: async (_agent, context) => {
      phases.push("run");
      return {
        value: await context.invoke("normalize_value", { suffix: "!" }),
        tools: (context.input.payload as { privileged: boolean }).privileged ? 1 : 0,
        inbox: (await context.glove.store.getInboxItems?.())?.length ?? 0,
      };
    },
  });

  assert.equal(isFoundryAgentDefinition(definition), true);
  assert.equal("handler" in definition, false);
  const compiled = compileAgentDefinition(definition, "lazy");
  assert.equal(typeof compiled.handler, "function");

  const result = await compiled.handler!({
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: {
      agentId: "agent-lazy",
      conversationId: "conversation-lazy",
      workspaceId: "test",
      message: "assemble",
      payload: { value: "  context  ", privileged: true },
      source: { kind: "direct" },
    },
    agent: {
      id: "agent-lazy", definitionId: "lazy", workspaceId: "test",
      context: {}, installations: [], playbooks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    conversation: {
      id: "conversation-lazy", agentId: "agent-lazy", workspaceId: "test",
      context: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    value: { value: "context!", tools: 1, inbox: 1 },
    agentId: "agent-lazy",
    conversationId: "conversation-lazy",
    workspaceId: "test",
  });
  assert.deepEqual(phases, [
    "tools:true",
    "memory:true",
    "inboxes:conversation-lazy",
    "memory-mount",
    "build",
    "run",
  ]);
});

test("every lazy resolver receives the native current Message and conversation history", async () => {
  const store = new MemoryStore("message-aware-assembly");
  await store.appendMessages([
    { sender: "user", text: "Earlier question" },
    { sender: "agent", text: "Earlier answer" },
  ]);
  const observations: unknown[] = [];
  const definition = defineAgent({
    description: "Multimodal message-aware fixture",
    store: () => store,
    systemPrompt: (_agent, context) => {
      observations.push({
        field: "systemPrompt",
        sender: context.message.sender,
        text: context.message.text,
        content: context.message.content,
        history: context.history.map((message) => message.text),
        messages: context.messages.map((message) => message.text),
      });
      return `Current: ${context.message.text}`;
    },
    tools: (_agent, context) => {
      observations.push({
        field: "tools",
        hasImage: context.message.content?.some((part) => part.type === "image"),
      });
      return [];
    },
    run: (_agent, context) => ({
      messageText: context.messageText,
      inputIsArray: Array.isArray(context.messageInput),
      historyLength: context.history.length,
      messagesLength: context.messages.length,
    }),
  });

  const compiled = compileAgentDefinition(definition, "message-aware");
  const result = await compiled.handler!({
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: {
      agentId: "agent-message-aware",
      conversationId: "conversation-message-aware",
      workspaceId: "test",
      message: [
        { type: "text", text: "Inspect this release image" },
        {
          type: "image",
          source: {
            type: "url",
            media_type: "image/png",
            url: "https://example.invalid/release.png",
          },
        },
      ],
      source: { kind: "direct" },
    },
    agent: {
      id: "agent-message-aware", definitionId: "message-aware", workspaceId: "test",
      context: {}, installations: [], playbooks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    conversation: {
      id: "conversation-message-aware", agentId: "agent-message-aware", workspaceId: "test",
      context: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });

  assert.deepEqual(result.value, {
    messageText: "Inspect this release image",
    inputIsArray: true,
    historyLength: 2,
    messagesLength: 3,
  });
  assert.deepEqual(observations, [
    {
      field: "systemPrompt",
      sender: "user",
      text: "Inspect this release image",
      content: [
        { type: "text", text: "Inspect this release image" },
        {
          type: "image",
          source: {
            type: "url",
            media_type: "image/png",
            url: "https://example.invalid/release.png",
          },
        },
      ],
      history: ["Earlier question", "Earlier answer"],
      messages: ["Earlier question", "Earlier answer", "Inspect this release image"],
    },
    { field: "tools", hasImage: true },
  ]);
});

test("a run handler preserves multimodal input and transient runtime context through the standard Glove loop", async () => {
  const store = new MemoryStore("handler-enriched-message");
  let modelSawImage = false;
  const model: ModelAdapter = {
    name: "enriched-message-model",
    setSystemPrompt: () => undefined,
    async prompt(request) {
      modelSawImage = request.messages.some(message => message.content?.some(part => part.type === "image"));
      assert.equal(request.messages.at(-1)?.framework_context, "runtime");
      assert.equal(request.messages.at(-1)?.text, "Current goal: inspect the reference");
      return {
        messages: [{ sender: "agent", text: modelSawImage ? "vision-ready" : "missing-image" }],
        tokens_in: 1,
        tokens_out: 1,
      };
    },
  };
  const definition = defineAgent({
    description: "Handler-enriched multimodal fixture",
    store: () => store,
    model,
    systemPrompt: "Inspect the user's message and any attached image.",
    configure: agent => {
      agent.addContextProvider(() => "Current goal: inspect the reference");
    },
    run: (_agent, context) => context.defaultRun([
      { type: "text", text: `${context.messageText}\n[mounted:/inbox/reference.png]` },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AQID" },
      },
    ]),
  });
  const compiled = compileAgentDefinition(definition, "handler-enriched");
  const result = await compiled.handler!({
    [FOUNDRY_EXECUTION_MARKER]: true,
    request: {
      agentId: "agent-enriched",
      conversationId: "conversation-enriched",
      workspaceId: "test",
      message: "Inspect the delivered reference.",
      source: { kind: "direct" },
    },
    agent: {
      id: "agent-enriched", definitionId: "handler-enriched", workspaceId: "test",
      context: {}, installations: [], playbooks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    conversation: {
      id: "conversation-enriched", agentId: "agent-enriched", workspaceId: "test",
      context: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(result.value, "vision-ready");
  assert.equal(modelSawImage, true);
  const persisted = await store.getMessages();
  assert.ok(persisted.every(message => message.framework_context !== "runtime"));
  assert.equal(persisted[0]?.text, "Inspect the delivered reference.\n[mounted:/inbox/reference.png]");
  assert.equal(persisted[0]?.content?.[1]?.source?.data, "AQID");
});
