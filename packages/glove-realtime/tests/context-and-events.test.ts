// glove-core's context deliveries and spontaneous events on a live call:
// "request" context frozen per user turn, "history" context saved to the
// store when it changes, events joining the call instead of waking the text
// model, and async permission predicates.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Context, Displaymanager, Glove, MemoryStore, type SubscriberEvent } from "glove-core";
import { realtimeModel } from "../src/create-adapter";
import { RealtimeSession } from "../src/session";
import { toHistory } from "../src/translate";
import { FakeAdapter, tick } from "./fakes";

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await tick();
}

function buildAgent() {
  const store = new MemoryStore("ctx");
  const glove = new Glove({
    model: realtimeModel({ provider: "openai", apiKey: "sk-unused" }),
    store,
    displayManager: new Displaymanager(),
    systemPrompt: "You are Nova.",
    compaction_config: { compaction_instructions: "summarize" },
  });
  let refundGated = false;
  glove.fold({
    name: "lookup_order",
    description: "Look up an order by id.",
    inputSchema: z.object({ id: z.string() }),
    async do(input) {
      return { status: "success", data: { id: input.id, state: "shipped" } };
    },
  });
  glove.fold({
    name: "refund",
    description: "Refund an order.",
    inputSchema: z.object({ id: z.string() }),
    // Async predicate: gate only when the lookup says so.
    requiresPermission: async () => refundGated,
    async do(input) {
      return { status: "success", data: `refunded ${input.id}` };
    },
  });
  const agent = glove.build();
  const events: Array<{ type: SubscriberEvent["type"]; data: any }> = [];
  agent.addSubscriber({ record: async (type, data) => { events.push({ type, data }); } });
  return { agent, store, events, gate: (on: boolean) => { refundGated = on; } };
}

const snapshots = (adapter: FakeAdapter) =>
  adapter.injected.filter((i) => i.key === "glove.runtime_context").map((i) => i.text);

test("an event emitted during a call joins the call at a pause instead of waking the text model", async () => {
  const { agent, store, events } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();

  // The agent is speaking: the event waits for the pause.
  adapter.fire({ type: "response.started" });
  const disposition = await agent.emitEvent({ id: "d1", source: "foundry:researcher", content: "The report is ready." });
  assert.equal(disposition, "queued");
  await settle();
  assert.equal(adapter.injected.filter((i) => /report is ready/.test(i.text)).length, 0);

  adapter.fire({ type: "response.done", status: "completed" });
  await settle();
  const delivered = adapter.injected.filter((i) => /report is ready/.test(i.text));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].respond, true, "a quiet call hears it as a wake would");
  assert.match(delivered[0].text, /<events note=/);

  // No wake was attempted on the placeholder model, and history has it once.
  assert.ok(!events.some((e) => e.type === "event_wake_failed"));
  assert.deepEqual(events.filter((e) => e.type === "event_injected").map((e) => e.data.phase), ["loop"]);
  await session.stop();
  const saved = (await store.getMessages()).filter((m) => m.framework_context === "event");
  assert.equal(saved.length, 1);
});

test("an event that arrives during a tool call goes in silently before the result", async () => {
  const { agent, store } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  agent.fold({
    name: "slow",
    description: "Slow.",
    inputSchema: z.object({}),
    async do() {
      await blocked;
      return { status: "success", data: "done" };
    },
  });
  await session.start();
  await settle();

  adapter.fire({ type: "tool.call", callId: "c1", name: "slow", arguments: "{}" });
  await settle();
  await agent.emitEvent({ id: "e1", source: "webhook:stripe", content: "Payment captured." });
  await settle();
  assert.equal(adapter.injected.filter((i) => /Payment captured/.test(i.text)).length, 0, "not while a call runs");

  release();
  await settle();
  const index = adapter.injected.findIndex((i) => /Payment captured/.test(i.text));
  assert.ok(index >= 0);
  assert.equal(adapter.injected[index].respond, false, "the result's response covers it");
  assert.equal(adapter.results.length, 1);
  await session.stop();

  // Saved once, after the call and its result, as a text turn saves it.
  const messages = await store.getMessages();
  const event = messages.findIndex((m) => m.framework_context === "event");
  const result = messages.findIndex((m) => m.tool_results?.length);
  assert.ok(result >= 0 && event > result);
});

