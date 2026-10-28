// The Glove side, verified against a REAL built Glove (MemoryStore, display
// manager, folded tools) and a fake provider. Every primitive the session
// claims to translate is driven through here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Displaymanager, Glove, MemoryStore, type SubscriberEvent } from "glove-core";
import { realtimeModel } from "../src/create-adapter";
import { RealtimeSession } from "../src/session";
import { FakeAdapter, tick } from "./fakes";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await tick();
}

function buildAgent(options: { serverMode?: boolean; store?: MemoryStore } = {}) {
  const store = options.store ?? new MemoryStore("test");
  const displayManager = new Displaymanager();
  const glove = new Glove({
    model: realtimeModel({ provider: "openai", apiKey: "sk-unused" }),
    store,
    displayManager,
    systemPrompt: "You are Nova.",
    serverMode: options.serverMode,
    compaction_config: { compaction_instructions: "summarize" },
  });
  glove.fold({
    name: "lookup_order",
    description: "Look up an order by id.",
    inputSchema: z.object({ id: z.string() }),
    async do(input) {
      return { status: "success", data: { id: input.id, state: "shipped" }, renderData: { secret: "card-4242" } };
    },
  });
  glove.fold({
    name: "refund",
    description: "Refund an order.",
    inputSchema: z.object({ id: z.string() }),
    requiresPermission: true,
    async do(input) {
      return { status: "success", data: `refunded ${input.id}` };
    },
  });
  const agent = glove.build();
  return { agent, store, displayManager, glove };
}

function recorder() {
  const events: Array<{ type: SubscriberEvent["type"]; data: any }> = [];
  return { events, subscriber: { record: async (type: any, data: any) => { events.push({ type, data }); } } };
}

test("the session is configured from the agent and its model slot", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, excludeTools: ["glove_update_tasks"] });
  await session.start();
  const spec = adapter.opens[0];
  assert.equal(spec.instructions, "You are Nova.");
  const names = spec.tools!.map((t) => t.name);
  assert.ok(names.includes("lookup_order") && names.includes("refund"));
  assert.ok(!names.includes("glove_update_tasks"));
  assert.equal((spec.tools!.find((t) => t.name === "lookup_order")!.parameters as any).type, "object");
  assert.equal(session.state, "open");
  // No adapter passed: the model slot's config builds one.
  assert.equal(new RealtimeSession({ agent }).adapter.provider, "openai");
});

test("a tool call runs through the Executor: result sent, renderData stripped, pair persisted, events fired", async () => {
  const { agent, store } = buildAgent();
  const adapter = new FakeAdapter();
  const { events, subscriber } = recorder();
  const session = new RealtimeSession({ agent, adapter }).addSubscriber(subscriber);
  await session.start();
  adapter.fire({ type: "tool.call", callId: "c1", name: "lookup_order", arguments: '{"id":"42"}' });
  await settle();

  assert.equal(adapter.results.length, 1);
  const output = adapter.results[0].output as any;
  assert.deepEqual(output.data, { id: "42", state: "shipped" });
  assert.equal("renderData" in output, false, "client-only data never reaches the provider");
  assert.deepEqual(events.map((e) => e.type).filter((t) => t.startsWith("tool")), ["tool_use", "tool_use_result"]);
  assert.equal(events.find((e) => e.type === "tool_use_result")!.data.id, "c1");

  const messages = await store.getMessages();
  const call = messages.findIndex((m) => m.tool_calls?.[0]?.id === "c1");
  assert.ok(call >= 0);
  assert.equal(messages[call + 1].tool_results?.[0].call_id, "c1", "result immediately follows its call");
  assert.equal(messages[call + 1].tool_results?.[0].result.renderData && true, true, "the store keeps renderData for the UI");
});

test("bad input gets an answer, never silence", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "bad-json", name: "lookup_order", arguments: "{nope" });
  adapter.fire({ type: "tool.call", callId: "bad-schema", name: "lookup_order", arguments: '{"id":7}' });
  adapter.fire({ type: "tool.call", callId: "unknown", name: "teleport", arguments: "{}" });
  await settle();
  const byId = Object.fromEntries(adapter.results.map((r) => [r.callId, r.output as any]));
  assert.match(byId["bad-json"].message, /not valid JSON/);
  assert.equal(byId["bad-schema"].message, "TOOL_INPUT_INVALID");
  assert.match(byId["unknown"].message, /No tool called teleport/);
});

test("permissions: a serverMode agent denies by default without remembering it", async () => {
  const { agent, store } = buildAgent({ serverMode: true });
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "r1", name: "refund", arguments: '{"id":"42"}' });
  await settle();
  assert.match((adapter.results[0].output as any).message, /Permission denied/);
  assert.equal(await store.getPermission("refund", { id: "42" }), "unset");
});

