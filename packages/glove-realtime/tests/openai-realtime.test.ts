import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAIRealtimeAdapter } from "../src/adapters/openai-realtime";
import type { RealtimeEvent } from "../src/types";
import { int16ToBase64 } from "../src/wire";
import { FakeSocket, tick } from "./fakes";

/** An adapter on a fake provider that acknowledges every session.update. */
function setup(config: Partial<ConstructorParameters<typeof OpenAIRealtimeAdapter>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const adapter = new OpenAIRealtimeAdapter({
    getToken: () => "sk-test",
    socketFactory: (url, protocols) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.type === "session.update") queueMicrotask(() => s.receive({ type: "session.updated", session: {} }));
      }, protocols);
      sockets.push(socket);
      return socket;
    },
    ...config,
  });
  const events: RealtimeEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { adapter, sockets, events, socket: () => sockets.at(-1)! };
}

const tools = [{ name: "lookup", description: "Look up an order.", parameters: { type: "object", properties: { id: { type: "string" } } } }];

test("OpenAI normalizes root unions on initial and updated tool definitions", async () => {
  const { adapter, socket } = setup();
  const union = { ...tools[0], parameters: { anyOf: [
    { type: "object", properties: { action: { const: "list" } }, required: ["action"] },
    { type: "object", properties: { action: { const: "cancel" }, id: { type: "string" } }, required: ["action", "id"] },
  ] } };
  await adapter.open({ tools: [union] });
  adapter.setTools([union]);
  for (const update of socket().ofType("session.update")) {
    assert.equal(update.session.tools[0].parameters.type, "object");
    assert.equal("anyOf" in update.session.tools[0].parameters, false);
    assert.deepEqual(update.session.tools[0].parameters.required, ["action"]);
  }
  assert.ok(union.parameters.anyOf, "the original tool spec stays intact");
  await adapter.close();
});

test("open sends the full session and resolves on session.updated", async () => {
  const { adapter, socket, events } = setup({ voice: "marin" });
  await adapter.open({ instructions: "Be brief.", tools, output: "audio" });

  const s = socket();
  assert.match(s.url, /model=gpt-realtime/);
  assert.deepEqual(s.extra, ["realtime", "openai-insecure-api-key.sk-test"]);
  const update = s.ofType("session.update")[0].session;
  assert.equal(update.instructions, "Be brief.");
  assert.deepEqual(update.output_modalities, ["audio"]);
  assert.equal(update.tools[0].type, "function");
  assert.equal(update.tools[0].name, "lookup");
  assert.equal(update.audio.output.voice, "marin");
  assert.deepEqual(update.audio.input.turn_detection, { type: "semantic_vad" });
  assert.equal(update.audio.input.transcription.model, "gpt-4o-mini-transcribe");
  assert.equal(adapter.isOpen, true);
  assert.deepEqual(events.at(-1), { type: "session.opened", resumed: false });
});

test("a rejected setup fails open() with the provider's message", async () => {
  const adapter = new OpenAIRealtimeAdapter({
    getToken: () => "sk",
    socketFactory: (url) => new FakeSocket(url, (message, s) => {
      if (message.type === "session.update") queueMicrotask(() => s.receive({ type: "error", error: { message: "Invalid tool schema" } }));
    }),
  });
  await assert.rejects(adapter.open({}), /Invalid tool schema/);
  assert.equal(adapter.isOpen, false);
});

test("history seeds the conversation with role-appropriate content", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }, { role: "system", text: "note" }] });
  const items = socket().ofType("conversation.item.create").map((m) => m.item);
  assert.deepEqual(items.map((i) => [i.role, i.content[0].type, i.content[0].text]), [
    ["user", "input_text", "hi"],
    ["assistant", "output_text", "hello"],
    ["system", "input_text", "note"],
  ]);
});

test("a keyed injection supersedes the previous one", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  adapter.inject({ kind: "context", key: "rt", text: "v1" });
  const first = socket().ofType("conversation.item.create").at(-1).item;
  assert.equal(first.role, "system");
  adapter.inject({ kind: "context", key: "rt", text: "v2" });
  assert.deepEqual(socket().ofType("conversation.item.delete").map((m) => m.item_id), [first.id]);
  assert.equal(socket().ofType("response.create").length, 0, "context is silent by default");
  adapter.inject({ kind: "user", text: "relay this" });
  assert.equal(socket().ofType("response.create").length, 1, "user injections ask for a response");
});

