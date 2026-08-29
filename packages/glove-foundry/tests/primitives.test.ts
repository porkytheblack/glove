import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Displaymanager, Glove, MemoryStore } from "glove-core";
import { createFoundryCoreTools } from "../src/core-tools.js";
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
} from "../src/primitives.js";
import { FoundryEchoModel } from "./fixtures/echo-model.js";

test("agent instances own multiple first-class conversations and shared workspace data", async () => {
  const data = new MemoryFoundryDataAdapter();
  const agent = createAgentInstance("assistant", { id: "agent-1", workspaceId: "acme" });
  const first = createConversation(agent, { id: "conversation-1" });
  const second = createConversation(agent, { id: "conversation-2" });
  await Effect.runPromise(data.putAgent(agent));
  await Effect.runPromise(data.putConversation(first));
  await Effect.runPromise(data.putConversation(second));
  await Effect.runPromise(data.putWorkspaceEntry({
    workspaceId: "acme", key: "release", value: { version: 2 }, updatedAt: new Date().toISOString(),
  }));

  assert.equal((await Effect.runPromise(data.listConversations(agent.id))).length, 2);
  assert.deepEqual((await Effect.runPromise(data.getWorkspaceEntry("acme", "release")))?.value, { version: 2 });
});

test("agent instances reconstruct immutable installation desired state from data", async () => {
  const original = { namespace: "release" };
  const agent = createAgentInstance("assistant", {
    id: "agent-installations",
    installations: [
      { kind: "application", id: "notes", config: original },
      { kind: "tool", id: "clock" },
      { kind: "application", id: "notes", config: { namespace: "support" } },
    ],
  });
  original.namespace = "mutated";

  assert.deepEqual(agent.installations, [
    { kind: "application", id: "notes", config: { namespace: "support" } },
    { kind: "tool", id: "clock" },
  ]);
  assert.equal(Object.isFrozen(agent.installations), true);
  assert.equal(Object.isFrozen(agent.installations[0]?.config), true);
});

test("framework core tools emit identity-scoped orchestration commands", async () => {
  const data = new MemoryFoundryDataAdapter();
  const agent = createAgentInstance("assistant", { id: "agent-1", workspaceId: "acme" });
  const conversation = createConversation(agent, { id: "conversation-1" });
  const glove = new Glove({
    model: new FoundryEchoModel(),
    store: new MemoryStore("core-tools"),
    displayManager: new Displaymanager(),
    systemPrompt: "test",
    serverMode: true,
    compaction_config: { compaction_instructions: "test" },
  }).build();
  const commands: any[] = [];
  const tools = createFoundryCoreTools({
    definitionId: "assistant",
    agentId: agent.id,
    conversationId: conversation.id,
    workspaceId: "acme",
    name: "foundry_assistant",
    runId: "run-1",
    mode: "agent",
    request: {
      agentId: agent.id, conversationId: conversation.id, workspaceId: "acme",
      message: "test", source: { kind: "direct" },
    },
    agentInstance: agent,
    conversation,
    activations: [],
    data,
    input: {},
    message: { sender: "user", text: "test" },
    messageInput: "test",
    messageText: "test",
    history: [],
    messages: [{ sender: "user", text: "test" }],
    installations: [],
    store: glove.store,
    subscriber: { record: async () => undefined },
    controls: { signal: new AbortController().signal, commands, emit: () => undefined },
  });
  const sleep = tools.find((tool) => tool.name === "glove_foundry_sleep")!;
  const beforeSleep = Date.now();
  const result = await (sleep.do as (input: unknown) => Promise<any>)({
    kind: "for", duration: "1m", message: "resume",
  });

  assert.equal(result.status, "success");
  assert.equal(commands[0].type, "sleep");
  assert.equal(commands[0].agentId, agent.id);
  assert.equal(commands[0].conversationId, conversation.id);
  assert.ok(new Date(commands[0].wakeAt).getTime() >= beforeSleep + 59_000);

  const schedule = tools.find((tool) => tool.name === "glove_foundry_schedule")!;
  await (schedule.do as (input: unknown) => Promise<any>)({
    message: "review again",
    timing: { kind: "every", interval: "2h" },
  });
  assert.equal(commands[1].type, "schedule");
  assert.equal(commands[1].agentId, agent.id);
  assert.equal(commands[1].conversationId, conversation.id);
  assert.deepEqual(commands[1].timing, { kind: "every", intervalMs: 7_200_000 });

  const schedules = tools.find((tool) => tool.name === "glove_foundry_schedules")!;
  const listed = await (schedules.do as (input: unknown) => Promise<any>)({ action: "list" });
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].id, commands[1].id);
  await (schedules.do as (input: unknown) => Promise<any>)({
    action: "update", activationId: commands[1].id,
    message: "review with the team", timing: { kind: "every", interval: "4h" },
  });
  assert.equal(commands[2].type, "schedule.update");
  assert.deepEqual(commands[2].patch.timing, { kind: "every", intervalMs: 14_400_000 });
  await (schedules.do as (input: unknown) => Promise<any>)({
    action: "cancel", activationId: commands[1].id,
  });
  assert.equal(commands[3].type, "schedule.cancel");

  const transmit = tools.find((tool) => tool.name === "glove_foundry_transmit")!;
  await (transmit.do as (input: unknown) => Promise<any>)({
    routeId: "support-replies", payload: { message: "done" },
  });
  assert.equal(commands[4].type, "transmit");
  assert.equal(commands[4].routeId, "support-replies");

  const inbox = tools.find((tool) => tool.name === "glove_foundry_shared_inbox")!;
  const posted = await (inbox.do as (input: unknown) => Promise<any>)({
    action: "post", topic: "review", payload: { release: 2 },
  });
  const resolved = await (inbox.do as (input: unknown) => Promise<any>)({
    action: "update", itemId: posted.data.id, status: "resolved",
  });
  assert.equal(resolved.data.status, "resolved");

  const tasks = tools.find((tool) => tool.name === "glove_foundry_tasks")!;
  const created = await (tasks.do as (input: unknown) => Promise<any>)({
    action: "create", title: "Publish release",
  });
  const completed = await (tasks.do as (input: unknown) => Promise<any>)({
    action: "update", taskId: created.data.id, status: "completed",
  });
  assert.equal(completed.data.status, "completed");
});
