import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { MemoryStore } from "glove-core";
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
