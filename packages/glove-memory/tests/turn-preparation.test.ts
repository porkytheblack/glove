// Goals and forms prepare state before each turn. On a Glove with the
// turn-preparer seam they register there, so runtimes that never call
// processRequest (realtime sessions) prepare turns too.
import test from "node:test";
import assert from "node:assert/strict";
import { Glove, Displaymanager, type ModelAdapter } from "glove-core";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { useGoalRunner } from "../src/tools/goals";

const model: ModelAdapter = {
  name: "test",
  setSystemPrompt() {},
  async prompt() { return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 }; },
};

function glove() {
  return new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Host", compaction_config: { compaction_instructions: "s" } }).build();
}

test("useGoalRunner registers a turn preparer instead of wrapping processRequest", async () => {
  const agent = glove();
  const processRequest = agent.processRequest;
  let configured = 0;
  useGoalRunner(agent, new InMemoryGoalAdapter(), { scope: { subject: "s", key: "intake" }, configure: () => { configured++; } });
  assert.equal(agent.processRequest, processRequest, "processRequest is left alone");
  await agent.prepareTurn();
  assert.equal(configured, 1, "a runtime calling prepareTurn gets goal preparation");
  await agent.processRequest("hello");
  assert.equal(configured, 2, "text turns still prepare, through the same preparer");
});

test("a runnable without the seam still gets preparation by wrapping processRequest", async () => {
  let configured = 0;
  const calls: string[] = [];
  const proxy = {
    fold() {},
    getSystemPrompt: () => "Host",
    setSystemPrompt() {},
    addContextProvider: () => () => {},
    processRequest: async (request: string) => { calls.push(request); return { sender: "agent" as const, text: "" }; },
  };
  useGoalRunner(proxy as never, new InMemoryGoalAdapter(), { scope: { subject: "s", key: "intake" }, configure: () => { configured++; } });
  await proxy.processRequest("hi");
  assert.equal(configured, 1);
  assert.deepEqual(calls, ["hi"]);
});