test("compact deletes every item and puts the summary back in place", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  s.receive({ type: "conversation.item.added", item: { id: "item_a" } });
  s.receive({ type: "conversation.item.added", item: { id: "item_b" } });
  const outcome = await adapter.compact({ summary: "they want a refund", recent: [{ role: "user", text: "and fast" }] });
  assert.equal(outcome, "in_place");
  assert.deepEqual(s.ofType("conversation.item.delete").map((m) => m.item_id), ["item_a", "item_b"]);
  const created = s.ofType("conversation.item.create").map((m) => m.item.content[0].text);
  assert.match(created.at(-2), /they want a refund/);
  assert.equal(created.at(-1), "and fast");
  assert.ok(events.some((e) => e.type === "context.compacted" && e.mode === "in_place"));
});

test("summarize runs out of band and never surfaces as output", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  const summary = adapter.summarize("Summarize.");
  const request = s.ofType("response.create").at(-1).response;
  assert.equal(request.conversation, "none");
  assert.deepEqual(request.output_modalities, ["text"]);
  const tag = request.metadata.glove_request;
  s.receive({ type: "response.created", response: { id: "resp_oob", metadata: { glove_request: tag } } });
  s.receive({ type: "response.output_text.delta", response_id: "resp_oob", delta: "secret" });
  s.receive({
    type: "response.done",
    response: { id: "resp_oob", status: "completed", metadata: { glove_request: tag }, output: [{ content: [{ type: "output_text", text: "the summary" }] }], usage: { input_tokens: 10, output_tokens: 3 } },
  });
  assert.equal(await summary, "the summary");
  assert.ok(!events.some((e) => e.type === "output.text" || e.type === "response.started" || e.type === "response.done"));
  assert.ok(events.some((e) => e.type === "usage"), "the summary is still billed");
});

test("provider events map onto the standard stream", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  events.length = 0;
  s.receive({ type: "response.created", response: { id: "r1" } });
  s.receive({ type: "response.output_audio.delta", item_id: "i1", delta: int16ToBase64(new Int16Array(240)) });
  s.receive({ type: "response.output_audio_transcript.delta", delta: "Hel" });
  s.receive({ type: "response.output_audio_transcript.done", transcript: "Hello" });
  s.receive({ type: "response.function_call_arguments.done", call_id: "c1", name: "lookup", arguments: "{\"id\":\"42\"}" });
  s.receive({ type: "response.done", response: { id: "r1", status: "completed", usage: { input_tokens: 900, output_tokens: 100, input_token_details: { cached_tokens: 500, audio_tokens: 700 } } } });

  assert.deepEqual(events.map((e) => e.type), [
    "response.started", "output.speech_started", "output.audio", "output.transcript", "output.transcript",
    "tool.call", "output.speech_stopped", "response.done", "usage",
  ]);
  const usage = events.find((e) => e.type === "usage") as Extract<RealtimeEvent, { type: "usage" }>;
  assert.equal(usage.usage.contextTokens, 1000);
  assert.equal(usage.usage.cachedTokensIn, 500);
  assert.equal(usage.usage.byModality?.in?.audio, 700);
});

test("user speech is a barge-in: cancel, sync to what was heard, flush", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  s.receive({ type: "response.output_audio.delta", item_id: "i1", delta: int16ToBase64(new Int16Array(24_000 * 5)) });
  events.length = 0;
  s.receive({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(events.map((e) => e.type), ["input.speech_started", "interrupted", "output.speech_stopped"]);
  assert.equal(s.ofType("response.cancel").length, 1);
  const truncate = s.ofType("conversation.item.truncate")[0];
  assert.equal(truncate.item_id, "i1");
  assert.ok(truncate.audio_end_ms < 5000);
});

test("barge-in stays off when turn detection says so", async () => {
  const { adapter, socket, events } = setup({ turnDetection: { type: "semantic_vad", interrupt_response: false } });
  await adapter.open({});
  events.length = 0;
  socket().receive({ type: "input_audio_buffer.speech_started" });
  assert.deepEqual(events.map((e) => e.type), ["input.speech_started"]);
  assert.equal(socket().ofType("response.cancel").length, 0);
});

test("images become input_image items; video is refused", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  adapter.sendMedia({ kind: "image", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) });
  const item = socket().ofType("conversation.item.create").at(-1).item;
  assert.equal(item.content[0].type, "input_image");
  assert.equal(item.content[0].image_url, "data:image/png;base64,AQID");
  assert.throws(() => adapter.sendMedia({ kind: "video", mimeType: "image/jpeg", data: "AA==" }), /no video input/);
});

