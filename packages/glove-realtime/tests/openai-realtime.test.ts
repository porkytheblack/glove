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
