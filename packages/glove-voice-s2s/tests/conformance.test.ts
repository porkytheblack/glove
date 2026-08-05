// Every provider adapter runs the same suite against a fake socket.
//
// This is what makes "swap the provider" a claim rather than a hope: the
// adapters share no code, so the only thing guaranteeing they behave alike is
// a test that treats them identically.

import { test } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import { runConformance, type ConformanceContext } from "../src/conformance";
import { GeminiLiveAdapter, type WebSocketLike } from "../src/gemini-live";

/** A socket that records what was sent and lets a test push frames back. */
class FakeSocket extends EventEmitter implements WebSocketLike {
  readyState = 1;
  sent: unknown[] = [];
  private handlers = new Map<string, Array<(ev: any) => void>>();

  send(data: string | ArrayBufferLike) {
    this.sent.push(typeof data === "string" ? JSON.parse(data) : data);
  }
  close() {
    this.fire("close", {});
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    // The adapter attaches "open" after construction, so fire it on the next
    // tick — mirroring a real socket, and catching adapters that assume the
    // handler was registered before the connection completed.
    if (type === "open") queueMicrotask(() => fn({}));
  }
  fire(type: string, ev: unknown) {
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }
}

function geminiContext(): ConformanceContext {
  const socket = new FakeSocket();
  const adapter = new GeminiLiveAdapter({
    getToken: () => "test-token",
    socketFactory: () => socket,
  });
  return {
    adapter,
    inbound: (message) => socket.fire("message", { data: JSON.stringify(message) }),
    outbound: () => socket.sent,
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

test("GeminiLiveAdapter passes the S2S conformance suite", async () => {
  const results = await runConformance(geminiContext);
  const failed = results.filter((r) => !r.passed);
  assert.equal(
    failed.length,
    0,
    `\n${failed.map((f) => f.error).join("\n\n")}`,
  );
  assert.ok(results.length >= 8, `only ${results.length} cases ran`);
});

test("Gemini setup frame carries model, instructions and function declarations", async () => {
  const ctx = geminiContext();
  await ctx.adapter.connect({
    instructions: "You are Nova.",
    voice: "Puck",
    tools: [{ name: "lookup", description: "d", parameters: { type: "object", properties: {} } }],
  });
  await ctx.settle();

  const setup = (ctx.outbound()[0] as any).setup;
  assert.ok(setup, "first frame must be `setup` — Gemini rejects anything else");
  assert.match(setup.model, /^models\//);
  assert.equal(setup.systemInstruction.parts[0].text, "You are Nova.");
  assert.equal(setup.tools[0].functionDeclarations[0].name, "lookup");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  // Without these the host has no transcript of the call at all.
  assert.ok(setup.inputAudioTranscription);
  assert.ok(setup.outputAudioTranscription);
});

test("Gemini audio in is tagged 16 kHz while output is declared 24 kHz", async () => {
  const ctx = geminiContext();
  await ctx.adapter.connect({});
  await ctx.settle();

  ctx.adapter.sendAudio(Int16Array.from([1, 2, 3, 4]));
  const frame = ctx.outbound().find((f: any) => f.realtimeInput) as any;
  assert.equal(frame.realtimeInput.audio.mimeType, "audio/pcm;rate=16000");

  // The asymmetry is the trap: feed 24k in or play 16k out and it sounds wrong
  // in opposite directions.
  assert.equal(ctx.adapter.inputFormat.sampleRate, 16_000);
  const formats: number[] = [];
  ctx.adapter.on("audio", (_pcm, fmt) => formats.push(fmt.sampleRate));
  ctx.inbound({ __conformance: "audio", samples: [1, 2] });
  await ctx.settle();
  assert.deepEqual(formats, [24_000]);
});

test("base64 audio round-trips without corrupting samples", async () => {
  const ctx = geminiContext();
  await ctx.adapter.connect({});
  await ctx.settle();

  const original = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
  ctx.adapter.sendAudio(original);
  const frame = ctx.outbound().find((f: any) => f.realtimeInput) as any;

  const got: Int16Array[] = [];
  ctx.adapter.on("audio", (pcm) => got.push(pcm));
  ctx.inbound({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: frame.realtimeInput.audio.data } }] } },
  });
  await ctx.settle();

  assert.deepEqual(Array.from(got[0]), Array.from(original));
});

test("a real Gemini tool call maps to tool_call and the result carries the id", async () => {
  const ctx = geminiContext();
  await ctx.adapter.connect({});
  await ctx.settle();

  const calls: any[] = [];
  ctx.adapter.on("tool_call", (c) => calls.push(c));
  ctx.inbound({
    toolCall: { functionCalls: [{ id: "fc-1", name: "lookup", args: { q: "kestrel" } }] },
  });
  await ctx.settle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].callId, "fc-1");
  assert.deepEqual(JSON.parse(calls[0].arguments), { q: "kestrel" });

  ctx.adapter.sendToolResult("fc-1", { status: "success" });
  const resp = ctx.outbound().find((f: any) => f.toolResponse) as any;
  assert.equal(resp.toolResponse.functionResponses[0].id, "fc-1");
});

test("turnComplete closes the agent utterance exactly once", async () => {
  const ctx = geminiContext();
  await ctx.adapter.connect({});
  await ctx.settle();

  const done: string[] = [];
  ctx.adapter.on("agent_transcript_done", (t) => done.push(t));
  ctx.inbound({ serverContent: { outputTranscription: { text: "Hello " } } });
  ctx.inbound({ serverContent: { outputTranscription: { text: "there." } } });
  ctx.inbound({ serverContent: { turnComplete: true } });
  ctx.inbound({ serverContent: { turnComplete: true } });
  await ctx.settle();

  assert.deepEqual(done, ["Hello there."], "a repeated turnComplete must not duplicate the line");
});
