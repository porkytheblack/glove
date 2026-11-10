/**
 * The hosted mesh under an application's rules: peers across workspaces, a
 * gate on every message, threads bound to the application's record, commit
 * before delivery, people in threads, and take-over.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import { defineApplication, type FoundryApplicationOptions } from "../src/application.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { eventRecordId } from "../src/event-delivery.js";
import { FoundryRuntime, type FoundryRun } from "../src/runtime.js";
import type { FoundryApplicationMesh, FoundryMeshRecordedMessage, FoundryMeshThread } from "../src/mesh.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");

interface LogEntry { readonly event: string; readonly [key: string]: unknown }

async function entries(file: string): Promise<LogEntry[]> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

async function eventually<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

const sourceKind = (run: FoundryRun) => (run.input as { source?: { kind?: string } } | undefined)?.source?.kind;
const outputOf = (run: FoundryRun | null | undefined) => String((run?.output as { value?: unknown } | undefined)?.value);

interface Harness {
  readonly runtime: FoundryRuntime;
  readonly data: FileFoundryDataAdapter;
  readonly logFile: string;
  readonly directory: string;
}

async function start(directory: string, mesh: FoundryApplicationMesh, extra: Partial<FoundryApplicationOptions> = {}): Promise<Harness> {
  const logFile = join(directory, "mesh.log");
  process.env.FOUNDRY_TEST_MESH_LOG = logFile;
  const data = new FileFoundryDataAdapter({ file: join(directory, "foundry.json") });
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "mesh-agents"),
    application: defineApplication({ name: "Mesh under host rules", data, mesh, ...extra }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } },
  });
  await runtime.start();
  return { runtime, data, logFile, directory };
}

async function withHarness(mesh: FoundryApplicationMesh, work: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-app-mesh-"));
  const harness = await start(directory, mesh);
  try {
    await work(harness);
  } finally {
    await harness.runtime.stop();
    delete process.env.FOUNDRY_TEST_MESH_LOG;
    await rm(directory, { recursive: true, force: true });
  }
}

/** Send the assistant a message and wait for its run. */
async function ask(runtime: FoundryRuntime, agentId: string, conversationId: string, message: string): Promise<FoundryRun | null> {
  const run = await runtime.send(agentId, conversationId, message);
  return runtime.waitForRun(run.id, { timeoutMs: 30_000 });
}

async function onlyThread(runtime: FoundryRuntime, conversationId: string): Promise<FoundryMeshThread> {
  return eventually(async () => (await runtime.listThreads({ conversationId }))[0], "the thread");
}

