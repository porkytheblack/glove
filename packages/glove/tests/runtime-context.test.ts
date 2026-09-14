import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Glove, MemoryStore, Displaymanager, type Message, type ModelAdapter } from "../src/index";

function make(model: ModelAdapter) {
  return new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Stable instructions", compaction_config: { compaction_instructions: "Summarize", max_turns: 5 } });
}

test("runtime context refreshes after tools at the input tail without changing the system or persisted prefix", async () => {
  const store = new MemoryStore("runtime-context");
  const history: Message[] = [{ sender: "user", text: "Earlier question" }, { sender: "agent", text: "Earlier answer" }];
  await store.appendMessages(history);
  let phase = "pending"; let calls = 0;
  const prompts: string[] = []; const snapshots: Message[][] = []; const traces: Message[][] = [];
  const model: ModelAdapter = { name: "test", setSystemPrompt: text => { prompts.push(text); }, async prompt(request) {
    snapshots.push(structuredClone(request.messages));
    assert.deepEqual(request.messages.slice(0, 2), history);
    assert.equal(request.messages.at(-1)!.text, `Goals: ${phase}`);
    if (calls++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "advance", tool_name: "advance", input_args: {} }] }], tokens_in: 1, tokens_out: 1 };
    return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 1, tokens_out: 1 };
  } };
  const builder = make(model);
  const remove = builder.addContextProvider(() => `Goals: ${phase}`);
  builder.fold({ name: "advance", description: "Advance", inputSchema: z.object({}), do: async () => { phase = "complete"; return { status: "success", data: "advanced" }; } });
  builder.addSubscriber({ async record(type, data) {
    if (type === "runtime_context") {
      const event = data as { messages: Message[] };
      assert.equal(event.messages[0].framework_context, "runtime");
      traces.push(structuredClone(event.messages));
      event.messages[0].text = "Subscriber mutation must not affect the model input";
    }
  } });
  const agent = builder.build(store); const setterCalls = prompts.length;
  await agent.processRequest("Continue");
  assert.equal(calls, 2); assert.equal(prompts.length, setterCalls);
  assert.equal(agent.getSystemPrompt(), "Stable instructions");
  assert.deepEqual(traces.map(m => m[0].text), ["Goals: pending", "Goals: complete"]);
  assert.ok(snapshots[1].at(-2)?.tool_results?.length, "context follows a complete tool result, never splitting tool call/result pairs");
  assert.ok(!(await store.getMessages()).some(m => m.text?.startsWith("Goals:")));
  remove(); assert.deepEqual(await agent.getRuntimeContext(), []);
});

test("providers compose and empty values disappear without modifying another provider", async () => {
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { return { messages: [], tokens_in: 0, tokens_out: 0 }; } }).build();
  let first = "Forms: email";
  agent.addContextProvider(() => first);
  agent.addContextProvider(() => "Context: brief answers");
  assert.deepEqual((await agent.getRuntimeContext()).map(m => m.text), [first, "Context: brief answers"]);
  first = "";
  assert.deepEqual((await agent.getRuntimeContext()).map(m => m.text), ["Context: brief answers"]);
  agent.setSystemPrompt("New host instructions");
  assert.equal(agent.getSystemPrompt(), "New host instructions");
  assert.equal((await agent.getRuntimeContext()).length, 1);
});

test("failed or aborted providers prevent a model call and receive cancellation", async () => {
  let calls = 0;
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { calls++; return { messages: [], tokens_in: 0, tokens_out: 0 }; } }).build();
  const remove = agent.addContextProvider(() => { throw new Error("context unavailable"); });
  await assert.rejects(agent.processRequest("Read"), /context unavailable/); assert.equal(calls, 0);
  remove();
  const controller = new AbortController();
  agent.addContextProvider(signal => { assert.equal(signal, controller.signal); controller.abort(new Error("cancelled")); return "stale"; });
  await assert.rejects(agent.processRequest("Read", controller.signal), /cancelled/); assert.equal(calls, 0);
  assert.equal(agent.getSystemPrompt(), "Stable instructions");
});