test("a dropped socket reports an unexpected close; close() an expected one", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  socket().drop(1006, "gone");
  await tick();
  assert.deepEqual(events.at(-1), { type: "session.closed", expected: false, reason: "gone" });
  await adapter.open({});
  await adapter.close();
  assert.deepEqual(events.at(-1), { type: "session.closed", expected: true, reason: "closed by client" });
});

test("tool results continue the conversation unless told not to", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  adapter.sendToolResult({ callId: "c1", name: "lookup", output: { status: "success", data: 1 } });
  adapter.sendToolResult({ callId: "c2", name: "lookup", output: "quiet", respond: false });
  const outputs = socket().ofType("conversation.item.create").map((m) => m.item).filter((i) => i.type === "function_call_output");
  assert.deepEqual(outputs.map((o) => [o.call_id, o.output]), [["c1", "{\"status\":\"success\",\"data\":1}"], ["c2", "quiet"]]);
  assert.equal(socket().ofType("response.create").length, 1);
});

test("typed input and spontaneous responses coalesce until the active response is done", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ output: "text" });
  const s = socket();
  adapter.sendText("first");
  adapter.sendText("second before server acknowledgement");
  assert.equal(s.ofType("response.create").length, 1);
  s.receive({ type: "response.created", response: { id: "r1" } });
  s.receive({ type: "response.output_text.done", text: "first answer" });
  adapter.inject({ kind: "user", text: "worker finding" });
  adapter.respond();
  assert.equal(s.ofType("response.create").length, 1, "final text is not response.done");
  s.receive({ type: "response.done", response: { id: "r1", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 2);
  s.receive({ type: "response.created", response: { id: "r2" } });
  s.receive({ type: "response.done", response: { id: "r2", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 2, "no extra empty continuation");
  await adapter.close();
});

test("queued user input waits for every tool result and shares the tool continuation", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  const s = socket();
  s.receive({ type: "response.created", response: { id: "r1" } });
  for (const callId of ["a", "b"]) s.receive({ type: "response.function_call_arguments.done", response_id: "r1", call_id: callId, name: "lookup", arguments: "{}" });
  adapter.sendText("update the task");
  s.receive({ type: "response.done", response: { id: "r1", status: "completed" } });
  adapter.sendToolResult({ callId: "a", name: "lookup", output: "first" });
  assert.equal(s.ofType("response.create").length, 0);
  adapter.sendToolResult({ callId: "b", name: "lookup", output: "second" });
  assert.equal(s.ofType("response.create").length, 1);
  await adapter.close();
  await adapter.open({});
  adapter.sendText("new session");
  assert.equal(socket().ofType("response.create").length, 1, "close clears response state");
  await adapter.close();
});

test("only a matching response.create rejection releases the reservation", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  adapter.sendText("first");
  const rejected = s.ofType("response.create")[0];
  assert.equal(typeof rejected.event_id, "string");
  adapter.sendText("queued");
  s.receive({ type: "error", error: { event_id: "unrelated", code: "invalid_value", message: "other request failed" } });
  assert.equal(s.ofType("response.create").length, 1);
  s.receive({ type: "error", error: { event_id: rejected.event_id, code: "invalid_value", message: "create rejected" } });
  assert.equal(s.ofType("response.create").length, 2, "queued work survives rejection");
  const next = s.ofType("response.create")[1];
  assert.notEqual(next.event_id, rejected.event_id);
  s.receive({ type: "error", error: { event_id: next.event_id, code: "invalid_value", message: "next rejected" } });
  assert.equal(s.ofType("response.create").length, 2, "a rejected request is not retried forever");
  adapter.sendText("later input");
  assert.equal(s.ofType("response.create").length, 3);
  const accepted = s.ofType("response.create")[2];
  s.receive({ type: "response.created", response: { id: "accepted" } });
  adapter.sendToolResult({ callId: "late-tool", name: "lookup", output: "ready" });
  s.receive({ type: "error", error: { event_id: accepted.event_id, code: "invalid_value", message: "stale rejection after acceptance" } });
  assert.equal(s.ofType("response.create").length, 3, "a stale error cannot release an accepted response");
  s.receive({ type: "response.done", response: { id: "accepted", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 4, "tool continuations still proceed");
  assert.ok(events.some((event) => event.type === "error"));
  assert.equal(adapter.isOpen, true);
  await adapter.close();
});

for (const createdBeforeTimeout of [true, false]) test(`late summary completion is isolated (created before timeout: ${createdBeforeTimeout})`, async () => {
  const { adapter, socket, events } = setup({ summarizeTimeoutMs: 5 });
  await adapter.open({});
  const s = socket();
  const summary = adapter.summarize("Summarize.");
  const tag = s.ofType("response.create")[0].response.metadata.glove_request;
  const created = { type: "response.created", response: { id: "summary", metadata: { glove_request: tag } } };
  if (createdBeforeTimeout) s.receive(created);
  await assert.rejects(summary, /summary timed out/);
  adapter.sendText("normal response");
  s.receive({ type: "response.created", response: { id: "normal" } });
  adapter.respond();
  events.length = 0;
  if (!createdBeforeTimeout) s.receive(created);
  s.receive({ type: "response.output_text.delta", response_id: "summary", delta: "private summary" });
  s.receive({ type: "response.done", response: { id: "summary", metadata: { glove_request: tag }, status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } });
  assert.equal(s.ofType("response.create").length, 2, "the active conversation response still owns its reservation");
  assert.deepEqual(events.map((event) => event.type), ["usage"], "late summaries never become conversation output");
  s.receive({ type: "response.done", response: { id: "normal", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 3);
  await adapter.close();
});

test("barge-in holds queued responses through speech stop and the automatic VAD response", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  const s = socket();
  adapter.sendText("first");
  s.receive({ type: "response.created", response: { id: "first" } });
  adapter.respond();
  s.receive({ type: "input_audio_buffer.speech_started" });
  s.receive({ type: "response.done", response: { id: "first", status: "cancelled", status_details: { reason: "turn_detected" } } });
  assert.equal(s.ofType("response.create").length, 1, "do not talk over the user");
  s.receive({ type: "input_audio_buffer.speech_stopped" });
  assert.equal(s.ofType("response.create").length, 1, "VAD will create the next response");
  s.receive({ type: "response.created", response: { id: "vad" } });
  adapter.respond();
  assert.equal(s.ofType("response.create").length, 1);
  s.receive({ type: "response.done", response: { id: "vad", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 2, "queued work resumes after the VAD response");
  await adapter.close();
});

test("manual VAD responses resume after speech stops and speech state resets on reopen", async () => {
  const { adapter, socket } = setup({ turnDetection: { type: "server_vad", create_response: false } });
  await adapter.open({});
  const s = socket();
  s.receive({ type: "input_audio_buffer.speech_started" });
  adapter.sendText("queued while speaking");
  assert.equal(s.ofType("response.create").length, 0);
  s.receive({ type: "input_audio_buffer.speech_stopped" });
  assert.equal(s.ofType("response.create").length, 1);
  s.receive({ type: "input_audio_buffer.speech_started" });
  await adapter.close();
  await adapter.open({});
  adapter.sendText("new session");
  assert.equal(socket().ofType("response.create").length, 1);
  await adapter.close();
});

test("non-interrupting VAD does not wait forever for an automatic response skipped by the active response", async () => {
  const { adapter, socket } = setup({ turnDetection: { type: "semantic_vad", interrupt_response: false } });
  await adapter.open({});
  const s = socket();
  s.receive({ type: "response.created", response: { id: "active" } });
  adapter.respond();
  s.receive({ type: "input_audio_buffer.speech_started" });
  s.receive({ type: "input_audio_buffer.speech_stopped" });
  assert.equal(s.ofType("response.create").length, 0);
  s.receive({ type: "response.done", response: { id: "active", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 1);
  await adapter.close();
});
