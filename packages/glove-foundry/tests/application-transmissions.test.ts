import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { Schema } from "effect";
import { defineApp } from "../src/capabilities.js";
import {
  FOUNDRY_CORE_COMMAND_EVENT,
  createInstalledApplicationTransmissionTools,
  installedApplicationTransmissionToolName,
  type FoundryCoreCommand,
} from "../src/core-tools.js";
import type { AgentAssemblyContext } from "../src/definition.js";
import { defineTransmission } from "../src/integration.js";
import {
  FOUNDRY_CORE_COMMAND_DIRECTORY_ENV,
  settleFoundryCoreCommandRequest,
} from "../src/core-command-result.js";

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
    observe: (input) => ({ characters: input.text.length }),
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

const outboundScreenshot = defineTransmission({
  id: "screenshot-outbound",
  name: "Outbound screenshot",
  description: "Capture a screenshot",
  outbound: {
    config: Schema.Struct({ channel: Schema.String }),
    input: Schema.Struct({ fullPage: Schema.Boolean }),
    output: Schema.Struct({ mimeType: Schema.String, base64: Schema.String, bytes: Schema.Number }),
    requiresPermission: (input) => input.fullPage,
    project: ({ base64: _base64, ...metadata }) => metadata,
    render: (output) => ({
      kind: "gallery",
      images: [{ dataUrl: `data:${output.mimeType};base64,${output.base64}` }],
    }),
  },
});

const chat = defineApp({
  id: "chat",
  description: "Chat application",
  inbound: [inboundMessage, inboundReaction],
  outbound: [outboundMessage, outboundReaction],
});

const browser = defineApp({
  id: "browser",
  description: "Browser application",
  outbound: [outboundScreenshot],
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
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-command-tools-"));
  const previousDirectory = process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV];
  process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV] = directory;
  const commands: FoundryCoreCommand[] = [];
  const events: string[] = [];
  const eventCommands: FoundryCoreCommand[] = [];
  const controller = new AbortController();
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
      signal: controller.signal,
      commands,
      emit: (event: { type: string; data?: unknown }) => {
        events.push(event.type);
        const command = event.data as FoundryCoreCommand;
        eventCommands.push(command);
        if (command?.type === "transmit") {
          void settleFoundryCoreCommandRequest(directory, command.id, {
            status: "success",
            output: { messageId: "message-1" },
          });
        }
      },
    },
  } as unknown as AgentAssemblyContext;
  try {
    const tools = createInstalledApplicationTransmissionTools(
      context,
      [chat],
      [{ kind: "application", id: "chat" }],
    );
    assert.equal(
      installedApplicationTransmissionToolName(chat, outboundMessage),
      "glove_app_chat__message_outbound_send",
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
    assert.deepEqual(sent.data, { messageId: "message-1" });
    assert.equal(commands[0]?.type, "transmit");
    assert.deepEqual(commands[0] && "payload" in commands[0] ? commands[0].payload : null, {
      text: "hello",
    });
    assert.deepEqual(
      commands[0] && "observability" in commands[0] ? commands[0].observability : null,
      { characters: 5 },
    );
    assert.equal(
      commands[0] && "applicationId" in commands[0]
        ? commands[0].applicationId
        : undefined,
      "chat",
    );
    assert.deepEqual(events, [FOUNDRY_CORE_COMMAND_EVENT]);
    assert.deepEqual(
      eventCommands[0] && "payload" in eventCommands[0] ? eventCommands[0].payload : null,
      { privateRequest: true },
      "The observable event must not carry the execution payload.",
    );

    const invalid = await tools[0]!.do({
      routeId: "chat-primary",
      payload: { text: 42 },
    }, null as never, null as never);
    assert.equal(invalid.status, "error");
    assert.equal(commands.length, 1);
  } finally {
    controller.abort();
    if (previousDirectory === undefined) {
      delete process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV];
    } else {
      process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV] = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
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

test("outbound transmissions preserve permission gates and split model data from render data", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-command-render-"));
  const previousDirectory = process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV];
  process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV] = directory;
  const context = {
    definitionId: "assistant",
    agentId: "assistant-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    runId: "run-1",
    agentInstance: { playbooks: [] },
    controls: {
      signal: new AbortController().signal,
      commands: [],
      emit: (event: { data?: unknown }) => {
        const command = event.data as FoundryCoreCommand;
        if (command?.type === "transmit") {
          void settleFoundryCoreCommandRequest(directory, command.id, {
            status: "success",
            output: { mimeType: "image/png", base64: "cG5n", bytes: 3 },
          });
        }
      },
    },
  } as unknown as AgentAssemblyContext;
  try {
    const tool = createInstalledApplicationTransmissionTools(
      context,
      [browser],
      [{ kind: "application", id: "browser" }],
    )[0]!;
    assert.equal(typeof tool.requiresPermission, "function");
    assert.equal((tool.requiresPermission as (input: unknown) => boolean)({
      routeId: "browser-screenshot",
      payload: { fullPage: false },
    }), false);
    assert.equal((tool.requiresPermission as (input: unknown) => boolean)({
      routeId: "browser-screenshot",
      payload: { fullPage: true },
    }), true);
    assert.equal((tool.requiresPermission as (input: unknown) => boolean)({
      routeId: "browser-screenshot",
      payload: { fullPage: "yes" },
    }), false);
    const result = await tool.do({
      routeId: "browser-screenshot",
      payload: { fullPage: true },
    }, null as never, null as never);
    assert.deepEqual(result.data, { mimeType: "image/png", bytes: 3 });
    assert.deepEqual(result.renderData, {
      kind: "gallery",
      images: [{ dataUrl: "data:image/png;base64,cG5n" }],
    });
  } finally {
    if (previousDirectory === undefined) delete process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV];
    else process.env[FOUNDRY_CORE_COMMAND_DIRECTORY_ENV] = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
