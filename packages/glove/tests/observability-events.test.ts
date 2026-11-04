import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  Displaymanager,
  Glove,
  MemoryStore,
  ToolPermissionDeferred,
  type Message,
  type ModelAdapter,
  type Slot,
  type SubscriberEvent,
} from "../src/index";

type Recorded = { type: SubscriberEvent["type"]; data: any; at: number };

/** One answer per model call, streamed the way a real adapter streams it. */
function streaming(...answers: Array<Message>): ModelAdapter {
  return {
    name: "streaming",
    setSystemPrompt() {},
    async prompt(_request, notify) {
      const answer = answers.shift();
      if (!answer) throw new Error("The model was called more times than scripted.");
      if (answer.text) await notify("text_delta", { text: answer.text });
      for (const call of answer.tool_calls ?? []) await notify("tool_use", { id: call.id!, name: call.tool_name, input: call.input_args });
      await notify("model_response_complete", { text: answer.text, tool_calls: answer.tool_calls, stop_reason: answer.tool_calls?.length ? "tool_use" : "end_turn" });
      return { messages: [answer], tokens_in: 1, tokens_out: 1 };
    },
  };
}

function record(target: { addSubscriber(s: any): unknown }, modelRequests = false): Recorded[] {
  const seen: Recorded[] = [];
  target.addSubscriber({ modelRequests, async record(type: SubscriberEvent["type"], data: unknown) { seen.push({ type, data, at: Date.now() }); } });
  return seen;
}

function make(model: ModelAdapter, store = new MemoryStore("observability"), displayManager = new Displaymanager()) {
  return new Glove({ model, store, displayManager, systemPrompt: "You help.", compaction_config: { compaction_instructions: "Summarize" } });
}

test("a request is bracketed by turn_start and turn_end", async () => {
  const builder = make(streaming({ sender: "agent", text: "Hello." }));
  const seen = record(builder);
  await builder.build().processRequest("Hi");
  const start = seen.find((e) => e.type === "turn_start")!;
  const end = seen.find((e) => e.type === "turn_end")!;
  assert.equal(seen[0].type, "turn_start", "the turn opens before anything else it does");
  assert.equal(seen.at(-1)!.type, "turn_end", "and closes after everything");
  assert.equal(start.data.trigger, "request");
  assert.equal(end.data.turn_id, start.data.turn_id);
  assert.equal(end.data.status, "success");
  assert.ok(end.data.duration_ms >= 0);
});

test("a failed turn ends with its error and still throws it", async () => {
  const builder = make({ name: "down", setSystemPrompt() {}, async prompt() { throw new Error("provider overloaded"); } });
  const seen = record(builder);
  await assert.rejects(builder.build().processRequest("Hi"), /provider overloaded/);
  const end = seen.find((e) => e.type === "turn_end")!;
  assert.equal(end.data.status, "error");
  assert.equal(end.data.error, "provider overloaded");
});

test("streamed events carry the request they belong to", async () => {
  const builder = make(streaming(
    { sender: "agent", text: "Looking.", tool_calls: [{ id: "c1", tool_name: "look_up", input_args: { city: "Lisbon" } }] },
    { sender: "agent", text: "Sunny." },
  ));
  builder.fold({ name: "look_up", description: "Weather", inputSchema: z.object({ city: z.string() }), do: async () => ({ status: "success", data: "sunny" }) });
  const seen = record(builder, true);
  await builder.build().processRequest("Weather in Lisbon?");
  const [first, second] = seen.filter((e) => e.type === "model_request").map((e) => e.data.request_id);
  assert.notEqual(first, second);
  const tagged = (type: string) => seen.filter((e) => e.type === type).map((e) => e.data.request_id);
  assert.deepEqual(tagged("text_delta"), [first, second]);
  assert.deepEqual(tagged("tool_use"), [first]);
  assert.deepEqual(tagged("model_response_complete"), [first, second]);
});

test("subscribers that don't watch requests still see which request streamed", async () => {
  const builder = make(streaming({ sender: "agent", text: "Hello." }));
  const seen = record(builder);
  await builder.build().processRequest("Hi");
  assert.equal(typeof seen.find((e) => e.type === "text_delta")!.data.request_id, "string");
});

test("tool_use_start marks when a call runs, after the calls ahead of it", async () => {
  const builder = make(streaming(
    { sender: "agent", text: "", tool_calls: [
      { id: "slow", tool_name: "wait", input_args: { ms: 30 } },
      { id: "next", tool_name: "wait", input_args: { ms: 0 } },
    ] },
    { sender: "agent", text: "Done." },
  ));
  builder.fold({ name: "wait", description: "Wait", inputSchema: z.object({ ms: z.number() }), do: async ({ ms }) => { await new Promise((r) => setTimeout(r, ms)); return { status: "success", data: ms }; } });
  const seen = record(builder);
  await builder.build().processRequest("Go");
  const starts = seen.filter((e) => e.type === "tool_use_start");
  assert.deepEqual(starts.map((e) => e.data.id), ["slow", "next"]);
  assert.deepEqual(starts[0].data.input, { ms: 30 });
  assert.ok(starts[0].data.waited_ms >= 0);
  const asked = seen.find((e) => e.type === "tool_use" && e.data.id === "next")!;
  const slowDone = seen.find((e) => e.type === "tool_use_result" && e.data.id === "slow")!;
  assert.ok(seen.indexOf(asked) < seen.indexOf(starts[0]), "the model asks for both before either runs");
  assert.ok(seen.indexOf(slowDone) < seen.indexOf(starts[1]), "the second runs once the first has finished");
});

