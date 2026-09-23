import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Context, Observer, PromptMachine, Glove, Displaymanager, type ModelAdapter, type PromptRequest } from "glove-core";
import { useContext } from "glove-memory/tools";
import { operatorMemory } from "../lib/memory.js";
import { ConversationStore } from "../lib/store.js";
import { continuityContext, rememberActivation, memoryJournal } from "../lib/continuity.js";
import { SYSTEM_PROMPT, COMPACTION_PROMPT } from "../agents/operator/prompts.js";

const scope = { workspaceId: "test", agentId: "test-agent", conversationId: "work" };
const provenance = { source: "user:test", actor: "test", timestamp: "2026-09-22T00:00:00Z" };
test("native memory survives reconstruction and isolates verification conversations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "operator-memory-"));
  try {
    const file = join(dir, "memory.sqlite"), first = operatorMemory(scope, file);
    const item = await first.entity.addNode("known_item", { key: "project-a", kind: "project", name: "Project A", details: "Needs review" }, provenance);
    await first.episodic.recordEpisode({ kind: "decision", occurredAt: provenance.timestamp, content: "The user chose a blue header.", participants: [] }, provenance);
    await first.resources.write("/notes/design.md", { type: "text", text: "Blue header; approval still pending." }, { tags: [], links: [] }, provenance);
    await first.context.set({ section: "tasks", title: "Build the site", pinned: true, content: "Active: finish the site. Next: obtain approval. Do not publish yet." }, provenance);
    const restored = operatorMemory(scope, file);
    assert.ok(await restored.entity.getNode(item.id));
    assert.equal((await restored.episodic.findEpisodes({})).length, 1);
    assert.match((await restored.resources.read("/notes/design.md")).body.type, /text/);
    assert.match(await restored.context.render(), /Do not publish yet/);
    assert.equal((await operatorMemory({ ...scope, conversationId: "verification" }, file).context.list()).length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("forced compaction plus restart retains pinned task, exact current request, tasks and inbox", async () => {
  const dir = await mkdtemp(join(tmpdir(), "operator-continuity-"));
  try {
    const file = join(dir, "memory.sqlite");
    const activation = { ...scope, runId: "run-1", message: { text: "Check the service status; keep the unfinished site task." }, request: { source: { kind: "direct" } } };
    await rememberActivation(activation, file);
    await rememberActivation(activation, file);
    const memory = operatorMemory(scope, file);
    assert.equal((await memory.episodic.findEpisodes({})).length, 1, "activation journal is idempotent");
    await memory.context.set({ section: "tasks", title: "Site", content: "Pending: finish site. Do not publish. Next: review draft.", pinned: true }, provenance);
    const store = await ConversationStore.open(scope.conversationId, dir);
    await store.appendMessages([{ sender: "user", text: "Build the site, then wait for approval before publishing." }]);
    await store.addTasks([{ id: "draft", content: "Review draft", activeForm: "Reviewing draft", status: "in_progress" }]);
    await store.addInboxItem({ id: "approval", tag: "review", request: "Approve draft", status: "pending", response: null, blocking: true, created_at: provenance.timestamp, resolved_at: null });
    const summaryModel: ModelAdapter = { name: "summary-test", setSystemPrompt() {}, async prompt(request) {
      assert.equal(request.messages.at(-1)?.text, COMPACTION_PROMPT);
      return { messages: [{ sender: "agent", text: "Service check finished. This lossy summary omits the site task." }], tokens_in: 1000, tokens_out: 30 };
    } };
    const context = new Context(store);
    const observer = new Observer(store, context, new PromptMachine(summaryModel, context, SYSTEM_PROMPT), COMPACTION_PROMPT);
    observer.addSubscriber(memoryJournal(activation, file));
    await observer.runCompactionNow();
    const restored = await ConversationStore.open(scope.conversationId, dir);
    assert.equal((await restored.getTasks())[0].status, "in_progress");
    assert.equal((await restored.getInboxItems())[0].status, "pending");
    assert.match((await restored.getMessages())[0].text, /wait for approval/, "original transcript retained");
    assert.ok((await memory.resources.list("/checkpoints")).length > 0);
    const seen: PromptRequest[] = [];
    const model: ModelAdapter = { name: "resume-test", setSystemPrompt() {}, async prompt(request) { seen.push(request); return { messages: [{ sender: "agent", text: "Resume draft review." }], tokens_in: 1000, tokens_out: 10 }; } };
    const agent = new Glove({ model, store: restored, displayManager: new Displaymanager(), systemPrompt: SYSTEM_PROMPT, compaction_config: { compaction_instructions: COMPACTION_PROMPT } }).build();
    useContext(agent, operatorMemory(scope, file).context);
    agent.addContextProvider(() => continuityContext(activation, file));
    await agent.processRequest("Continue");
    const input = JSON.stringify(seen[0].messages);
    assert.match(input, /Pending: finish site/);
    assert.match(input, /Do not publish/);
    assert.match(input, /Check the service status; keep the unfinished site task/);
    assert.match(input, /Approve draft/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("context pressure tracks latest prompt rather than accumulated billing and restores legacy logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "operator-store-"));
  try {
    const id = "legacy", filename = `conversation-${createHash("sha256").update(id).digest("hex")}.json`;
    await writeFile(join(dir, filename), JSON.stringify([{ sender: "user", text: "old history ".repeat(5000) }, { sender: "user", text: "Keep the task", is_compaction: true }]));
    const store = await ConversationStore.open(id, dir);
    assert.ok(await store.getTokenCount() < 100, "restored archived history does not inflate live context");
    for (let i = 0; i < 10; i++) await store.addTokens({ tokens_in: 10000, tokens_out: 100 });
    assert.ok(await store.getTokenCount() < 11000);
    assert.equal((await store.getTokenConsumption()).tokens_in, 100000);
    await store.appendMessages([{ sender: "user", text: "New exact direction" }]);
    assert.equal(JSON.parse(await readFile(join(dir, filename), "utf8")).version, 2);
    assert.equal((await store.getMessages()).length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
