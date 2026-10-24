import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import type { IGloveRunnable, Message } from "glove-core";
import type { S2SAdapter, S2SEvents, S2SSessionConfig } from "glove-voice-s2s";
import { WebSocket } from "ws";
import type { AgentHandlerContext } from "../src/definition.js";
import type { FoundryMeshMessage } from "../src/mesh.js";
import {
  VOICE_EXCLUDED_FOUNDRY_TOOLS,
  voiceCall,
  webSocketRoom,
  type FoundryVoiceCall,
  type FoundryVoiceRoom,
  type VoiceCallResult,
} from "../src/voice.js";

// node's EventEmitter has the same on/off/emit shape the adapter contract uses.
class FakeAdapterBase extends EventEmitter {
  override emit<E extends keyof S2SEvents>(event: E, ...args: S2SEvents[E]): boolean {
    return super.emit(event, ...args);
  }
}

class FakeAdapterImpl extends FakeAdapterBase {
  readonly mode = "transport" as const;
  readonly inputFormat = { sampleRate: 16_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  connected = false;
  session?: S2SSessionConfig;
  injected: Array<{ text: string; respond?: boolean }> = [];
  audioIn: number[] = [];
  interrupts = 0;
  get isConnected() { return this.connected; }
  async connect(config?: S2SSessionConfig) { this.session = config; this.connected = true; }
  async disconnect() { this.connected = false; }
  sendAudio(pcm: Int16Array) { this.audioIn.push(pcm.length); }
  injectText(text: string, opts?: { respond?: boolean }) { this.injected.push({ text, ...opts }); }
  sendToolResult() {}
  updateSession() {}
  interrupt() { this.interrupts++; }
}
type FakeAdapter = FakeAdapterImpl & S2SAdapter;
const FakeAdapter = FakeAdapterImpl as unknown as new () => FakeAdapter;

const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: name,
  input_schema: undefined,
  run: async () => ({ status: "success", data: null }),
  ...extra,
});

function fakeAgent(saved: Message[]): IGloveRunnable {
  return {
    tools: [
      tool("lookup_order"),
      tool("refund", { requiresPermission: true }),
      tool("glove_mesh_list_agents"),
      tool("glove_mesh_send_message"),
      ...VOICE_EXCLUDED_FOUNDRY_TOOLS.map((name) => tool(name)),
    ],
    getSystemPrompt: () => "You are Nova.",
    store: { appendMessages: async (messages: Message[]) => { saved.push(...messages); } },
  } as unknown as IGloveRunnable;
}

function fakeContext(options: { kind?: string; messageText?: string } = {}) {
  const events: Array<{ type: string; data?: unknown }> = [];
  const controller = new AbortController();
  let deliver: ((messages: ReadonlyArray<FoundryMeshMessage>) => void | Promise<void>) | undefined;
  let listening = false;
  const context = {
    runId: "run_voice",
    request: { source: { kind: options.kind ?? "direct" } },
    conversationId: "call-conversation",
    messageText: options.messageText ?? "",
    signal: controller.signal,
    emit: (event: { type: string; data?: unknown }) => { events.push(event); },
    onMeshMessage: (handler: typeof deliver) => {
      deliver = handler;
      listening = true;
      return async () => { listening = false; };
    },
  } as unknown as AgentHandlerContext;
  return {
    context,
    events,
    abort: () => controller.abort(),
    deliver: (messages: FoundryMeshMessage[]) => deliver!(messages),
    get listening() { return listening; },
  };
}

/** A room the test drives by hand. */
function handRoom() {
  let call!: FoundryVoiceCall;
  let closed = false;
  let markOpened!: () => void;
  const opened = new Promise<void>((resolveOpened) => { markOpened = resolveOpened; });
  const room: FoundryVoiceRoom = {
    open: (value) => { call = value; markOpened(); },
    close: () => { closed = true; },
  };
  return { room, opened, get call() { return call; }, get closed() { return closed; } };
}

const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, 10));