test("permissions: a policy function decides once, the store remembers", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const asked: unknown[] = [];
  const session = new RealtimeSession({ agent, adapter, permissions: (request) => { asked.push(request); return true; } });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "r1", name: "refund", arguments: '{"id":"42"}' });
  await settle();
  adapter.fire({ type: "tool.call", callId: "r2", name: "refund", arguments: '{"id":"42"}' });
  await settle();
  assert.equal(asked.length, 1);
  assert.deepEqual(adapter.results.map((r) => (r.output as any).data), ["refunded 42", "refunded 42"]);
});

test("permissions: the display policy asks through the display stack", async () => {
  const { agent, displayManager } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, permissions: "display" });
  displayManager.subscribe(async (stack) => {
    const slot = stack.find((s) => s.renderer === "permission_request");
    // A real UI answers later; resolving inside notify() would beat pushAndWait's resolver.
    if (slot) setImmediate(() => displayManager.resolve(slot.id, false));
  });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "r1", name: "refund", arguments: '{"id":"9"}' });
  await settle();
  assert.match((adapter.results[0].output as any).message, /Permission denied/);
});

test("turns are persisted and reach subscribers as model events", async () => {
  const { agent, store } = buildAgent();
  const adapter = new FakeAdapter();
  const { events, subscriber } = recorder();
  const session = new RealtimeSession({ agent, adapter }).addSubscriber(subscriber);
  const said: string[] = [];
  session.on("user_said", (t) => said.push(`user:${t}`));
  session.on("agent_said", (t) => said.push(`agent:${t}`));
  await session.start();
  adapter.fire({ type: "input.transcript", text: "where is my order", final: true });
  adapter.fire({ type: "output.transcript", text: "Let me ", final: false });
  adapter.fire({ type: "output.transcript", text: "Let me check.", final: true });
  await session.stop();
  assert.deepEqual(said, ["user:where is my order", "agent:Let me check."]);
  assert.deepEqual((await store.getMessages()).map((m) => [m.sender, m.text]), [["user", "where is my order"], ["agent", "Let me check."]]);
  assert.ok(events.some((e) => e.type === "text_delta" && e.data.text === "Let me "));
  assert.ok(events.some((e) => e.type === "model_response_complete" && e.data.text === "Let me check."));
});

test("runtime context is injected on open, refreshed after tools, and not repeated when unchanged", async () => {
  const { agent } = buildAgent();
  let stock = 3;
  agent.addContextProvider(() => `Stock: ${stock}`);
  const adapter = new FakeAdapter();
  const { events, subscriber } = recorder();
  const session = new RealtimeSession({ agent, adapter }).addSubscriber(subscriber);
  await session.start();
  await settle();
  assert.equal(adapter.injected.length, 1);
  assert.equal(adapter.injected[0].key, "glove.runtime_context");
  assert.match(adapter.injected[0].text, /Stock: 3/);
  assert.ok(events.some((e) => e.type === "runtime_context"), "the Glove's own event is bridged");

  adapter.fire({ type: "input.speech_started" });
  await settle();
  assert.equal(adapter.injected.length, 1, "unchanged context is not re-sent");

  stock = 2;
  adapter.fire({ type: "tool.call", callId: "c1", name: "lookup_order", arguments: '{"id":"1"}' });
  await settle();
  assert.match(adapter.injected.at(-1)!.text, /Stock: 2/);
});

test("resolved inbox items are announced once and consumed; blocking ones join the snapshot", async () => {
  const { agent, store } = buildAgent();
  await store.addInboxItem({ id: "i1", tag: "warranty", request: "check hull", response: "covered", status: "resolved", blocking: false, created_at: "t0", resolved_at: "t1" });
  await store.addInboxItem({ id: "i2", tag: "approval", request: "manager ok", response: null, status: "pending", blocking: true, created_at: "t0", resolved_at: null });
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();
  const texts = adapter.injected.map((i) => i.text);
  assert.ok(texts.some((t) => /resolved/.test(t) && /covered/.test(t)));
  assert.ok(texts.some((t) => /blocking item/.test(t) && /manager ok/.test(t)));
  assert.equal((await store.getInboxItems()).find((i) => i.id === "i1")!.status, "consumed");
  await session.refreshContext(true);
  assert.equal(adapter.injected.filter((i) => /covered/.test(i.text)).length, 1);
});

