import { newDelegationId } from "../src/delegation.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { Glove, MemoryStore, Displaymanager } from "glove-core";
import { InMemoryContextAdapter, MemorySchema } from "glove-memory";
import { z } from "zod";
import { defineAgent } from "../src/definition.js";
import { defineApp, restrictApp, installRegistry, defineMemory, mountAgentDefinitionMemory, EMPTY_CAPABILITY_REGISTRY } from "../src/capabilities.js";
import { composeAgent } from "../src/composition.js";
import { composeDurableAgent, inheritedInstallations, agentInboxId, refreshDurableAuthority } from "../src/durable-subagents.js";
import { MemoryFoundryDataAdapter, createAgentInstance } from "../src/primitives.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { FoundryServer } from "../src/server.js";
import { createFoundryClient } from "../src/client.js";
import { FoundryRuntime } from "../src/runtime.js";
import { defineApplication } from "../src/application.js";
import { FoundryEchoModel } from "./fixtures/echo-model.js";

const noop = defineAgent({ description: "test", run: async () => "ok" });
function mountedContext() {
  const glove = new Glove({ model: new FoundryEchoModel(), store: new MemoryStore("permissions"), displayManager: new Displaymanager(), systemPrompt: "test", compaction_config: { compaction_instructions: "test" }, serverMode: true }).build();
  const request = { agentId: "child", conversationId: "child-chat", workspaceId: "tenant", message: "test" };
  return { glove, store: glove.store, definitionId: "child", agentId: "child", conversationId: "child-chat", workspaceId: "tenant", runId: "test", input: {}, request, message: { sender: "user" as const, text: "test" }, messageInput: "test", messageText: "test", history: [], messages: [], emit: () => {} };
}

test("app modifiers preserve identity and intersect tool and account operation permissions", async () => {
  const app = defineApp({ id: "notes", description: "notes", install: (ctx) => Effect.succeed({ tools: ["read", "write"].map((name) => ({ name, description: name, inputSchema: z.object({ operation: z.string() }), async do({ operation }: { operation: string }) { await Effect.runPromise(ctx.withAccountSession!(operation, () => Effect.void)); return { status: "success" as const, data: name }; } })) }) });
  const limited = restrictApp(restrictApp(app, { tools: ["read"], operations: ["read"] }), { tools: ["read", "write"], operations: ["read", "write"] });
  assert.equal(limited.id, "notes");
  assert.deepEqual(limited.restrictions?.tools, ["read"]);
  const context = mountedContext();
  const operations: string[] = [];
  let installed = true;
  await Effect.runPromise(installRegistry({ authorizeInstallation: () => installed ? Effect.void : Effect.fail(new Error("revoked")), registry: { ...EMPTY_CAPABILITY_REGISTRY, applications: [limited] }, installations: [{ kind: "application", id: "notes", accountId: "account" }], context, accountSessions: { identifier: "test", withSession: (request, use) => { operations.push(request.operation); return use({}); } } }));
  assert.ok(context.glove.tools.some((tool) => tool.name === "read"));
  assert.ok(!context.glove.tools.some((tool) => tool.name === "write"));
  const tool = context.glove.tools.find((tool) => tool.name === "read")!;
  await tool.run({ operation: "read" });
  await assert.rejects(tool.run({ operation: "write" }), /does not permit/);
  installed = false;
  await assert.rejects(tool.run({ operation: "read" }), /revoked/);
  assert.deepEqual(operations, ["read"], "denied or revoked operations never reach account sessions");
});

test("shared memory is parent-scoped and read-only, including ambient context", async () => {
  const owners: string[] = [];
  const profile = defineMemory({ id: "personal", description: "personal", context: { adapter: (ctx) => { owners.push(ctx.agentId); return Effect.succeed(new InMemoryContextAdapter({ schema: new MemorySchema() })); } } });
  const parent = defineAgent({ description: "test", id: "assistant", components: composeAgent(profile), memory: [profile], run: async () => "ok" });
  const child = composeDurableAgent(parent, "research", { agent: noop, inherit: { memory: "shared" } });
  const ctx = mountedContext();
  const owner = createAgentInstance("assistant", { id: "parent", workspaceId: "tenant" });
  await Effect.runPromise(mountAgentDefinitionMemory({ registry: child.components!.capabilities, memory: [profile], context: { ...ctx, request: { ...ctx.request, context: { durableMemoryOwners: { assistant: owner } } } } }));
  assert.deepEqual(owners, ["parent"]);
  assert.ok(ctx.glove.tools.some((tool) => tool.name === "glove_context_get"));
  assert.ok(!ctx.glove.tools.some((tool) => /glove_context_(set|update|unset)/.test(tool.name)));
  const isolated = composeDurableAgent(parent, "private", { agent: noop, inherit: { memory: "isolated" } });
  await Effect.runPromise(mountAgentDefinitionMemory({ registry: isolated.components!.capabilities, memory: [profile], context: mountedContext() }));
  assert.equal(owners.at(-1), "child");
  const nested = composeDurableAgent(child, "private", { agent: noop, inherit: { memory: "isolated" } });
  await Effect.runPromise(mountAgentDefinitionMemory({ registry: nested.components!.capabilities, memory: [profile], context: mountedContext() }));
  assert.equal(owners.at(-1), "child", "isolated inheritance does not retain an ancestor's shared adapter scope");
  const unsafe = defineMemory({ id: "unsafe", description: "unsafe", mount: () => Effect.void });
  assert.throws(() => composeDurableAgent(defineAgent({ description: "test", id: "unsafe-parent", run: async () => "ok", components: composeAgent(unsafe), memory: [unsafe] }), "child", { agent: noop, inherit: { memory: "shared" } }), /custom mount/);
});

