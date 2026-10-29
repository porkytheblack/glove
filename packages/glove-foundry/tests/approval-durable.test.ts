import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import {
  FoundryApprovalDisplayManager,
  approvalStoreFrom,
  createFoundryApproval,
  listFoundryApprovals,
} from "../src/approval.js";
import { defineApplication } from "../src/application.js";
import { discoverAgents } from "../src/discovery.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { MemoryFoundryDataAdapter } from "../src/primitives.js";
import { FoundryRuntime, type FoundryRun } from "../src/runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "approval-agents");
const applicationFilePath = resolve(rootDir, "approval-application.ts");

const identity = {
  runId: "run-restart",
  definitionId: "clerk",
  agentId: "clerk-1",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
  toolName: "refund_payment",
  toolInput: { amount: 80 },
};

async function eventually<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

test("an approval stays pending across a new data adapter and approving it resumes the waiter", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-restart-"));
  const file = join(directory, "foundry.json");
  const channel = await mkdtemp(resolve(tmpdir(), "foundry-approval-channel-"));
  const controller = new AbortController();
  try {
    const store = approvalStoreFrom(new FileFoundryDataAdapter({ file }));
    assert.ok(store);
    const manager = new FoundryApprovalDisplayManager({
      directory: channel,
      store,
      ...identity,
      signal: controller.signal,
      emit: () => {},
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: { toolName: identity.toolName, toolInput: identity.toolInput },
    });
    const pending = await eventually(async () => {
      const listed = await Effect.runPromise(new FileFoundryDataAdapter({ file }).listApprovals!());
      return listed.find((item) => item.status === "pending");
    }, "pending approval");
    assert.equal(pending.expiresAt, null);
    const restarted = new FileFoundryDataAdapter({ file });
    const resolved = await Effect.runPromise(restarted.settleApproval!(pending.id, "approved", true));
    assert.equal(resolved.status, "approved");
    assert.equal(resolved.needsResume, true);
    assert.equal(await decision, true);
    assert.equal((await Effect.runPromise(restarted.listApprovals!()))[0]?.status, "approved");
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
    await rm(channel, { recursive: true, force: true });
  }
});

test("denying an approval after a restart fails closed for the waiter", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-deny-"));
  const file = join(directory, "foundry.json");
  const channel = await mkdtemp(resolve(tmpdir(), "foundry-approval-deny-channel-"));
  const controller = new AbortController();
  try {
    const store = approvalStoreFrom(new FileFoundryDataAdapter({ file }))!;
    const manager = new FoundryApprovalDisplayManager({
      directory: channel,
      store,
      ...identity,
      runId: "run-deny",
      signal: controller.signal,
      emit: () => {},
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: { toolName: identity.toolName, toolInput: identity.toolInput },
    });
    const pending = await eventually(
      async () => (await store.list()).find((item) => item.status === "pending"),
      "pending approval",
    );
    const restarted = approvalStoreFrom(new FileFoundryDataAdapter({ file }))!;
    const resolved = await restarted.settle(pending.id, "denied", true);
    assert.equal(resolved.status, "denied");
    assert.equal(await decision, false);
    await assert.rejects(restarted.settle(pending.id, "approved"), /already denied/);
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
    await rm(channel, { recursive: true, force: true });
  }
});

