import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Glove, MemoryStore, Displaymanager, type ModelAdapter, type SubscriberEvent } from "../src/index";

type Recorded = { type: SubscriberEvent["type"]; data: any };

function make(model: ModelAdapter) {
  return new Glove({ model, displayManager: new Displaymanager(), systemPrompt: "You plan trips.", compaction_config: { compaction_instructions: "Summarize", max_turns: 5 } });
}

test("model_request reports what each model call receives, and model_request_end how it ended", async () => {
  let calls = 0;
  const model: ModelAdapter = { name: "test-model", setSystemPrompt() {}, async prompt() {
    if (calls++ === 0) return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "c1", tool_name: "lookup", input_args: { city: "Lisbon" } }] }], tokens_in: 10, tokens_out: 2, cache_read_input_tokens: 4 };
    return { messages: [{ sender: "agent", text: "Lisbon is sunny." }], tokens_in: 12, tokens_out: 5 };
  } };
  const builder = make(model);
  builder.addContextProvider(() => "Memory: prefers trains");
  builder.fold({ name: "lookup", description: "Weather for a city", inputSchema: z.object({ city: z.string() }), do: async () => ({ status: "success", data: "sunny" }) });
  const seen: Recorded[] = [];
  const all: Recorded[] = [];
  builder.addSubscriber({ modelRequests: true, async record(type, data) { seen.push({ type, data }); } });
  builder.addSubscriber({ async record(type, data) { all.push({ type, data }); } });
  await builder.build(new MemoryStore("model-request")).processRequest("Weather in Lisbon?");

  const requests = seen.filter(e => e.type === "model_request");
  const ends = seen.filter(e => e.type === "model_request_end");
  assert.equal(requests.length, 2);
  assert.equal(ends.length, 2);
  const [first, second] = requests.map(e => e.data);
  assert.equal(first.model, "test-model");
  assert.equal(first.purpose, "turn");
  assert.equal(first.system_prompt, "You plan trips.");
  assert.deepEqual(first.tools.find((t: any) => t.name === "lookup").input_schema.properties, { city: { type: "string" } });
  assert.equal(first.messages.at(-1).framework_context, "runtime", "runtime context is at the tail");
  assert.equal(first.messages.at(-1).text, "Memory: prefers trains");
  assert.ok(second.messages.some((m: any) => m.tool_results?.[0]?.call_id === "c1"), "the second request carries the tool result");
  assert.notEqual(first.request_id, second.request_id);
  assert.deepEqual(ends.map(e => e.data.request_id), [first.request_id, second.request_id]);
  assert.equal(ends[0].data.status, "success");
  assert.equal(ends[0].data.tokens_in, 10);
  assert.equal(ends[0].data.cache_read_input_tokens, 4);
  assert.equal(ends[1].data.messages[0].text, "Lisbon is sunny.");
  assert.ok(ends[0].data.duration_ms >= 0);
  assert.ok(seen.findIndex(e => e.type === "model_request") < seen.findIndex(e => e.type === "tool_use_result"));
  assert.ok(!all.some(e => e.type === "model_request" || e.type === "model_request_end"), "subscribers that don't ask never get whole requests");
});

test("a failed model call ends its request with the error and still throws it", async () => {
  const builder = make({ name: "flaky", setSystemPrompt() {}, async prompt() { throw new Error("provider overloaded"); } });
  const seen: Recorded[] = [];
  builder.addSubscriber({ modelRequests: true, async record(type, data) { seen.push({ type, data }); } });
  await assert.rejects(builder.build().processRequest("Hi"), /provider overloaded/);
  const end = seen.find(e => e.type === "model_request_end")!;
  assert.equal(end.data.status, "error");
  assert.equal(end.data.error, "provider overloaded");
  assert.equal(end.data.request_id, seen[0].data.request_id);
});

test("an aborted model call ends as aborted", async () => {
  const controller = new AbortController();
  const builder = make({ name: "slow", setSystemPrompt() {}, async prompt(_request, _notify, signal) {
    controller.abort();
    signal?.throwIfAborted();
    return { messages: [], tokens_in: 0, tokens_out: 0 };
  } });
  const seen: Recorded[] = [];
  builder.addSubscriber({ modelRequests: true, async record(type, data) { seen.push({ type, data }); } });
  await assert.rejects(builder.build().processRequest("Hi", controller.signal));
  assert.equal(seen.find(e => e.type === "model_request_end")?.data.status, "aborted");
});

test("compaction requests say so", async () => {
  const store = new MemoryStore("compaction-request");
  await store.addTokens({ tokens_in: 500, tokens_out: 0 });
  const builder = new Glove({ model: { name: "m", setSystemPrompt() {}, async prompt() { return { messages: [{ sender: "agent", text: "Summary" }], tokens_in: 1, tokens_out: 1 }; } }, displayManager: new Displaymanager(), systemPrompt: "S", compaction_config: { compaction_instructions: "Summarize now", compaction_context_limit: 100 } });
  const purposes: string[] = [];
  builder.addSubscriber({ modelRequests: true, async record(type, data: any) { if (type === "model_request") purposes.push(data.purpose); } });
  const agent = builder.build(store);
  await agent.processRequest("Hello");
  await (agent as any).observer.runCompactionNow();
  assert.deepEqual(purposes, ["turn", "compaction"]);
});
