import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "station-signal";
import { FOUNDRY_EVENT_PREFIX } from "../src/definition.js";
import {
  FoundryObserver,
  MemoryObservabilityAdapter,
} from "../src/observability.js";

test("observability adapter provides bounded, filterable, monotonic events", () => {
  const adapter = new MemoryObservabilityAdapter({ maxEvents: 2 });
  const observed: number[] = [];
  const unsubscribe = adapter.subscribe((event) => observed.push(event.sequence));
  adapter.append({ type: "run.one", category: "run", agent: "a", runId: "1", data: {} });
  adapter.append({ type: "tool.two", category: "tool", agent: "a", runId: "1", data: {} });
  adapter.append({ type: "run.three", category: "run", agent: "b", runId: "2", data: {} });
  unsubscribe();

  assert.deepEqual(observed, [1, 2, 3]);
  assert.deepEqual(adapter.list().map((event) => event.sequence), [2, 3]);
  assert.deepEqual(
    adapter.list({ category: "run" }).map((event) => event.type),
    ["run.three"],
  );
});

test("observer decodes batched and split Glove child events without loss", () => {
  const adapter = new MemoryObservabilityAdapter();
  const observer = new FoundryObserver(adapter, () => "assistant");
  const run = {
    id: "run-1",
    signalName: "foundry_assistant",
  } as Run;
  observer.onLogOutput({
    run,
    level: "stdout",
    message:
      `${FOUNDRY_EVENT_PREFIX}{"type":"text_delta","data":{"text":"hi"}}\n` +
      `${FOUNDRY_EVENT_PREFIX}{"type":"tool_use","data":{"id":"call`,
  });
  observer.onLogOutput({
    run,
    level: "stdout",
    message: `-1"}}\n`,
  });
  observer.onRunCompleted({ run, output: "done" });

  assert.deepEqual(
    adapter.list().map((event) => event.type),
    ["agent.text_delta", "agent.tool_use", "run.completed"],
  );
});

test("observer executes transmission commands without retaining their payload", () => {
  const adapter = new MemoryObservabilityAdapter();
  const forwarded: unknown[] = [];
  const observer = new FoundryObserver(adapter, () => "assistant", (event) => forwarded.push(event.data));
  const run = { id: "run-private-egress", signalName: "foundry_assistant" } as Run;
  const command = {
    id: "command-1",
    type: "transmit",
    definitionId: "assistant",
    agentId: "assistant-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    routeId: "messages-outbound",
    payload: { text: "private", artifact: { data: "base64-file-bytes" } },
  };

  observer.onLogOutput({
    run,
    level: "stdout",
    message: `${FOUNDRY_EVENT_PREFIX}${JSON.stringify({ type: "foundry.core.command", data: command })}\n`,
  });
  const projected = {
    ...command,
    id: "command-2",
    observability: { text: "safe summary", artifacts: [{ name: "report.pdf", bytes: 42 }] },
  };
  observer.onLogOutput({
    run,
    level: "stdout",
    message: `${FOUNDRY_EVENT_PREFIX}${JSON.stringify({ type: "foundry.core.command", data: projected })}\n`,
  });

  assert.deepEqual(forwarded, [command, projected], "The parent runtime must receive complete commands.");
  assert.deepEqual(adapter.list()[0]?.data, {
    id: "command-1",
    type: "transmit",
    definitionId: "assistant",
    agentId: "assistant-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    routeId: "messages-outbound",
    payload: { redacted: true },
  });
  assert.deepEqual(adapter.list()[1]?.data, {
    id: "command-2",
    type: "transmit",
    definitionId: "assistant",
    agentId: "assistant-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    routeId: "messages-outbound",
    payload: { text: "safe summary", artifacts: [{ name: "report.pdf", bytes: 42 }] },
  });
  assert.equal(JSON.stringify(adapter.list()).includes("base64-file-bytes"), false);
});
