import assert from "node:assert/strict";
import { Context, Observer, PromptMachine } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { port, modelName, secret, agentId, conversationId } from "../lib/settings.js";
import { ConversationStore } from "../lib/store.js";
import { operatorMemory } from "../lib/memory.js";
import { memoryJournal } from "../lib/continuity.js";
import { SYSTEM_PROMPT, COMPACTION_PROMPT } from "../agents/operator/prompts.js";
import { writeState } from "../lib/state.js";

const base = `http://127.0.0.1:${port}`;
const main = operatorMemory({ workspaceId: "personal", agentId, conversationId });
const before = JSON.stringify(await main.context.list());
async function run(message: string, isolatedConversation?: string) {
  const response = await fetch(`${base}/api/verify`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ message, conversationId: isolatedConversation }) });
  assert.equal(response.status, 202);
  const accepted = await response.json() as { id: string; conversationId: string };
  assert.notEqual(accepted.conversationId, conversationId);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${base}/api/state`)).json();
    if (state.run?.id === accepted.id && !["pending", "running", "retrying"].includes(state.run.status)) {
      assert.equal(state.run.status, "completed", "Live memory run must complete");
      return { ...accepted, output: state.run.output };
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error("Memory check is still running; inspect it before retrying.");
}
const first = await run("Memory verification with fictional data only: my ongoing task is to prepare a launch checklist for project Copper Orchid. Publishing is not authorized; the next step is my review. I prefer concise progress reports. Save the unfinished task and preference in pinned memory, write the checklist draft to /notes/launch.md, and record the decision in episodic memory. Do not use browser or sandbox tools, schedule anything, publish, or mark the launch task completed. Report only what you saved.");
const scope = { workspaceId: "personal", agentId, conversationId: first.conversationId };
const memory = operatorMemory(scope);
assert.match(await memory.context.render(), /Copper Orchid/i);
assert.ok(await memory.resources.exists("/notes/launch.md"));
const store = await ConversationStore.open(first.conversationId);
const nativeResults = (await store.getMessages()).flatMap(message => message.tool_results ?? []);
for (const tool of ["glove_context_set", "glove_resources_write", "glove_episodic_record"]) assert.ok(nativeResults.some(result => result.tool_name === tool && result.result.status === "success"), `${tool} must succeed`);
const context = new Context(store);
const model = createAdapter({ provider: "openrouter", apiKey: secret("OPENROUTER_API_KEY"), model: modelName, stream: true, maxTokens: 6000 });
const observer = new Observer(store, context, new PromptMachine(model, context, SYSTEM_PROMPT), COMPACTION_PROMPT);
observer.addSubscriber(memoryJournal({ ...scope, runId: first.id, message: { text: "Isolated forced compaction" }, request: { source: { kind: "verification" } } }));
await observer.runCompactionNow();
assert.ok((await (await ConversationStore.open(first.conversationId)).getMessages()).some(message => message.is_compaction));
const resumed = await run("Resume from your saved memory after compaction. What is my unfinished project, what remains to be done next, what am I withholding permission for, and how do I prefer progress reports? Read your saved notes if useful. Do not execute the task or change its completion status.", first.conversationId);
const output = JSON.stringify(resumed.output);
assert.match(output, /Copper Orchid/i);
assert.match(output, /review|approval/i);
assert.match(output, /publish/i);
assert.match(output, /concise/i);
assert.equal(JSON.stringify(await main.context.list()), before, "Verification must not alter the user's pinned memory");
await writeState("memory-verification.json", { conversationId: first.conversationId, runId: resumed.id, completedAt: new Date().toISOString(), checks: ["native-memory-tools", "real-model-compaction", "fresh-activation-recall", "main-conversation-isolation"] });
console.log("Verified DeepSeek memory writes, forced compaction, fresh-activation recall, and isolation from the user's memory.");
