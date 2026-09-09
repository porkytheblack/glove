import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { StationNetworkMemoryAdapter } from "station-network";
import { MemoryAdapter } from "station-signal";
import { ScheduleMemoryAdapter } from "station-schedules";
import { defineApplication } from "../src/application.js";
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
} from "../src/primitives.js";
import type { FoundryActivationRecord } from "../src/primitives.js";
import { FoundryRuntime } from "../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

const quiet = { execution: { pollIntervalMs: 20, idlePollIntervalMs: 20 } };

function pendingActivation(id: string): FoundryActivationRecord {
  const now = new Date().toISOString();
  return {
    id,
    kind: "scheduled",
    definitionId: "assistant",
    agentId: "fleet-agent",
    conversationId: "fleet-conversation",
    workspaceId: "fleet-test",
    message: "tick",
    timing: { kind: "every", intervalMs: 3_600_000 },
    origin: "agent-definition",
    scheduleName: "hourly",
    status: "pending",
    createdByRunId: "run_seed",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A data adapter seeded with one armable activation and the instance and
 * conversation it belongs to, recording whether anyone listed activations.
 */
function trackedData(activationId: string) {
  const agent = createAgentInstance("assistant", {
    id: "fleet-agent",
    workspaceId: "fleet-test",
  });
  const conversation = createConversation(agent, { id: "fleet-conversation" });
  const activations: FoundryActivationRecord[] = [pendingActivation(activationId)];
  const adapter = new MemoryFoundryDataAdapter({
    agents: [agent],
    conversations: [conversation],
    activations,
  });
  const state = { listCalls: 0 };
  const original = adapter.listActivations.bind(adapter);
  adapter.listActivations = (workspaceId?: string) => {
    state.listCalls += 1;
    return original(workspaceId);
  };
  return { adapter, state };
}

test("a station does not arm activations; headquarters does", async () => {
  const shared = { runs: new MemoryAdapter(), schedules: new ScheduleMemoryAdapter() };

  const station = trackedData("activation_station");
  const stationRuntime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({
      name: "fleet",
      data: station.adapter,
      execution: { ...shared, role: "station", stationId: "station-1" },
    }),
    config: quiet,
  });
  await stationRuntime.start();
  await stationRuntime.stop();

  const hq = trackedData("activation_hq");
  const hqRuntime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({
      name: "fleet",
      data: hq.adapter,
      execution: { ...shared, role: "headquarters", stationId: "hq-1" },
    }),
    config: quiet,
  });
  await hqRuntime.start();
  await hqRuntime.stop();

  // The whole point: adding stations must not multiply boot-time work.
  assert.equal(station.state.listCalls, 0, "a station armed activations");
  assert.ok(hq.state.listCalls > 0, "headquarters did not arm activations");
});

test("headquarters advertises no execution capacity; a station advertises its ceiling", async () => {
  const network = new StationNetworkMemoryAdapter();
  const shared = { runs: new MemoryAdapter(), schedules: new ScheduleMemoryAdapter() };

  const hq = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({
      name: "fleet",
      execution: {
        ...shared,
        role: "headquarters",
        stationId: "hq-1",
        network: { adapter: network, id: "prod" },
      },
    }),
    config: quiet,
  });
  const station = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({
      name: "fleet",
      execution: {
        ...shared,
        role: "station",
        stationId: "station-1",
        network: { adapter: network, id: "prod", labels: { region: "ke" } },
      },
    }),
    config: { execution: { ...quiet.execution, maxConcurrent: 7 } },
  });

  await hq.start();
  await station.start();
  try {
    const members = await network.listStations({ networkId: "prod" });
    const byId = new Map(members.map((node) => [node.id, node]));

    assert.equal(byId.get("hq-1")?.role, "headquarters");
    assert.equal(byId.get("hq-1")?.capacity.maxConcurrent, 0);

    const worker = byId.get("station-1");
    assert.equal(worker?.role, "station");
    assert.equal(worker?.capacity.maxConcurrent, 7);
    assert.deepEqual(worker?.labels, { region: "ke" });
    // A station only claims what it was deployed with, so peers need its list.
    assert.ok((worker?.definitions.signals.length ?? 0) > 0);
  } finally {
    await station.stop();
    await hq.stop();
  }

  // Stopping announces departure rather than waiting out the lease.
  const after = await network.getStation("station-1");
  assert.equal(after?.status, "offline");
});

test("standalone stays the default and still runs both planes", async () => {
  const data = trackedData("activation_solo");
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({ name: "solo", data: data.adapter }),
    config: quiet,
  });
  await runtime.start();
  try {
    assert.ok(data.state.listCalls > 0, "standalone did not arm activations");
    const run = await runtime.request("assistant", {
      agentId: "fleet-agent",
      conversationId: "fleet-conversation",
      workspaceId: "fleet-test",
      message: "hello",
    });
    assert.ok(run.id, "standalone did not accept work");
  } finally {
    await runtime.stop();
  }
});
