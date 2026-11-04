import assert from "node:assert/strict";
import { test } from "node:test";
import { DASHBOARD_TRACE_SCRIPT } from "../src/dashboard-trace.js";
import { requestTracer } from "../src/request-trace.js";
import type { Message } from "glove-core";

interface TraceItem {
  kind: string; key: string; name: string; status: string; index?: number; via?: string;
  messages?: Array<{ text: string } | null>; newFrom?: number; context?: Array<{ text: string }>;
  systemPrompt?: string; tools?: Array<{ name: string }>; response?: Array<{ text: string }>;
  initiator: { label: string; key?: string }; request?: string | null; durationMs: number;
  input?: unknown; result?: { status: string; data: unknown }; approval?: { status: string };
  tokensIn?: number; stopReason?: string; legacy?: boolean;
}
const kit = new Function(`${DASHBOARD_TRACE_SCRIPT}; return { buildRunTrace, buildConsole, describeEvent };`)() as {
  buildRunTrace(events: unknown[], run?: unknown): { items: TraceItem[]; totals: Record<string, number>; prompts: Record<string, string> };
  buildConsole(events: unknown[]): Array<{ level: string; message: string; type: string; data: unknown }>;
};

/** Events as a real run records them: through Foundry's tracer, prefixed and sequenced. */
function runEvents(): unknown[] {
  const trace = requestTracer();
  const events: unknown[] = [];
  let sequence = 0; let clock = Date.parse("2026-10-26T10:00:00.000Z");
  const push = (type: string, data: unknown, category = "model", advance = 100) => {
    clock += advance;
    events.push({ id: `e${++sequence}`, sequence, timestamp: new Date(clock).toISOString(), type, category, runId: "run_1", data });
  };
  const tools = [{ name: "search", description: "Search", input_schema: { type: "object" } }, { name: "book", description: "Book a table", input_schema: { type: "object" } }];
  const user: Message = { sender: "user", text: "Book dinner for two" };
  const memory: Message = { sender: "user", text: "Memory: vegetarian", framework_context: "runtime" };
  push("run.started", {}, "run");
  push("agent.model_request", trace.request({ request_id: "r1", model: "claude", purpose: "turn", system_prompt: "You are Muse.", messages: [user, memory], tools }));
  push("agent.text_delta", { text: "Let me " });
  push("agent.text_delta", { text: "look." });
  push("agent.tool_use", { id: "c1", name: "search", input: { q: "vegetarian dinner" } }, "tool");
  push("agent.model_response_complete", { text: "Let me look.", stop_reason: "tool_use" });
  const call: Message = { sender: "agent", text: "Let me look.", tool_calls: [{ id: "c1", tool_name: "search", input_args: { q: "vegetarian dinner" } }] };
  push("agent.model_request_end", trace.end({ request_id: "r1", model: "claude", duration_ms: 400, status: "success", messages: [call], tokens_in: 900, tokens_out: 20 }));
  push("agent.tool_use_result", { id: "c1", name: "search", call_id: "c1", tool_name: "search", result: { status: "success", data: ["Verde"] }, duration_ms: 250 }, "tool", 260);
  const results: Message = { sender: "user", text: "tool results", tool_results: [{ call_id: "c1", tool_name: "search", result: { status: "success", data: ["Verde"] } }] };
  push("agent.model_request", trace.request({ request_id: "r2", model: "claude", purpose: "turn", system_prompt: "You are Muse.", messages: [user, call, results, memory], tools }));
  push("agent.tool_use", { id: "c2", name: "book", input: { place: "Verde" } }, "tool");
  const call2: Message = { sender: "agent", text: "", tool_calls: [{ id: "c2", tool_name: "book", input_args: { place: "Verde" } }] };
  push("agent.model_request_end", trace.end({ request_id: "r2", model: "claude", duration_ms: 300, status: "success", messages: [call2], tokens_in: 1100, tokens_out: 10 }));
  push("agent.foundry.approval.requested", { id: "a1", toolName: "book", toolInput: { place: "Verde" } }, "system");
  push("agent.foundry.approval.settled", { approvalId: "a1", toolName: "book", status: "approved" }, "system", 5_000);
  push("agent.tool_use_result", { id: "c2", name: "book", result: { status: "error", data: null, message: "Fully booked" }, duration_ms: 5_100 }, "tool");
  push("log.stderr", { message: "warning: slow" }, "log");
  push("run.completed", {}, "run");
  return events;
}

