import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  claimFoundryCoreCommandRequest,
  createFoundryCoreCommandRequest,
  getFoundryCoreCommandRequest,
  monitorFoundryCoreCommandRequest,
  settleFoundryCoreCommandRequest,
  waitForFoundryCoreCommandResult,
} from "../src/core-command-result.js";

const commandId = "command_12345678-1234-4123-8123-123456789abc";

test("awaited core commands are claimed once and return their exact output", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-command-result-"));
  const controller = new AbortController();
  try {
    const request = await createFoundryCoreCommandRequest(directory, {
      id: commandId,
      runId: "run-1",
      type: "transmit",
      command: {
        id: commandId,
        type: "transmit",
        definitionId: "assistant",
        agentId: "assistant-1",
        conversationId: "conversation-1",
        workspaceId: "workspace-1",
        routeId: "messages-outbound",
        payload: { artifact: "private-bytes" },
        observability: { artifact: { name: "report.pdf", bytes: 42 } },
      },
    });
    assert.deepEqual(await getFoundryCoreCommandRequest(directory, commandId), request);
    assert.equal(await claimFoundryCoreCommandRequest(directory, commandId), true);
    assert.equal(await claimFoundryCoreCommandRequest(directory, commandId), false);
    await settleFoundryCoreCommandRequest(directory, commandId, {
      status: "success",
      output: { results: [{ title: "Foundry" }] },
    });
    assert.deepEqual(
      await waitForFoundryCoreCommandResult(directory, request, controller.signal),
      { results: [{ title: "Foundry" }] },
    );
    await settleFoundryCoreCommandRequest(directory, commandId, {
      status: "error",
      error: "must not overwrite",
    });
    assert.deepEqual(
      await waitForFoundryCoreCommandResult(directory, request, controller.signal),
      { results: [{ title: "Foundry" }] },
    );
    assert.deepEqual(
      await waitForFoundryCoreCommandResult(directory, request, controller.signal, { cleanup: true }),
      { results: [{ title: "Foundry" }] },
    );
    assert.equal(await getFoundryCoreCommandRequest(directory, commandId), null);
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("awaited core command failures and cancellation reach the agent", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-command-failure-"));
  const failureController = new AbortController();
  try {
    const failed = await createFoundryCoreCommandRequest(directory, {
      id: "command_22345678-1234-4123-8123-123456789abc",
      runId: "run-2",
      type: "transmit",
    });
    await settleFoundryCoreCommandRequest(directory, failed.id, {
      status: "error",
      error: "provider unavailable",
    });
    await assert.rejects(
      waitForFoundryCoreCommandResult(directory, failed, failureController.signal),
      /provider unavailable/,
    );

    const cancelled = await createFoundryCoreCommandRequest(directory, {
      id: "command_32345678-1234-4123-8123-123456789abc",
      runId: "run-3",
      type: "transmit",
    });
    const cancellation = new AbortController();
    const delivery = new AbortController();
    const monitoring = new AbortController();
    const monitor = monitorFoundryCoreCommandRequest(
      directory,
      cancelled,
      delivery,
      monitoring.signal,
    );
    const waiting = waitForFoundryCoreCommandResult(directory, cancelled, cancellation.signal);
    cancellation.abort();
    await assert.rejects(waiting, /cancelled/);
    await monitor;
    assert.equal(delivery.signal.aborted, true);
    assert.match(String(delivery.signal.reason), /cancelled/);
  } finally {
    failureController.abort();
    await rm(directory, { recursive: true, force: true });
  }
});
