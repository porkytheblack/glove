import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import { defineApplication } from "../src/application.js";
import type { FoundryCoreCommand } from "../src/core-tools.js";
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
  type FoundryActivationRecord,
} from "../src/primitives.js";
import { FoundryRuntime } from "../src/runtime.js";
import { defineSchedule, agentScheduleActivationId, agentScheduleRevision } from "../src/schedule.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "agents");

async function waitForActivation(runtime: FoundryRuntime, commandId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const run = (await runtime.listRuns("assistant")).find((candidate) => {
      const input = candidate.input as { source?: { id?: string } } | undefined;
      return input?.source?.id === commandId;
    });
    if (run) return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Activation ${commandId} did not create a run.`);
}

test("sleep wakes the same instance and conversation after a duration-derived time", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("assistant", {
      id: "sleeping-agent",
      workspaceId: "activation-test",
    });
    const conversation = await runtime.createConversation(agent.id, {
      id: "sleeping-conversation",
    });
    const command: FoundryCoreCommand = {
      id: "command_sleep_test",
      type: "sleep",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      wakeAt: new Date(Date.now() + 400).toISOString(),
      message: "Resolve the work after sleeping.",
    };
    await (runtime as unknown as {
      executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
    }).executeCoreCommand(command, "parent-sleep");

    assert.equal(
      (await runtime.listRuns("assistant")).some((candidate) => {
        const input = candidate.input as { source?: { id?: string } } | undefined;
        return input?.source?.id === command.id;
      }),
      false,
      "A future sleep must not enter the execution queue before its wake time.",
    );

    const queued = await waitForActivation(runtime, command.id);
    const completed = await runtime.waitForRun(queued.id, { pollMs: 25, timeoutMs: 15_000 });
    const request = queued.input as {
      agentId: string;
      conversationId: string;
      source: { kind: string };
    };
    assert.equal(request.agentId, agent.id);
    assert.equal(request.conversationId, conversation.id);
    assert.equal(request.source.kind, "activation");
    assert.equal(completed?.status, "completed");
  } finally {
    await runtime.stop();
  }
});

test("one-shot schedules can move and cancel without leaking an old timer", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("assistant", {
      id: "one-shot-agent",
      workspaceId: "activation-test",
    });
    const conversation = await runtime.createConversation(agent.id, {
      id: "one-shot-conversation",
    });
    const created: FoundryCoreCommand = {
      id: "command_one_shot_test",
      type: "schedule",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      message: "This should be cancelled before dispatch.",
      timing: { kind: "at", at: new Date(Date.now() + 500).toISOString() },
    };
    const execute = (command: FoundryCoreCommand) =>
      (runtime as unknown as {
        executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
      }).executeCoreCommand(command, "parent-one-shot");
    await execute(created);
    await execute({
      id: "command_move_one_shot",
      type: "schedule.update",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      activationId: created.id,
      patch: { timing: { kind: "at", at: new Date(Date.now() + 1_000).toISOString() } },
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 650));
    assert.equal(
      (await runtime.listRuns("assistant")).some((run) =>
        (run.input as { source?: { id?: string } }).source?.id === created.id),
      false,
    );
    await execute({
      id: "command_cancel_one_shot",
      type: "schedule.cancel",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      activationId: created.id,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 450));
    assert.equal(
      (await runtime.listRuns("assistant")).some((run) =>
        (run.input as { source?: { id?: string } }).source?.id === created.id),
      false,
    );
    assert.equal(
      (await Effect.runPromise(runtime.data.getActivation(created.id)))?.status,
      "cancelled",
    );
  } finally {
    await runtime.stop();
  }
});

test("recurring work can only enter the runtime through a core schedule command", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("assistant", {
      id: "recurring-agent",
      workspaceId: "activation-test",
    });
    const conversation = await runtime.createConversation(agent.id, {
      id: "recurring-conversation",
    });
    const command: FoundryCoreCommand = {
      id: "command_recurring_test",
      type: "schedule",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      message: "Perform the recurring review.",
      timing: { kind: "every", intervalMs: 75 },
    };
    await (runtime as unknown as {
      executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
    }).executeCoreCommand(command, "parent-recurring");

    const queued = await waitForActivation(runtime, command.id);
    assert.equal((queued.input as { source: { kind: string } }).source.kind, "activation");
    const stored = await Effect.runPromise(runtime.data.getActivation(command.id));
    assert.equal(stored?.status, "active");
    assert.deepEqual(stored?.timing, { kind: "every", intervalMs: 75 });
  } finally {
    await runtime.stop();
  }
});

test("adapter-backed sleep data is reconstructed into a wake-up on startup", async () => {
  const agent = createAgentInstance("assistant", {
    id: "restored-agent",
    workspaceId: "restored-workspace",
  });
  const conversation = createConversation(agent, {
    id: "restored-conversation",
    workspaceId: agent.workspaceId,
  });
  const now = new Date();
  const activation: FoundryActivationRecord = {
    id: "command_restored_sleep",
    kind: "sleep",
    definitionId: "assistant",
    agentId: agent.id,
    conversationId: conversation.id,
    workspaceId: agent.workspaceId,
    message: "Resume the persisted work.",
    timing: { kind: "at", at: new Date(now.getTime() + 75).toISOString() },
    origin: "agent-tool",
    status: "pending",
    createdByRunId: "parent-before-restart",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const data = new MemoryFoundryDataAdapter({
    agents: [agent],
    conversations: [conversation],
    activations: [activation],
  });
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    application: defineApplication({ name: "activation-reconstruction", data }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  try {
    const queued = await waitForActivation(runtime, activation.id);
    const completed = await runtime.waitForRun(queued.id, { pollMs: 25, timeoutMs: 15_000 });
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.agentId, agent.id);
    assert.equal(completed?.conversationId, conversation.id);
  } finally {
    await runtime.stop();
  }
});

test("agent schedule definitions derive runtime identity without authored ids", () => {
  const schedule = defineSchedule({
    name: "daily-review",
    message: "Review the workspace.",
    timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  });
  assert.equal("id" in schedule, false);
  assert.equal(
    agentScheduleActivationId("assistant", "agent-one", schedule.name),
    agentScheduleActivationId("assistant", "agent-one", schedule.name),
  );
  assert.equal(agentScheduleRevision(schedule).length, 64);
});

test("scheduled activations can be updated and cancelled by their owning agent", async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  try {
    const agent = await runtime.createAgent("assistant", {
      id: "managed-schedule-agent",
      workspaceId: "activation-test",
    });
    const conversation = await runtime.createConversation(agent.id, {
      id: "managed-schedule-conversation",
    });
    const created: FoundryCoreCommand = {
      id: "command_managed_schedule",
      type: "schedule",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      message: "Review once per hour.",
      timing: { kind: "every", intervalMs: 3_600_000 },
    };
    const execute = (command: FoundryCoreCommand) =>
      (runtime as unknown as {
        executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
      }).executeCoreCommand(command, "parent-management");
    await execute(created);
    await execute({
      id: "command_update_schedule",
      type: "schedule.update",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      activationId: created.id,
      patch: { message: "Review twice per hour.", timing: { kind: "every", intervalMs: 1_800_000 } },
    });
    const updated = await Effect.runPromise(runtime.data.getActivation(created.id));
    assert.equal(updated?.message, "Review twice per hour.");
    assert.deepEqual(updated?.timing, { kind: "every", intervalMs: 1_800_000 });
    assert.equal(updated?.status, "active");

    await execute({
      id: "command_cancel_schedule",
      type: "schedule.cancel",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      activationId: created.id,
    });
    assert.equal(
      (await Effect.runPromise(runtime.data.getActivation(created.id)))?.status,
      "cancelled",
    );
  } finally {
    await runtime.stop();
  }
});
