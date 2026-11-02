// Regressions from the package audit: each test reproduces a failure the
// audit confirmed against the real adapters (on a fake socket) and a real
// built Glove, and pins the fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Displaymanager, Glove, MemoryStore, Context, type SubscriberEvent } from "glove-core";
import { GeminiLiveAdapter } from "../src/adapters/gemini-live";
import { OpenAILiveAdapter } from "../src/adapters/openai-live";
import { OpenAIRealtimeAdapter } from "../src/adapters/openai-realtime";
import { realtimeModel } from "../src/create-adapter";
import { RealtimeSession } from "../src/session";
import type { RealtimeEvent } from "../src/types";
import { FakeAdapter, FakeSocket, tick } from "./fakes";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await tick();
}

function gemini(options: { tokenDelay?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const adapter = new GeminiLiveAdapter({
    getToken: async () => {
      const delay = options.tokenDelay?.() ?? 0;
      if (delay) await wait(delay);
      return "k";
    },
    socketFactory: (url) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.setup) queueMicrotask(() => s.receive({ setupComplete: {} }, true));
      });
      sockets.push(socket);
      return socket;
    },
  });
  return { adapter, sockets };
}

function openai(options: { tokenDelay?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const adapter = new OpenAIRealtimeAdapter({
    getToken: async () => {
      if (options.tokenDelay) await wait(options.tokenDelay);
      return "sk";
    },
    socketFactory: (url) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.type === "session.update") queueMicrotask(() => s.receive({ type: "session.updated", session: {} }));
      });
      sockets.push(socket);
      return socket;
    },
  });
  return { adapter, sockets };
}

function glove(store = new MemoryStore("t")) {
  return new Glove({
    model: realtimeModel({ provider: "openai", apiKey: "x" }),
    store,
    displayManager: new Displaymanager(),
    systemPrompt: "You are Nova.",
    compaction_config: { compaction_instructions: "summarize" },
  });
}

const responses = (socket: FakeSocket) => socket.sent.filter((m) => m.toolResponse);

test("Gemini: a tool that changes the tool set still gets its result delivered, on the reconnected session", async () => {
  const { adapter, sockets } = gemini();
  const g = glove();
  g.fold({
    name: "discover",
    description: "folds more tools",
    inputSchema: z.object({}),
    async do() {
      g.fold({ name: "extra", description: "new", inputSchema: z.object({}), async do() { return { status: "success", data: "x" }; } });
      return { status: "success", data: "folded extra" };
    },
  });
  const session = new RealtimeSession({ agent: g.build(), adapter });
  await session.start();
  sockets[0].receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }, true);
  sockets[0].receive({ toolCall: { functionCalls: [{ id: "call-1", name: "discover", args: {} }] } }, true);
  await settle(40);
  assert.equal(sockets.length, 2);
  assert.deepEqual(sockets[1].sent[0].setup.sessionResumption, { handle: "h1" });
  assert.ok(sockets[1].sent[0].setup.tools[0].functionDeclarations.some((d: any) => d.name === "extra"));
  assert.equal(responses(sockets[0]).length, 0);
  assert.equal(responses(sockets[1]).length, 1, "the result reaches the new session");
  await session.stop();
});

for (const kind of ["openai", "gemini"] as const) {
  test(`${kind}: stop() during start() leaves no provider session behind, and the session can start again`, async () => {
    const { adapter, sockets } = kind === "openai" ? openai({ tokenDelay: 30 }) : gemini({ tokenDelay: () => 30 });
    const session = new RealtimeSession({ agent: glove().build(), adapter });
    const started = session.start().then(() => "resolved", (error: Error) => error.name);
    await wait(5);
    await session.stop("hung up");
    assert.equal(await started, "OpenCancelled");
    await wait(50);
    assert.equal(sockets.length, 0, "no socket was created after the cancel");
    assert.equal(adapter.isOpen, false);
    assert.equal(session.state, "closed");
    await session.start();
    assert.equal(session.state, "open");
    await session.stop();
  });
}

test("Gemini: a result that finishes while the session moves before goAway is delivered on the resumed connection", async () => {
  let delay = 0;
  const { adapter, sockets } = gemini({ tokenDelay: () => delay });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const agent = glove().fold({ name: "slow", description: "slow", inputSchema: z.object({}), async do() { await gate; return { status: "success", data: "done" }; } }).build();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  sockets[0].receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }, true);
  sockets[0].receive({ toolCall: { functionCalls: [{ id: "c1", name: "slow", args: {} }] } }, true);
  await settle();
  delay = 30;
  sockets[0].receive({ goAway: { timeLeft: "10s" } }, true);
  await settle();
  release();
  await wait(80);
  assert.equal(responses(sockets[0]).length, 0);
  assert.equal(responses(sockets[1]).length, 1);
  await session.stop();
});

