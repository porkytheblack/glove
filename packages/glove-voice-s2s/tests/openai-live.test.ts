import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { OpenAILiveAdapter, type OpenAILiveConfig } from "../src/openai-live";
import { createS2SAdapter } from "../src/create-adapter";
import { RealtimeAgent, s2sDrivenModel } from "../src/realtime-agent";
import { runConformance } from "../src/conformance";
import { int16ToBase64 } from "../src/pcm";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
class Socket {
  readyState = 1;
  sent: any[] = [];
  closeCount = 0;
  handlers = new Map<string, Array<(event: any) => void>>();
  constructor(readonly autoStart = true, readonly autoClose = true) {}
  addEventListener(type: string, fn: (event: any) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
    if (type === "open") queueMicrotask(() => fn({}));
  }
  send(data: string | ArrayBufferLike) {
    const event = JSON.parse(String(data));
    this.sent.push(event);
    if (event.type === "session.start" && this.autoStart) queueMicrotask(() => this.receive({ type: "session.started", session: { id: "live_1" } }));
    if (event.type === "session.close" && this.autoClose) queueMicrotask(() => this.receive({ type: "session.closed", usage: { seconds: 12 }, reason: "close_requested" }));
  }
  fire(type: string, event: any) { for (const fn of this.handlers.get(type) ?? []) fn(event); }
  receive(event: unknown) { this.fire("message", { data: JSON.stringify(event) }); }
  close() {
    if (this.readyState === 3) return;
    this.closeCount++;
    this.readyState = 3;
    this.fire("close", {});
  }
}

function setup(config: Partial<OpenAILiveConfig> = {}, socket = new Socket()) {
  const connections: Array<{ url: string; headers: Record<string, string> }> = [];
  const adapter = new OpenAILiveAdapter({
    getToken: () => "test-key",
    socketFactory: (url, headers) => { connections.push({ url, headers }); return socket; },
    ...config,
  });
  return { adapter, socket, connections };
}

function response(socket: Socket, event: unknown, delegation = "d1") {
  socket.receive({ type: "response.event", delegation_id: delegation, event });
}
function begin(socket: Socket, id = "r1", delegation = "d1") {
  response(socket, { type: "response.created", response: { id, output: [] } }, delegation);
}
function call(socket: Socket, callId = "c1", name = "lookup", args = '{"q":"x"}', delegation = "d1") {
  response(socket, { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name, arguments: args } }, delegation);
}
function complete(socket: Socket, id = "r1", delegation = "d1") {
  response(socket, { type: "response.completed", response: { id, output: [] } }, delegation);
}

test("Live passes shared adapter conformance with continuous transcript capabilities", async () => {
  const results = await runConformance(() => {
    const { adapter, socket } = setup();
    return {
      adapter, settle, outbound: () => socket.sent,
      inbound(message: any) {
        switch (message.__conformance) {
          case "tool_call":
            begin(socket); call(socket, message.callId, message.name, message.arguments); complete(socket); break;
          case "user_transcript":
            socket.receive({ type: "session.input_transcript.delta", delta: message.text, start_ms: 10, end_ms: 100 }); break;
          case "audio":
            socket.receive({ type: "session.output_audio.delta", delta: int16ToBase64(Int16Array.from(message.samples)) }); break;
          default: socket.receive(message);
        }
      },
    };
  });
  assert.deepEqual(results.filter(result => !result.passed), []);
});

test("startup waits for session.started, authenticates with headers, and sends Live config", async () => {
  const socket = new Socket(false);
  const { adapter, connections } = setup({ sampleRate: 16000, backendModel: "backend", instructions: "Voice style", backendInstructions: "Backend rules" }, socket);
  let ready = false;
  const connection = adapter.connect({ instructions: "Agent prompt", voice: "cedar", tools: [{ name: "lookup", description: "Find things", parameters: { type: "object" } }] }).then(() => { ready = true; });
  await settle();
  assert.equal(ready, false);
  assert.equal(adapter.isConnected, false);
  adapter.sendAudio(new Int16Array(10));
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(connections, [{ url: "wss://api.openai.com/v1/live/sessions", headers: { Authorization: "Bearer test-key" } }]);
  const session = socket.sent[0].session;
  assert.equal(socket.sent[0].type, "session.start");
  assert.equal(session.model, "gpt-live-1");
  assert.equal(session.instructions, "Voice style");
  assert.deepEqual(session.audio, { format: { type: "audio/pcm", rate: 16000 }, output: { voice: "cedar" } });
  assert.equal(session.delegation.responses.model, "backend");
  assert.equal(session.delegation.responses.instructions, "Backend rules");
  assert.equal(session.delegation.responses.tools[0].name, "lookup");
  assert.equal(session.delegation.responses.tools[0].strict, false);
  assert.equal(session.delegation.responses.parallel_tool_calls, false);
  socket.receive({ type: "session.started", session: { id: "live_1" } });
  await connection;
  assert.equal(adapter.isConnected, true);
  await adapter.disconnect();
});

