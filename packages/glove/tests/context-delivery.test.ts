import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Glove, MemoryStore, Displaymanager, type Message, type ModelAdapter, type ModelPromptResult } from "../src/index";

function make(model: ModelAdapter) {
  return new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "Stable instructions", compaction_config: { compaction_instructions: "Summarize", max_turns: 5 } });
}

/** A model that calls `step` once, then answers. Records every request it sees. */
function steppingModel(seen: Message[][]): ModelAdapter {
  let calls = 0;
  return { name: "test", setSystemPrompt() {}, async prompt(request): Promise<ModelPromptResult> {
    seen.push(structuredClone(request.messages));
    if (calls++ % 2 === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: `step-${calls}`, tool_name: "step", input_args: {} }] }], tokens_in: 1, tokens_out: 1 };
    return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 1, tokens_out: 1 };
  } };
}

test("request delivery is read once, frozen before the request's message, and never saved", async () => {
  const seen: Message[][] = [];
  const builder = make(steppingModel(seen));
  let reads = 0; let phase = "start";
  builder.addContextProvider(() => { reads++; return `Snapshot: ${phase}`; }, { delivery: "request" });
  builder.fold({ name: "step", description: "Step", inputSchema: z.object({}), do: async () => { phase = "changed"; return { status: "success", data: "ok" }; } });
  const agent = builder.build(new MemoryStore("request-delivery"));

  await agent.processRequest("Go");
  assert.equal(reads, 1, "read once for the whole request, not per tool step");
  assert.equal(seen.length, 2);
  for (const messages of seen) {
    const trigger = messages.findIndex((m) => m.text === "Go");
    assert.equal(messages[trigger - 1].text, "Snapshot: start");
    assert.equal(messages[trigger - 1].transient, true);
  }
  // The prefix through the request's message is identical between tool steps.
  assert.deepEqual(seen[1].slice(0, seen[0].length), seen[0]);
  assert.ok(!(await agent.store.getMessages()).some((m) => m.text.startsWith("Snapshot")));
});

test("request delivery stays at the start of the visible history after compaction removes the message", async () => {
  const store = new MemoryStore("request-compaction");
  const seen: Message[][] = [];
  const builder = make(steppingModel(seen));
  builder.addContextProvider(() => "Frozen", { delivery: "request" });
  builder.fold({ name: "step", description: "Step", inputSchema: z.object({}), do: async () => {
    await store.appendMessages([{ sender: "user", text: "[summary]", is_compaction: true }]);
    return { status: "success", data: "ok" };
  } });
  const agent = builder.build(store);
  await agent.processRequest("Go");
  assert.equal(seen[1][0].is_compaction, true);
  assert.equal(seen[1][1].text, "Frozen");
});

test("history delivery saves wrapped context once per change and re-saves after compaction", async () => {
  const store = new MemoryStore("history-delivery");
  const seen: Message[][] = [];
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt(request) {
    seen.push(structuredClone(request.messages));
    return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 1, tokens_out: 1 };
  } }).build(store);
  let goals = "<goals version=\"1\"/>";
  agent.addContextProvider(() => goals, { delivery: "history", key: "glove.goals" });

  await agent.processRequest("one");
  await agent.processRequest("two");
  let saved = (await store.getMessages()).filter((m) => m.context_key === "glove.goals");
  assert.equal(saved.length, 1, "unchanged context is not saved again");
  assert.equal(saved[0].text, "<context key=\"glove.goals\">\n<goals version=\"1\"/>\n</context>");
  const history = await store.getMessages();
  assert.equal(history.indexOf(saved[0]) + 1, history.findIndex((m) => m.text === "one"), "saved just before the request's message");
  assert.ok(!seen[1].some((m) => m.transient), "nothing transient: it is history now");

  goals = "<goals version=\"2\"/>";
  await agent.processRequest("three");
  saved = (await store.getMessages()).filter((m) => m.context_key === "glove.goals");
  assert.equal(saved.length, 2);

  goals = "";
  await agent.processRequest("four");
  await agent.processRequest("five");
  saved = (await store.getMessages()).filter((m) => m.context_key === "glove.goals");
  assert.equal(saved.at(-1)!.text, "<context key=\"glove.goals\" status=\"cleared\" />");
  assert.equal(saved.length, 3, "cleared once");

  goals = "<goals version=\"3\"/>";
  await agent.processRequest("six");
  await store.appendMessages([{ sender: "user", text: "[summary]", is_compaction: true }]);
  await agent.processRequest("seven");
  saved = (await store.getMessages()).filter((m) => m.context_key === "glove.goals");
  assert.equal(saved.length, 5, "compaction hid the saved value, so it is saved again");
  assert.equal(saved.at(-1)!.text, saved.at(-2)!.text);
});

test("history delivery finds its last value by wrapper even when the store drops message metadata", async () => {
  const inner = new MemoryStore("lossy");
  const lossy = Object.assign(Object.create(inner), {
    async getMessages() { return (await inner.getMessages()).map(({ sender, text }) => ({ sender, text })); },
  }) as MemoryStore;
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 1, tokens_out: 1 }; } }).build(lossy);
  agent.addContextProvider(() => "Plan A", { delivery: "history", key: "plan" });
  await agent.processRequest("one");
  await agent.processRequest("two");
  assert.equal((await inner.getMessages()).filter((m) => m.text.startsWith("<context key=\"plan\"")).length, 1);
});

test("delivery options are validated", () => {
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { return { messages: [], tokens_in: 0, tokens_out: 0 }; } }).build();
  assert.throws(() => agent.addContextProvider(() => "x", { delivery: "history" }), /stable key/);
  assert.throws(() => agent.addContextProvider(() => "x", { delivery: "sometimes" as never }), /Unknown context delivery/);
  agent.addContextProvider(() => "x", { delivery: "history", key: "k" });
  assert.throws(() => agent.addContextProvider(() => "y", { delivery: "history", key: "k" }), /already registered/);
});

test("history delivery refuses media", async () => {
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 1, tokens_out: 1 }; } }).build();
  agent.addContextProvider(() => [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }], { delivery: "history", key: "shot" });
  await assert.rejects(agent.processRequest("look"), /must be text/);
});

test("getRuntimeContext filters by delivery and reads everything without a filter", async () => {
  const agent = make({ name: "test", setSystemPrompt() {}, async prompt() { return { messages: [], tokens_in: 0, tokens_out: 0 }; } }).build();
  agent.addContextProvider(() => "tail");
  agent.addContextProvider(() => "frozen", { delivery: "request" });
  agent.addContextProvider(() => "kept", { delivery: "history", key: "kept" });
  assert.deepEqual((await agent.getRuntimeContext()).map((m) => m.text), ["tail", "frozen", "kept"]);
  assert.deepEqual((await agent.getRuntimeContext(undefined, "request")).map((m) => m.text), ["frozen"]);
  assert.deepEqual((await agent.getRuntimeContext(undefined, "iteration")).map((m) => m.text), ["tail"]);
});