test("peers cross workspaces, threads bind to the application's record, and every message is committed before it is delivered", async () => {
  const committed: Array<{ readonly id: string; readonly side: string; readonly record: string; readonly deliveredYet: boolean }> = [];
  let data: FileFoundryDataAdapter | undefined;
  const mesh: FoundryApplicationMesh = {
    // Ada (workspace "ada") may reach Bo's coder (workspace "bo"), under the name the application gives it.
    peers: (sender) => sender.id === "ada" ? [{ agentId: "bo-coder", name: "Bo's coder" }, { agentId: "ada", name: "self" }] : [],
    bindThread: ({ sender, recipient }) => ({ threadId: `room-${sender.id}-${recipient.id}`, record: `room:${sender.id}:${recipient.id}` }),
    commit: async ({ thread, message, side }: FoundryMeshRecordedMessage) => {
      const target = side === "recipient" ? { agentId: thread.to.agentId, conversationId: thread.id } : { agentId: thread.from.agentId, conversationId: thread.from.conversationId };
      const journal = await Effect.runPromise(data!.listEvents());
      committed.push({ id: message.id, side, record: thread.record ?? thread.id, deliveredYet: journal.some((item) => item.id === eventRecordId(target, message.id)) });
      return { recordId: `rec-${committed.length}` };
    },
  };
  await withHarness(mesh, async (harness) => {
    data = harness.data;
    const { runtime } = harness;
    const ada = await runtime.createAgent("assistant", { id: "ada", name: "Ada's assistant", workspaceId: "ada" });
    await runtime.createAgent("coder", { id: "bo-coder", name: "Coder", workspaceId: "bo" });
    await runtime.createAgent("coder", { id: "ada-coder", name: "Ada's own coder", workspaceId: "ada" });
    const conversation = await runtime.createConversation(ada.id, { id: "ada-chat" });

    // The directory is the application's, not the workspace's: Ada's own coder is not listed.
    const who = await ask(runtime, ada.id, conversation.id, "who");
    const listed = JSON.parse(outputOf(who)) as { data: { agents: Array<{ id: string; name: string }> } };
    assert.deepEqual(listed.data.agents.map((agent) => [agent.id, agent.name]), [["bo-coder", "Bo's coder"]]);

    assert.equal(outputOf(await ask(runtime, ada.id, conversation.id, "build:bo-coder")), "handed off");
    const relay = await eventually(async () => (await runtime.listRuns("assistant")).find((run) =>
      run.conversationId === conversation.id && sourceKind(run) === "mesh" && run.status === "completed"), "the reply");
    assert.equal(outputOf(relay), "relay: hello world done");

    const thread = await onlyThread(runtime, conversation.id);
    assert.equal(thread.id, "room-ada-bo-coder", "named by bindThread");
    assert.equal(thread.record, "room:ada:bo-coder");
    assert.equal(thread.status, "replied");
    assert.equal(thread.to.name, "Bo's coder");
    assert.equal(thread.to.workspaceId, "bo");
    const recipientSide = await Effect.runPromise(harness.data.getConversation(thread.id));
    assert.equal(recipientSide?.workspaceId, "bo", "the recipient's side is in the recipient's workspace");
    assert.equal(thread.outbox, undefined);

    // Both messages reached the record first, in order, before the journal had them.
    assert.deepEqual(committed.map((item) => item.side), ["recipient", "starter"]);
    assert.ok(committed.every((item) => item.record === "room:ada:bo-coder"));
    assert.ok(committed.every((item) => !item.deliveredYet), "committed before it was delivered");
    assert.equal(committed[0]!.id, thread.messageIds[0]);

    // An agent the application does not list cannot be reached, and the wording does not say why.
    const refused = await ask(runtime, ada.id, conversation.id, "build:ada-coder");
    assert.equal(outputOf(refused), "error: Your message could not be sent.");
    const trace = await runtime.observability.list({ runId: refused!.id });
    assert.equal(trace.find((event) => event.type === "mesh.refused")?.data && (trace.find((event) => event.type === "mesh.refused")!.data as { reason?: string }).reason, "not a peer");
  });
});