test("startup rejection, early close and timeout clean up; duplicate connect shares startup", async () => {
  for (const failure of ["error", "close", "timeout", "session.closed"]) {
    const { adapter, socket } = setup({ connectTimeoutMs: 20 }, new Socket(false));
    const connection = adapter.connect();
    assert.equal(adapter.connect(), connection);
    const rejection = assert.rejects(connection);
    await settle();
    if (failure === "close") socket.close();
    if (failure === "error") socket.receive({ type: "error", error: { message: "bad model" } });
    if (failure === "session.closed") socket.receive({ type: "session.closed" });
    await rejection;
    assert.equal(adapter.isConnected, false);
    assert.equal(socket.closeCount, 1);
  }
});

test("disconnect during credential resolution cannot leak a late connection", async () => {
  let resolve!: (key: string) => void;
  const key = new Promise<string>(r => { resolve = r; });
  const { adapter, connections } = setup({ getToken: () => key });
  const rejected = assert.rejects(adapter.connect(), /cancelled/);
  await adapter.disconnect();
  resolve("test-key");
  await rejected;
  assert.equal(connections.length, 0);
});

test("PCM round trip uses negotiated rate; transcript overlap never creates final turns or cancels", async () => {
  const { adapter, socket } = setup({ sampleRate: 16000 });
  await adapter.connect();
  const pcm = Int16Array.from([-32768, 0, 42, 32767]);
  adapter.sendAudio(pcm);
  assert.deepEqual(socket.sent.at(-1), { type: "session.input_audio.append", audio: int16ToBase64(pcm) });
  const audio: unknown[] = [], fragments: unknown[] = [], finals: string[] = [];
  adapter.on("audio", (samples, format) => audio.push([Array.from(samples), format.sampleRate]));
  adapter.on("transcript", fragment => fragments.push(fragment));
  adapter.on("user_transcript", (text, final) => { if (final) finals.push(text); });
  adapter.on("agent_transcript_done", text => finals.push(text));
  socket.receive({ type: "session.output_audio.delta", delta: int16ToBase64(pcm) });
  socket.receive({ type: "session.input_transcript.delta", delta: " yes", start_ms: 0, end_ms: 100 });
  socket.receive({ type: "session.output_transcript.delta", delta: "Checking", start_ms: 20, end_ms: 120 });
  assert.deepEqual(audio, [[Array.from(pcm), 16000]]);
  assert.deepEqual(fragments, [
    { role: "user", delta: " yes", startMs: 0, endMs: 100 },
    { role: "assistant", delta: "Checking", startMs: 20, endMs: 120 },
  ]);
  assert.deepEqual(finals, []);
  assert.equal(socket.sent.some(event => event.type === "response.cancel"), false);
  await adapter.disconnect();
});

test("completed output items survive empty response snapshots; all results precede one continuation", async () => {
  const { adapter, socket } = setup({ parallelToolCalls: true });
  await adapter.connect();
  const seen: string[] = [];
  adapter.on("tool_call", value => seen.push(value.callId));
  begin(socket);
  response(socket, { type: "response.function_call_arguments.done", arguments: "{}" });
  call(socket, "a"); call(socket, "b"); call(socket, "a");
  assert.deepEqual(seen, []);
  complete(socket);
  complete(socket);
  assert.deepEqual(seen, ["a", "b"]);
  adapter.sendToolResult("b", { value: 2 });
  assert.equal(socket.sent.filter(event => event.type === "response.create").length, 0);
  adapter.sendToolResult("a", { value: 1 });
  adapter.sendToolResult("a", { value: 1 });
  assert.deepEqual(socket.sent.slice(1).map(event => event.type), ["response.item.create", "response.item.create", "response.create"]);
  assert.deepEqual(socket.sent.slice(1, 3).map(event => event.item.call_id), ["b", "a"]);
  assert.deepEqual(Object.keys(socket.sent.at(-1)).sort(), ["event_id", "type"]);
  await adapter.disconnect();
});

test("synchronous tool replies wait for every call, suppressed continuation is respected", async () => {
  const { adapter, socket } = setup();
  await adapter.connect();
  adapter.on("tool_call", value => adapter.sendToolResult(value.callId, "done"));
  begin(socket); call(socket, "a"); call(socket, "b"); complete(socket);
  assert.deepEqual(socket.sent.slice(1).map(event => event.type), ["response.item.create", "response.item.create", "response.create"]);
  adapter.removeAllListeners("tool_call");
  begin(socket, "r2"); call(socket, "c"); complete(socket, "r2");
  adapter.sendToolResult("c", "silent", { respond: false });
  assert.equal(socket.sent.filter(event => event.type === "response.create").length, 1);
  await adapter.disconnect();
});