test("a fresh provider session forgets the old resumption handle, so a reconnect can't undo compaction", async () => {
  const adapter = new FakeAdapter({ compaction: { native: true, apply: "reconnect", summarize: false } });
  const session = new RealtimeSession({ agent: glove().build(), adapter, reconnect: { backoffMs: 1 } });
  await session.start();
  adapter.fire({ type: "input.transcript", text: "hello", final: true });
  adapter.fire({ type: "session.resumable", handle: "old-conversation" });
  // The compaction reconnect opens a fresh conversation…
  adapter.fire({ type: "session.opened", resumed: false });
  assert.equal(session.resumeHandle, undefined);
  // …that drops before issuing a handle of its own.
  adapter.isOpen = false;
  adapter.fire({ type: "session.closed", expected: false });
  await settle();
  assert.equal(adapter.opens.at(-1)!.resumeHandle, undefined);
  assert.ok(adapter.opens.at(-1)!.history, "re-seeded from the store instead");
  await session.stop();
});

test("Gemini adapter: opening without a handle clears the one it held", async () => {
  const { adapter, sockets } = gemini();
  await adapter.open({});
  sockets[0].receive({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } }, true);
  await adapter.close();
  await adapter.open({});
  assert.equal(adapter.resumeHandle, undefined);
  await adapter.close();
});

test("compaction keeps every turn: the summary covers all of it, and turns said meanwhile follow the summary", async () => {
  const store = new MemoryStore("c");
  const adapter = new FakeAdapter({ compaction: { native: false, apply: "reconnect", summarize: false } });
  const session = new RealtimeSession({ agent: glove(store).build(), adapter, compaction: { keepRecent: 2 } });
  await session.start();
  for (let i = 1; i <= 4; i++) {
    adapter.fire({ type: "input.transcript", text: `user turn ${i}`, final: true });
    adapter.fire({ type: "output.transcript", text: `agent turn ${i}`, final: true });
  }
  const compacting = session.compact();
  // Said while the summary is being made.
  adapter.fire({ type: "input.transcript", text: "user turn 5", final: true });
  assert.equal(await compacting, true);
  assert.match(adapter.compactions[0].summary, /agent turn 4/, "the summary covers the newest turns too");
  await session.stop();
  const visible = await new Context(store).getMessages();
  assert.ok(visible[0].is_compaction);
  assert.match(visible[0].text, /user turn 4/);
  assert.deepEqual(visible.slice(1).map((m) => m.text), ["user turn 5"]);
});

