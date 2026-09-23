import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StationClient } from "station-client";
import type { FoundryStationConnection } from "../src/station.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FOUNDRY_EXECUTION_MARKER, FOUNDRY_APPLICATION_ENV } from "../src/definition.js";
import { FoundryExecutionBackend } from "../src/execution-backend.js";
import { FoundryObserver, MemoryObservabilityAdapter } from "../src/observability.js";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
function backend(filePath: string, env: Record<string, string> = {}) {
  return new FoundryExecutionBackend({ rootDir, agents: [{ route: "assistant", filePath }],
    runner: { pollIntervalMs: 25, maxConcurrent: 1, maxAttempts: 1, retryBackoffMs: 100 }, env,
    observer: new FoundryObserver(new MemoryObservabilityAdapter(), name => name),
  });
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
test("the execution daemon is a separate process and managed shutdown reaps it", async () => {
  const daemon = backend(resolve(rootDir, "agents/assistant/agent.ts"));
  await daemon.initialize();
  const pid = daemon.processId!;
  try {
    assert.notEqual(pid, process.pid);
    assert.equal(alive(pid), true);
    assert.equal(await daemon.ping(), true);
    assert.equal(await daemon.getRun("missing"), null);
    await assert.rejects(daemon.triggerSignal("foundry_assistant", {}), /trigger failed/);
    assert.equal((await daemon.listAllRuns()).length, 0);
    const now = new Date().toISOString();
    const runId = await daemon.triggerSignal("foundry_assistant", {
      [FOUNDRY_EXECUTION_MARKER]: true,
      request: { agentId: "agent", conversationId: "conversation", workspaceId: "test",
        message: [{ type: "text", text: "large envelope" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(6 * 1024 * 1024) } }],
        source: { kind: "direct" } },
      agent: { id: "agent", definitionId: "assistant", workspaceId: "test", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
      conversation: { id: "conversation", agentId: "agent", workspaceId: "test", context: {}, createdAt: now, updatedAt: now },
    });
    assert.ok((await daemon.getRun(runId))!.input!.length > 5 * 1024 * 1024);
    assert.equal((await daemon.waitForRun(runId, { timeoutMs: 15000 }))?.status, "completed");
  } finally { await daemon.stop(); }
  assert.equal(alive(pid), false);
  await assert.rejects(daemon.ping(), /unavailable/);
});
test("failed definition discovery fails startup and reaps the daemon", async () => {
  const daemon = backend(resolve(rootDir, "missing-agent.ts"));
  await assert.rejects(daemon.initialize(), /init failed/);
  assert.equal(alive(daemon.processId!), false);
  await daemon.stop();
});


test("one managed Station owns resource adapters and agent execution", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-resources-"));
  const events = resolve(directory, "events");
  const connectionFile = resolve(directory, "connection.json");
  const daemon = backend(resolve(rootDir, "agents/assistant/agent.ts"), {
    [FOUNDRY_APPLICATION_ENV]: resolve(rootDir, "daemon.application.ts"),
    FOUNDRY_TEST_RESOURCE_EVENTS: events,
    FOUNDRY_TEST_RESOURCE_CONNECTION: connectionFile,
  });
  try {
    await daemon.initialize();
    const connection: FoundryStationConnection = JSON.parse(await readFile(connectionFile, "utf8"));
    const client = new StationClient({ url: connection.url, token: connection.token });
    const stations = await client.executionStations();
    assert.equal(stations.length, 1);
    assert.equal(stations[0].stationId, "unified-test");
    assert.equal(stations[0].capabilities.sandbox, true);
    const boxes = await client.execution<Array<{ id: string }>>(connection.stationId, "sandbox", { method: "list" });
    assert.equal(boxes[0].id, "test-box");
    const now = new Date().toISOString();
    const run = await daemon.triggerSignal("foundry_assistant", {
      [FOUNDRY_EXECUTION_MARKER]: true,
      request: { agentId: "agent", conversationId: "conversation", workspaceId: "test", message: "hello", source: { kind: "direct" } },
      agent: { id: "agent", definitionId: "assistant", workspaceId: "test", context: {}, installations: [], playbooks: [], createdAt: now, updatedAt: now },
      conversation: { id: "conversation", agentId: "agent", workspaceId: "test", context: {}, createdAt: now, updatedAt: now },
    });
    assert.equal((await daemon.waitForRun(run, { timeoutMs: 15000 }))?.status, "completed");
    assert.equal(await readFile(events, "utf8"), `setup:${daemon.processId}\n`);
    await daemon.stop();
    assert.equal(await readFile(events, "utf8"), `setup:${daemon.processId}\nclosed\n`);
    assert.equal(alive(daemon.processId!), false);
  } finally { await daemon.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("failed resource startup callback closes resources and reaps the daemon", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-resources-fail-"));
  const events = resolve(directory, "events");
  const daemon = backend(resolve(rootDir, "agents/assistant/agent.ts"), {
    [FOUNDRY_APPLICATION_ENV]: resolve(rootDir, "daemon.application.ts"),
    FOUNDRY_TEST_RESOURCE_EVENTS: events, FOUNDRY_TEST_RESOURCE_FAIL: "1",
  });
  try {
    await assert.rejects(daemon.initialize(), /init failed/);
    assert.equal(await readFile(events, "utf8"), `setup:${daemon.processId}\nclosed\n`);
    assert.equal(alive(daemon.processId!), false);
  } finally { await daemon.stop(); await rm(directory, { recursive: true, force: true }); }
});
