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

test("typed input reaches the backend and waits for outstanding function results", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ tools: [tool] });
  const s = socket();
  const envelope = (event: unknown) => s.receive({ type: "response.event", delegation_id: "d1", event });
  adapter.sendText("First request");
  assert.deepEqual(s.ofType("response.item.create")[0].item, {
    type: "message", role: "user", content: [{ type: "input_text", text: "First request" }],
  });
  assert.equal(s.ofType("session.thinking.append").at(-1).content, "The user typed: First request");
  assert.equal(s.ofType("session.commentary.append").length, 0);
  assert.equal(s.ofType("response.create").length, 1);
  envelope({ type: "response.created", response: { id: "r1" } });
  envelope({ type: "response.output_item.done", item: { type: "function_call", call_id: "a", name: "lookup", arguments: "{}" } });
  envelope({ type: "response.completed", response: { id: "r1" } });
  adapter.sendText("Correction while the tool runs");
  assert.equal(s.ofType("response.create").length, 1, "must not continue without the tool result");
  adapter.sendToolResult({ callId: "a", name: "lookup", output: "done" });
  assert.equal(s.ofType("response.create").length, 2, "tool output and queued input share one continuation");
  adapter.sendText("One more question");
  assert.equal(s.ofType("response.create").length, 2, "do not duplicate a requested continuation");
  envelope({ type: "response.created", response: { id: "r2" } });
  envelope({ type: "response.completed", response: { id: "r2" } });
  assert.equal(s.ofType("response.create").length, 3, "later input runs after backend completion");
  await adapter.close();
});

test("tools register on the Responses backend; auth is a header", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ instructions: "Be Nova.", tools: [tool] });
  assert.deepEqual(socket().extra, { Authorization: "Bearer sk-test" });
  const session = socket().ofType("session.start")[0].session;
  assert.equal(session.delegation.responses.tools[0].name, "lookup");
  assert.equal(session.delegation.responses.instructions, "Be Nova.");
});

