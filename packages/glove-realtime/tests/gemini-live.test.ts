import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { GeminiLiveAdapter, geminiSchema } from "../src/adapters/gemini-live";
import type { RealtimeEvent } from "../src/types";
import { int16ToBase64 } from "../src/wire";
import { FakeSocket, tick } from "./fakes";

/** A fake Gemini that completes setup — over a BINARY frame, as the real one does. */
function setup(config: Partial<ConstructorParameters<typeof GeminiLiveAdapter>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const adapter = new GeminiLiveAdapter({
    getToken: () => "AIza-test",
    socketFactory: (url) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.setup) queueMicrotask(() => s.receive({ setupComplete: {} }, true));
      });
      sockets.push(socket);
      return socket;
    },
    ...config,
  });
  const events: RealtimeEvent[] = [];
  adapter.subscribe((event) => events.push(event));
  return { adapter, sockets, events, socket: () => sockets.at(-1)! };
}

const zodParams = z.toJSONSchema(z.object({ id: z.string(), note: z.string().nullable() })) as Record<string, unknown>;
const tools = [
  { name: "lookup", description: "Look up an order.", parameters: zodParams },
  { name: "research", description: "Slow research.", parameters: { type: "object", properties: {} }, behavior: "non_blocking" as const },
];

test("geminiSchema strips what Gemini rejects and maps nullable unions", () => {
  const schema = geminiSchema(zodParams);
  assert.equal("$schema" in schema, false);
  assert.equal("additionalProperties" in schema, false);
  const note = (schema.properties as any).note;
  assert.equal(note.nullable, true);
  assert.equal(note.type, "string");
  assert.equal("anyOf" in note, false);
});

test("setup carries tools, behavior, resumption and compression; open waits for setupComplete", async () => {
  const { adapter, socket, events } = setup({ voice: "Puck" });
  await adapter.open({ instructions: "Be brief.", tools });
  const s = socket();
  assert.match(s.url, /v1beta\.GenerativeService\.BidiGenerateContent\?key=AIza-test/);
  const setupFrame = s.sent[0].setup;
  assert.equal(setupFrame.model, "models/gemini-3.1-flash-live-preview");
  assert.deepEqual(setupFrame.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setupFrame.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
  assert.deepEqual(setupFrame.sessionResumption, {});
  assert.deepEqual(setupFrame.contextWindowCompression, { slidingWindow: {} });
  assert.equal(setupFrame.systemInstruction.parts[0].text, "Be brief.");
  const declarations = setupFrame.tools[0].functionDeclarations;
  assert.equal("$schema" in declarations[0].parameters, false);
  assert.equal(declarations[0].behavior, undefined);
  assert.equal(declarations[1].behavior, "NON_BLOCKING");
  assert.deepEqual(events.at(-1), { type: "session.opened", resumed: false });
});

test("text output drops audio-only setup", async () => {
  const { adapter, socket } = setup({ voice: "Puck" });
  await adapter.open({ output: "text" });
  const setupFrame = socket().sent[0].setup;
  assert.deepEqual(setupFrame.generationConfig.responseModalities, ["TEXT"]);
  assert.equal(setupFrame.generationConfig.speechConfig, undefined);
  assert.equal(setupFrame.outputAudioTranscription, undefined);
});

test("a setup the provider rejects fails open() with the close reason", async () => {
  const adapter = new GeminiLiveAdapter({
    getToken: () => "k",
    socketFactory: (url) => new FakeSocket(url, (message, s) => {
      if (message.setup) queueMicrotask(() => s.drop(1007, "Unknown name \"$schema\""));
    }),
  });
  await assert.rejects(adapter.open({}), /Unknown name "\$schema".*never started/);
});

test("history seeds an open client turn", async () => {
  const { adapter, socket } = setup();
  await adapter.open({ history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }, { role: "system", text: "vip" }] });
  const seed = socket().sent[1].clientContent;
  assert.equal(seed.turnComplete, false);
  assert.deepEqual(seed.turns.map((t: any) => [t.role, t.parts[0].text]), [["user", "hi"], ["model", "hello"], ["user", "[context] vip"]]);
});

test("resumption handles and goAway surface as session events", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  socket().receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } });
  socket().receive({ sessionResumptionUpdate: { newHandle: "h-not", resumable: false } });
  socket().receive({ goAway: { timeLeft: "12.5s" } });
  assert.equal(adapter.resumeHandle, "h1");
  assert.deepEqual(events.slice(-2), [{ type: "session.resumable", handle: "h1" }, { type: "session.going_away", timeLeftMs: 12500 }]);
});

test("setTools with a handle reconnects in place, resuming the conversation", async () => {
  const { adapter, sockets, socket, events } = setup();
  await adapter.open({ tools: [tools[0]] });
  socket().receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } });
  adapter.setTools(tools);
  adapter.setInstructions("New rules.");
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(sockets.length, 2, "one reconnect for both changes");
  const setupFrame = sockets[1].sent[0].setup;
  assert.deepEqual(setupFrame.sessionResumption, { handle: "h1" });
  assert.equal(setupFrame.tools[0].functionDeclarations.length, 2);
  assert.equal(setupFrame.systemInstruction.parts[0].text, "New rules.");
  assert.ok(!events.some((e) => e.type === "session.closed"), "a swap is not a close");
  assert.deepEqual(events.at(-1), { type: "session.opened", resumed: true });
  // The old socket is ignored from here on.
  sockets[0].receive({ toolCall: { functionCalls: [{ id: "stale", name: "lookup", args: {} }] } });
  assert.ok(!events.some((e) => e.type === "tool.call"));
});