test("a call greets the first caller, saves the transcript and keeps bookkeeping and gated tools off the line", async () => {
  const adapter = new FakeAdapter();
  const saved: Message[] = [];
  const hand = handRoom();
  const fake = fakeContext();
  const running = voiceCall({
    room: hand.room,
    greeting: "Greet the caller in one short sentence.",
    realtime: { adapter },
  })(fakeAgent(saved), fake.context);
  await hand.opened;

  const offered = adapter.session?.tools?.map((item) => item.name).sort();
  assert.deepEqual(offered, ["glove_mesh_list_agents", "glove_mesh_send_message", "lookup_order"]);

  hand.call.joined();
  hand.call.joined();
  assert.deepEqual(adapter.injected, [{ text: "Greet the caller in one short sentence.", respond: true }], "greets once");

  adapter.emit("user_transcript", "Where is my order?", true);
  adapter.emit("agent_transcript_done", "Let me check.");
  hand.call.say("It's order 42.");
  hand.call.end("caller hung up");
  const result = await running as VoiceCallResult;

  assert.equal(result.endedBecause, "caller hung up");
  assert.equal(result.turns, 1);
  assert.deepEqual(saved, [
    { sender: "user", text: "Where is my order?" },
    { sender: "agent", text: "Let me check." },
    { sender: "user", text: "It's order 42." },
  ]);
  assert.equal(hand.closed, true);
  assert.equal(adapter.connected, false);
  assert.equal(fake.listening, false);
});

test("a reply from another agent waits for a pause, then is spoken and saved in full", async () => {
  const adapter = new FakeAdapter();
  const saved: Message[] = [];
  const hand = handRoom();
  const fake = fakeContext();
  const running = voiceCall({ room: hand.room, realtime: { adapter } })(fakeAgent(saved), fake.context);
  await hand.opened;
  hand.call.joined();

  adapter.emit("agent_speech_started");
  await fake.deliver([{
    kind: "reply",
    id: "msg_1",
    threadId: "thread_1",
    from: { agentId: "maya-coder", name: "Coder" },
    to: "maya",
    content: "Fixed in PR 12.",
    createdAt: "",
  }]);
  await tick();
  assert.equal(adapter.injected.length, 0, "never over the agent's own speech");

  adapter.emit("agent_speech_stopped");
  assert.equal(adapter.injected.length, 1);
  assert.match(adapter.injected[0]!.text, /Coder \(maya-coder\) replied to what you sent them \(thread thread_1\):\nFixed in PR 12\./);
  assert.equal(adapter.injected[0]!.respond, true);
  await tick();
  assert.match(saved[0]!.text, /<mesh-message id="msg_1" thread="thread_1" from="maya-coder" name="Coder" status="replied">/);

  hand.call.end("done");
  const result = await running as VoiceCallResult;
  assert.equal(result.updatesSpoken, 1);
  assert.ok(fake.events.some((event) => event.type === "foundry.voice.updates.spoken"));
});

test("an update nobody heard stays in the conversation for the next turn", async () => {
  const adapter = new FakeAdapter();
  const saved: Message[] = [];
  const hand = handRoom();
  const fake = fakeContext();
  const running = voiceCall({ room: hand.room, realtime: { adapter } })(fakeAgent(saved), fake.context);
  await hand.opened;
  hand.call.joined();
  adapter.emit("user_speech_started");
  await fake.deliver([{
    kind: "message",
    id: "msg_2",
    threadId: "thread_2",
    from: { agentId: "maya-browser", name: "Browser" },
    to: "maya",
    content: "Indoors or outside?",
    createdAt: "",
  }]);
  hand.call.end("caller hung up");
  await running;
  assert.equal(adapter.injected.length, 0);
  assert.match(saved.at(-1)!.text, /<mesh-message id="msg_2"[^>]*>\nIndoors or outside\?[\s\S]*needs an answer to go on/);
});