test("a tool folded mid-call is registered with the provider before the result goes back", async () => {
  const { agent, glove } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  glove.fold({
    name: "activate_billing",
    description: "Turn on billing tools.",
    inputSchema: z.object({}),
    async do() {
      glove.fold({ name: "charge", description: "Charge a card.", inputSchema: z.object({ cents: z.number() }), async do() { return { status: "success", data: "ok" }; } });
      return { status: "success", data: "billing on" };
    },
  });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "a", name: "activate_billing", arguments: "{}" });
  await settle();
  assert.equal(adapter.toolUpdates.length, 1);
  assert.ok(adapter.toolUpdates[0].some((t) => t.name === "charge"));
});

test("fresh sessions are seeded from the store; resumed ones aren't", async () => {
  const store = new MemoryStore("seed");
  await store.appendMessages([
    { sender: "user", text: "my name is Ada" },
    { sender: "agent", text: "Hi Ada" },
    { sender: "agent", text: "", tool_calls: [{ tool_name: "lookup_order", input_args: { id: "7" }, id: "x" }] },
    { sender: "user", text: "tool results", tool_results: [{ tool_name: "lookup_order", call_id: "x", result: { status: "success", data: "shipped" } }] },
  ]);
  const { agent } = buildAgent({ store });
  const adapter = new FakeAdapter();
  await new RealtimeSession({ agent, adapter }).start();
  assert.deepEqual(adapter.opens[0].history!.map((h) => h.role), ["user", "assistant", "system", "system"]);
  assert.match(adapter.opens[0].history![3].text, /returned: shipped/);

  const resumed = new FakeAdapter();
  await new RealtimeSession({ agent, adapter: resumed }).start({ resumeHandle: "h9" });
  assert.equal(resumed.opens[0].resumeHandle, "h9");
  assert.equal(resumed.opens[0].history, undefined);
});

test("an unexpected close reconnects, resuming with the latest handle", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, reconnect: { backoffMs: 1 } });
  const states: string[] = [];
  session.on("state", (s) => states.push(s));
  await session.start();
  adapter.fire({ type: "session.resumable", handle: "h1" });
  adapter.isOpen = false;
  adapter.fire({ type: "session.closed", expected: false, reason: "network" });
  await settle();
  assert.equal(adapter.opens.length, 2);
  assert.equal(adapter.opens[1].resumeHandle, "h1");
  assert.deepEqual(states, ["connecting", "open", "reconnecting", "open"]);
});

test("a failed resume falls back to a seeded session, and exhaustion ends the session", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, reconnect: { attempts: 2, backoffMs: 1 } });
  const ended: string[] = [];
  session.on("ended", (r) => ended.push(r));
  session.on("error", () => {});
  await session.start();
  adapter.fire({ type: "session.resumable", handle: "h1" });
  adapter.failOpens = 1;
  adapter.isOpen = false;
  adapter.fire({ type: "session.closed", expected: false });
  await wait(30);
  assert.equal(adapter.opens[1].resumeHandle, "h1");
  assert.equal(adapter.opens[2].resumeHandle, undefined, "second attempt seeds instead of resuming");
  assert.equal(session.state, "open");

  adapter.failOpens = 5;
  adapter.isOpen = false;
  adapter.fire({ type: "session.closed", expected: false, reason: "gone" });
  await wait(50);
  assert.equal(session.state, "closed");
  assert.deepEqual(ended, ["gone"]);
});

test("goAway moves to a resumed connection before the provider cuts it", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  adapter.fire({ type: "session.resumable", handle: "h2" });
  adapter.fire({ type: "session.going_away", timeLeftMs: 5000 });
  await settle();
  assert.equal(adapter.closes, 1);
  assert.equal(adapter.opens.at(-1)!.resumeHandle, "h2");
  assert.equal(session.state, "open");
});

test("a result for a call from a replaced conversation is dropped", async () => {
  const { agent, glove } = buildAgent();
  let release!: () => void;
  glove.fold({ name: "slow", description: "slow", inputSchema: z.object({}), async do() { await new Promise<void>((r) => { release = r; }); return { status: "success", data: "late" }; } });
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  adapter.fire({ type: "tool.call", callId: "s1", name: "slow", arguments: "{}" });
  await settle();
  adapter.fire({ type: "session.opened", resumed: false });
  release();
  await settle();
  assert.equal(adapter.results.length, 0);
});