test("setTools without a handle waits for the next session", async () => {
  const { adapter, sockets, events } = setup({ resumption: false });
  await adapter.open({});
  adapter.setTools(tools);
  await tick();
  assert.equal(sockets.length, 1);
  assert.ok(events.some((e) => e.type === "error" && /next session/.test(e.error.message)));
});

test("compact reconnects fresh, seeded with the summary", async () => {
  const { adapter, sockets, events } = setup();
  await adapter.open({});
  sockets[0].receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } });
  const outcome = await adapter.compact({ summary: "refund for order 42", recent: [{ role: "user", text: "quickly" }] });
  assert.equal(outcome, "reconnected");
  const fresh = sockets[1];
  assert.deepEqual(fresh.sent[0].setup.sessionResumption, {}, "no handle: the old turns must not come back");
  const seed = fresh.sent[1].clientContent.turns.map((t: any) => t.parts[0].text);
  assert.match(seed[0], /refund for order 42/);
  assert.equal(seed[1], "quickly");
  assert.ok(events.some((e) => e.type === "context.compacted"));
});

test("a turn: user transcript finalises when the model starts, usage reported once", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  events.length = 0;
  const s = socket();
  s.receive({ serverContent: { inputTranscription: { text: "where is " } } });
  s.receive({ serverContent: { inputTranscription: { text: "my order" } } });
  s.receive({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: int16ToBase64(new Int16Array(10)) } }] }, outputTranscription: { text: "On its way." } } });
  s.receive({ usageMetadata: { promptTokenCount: 800, responseTokenCount: 40, totalTokenCount: 840 } });
  s.receive({ usageMetadata: { promptTokenCount: 800, responseTokenCount: 50, totalTokenCount: 850 } });
  s.receive({ serverContent: { turnComplete: true } });

  const finals = events.filter((e) => e.type === "input.transcript" && e.final);
  assert.deepEqual(finals, [{ type: "input.transcript", text: "where is my order", final: true }]);
  assert.ok(events.some((e) => e.type === "output.transcript" && e.final && e.text === "On its way."));
  const usage = events.filter((e) => e.type === "usage");
  assert.equal(usage.length, 1);
  assert.equal((usage[0] as any).usage.contextTokens, 850);
  assert.equal(events.at(-2)?.type, "response.done");
});

test("interrupt mutes the rest of the turn", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({});
  const s = socket();
  const audio = { modelTurn: { parts: [{ inlineData: { data: int16ToBase64(new Int16Array(10)) } }] } };
  s.receive({ serverContent: audio });
  adapter.interrupt();
  events.length = 0;
  s.receive({ serverContent: audio });
  assert.equal(events.filter((e) => e.type === "output.audio").length, 0);
  s.receive({ serverContent: { turnComplete: true } });
  s.receive({ serverContent: audio });
  assert.equal(events.filter((e) => e.type === "output.audio").length, 1, "the next turn plays");
});

test("tool calls, cancellations, and scheduled non-blocking results", async () => {
  const { adapter, socket, events } = setup();
  await adapter.open({ tools });
  const s = socket();
  s.receive({ toolCall: { functionCalls: [{ id: "c1", name: "research", args: { q: "x" } }] } });
  s.receive({ toolCallCancellation: { ids: ["c1"] } });
  assert.ok(events.some((e) => e.type === "tool.call" && e.callId === "c1" && e.arguments === "{\"q\":\"x\"}"));
  assert.ok(events.some((e) => e.type === "tool.cancelled" && e.callIds[0] === "c1"));

  adapter.sendToolResult({ callId: "c2", name: "research", output: { ok: 1 } });
  adapter.sendToolResult({ callId: "c3", name: "lookup", output: { ok: 2 } });
  const [nonBlocking, blocking] = s.sent.filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0]);
  assert.equal(nonBlocking.scheduling, "WHEN_IDLE");
  assert.equal(nonBlocking.name, "research");
  assert.equal(blocking.scheduling, undefined);
});

test("text and media go through realtime input; silent context through an open client turn", async () => {
  const { adapter, socket } = setup();
  await adapter.open({});
  const s = socket();
  adapter.sendText("hello");
  adapter.sendMedia({ kind: "video", mimeType: "image/jpeg", data: "AAAA" });
  adapter.inject({ kind: "context", text: "vip customer" });
  adapter.inject({ kind: "user", text: "the worker finished" });
  const frames = s.sent.slice(1);
  assert.deepEqual(frames[0], { realtimeInput: { text: "hello" } });
  assert.deepEqual(frames[1], { realtimeInput: { video: { mimeType: "image/jpeg", data: "AAAA" } } });
  assert.equal(frames[2].clientContent.turnComplete, false);
  assert.equal(frames[2].clientContent.turns[0].parts[0].text, "[context] vip customer");
  assert.deepEqual(frames[3], { realtimeInput: { text: "the worker finished" } });
});