test("failed backend responses never execute their collected tools", async () => {
  const { adapter, socket } = setup();
  await adapter.connect();
  const seen: unknown[] = [], errors: Error[] = [];
  adapter.on("tool_call", value => seen.push(value));
  adapter.on("error", error => errors.push(error));
  begin(socket); call(socket);
  response(socket, { type: "response.failed", response: { id: "r1", error: { message: "backend failed" } } });
  complete(socket);
  assert.deepEqual(seen, []);
  assert.match(errors[0].message, /backend failed/);
  await adapter.disconnect();
});

test("session patches target the backend and context appends preserve Unicode within the limit", async () => {
  const { adapter, socket } = setup();
  await adapter.connect({ instructions: "Original" });
  adapter.updateSession({ instructions: "New rules", tools: [], voice: "marin" });
  assert.equal(socket.sent[1].type, "session.instructions.append");
  assert.deepEqual(socket.sent[2].session, { delegation: { type: "responses", responses: { instructions: "New rules", tools: [] } } });
  assert.throws(() => adapter.updateSession({ voice: "cedar" }), /fixed at startup/);
  const content = "世界🙂 " .repeat(200);
  const before = socket.sent.length;
  adapter.injectText(content, { respond: true });
  const appends = socket.sent.slice(before);
  assert.equal(appends.map(event => event.content).join(""), content);
  for (const event of appends) {
    assert.equal(event.type, "session.commentary.append");
    assert.equal(event.delegation_id, null);
    assert.ok(Buffer.byteLength(event.content) <= 500);
  }
  adapter.injectText("Context", { respond: false });
  assert.equal(socket.sent.at(-1).type, "session.thinking.append");
  assert.equal(socket.sent.some(event => event.type === "response.create"), false);
  await adapter.disconnect();
});

test("hard interruption mutes future audio until explicit recovery; playback lifecycle is host-driven", async () => {
  const { adapter, socket } = setup();
  await adapter.connect();
  const seen: string[] = [];
  for (const event of ["agent_speech_started", "agent_speech_stopped", "interrupted", "audio"] as const) adapter.on(event, () => seen.push(event));
  const audio = () => socket.receive({ type: "session.output_audio.delta", delta: int16ToBase64(new Int16Array(3)) });
  audio();
  assert.deepEqual(seen, ["audio"]);
  adapter.notifyPlaybackState(true);
  adapter.interrupt(); audio();
  assert.deepEqual(seen, ["audio", "agent_speech_started", "interrupted", "agent_speech_stopped"]);
  adapter.resumeOutput(); audio();
  assert.deepEqual(seen.slice(-2), ["interrupted", "audio"]);
  assert.equal(socket.sent.some(event => event.type === "response.cancel"), false);
  await adapter.disconnect();
});

test("graceful close collects cumulative and final usage exactly once; late audio is dropped", async () => {
  const { adapter, socket } = setup({}, new Socket(true, false));
  await adapter.connect();
  const usage: unknown[] = [], audio: unknown[] = [];
  let disconnected = 0;
  adapter.on("usage", value => usage.push(value));
  adapter.on("audio", value => audio.push(value));
  adapter.on("disconnected", () => disconnected++);
  socket.receive({ type: "session.usage.updated", usage: { seconds: 10 } });
  const closed = adapter.disconnect();
  assert.equal(adapter.disconnect(), closed);
  assert.equal(adapter.isConnected, false);
  socket.receive({ type: "session.output_audio.delta", delta: int16ToBase64(new Int16Array(3)) });
  socket.receive({ type: "session.closed", usage: { seconds: 12 } });
  await closed;
  assert.deepEqual(usage, [{ seconds: 10, final: false }, { seconds: 12, final: true }]);
  assert.equal(disconnected, 1);
  assert.deepEqual(audio, []);
});

test("close timeout and transport loss report incomplete finalization", async () => {
  for (const earlyClose of [true, false]) {
    const { adapter, socket } = setup({ closeTimeoutMs: 20 }, new Socket(true, false));
    await adapter.connect();
    const rejected = assert.rejects(adapter.disconnect(), /unconfirmed/);
    if (earlyClose) socket.close();
    await rejected;
    assert.equal(adapter.isConnected, false);
    assert.equal(socket.closeCount, 1);
  }
});

