import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAILiveAdapter } from "../src/adapters/openai-live";
import type { RealtimeEvent } from "../src/types";
import { FakeSocket } from "./fakes";

function setup() {
  const sockets: FakeSocket[] = [];
  const adapter = new OpenAILiveAdapter({
    getToken: () => "sk-test",
    socketFactory: (url, headers) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.type === "session.start") queueMicrotask(() => s.receive({ type: "session.started" }));
        if (message.type === "session.close") queueMicrotask(() => s.receive({ type: "session.closed", usage: { seconds: 42 } }));
      }, headers);
      sockets.push(socket);
      return socket;
    },
  });
  const events: RealtimeEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { adapter, events, socket: () => sockets.at(-1)! };
}

const tool = { name: "lookup", description: "Look up an order.", parameters: { type: "object", properties: {} } };

test("tools register on the Responses backend; auth is a header", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ instructions: "Be Nova.", tools: [tool] });
  assert.deepEqual(socket().extra, { Authorization: "Bearer sk-test" });
  const session = socket().ofType("session.start")[0].session;
  assert.equal(session.delegation.responses.tools[0].name, "lookup");
  assert.equal(session.delegation.responses.instructions, "Be Nova.");
});

test("a delegated batch continues once, after every result", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({ tools: [tool] });
  const s = socket();
  const envelope = (event: unknown) => s.receive({ type: "response.event", delegation_id: "d1", event });
  envelope({ type: "response.created", response: { id: "r1" } });
  envelope({ type: "response.output_item.done", item: { type: "function_call", call_id: "a", name: "lookup", arguments: "{}" } });
  envelope({ type: "response.output_item.done", item: { type: "function_call", call_id: "b", name: "lookup", arguments: "{}" } });
  envelope({ type: "response.completed", response: { id: "r1" } });
  assert.equal(events.filter((e) => e.type === "tool.call").length, 2);
  adapter.sendToolResult({ callId: "a", name: "lookup", output: 1 });
  assert.equal(s.ofType("response.create").length, 0);
  adapter.sendToolResult({ callId: "b", name: "lookup", output: 2 });
  assert.equal(s.ofType("response.create").length, 1);
});

test("context goes in as appends; media and compaction are declined", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ history: [{ role: "user", text: "earlier" }] });
  const s = socket();
  assert.match(s.ofType("session.thinking.append")[0].content, /user: earlier/);
  adapter.inject({ kind: "context", text: "vip" });
  adapter.inject({ kind: "user", text: "say this" });
  adapter.inject({ kind: "instruction", text: "be terse" });
  assert.equal(s.ofType("session.thinking.append").at(-1).content, "vip");
  assert.equal(s.ofType("session.commentary.append").at(-1).content, "say this");
  assert.equal(s.ofType("session.instructions.append").at(-1).content, "be terse");
  assert.throws(() => adapter.sendMedia({ kind: "image", mimeType: "image/png", data: "AA==" }), /audio and text only/);
  assert.equal(await adapter.compact(), "unsupported");
});

test("close waits for session.closed and reports final usage", async () => {
  const { adapter, events } = setup();
  await adapter.open({});
  await adapter.close();
  assert.ok(events.some((e) => e.type === "usage" && e.usage.seconds === 42 && e.usage.final));
  assert.deepEqual(events.at(-1), { type: "session.closed", expected: true });
});

test("continuous transcripts are fragments; interrupt mutes until the user speaks", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  adapter.interrupt();
  s.receive({ type: "session.output_audio.delta", delta: "AAAA" });
  assert.equal(events.filter((e) => e.type === "output.audio").length, 0);
  s.receive({ type: "session.input_transcript.delta", delta: "hey", start_ms: 0, end_ms: 300 });
  s.receive({ type: "session.output_audio.delta", delta: "AAAA" });
  assert.equal(events.filter((e) => e.type === "output.audio").length, 1);
  assert.ok(events.some((e) => e.type === "transcript.fragment" && e.role === "user" && e.text === "hey"));
});
