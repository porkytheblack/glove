import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  Displaymanager,
  Glove,
  MemoryStore,
  ToolPermissionDeferred,
  isTurnSuspended,
  type Message,
  type ModelAdapter,
  type Slot,
} from "../src/index";

/** A display manager whose permission prompts are decided later, by someone else. */
class DeferringDisplay extends Displaymanager {
  readonly asked: Array<Record<string, unknown>> = [];
  override async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    if (slot.renderer !== "permission_request") return super.pushAndWait(slot);
    this.asked.push(slot.input as Record<string, unknown>);
    throw new ToolPermissionDeferred("Waiting for the person.", { approvalId: "approval-1" });
  }
}

/** One answer per model call, in order; every request it was sent is kept. */
function scripted(...answers: Array<Message>): ModelAdapter & { readonly seen: Message[][] } {
  const seen: Message[][] = [];
  return {
    name: "scripted",
    seen,
    setSystemPrompt() {},
    async prompt({ messages }) {
      seen.push(structuredClone(messages));
      const answer = answers.shift();
      if (!answer) throw new Error("The model was called more times than scripted.");
      return { messages: [answer], tokens_in: 1, tokens_out: 1 };
    },
  };
}

const lookUp = { id: "call-look", tool_name: "look_up", input_args: { who: "Lena" } };
const sendEmail = { id: "call-send", tool_name: "send_email", input_args: { to: "lena@example.com", body: "Yes, 8 works." } };

function build(model: ModelAdapter, store: MemoryStore, display: Displaymanager, ran: string[]) {
  const glove = new Glove({ model, store, displayManager: display, systemPrompt: "You help.", compaction_config: { compaction_instructions: "Summarize" } });
  glove.fold({ name: "look_up", description: "Look someone up", inputSchema: z.object({ who: z.string() }), do: async ({ who }) => { ran.push(`look_up ${who}`); return { status: "success", data: `${who} is at Northwind.` }; } });
  glove.fold({
    name: "send_email",
    description: "Send an email",
    inputSchema: z.object({ to: z.string(), body: z.string() }),
    requiresPermission: true,
    do: async ({ to }) => { ran.push(`send_email ${to}`); return { status: "success", data: "sent" }; },
  });
  return glove.build();
}

test("a deferred permission stops the turn at that call and keeps the results before it", async () => {
  const store = new MemoryStore("deferred");
  const display = new DeferringDisplay();
  const ran: string[] = [];
  const model = scripted({ sender: "agent", text: "", tool_calls: [lookUp, sendEmail] });
  const agent = build(model, store, display, ran);

  const error = await agent.processRequest("Tell Lena 8 works").then(() => undefined, (cause: unknown) => cause);
  assert.ok(isTurnSuspended(error), "the turn suspends instead of failing or refusing");
  assert.deepEqual((error.deferral.data as { approvalId: string }).approvalId, "approval-1");
  assert.deepEqual(error.pending.map((call) => call.id), ["call-send"]);
  assert.deepEqual(ran, ["look_up Lena"], "nothing after the deferred call ran");
  assert.equal(display.asked[0]?.toolCallId, "call-send", "the prompt names the call it is about");

  const history = await store.getMessages();
  const results = history.flatMap((message) => message.tool_results ?? []);
  assert.deepEqual(results.map((result) => result.call_id), ["call-look"], "only the call that ran has a result");
  assert.ok(!results.some((result) => /Permission denied/.test(result.result.message ?? "")), "no refusal was recorded");
  assert.equal(await store.getPermission("send_email", sendEmail.input_args), "unset");
  // Resuming before anyone decided asks again, and suspends again.
  await assert.rejects(agent.resumeToolCalls!(), (cause: unknown) => isTurnSuspended(cause));
  assert.equal(display.asked.length, 2);
  assert.deepEqual(ran, ["look_up Lena"]);
});

test("approved later, the call runs and the turn continues from it", async () => {
  const store = new MemoryStore("approved");
  const ran: string[] = [];
  const first = build(scripted({ sender: "agent", text: "", tool_calls: [lookUp, sendEmail] }), store, new DeferringDisplay(), ran);
  await first.processRequest("Tell Lena 8 works").catch(() => undefined);

  // A new process: a fresh Glove over the same store, with the person's decision stored.
  await store.setPermission("send_email", "granted", sendEmail.input_args);
  const model = scripted({ sender: "agent", text: "Done. Lena knows 8 works." });
  const resumed = build(model, store, new DeferringDisplay(), ran);
  const result = await resumed.resumeToolCalls?.();

  assert.equal(result?.messages.at(-1)?.text, "Done. Lena knows 8 works.");
  assert.deepEqual(ran, ["look_up Lena", "send_email lena@example.com"], "the earlier call is not run again");
  const history = await store.getMessages();
  const results = history.flatMap((message) => message.tool_results ?? []);
  assert.deepEqual(results.map((item) => [item.call_id, item.result.status]), [["call-look", "success"], ["call-send", "success"]]);
  const sent = model.seen[0]!;
  assert.ok(sent.some((message) => message.tool_results?.some((item) => item.call_id === "call-send")), "the model sees the call's real result");
  assert.equal(await resumed.resumeToolCalls?.(), undefined, "nothing is left to resume");
});

test("denied later, the call is refused and the turn continues", async () => {
  const store = new MemoryStore("denied");
  const ran: string[] = [];
  await build(scripted({ sender: "agent", text: "", tool_calls: [sendEmail] }), store, new DeferringDisplay(), ran).processRequest("Tell Lena").catch(() => undefined);
  await store.setPermission("send_email", "denied", sendEmail.input_args);
  const result = await build(scripted({ sender: "agent", text: "I didn't send it." }), store, new DeferringDisplay(), ran).resumeToolCalls?.();
  assert.equal(result?.messages.at(-1)?.text, "I didn't send it.");
  assert.deepEqual(ran, []);
  const refusal = (await store.getMessages()).flatMap((message) => message.tool_results ?? []).find((item) => item.call_id === "call-send");
  assert.match(refusal?.result.message ?? "", /Permission denied/);
});

test("once the conversation moved on, there is nothing to resume in place", async () => {
  const store = new MemoryStore("moved-on");
  const ran: string[] = [];
  await build(scripted({ sender: "agent", text: "", tool_calls: [sendEmail] }), store, new DeferringDisplay(), ran).processRequest("Tell Lena").catch(() => undefined);
  await store.appendMessages([{ sender: "user", text: "Also, what's on Friday?" }]);
  const model = scripted();
  const agent = build(model, store, new DeferringDisplay(), ran);
  assert.equal(await agent.resumeToolCalls?.(), undefined);
  assert.equal(model.seen.length, 0, "the model was not called");
});
