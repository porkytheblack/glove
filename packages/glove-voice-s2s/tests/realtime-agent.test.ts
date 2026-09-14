// The bridge is the part that CAN be verified without provider credentials,
// so it is verified properly: a fake adapter stands in for the provider and
// every path a tool call can take is driven through it.
//
// The failure paths matter more than the happy one. In a text agent a broken
// tool call is a retry; in a voice call it is dead air with the caller
// listening, because the provider blocks until it gets a result.

import { test } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import { z } from "zod";
import { RealtimeAgent, s2sDrivenModel } from "../src/realtime-agent";
import type { WebSocketLike } from "../src/gemini-live";
import type { S2SAdapter, S2SEvents, S2SSessionConfig } from "../src/types";

class FakeAdapter extends EventEmitter<S2SEvents> implements S2SAdapter {
  readonly mode = "transport" as const;
  readonly inputFormat = { sampleRate: 16_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  connected = false;
  session?: S2SSessionConfig;
  results: Array<{ callId: string; output: unknown }> = [];
  injected: Array<{ text: string; respond?: boolean }> = [];
  audioIn = 0;

  get isConnected() { return this.connected; }
  async connect(config?: S2SSessionConfig) { this.session = config; this.connected = true; }
  async disconnect() { this.connected = false; }
  sendAudio() { this.audioIn++; }
  injectText(text: string, opts?: { respond?: boolean }) { this.injected.push({ text, ...opts }); }
  sendToolResult(callId: string, output: unknown) { this.results.push({ callId, output }); }
  updateSession(patch: Partial<S2SSessionConfig>) { this.session = { ...this.session, ...patch }; }
  interrupt() {}
}

test("a tool finishing after restart cannot inject context or results into the new session", async () => {
  const adapter = new FakeAdapter();
  let finish!: (value: unknown) => void;
  const toolResult = new Promise(resolve => { finish = resolve; });
  const agent = fakeAgent([{ ...okTool, run: () => toolResult }]);
  agent.getRuntimeContext = async () => [{ text: "Current context" }];
  const rt = new RealtimeAgent({ agent, adapter });
  await rt.start();
  adapter.emit("tool_call", { callId: "old", name: "check_warranty", arguments: '{"hull":"x"}' });
  await rt.stop();
  await rt.start();
  const injections = adapter.injected.length;
  finish({ status: "success", data: "old session result" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(adapter.results, []);
  assert.equal(adapter.injected.length, injections);
  await rt.stop();
});

test("failed finalization cleans listeners and permits a later start", async () => {
  const adapter = new FakeAdapter();
  let finish!: () => void;
  adapter.disconnect = async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    adapter.connected = false;
    throw new Error("finalization failed");
  };
  const rt = new RealtimeAgent({ agent: fakeAgent([]), adapter });
  await rt.start();
  const stop = rt.stop();
  assert.equal(rt.stop(), stop);
  const failure = assert.rejects(stop, /finalization failed/);
  await new Promise(resolve => setImmediate(resolve));
  finish();
  await failure;
  assert.equal(adapter.listenerCount("usage"), 0);
  assert.equal(adapter.listenerCount("error"), 0);
  adapter.disconnect = async () => { adapter.connected = false; };
  await rt.start();
  assert.equal(adapter.listenerCount("tool_call"), 1);
  await rt.stop();
});

/** Minimal IGloveRunnable — only what RealtimeAgent actually reads. */
function fakeAgent(tools: any[], systemPrompt = "You are Nova.") {
  return {
    tools,
    getSystemPrompt: () => systemPrompt,
  } as any;
}

const okTool = {
  name: "check_warranty",
  description: "Check a hull's warranty.",
  input_schema: z.object({ hull: z.string() }),
  run: async (input: any) => ({ status: "success", data: { hull: input.hull, covered: true } }),
};

test("session is configured from the agent's prompt and tools", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([okTool]), adapter });
  await rt.start();

  assert.equal(adapter.session?.instructions, "You are Nova.");
  assert.equal(adapter.session?.tools?.length, 1);
  assert.equal(adapter.session?.tools?.[0].name, "check_warranty");
  // The zod schema must have become JSON Schema the provider can read.
  assert.equal((adapter.session?.tools?.[0].parameters as any).type, "object");
  assert.ok((adapter.session?.tools?.[0].parameters as any).properties.hull);
});

test("a tool call runs the real tool and returns its result", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([okTool]), adapter });
  await rt.start();

  adapter.emit("tool_call", { callId: "c1", name: "check_warranty", arguments: '{"hull":"KES-0007"}' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(adapter.results.length, 1);
  assert.equal(adapter.results[0].callId, "c1");
  assert.deepEqual((adapter.results[0].output as any).data, { hull: "KES-0007", covered: true });
});

