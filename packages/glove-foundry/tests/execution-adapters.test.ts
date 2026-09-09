import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MemoryAdapter } from "station-signal";
import { ScheduleMemoryAdapter } from "station-schedules";
import { defineApplication } from "../src/application.js";
import { FoundryRuntime } from "../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

/** A run queue that records whether anyone tried to close it. */
function trackedRunQueue() {
  const adapter = new MemoryAdapter();
  const state = { closed: false, addRunCalls: 0 };
  const originalAddRun = adapter.addRun.bind(adapter);
  adapter.addRun = async (run) => {
    state.addRunCalls += 1;
    await originalAddRun(run);
  };
  adapter.close = async () => {
    state.closed = true;
  };
  return { adapter, state };
}

function trackedScheduleStore() {
  const adapter = new ScheduleMemoryAdapter();
  const state = { closed: false };
  adapter.close = async () => {
    state.closed = true;
  };
  return { adapter, state };
}

test("an application's run queue and schedule store replace the in-process defaults", async () => {
  const runs = trackedRunQueue();
  const schedules = trackedScheduleStore();

  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({
      name: "durable",
      execution: {
        runs: runs.adapter,
        schedules: schedules.adapter,
        stationId: "replica-a",
      },
    }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });

  await runtime.start();
  try {
    const agent = await runtime.createAgent("assistant", {
      id: "durable-agent",
      workspaceId: "execution-test",
    });
    const conversation = await runtime.createConversation(agent.id, {
      id: "durable-conversation",
    });
    await runtime.request("assistant", {
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      message: "hello",
    });

    // The run landed in the supplied queue, not a private one.
    assert.ok(
      runs.state.addRunCalls > 0,
      "the application's run queue received the run",
    );
  } finally {
    await runtime.stop();
  }

  // Ownership follows construction: Foundry borrowed both, so it closed
  // neither. A shared pool must outlive the runtime that used it.
  assert.equal(runs.state.closed, false, "borrowed run queue was closed");
  assert.equal(schedules.state.closed, false, "borrowed schedule store was closed");
});

test("Foundry closes the schedule store it created itself", async () => {
  let closed = false;
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  const owned = (runtime as unknown as { scheduleAdapter: { close?: () => Promise<void> } })
    .scheduleAdapter;
  owned.close = async () => {
    closed = true;
  };

  await runtime.start();
  await runtime.stop();

  assert.equal(closed, true, "an owned schedule store is closed on stop");
});

test("two runtimes sharing a queue take distinct station identities", async () => {
  const shared = trackedRunQueue();
  const application = (stationId?: string) =>
    defineApplication({
      name: "shared",
      execution: { runs: shared.adapter, ...(stationId ? { stationId } : {}) },
    });

  const first = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: application(),
  });
  const second = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: application(),
  });

  const identityOf = (runtime: FoundryRuntime) =>
    (runtime as unknown as { signalRunner: { stationId: string } }).signalRunner
      .stationId;

  // Two processes sharing a queue must not claim runs under one identity, so
  // the generated default is per-runtime rather than a constant.
  assert.notEqual(identityOf(first), identityOf(second));
  assert.match(identityOf(first), /^foundry-/);

  await first.stop();
  await second.stop();
});
