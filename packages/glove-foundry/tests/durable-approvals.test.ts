import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { Message } from "glove-core";
import { defineApplication, type FoundryApplicationOptions } from "../src/application.js";
import type { FoundryApproval } from "../src/approval.js";
import { discoverAgents } from "../src/discovery.js";
import { createFoundryClient } from "../src/client.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { FoundryRuntime, type FoundryRun } from "../src/runtime.js";
import { FoundryServer } from "../src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "approval-agents");

interface Setup {
  readonly directory: string;
  readonly data: FileFoundryDataAdapter;
  readonly start: (approvals?: FoundryApplicationOptions["approvals"]) => Promise<FoundryRuntime>;
  readonly sent: () => Promise<string[]>;
  readonly transcript: (conversationId: string) => Promise<Message[]>;
}

/** A runtime over a file data adapter; `start` again after `stop` is a restart. */
async function withSetup(work: (setup: Setup) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-approvals-"));
  process.env.FOUNDRY_TEST_APPROVAL_DIR = join(directory, "transcripts");
  process.env.FOUNDRY_TEST_APPROVAL_LOG = join(directory, "sent.jsonl");
  const data = new FileFoundryDataAdapter({ file: join(directory, "foundry.json") });
  const running: FoundryRuntime[] = [];
  const [agent] = await discoverAgents({ agentsDir });
  try {
    await work({
      directory,
      data,
      start: async (approvals = { waitMs: 300 }) => {
        const runtime = new FoundryRuntime({
          rootDir,
          agents: [agent!],
          application: defineApplication({
            name: "Durable approvals",
            data,
            approvals: { url: (approval) => `https://app.example/approvals/${approval.id}`, ...approvals },
          }),
          config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10, maxConcurrent: 4 } },
        });
        await runtime.start();
        running.push(runtime);
        return runtime;
      },
      sent: async () => (await readFile(join(directory, "sent.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean),
      transcript: async (conversationId) => {
        const file = join(directory, "transcripts", `${Buffer.from(conversationId).toString("hex")}.json`);
        return (JSON.parse(await readFile(file, "utf8")) as { messages: Message[] }).messages;
      },
    });
  } finally {
    for (const runtime of running) await runtime.stop().catch(() => undefined);
    delete process.env.FOUNDRY_TEST_APPROVAL_DIR;
    delete process.env.FOUNDRY_TEST_APPROVAL_LOG;
    await rm(directory, { recursive: true, force: true });
  }
}

async function eventually<T>(read: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value as T;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

const output = (run: FoundryRun | null) => run?.output as { status?: string; value?: unknown; suspension?: { kind?: string; approvalId?: string } } | undefined;

async function finished(runtime: FoundryRuntime, runId: string): Promise<FoundryRun> {
  const run = await runtime.waitForRun(runId, { timeoutMs: 30_000 });
  assert.ok(run && run.status === "completed", `run ${runId} completed (was ${run?.status}: ${run?.error ?? ""})`);
  return run;
}

async function pending(runtime: FoundryRuntime): Promise<FoundryApproval> {
  return eventually(async () => (await runtime.listApprovals({ status: "pending" }))[0], "the approval");
}

async function start(runtime: FoundryRuntime, id: string, text: string) {
  const agent = await runtime.createAgent("approver", { id });
  const conversation = await runtime.createConversation(agent.id, { id: `${id}-chat` });
  return { agent, conversation, run: await runtime.send(agent.id, conversation.id, text) };
}

test("a decision inside the live wait continues the same run", async () => {
  await withSetup(async ({ start: boot, sent }) => {
    const runtime = await boot({ waitMs: 20_000 });
    const { run } = await start(runtime, "ann", "send the note");
    const approval = await pending(runtime);
    assert.equal(approval.url, `https://app.example/approvals/${approval.id}`);
    assert.ok(approval.toolCallId, "the approval names the waiting tool call");
    await runtime.resolveApproval(approval.id, "approve");
    const done = await finished(runtime, run.id);
    assert.equal(output(done)?.value, "sent: success");
    assert.equal((await sent()).length, 1);
    const settled = await eventually(async () => (await runtime.getApproval(approval.id))?.settledInRun && runtime.getApproval(approval.id), "the run to report it");
    assert.equal(settled?.status, "approved");
    assert.equal(settled?.resumeRunId, undefined, "nothing was resumed: the run read the decision itself");
  });
});

test("an approval nobody answers suspends the run, survives a restart, and resumes the call once approved", async () => {
  await withSetup(async ({ start: boot, sent, transcript }) => {
    const first = await boot();
    const { conversation, run } = await start(first, "rosa", "send the note");
    const suspended = await finished(first, run.id);
    assert.equal(output(suspended)?.status, "suspended");
    assert.equal(output(suspended)?.suspension?.kind, "approval");
    const approval = (await first.listApprovals())[0]!;
    assert.equal(output(suspended)?.suspension?.approvalId, approval.id);
    assert.equal(output(suspended)?.value, `Waiting for approval to run send_note (${approval.id}).`, "API callers read what the run waits on");
    assert.equal(approval.status, "pending");
    assert.ok(approval.suspendedAt);
    assert.deepEqual(await sent(), []);
    const before = await transcript(conversation.id);
    assert.ok(!before.some((message) => message.tool_results?.some((item) => item.call_id === approval.toolCallId)), "no result was recorded for the waiting call");
    await first.stop();

    // A new process over the same data: the approval is still there and still open,
    // and its link leads straight to it.
    const second = await boot();
    const server = new FoundryServer(second, { host: "127.0.0.1", port: 0 });
    const listening = await server.listen();
    let decided: FoundryApproval;
    try {
      const client = createFoundryClient({ baseUrl: listening.url });
      const stored = await client.approval(approval.id);
      assert.equal(stored.status, "pending");
      assert.equal(stored.url, `https://app.example/approvals/${approval.id}`);
      assert.equal((await fetch(`${listening.url}/api/approvals/approval_00000000-0000-4000-8000-000000000000`)).status, 404);
      const page = await fetch(`${listening.url}/approvals/${approval.id}`);
      assert.equal(page.status, 200, "the inspector opens on the approval");
      assert.match(await page.text(), /renderApproval/);
      decided = await client.resolveApproval(approval.id, "approve");
    } finally {
      await server.close();
    }
    assert.equal(decided.status, "approved");
    assert.ok(decided.resumedAt && decided.resumeRunId, "the decision started a run");
    const resumed = await finished(second, decided.resumeRunId!);
    assert.equal(output(resumed)?.value, "sent: success");
    assert.equal((await sent()).length, 1, "the note went once");

    const after = await transcript(conversation.id);
    const result = after.flatMap((message) => message.tool_results ?? []).find((item) => item.call_id === approval.toolCallId);
    assert.equal(result?.result.status, "success", "the waiting call got its real result");
    assert.equal(after.at(-1)?.text, "sent: success");
    await assert.rejects(second.resolveApproval(approval.id, "deny"), /already approved/);

    // Delivery is at least once. The same decision arriving again finds its call
    // already answered and starts no turn: the note is not sent twice.
    const replay = await second.emitEvent(
      { agentId: approval.agentId, conversationId: approval.conversationId },
      {
        id: `approval:${approval.id}:replay`,
        source: "foundry:approval",
        kind: "approval.decided",
        content: "The person approved your earlier request to run send_note. To do it now, call send_note again with the same input.",
        metadata: { approval: { id: approval.id, toolName: approval.toolName, toolInput: approval.toolInput, toolCallId: approval.toolCallId, status: "approved" } },
      },
      { whenIdle: "wake" },
    );
    if (replay.runId) await finished(second, replay.runId);
    assert.equal((await sent()).length, 1, "a replayed decision does not run the call again");
    assert.equal((await transcript(conversation.id)).at(-1)?.text, "sent: success");
  });
});

test("denied after it suspended, the call is refused and the turn carries on", async () => {
  await withSetup(async ({ start: boot, sent }) => {
    const runtime = await boot();
    const { run } = await start(runtime, "sam", "send the note");
    await finished(runtime, run.id);
    const approval = (await runtime.listApprovals({ status: "pending" }))[0]!;
    const decided = await runtime.resolveApproval(approval.id, "deny");
    const resumed = await finished(runtime, decided.resumeRunId!);
    assert.equal(output(resumed)?.value, "sent: error");
    assert.deepEqual(await sent(), []);
  });
});

test("when the conversation moved on, the decision arrives as an event and the approved call can run again", async () => {
  await withSetup(async ({ start: boot, sent }) => {
    const runtime = await boot();
    const { agent, conversation, run } = await start(runtime, "maya", "send the note");
    await finished(runtime, run.id);
    const approval = (await runtime.listApprovals({ status: "pending" }))[0]!;
    const chat = await finished(runtime, (await runtime.send(agent.id, conversation.id, "what is on Friday?")).id);
    assert.equal(output(chat)?.value, "ok: what is on Friday?");

    const decided = await runtime.resolveApproval(approval.id, "approve");
    const resumed = await finished(runtime, decided.resumeRunId!);
    assert.equal(output(resumed)?.value, "sent: success", "the agent called it again and it ran without asking");
    assert.equal((await sent()).length, 1);
    assert.equal((await runtime.listApprovals({ status: "pending" })).length, 0, "it did not ask a second time");
  });
});

test("cancelling the run that asked voids its approval", async () => {
  await withSetup(async ({ start: boot, sent }) => {
    const runtime = await boot({ waitMs: 20_000 });
    const { run } = await start(runtime, "ann", "send the note");
    const approval = await pending(runtime);
    await runtime.cancel(run.id);
    await eventually(async () => (await runtime.getApproval(approval.id))?.status === "cancelled", "the approval to be cancelled");
    await assert.rejects(runtime.resolveApproval(approval.id, "approve"), /already cancelled/);
    assert.deepEqual(await sent(), []);
  });
});

test("an approval left open past its lifetime expires", async () => {
  await withSetup(async ({ start: boot, directory }) => {
    const runtime = await boot({ waitMs: 200, expiresAfterMs: 1_500 });
    const { run } = await start(runtime, "lee", "send the note");
    await finished(runtime, run.id);
    const approval = (await runtime.listApprovals())[0]!;
    await eventually(async () => (await runtime.getApproval(approval.id))?.status === "expired", "the approval to expire", 10_000);
    await assert.rejects(runtime.resolveApproval(approval.id, "approve"), /already expired/);
    assert.ok((await readdir(directory)).includes("foundry.json"));
  });
});
