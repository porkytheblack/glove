import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Glove, MemoryStore, Displaymanager, PromptMachine, type Message } from "../src/index";
import { formatMessages } from "../src/models/openai-compat";

for (const mode of ["runtime", "inbox", "both"] as const) {
  test(`${mode}: framework state preserves current-turn results and complete tool bundles`, async () => {
    const store = new MemoryStore(mode);
    if (mode !== "runtime") await store.addInboxItem({ id: "pending", tag: "approval", request: "Approve unrelated action", response: null, status: "pending", blocking: true, created_at: "2026-09-09", resolved_at: null });
    const inputs: Message[][] = [];
    let contextReads = 0;
    const agent = new Glove({ store, displayManager: new Displaymanager(), systemPrompt: "Stable", enableToolResultSummary: true,
      compaction_config: { compaction_instructions: "Summarize", max_turns: 5 },
      model: { name: "test", setSystemPrompt() {}, async prompt(request) {
        inputs.push(structuredClone(request.messages));
        if (inputs.length <= 2) {
          const ids = inputs.length === 1 ? ["one-a", "one-b"] : ["two"];
          return { messages: [{ sender: "agent", text: "", tool_calls: ids.map(id => ({ id, tool_name: "lookup", input_args: { id } })) }], tokens_in: 1, tokens_out: 1 };
        }
        return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 1, tokens_out: 1 };
      } },
    }).build();
    if (mode !== "inbox") agent.addContextProvider(() => { contextReads++; return "Goals: review lookups"; });
    agent.fold({ name: "lookup", description: "Read full data", inputSchema: z.object({ id: z.string() }), async do({ id }) {
      return { status: "success", data: `FULL ${id}`, summary: `SHORT ${id}` };
    } });
    await agent.processRequest("Perform lookups");
    assert.equal(contextReads, mode === "inbox" ? 0 : 3, "one initial read plus one per completed tool batch, not per tool");
    const current = inputs[2];
    assert.deepEqual(current.flatMap(m => m.tool_results ?? []).map(r => r.result.data), ["FULL one-a", "FULL one-b", "FULL two"]);
    const wire = formatMessages(current);
    const results = wire.filter(m => m.role === "tool");
    assert.deepEqual(results.map(m => m.tool_call_id), ["one-a", "one-b", "two"]);
    assert.ok(results.every(m => String(m.content).includes("FULL")), "no synthetic repair results or premature summaries");
    for (let i = 0; i < current.length; i++) {
      if (current[i].tool_calls?.length) assert.ok(current[i + 1]?.tool_results?.length, "framework state must not split a call/result bundle");
    }
    assert.ok(current.at(-1)?.framework_context);
    assert.ok(!(await store.getMessages()).some(m => m.framework_context), "pending/runtime snapshots are transient");
    await agent.processRequest("A genuinely new user request");
    assert.deepEqual(inputs[3].flatMap(m => m.tool_results ?? []).map(r => r.result.data), ["SHORT one-a", "SHORT one-b", "SHORT two"]);
    assert.deepEqual((await store.getMessages()).flatMap(m => m.tool_results ?? []).map(r => r.result.data), ["FULL one-a", "FULL one-b", "FULL two"], "summaries only affect model input");
  });
}

test("all marked synthetic messages leave the real user-turn boundary unchanged", () => {
  const result: Message = { sender: "user", text: "tool results", tool_results: [{ tool_name: "lookup", call_id: "one", result: { status: "success", data: "FULL", summary: "SHORT" } }] };
  const boundary: Message = { sender: "user", text: "Human request" };
  for (const marker of [{ framework_context: "runtime" }, { framework_context: "inbox" }, { is_skill_injection: true }, { is_compaction: true }, { is_compaction_request: true }] as const) {
    const messages: Message[] = [boundary, result, { sender: "user", text: "Synthetic", ...marker }];
    const output = PromptMachine.prototype.summarizeOlderToolResults(messages);
    assert.equal(output[1].tool_results![0].result.data, "FULL");
    const noHuman = PromptMachine.prototype.summarizeOlderToolResults(messages.slice(1));
    assert.equal(noHuman[0].tool_results![0].result.data, "FULL", "no known human boundary conservatively retains full results");
  }
});

test("resolved inbox entries retain provenance and precede the actual user request", async () => {
  const store = new MemoryStore("resolved");
  await store.addInboxItem({ id: "resolved", tag: "approval", request: "Approval", response: "Approved", status: "resolved", blocking: true, created_at: "2026-09-09", resolved_at: "2026-09-09" });
  const agent = new Glove({ store, displayManager: new Displaymanager(), systemPrompt: "Stable", compaction_config: { compaction_instructions: "Summarize" },
    model: { name: "test", setSystemPrompt() {}, async prompt({ messages }) {
      assert.equal(messages[0].framework_context, "inbox");
      assert.equal(messages[1].text, "Continue");
      assert.equal(messages[1].framework_context, undefined);
      return { messages: [{ sender: "agent", text: "Done" }], tokens_in: 0, tokens_out: 0 };
    } },
  }).build();
  await agent.processRequest("Continue");
  assert.equal((await store.getMessages())[0].framework_context, "inbox");
  assert.equal((await store.getInboxItems())[0].status, "consumed");
});