test("calls that never run get a result but no tool_use_start", async () => {
  const builder = make(streaming(
    { sender: "agent", text: "", tool_calls: [
      { id: "missing", tool_name: "nope", input_args: {} },
      { id: "invalid", tool_name: "typed", input_args: { n: "not a number" } },
    ] },
    { sender: "agent", text: "Done." },
  ));
  builder.fold({ name: "typed", description: "Typed", inputSchema: z.object({ n: z.number() }), do: async () => ({ status: "success", data: 1 }) });
  const seen = record(builder);
  await builder.build().processRequest("Go");
  assert.equal(seen.filter((e) => e.type === "tool_use_start").length, 0);
  assert.deepEqual(seen.filter((e) => e.type === "tool_use_result").map((e) => e.data.id), ["missing", "invalid"]);
});

class DeferringDisplay extends Displaymanager {
  override async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    if (slot.renderer !== "permission_request") return super.pushAndWait(slot);
    throw new ToolPermissionDeferred("Waiting for the person.", { approvalId: "approval-1" });
  }
}

test("a deferred permission suspends the turn, and resuming opens a resume turn", async () => {
  const store = new MemoryStore("suspend");
  const builder = make(streaming(
    { sender: "agent", text: "", tool_calls: [{ id: "send", tool_name: "send_email", input_args: { to: "lena@example.com" } }] },
    { sender: "agent", text: "Sent." },
  ), store, new DeferringDisplay());
  builder.fold({ name: "send_email", description: "Send", inputSchema: z.object({ to: z.string() }), requiresPermission: true, do: async () => ({ status: "success", data: "sent" }) });
  const seen = record(builder);
  const agent = builder.build();
  await assert.rejects(agent.processRequest("Tell Lena yes"));
  assert.equal(seen.find((e) => e.type === "turn_end")!.data.status, "suspended");
  assert.equal(seen.filter((e) => e.type === "tool_use_start").length, 0, "the call waits for its decision");

  await store.setPermission("send_email", "granted", { to: "lena@example.com" });
  await agent.resumeToolCalls!();
  const turns = seen.filter((e) => e.type === "turn_start").map((e) => e.data.trigger);
  assert.deepEqual(turns, ["request", "resume"]);
  assert.equal(seen.filter((e) => e.type === "turn_end").at(-1)!.data.status, "success");
  assert.equal(seen.find((e) => e.type === "tool_use_start")!.data.id, "send");
});

test("an event wake is its own turn, and event_received previews what arrived", async () => {
  const builder = make(streaming({ sender: "agent", text: "Noted." }));
  const seen = record(builder);
  const agent = builder.build();
  assert.equal(await agent.emitEvent({ id: "w1", source: "app:calendar", content: [{ type: "text", text: "Meeting   moved\nto 3pm" }, { type: "image", name: "invite.png", source: { type: "url", media_type: "image/png", url: "https://example.com/i.png" } }], whenIdle: "wake" }), "woke");
  await new Promise((r) => setTimeout(r, 20));
  const received = seen.find((e) => e.type === "event_received")!;
  assert.equal(received.data.preview, "Meeting moved to 3pm [image: invite.png]");
  const start = seen.find((e) => e.type === "turn_start")!;
  assert.equal(start.data.trigger, "events");
  assert.ok(seen.indexOf(start) < seen.findIndex((e) => e.type === "event_injected"));
  assert.equal(seen.find((e) => e.type === "turn_end")!.data.status, "success");
});

test("subagent brackets name the call that ran them", async () => {
  const child = () => make(streaming({ sender: "agent", text: "Found it." }), new MemoryStore("child")).build();
  const builder = make(streaming(
    { sender: "agent", text: "", tool_calls: [{ id: "dispatch", tool_name: "glove_invoke_subagent", input_args: { name: "researcher", prompt: "Find it" } }] },
    { sender: "agent", text: "Done." },
  ));
  builder.defineSubAgent({ name: "researcher", description: "Researches", factory: child });
  const seen = record(builder);
  await builder.build().processRequest("Research");
  assert.equal(seen.find((e) => e.type === "subagent_invoked")!.data.call_id, "dispatch");
  assert.equal(seen.find((e) => e.type === "subagent_completed")!.data.call_id, "dispatch");
  const triggers = seen.filter((e) => e.type === "turn_start").map((e) => e.data.trigger);
  assert.deepEqual(triggers, ["request", "request"], "the child's turn arrives inside the parent's");
});

test("inbox_injected reports resolved items joining history", async () => {
  const store = new MemoryStore("inbox");
  const builder = make(streaming({ sender: "agent", text: "Thanks." }), store);
  const seen = record(builder);
  const agent = builder.build();
  await store.addInboxItem({ id: "i1", tag: "refund", request: "Refund order 42", response: null, status: "pending", blocking: false, created_at: new Date().toISOString(), resolved_at: null });
  await store.updateInboxItem("i1", { status: "resolved", response: "Refunded", resolved_at: new Date().toISOString() });
  await agent.processRequest("Any news?");
  const injected = seen.find((e) => e.type === "inbox_injected")!;
  assert.deepEqual(injected.data, { ids: ["i1"], tags: ["refund"], phase: "request" });
  assert.ok(seen.indexOf(injected) < seen.findIndex((e) => e.type === "text_delta"));
});