test("the gate holds, drafts and refuses; the sender cannot tell the first two from delivery", async () => {
  const committed: string[] = [];
  const mesh: FoundryApplicationMesh = {
    authorize: (send) => {
      if (send.kind !== "message") return { decision: "deliver" };
      switch (send.recipient.id) {
        case "held-coder": return { decision: "hold" };
        case "draft-coder": return { decision: "draft" };
        case "blocked-coder": return { decision: "refuse", message: "Not now." };
        default: return { decision: "deliver" };
      }
    },
    commit: ({ message }) => { committed.push(message.id); },
  };
  await withHarness(mesh, async ({ runtime }) => {
    const ada = await runtime.createAgent("assistant", { id: "ada" });
    for (const id of ["held-coder", "draft-coder", "blocked-coder", "open-coder"]) await runtime.createAgent("coder", { id });
    const chats = new Map<string, string>();
    for (const id of ["held-coder", "draft-coder", "blocked-coder", "open-coder"]) {
      chats.set(id, (await runtime.createConversation(ada.id, { id: `chat-${id}` })).id);
    }

    assert.equal(outputOf(await ask(runtime, ada.id, chats.get("open-coder")!, "build:open-coder")), "handed off");
    assert.equal(outputOf(await ask(runtime, ada.id, chats.get("held-coder")!, "build:held-coder")), "handed off");
    assert.equal(outputOf(await ask(runtime, ada.id, chats.get("draft-coder")!, "build:draft-coder")), "handed off");
    assert.equal(outputOf(await ask(runtime, ada.id, chats.get("blocked-coder")!, "build:blocked-coder")), "error: Not now.", "the application's wording");

    const replied = async (conversationId: string) => eventually(async () => {
      const [thread] = await runtime.listThreads({ conversationId, status: "replied" });
      return thread;
    }, `a reply in ${conversationId}`);
    await replied(chats.get("open-coder")!);

    // Held: stored on the thread, not delivered, not committed.
    const held = await onlyThread(runtime, chats.get("held-coder")!);
    assert.equal(held.status, "working", "it looks to the sender like any thread at work");
    assert.equal(held.held?.[0]?.decision, "hold");
    assert.equal((await runtime.listRuns("coder")).some((run) => run.conversationId === held.id), false);
    assert.ok(!committed.includes(held.messageIds[0]!));
    const heldTrace = await runtime.observability.list({ category: "system" });
    assert.ok(heldTrace.some((event) => event.type === "mesh.held" && (event.data as { threadId: string }).threadId === held.id));

    // Released: committed, then delivered, and the reply comes back.
    await runtime.releaseMeshMessage(held.id, held.messageIds[0]!, "deliver");
    assert.equal((await replied(chats.get("held-coder")!)).held, undefined);
    assert.ok(committed.includes(held.messageIds[0]!));

    // Drafted: an approval nobody resumes a run for. Denied, it is dropped.
    const drafted = await onlyThread(runtime, chats.get("draft-coder")!);
    const approvalId = drafted.held?.[0]?.approvalId;
    assert.ok(approvalId);
    const approval = await runtime.getApproval(approvalId!);
    assert.deepEqual(approval?.mesh, { threadId: drafted.id, messageId: drafted.messageIds[0] });
    assert.equal(approval?.status, "pending");
    await assert.rejects(runtime.releaseMeshMessage(drafted.id, drafted.messageIds[0]!, "deliver"), /decide approval/);
    const assistantRuns = (await runtime.listRuns("assistant")).length;
    await runtime.resolveApproval(approvalId!, "deny");
    const discarded = await onlyThread(runtime, chats.get("draft-coder")!);
    assert.equal(discarded.held, undefined);
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.equal((await runtime.listRuns("coder")).some((run) => run.conversationId === drafted.id), false, "never delivered");
    assert.equal((await runtime.listRuns("assistant")).length, assistantRuns, "the sender is not told");
    assert.ok(!committed.includes(drafted.messageIds[0]!));

    // A second draft, approved, is delivered.
    const second = await runtime.createConversation(ada.id, { id: "chat-draft-again" });
    await ask(runtime, ada.id, second.id, "build:draft-coder");
    const again = await onlyThread(runtime, second.id);
    await runtime.resolveApproval(again.held![0]!.approvalId!, "approve");
    await replied(second.id);
    assert.ok(committed.includes(again.messageIds[0]!));
  });
});

test("a person's message reaches the agents still in a thread; a take-over takes an agent out of it", async () => {
  const committed: Array<{ readonly id: string; readonly side: string }> = [];
  const mesh: FoundryApplicationMesh = { commit: ({ message, side }) => { committed.push({ id: message.id, side }); } };
  await withHarness(mesh, async ({ runtime, logFile }) => {
    const ada = await runtime.createAgent("assistant", { id: "ada", name: "Ada's assistant" });
    await runtime.createAgent("coder", { id: "ada-coder", name: "Coder" });
    const conversation = await runtime.createConversation(ada.id, { id: "ada-chat" });
    await ask(runtime, ada.id, conversation.id, "build:ada-coder");
    const thread = await eventually(async () => {
      const [item] = await runtime.listThreads({ conversationId: conversation.id, status: "replied" });
      return item;
    }, "the first reply");
    const relays = async () => (await runtime.listRuns("assistant")).filter((run) => run.conversationId === conversation.id && sourceKind(run) === "mesh");
    await eventually(async () => (await relays()).find((run) => run.status === "completed"), "the relay");
    const relaysBefore = (await relays()).length;

    // Ada's owner takes Ada's side over: the coder still answers, into the record only.
    const taken = await runtime.meshTakeOver(thread.id, { by: "ada-owner", agentId: "ada" });
    assert.equal(taken.status, "taken-over");
    assert.deepEqual(taken.takenOver?.agentIds, ["ada"]);
    const message = await runtime.meshHumanMessage(thread.id, { authorId: "ada-owner", name: "Ada", text: "write hello again", id: "rec-human-1" });
    assert.equal(message.from.kind, "human");

    const coderTask = await eventually(async () => (await entries(logFile)).filter((entry) => entry.event === "coder-task")
      .find((entry) => String(entry.task).includes("write hello again")), "the coder hearing the person");
    assert.match(String(coderTask.task), /from="ada-owner" name="Ada" party="human"/);
    assert.match(String(coderTask.task), /Ada is a person in this thread, not an agent\./);

    const reply = await eventually(async () => committed.filter((item) => item.side === "starter").at(1), "the second reply in the record");
    assert.ok(reply.id.startsWith("msg_reply_"));
    assert.ok(!committed.some((item) => item.id === "rec-human-1"), "a person's message came from the record and is not committed again");
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.equal((await relays()).length, relaysBefore, "Ada left the thread, so nothing reached her");
    const current = (await runtime.listThreads({ conversationId: conversation.id }))[0]!;
    assert.equal(current.status, "taken-over", "an agent's reply does not reopen a thread a person took over");
    assert.ok(current.messageIds.includes("rec-human-1"));

    // Both sides out: a person's message reaches no agent.
    await runtime.meshTakeOver(thread.id, { by: "bo" });
    const codersBefore = (await runtime.listRuns("coder")).length;
    await runtime.meshHumanMessage(thread.id, { authorId: "bo", text: "thanks" });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert.equal((await runtime.listRuns("coder")).length, codersBefore);
    const trace = await runtime.observability.list({ category: "system" });
    assert.equal(trace.filter((event) => event.type === "mesh.taken_over").length, 2);
  });
});