test("factory and s2sDrivenModel use the same RealtimeAgent tools and error contracts", async () => {
  const socket = new Socket();
  const agent = {
    model: s2sDrivenModel({ provider: "openai-live", apiKey: "test-key", socketFactory: () => socket }),
    getSystemPrompt: () => "Use the lookup tool.",
    getRuntimeContext: async () => [{ text: "Goal: answer the caller" }],
    tools: [{ name: "lookup", description: "Lookup", input_schema: z.object({ q: z.string() }), run: async () => ({ status: "success", data: { answer: 42 }, renderData: { secret: "private" } }) }],
  };
  const rt = new RealtimeAgent({ agent: agent as any });
  const fragments: unknown[] = [], usage: unknown[] = [];
  rt.on("transcript", fragment => fragments.push(fragment));
  rt.on("usage", value => usage.push(value));
  assert.ok(rt.adapter instanceof OpenAILiveAdapter);
  await rt.start();
  socket.receive({ type: "session.input_transcript.delta", delta: "Lookup", start_ms: 0, end_ms: 50 });
  socket.receive({ type: "session.usage.updated", usage: { seconds: 1 } });
  assert.deepEqual(fragments, [{ role: "user", delta: "Lookup", startMs: 0, endMs: 50 }]);
  assert.deepEqual(usage, [{ seconds: 1, final: false }]);
  assert.equal(socket.sent[0].session.delegation.responses.tools[0].name, "lookup");
  assert.equal(socket.sent[1].type, "session.thinking.append");
  begin(socket); call(socket); complete(socket);
  await settle();
  const result = socket.sent.find(event => event.type === "response.item.create");
  assert.deepEqual(JSON.parse(result.item.output), { status: "success", data: { answer: 42 } });
  assert.equal(socket.sent.filter(event => event.type === "response.create").length, 1);
  begin(socket, "r2"); call(socket, "bad", "lookup", '{"q":42}'); complete(socket, "r2");
  await settle();
  assert.match(socket.sent.find(event => event.item?.call_id === "bad").item.output, /Invalid arguments/);
  await rt.stop();
  assert.deepEqual(usage.at(-1), { seconds: 12, final: true }, "RealtimeAgent must forward final usage while stop drains");
  assert.equal(rt.adapter.listenerCount("usage"), 0);
  assert.ok(createS2SAdapter({ provider: "openai-live", apiKey: "key" }) instanceof OpenAILiveAdapter);
});

test("factory resolves Live environment settings and explicit overrides without Realtime VAD", async () => {
  const names = ["S2S_PROVIDER", "S2S_MODEL", "S2S_BACKEND_MODEL", "S2S_VOICE", "S2S_TURN_DETECTION", "OPENAI_API_KEY"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { S2S_PROVIDER: "openai-live", S2S_MODEL: "gpt-live-1", S2S_BACKEND_MODEL: "backend-env", S2S_VOICE: "cedar", S2S_TURN_DETECTION: "server_vad", OPENAI_API_KEY: "env-key" });
  try {
    for (const explicit of [false, true]) {
      const socket = new Socket();
      let authorization = "";
      const adapter = createS2SAdapter({
        provider: "openai-live",
        ...(explicit ? { backendModel: "backend-explicit", voice: "marin", apiKey: "explicit-key" } : {}),
        socketFactory: (_url, headers) => { authorization = headers.Authorization; return socket; },
      });
      await adapter.connect();
      const session = socket.sent[0].session;
      assert.equal(session.delegation.responses.model, explicit ? "backend-explicit" : "backend-env");
      assert.equal(session.audio.output.voice, explicit ? "marin" : "cedar");
      assert.equal(authorization, explicit ? "Bearer explicit-key" : "Bearer env-key");
      assert.equal(JSON.stringify(session).includes("server_vad"), false);
      await adapter.disconnect();
    }
    assert.ok(createS2SAdapter() instanceof OpenAILiveAdapter);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
  }
});

test("reconnect ignores the old socket and resets output mute and pending tool state", async () => {
  const sockets: Socket[] = [];
  const { adapter } = setup({ socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  await adapter.connect();
  begin(sockets[0]); call(sockets[0]); complete(sockets[0]);
  adapter.interrupt();
  await adapter.disconnect();
  await adapter.connect();
  const audio: number[] = [];
  adapter.on("audio", value => audio.push(value.length));
  const frame = { type: "session.output_audio.delta", delta: int16ToBase64(new Int16Array(3)) };
  sockets[0].receive(frame);
  sockets[1].receive(frame);
  assert.deepEqual(audio, [3]);
  const errors: Error[] = [];
  adapter.on("error", error => errors.push(error));
  adapter.sendToolResult("c1", "stale");
  assert.equal(errors.length, 1);
  assert.equal(sockets[1].sent.some(event => event.type === "response.item.create"), false);
  await adapter.disconnect();
});
