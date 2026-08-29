import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { z } from "zod";
import {
  defineLayer,
  defineSubscriber,
  mountFoundrySurfaces,
} from "../src/surfaces.js";
import { FoundryEchoModel } from "./fixtures/echo-model.js";

test("native layers and subscribers mount by file-routed id", async () => {
  const recorded: string[] = [];
  const emitted: string[] = [];
  const glove = new Glove({
    store: new MemoryStore("surface-test"),
    model: new FoundryEchoModel(),
    displayManager: new Displaymanager(),
    systemPrompt: "Test",
    serverMode: true,
    compaction_config: { compaction_instructions: "Test" },
  }).build();
  const layer = defineLayer({
    id: "native-tools",
    description: "Mount a configured native tool",
    config: z.object({ name: z.string() }),
    setup: ({ glove: target, config }) =>
      Effect.sync(() => {
        target.fold({
          name: config.name,
          description: "Mounted by a Foundry layer",
          inputSchema: z.object({}),
          async do() {
            return { status: "success", data: true };
          },
        });
      }),
  });
  const subscriber = defineSubscriber({
    id: "audit",
    description: "Test subscriber",
    create: {
      async record(type) {
        recorded.push(type);
      },
    },
  });

  const dispose = await mountFoundrySurfaces({
    registry: { layers: [layer], subscribers: [subscriber] },
    layers: [{ layer, config: { name: "native_ping" } }],
    subscribers: [subscriber],
    context: {
      definitionId: "assistant",
      agentId: "assistant",
      conversationId: "conversation-1",
      workspaceId: "test",
      runId: "run-1",
      input: {},
      request: {
        agentId: "assistant",
        conversationId: "conversation-1",
        workspaceId: "test",
        message: "hello",
      },
      message: { sender: "user", text: "hello" },
      messageInput: "hello",
      messageText: "hello",
      history: [],
      messages: [{ sender: "user", text: "hello" }],
      glove,
      signal: new AbortController().signal,
      emit: (event) => emitted.push(event.type),
    },
  });

  assert.ok(glove.tools.some((tool) => tool.name === "native_ping"));
  assert.deepEqual(emitted, [
    "foundry.subscriber.mounted",
    "foundry.layer.mounted",
  ]);
  await glove.processRequest("hello");
  assert.ok(recorded.includes("model_response_complete"));
  const beforeDispose = recorded.length;
  await dispose();
  await glove.processRequest("after cleanup");
  assert.equal(recorded.length, beforeDispose);
});