test("a message whose commit failed is committed again and delivered after a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-app-mesh-restart-"));
  // The application's record: idempotent on message id.
  const record = new Map<string, string>();
  let calls = 0;
  try {
    const first = await start(directory, {
      commit: ({ message }) => {
        calls += 1;
        record.set(message.id, message.content);
        // Written to the record, then the connection drops before Foundry hears back.
        throw new Error("connection lost");
      },
    });
    const ada = await first.runtime.createAgent("assistant", { id: "ada" });
    await first.runtime.createAgent("coder", { id: "ada-coder" });
    const conversation = await first.runtime.createConversation(ada.id, { id: "ada-chat" });
    assert.equal(outputOf(await ask(first.runtime, ada.id, conversation.id, "build:ada-coder")), "handed off", "accepted, as far as the sender knows");
    const waiting = await onlyThread(first.runtime, conversation.id);
    assert.equal(waiting.outbox?.length, 1, "kept in the outbox until it is committed and delivered");
    assert.equal((await first.runtime.listRuns("coder")).some((run) => run.conversationId === waiting.id), false);
    await first.runtime.stop();

    const second = await start(directory, {
      commit: ({ message }) => {
        calls += 1;
        record.set(message.id, message.content);
        return { recordId: message.id };
      },
    });
    try {
      // The reply is committed, then delivered, after the thread reads "replied".
      const thread = await eventually(async () => {
        const [item] = await second.runtime.listThreads({ conversationId: conversation.id, status: "replied" });
        return item && record.size === 2 && !item.outbox ? item : undefined;
      }, "the reply after the restart");
      assert.equal(record.size, 2, "one message and its reply, each once in the record");
      assert.ok(calls >= 3, "the first message was committed again");
      const coderRuns = (await second.runtime.listRuns("coder")).filter((run) => run.conversationId === thread.id);
      assert.equal(coderRuns.length, 1, "delivered once");
    } finally {
      await second.runtime.stop();
    }
  } finally {
    delete process.env.FOUNDRY_TEST_MESH_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});

test("without an application mesh, a thread stays in the workspace and ungated", async () => {
  // Covered in depth by mesh.test.ts; this pins the refusal wording that the application mesh replaces.
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-app-mesh-none-"));
  process.env.FOUNDRY_TEST_MESH_LOG = join(directory, "mesh.log");
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "mesh-agents"),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } },
  });
  await runtime.start();
  try {
    const ada = await runtime.createAgent("assistant", { id: "ada", workspaceId: "ada" });
    await runtime.createAgent("coder", { id: "bo-coder", workspaceId: "bo" });
    const conversation = await runtime.createConversation(ada.id, { id: "ada-chat" });
    assert.match(outputOf(await ask(runtime, ada.id, conversation.id, "build:bo-coder")), /There is no agent "bo-coder" you can message/);
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_MESH_LOG;
    await rm(directory, { recursive: true, force: true });
  }
});