test("the trace lists model requests and tool calls with what each was sent and returned", () => {
  const trace = kit.buildRunTrace(runEvents(), { status: "completed", createdAt: "2026-10-26T10:00:00.000Z" });
  assert.deepEqual(trace.items.map(item => `${item.kind}:${item.name}:${item.status}`), [
    "model:#1 request:success", "tool:search:success", "model:#2 request:success", "tool:book:error",
  ]);
  const [first, search, second, book] = trace.items;
  assert.equal(first!.systemPrompt, "You are Muse.");
  assert.equal(second!.systemPrompt, "You are Muse.", "a prompt recorded once is resolved for later requests");
  assert.deepEqual(second!.tools!.map(tool => tool.name), ["search", "book"]);
  assert.deepEqual(second!.messages!.map(message => message?.text), ["Book dinner for two", "Let me look.", "tool results"]);
  assert.equal(second!.newFrom, 1, "the request says which messages are new");
  assert.deepEqual(second!.context!.map(message => message.text), ["Memory: vegetarian"]);
  assert.equal(first!.stopReason, "tool_use");
  assert.equal(first!.initiator.label, "run input");
  assert.equal(second!.initiator.label, "after search");
  assert.equal(second!.initiator.key, first!.key);
  assert.equal(search!.request, first!.key);
  assert.deepEqual(search!.input, { q: "vegetarian dinner" });
  assert.deepEqual(search!.result!.data, ["Verde"]);
  assert.equal(search!.durationMs, 250);
  assert.equal(book!.approval!.status, "approved");
  assert.equal(trace.totals.requests, 2);
  assert.equal(trace.totals.tools, 2);
  assert.equal(trace.totals.tokensIn, 2000);
  assert.equal(trace.totals.errors, 1);
});

test("the console reads like a log: levels, one row per streamed reply", () => {
  const rows = kit.buildConsole(runEvents());
  const streamed = rows.filter(row => row.type === "text_delta");
  assert.equal(streamed.length, 1);
  assert.match(streamed[0]!.message, /2 chunks.*Let me look\./);
  assert.ok(rows.some(row => row.level === "error" && /book failed.*Fully booked/.test(row.message)));
  assert.ok(rows.some(row => row.level === "warn" && /Waiting for approval: book/.test(row.message)));
  assert.ok(rows.some(row => row.level === "warn" && row.message === "warning: slow"));
  assert.ok(rows.some(row => row.level === "info" && /→ Model request claude · 1 messages · 1 context · 2 tools/.test(row.message)));
});

test("runs recorded before request events still list their responses", () => {
  const trace = kit.buildRunTrace([
    { id: "1", sequence: 1, timestamp: "2026-10-26T10:00:00.000Z", type: "agent.model_response_complete", category: "model", data: { text: "Hi", tokens_in: 5, tokens_out: 1 } },
    { id: "2", sequence: 2, timestamp: "2026-10-26T10:00:01.000Z", type: "agent.tool_use", category: "tool", data: { id: "x", name: "search", input: {} } },
    { id: "3", sequence: 3, timestamp: "2026-10-26T10:00:02.000Z", type: "agent.tool_use_result", category: "tool", data: { call_id: "x", tool_name: "search", result: { status: "success", data: 1 } } },
  ]);
  assert.equal(trace.items[0]!.legacy, true);
  assert.equal(trace.items[0]!.response![0]!.text, "Hi");
  assert.equal(trace.items[1]!.status, "success");
});

