import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { FoundryServer } from "../src/server.js";
import { createFoundryClient } from "../src/client.js";
import { FoundryRuntime } from "../src/runtime.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { MemoryFoundryDataAdapter } from "../src/primitives.js";
import { defineApplication } from "../src/application.js";
import { eventRecordId, type FoundryEventRecord } from "../src/event-delivery.js";

async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, "event delivery timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

for (const kind of ["memory", "file"] as const) test(`${kind} event journal atomically claims ids and retains terminal deduplication receipts`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-event-journal-"));
  try {
    const file = join(directory, "state.json");
    const data = kind === "file" ? new FileFoundryDataAdapter({ file }) : new MemoryFoundryDataAdapter();
    const target = { agentId: "worker", conversationId: "work" };
    const record: FoundryEventRecord = { id: eventRecordId(target, "event"), target, definitionId: "worker", workspaceId: "default", createdAt: new Date().toISOString(), status: "pending", event: { id: "event", source: "test", content: "finding" }, policy: { whenIdle: "defer" }, delivery: { kind: "agent-message", pendingId: "event", message: "finding" } };
    assert.deepEqual((await Promise.all([Effect.runPromise(data.claimEvent(record)), Effect.runPromise(data.claimEvent(record))])).sort(), [false, true]);
    await Effect.runPromise(data.putEvent({ ...record, status: "acknowledged" }));
    const reopened = kind === "file" ? new FileFoundryDataAdapter({ file }) : data;
    assert.equal(await Effect.runPromise(reopened.claimEvent(record)), false);
    assert.equal((await Effect.runPromise(reopened.listEvents()))[0]?.status, "acknowledged");
    assert.notEqual(eventRecordId(target, "event"), eventRecordId({ ...target, conversationId: "other" }, "event"));
    await Effect.runPromise(reopened.provisionAgent({ id: "worker", definitionId: "worker", provisioningKey: "journal-worker", workspaceId: "default", durableSubagent: { parentAgentId: "parent", name: "worker", status: "archived" } }));
    await Effect.runPromise(reopened.purgeAgentData("worker"));
    await Effect.runPromise(reopened.putEvent(record));
    assert.equal((await Effect.runPromise(reopened.listEvents())).length, 0, "a late receipt cannot restore purged event data");
    await assert.rejects(Effect.runPromise(reopened.claimEvent(record)), /purged/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("addressed events preserve deferral, expiry and deduplication across restarts without mesh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-events-runtime-"));
  const file = join(directory, "state.json");
  const data = new FileFoundryDataAdapter({ file });
  const make = () => FoundryRuntime.discover({ rootDir: resolve("tests/fixtures"), agentsDir: resolve("tests/fixtures/durable-subagents"), application: defineApplication({ name: "events", data: new FileFoundryDataAdapter({ file }) }), config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } } });
  let runtime = await make();
  const server = new FoundryServer(runtime, { port: 0 });
  try {
    await runtime.start();
    const { url } = await server.listen();
    const client = createFoundryClient({ baseUrl: url });
    const parent = await runtime.createAgent("assistant", { id: "event-parent" });
    const worker = await runtime.subagent(parent.id, "research");
    const chat = await runtime.createConversation(worker.id, { id: "explicit-target" });
    const unrelated = await runtime.createConversation(parent.id);
    await assert.rejects(runtime.emitEvent({ agentId: worker.id, conversationId: unrelated.id }, { id: "bad", source: "test", content: "bad" }), /owned/);
    const target = { agentId: worker.id, conversationId: chat.id };
    const deferred = { id: "stable", source: "test", content: "persisted finding" };
    const receipt = await client.emitEvent(target, deferred, { whenIdle: "defer" });
    assert.equal(receipt.runId, undefined);
    await runtime.emitEvent(target, { id: "expired", source: "test", content: "never deliver", expiresAt: "2000-01-01T00:00:00Z" });
    assert.equal((await runtime.listRuns(worker.definitionId)).length, 0);
    await server.close(); await runtime.stop(); runtime = await make(); await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await runtime.listRuns(worker.definitionId)).length, 0, "restart must respect indefinite deferral");
    const next = await runtime.send(worker.id, chat.id, "drain");
    const result = await runtime.waitForRun(next.id, { timeoutMs: 30_000 });
    assert.equal(result?.status, "completed");
    assert.match(String((result?.output as { value: unknown }).value), /events:1:.*persisted finding/s);
    assert.doesNotMatch(String((result?.output as { value: unknown }).value), /never deliver/);
    await eventually(async () => (await Effect.runPromise(data.listEvents())).find((event) => event.event.id === "stable" && event.status === "acknowledged"));
    await runtime.stop(); runtime = await make(); await runtime.start();
    const before = (await runtime.listRuns(worker.definitionId)).length;
    await runtime.emitEvent(target, deferred, { whenIdle: "defer" });
    assert.equal((await runtime.listRuns(worker.definitionId)).length, before, "acknowledged id cannot start another run");
    await assert.rejects(runtime.emitEvent(target, { ...deferred, content: "different payload" }, { whenIdle: "defer" }), /already belongs/);
    const wake = await runtime.messageSubagent(parent.id, "research", "native event", { conversationId: chat.id, id: "native" });
    const handled = await runtime.waitForRun(wake.runId!, { timeoutMs: 30_000 });
    assert.equal(handled?.status, "completed");
    assert.match(String((handled?.output as { value: unknown }).value), /events:1:.*native event/s);
    const delayed = await runtime.emitEvent(target, { id: "delayed", source: "test", content: "native event" }, { whenIdle: "defer", deferTimeoutMs: 300 });
    assert.equal(delayed.runId, undefined);
    const journal = await eventually(async () => (await Effect.runPromise(data.listEvents())).find((event) => event.event.id === "delayed" && event.status === "acknowledged"));
    assert.ok(journal.runId);
    const inspection = await runtime.subagentData(parent.id, "research");
    assert.equal(inspection.events.find((event) => event.event.id === "expired")?.status, "expired");
    await runtime.archiveSubagent(parent.id, "research"); await runtime.purgeSubagent(parent.id, "research");
    assert.equal((await Effect.runPromise(data.listEvents())).filter((event) => event.target.agentId === worker.id).length, 0);
  } finally { await server.close(); await runtime.stop(); await rm(directory, { recursive: true, force: true }); }
});


