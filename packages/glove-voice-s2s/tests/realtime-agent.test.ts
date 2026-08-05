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
import { RealtimeAgent } from "../src/realtime-agent";
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
  assert.match((adapter.results[0].output as any).error, /Unknown tool/);
});

test("malformed arguments still get a result", async () => {
  const adapter = new FakeAdapter();
  const rt = new RealtimeAgent({ agent: fakeAgent([okTool]), adapter });
  await rt.start();

  adapter.emit("tool_call", { callId: "c4", name: "check_warranty", arguments: "{not json" });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(adapter.results.length, 1);
  assert.match((adapter.results[0].output as any).error, /valid JSON/);
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
  assert.match((adapter.results[0].output as any).error, /Invalid arguments/);
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
  assert.match((adapter.results[0].output as any).error, /database is down/);
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