test("a model that doesn't stream tool_use still gets its calls, inputs and approvals listed", () => {
  const at = (s: number) => new Date(Date.parse("2026-10-26T10:00:00.000Z") + s * 1000).toISOString();
  const trace = kit.buildRunTrace([
    { id: "1", sequence: 1, timestamp: at(0), type: "agent.model_request", category: "model", data: { request_id: "r1", model: "m", purpose: "turn", system_prompt: { hash: "h", chars: 1, text: "S" }, tools: { hash: "t", names: ["send"] }, messages: { total: 1, kept: 0, added: [{ sender: "user", text: "Email Leo" }] }, context: [] } },
    { id: "2", sequence: 2, timestamp: at(1), type: "agent.model_request_end", category: "model", data: { request_id: "r1", model: "m", duration_ms: 1000, status: "success", response: [{ sender: "agent", text: "", tool_calls: [{ id: "c1", tool_name: "send", input_args: { to: "leo" } }] }] } },
    { id: "3", sequence: 3, timestamp: at(1), type: "agent.foundry.approval.requested", category: "system", data: { id: "a1", toolName: "send", toolInput: { to: "leo" } } },
    { id: "4", sequence: 4, timestamp: at(4), type: "agent.foundry.approval.settled", category: "system", data: { approvalId: "a1", toolName: "send", status: "approved" } },
    { id: "5", sequence: 5, timestamp: at(5), type: "agent.tool_use_result", category: "tool", data: { call_id: "c1", tool_name: "send", result: { status: "success", data: "sent" }, duration_ms: 4000 } },
  ]);
  const tool = trace.items[1]!;
  assert.equal(tool.name, "send");
  assert.deepEqual(tool.input, { to: "leo" });
  assert.equal(tool.initiator.label, "#1 request");
  assert.equal(tool.approval!.status, "approved");
  assert.equal(tool.status, "success");
  assert.equal(trace.totals.tools, 1);
});

/** A run with a subagent, a suspended turn and its resume, recorded with glove-core's turn, start and request events. */
function richEvents(): unknown[] {
  const trace = requestTracer();
  const events: unknown[] = [];
  let sequence = 0; let clock = Date.parse("2026-10-26T10:00:00.000Z");
  const push = (type: string, data: unknown, advance = 100) => {
    clock += advance;
    events.push({ id: `e${++sequence}`, sequence, timestamp: new Date(clock).toISOString(), type: `agent.${type}`, category: "model", runId: "run_1", data });
  };
  const tools = [{ name: "glove_invoke_subagent", description: "Delegate", input_schema: { type: "object" } }, { name: "send", description: "Send", input_schema: { type: "object" } }];
  const user: Message = { sender: "user", text: "Research and send" };
  push("turn_start", { turn_id: "T1", trigger: "request" }, 0);
  push("model_request", trace.request({ request_id: "p1", model: "big", purpose: "turn", system_prompt: "Parent", messages: [user], tools }));
  push("text_delta", { text: "On it", request_id: "p1" }, 300);
  push("tool_use", { id: "d1", name: "glove_invoke_subagent", input: { name: "researcher", prompt: "Find it" }, request_id: "p1" }, 50);
  push("model_request_end", trace.end({ request_id: "p1", model: "big", duration_ms: 450, status: "success", messages: [{ sender: "agent", text: "On it", tool_calls: [{ id: "d1", tool_name: "glove_invoke_subagent", input_args: { name: "researcher", prompt: "Find it" } }] }], tokens_in: 10, tokens_out: 2 }));
  push("subagent_invoked", { name: "researcher", prompt: "Find it", call_id: "d1" }, 10);
  push("tool_use_start", { id: "d1", name: "glove_invoke_subagent", input: { name: "researcher", prompt: "Find it" }, waited_ms: 0 }, 0);
  push("turn_start", { turn_id: "C1", trigger: "request" }, 0);
  push("model_request", trace.request({ request_id: "c1", model: "small", purpose: "turn", system_prompt: "Child", messages: [{ sender: "user", text: "Find it" }], tools: [] }));
  push("text_delta", { text: "Found", request_id: "c1" }, 200);
  push("model_request_end", trace.end({ request_id: "c1", model: "small", duration_ms: 400, status: "success", messages: [{ sender: "agent", text: "Found" }], tokens_in: 3, tokens_out: 1 }), 200);
  push("turn_end", { turn_id: "C1", trigger: "request", status: "success", duration_ms: 500 }, 0);
  push("tool_use_result", { id: "d1", name: "glove_invoke_subagent", result: { status: "success", data: "Found" }, duration_ms: 520 }, 10);
  push("subagent_completed", { name: "researcher", status: "success", call_id: "d1" }, 0);
  push("model_request", trace.request({ request_id: "p2", model: "big", purpose: "turn", system_prompt: "Parent", messages: [user], tools }));
  push("tool_use", { id: "s1", name: "send", input: { to: "leo" }, request_id: "p2" }, 100);
  push("model_request_end", trace.end({ request_id: "p2", model: "big", duration_ms: 200, status: "success", messages: [{ sender: "agent", text: "", tool_calls: [{ id: "s1", tool_name: "send", input_args: { to: "leo" } }] }] }));
  push("turn_end", { turn_id: "T1", trigger: "request", status: "suspended", duration_ms: 1900 }, 10);
  push("inbox_injected", { ids: ["i1"], tags: ["refund"], phase: "request" }, 4_000);
  push("event_received", { id: "ev1", source: "foundry:agent:coder", kind: "agent-message", disposition: "queued", preview: "Tests pass" }, 0);
  push("turn_start", { turn_id: "T2", trigger: "resume" }, 0);
  push("tool_use_start", { id: "s1", name: "send", input: { to: "leo" }, waited_ms: 3 }, 5);
  push("tool_use_result", { id: "s1", name: "send", result: { status: "success", data: "sent" }, duration_ms: 300 }, 297);
  push("event_injected", { ids: ["ev1"], phase: "loop" }, 1);
  push("turn_end", { turn_id: "T2", trigger: "resume", status: "success", duration_ms: 400 }, 100);
  return events;
}