test("events deferred before the call go in silently when it opens; the queue is released when it ends", async () => {
  const { agent, events } = buildAgent();
  agent.notifyUserActivity(); // a present user: the default policy defers
  assert.equal(await agent.emitEvent({ id: "early", source: "app:calendar", content: "Meeting moved to 3pm." }), "deferred");

  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();
  const early = adapter.injected.find((i) => /Meeting moved/.test(i.text));
  assert.ok(early);
  assert.equal(early.respond, false);
  assert.deepEqual(events.filter((e) => e.type === "event_injected").map((e) => e.data.phase), ["request"]);

  await session.stop();
  // After the call the agent's own policy decides again.
  agent.notifyUserActivity();
  assert.equal(await agent.emitEvent({ id: "late", source: "app:calendar", content: "Cancelled." }), "deferred");
});

test("events: false leaves events to the agent's policy", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, events: false });
  await session.start();
  agent.notifyUserActivity();
  assert.equal(await agent.emitEvent({ id: "x", source: "app", content: "hi" }), "deferred");
  await session.stop();
});

test("speaking marks the user present for the agent's event policy", async () => {
  const { agent } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  adapter.fire({ type: "input.speech_started" });
  await session.stop();
  // Right after the call the user is still counted as present.
  assert.equal(await agent.emitEvent({ id: "after", source: "app", content: "later" }), "deferred");
});

test("request context is read at each user turn, iteration context after every tool too", async () => {
  const { agent } = buildAgent();
  let request = 0;
  let iteration = 0;
  agent.addContextProvider(() => `request read ${++request}`, { delivery: "request" });
  agent.addContextProvider(() => `iteration read ${++iteration}`);
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();
  assert.match(snapshots(adapter).at(-1)!, /request read 1[\s\S]*iteration read 1/);

  adapter.fire({ type: "tool.call", callId: "t1", name: "lookup_order", arguments: '{"id":"7"}' });
  await settle();
  assert.match(snapshots(adapter).at(-1)!, /request read 1[\s\S]*iteration read 2/, "frozen between tool steps");

  adapter.fire({ type: "input.speech_started" });
  await settle();
  assert.match(snapshots(adapter).at(-1)!, /request read 2[\s\S]*iteration read 3/);
  await session.stop();
});

test("history context is saved to the store when it changes and told to the call once", async () => {
  const { agent, store } = buildAgent();
  let plan = "Plan: refund order 42";
  agent.addContextProvider(() => plan, { delivery: "history", key: "plan" });
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter });
  await session.start();
  await settle();

  const told = () => adapter.injected.filter((i) => /<context key="plan">/.test(i.text));
  assert.equal(told().length, 1);
  assert.equal(told()[0].key, undefined, "it ages into the conversation, not superseded");
  assert.ok(!snapshots(adapter).some((text) => /Plan:/.test(text)), "not in the transient snapshot");

  adapter.fire({ type: "input.speech_started" });
  await settle();
  assert.equal(told().length, 1, "unchanged: not saved or told again");

  plan = "Plan: refund order 42, then email the receipt";
  adapter.fire({ type: "input.speech_started" });
  await settle();
  assert.equal(told().length, 2);
  await session.stop();

  const saved = (await new Context(store).getMessages()).filter((m) => m.context_key === "plan");
  assert.equal(saved.length, 2);
  // A fresh provider session is seeded with what was saved.
  const seeded = toHistory(await new Context(store).getMessages());
  assert.ok(seeded.some((item) => item.role === "system" && /email the receipt/.test(item.text)));
});

test("an async requiresPermission predicate is awaited", async () => {
  const { agent, gate } = buildAgent();
  const adapter = new FakeAdapter();
  const session = new RealtimeSession({ agent, adapter, permissions: "deny" });
  await session.start();

  gate(false);
  adapter.fire({ type: "tool.call", callId: "r1", name: "refund", arguments: '{"id":"42"}' });
  await settle();
  assert.equal((adapter.results[0].output as any).status, "success", "a predicate resolving false doesn't gate");

  gate(true);
  adapter.fire({ type: "tool.call", callId: "r2", name: "refund", arguments: '{"id":"43"}' });
  await settle();
  assert.equal((adapter.results[1].output as any).status, "error");
  await session.stop();
});
