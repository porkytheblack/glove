import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import type { StoreAdapter } from "glove-core";
import {
  FoundryApprovalDisplayManager,
  createFoundryApproval,
  listFoundryApprovals,
  resolveFoundryApproval,
  withFoundryPermissions,
} from "../src/approval.js";

test("approval records resolve exactly once and remain inspectable", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approvals-"));
  try {
    const approval = await createFoundryApproval(directory, {
      runId: "run-1",
      definitionId: "assistant",
      agentId: "assistant-1",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      toolName: "publish_release",
      toolInput: { channel: "stable" },
    });
    assert.equal(approval.status, "pending");
    assert.deepEqual(await listFoundryApprovals(directory, { status: "pending" }), [approval]);

    const resolved = await resolveFoundryApproval(directory, approval.id, "approve");
    assert.equal(resolved.status, "approved");
    assert.equal((await listFoundryApprovals(directory))[0]?.status, "approved");
    await assert.rejects(
      resolveFoundryApproval(directory, approval.id, "deny"),
      /already approved/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("competing operators cannot overwrite the first approval decision", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-race-"));
  try {
    const approval = await createFoundryApproval(directory, {
      runId: "run-race",
      definitionId: "assistant",
      agentId: "assistant-1",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      toolName: "publish_release",
      toolInput: { channel: "stable" },
    });
    const outcomes = await Promise.allSettled([
      resolveFoundryApproval(directory, approval.id, "approve"),
      resolveFoundryApproval(directory, approval.id, "deny"),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    const settled = (await listFoundryApprovals(directory))[0];
    assert.ok(settled?.status === "approved" || settled?.status === "denied");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("headless permission handoff waits for an explicit decision", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-display-"));
  const controller = new AbortController();
  const events: Array<{ type: string; data?: unknown }> = [];
  try {
    const manager = new FoundryApprovalDisplayManager({
      directory,
      runId: "run-2",
      definitionId: "assistant",
      agentId: "assistant-1",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      signal: controller.signal,
      emit: (event) => events.push(event),
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: {
        renderer: "permission_request",
        toolName: "send_message",
        toolInput: { recipient: "operator" },
      },
    });
    let pending = (await listFoundryApprovals(directory, { status: "pending" }))[0];
    for (let attempt = 0; !pending && attempt < 20; attempt++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      pending = (await listFoundryApprovals(directory, { status: "pending" }))[0];
    }
    assert.ok(pending);
    await resolveFoundryApproval(directory, pending.id, "approve");
    assert.equal(await decision, true);
    assert.ok(events.some((event) => event.type === "foundry.approval.requested"));
    assert.ok(events.some((event) => event.type === "foundry.approval.settled"));
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling a run denies and settles its pending approval", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-cancel-"));
  const controller = new AbortController();
  try {
    const manager = new FoundryApprovalDisplayManager({
      directory,
      runId: "run-cancel",
      definitionId: "assistant",
      agentId: "assistant-1",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      signal: controller.signal,
      emit: () => {},
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: {
        toolName: "delete_draft",
        toolInput: { id: "draft-1" },
      },
    });
    let pending = (await listFoundryApprovals(directory, { status: "pending" }))[0];
    for (let attempt = 0; !pending && attempt < 20; attempt++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      pending = (await listFoundryApprovals(directory, { status: "pending" }))[0];
    }
    assert.ok(pending);
    controller.abort();
    assert.equal(await decision, false);
    assert.equal((await listFoundryApprovals(directory))[0]?.status, "cancelled");
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom stores without permission methods gain exact-input decisions", async () => {
  const messages: Awaited<ReturnType<StoreAdapter["getMessages"]>> = [];
  const store: StoreAdapter = {
    identifier: "custom",
    async getMessages() { return messages; },
    async appendMessages(next) { messages.push(...next); },
    async getTokenCount() { return 0; },
    async addTokens() {},
    async getTurnCount() { return 0; },
    async incrementTurn() {},
    async resetCounters() {},
  };
  const safe = withFoundryPermissions(store);
  assert.equal(await safe.getPermission?.("publish", { target: "preview" }), "unset");
  await safe.setPermission?.("publish", "granted", { target: "preview" });
  assert.equal(await safe.getPermission?.("publish", { target: "preview" }), "granted");
  assert.equal(await safe.getPermission?.("publish", { target: "production" }), "unset");
});