test("OpenAI Live normalizes root unions at its provider boundary", async () => {
  const { adapter, socket } = setup();
  const union = { ...tool, parameters: { anyOf: [
    { type: "object", properties: { action: { const: "list" } }, required: ["action"] },
    { type: "object", properties: { action: { const: "cancel" }, id: { type: "string" } }, required: ["action", "id"] },
  ] } };
  await adapter.open({ tools: [union] });
  const parameters = socket().ofType("session.start")[0].session.delegation.responses.tools[0].parameters;
  assert.equal(parameters.type, "object");
  assert.equal("anyOf" in parameters, false);
  assert.deepEqual(parameters.required, ["action"]);
  assert.ok(union.parameters.anyOf);
  await adapter.close();
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

test("GPT-Live session refreshes context at host speech boundaries and exposes overlapping captions", async () => {
  const { Glove, Displaymanager, MemoryStore } = await import("glove-core");
  const { realtimeModel } = await import("../src/create-adapter");
  const { RealtimeSession } = await import("../src/session");
  const { tick } = await import("./fakes");
  const { adapter, socket } = setup();
  const store = new MemoryStore("live-context");
  const agent = new Glove({
    model: realtimeModel({ provider: "openai-live", apiKey: "sk-test" }),
    store,
    displayManager: new Displaymanager(),
    systemPrompt: "Help the caller.",
    compaction_config: { compaction_instructions: "summarize" },
  }).build();
  let prepared = 0;
  let state = "initial";
  agent.addTurnPreparer(() => { prepared++; });
  agent.addContextProvider(() => `request: ${state}`, { delivery: "request" });
  agent.addContextProvider(() => `plan: ${state}`, { delivery: "history", key: "plan" });
  const session = new RealtimeSession({ agent, adapter });
  const captions: RealtimeEvent[] = [];
  session.on("transcript", (fragment) => captions.push(fragment));
  await session.start();
  const s = socket();
  const context = () => s.ofType("session.thinking.append").map((m) => m.content).join("\n");
  assert.match(context(), /request: initial/);
  assert.equal(prepared, 1);

  state = "verified";
  await session.notifyUserSpeech(true);
  await session.notifyUserSpeech(true); // repeated VAD state is not another turn
  assert.equal(prepared, 2);
  assert.match(context(), /request: verified/);
  assert.match(context(), /plan: verified/);
  s.receive({ type: "session.input_transcript.delta", delta: "I need", start_ms: 100, end_ms: 500 });
  s.receive({ type: "session.output_transcript.delta", delta: "Sure", start_ms: 200, end_ms: 350 });
  s.receive({ type: "session.input_transcript.delta", delta: " help", start_ms: 500, end_ms: 700 });
  assert.deepEqual(captions.map((e: any) => [e.role, e.text, e.startMs, e.endMs]), [
    ["user", "I need", 100, 500], ["assistant", "Sure", 200, 350], ["user", " help", 500, 700],
  ]);
  assert.equal(prepared, 2, "neither fragments nor speaker changes invent turn boundaries");

  await agent.emitEvent({ id: "payment", source: "app", content: "Payment received" });
  await tick();
  assert.ok(!context().includes("Payment received"), "events wait while the caller speaks");
  await session.notifyUserSpeech(false);
  session.notifyPlayback(true);
  session.notifyPlayback(false);
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(s.ofType("session.commentary.append").some((m) => m.content.includes("Payment received")));

  state = "typed";
  await session.say("Here is the reference");
  assert.equal(prepared, 3);
  assert.match(context(), /request: typed/);
  const typed = s.sent.findIndex((m) => m.type === "response.item.create" && m.item.content?.[0]?.text === "Here is the reference");
  const refreshed = s.sent.findIndex((m) => m.type === "session.thinking.append" && m.content.includes("request: typed"));
  assert.ok(refreshed >= 0 && refreshed < typed);

  let audio = 0;
  session.on("audio", () => { audio++; });
  session.interrupt();
  s.receive({ type: "session.output_audio.delta", delta: "AAAA" });
  assert.equal(audio, 0);
  session.resumeOutput();
  s.receive({ type: "session.output_audio.delta", delta: "AAAA" });
  assert.equal(audio, 1);
  assert.ok(!s.sent.some((m) => m.type === "response.cancel" || m.type === "input_audio_buffer.commit"));
  await session.stop();
  assert.equal((await store.getMessages()).filter((m) => m.context_key === "plan").length, 3);
});

test("a GPT-Live finalization failure rejects session.stop and releases Glove's turn queue", async () => {
  const { Glove, Displaymanager } = await import("glove-core");
  const { RealtimeSession } = await import("../src/session");
  const agent = new Glove({
    model: { name: "text", setSystemPrompt() {}, async prompt() {
      return { messages: [{ sender: "agent" as const, text: "ok" }], tokens_in: 0, tokens_out: 0 };
    } },
    displayManager: new Displaymanager(), systemPrompt: "Help.",
    compaction_config: { compaction_instructions: "summarize" },
  }).build();
  const adapter = new OpenAILiveAdapter({
    getToken: () => "sk-test",
    socketFactory: (url) => new FakeSocket(url, (message, s) => {
      if (message.type === "session.start") queueMicrotask(() => s.receive({ type: "session.started" }));
      if (message.type === "session.close") queueMicrotask(() => s.drop());
    }),
  });
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await assert.rejects(session.stop(), /final usage is unconfirmed/);
  assert.equal(session.state, "closed");
  const hold = await agent.holdTurns();
  await hold.release();
});

test("concurrent stops wait for the same GPT-Live final usage", async () => {
  const { Glove, Displaymanager } = await import("glove-core");
  const { RealtimeSession } = await import("../src/session");
  const { realtimeModel } = await import("../src/create-adapter");
  const { tick } = await import("./fakes");
  let socket!: FakeSocket;
  const adapter = new OpenAILiveAdapter({
    getToken: () => "sk-test",
    socketFactory: (url) => socket = new FakeSocket(url, (message, s) => {
      if (message.type === "session.start") queueMicrotask(() => s.receive({ type: "session.started" }));
    }),
  });
  const agent = new Glove({
    model: realtimeModel({ provider: "openai-live", apiKey: "sk-test" }),
    displayManager: new Displaymanager(), systemPrompt: "Help.",
    compaction_config: { compaction_instructions: "summarize" },
  }).build();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  const first = session.stop();
  const second = session.stop();
  assert.equal(first, second);
  let stopped = false;
  void second.then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  socket.receive({ type: "session.closed", usage: { seconds: 8 } });
  await Promise.all([first, second]);
  assert.equal(stopped, true);
  assert.equal(socket.ofType("session.close").length, 1);
});

test("GPT-Live backend tools use Glove permissions and refresh iteration context before continuing", async () => {
  const { Glove, Displaymanager, MemoryStore } = await import("glove-core");
  const { RealtimeSession } = await import("../src/session");
  const { realtimeModel } = await import("../src/create-adapter");
  const { z } = await import("zod");
  const { tick } = await import("./fakes");
  const { adapter, socket } = setup();
  let updates = 0;
  let requestReads = 0;
  const store = new MemoryStore("live-tools");
  const agent = new Glove({
    model: realtimeModel({ provider: "openai-live", apiKey: "sk-test" }),
    store, displayManager: new Displaymanager(), systemPrompt: "Help.",
    compaction_config: { compaction_instructions: "summarize" },
  }).fold({
    name: "update_order", description: "Update the order.", inputSchema: z.object({ confirmed: z.boolean() }),
    requiresPermission: async ({ confirmed }) => !confirmed,
    async do() {
      updates++;
      return { status: "success", data: "updated", renderData: { secret: "client-only" } };
    },
  }).build();
  agent.addContextProvider(() => `updates: ${updates}`);
  agent.addContextProvider(() => `request read: ${++requestReads}`, { delivery: "request" });
  const session = new RealtimeSession({ agent, adapter, permissions: "deny" });
  await session.start();
  const s = socket();
  const call = async (id: string, confirmed: boolean) => {
    const envelope = (event: unknown) => s.receive({ type: "response.event", delegation_id: "d1", event });
    envelope({ type: "response.created", response: { id } });
    envelope({ type: "response.output_item.done", item: { type: "function_call", call_id: id, name: "update_order", arguments: JSON.stringify({ confirmed }) } });
    envelope({ type: "response.completed", response: { id } });
    for (let i = 0; i < 12; i++) await tick();
    return JSON.parse(s.ofType("response.item.create").at(-1).item.output);
  };
  assert.equal((await call("denied", false)).status, "error");
  assert.equal(updates, 0);
  const result = await call("allowed", true);
  assert.equal(result.status, "success");
  assert.equal("renderData" in result, false);
  assert.equal(updates, 1);
  assert.equal(requestReads, 1, "request context stays frozen through tool steps");
  const context = s.sent.findIndex((m) => m.type === "session.thinking.append" && m.content.includes("updates: 1"));
  const output = s.sent.findIndex((m) => m.type === "response.item.create" && m.item.call_id === "allowed");
  assert.ok(context >= 0 && context < output);
  assert.equal(s.ofType("response.create").length, 2, "each backend batch continues exactly once");
  await session.stop();
  assert.equal((await store.getMessages()).filter((m) => m.tool_results?.length).length, 2);
});
