/**
 * voiceCall's addressed events with a hand-driven adapter and context: the
 * timing cases a real child cannot pin down (speech starting while facts are
 * read, a failing event beside a delegation update, cleanup mid-preparation).
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { AgentEvent, IGloveRunnable, Message } from "glove-core";
import type { S2SAdapter, S2SEvents, S2SSessionConfig } from "glove-voice-s2s";
import type { AgentHandlerContext } from "../src/definition.js";
import type { FoundryDelegationUpdate } from "../src/delegation.js";
import type { FoundryHandledEvent } from "../src/event-delivery.js";
import type { FoundryEventReceipt } from "../src/event-receipts.js";
import { MemoryFoundryDataAdapter } from "../src/primitives.js";
import { voiceCall, type FoundryVoiceCall, type FoundryVoiceRoom, type VoiceCallEvents } from "../src/voice.js";
import { Effect } from "effect";

class FakeAdapterBase extends EventEmitter {
  override emit<E extends keyof S2SEvents>(event: E, ...args: S2SEvents[E]): boolean { return super.emit(event, ...args); }
}
class FakeAdapterImpl extends FakeAdapterBase {
  readonly mode = "transport" as const;
  readonly inputFormat = { sampleRate: 16_000, channels: 1 as const, encoding: "pcm_s16le" as const };
  connected = false;
  injected: Array<{ text: string; respond?: boolean; role?: string }> = [];
  get isConnected() { return this.connected; }
  async connect(_config?: S2SSessionConfig) { this.connected = true; }
  async disconnect() { this.connected = false; }
  sendAudio() {}
  injectText(text: string, opts?: { respond?: boolean; role?: "user" | "system" }) { this.injected.push({ text, ...opts }); }
  sendToolResult() {}
  updateSession() {}
  interrupt() {}
}
type FakeAdapter = FakeAdapterImpl & S2SAdapter;
const FakeAdapter = FakeAdapterImpl as unknown as new () => FakeAdapter;

function fakeAgent(saved: Message[]): IGloveRunnable {
  return {
    tools: [],
    getSystemPrompt: () => "You are Nova.",
    store: {
      getMessages: async () => [...saved],
      appendMessages: async (messages: Message[]) => { saved.push(...messages); },
    },
  } as unknown as IGloveRunnable;
}

interface Delivery { readonly handled: FoundryHandledEvent; acked: boolean }

function fakeContext(data = new MemoryFoundryDataAdapter(), options: { runId?: string; eventTurn?: boolean; events?: AgentEvent[] } = {}) {
  const emitted: Array<{ type: string; data?: unknown }> = [];
  const controller = new AbortController();
  let onEvent: ((handled: FoundryHandledEvent) => void | Promise<void>) | undefined;
  let deliverUpdates: ((updates: ReadonlyArray<FoundryDelegationUpdate>) => void | Promise<void>) | undefined;
  const calls = new Set<Promise<void>>();
  const deliveries: Delivery[] = [];
  const context = {
    runId: options.runId ?? "run_one",
    agentId: "agent_voice",
    conversationId: "conversation_voice",
    workspaceId: "workspace",
    request: { source: { kind: options.eventTurn ? "agent-message" : "direct" } },
    messageText: "",
    data,
    eventTurn: options.eventTurn ?? false,
    events: options.events ?? [],
    signal: controller.signal,
    emit: (event: { type: string; data?: unknown }) => { emitted.push(event); },
    onDelegationUpdate: (handler: typeof deliverUpdates) => { deliverUpdates = handler; return async () => { deliverUpdates = undefined; }; },
    onMeshMessage: () => async () => {},
    onEvent: (handler: typeof onEvent) => {
      onEvent = handler;
      for (const event of options.events ?? []) deliver(event, true);
      return async () => { onEvent = undefined; while (calls.size) await Promise.allSettled([...calls]); };
    },
  } as unknown as AgentHandlerContext;
  function deliver(event: AgentEvent, initial = false): Delivery {
    const delivery: Delivery = {
      acked: false,
      handled: { id: `record_${event.id}`, event, initial, ack: () => { delivery.acked = true; } },
    };
    deliveries.push(delivery);
    const call = Promise.resolve(onEvent?.(delivery.handled)).then(() => undefined);
    calls.add(call);
    void call.finally(() => calls.delete(call));
    return delivery;
  }
  return {
    context, emitted, deliveries, data,
    event: (event: AgentEvent) => deliver(event),
    update: (update: FoundryDelegationUpdate) => deliverUpdates!([update]),
    listening: () => Boolean(onEvent),
  };
}

function handRoom() {
  let call!: FoundryVoiceCall;
  let markOpened!: () => void;
  const opened = new Promise<void>((resolveOpened) => { markOpened = resolveOpened; });
  const room: FoundryVoiceRoom = { open: (value) => { call = value; markOpened(); }, close: () => {} };
  return { room, opened, get call() { return call; } };
}

const tick = (ms = 10) => new Promise((resolveTick) => setTimeout(resolveTick, ms));
const notice = (id: string, content = `notice ${id}`): AgentEvent => ({ id, source: "mez:meetings", kind: "meeting", content });

async function openCall(events: VoiceCallEvents, data = new MemoryFoundryDataAdapter(), runId = "run_one") {
  const adapter = new FakeAdapter();
  const saved: Message[] = [];
  const room = handRoom();
  const harness = fakeContext(data, { runId });
  const running = voiceCall({ room: room.room, events, realtime: { adapter } })(fakeAgent(saved), harness.context);
  await room.opened;
  room.call.joined();
  return { adapter, saved, room, ...harness, running, end: async () => { room.call.end("done"); return running; } };
}

const receipt = (data: MemoryFoundryDataAdapter, id: string) => Effect.runPromise(data.getEventReceipt(`record_${id}`));

test("speech that starts while facts are read holds the event; the next pause reads them again", async () => {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const call = await openCall({
    accept: () => true,
    prepare: async () => { reads++; if (reads === 1) await gate; return { say: `fact read ${reads}` }; },
  });
  call.event(notice("busy"));
  await tick();
  call.adapter.emit("user_speech_started");
  release();
  await tick(30);
  assert.equal(call.adapter.injected.length, 0, "never over the caller");
  assert.equal((await receipt(call.data, "busy"))?.status, "queued");
  call.adapter.emit("user_speech_stopped");
  await tick(30);
  assert.deepEqual(call.adapter.injected, [{ text: "fact read 2", respond: true, role: "system" }]);
  await call.end();
  assert.equal(call.deliveries[0]!.acked, true);
});

test("a failing event does not hold up a delegation update or other events", async () => {
  const call = await openCall({
    accept: () => true,
    prepare: async (event) => { if (event.id === "broken") throw new Error("lookup failed"); return { say: `told ${event.id}` }; },
  });
  call.event(notice("broken"));
  call.event(notice("fine"));
  await call.update({ kind: "result", delegationId: "delegation_1", agent: "coder", task: "Fix the login bug", result: "Fixed." } as unknown as FoundryDelegationUpdate);
  await tick(50);
  const texts = call.adapter.injected.map((item) => item.text);
  assert.ok(texts.some((text) => /Fix the login bug/.test(text)), "the delegation update was spoken");
  assert.ok(texts.includes("told fine"));
  assert.ok(!texts.some((text) => /broken/.test(text)));
  assert.ok(call.emitted.some((event) => event.type === "foundry.voice.event.prepare.failed"));
  await call.end();
  assert.deepEqual(call.deliveries.map((item) => item.acked), [false, true], "the failed event stays unacknowledged");
  assert.equal((await receipt(call.data, "broken"))?.status, "queued", "proof that nothing was attempted");
});

test("a mixed batch acknowledges only finished events: accepted before, suppressed now, unresolved left", async () => {
  const data = new MemoryFoundryDataAdapter();
  const now = new Date().toISOString();
  const base = { agentId: "agent_voice", conversationId: "conversation_voice", workspaceId: "workspace", createdAt: now, updatedAt: now };
  await Effect.runPromise(data.putEventReceipt({ ...base, id: "record_said", eventId: "said", status: "accepted", text: "Said before.", generation: "run_old/call_old", transcriptMessageId: "foundry-event:record_said" }));
  const call = await openCall({
    accept: () => true,
    prepare: async (event) => {
      if (event.id === "gone") return { suppress: "cancelled" };
      throw new Error("not yet");
    },
  }, data);
  call.event(notice("said"));
  call.event(notice("gone"));
  call.event(notice("open"));
  await tick(50);
  await call.end();
  assert.deepEqual(call.deliveries.map((item) => [item.handled.event.id, item.acked]), [["said", true], ["gone", true], ["open", false]]);
  assert.equal(call.adapter.injected.length, 0, "an accepted event is never told again");
  assert.equal((await receipt(data, "gone"))?.status, "suppressed");
  assert.equal((await receipt(data, "open"))?.status, "queued");
});

test("ending the call waits for a preparation in progress and tells nothing after", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const call = await openCall({ accept: () => true, prepare: async () => { await gate; return { say: "too late" }; } });
  call.event(notice("late"));
  await tick();
  const ended = call.end();
  await tick(20);
  release();
  await ended;
  assert.equal(call.listening(), false);
  await tick(50);
  assert.equal(call.adapter.injected.length, 0);
  assert.equal(call.deliveries[0]!.acked, false);
  assert.equal((await receipt(call.data, "late"))?.status, "queued");
});

test("an uncertain dispatch from another call stays held unless the product resolves it", async () => {
  const data = new MemoryFoundryDataAdapter();
  const now = new Date().toISOString();
  const base = { agentId: "agent_voice", conversationId: "conversation_voice", workspaceId: "workspace", createdAt: now, updatedAt: now };
  for (const id of ["held", "confirmed"]) {
    await Effect.runPromise(data.putEventReceipt({ ...base, id: `record_${id}`, eventId: id, status: "dispatching", text: `${id} text`, generation: "run_old/call_old" }));
  }
  const afterCall: string[] = [];
  const call = await openCall({
    accept: () => true,
    afterCall: async (event) => { afterCall.push(event.id); },
    resolveUncertain: async (stored: FoundryEventReceipt) => (stored.eventId === "confirmed" ? "accepted" : undefined),
  }, data, "run_two");
  call.event(notice("held"));
  call.event(notice("confirmed"));
  await tick(50);
  await call.end();
  assert.equal(call.adapter.injected.length, 0, "never told again");
  assert.deepEqual(afterCall, [], "never sent to chat instead");
  assert.deepEqual(call.deliveries.map((item) => item.acked), [false, true]);
  assert.equal((await receipt(data, "held"))?.status, "dispatching");
  const confirmed = await receipt(data, "confirmed");
  assert.equal(confirmed?.status, "accepted");
  assert.equal(call.saved.filter((item) => item.id === confirmed?.transcriptMessageId).length, 1, "its transcript line written once");
});

test("a late-chat effect that fails keeps the event redirecting under the same effect id", async () => {
  const data = new MemoryFoundryDataAdapter();
  const effects: string[] = [];
  let fail = true;
  const events: VoiceCallEvents = {
    accept: () => true,
    afterCall: async (_event, context) => { effects.push(context.effectId); if (fail) throw new Error("chat is down"); },
  };
  const first = await openCall(events, data);
  first.adapter.emit("agent_speech_started");
  first.event(notice("later"));
  await tick(20);
  await first.end();
  assert.equal(first.deliveries[0]!.acked, false);
  assert.equal((await receipt(data, "later"))?.status, "redirecting");

  fail = false;
  const harness = fakeContext(data, { runId: "run_two", eventTurn: true, events: [notice("later")] });
  const result = await voiceCall({ room: handRoom().room, events, realtime: { adapter: new FakeAdapter() } })(fakeAgent([]), harness.context);
  assert.equal((result as { endedBecause: string }).endedBecause, "not a call");
  assert.equal(effects.length, 2);
  assert.equal(effects[0], effects[1], "the same effect, retried");
  assert.equal(harness.deliveries[0]!.acked, true);
  assert.equal((await receipt(data, "later"))?.status, "redirected");
});

test("receipts: one claim wins, and the file adapter keeps them across reloads", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileFoundryDataAdapter } = await import("../src/file-data.js");
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-receipts-"));
  try {
    const now = new Date().toISOString();
    const queued: FoundryEventReceipt = {
      id: "record_x", eventId: "x", agentId: "agent", conversationId: "conversation", workspaceId: "workspace",
      status: "queued", createdAt: now, updatedAt: now,
    };
    const file = join(directory, "foundry.json");
    const claims = await Promise.all(Array.from({ length: 6 }, () =>
      Effect.runPromise(new FileFoundryDataAdapter({ file }).claimEventReceipt(queued))));
    assert.equal(claims.filter(Boolean).length, 1);
    await Effect.runPromise(new FileFoundryDataAdapter({ file }).putEventReceipt({ ...queued, status: "accepted", text: "said" }));
    const reloaded = new FileFoundryDataAdapter({ file });
    assert.equal((await Effect.runPromise(reloaded.getEventReceipt("record_x")))?.status, "accepted");
    assert.equal((await Effect.runPromise(reloaded.listEventReceipts({ status: "accepted" }))).length, 1);
    assert.deepEqual(await Effect.runPromise(reloaded.listWorkspaceEntries("workspace")), []);

    const memory = new MemoryFoundryDataAdapter();
    const memoryClaims = await Promise.all(Array.from({ length: 6 }, () => Effect.runPromise(memory.claimEventReceipt(queued))));
    assert.equal(memoryClaims.filter(Boolean).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