test("excluded tools are withheld and refused if called anyway", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({
    agent: fakeAgent([okTool]),
    adapter,
    excludeTools: ["check_warranty"],
  });
  await rt.start();

  assert.equal(adapter.session?.tools?.length, 0);

  adapter.emit("tool_call", { callId: "c2", name: "check_warranty", arguments: "{}" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((adapter.results[0].output as any).status, "error");
});

// ── the three ways a call can go wrong; all must still answer ───────────────

test("an unknown tool still gets a result, not silence", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([okTool]), adapter });
  await rt.start();

  adapter.emit("tool_call", { callId: "c3", name: "nope", arguments: "{}" });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(adapter.results.length, 1, "provider was left waiting — this is dead air");
  assert.match((adapter.results[0].output as any).message, /Unknown tool/);
});

test("malformed arguments still get a result", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([okTool]), adapter });
  await rt.start();

  adapter.emit("tool_call", { callId: "c4", name: "check_warranty", arguments: "{not json" });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(adapter.results.length, 1);
  assert.match((adapter.results[0].output as any).message, /valid JSON/);
});

test("schema-invalid arguments are rejected before the tool runs", async () => {
  const adapter = new FakeAdapter();
  let ran = false;
  const tool = { ...okTool, run: async () => { ran = true; return { status: "success" }; } };
  const rt = new RealtimeAgent({ agent: fakeAgent([tool]), adapter });
  await rt.start();

  adapter.emit("tool_call", { callId: "c5", name: "check_warranty", arguments: '{"hull":42}' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(ran, false, "tool ran with input its own schema rejects");
  assert.match((adapter.results[0].output as any).message, /Invalid arguments/);
});

test("a throwing tool still gets a result the model can speak", async () => {
  const adapter = new FakeAdapter();
  const tool = { ...okTool, run: async () => { throw new Error("database is down"); } };
  const rt = new RealtimeAgent({ agent: fakeAgent([tool]), adapter });
  rt.on("error", () => {});
  await rt.start();

  adapter.emit("tool_call", { callId: "c6", name: "check_warranty", arguments: '{"hull":"x"}' });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(adapter.results.length, 1);
  assert.match((adapter.results[0].output as any).message, /database is down/);
});

test("renderData and summary plumbing never reach the provider", async () => {
  const adapter = new FakeAdapter();
  const tool = {
    ...okTool,
    run: async () => ({
      status: "success",
      data: { covered: true },
      renderData: { email: "secret@example.com" },
      summary: "checked warranty",
      generateSummaryArgs: { hull: "x" },
    }),
  };
  const rt = new RealtimeAgent({ agent: fakeAgent([tool]), adapter });
  const finished: unknown[] = [];
  rt.on("tool_finished", (_n, out) => finished.push(out));
  await rt.start();

  adapter.emit("tool_call", { callId: "c7", name: "check_warranty", arguments: '{"hull":"x"}' });
  await new Promise((r) => setTimeout(r, 10));

  const wire = adapter.results[0].output as any;
  assert.equal(wire.renderData, undefined, "renderData is client-only, same as the model adapters");
  assert.equal(wire.summary, undefined);
  assert.equal(wire.generateSummaryArgs, undefined);
  assert.deepEqual(wire.data, { covered: true });
  // The host-side event still carries the full result.
  assert.deepEqual((finished[0] as any).renderData, { email: "secret@example.com" });
});

test("stop() removes only its own listeners — the host's stay attached", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([]), adapter });
  const hostAudio: number[] = [];
  adapter.on("audio", (pcm) => hostAudio.push(pcm.length));
  await rt.start();
  await rt.stop();

  adapter.emit("audio", new Int16Array(4), adapter.inputFormat);
  assert.deepEqual(hostAudio, [4], "host's audio wiring must survive a stop/start cycle");
  assert.equal(adapter.listenerCount("tool_call"), 0, "bridge listeners must be gone");
});

test("transcripts surface, and injection reaches the adapter", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([]), adapter });
  const said: string[] = [];
  rt.on("user_said", (t) => said.push(t));
  await rt.start();

  adapter.emit("user_transcript", "partial", false);
  adapter.emit("user_transcript", "the whole sentence", true);
  assert.deepEqual(said, ["the whole sentence"], "partials must not be logged as utterances");

  rt.inject("the lookup finished: covered until 2031", { respond: true });
  assert.equal(adapter.injected[0].respond, true);
});