test("inherited apps follow parent installation removal and do not copy unrelated accounts", () => {
  const app = defineApp({ id: "notes", description: "notes" });
  const parentDefinition = defineAgent({ description: "test", id: "assistant", components: composeAgent(app), run: async () => "ok" });
  const selection = { agent: noop, inherit: { apps: [restrictApp(app, { tools: ["read"] })] } };
  const child = composeDurableAgent(parentDefinition, "research", selection);
  const parent = createAgentInstance("assistant", { installations: [{ kind: "application", id: "notes", accountId: "selected" }, { kind: "application", id: "other", accountId: "private" }] });
  assert.deepEqual(inheritedInstallations(parent, child, selection).map((item) => item.accountId), ["selected"]);
  assert.deepEqual(inheritedInstallations({ ...parent, installations: [] }, child, selection), []);
});

for (const kind of ["memory", "file"] as const) test(`${kind} adapter purges only owned data and preserves a tombstone`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-worker-data-"));
  try {
    const data = kind === "file" ? new FileFoundryDataAdapter({ file: join(directory, "data.json") }) : new MemoryFoundryDataAdapter();
    const input = { id: "child", definitionId: "parent/workers/child", provisioningKey: "worker-key", workspaceId: "tenant", durableSubagent: { parentAgentId: "parent", name: "child", status: "active" as const }, context: { secret: "private data" } };
    const [a, b] = await Promise.all([Effect.runPromise(data.provisionAgent(input)), Effect.runPromise(data.provisionAgent(input))]);
    assert.equal(a.id, b.id);
    await Effect.runPromise(data.putWorkspaceEntry({ workspaceId: "tenant", key: "shared", value: "keep", updatedAt: new Date().toISOString() }));
    await Effect.runPromise(data.putPendingInbound({ id: "message", definitionId: a.definitionId, request: { agentId: a.id, conversationId: "chat", workspaceId: a.workspaceId, message: "private" }, createdAt: new Date().toISOString() }));
    await assert.rejects(Effect.runPromise(data.purgeAgentData(a.id)), /archived/);
    await Effect.runPromise(data.putAgent({ ...a, durableSubagent: { ...a.durableSubagent!, status: "archived" } }));
    await Effect.runPromise(data.purgeAgentData(a.id));
    assert.equal((await Effect.runPromise(data.listPendingInbound())).length, 0);
    assert.equal((await Effect.runPromise(data.getWorkspaceEntry("tenant", "shared")))?.value, "keep");
    const tombstone = await Effect.runPromise(data.provisionAgent(input));
    assert.equal(tombstone.durableSubagent?.status, "purged");
    assert.deepEqual(tombstone.context, {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("durable workers reuse identity, receive direct messages, delegate, and archive independently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-worker-runtime-"));
  const data = new FileFoundryDataAdapter({ file: join(directory, "state.json") });
  const runtime = await FoundryRuntime.discover({ rootDir: resolve("tests/fixtures"), agentsDir: resolve("tests/fixtures/durable-subagents"), application: defineApplication({ name: "workers", data }), config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } } });
  const server = new FoundryServer(runtime, { port: 0 });
  await runtime.start();
  try {
    const listening = await server.listen();
    const client = createFoundryClient({ baseUrl: listening.url });
    const parent = await runtime.createAgent("assistant", { id: "parent", context: { user: "Ada" } });
    const workers = await Promise.all([runtime.subagent(parent.id, "research"), runtime.subagent(parent.id, "research")]);
    assert.equal(workers[0]!.id, workers[1]!.id);
    assert.equal(workers[0]!.context.user, "Ada");
    const other = await runtime.createAgent("assistant", { id: "other" });
    assert.notEqual((await runtime.subagent(other.id, "research")).id, workers[0]!.id);
    const handle = client.subagent(parent.id, "research");
    assert.equal((await handle.ensure()).id, workers[0]!.id);
    assert.equal((await client.subagents(parent.id)).length, 1);
    assert.equal((await handle.data()).agent.id, workers[0]!.id);
    const message = await handle.send("hello");
    assert.equal(message.conversationId, agentInboxId(workers[0]!.id));
    assert.equal((await runtime.waitForRun(message.runId!, { timeoutMs: 30_000 }))?.status, "completed");
    const chat = await runtime.createConversation(parent.id);
    const outgoing = await runtime.send(parent.id, chat.id, "message");
    assert.equal((await runtime.waitForRun(outgoing.id, { timeoutMs: 30_000 }))?.status, "completed");
    const messageDeadline = Date.now() + 30_000;
    let inbound;
    while (Date.now() < messageDeadline) {
      inbound = (await runtime.listRuns("assistant")).find((item) => item.conversationId === agentInboxId(parent.id) && item.status === "completed");
      if (inbound) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal((inbound?.output as { value: unknown })?.value, "received finding");
    const origin = await runtime.send(parent.id, chat.id, "message origin");
    await runtime.waitForRun(origin.id, { timeoutMs: 30_000 });
    const replyDeadline = Date.now() + 30_000;
    let directed;
    while (Date.now() < replyDeadline) {
      directed = (await runtime.listRuns("assistant")).find((item) => item.conversationId === chat.id && (item.output as { value?: unknown } | undefined)?.value === "received finding");
      if (directed) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(directed, "worker messages can target the originating parent conversation explicitly");
    const run = await runtime.send(parent.id, chat.id, "delegate");
    assert.equal((await runtime.waitForRun(run.id, { timeoutMs: 30_000 }))?.status, "completed");
    const deadline = Date.now() + 30_000;
    while (!(await runtime.listDelegations({ agentId: parent.id })).some((item) => item.status === "completed") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const [delegation] = await runtime.listDelegations({ agentId: parent.id });
    assert.equal(delegation?.workerAgentId, workers[0]!.id);
    assert.equal(delegation?.status, "completed");
    const held = await handle.send("hold worker");
    const runningDeadline = Date.now() + 30_000;
    while ((await runtime.getRun(held.runId!))?.status !== "running" && Date.now() < runningDeadline) await new Promise((r) => setTimeout(r, 25));
    const quick = await runtime.send(parent.id, chat.id, "quick response");
    assert.equal((await runtime.waitForRun(quick.id, { timeoutMs: 30_000 }))?.status, "completed");
    assert.equal((await runtime.getRun(held.runId!))?.status, "running", "the parent responds while its worker stays busy");
    assert.equal((await runtime.getRun(held.runId!))?.timeoutMs, 4 * 60 * 60 * 1000);
    const queuedTask = await runtime.send(parent.id, chat.id, "delegate held");
    await runtime.waitForRun(queuedTask.id, { timeoutMs: 30_000 });
    const contextRun = await runtime.send(parent.id, chat.id, "open work");
    const contextResult = await runtime.waitForRun(contextRun.id, { timeoutMs: 30_000 });
    assert.deepEqual((contextResult?.output as { value: unknown }).value, ["hold worker"], "durable worker tasks remain in the parent's runtime context");
    await handle.archive();
    await assert.rejects(runtime.messageSubagent(parent.id, "research", "blocked"), /archived/);
    await assert.rejects(runtime.send(workers[0]!.id, message.conversationId, "blocked"), /archived/);
    await handle.resume();
    assert.equal((await runtime.subagent(parent.id, "research")).id, workers[0]!.id);
    await handle.archive();
    await handle.purge();
    await assert.rejects(runtime.subagent(parent.id, "research"), /purged/);
  } finally { await server.close(); await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("pending messages recover after restart and archived workers keep their mail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-worker-recovery-"));
  const file = join(directory, "state.json");
  const make = () => FoundryRuntime.discover({ rootDir: resolve("tests/fixtures"), agentsDir: resolve("tests/fixtures/durable-subagents"), application: defineApplication({ name: "workers", data: new FileFoundryDataAdapter({ file }) }), config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } } });
  let runtime = await make();
  try {
    await runtime.start();
    const parent = await runtime.createAgent("assistant", { id: "persisted-parent" });
    const child = await runtime.subagent(parent.id, "research");
    const inbox = await runtime.createConversation(child.id, { id: agentInboxId(child.id) });
    await runtime.archiveSubagent(parent.id, "research");
    const data = new FileFoundryDataAdapter({ file });
    await Effect.runPromise(data.putPendingInbound({ id: "recover-this", definitionId: child.definitionId, createdAt: new Date().toISOString(), request: { agentId: child.id, conversationId: inbox.id, workspaceId: child.workspaceId, message: "recovered message", source: { kind: "agent-message", id: "recover-this" } } }));
    await runtime.stop();
    runtime = await make();
    await runtime.start();
    assert.equal((await runtime.listRuns(child.definitionId)).length, 0);
    assert.equal((await runtime.subagentData(parent.id, "research")).pendingMessages.length, 1);
    await runtime.resumeSubagent(parent.id, "research");
    const [run] = await runtime.listRuns(child.definitionId);
    assert.ok(run);
    assert.equal((await runtime.waitForRun(run.id, { timeoutMs: 30_000 }))?.status, "completed");
    const deadline = Date.now() + 5_000;
    while ((await Effect.runPromise(data.listPendingInbound())).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal((await Effect.runPromise(data.listPendingInbound())).length, 0);
    assert.equal((await runtime.subagent(parent.id, "research")).id, child.id);
  } finally { await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});


test("execution authority refresh sees parent app revocation and exposes only owner identity", async () => {
  const app = defineApp({ id: "notes", description: "notes" });
  const parentDefinition = defineAgent({ id: "root", description: "root", components: composeAgent(app), run: async () => "ok" });
  const childDefinition = composeDurableAgent(parentDefinition, "worker", { agent: noop, inherit: { apps: [restrictApp(app, { tools: ["read"] })] } });
  const data = new MemoryFoundryDataAdapter();
  const parent = createAgentInstance("root", { id: "parent", context: { private: "not inherited" }, installations: [{ kind: "application", id: "notes", accountId: "account" }] });
  const child = createAgentInstance("root/workers/worker", { id: "worker", durableSubagent: { parentAgentId: "parent", name: "worker", status: "active" } });
  await Effect.runPromise(data.putAgent(parent));
  await Effect.runPromise(data.putAgent(child));
  const initial = await refreshDurableAuthority(childDefinition, child, data);
  assert.equal(initial.agent.installations.length, 1);
  assert.deepEqual(Object.keys(initial.owners.root!).sort(), ["definitionId", "id", "workspaceId"]);
  await Effect.runPromise(data.putAgent({ ...parent, installations: [] }));
  assert.equal((await refreshDurableAuthority(childDefinition, initial.agent, data)).agent.installations.length, 0);
  await Effect.runPromise(data.putAgent({ ...child, durableSubagent: { ...child.durableSubagent!, status: "archived" } }));
  await assert.rejects(refreshDurableAuthority(childDefinition, child, data), /archived/);
});


for (const queued of [true, false]) test(`a durable delegated task recovers after a crash ${queued ? "after" : "before"} enqueue`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-task-recovery-"));
  const data = new FileFoundryDataAdapter({ file: join(directory, "state.json") });
  const runtime = await FoundryRuntime.discover({ rootDir: resolve("tests/fixtures"), agentsDir: resolve("tests/fixtures/durable-subagents"), application: defineApplication({ name: "recovery", data }), config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } } });
  try {
    const parent = await runtime.createAgent("assistant", { id: "recovery-parent" });
    const worker = await runtime.subagent(parent.id, "research");
    const chat = await runtime.createConversation(parent.id);
    const id = newDelegationId();
    const now = new Date().toISOString();
    const delegation = { id, to: worker.definitionId, workerAgentId: worker.id, workspaceId: parent.workspaceId, from: { definitionId: parent.definitionId, agentId: parent.id, conversationId: chat.id, runId: "lost-parent-run" }, task: "finish research", status: "working", createdAt: now, updatedAt: now };
    await runtime.createConversation(worker.id, { id, context: { delegation } });
    if (queued) await Effect.runPromise(data.putPendingInbound({ id: `task:${id}`, definitionId: worker.definitionId, runId: "lost-worker-run", createdAt: now, request: { agentId: worker.id, conversationId: id, workspaceId: worker.workspaceId, message: delegation.task, source: { kind: "delegation", id } } }));
    await runtime.start();
    const deadline = Date.now() + 30_000;
    let result;
    while (Date.now() < deadline) {
      result = (await runtime.listDelegations({ agentId: parent.id })).find((item) => item.status === "completed");
      if (result) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(result?.result, "research done");
    assert.equal(result?.workerAgentId, worker.id);
    while (!(await runtime.listRuns("assistant")).some((run) => run.conversationId === chat.id && run.status === "completed") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal((await runtime.listRuns(worker.definitionId)).length, 1, "startup recovery does not enqueue the same task twice");
  } finally { await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});