test("a call ends when nobody joins, when the run is cancelled, or when it runs too long", async () => {
  const idle = handRoom();
  const idleRun = voiceCall({ room: idle.room, idleMs: 30, realtime: { adapter: new FakeAdapter() } })(
    fakeAgent([]),
    fakeContext().context,
  );
  assert.equal((await idleRun as VoiceCallResult).endedBecause, "idle");

  const cancelled = handRoom();
  const fake = fakeContext();
  const cancelledRun = voiceCall({ room: cancelled.room, realtime: { adapter: new FakeAdapter() } })(fakeAgent([]), fake.context);
  await cancelled.opened;
  cancelled.call.joined();
  fake.abort();
  assert.equal((await cancelledRun as VoiceCallResult).endedBecause, "cancelled");

  const long = handRoom();
  const longRun = voiceCall({ room: long.room, maxDurationMs: 30, realtime: { adapter: new FakeAdapter() } })(
    fakeAgent([]),
    fakeContext().context,
  );
  await long.opened;
  long.call.joined();
  assert.equal((await longRun as VoiceCallResult).endedBecause, "time limit");
});

test("a mesh run on a voice agent saves the message instead of opening a room", async () => {
  const saved: Message[] = [];
  let opened = false;
  const room: FoundryVoiceRoom = { open: () => { opened = true; }, close: () => undefined };
  const result = await voiceCall({ room, realtime: { adapter: new FakeAdapter() } })(
    fakeAgent(saved),
    fakeContext({ kind: "mesh", messageText: "<mesh-message id=\"m\">…</mesh-message>" }).context,
  );
  assert.equal(opened, false);
  assert.equal((result as VoiceCallResult).endedBecause, "not a call");
  assert.deepEqual(saved, [{ sender: "user", text: "<mesh-message id=\"m\">…</mesh-message>" }]);
});

async function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolvePort(typeof address === "object" && address ? address.port : 0));
    });
  });
}

test("the WebSocket room carries audio and text both ways and refuses a wrong token", async () => {
  const adapter = new FakeAdapter();
  const saved: Message[] = [];
  const port = await freePort();
  const token = "a".repeat(32);
  const fake = fakeContext();
  const running = voiceCall({
    room: webSocketRoom({ port, token, agentName: "Nova" }),
    realtime: { adapter },
  })(fakeAgent(saved), fake.context);
  await new Promise<void>((resolveReady) => {
    const check = () => fake.events.some((event) => event.type === "foundry.voice.room.ready")
      ? resolveReady()
      : setTimeout(check, 10);
    check();
  });

  const refused = new WebSocket(`ws://127.0.0.1:${port}/call?token=wrong`);
  const refusedCode = await new Promise<number>((resolveClose) => refused.on("close", (code) => resolveClose(code)));
  assert.equal(refusedCode, 4403);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/call?token=${token}`);
  const messages: Array<Record<string, unknown>> = [];
  const audio: number[] = [];
  socket.on("message", (data, isBinary) => {
    if (isBinary) audio.push((data as Buffer).byteLength);
    else messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  await new Promise<void>((resolveOpen) => socket.on("open", () => resolveOpen()));
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.deepEqual(messages[0], {
    t: "ready",
    sessionId: "run_voice",
    agent: "Nova",
    model: "",
    tools: ["lookup_order", "glove_mesh_list_agents", "glove_mesh_send_message"],
  });

  socket.send(Buffer.from(new Int16Array(320).buffer), { binary: true });
  socket.send(JSON.stringify({ t: "say", text: "hello there" }));
  socket.send(JSON.stringify({ t: "barge_in" }));
  adapter.emit("audio", new Int16Array(480), { sampleRate: 24_000, channels: 1, encoding: "pcm_s16le" });
  adapter.emit("agent_transcript_delta", "Hi");
  adapter.emit("agent_transcript_done", "Hi");
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));

  assert.deepEqual(adapter.audioIn, [320]);
  assert.deepEqual(adapter.injected, [{ text: "hello there", respond: true }]);
  assert.equal(adapter.interrupts, 1);
  assert.deepEqual(audio, [640], "24 kHz agent audio is resampled to the room's 16 kHz");
  assert.ok(messages.some((message) => message.t === "speech" && message.text === "Hi"));
  assert.ok(messages.some((message) => message.t === "speech_end"));
  assert.ok(saved.some((message) => message.text === "hello there"));

  socket.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  fake.abort();
  assert.equal((await running as VoiceCallResult).endedBecause, "cancelled");
});