test("streamed events, subagents and turns land on the request, agent and turn they belong to", () => {
  const trace = kit.buildRunTrace(richEvents(), { status: "completed", createdAt: "2026-10-26T10:00:00.000Z" }) as unknown as {
    items: Array<TraceItem & { depth?: number; parent?: string; turn?: number; ttftMs?: number; streamed?: string; queuedMs?: number; runMs?: number; askedAt?: number; call?: string }>;
    turns: Array<{ index: number; trigger: string; status: string; durationMs: number }>;
  };
  const byKey = Object.fromEntries(trace.items.map(item => [item.key, item]));
  const parent = byKey["m:p1"]!; const child = byKey["m:c1"]!; const subagent = byKey["s:d1"]!; const send = byKey["t:s1"]!;
  assert.equal(parent.streamed, "On it");
  assert.equal(child.streamed, "Found", "the child's text is the child's, not the parent's");
  assert.equal(parent.ttftMs, 300, "first token 300ms into a 450ms request");
  assert.equal(subagent.call, "t:d1");
  assert.equal(subagent.initiator.key, "t:d1");
  assert.equal(child.depth, 1);
  assert.equal(child.parent, "s:d1");
  assert.equal(child.initiator.label, "subagent researcher");
  assert.equal(byKey["m:p2"]!.initiator.label, "after glove_invoke_subagent", "the parent carries on from its own request");
  assert.deepEqual(trace.turns.map(turn => `${turn.index}:${turn.trigger}:${turn.status}`), ["1:request:suspended", "2:resume:success"], "the child's turn isn't one of the run's");
  assert.equal(send.turn, 1, "the call was asked for in the first turn");
  assert.ok(send.queuedMs! > 4_000, "it waited across the suspension before its step reached it");
  assert.equal(send.runMs, 297);
  assert.equal(send.durationMs, 300);
});

test("tools that only report starting still get a row", () => {
  const trace = kit.buildRunTrace([
    { id: "1", sequence: 1, timestamp: "2026-10-26T10:00:00.000Z", type: "agent.tool_use_start", category: "tool", data: { id: "x", name: "search", input: { q: 1 }, waited_ms: 0 } },
    { id: "2", sequence: 2, timestamp: "2026-10-26T10:00:01.000Z", type: "agent.tool_use_result", category: "tool", data: { id: "x", name: "search", result: { status: "error", data: null, message: "Permission denied for tool \"search\". The user has not granted permission to run this tool." }, duration_ms: 1000 } },
  ]);
  assert.equal(trace.items.length, 1);
  assert.deepEqual(trace.items[0]!.input, { q: 1 });
  assert.equal(trace.items[0]!.status, "denied");
});

test("the console says when turns, inbox items and events moved", () => {
  const rows = kit.buildConsole(richEvents());
  const text = rows.map(row => `${row.level} ${row.message}`);
  assert.deepEqual(rows.filter(row => row.type === "text_delta").map(row => (row.data as { text: string }).text), ["On it", "Found"], "one streamed row per request");
  assert.ok(text.includes("warn Turn suspended after 1900ms: a tool call is waiting for a decision"));
  assert.ok(text.includes("info Turn resumed at its tool step"));
  assert.ok(text.includes("info Inbox: 1 resolved item joined the conversation before the request (refund)"));
  assert.ok(text.includes("info Event queued: agent-message from foundry:agent:coder: Tests pass"));
  assert.ok(text.includes("info 1 event joined the conversation between tool steps"));
});