test("a provider cancellation aborts the call and sends nothing", async () => {
  const { agent, glove } = buildAgent();
  let sawAbort = false;
  glove.fold({
    name: "research",
    description: "slow",
    inputSchema: z.object({}),
    async do(_input, _display, _glove, signal) {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => { sawAbort = true; resolve(); }));
      return { status: "success", data: "too late" };
    },
  });
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, nonBlockingTools: ["research"] });
  await session.start();
  assert.equal(adapter.opens[0].tools!.find((t) => t.name === "research")!.behavior, "non_blocking");
  adapter.fire({ type: "tool.call", callId: "n1", name: "research", arguments: "{}" });
  await settle();
  adapter.fire({ type: "tool.cancelled", callIds: ["n1"] });
  await settle();
  assert.equal(sawAbort, true);
  assert.equal(adapter.results.length, 0);
});

test("over the context limit: the adapter summarises, applies it, and the store records the compaction", async () => {
  const { agent, store } = buildAgent();
  agent.addContextProvider(() => "Order 42: shipped");
  const adapter = new FakeAdapter();
  const { events, subscriber } = recorder();
  const session = new RealtimeSession({ agent, adapter, compaction: { contextLimit: 1000, keepRecent: 1 } }).addSubscriber(subscriber);
  await session.start();
  adapter.fire({ type: "input.transcript", text: "I want a refund", final: true });
  adapter.fire({ type: "output.transcript", text: "Sure.", final: true });
  adapter.fire({ type: "usage", usage: { tokensIn: 900, tokensOut: 200, contextTokens: 1100 } });
  await settle(10);

  assert.equal(adapter.summaries.length, 1);
  assert.equal(adapter.compactions[0].summary, adapter.summary);
  assert.deepEqual(adapter.compactions[0].recent, [{ role: "assistant", text: "Sure." }]);
  const messages = await store.getMessages();
  assert.ok(messages.at(-1)!.is_compaction);
  assert.match(messages.at(-1)!.text, /refund for order 42/);
  assert.deepEqual(events.map((e) => e.type).filter((t) => t.startsWith("compaction")), ["compaction_start", "compaction_end"]);
  assert.ok(events.some((e) => e.type === "token_consumption" && e.data.consumption.tokens_in === 900));
  const snapshots = adapter.injected.filter((i) => i.key === "glove.runtime_context");
  assert.equal(snapshots.length, 2, "the unchanged snapshot is re-sent after compaction");
});

test("without a self-summarising adapter, the transcript is the summary", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter({ compaction: { native: false, apply: "reconnect", summarize: false } });
  const session = new RealtimeSession({ agent, adapter, compaction: { keepRecent: 1 } });
  await session.start();
  adapter.fire({ type: "input.transcript", text: "first thing", final: true });
  adapter.fire({ type: "output.transcript", text: "noted", final: true });
  assert.equal(await session.compact(), true);
  assert.match(adapter.compactions[0].summary, /user: first thing/);
});

test("a provider that can't apply a summary reports false", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter({ compaction: { native: true, apply: "none", summarize: false } });
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  assert.equal(await session.compact(), false);
});

test("continuous fragments become turns at each change of speaker", async () => {
  const { agent, store } = buildAgent();
  const adapter = new FakeAdapter({ transcripts: "continuous" });
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  for (const [role, text] of [["user", "is it "], ["user", "shipped"], ["assistant", "yes, "], ["assistant", "today"], ["user", "thanks"]] as const) {
    adapter.fire({ type: "transcript.fragment", role, text, startMs: 0, endMs: 1 });
  }
  await session.stop();
  assert.deepEqual((await store.getMessages()).map((m) => [m.sender, m.text]), [["user", "is it shipped"], ["agent", "yes, today"], ["user", "thanks"]]);
});

test("modalities are checked against the adapter's declared capabilities", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter({ input: ["audio", "text"], output: ["audio"] });
  assert.throws(() => new RealtimeSession({ agent, adapter, output: "text" }), /can't produce text/);
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  assert.throws(() => session.sendImage("AAAA"), /takes no image input/);
});

test("runtime images are sent as media once", async () => {
  const { agent } = buildAgent();
  agent.addContextProvider(() => [{ type: "text", text: "screen" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]);
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();
  await session.refreshContext(true);
  assert.equal(adapter.media.length, 1);
  assert.equal(adapter.media[0].mimeType, "image/png");
});

test("stop() during a reconnect doesn't leave a provider session running", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, reconnect: { backoffMs: 1 } });
  await session.start();
  let finishOpen!: () => void;
  const open = adapter.open.bind(adapter);
  adapter.open = async (spec) => {
    await new Promise<void>((resolve) => { finishOpen = resolve; });
    return open(spec);
  };
  adapter.isOpen = false;
  adapter.fire({ type: "session.closed", expected: false });
  await settle();
  await session.stop();
  finishOpen();
  await settle();
  assert.equal(session.state, "closed");
  assert.equal(adapter.isOpen, false);
});
