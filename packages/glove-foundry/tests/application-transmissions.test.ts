import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import { defineApp } from "../src/capabilities.js";
import {
  FOUNDRY_CORE_COMMAND_EVENT,
  createInstalledApplicationTransmissionTools,
  type FoundryCoreCommand,
} from "../src/core-tools.js";
import type { AgentAssemblyContext } from "../src/definition.js";
import { defineTransmission } from "../src/integration.js";

const inboundMessage = defineTransmission({
  id: "message-inbound",
  name: "Inbound message",
  description: "Receive messages",
  inbound: {
    config: Schema.Struct({ channel: Schema.String }),
    event: Schema.Struct({ text: Schema.String }),
  },
});

const inboundReaction = defineTransmission({
  id: "reaction-inbound",
  name: "Inbound reaction",
  description: "Receive reactions",
  inbound: {
    config: Schema.Struct({ channel: Schema.String }),
    event: Schema.Struct({ emoji: Schema.String }),
  },
});

const outboundMessage = defineTransmission({
  id: "message-outbound",
  name: "Outbound message",
  description: "Send messages",
  outbound: {
    config: Schema.Struct({ channel: Schema.String }),
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ messageId: Schema.String }),
  },
});

const outboundReaction = defineTransmission({
  id: "reaction-outbound",
  name: "Outbound reaction",
  description: "Send reactions",
  outbound: {
    config: Schema.Struct({ channel: Schema.String }),
    input: Schema.Struct({ emoji: Schema.String }),
    output: Schema.Struct({ reactionId: Schema.String }),
  },
});

const chat = defineApp({
  id: "chat",
  description: "Chat application",
  inbound: [inboundMessage, inboundReaction],
  outbound: [outboundMessage, outboundReaction],
});

test("apps own multiple inbound and outbound transmission definitions", () => {
  assert.deepEqual(chat.inbound?.map((item) => item.id), [
    "message-inbound",
    "reaction-inbound",
  ]);
  assert.deepEqual(chat.outbound?.map((item) => item.id), [
    "message-outbound",
    "reaction-outbound",
  ]);
  assert.equal(chat.transmissions?.length, 4);
});

test("installing an app mounts one validated tool per outbound transmission", async () => {
  const commands: FoundryCoreCommand[] = [];
  const events: string[] = [];
  const context = {
    definitionId: "assistant",
    agentId: "assistant-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    agentInstance: {
      playbooks: [{
        id: "chat-messages",
        transmissionId: "message-outbound",
        directives: [{ action: "send", instruction: "Send it" }],
        applications: ["chat"],
        outbound: [{ routeId: "chat-primary", applicationId: "chat" }],
      }],
    },
    controls: {
      commands,
      emit: (event: { type: string }) => events.push(event.type),
    },
  } as unknown as AgentAssemblyContext;

  const tools = createInstalledApplicationTransmissionTools(
    context,
    [chat],
    [{ kind: "application", id: "chat" }],
  );
  assert.deepEqual(tools.map((tool) => tool.name), [
    "glove_app_chat__message_outbound_send",
    "glove_app_chat__reaction_outbound_send",
  ]);

  const sent = await tools[0]!.do({
    routeId: "chat-primary",
    payload: { text: "hello" },
  }, null as never, null as never);
  assert.equal(sent.status, "success");
  assert.equal(commands[0]?.type, "transmit");
  assert.deepEqual(commands[0] && "payload" in commands[0] ? commands[0].payload : null, {
    text: "hello",
  });
  assert.equal(
    commands[0] && "applicationId" in commands[0]
      ? commands[0].applicationId
      : undefined,
    "chat",
  );
  assert.deepEqual(events, [FOUNDRY_CORE_COMMAND_EVENT]);

  const invalid = await tools[0]!.do({
    routeId: "chat-primary",
    payload: { text: 42 },
  }, null as never, null as never);
  assert.equal(invalid.status, "error");
  assert.equal(commands.length, 1);
});

test("outbound transmission tools remain absent until the app is installed", () => {
  const context = {
    agentInstance: { playbooks: [] },
    controls: { commands: [], emit: () => undefined },
  } as unknown as AgentAssemblyContext;
  assert.deepEqual(
    createInstalledApplicationTransmissionTools(context, [chat], []),
    [],
  );
});
