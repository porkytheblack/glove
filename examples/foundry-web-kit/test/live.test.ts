import assert from "node:assert/strict";
import { test } from "node:test";
import { liveRun, reduceEvent } from "../src/server/live";
import { displayMessages } from "../src/server/messages";

// Events the way Foundry records them for one run, secrets and all.
const events = [
  { sequence: 1, type: "run.started", data: {} },
  { sequence: 2, type: "agent.model_request", data: { system_prompt: { text: "You are Inbox Manager. SECRET PROMPT" }, model: "claude" } },
  { sequence: 3, type: "log.stderr", data: { message: "token=abc" } },
  { sequence: 4, type: "agent.text_delta", data: { text: "Hi " } },
  { sequence: 5, type: "agent.text_delta", data: { text: "Maya." } },
  { sequence: 6, type: "agent.tool_use", data: { id: "call-1", name: "glove_mesh_send_message", input: { to: "maya-bot-1", content: "PRIVATE" } } },
  { sequence: 7, type: "agent.foundry.approval.requested", data: { id: "approval-1", toolName: "glove_app_gmail__gmail_send", toolInput: { payload: { body: "PRIVATE BODY" } }, workspaceId: "maya" } },
  { sequence: 8, type: "approval.resolved", data: { approvalId: "approval-1", toolName: "glove_app_gmail__gmail_send", decision: "approve", status: "approved" } },
  { sequence: 9, type: "agent.foundry.core.command", data: { type: "transmit", payload: { to: "dan@contoso.example" } } },
  { sequence: 10, type: "agent.tool_use_result", data: { tool_name: "glove_mesh_send_message", name: "glove_mesh_send_message", result: { status: "success", data: { reply: "PRIVATE RESULT" } } } },
  { sequence: 11, type: "run.completed", data: { output: "{\"value\":\"PRIVATE OUTPUT\"}" } },
  { sequence: 12, type: "agent.text_delta", data: { text: "after the end" } },
];

test("only whitelisted events pass, cut down to their listed fields", () => {
  const reduced = events.map((event) => reduceEvent(event)).filter(Boolean);
  assert.deepEqual(reduced, [
    { seq: 1, type: "run.started" },
    { seq: 4, type: "agent.text_delta", text: "Hi " },
    { seq: 5, type: "agent.text_delta", text: "Maya." },
    { seq: 6, type: "agent.tool_use", name: "glove_mesh_send_message" },
    { seq: 7, type: "agent.foundry.approval.requested", approvalId: "approval-1", toolName: "glove_app_gmail__gmail_send" },
    { seq: 8, type: "approval.resolved", approvalId: "approval-1", status: "approved" },
    { seq: 10, type: "agent.tool_use_result", name: "glove_mesh_send_message", status: "done" },
    { seq: 11, type: "run.completed" },
    { seq: 12, type: "agent.text_delta", text: "after the end" },
  ]);
  assert.doesNotMatch(JSON.stringify(reduced), /SECRET|PRIVATE|token=|dan@/);
});

test("a tool label is worked out on the server; its input is not sent", () => {
  const reduced = reduceEvent(events[5]!, { describeTool: (name, input) => name === "glove_mesh_send_message" ? { label: `Handed to ${(input as { to: string }).to === "maya-bot-1" ? "Sales Outbound" : "a sibling"}`, chip: true } : undefined });
  assert.deepEqual(reduced, { seq: 6, type: "agent.tool_use", name: "glove_mesh_send_message", label: "Handed to Sales Outbound", chip: true });
});

function sse(lines: ReadonlyArray<unknown>): ReadableStream<Uint8Array> {
  const text = [": glove-foundry\n\n", ...lines.map((event) => `id: ${(event as { sequence: number }).sequence}\ndata: ${JSON.stringify(event)}\n\n`)].join("");
  const bytes = new TextEncoder().encode(text);
  // Split mid-event, the way a network delivers it.
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += 37) controller.enqueue(bytes.slice(at, at + 37));
      controller.close();
    },
  });
}

test("the live relay streams the whitelist and ends with the run", async () => {
  let asked = "";
  const response = await liveRun("run-1", {
    after: 0,
    client: { getRun: async () => ({ status: "running" }) } as never,
    fetch: (async (url: string, init: RequestInit) => {
      asked = `${url} ${new Headers(init.headers).get("accept")}`;
      return new Response(sse(events));
    }) as never,
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const body = await response.text();
  assert.match(asked, /\/api\/events\?runId=run-1&after=0 text\/event-stream/);
  const sent = body.split("\n\n").filter((block) => block.startsWith("id:")).map((block) => JSON.parse(block.split("\ndata: ")[1]!));
  assert.deepEqual(sent.map((event) => event.type), [
    "run.started", "agent.text_delta", "agent.text_delta", "agent.tool_use",
    "agent.foundry.approval.requested", "approval.resolved", "agent.tool_use_result", "run.completed",
  ], "nothing after the run's end");
  assert.match(body, /^id: 1\n/m, "ids let EventSource resume");
  assert.doesNotMatch(body, /SECRET|PRIVATE|token=|dan@/);
});

test("a run that already ended replays what is left and says how it ended", async () => {
  const response = await liveRun("run-1", {
    after: 4,
    client: {
      getRun: async () => ({ status: "completed" }),
      getEvents: async ({ after }: { after: number }) => events.filter((event) => event.sequence > after && event.sequence < 11),
    } as never,
  });
  const types = (await response.text()).split("\n\n").filter((block) => block.startsWith("id:")).map((block) => JSON.parse(block.split("\ndata: ")[1]!).type);
  assert.deepEqual(types, ["agent.text_delta", "agent.tool_use", "agent.foundry.approval.requested", "approval.resolved", "agent.tool_use_result", "run.completed"]);
});

test("a transcript becomes display messages without tool input, results or framework turns", () => {
  const messages = displayMessages({
    page: { offset: 10 },
    messages: [
      { sender: "user", text: "Anything urgent?" },
      { sender: "user", text: "runtime state", framework_context: "runtime" },
      { sender: "agent", text: "", tool_calls: [{ tool_name: "execute_js", input_args: { code: "gmail.search_threads({})" }, id: "c1" }] },
      { sender: "user", text: "tool results", tool_results: [{ tool_name: "execute_js", call_id: "c1", result: { status: "success" } }] },
      { sender: "agent", text: "Two things." },
      { sender: "user", text: '<transmission direction="inbound" definition="gmail" route="r" event="mail-received" event-id="m"><payload>{}</payload></transmission>' },
      { sender: "agent", text: "", tool_calls: [{ tool_name: "glove_app_gmail__gmail_send", input_args: { payload: { body: "PRIVATE" } }, id: "c2" }] },
    ],
  }, { describeTool: (name) => name === "execute_js" ? "Read Gmail in one program" : undefined });
  assert.deepEqual(messages, [
    { id: "10", sender: "person", text: "Anything urgent?" },
    { id: "14", sender: "agent", text: "Two things.", tools: [{ name: "execute_js", status: "done", label: "Read Gmail in one program" }] },
    { id: "15", sender: "event", text: "gmail · mail-received" },
    { id: "17", sender: "agent", text: "", tools: [{ name: "glove_app_gmail__gmail_send", status: "running" }] },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE|search_threads/);
});