test("GPT-Live: a socket closing under a tool is reported, not thrown, and captions arrive once", async () => {
  const sockets: FakeSocket[] = [];
  const adapter = new OpenAILiveAdapter({
    getToken: () => "sk",
    socketFactory: (url) => {
      const socket = new FakeSocket(url, (message, s) => {
        if (message.type === "session.start") queueMicrotask(() => s.receive({ type: "session.started" }));
      });
      sockets.push(socket);
      return socket;
    },
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const deltas: string[] = [];
    const session = new RealtimeSession({ agent: glove().fold({ name: "t", description: "t", inputSchema: z.object({}), async do() { return { status: "success", data: 1 }; } }).build(), adapter })
      .addSubscriber({ record: async (type: SubscriberEvent["type"], data: any) => { if (type === "text_delta") deltas.push(data.text); } });
    const errors: string[] = [];
    session.on("error", (error) => errors.push(error.message));
    await session.start();
    const s = sockets[0];
    s.receive({ type: "session.output_transcript.delta", delta: "Hello", start_ms: 0, end_ms: 100 });
    s.receive({ type: "session.output_transcript.delta", delta: " there", start_ms: 100, end_ms: 200 });
    assert.deepEqual(deltas, ["Hello", " there"]);

    const envelope = (event: unknown) => s.receive({ type: "response.event", delegation_id: "d", event });
    envelope({ type: "response.created", response: { id: "r" } });
    envelope({ type: "response.output_item.done", item: { type: "function_call", call_id: "c", name: "t", arguments: "{}" } });
    s.readyState = 2; // CLOSING, before the close event
    envelope({ type: "response.completed", response: { id: "r" } });
    await settle();
    await wait(10);
    assert.deepEqual(unhandled, []);
    assert.ok(errors.some((m) => /not open/.test(m)));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("OpenAI: several calls from one response continue the conversation once, after all results", async () => {
  const { adapter, sockets } = openai();
  const events: RealtimeEvent[] = [];
  adapter.subscribe((e) => events.push(e));
  await adapter.open({});
  const s = sockets[0];
  s.receive({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "a", name: "x", arguments: "{}" });
  s.receive({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "b", name: "x", arguments: "{}" });
  adapter.sendToolResult({ callId: "a", name: "x", output: 1 });
  s.receive({ type: "response.done", response: { id: "r1", status: "completed" } });
  assert.equal(s.ofType("response.create").length, 0, "b is still running");
  adapter.sendToolResult({ callId: "b", name: "x", output: 2 });
  assert.equal(s.ofType("response.create").length, 1);
  await adapter.close();
});

test("a reply never lands in the store ahead of the late transcript of the question it answers", async () => {
  const store = new MemoryStore("order");
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent: glove(store).build(), adapter });
  await session.start();
  adapter.fire({ type: "input.speech_stopped" });
  adapter.fire({ type: "output.transcript", text: "It shipped yesterday.", final: true });
  adapter.fire({ type: "input.transcript", text: "Where is my order?", final: true });
  await session.stop();
  assert.deepEqual((await store.getMessages()).map((m) => m.text), ["Where is my order?", "It shipped yesterday."]);
});

test("a cancelled call withdraws its permission prompt", async () => {
  const displayManager = new Displaymanager();
  const agent = new Glove({
    model: realtimeModel({ provider: "openai", apiKey: "x" }),
    store: new MemoryStore("p"),
    displayManager,
    systemPrompt: "x",
    compaction_config: { compaction_instructions: "s" },
  }).fold({ name: "refund", description: "r", inputSchema: z.object({}), requiresPermission: true, async do() { return { status: "success", data: "ok" }; } }).build();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, permissions: "display" });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "r1", name: "refund", arguments: "{}" });
  await settle();
  assert.equal(displayManager.stack.length, 1);
  adapter.fire({ type: "tool.cancelled", callIds: ["r1"] });
  await settle();
  assert.equal(displayManager.stack.length, 0);
  assert.equal(adapter.results.length, 0);
  await session.stop();
});

test("speech transcribed while a continuous session closes is still saved, and nothing leaks into the next one", async () => {
  const store = new MemoryStore("f");
  const adapter = new FakeAdapter({ transcripts: "continuous" });
  const close = adapter.close.bind(adapter);
  adapter.close = async () => {
    adapter.fire({ type: "transcript.fragment", role: "assistant", text: "goodbye", startMs: 0, endMs: 1 });
    await close();
  };
  const session = new RealtimeSession({ agent: glove(store).build(), adapter });
  await session.start();
  adapter.fire({ type: "transcript.fragment", role: "user", text: "bye", startMs: 0, endMs: 1 });
  await session.stop();
  assert.deepEqual((await store.getMessages()).map((m) => m.text), ["bye", "goodbye"]);
});

test("adapter details from the audit: summary can't call tools, Gemini interrupt tells the provider, GPT-Live respond speaks", async () => {
  const { adapter: oa, sockets: os } = openai();
  await oa.open({});
  void oa.summarize("Summarize.").catch(() => {});
  assert.equal(os[0].ofType("response.create").at(-1).response.tool_choice, "none");
  await oa.close();

  const { adapter: ga, sockets: gs } = gemini();
  await ga.open({});
  ga.interrupt();
  assert.deepEqual(gs[0].sent.at(-1), { clientContent: { turns: [], turnComplete: true } });
  await ga.close();

  const ls: FakeSocket[] = [];
  const la = new OpenAILiveAdapter({
    getToken: () => "sk",
    socketFactory: (url) => {
      const socket = new FakeSocket(url, (m, s) => { if (m.type === "session.start") queueMicrotask(() => s.receive({ type: "session.started" })); });
      ls.push(socket);
      return socket;
    },
    closeTimeoutMs: 10,
  });
  await la.open({});
  la.respond();
  assert.equal(ls[0].ofType("session.commentary.append").length, 1);
  await la.close().catch(() => {});
});

test("OpenAI: a socket that closes during setup rejects open() without reporting a session closed", async () => {
  const adapter = new OpenAIRealtimeAdapter({
    getToken: () => "sk",
    socketFactory: (url) => new FakeSocket(url, (message, s) => {
      if (message.type === "session.update") queueMicrotask(() => s.drop(1008, "bad"));
    }),
  });
  const events: RealtimeEvent[] = [];
  adapter.subscribe((e) => events.push(e));
  await assert.rejects(adapter.open({}), /closed during setup/);
  assert.equal(events.filter((e) => e.type === "session.closed").length, 0);
});
