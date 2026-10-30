import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Displaymanager, Glove, MemoryStore, type Message } from "glove-core";
import { z } from "zod";
import { compileAgentDefinition } from "../src/agent-runtime.js";
import { defineAgent, FOUNDRY_EXECUTION_MARKER } from "../src/definition.js";
import { FOUNDRY_MAILBOX_DIRECTORY_ENV, writeMailboxDelivery } from "../src/delegation.js";

function envelope(eventTurn: boolean) {
  const now = new Date().toISOString();
  const event = { id: "addressed", source: "test", content: "Research finding" };
  return {
    [FOUNDRY_EXECUTION_MARKER]: true, eventTurn, conversationLease: true,
    request: { agentId: "agent", conversationId: "conversation", workspaceId: "workspace", message: "continue", source: { kind: "direct" } },
    agent: { id: "agent", definitionId: "replacement", workspaceId: "workspace", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
    conversation: { id: "conversation", agentId: "agent", workspaceId: "workspace", context: {}, createdAt: now, updatedAt: now },
    events: [{ kind: "agent-message" as const, pendingId: "pending", message: event.content, durable: { id: "journal-id", event, policy: { whenIdle: "defer" as const } } }],
  };
}

for (const mode of ["default policy", "deferred policy", "wrapper"] as const)
for (const eventTurn of [true, false]) test(`build ${mode} receives and acknowledges addressed events (event turn: ${eventTurn})`, async () => {
  const seen: Message[][] = [];
  const store = new MemoryStore("replacement");
  const model = { name: "mock", setSystemPrompt() {}, async prompt(request: { messages: Message[] }) {
    seen.push(structuredClone(request.messages));
    return { messages: [{ sender: "agent" as const, text: "processed" }], tokens_in: 1, tokens_out: 1 };
  } };
  const definition = defineAgent({
    description: "Independent build replacement", systemPrompt: "Assembled prompt", model, store: () => store,
    build: (base) => mode === "wrapper" ? new Proxy(base, { get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : new Glove({ model, store, displayManager: new Displaymanager(), systemPrompt: "Replacement prompt", compaction_config: { compaction_instructions: "Summarize" },
      ...(mode === "deferred policy" ? { events: { policy: () => "defer" as const, deferTimeoutMs: Infinity } } : {}),
    }).build(),
  });
  const result = await compileAgentDefinition(definition, "replacement").handler!(envelope(eventTurn)) as { status: string; value: unknown; consumedEventIds?: string[] };
  assert.equal(result.status, "completed");
  assert.equal(result.value, "processed");
  assert.equal(seen.length, 1);
  assert.match(seen[0].find((message) => message.framework_context === "event")!.text, /Research finding/);
  assert.deepEqual(result.consumedEventIds, ["journal-id"]);
  assert.equal((await store.getMessages()).filter((message) => message.framework_context === "event").length, 1);
});

for (const during of ["build", "tool execution"] as const) test(`replacement receives live arrivals during ${during}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "replacement-events-"));
  const previous = process.env[FOUNDRY_MAILBOX_DIRECTORY_ENV];
  process.env[FOUNDRY_MAILBOX_DIRECTORY_ENV] = directory;
  try {
    const seen: Message[][] = [];
    const late = { ...envelope(true).events[0]!, pendingId: "late-pending", message: "Late finding", durable: {
      id: "late-journal", event: { id: "late", source: "test", content: "Late finding" }, policy: { whenIdle: "defer" as const },
    } };
    const arrive = async () => {
      await writeMailboxDelivery(directory, "conversation", late);
      const mailbox = join(directory, Buffer.from("conversation").toString("hex"));
      const deadline = Date.now() + 5_000;
      while ((await readdir(mailbox)).some((file) => file.endsWith(".json"))) {
        assert.ok(Date.now() < deadline, "mailbox did not receive the delivery");
        await delay(10);
      }
      await delay(0); // let the mailbox's forwarding callback settle after its read
    };
    let calls = 0;
    const definition = defineAgent({ description: "Live replacement", systemPrompt: "Assembled", run: (_agent, ctx) => ctx.defaultRun(), build: async () => {
      if (during === "build") await arrive();
      return new Glove({ displayManager: new Displaymanager(), systemPrompt: "Replacement", compaction_config: { compaction_instructions: "Summarize" },
        model: { name: "mock", setSystemPrompt() {}, async prompt(request) {
          seen.push(structuredClone(request.messages));
          if (calls++ === 0 && during === "tool execution") return { messages: [{ sender: "agent" as const, text: "", tool_calls: [{ id: "wait", tool_name: "wait", input_args: {} }] }], tokens_in: 1, tokens_out: 1 };
          return { messages: [{ sender: "agent" as const, text: "processed" }], tokens_in: 1, tokens_out: 1 };
        } },
      }).fold({ name: "wait", description: "Wait for delivery", inputSchema: z.object({}), async do() { await arrive(); return { status: "success", data: null }; } }).build();
    } });
    const result = await compileAgentDefinition(definition, "replacement").handler!(envelope(true)) as { value: unknown; consumedEventIds?: string[] };
    assert.equal(result.value, "processed");
    assert.match(seen.at(-1)!.filter((message) => message.framework_context === "event").map((message) => message.text).join("\n"), /Late finding/);
    assert.deepEqual(result.consumedEventIds?.slice().sort(), ["journal-id", "late-journal"]);
  } finally {
    if (previous === undefined) delete process.env[FOUNDRY_MAILBOX_DIRECTORY_ENV];
    else process.env[FOUNDRY_MAILBOX_DIRECTORY_ENV] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