test("an in-flight direct event is replayed after its execution process is stopped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-events-inflight-"));
  const file = join(directory, "state.json");
  const marker = join(directory, "started");
  process.env.FOUNDRY_TEST_EVENT_RECOVERY_FILE = marker;
  const data = new FileFoundryDataAdapter({ file });
  const make = () => FoundryRuntime.discover({ rootDir: resolve("tests/fixtures"), agentsDir: resolve("tests/fixtures/durable-subagents"), application: defineApplication({ name: "events-recovery", data: new FileFoundryDataAdapter({ file }) }), config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } } });
  let runtime = await make();
  try {
    await runtime.start();
    const parent = await runtime.createAgent("assistant", { id: "inflight-parent" });
    const receipt = await runtime.messageSubagent(parent.id, "research", "crash once", { id: "inflight" });
    await eventually(async () => { try { await access(marker); return true; } catch { return undefined; } });
    assert.equal((await runtime.getRun(receipt.runId!))?.status, "running");
    await runtime.stop();
    assert.equal((await Effect.runPromise(data.listEvents())).find((event) => event.event.id === "inflight")?.status, "pending");
    runtime = await make(); await runtime.start();
    const completed = await eventually(async () => (await Effect.runPromise(data.listEvents())).find((event) => event.event.id === "inflight" && event.status === "acknowledged"));
    assert.notEqual(completed.runId, receipt.runId);
    const run = await runtime.getRun(completed.runId!);
    assert.equal((run?.output as { value: unknown }).value, "recovered in-flight event");
  } finally { await runtime.stop(); delete process.env.FOUNDRY_TEST_EVENT_RECOVERY_FILE; await rm(directory, { recursive: true, force: true }); }
});
