import { test } from "node:test";
import assert from "node:assert/strict";
import { Glove, Displaymanager, MemoryStore, type Message } from "glove-core";
import { z } from "zod";
import { useContext } from "../src/tools/context";
import { useGoalRunner } from "../src/tools/goals";
import { useFormRunner } from "../src/tools/forms";
import { InMemoryContextAdapter } from "../src/in-memory/context";
import { InMemoryGoalAdapter } from "../src/in-memory/goals";
import { InMemoryFormAdapter } from "../src/in-memory/forms";
import { MemorySchema } from "../src/core/schema";
import { defineForm, FormRegistry } from "../src/forms";
import { defineGoalProgram } from "../src/goals";

test("goals, forms and standing context refresh after a tool while preserving the system and conversation prefix", async () => {
  const prefix: Message[] = [{ sender: "user", text: "Earlier question" }, { sender: "agent", text: "Earlier answer" }];
  const store = new MemoryStore("memory-runtime"); await store.appendMessages(prefix);
  let phase = "before"; let calls = 0; const systemWrites: string[] = [];
  const glove = new Glove({
    store, displayManager: new Displaymanager(), systemPrompt: "Stable host instructions",
    compaction_config: { compaction_instructions: "Summarize" },
    model: { name: "test", setSystemPrompt: text => { systemWrites.push(text); }, async prompt(request) {
      assert.deepEqual(request.messages.slice(0, 2), prefix);
      const snapshots = request.messages.slice(-3).map(m => m.text).join("\n");
      assert.match(snapshots, new RegExp(`Standing context: ${phase}`));
      if (calls++ === 0) {
        assert.match(snapshots, /Email address/); assert.match(snapshots, /Goal item \[pending\]/);
        return { messages: [{ sender: "agent", text: "", tool_calls: [{ id: "advance", tool_name: "advance", input_args: {} }] }], tokens_in: 1, tokens_out: 1 };
      }
      assert.doesNotMatch(snapshots, /Email address/); assert.match(snapshots, /work; completed/);
      return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 1, tokens_out: 1 };
    } },
  }).build();
  const schema = new MemorySchema();
  const context = new InMemoryContextAdapter({ schema }); context.render = async () => `Standing context: ${phase}`;
  useContext(glove, context);
  const goalAdapter = new InMemoryGoalAdapter();
  const goals = useGoalRunner(glove, goalAdapter, { scope: { subject: "client", key: "work" } });
  await goals.runner.start(defineGoalProgram({ key: "work", goals: [{ key: "work", title: "Work", objective: "Finish", items: [{ key: "item", label: "Goal item" }] }] }));
  const form = defineForm({ id: "contact", version: 1, name: "Contact", description: "Contact details" })
    .step("details", { title: "Details" }, s => s.field("email", { label: "Email address", schema: z.email() })).build();
  const registry = new FormRegistry().register("contact", { name: "Contact", description: "Contact", load: () => form });
  const forms = useFormRunner(glove, new InMemoryFormAdapter({ schema }), { subject: "client", registry });
  await forms.runner.start("contact");
  glove.fold({ name: "advance", description: "Advance state", inputSchema: z.object({}), async do() {
    phase = "after"; await forms.runner.fill({ email: "ada@example.com" });
    await goals.runner.update({ goalKey: "work", completed: ["item"], reason: "Done" });
    return { status: "success", data: "Advanced" };
  } });
  const writesBefore = systemWrites.length;
  await glove.processRequest("Continue");
  assert.equal(calls, 2); assert.equal(systemWrites.length, writesBefore);
  assert.equal(glove.getSystemPrompt(), "Stable host instructions");
  const history = await store.getMessages();
  assert.ok(!history.some(m => m.text?.startsWith("GOALS") || m.text?.startsWith("Standing context:")));
  // A newly built conversational agent obtains the persisted goal state.
  const fresh = new Glove({ model: glove.model, displayManager: new Displaymanager(), systemPrompt: "Fresh", compaction_config: { compaction_instructions: "Summarize" } }).build();
  useGoalRunner(fresh, goalAdapter, { scope: { subject: "client", key: "work" } });
  assert.match((await fresh.getRuntimeContext()).map(m => m.text).join("\n"), /work; completed/);
});

test("unsupported proxies fail before tool mounting instead of silently mutating the system prompt", () => {
  const tools: unknown[] = [];
  const proxy = { fold(t: unknown) { tools.push(t); }, getSystemPrompt: () => "Host", setSystemPrompt() { throw new Error("must not mutate"); }, processRequest: async () => ({ sender: "agent" as const, text: "" }) };
  assert.throws(() => useGoalRunner(proxy, new InMemoryGoalAdapter(), { scope: { subject: "client", key: "work" } }), /addContextProvider/);
  assert.equal(tools.length, 0);
  useGoalRunner(proxy, new InMemoryGoalAdapter(), { scope: { subject: "client", key: "work" }, injectStatus: false });
  assert.ok(tools.length > 0);
});
