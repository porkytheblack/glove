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
