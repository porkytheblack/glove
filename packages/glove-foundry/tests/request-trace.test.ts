import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, ModelRequestTool } from "glove-core";
import { requestTracer } from "../src/request-trace.js";

const tools: ModelRequestTool[] = [
  { name: "search", description: "Search the web", input_schema: { type: "object", properties: { q: { type: "string" } } } },
];

function request(id: string, messages: Message[], systemPrompt = "You are Muse.") {
  return { request_id: id, model: "test", purpose: "turn" as const, system_prompt: systemPrompt, messages, tools };
}

test("a run records each system prompt and tool set once, then by hash", () => {
  const trace = requestTracer();
  const first = trace.request(request("r1", [{ sender: "user", text: "Hi" }]));
  const second = trace.request(request("r2", [{ sender: "user", text: "Hi" }, { sender: "agent", text: "Hello" }]));
  assert.equal(first.system_prompt.text, "You are Muse.");
  assert.equal(second.system_prompt.text, undefined);
  assert.equal(second.system_prompt.hash, first.system_prompt.hash);
  assert.equal(first.tools.list?.[0]?.name, "search");
  assert.equal(second.tools.list, undefined);
  assert.deepEqual(second.tools.names, ["search"]);
  const changed = trace.request(request("r3", [{ sender: "user", text: "Hi" }], "You are a subagent."));
  assert.equal(changed.system_prompt.text, "You are a subagent.", "a different prompt is recorded in full");
  assert.equal(changed.messages.base, undefined, "a different prompt is a different conversation");
});

test("messages are recorded as a change against the previous request; runtime context separately", () => {
  const trace = requestTracer();
  const history: Message[] = [{ sender: "user", text: "Book a table" }];
  const memory: Message = { sender: "user", text: "Memory: vegetarian", framework_context: "runtime" };
  const first = trace.request(request("r1", [...history, memory]));
  assert.equal(first.messages.total, 1);
  assert.equal(first.messages.kept, 0);
  assert.deepEqual(first.messages.added.map(m => m.text), ["Book a table"]);
  assert.deepEqual(first.context.map(m => m.text), ["Memory: vegetarian"]);

  const call: Message = { sender: "agent", text: "", tool_calls: [{ id: "c1", tool_name: "search", input_args: { q: "tables" } }], reasoning_content: "private" };
  const results: Message = { sender: "user", text: "tool results", tool_results: [{ call_id: "c1", tool_name: "search", result: { status: "success", data: { found: 3 }, renderData: { secret: true } }, duration_ms: 40 }] };
  const second = trace.request(request("r2", [...history, call, results, { ...memory, text: "Memory: vegetarian, nut allergy" }]));
  assert.equal(second.messages.base, "r1");
  assert.equal(second.messages.kept, 1);
  assert.equal(second.messages.total, 3);
  assert.deepEqual(second.messages.added[0]!.tool_calls, [{ id: "c1", tool_name: "search", input_args: { q: "tables" } }]);
  assert.equal(second.messages.added[0]!.reasoning_omitted, true);
  assert.ok(!JSON.stringify(second).includes("private"), "echoed reasoning isn't recorded");
  assert.deepEqual(second.messages.added[1]!.tool_results, [{ call_id: "c1", tool_name: "search", status: "success", data: { found: 3 }, duration_ms: 40 }]);
  assert.ok(!JSON.stringify(second).includes("secret"), "renderData never reaches the model, so it isn't recorded");
  assert.equal(second.context[0]!.text, "Memory: vegetarian, nut allergy");
});

test("media becomes a placeholder and long values are cut", () => {
  const trace = requestTracer();
  const long = "x".repeat(40_000);
  const traced = trace.request(request("r1", [
    { sender: "user", text: long, content: [{ type: "text", text: "Look" }, { type: "image", name: "menu.png", source: { type: "base64", media_type: "image/png", data: "BYTES" } }] },
    { sender: "agent", text: "", tool_calls: [{ id: "c", tool_name: "search", input_args: { blob: long } }] },
  ]));
  const [message, call] = traced.messages.added;
  assert.equal(message!.text.length, 16_000);
  assert.equal(message!.text_chars, 40_000);
  assert.deepEqual(message!.content![1], { type: "image", name: "menu.png", media_type: "image/png" });
  assert.ok(!JSON.stringify(traced).includes("BYTES"));
  const input = call!.tool_calls![0]!.input_args as { truncated: boolean; chars: number };
  assert.equal(input.truncated, true);
  assert.ok(input.chars > 40_000);
});

test("a very long conversation records its newest messages and counts the rest", () => {
  const trace = requestTracer();
  const history: Message[] = Array.from({ length: 60 }, (_, i) => ({ sender: i % 2 ? "agent" : "user", text: `${i} ${"y".repeat(15_000)}` }));
  const traced = trace.request(request("r1", history));
  assert.ok(traced.messages.skipped! > 0);
  assert.equal(traced.messages.skipped! + traced.messages.added.length, 60);
  assert.ok(traced.messages.added.at(-1)!.text.startsWith("59 "), "the newest message is always kept");
});

test("the end of a request carries its outcome and response", () => {
  const trace = requestTracer();
  const end = trace.end({ request_id: "r1", model: "test", duration_ms: 812, status: "success", messages: [{ sender: "agent", text: "Booked." }], tokens_in: 900, tokens_out: 12, cache_read_input_tokens: 700 });
  assert.deepEqual(end, { request_id: "r1", model: "test", duration_ms: 812, status: "success", response: [{ sender: "agent", text: "Booked." }], tokens_in: 900, tokens_out: 12, cache_read_input_tokens: 700 });
  assert.deepEqual(trace.end({ request_id: "r2", model: "test", duration_ms: 5, status: "error", error: "overloaded" }), { request_id: "r2", model: "test", duration_ms: 5, status: "error", error: "overloaded" });
});