test("the adapter derives from a config-carrying s2sDrivenModel — no explicit adapter", async () => {
  const sent: unknown[] = [];
  const socket: WebSocketLike = {
    readyState: 1,
    send: (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d))),
    close() {},
    addEventListener(type: string, fn: (ev: unknown) => void) {
      if (type === "open") queueMicrotask(() => fn({}));
    },
  };
  const agent = {
    ...fakeAgent([okTool], "You are Nova."),
    model: s2sDrivenModel({
      label: "derived",
      provider: "gemini",
      apiKey: "test-key",
      voice: "Puck",
      socketFactory: () => socket,
    }),
  };

  const rt = new RealtimeAgent({ agent });
  assert.equal(rt.mode, "transport", "derived adapter should be Gemini transport");
  await rt.start();
  await new Promise((r) => setTimeout(r, 5));

  const setup = (sent[0] as any).setup;
  assert.equal(setup.systemInstruction.parts[0].text, "You are Nova.");
  assert.equal(setup.tools[0].functionDeclarations[0].name, "check_warranty");
  assert.equal(
    setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    "Puck",
  );
});

test("no adapter and no config-carrying model is a construction-time error", () => {
  assert.throws(
    () => new RealtimeAgent({ agent: fakeAgent([okTool]) }),
    /s2sDrivenModel/,
    "the error must point at the two ways to supply a session",
  );
});

test("the placeholder still fails loudly if Glove's loop runs", async () => {
  await assert.rejects(
    () => s2sDrivenModel("front").prompt(undefined as never, undefined as never),
    /"front".*placeholder/s,
  );
});

test("refreshSession re-sends tools folded after start", async () => {
  const adapter = new FakeAdapter();
  const tools = [okTool];
  const rt = new RealtimeAgent({ agent: fakeAgent(tools), adapter });
  await rt.start();
  assert.equal(adapter.session?.tools?.length, 1);

  tools.push({ ...okTool, name: "book_service" });
  rt.refreshSession();
  assert.equal(adapter.session?.tools?.length, 2);
});

test("runtime context is injected silently at start and after tools without rewriting instructions", async () => {
  const adapter = new FakeAdapter();
  let text = "GOALS: collect email";
  const agent = {
    tools: [{ name: "advance", description: "Advance", input_schema: z.object({}), run: async () => { text = "GOALS: complete"; return { status: "success", data: "done" }; } }],
    getSystemPrompt: () => "Stable voice instructions",
    getRuntimeContext: async () => [{ sender: "user", text }],
  };
  const rt = new RealtimeAgent({ agent: agent as never, adapter });
  await rt.start();
  assert.equal(adapter.session!.instructions, "Stable voice instructions");
  assert.equal(adapter.injected[0].respond, false);
  assert.match(adapter.injected[0].text, /collect email/);
  adapter.emit("tool_call", { callId: "advance", name: "advance", arguments: "{}" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(adapter.results.length, 1);
  assert.match(adapter.injected.at(-1)!.text, /GOALS: complete/);
  assert.equal(adapter.injected.at(-1)!.respond, false);
  assert.equal(adapter.session!.instructions, "Stable voice instructions");
  const count = adapter.injected.length; await rt.refreshContext(); assert.equal(adapter.injected.length, count);
  text = ""; await rt.refreshContext(); assert.match(adapter.injected.at(-1)!.text, /No active runtime context/);
  await rt.stop();
});

test("a failed initial context read cleans up and allows a fresh start", async () => {
  const adapter = new FakeAdapter();
  let fail = true;
  const agent = { ...fakeAgent([]), getRuntimeContext: async () => {
    if (fail) throw new Error("context unavailable");
    return [{ sender: "user", text: "Current goals" }];
  } };
  const rt = new RealtimeAgent({ agent, adapter });
  await assert.rejects(rt.start(), /context unavailable/);
  assert.equal(adapter.connected, false);
  assert.equal(adapter.listenerCount("tool_call"), 0);
  fail = false;
  await rt.start();
  assert.equal(adapter.connected, true);
  assert.equal(adapter.listenerCount("tool_call"), 1);
  assert.match(adapter.injected.at(-1)!.text, /Current goals/);
  await rt.stop();
});

test("context read failure after a committed tool preserves the successful result", async () => {
  const adapter = new FakeAdapter();
  let fail = false;
  const agent = { ...fakeAgent([{ ...okTool, run: async () => {
    fail = true;
    return { status: "success", data: "committed" };
  } }]), getRuntimeContext: async () => {
    if (fail) throw new Error("context unavailable");
    return [];
  } };
  const rt = new RealtimeAgent({ agent, adapter });
  const errors: Error[] = [];
  rt.on("error", error => errors.push(error));
  await rt.start();
  adapter.emit("tool_call", { callId: "committed", name: "check_warranty", arguments: '{"hull":"test"}' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /context unavailable/);
  assert.deepEqual(adapter.results, [{ callId: "committed", output: { status: "success", data: "committed" } }]);
  await rt.stop();
});