test("a configured approval expiry denies the tool and records expired", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-expiry-"));
  const controller = new AbortController();
  try {
    const manager = new FoundryApprovalDisplayManager({
      directory,
      ...identity,
      runId: "run-expire",
      signal: controller.signal,
      timeoutMs: 1_000,
      emit: () => {},
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: { toolName: identity.toolName, toolInput: identity.toolInput },
    });
    assert.equal(await decision, false);
    assert.equal((await listFoundryApprovals(directory))[0]?.status, "expired");
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("abort, a missing channel, and a denied continuation all fail closed", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-closed-"));
  const controller = new AbortController();
  try {
    const missing = new FoundryApprovalDisplayManager({
      ...identity,
      signal: controller.signal,
      emit: () => {},
    });
    assert.equal(await missing.pushAndWait({
      renderer: "permission_request",
      input: { toolName: "refund_payment", toolInput: { amount: 80 } },
    }), false);

    const durable = new MemoryFoundryDataAdapter();
    const store = approvalStoreFrom(durable)!;
    const created = await createFoundryApproval(directory, identity);
    await store.put(created);
    const waiting = new AbortController();
    const manager = new FoundryApprovalDisplayManager({
      directory,
      store,
      ...identity,
      signal: waiting.signal,
      preserveOnAbort: true,
      emit: () => {},
    });
    const decision = manager.pushAndWait<Record<string, unknown>, boolean>({
      renderer: "permission_request",
      input: { toolName: identity.toolName, toolInput: identity.toolInput },
    });
    await eventually(async () => (await store.list()).find((item) => item.status === "pending"), "pending");
    waiting.abort();
    await assert.rejects(decision, /interrupted/);
    assert.equal((await store.list())[0]?.status, "pending");

    const denied = new FoundryApprovalDisplayManager({
      directory,
      store,
      ...identity,
      runId: "run-resume-deny",
      signal: controller.signal,
      resume: {
        id: created.id,
        status: "denied",
        toolName: identity.toolName,
        toolInput: identity.toolInput,
      },
      emit: () => {},
    });
    assert.equal(await denied.pushAndWait({
      renderer: "permission_request",
      input: { toolName: identity.toolName, toolInput: identity.toolInput },
    }), false);
    assert.equal((await listFoundryApprovals(directory, { status: "pending" })).length, 1);
  } finally {
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

interface LogEntry { readonly event: string; readonly amount?: number }

async function readLog(file: string): Promise<LogEntry[]> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

async function boot(file: string): Promise<FoundryRuntime> {
  const runtime = new FoundryRuntime({
    rootDir,
    agents: await discoverAgents({ agentsDir }),
    application: defineApplication({
      name: "Approval durability",
      data: new FileFoundryDataAdapter({ file }),
    }),
    applicationFilePath,
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10, maxConcurrent: 2 } },
  });
  await runtime.start();
  return runtime;
}

test("resolving an approval after a runtime restart resumes the run", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-runtime-"));
  const file = join(directory, "foundry.json");
  const logFile = join(directory, "refund.log");
  process.env.FOUNDRY_TEST_APPROVAL_DATA = file;
  process.env.FOUNDRY_TEST_DELEGATION_LOG = logFile;
  let first: FoundryRuntime | undefined;
  let second: FoundryRuntime | undefined;
  try {
    first = await boot(file);
    const agent = await first.createAgent("clerk", { id: "clerk-1" });
    const conversation = await first.createConversation(agent.id, { id: "refunds" });
    const run = await first.send(agent.id, conversation.id, "Please refund 80");
    const pending = await eventually(async () => {
      const listed = await first!.listApprovals({ status: "pending" });
      return listed[0];
    }, "the run to ask for approval");
    assert.equal(pending.toolName, "refund_payment");
    assert.equal(pending.expiresAt, null);
    assert.equal((await readLog(logFile)).some((entry) => entry.event === "refunded"), false);
    await first.stop();
    first = undefined;

    second = await boot(file);
    const restored = await second.listApprovals({ status: "pending" });
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.id, pending.id);
    const approved = await second.resolveApproval(pending.id, "approve");
    assert.equal(approved.status, "approved");
    const resumed = await eventually(async () => {
      const runs = await second!.listRuns("clerk");
      return runs.find((item) => item.status === "completed" && item.id !== run.id);
    }, "the continuation run");
    assert.equal((resumed as FoundryRun).status, "completed");
    const refunds = (await readLog(logFile)).filter((entry) => entry.event === "refunded");
    assert.deepEqual(refunds.map((entry) => entry.amount), [80]);
  } finally {
    await first?.stop();
    await second?.stop();
    delete process.env.FOUNDRY_TEST_APPROVAL_DATA;
    delete process.env.FOUNDRY_TEST_DELEGATION_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});

test("denying an approval after a runtime restart does not run the tool", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "foundry-approval-runtime-deny-"));
  const file = join(directory, "foundry.json");
  const logFile = join(directory, "refund.log");
  process.env.FOUNDRY_TEST_APPROVAL_DATA = file;
  process.env.FOUNDRY_TEST_DELEGATION_LOG = logFile;
  let first: FoundryRuntime | undefined;
  let second: FoundryRuntime | undefined;
  try {
    first = await boot(file);
    const agent = await first.createAgent("clerk", { id: "clerk-2" });
    const conversation = await first.createConversation(agent.id, { id: "refunds-2" });
    await first.send(agent.id, conversation.id, "Please refund 80");
    const pending = await eventually(
      async () => (await first!.listApprovals({ status: "pending" }))[0],
      "the run to ask for approval",
    );
    await first.stop();
    first = undefined;

    second = await boot(file);
    await second.resolveApproval(pending.id, "deny");
    const resumed = await eventually(async () => {
      const runs = await second!.listRuns("clerk");
      return runs.find((item) => item.status === "completed");
    }, "the continuation run");
    assert.equal(resumed?.status, "completed");
    const output = JSON.stringify(resumed?.output ?? "");
    assert.match(output, /not approved/);
    assert.equal((await readLog(logFile)).some((entry) => entry.event === "refunded"), false);
    assert.equal((await second.listApprovals())[0]?.status, "denied");
  } finally {
    await first?.stop();
    await second?.stop();
    delete process.env.FOUNDRY_TEST_APPROVAL_DATA;
    delete process.env.FOUNDRY_TEST_DELEGATION_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});
