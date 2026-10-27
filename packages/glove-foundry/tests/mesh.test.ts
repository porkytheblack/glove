import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import { defineApplication } from "../src/application.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { createAgentInstance } from "../src/primitives.js";
import { FoundryRuntime, type FoundryRun } from "../src/runtime.js";
import {
  drainMailbox,
  listenToConversation,
  meshIdentity,
  renderMeshMessage,
  renderOpenThreads,
  writeMailboxDelivery,
  type FoundryMeshMessage,
  type FoundryMeshThread,
} from "../src/mesh.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");

interface LogEntry { readonly t: number; readonly pid: number; readonly event: string; readonly [key: string]: unknown }

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

function sourceKind(run: FoundryRun): string | undefined {
  return (run.input as { source?: { kind?: string } } | undefined)?.source?.kind;
}

async function withRuntime(
  work: (runtime: FoundryRuntime, logFile: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-mesh-"));
  const logFile = join(directory, "mesh.log");
  process.env.FOUNDRY_TEST_MESH_LOG = logFile;
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "mesh-agents"),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } },
  });
  await runtime.start();
  try {
    await work(runtime, logFile);
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_MESH_LOG;
    await rm(directory, { recursive: true, force: true });
  }
}

test("a message to another agent starts a thread on it, and its reply comes back as a new run", async () => {
  await withRuntime(async (runtime, logFile) => {
    // Both agents are data: any instance of any definition, named by the application.
    const ada = await runtime.createAgent("assistant", { id: "ada", name: "Ada's assistant" });
    await runtime.createAgent("coder", { id: "ada-coder", name: "Coder", description: "Writes code." });
    const conversation = await runtime.createConversation(ada.id, { id: "ada-chat" });
    const first = await runtime.send(ada.id, conversation.id, "build:ada-coder");
    assert.equal((await runtime.waitForRun(first.id, { timeoutMs: 30_000 }))?.status, "completed");

    const relay = await eventually(async () => {
      const runs = await runtime.listRuns("assistant");
      return runs.find((run) =>
        run.conversationId === conversation.id && sourceKind(run) === "mesh" && run.status === "completed");
    }, "the reply run");
    assert.match(String((relay.output as { value?: unknown }).value), /^relay: hello world done$/);

    const [thread] = await runtime.listThreads({ conversationId: conversation.id });
    assert.equal(thread?.status, "replied");
    assert.equal(thread?.to.agentId, "ada-coder");
    assert.equal(thread?.to.name, "Coder");
    assert.equal(thread?.from.name, "Ada's assistant");
    assert.equal(thread?.reply, "hello world done");
    assert.equal(thread?.undelivered, undefined);

    // No worker instance was invented: the coder is the one the application made.
    assert.deepEqual((await runtime.listAgentInstances("coder")).map((agent) => agent.id), ["ada-coder"]);

    const coderTask = (await entries(logFile)).find((entry) => entry.event === "coder-task");
    assert.match(
      String(coderTask?.task),
      /<mesh-message id="msg_[^"]+" thread="thread_[^"]+" from="ada" name="Ada's assistant">\nwrite hello\n<\/mesh-message>/,
    );
  });
});

test("a recipient's question reaches the sender, and the answer starts the recipient again", async () => {
  await withRuntime(async (runtime, logFile) => {
    const bo = await runtime.createAgent("assistant", { id: "bo" });
    await runtime.createAgent("painter", { id: "bo-painter", name: "Painter" });
    const conversation = await runtime.createConversation(bo.id, { id: "bo-chat" });
    await runtime.send(bo.id, conversation.id, "paint:bo-painter");

    const thread = await eventually(async () => {
      const [item] = await runtime.listThreads({ conversationId: conversation.id, status: "replied" });
      return item;
    }, "the painter to finish", 45_000);
    assert.equal(thread.reply, "painted blue");

    const painterRuns = (await runtime.listRuns("painter")).filter((run) => run.conversationId === thread.id);
    assert.equal(painterRuns.length, 2, "one run asked, the answer started a second");
    const asked = painterRuns.find((run) => (run.output as { status?: string } | undefined)?.status === "suspended");
    const suspension = (asked?.output as { suspension?: { kind: string; threadId: string } } | undefined)?.suspension;
    assert.equal(suspension?.kind, "mesh");
    assert.equal(suspension?.threadId, thread.id);

    const log = await entries(logFile);
    assert.ok(log.some((entry) => entry.event === "assistant-answering" && entry.threadId === thread.id));
    assert.ok(log.some((entry) => entry.event === "painter-resumed" && entry.colour === "blue"));
    await eventually(async () =>
      (await entries(logFile)).find((entry) => entry.event === "assistant-relayed" && entry.result === "painted blue"),
      "the assistant to relay the painting");
  });
});

test("a blocking send gets the answer as its tool result, in the same run", async () => {
  await withRuntime(async (runtime, logFile) => {
    const cy = await runtime.createAgent("assistant", { id: "cy" });
    await runtime.createAgent("quick-painter", { id: "cy-quick" });
    const conversation = await runtime.createConversation(cy.id, { id: "cy-chat" });
    await runtime.send(cy.id, conversation.id, "paint:cy-quick");

    const thread = await eventually(async () => {
      const [item] = await runtime.listThreads({ conversationId: conversation.id, status: "replied" });
      return item;
    }, "the quick painter to finish", 45_000);
    assert.equal(thread.reply, "painted blue");
    const runs = (await runtime.listRuns("quick-painter")).filter((run) => run.conversationId === thread.id);
    assert.equal(runs.length, 1, "the answer arrived inside the waiting run");
    assert.equal((runs[0]!.output as { status?: string }).status, "completed");
    assert.ok((await entries(logFile)).some((entry) => entry.event === "quick-painter-answered" && entry.answer === "blue"));
  });
});

test("a run that listens receives the reply itself, and no extra run starts", async () => {
  await withRuntime(async (runtime) => {
    const di = await runtime.createAgent("assistant", { id: "di" });
    await runtime.createAgent("coder", { id: "di-coder" });
    const conversation = await runtime.createConversation(di.id, { id: "di-call" });
    const call = await runtime.send(di.id, conversation.id, "listen:di-coder");
    const done = await runtime.waitForRun(call.id, { timeoutMs: 30_000 });
    assert.equal(done?.status, "completed");
    assert.equal((done?.output as { value?: unknown }).value, "live: hello world done");

    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const runs = (await runtime.listRuns("assistant")).filter((run) => run.conversationId === conversation.id);
    assert.equal(runs.length, 1, "the reply went to the live run, not a new one");
  });
});

test("peers come from data: names, workspaces and the definition's peers rule", async () => {
  await withRuntime(async (runtime, logFile) => {
    await runtime.createAgent("gatekeeper", { id: "gate", context: { team: "red" } });
    await runtime.createAgent("coder", { id: "red-coder", name: "Red coder", context: { team: "red" } });
    await runtime.createAgent("coder", { id: "blue-coder", name: "Blue coder", context: { team: "blue" } });
    // Another tenant's agent is never visible, whatever its data says.
    await runtime.createAgent("coder", { id: "other-coder", workspaceId: "other", context: { team: "red" } });
    const conversation = await runtime.createConversation("gate", { id: "gate-chat" });

    const listed = await runtime.send("gate", conversation.id, "who is there");
    await runtime.waitForRun(listed.id, { timeoutMs: 30_000 });
    const listing = await eventually(async () =>
      (await entries(logFile)).find((entry) => entry.event === "gatekeeper-result"), "the listing");
    const agents = (JSON.parse(String(listing.result)) as { data: { agents: Array<{ id: string; name: string }> } }).data.agents;
    assert.deepEqual(agents.map((agent) => [agent.id, agent.name]), [["red-coder", "Red coder"]]);

    // A rename is a write to data; the next listing has it.
    await runtime.configureAgent("red-coder", { name: "Crimson coder" });
    assert.equal(meshIdentity((await runtime.listAgentInstances("coder")).find((agent) => agent.id === "red-coder")!).name, "Crimson coder");

    const refused = await runtime.send("gate", conversation.id, "ask:blue-coder");
    await runtime.waitForRun(refused.id, { timeoutMs: 30_000 });
    const answer = await eventually(async () =>
      (await entries(logFile)).filter((entry) => entry.event === "gatekeeper-result")[1], "the refusal");
    assert.match(String(answer.result), /There is no agent \\"blue-coder\\" you can message/);
    assert.deepEqual(await runtime.listThreads({ to: "blue-coder" }), []);
  });
});

test("mount decides per run whether the mesh tools are there at all", async () => {
  await withRuntime(async (runtime, logFile) => {
    await runtime.createAgent("gatekeeper", { id: "gate", context: { team: "red" } });
    await runtime.createAgent("coder", { id: "red-coder", context: { team: "red" } });
    const conversation = await runtime.createConversation("gate", { id: "gate-chat" });

    const quiet = await runtime.send("gate", conversation.id, "quiet: who is there");
    await runtime.waitForRun(quiet.id, { timeoutMs: 30_000 });
    const missing = await eventually(async () =>
      (await entries(logFile)).find((entry) => entry.event === "gatekeeper-result"), "the quiet run's tool result");
    assert.match(String(missing.result), /No tool called glove_mesh_list_agents exists/);

    const open = await runtime.send("gate", conversation.id, "who is there");
    await runtime.waitForRun(open.id, { timeoutMs: 30_000 });
    const listing = await eventually(async () =>
      (await entries(logFile)).filter((entry) => entry.event === "gatekeeper-result")[1], "the open run's listing");
    assert.match(String(listing.result), /"red-coder"/);
  });
});

test("broadcast starts one thread per peer, and each reply arrives on its own", async () => {
  await withRuntime(async (runtime) => {
    const ed = await runtime.createAgent("assistant", { id: "ed", workspaceId: "ed" });
    await runtime.createAgent("coder", { id: "ed-one", workspaceId: "ed" });
    await runtime.createAgent("coder", { id: "ed-two", workspaceId: "ed" });
    const conversation = await runtime.createConversation(ed.id, { id: "ed-chat", workspaceId: "ed" });
    await runtime.send(ed.id, conversation.id, "everyone write hello");
    const threads = await eventually(async () => {
      const replied = await runtime.listThreads({ conversationId: conversation.id, status: "replied" });
      return replied.length === 2 ? replied : undefined;
    }, "both replies", 45_000);
    assert.deepEqual(threads.map((thread) => thread.to.agentId).sort(), ["ed-one", "ed-two"]);
  });
});

test("a message to an agent that does not exist is refused to the sender's tool at once", async () => {
  await withRuntime(async (runtime) => {
    const fi = await runtime.createAgent("assistant", { id: "fi" });
    const conversation = await runtime.createConversation(fi.id, { id: "fi-chat" });
    const run = await runtime.send(fi.id, conversation.id, "build:nobody");
    const done = await runtime.waitForRun(run.id, { timeoutMs: 30_000 });
    assert.match(String((done?.output as { value?: unknown }).value), /^error: There is no agent "nobody" you can message/);
    assert.deepEqual(await runtime.listThreads({ conversationId: conversation.id }), []);
  });
});

test("a reply still owed when the runtime stopped is handed over when it starts again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-redeliver-"));
  const file = join(directory, "foundry.json");
  const now = new Date().toISOString();
  const threadId = "thread_00000000-0000-4000-8000-0000000000aa";
  const reply: FoundryMeshMessage = {
    kind: "reply",
    id: "msg_00000000-0000-4000-8000-0000000000bb",
    threadId,
    from: { agentId: "gu-coder", name: "Coder" },
    to: "gu",
    content: "hello world done",
    createdAt: now,
  };
  // The state a stop leaves behind: the coder finished, the assistant never heard.
  const seed = new FileFoundryDataAdapter({ file });
  await Effect.runPromise(seed.putAgent(createAgentInstance("assistant", { id: "gu" })));
  await Effect.runPromise(seed.putAgent(createAgentInstance("coder", { id: "gu-coder", name: "Coder" })));
  await Effect.runPromise(seed.putConversation({
    id: "gu-chat", agentId: "gu", workspaceId: "default", context: { meshThreads: [threadId] }, createdAt: now, updatedAt: now,
  }));
  const thread: FoundryMeshThread = {
    id: threadId,
    workspaceId: "default",
    from: { agentId: "gu", name: "gu", definitionId: "assistant", conversationId: "gu-chat", runId: "run_before" },
    to: { agentId: "gu-coder", name: "Coder", definitionId: "coder" },
    subject: "write hello",
    status: "replied",
    reply: "hello world done",
    messageIds: ["msg_00000000-0000-4000-8000-0000000000a1", reply.id],
    undelivered: [reply],
    createdAt: now,
    updatedAt: now,
  };
  await Effect.runPromise(seed.putConversation({
    id: threadId, agentId: "gu-coder", workspaceId: "default", createdAt: now, updatedAt: now,
    context: { meshThread: thread },
  }));
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "mesh-agents"),
    application: defineApplication({ name: "redeliver", data: new FileFoundryDataAdapter({ file }) }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  await runtime.start();
  try {
    const relay = await eventually(async () => {
      const runs = await runtime.listRuns("assistant");
      return runs.find((run) => run.conversationId === "gu-chat" && run.status === "completed");
    }, "the owed reply to arrive");
    assert.equal((relay.output as { value?: unknown }).value, "relay: hello world done");
    await eventually(async () => {
      const [item] = await runtime.listThreads({ conversationId: "gu-chat" });
      return item && item.undelivered === undefined ? item : undefined;
    }, "the record to show it was handed over");
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an agent's identity on the mesh is its instance data", () => {
  const named = createAgentInstance("bot", { id: "maya-sales", name: "Sales Outbound", description: "Overnight pipeline and outbound." });
  assert.deepEqual(meshIdentity(named), {
    id: "maya-sales",
    name: "Sales Outbound",
    description: "Overnight pipeline and outbound.",
    metadata: { definitionId: "bot" },
  });
  assert.equal(meshIdentity(createAgentInstance("bot", { id: "blank" })).name, "blank");
});

test("messages read as tagged text, and open threads as runtime context", () => {
  const message: FoundryMeshMessage = {
    kind: "message",
    id: "msg_x",
    threadId: "thread_x",
    from: { agentId: "maya-bugs", name: "Bug Triage" },
    to: "maya-chief",
    content: "Which branch?",
    createdAt: "",
  };
  assert.equal(
    renderMeshMessage({ ...message, kind: "reply", content: "Fixed." }, "starter"),
    '<mesh-message id="msg_x" thread="thread_x" from="maya-bugs" name="Bug Triage" status="replied">\nFixed.\n</mesh-message>',
  );
  assert.match(renderMeshMessage(message, "starter"), /needs an answer to go on[\s\S]*in_reply_to "msg_x"/);
  assert.match(renderMeshMessage(message, "recipient"), /Your final reply goes back to them on its own/);
  assert.match(renderMeshMessage({ ...message, kind: "failed", content: "boom" }, "starter"), /It stopped: boom/);
  const open: FoundryMeshThread = {
    id: "thread_x",
    workspaceId: "default",
    from: { agentId: "maya-chief", name: "Chief", definitionId: "bot", conversationId: "c", runId: "r" },
    to: { agentId: "maya-bugs", name: "Bug Triage", definitionId: "bot" },
    subject: "Fix the build",
    status: "waiting",
    question: "Which branch?",
    messageIds: ["msg_x"],
    createdAt: "",
    updatedAt: "",
  };
  assert.equal(renderOpenThreads([]), null);
  assert.match(String(renderOpenThreads([open])), /Bug Triage \(maya-bugs\), thread thread_x: waiting for your answer to "Which branch\?"/);
});

test("the mailbox hands each message over once, oldest first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-mailbox-"));
  try {
    const base = { threadId: "thread_x", from: { agentId: "a", name: "A" }, to: "b", createdAt: "" };
    const first: FoundryMeshMessage = { kind: "message", id: "msg_1", content: "one", ...base };
    const second: FoundryMeshMessage = { kind: "message", id: "msg_2", content: "two", ...base };
    await writeMailboxDelivery(directory, "conversation/1", first);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    await writeMailboxDelivery(directory, "conversation/1", second);
    assert.deepEqual(await drainMailbox(directory, "conversation/1"), [first, second]);
    assert.deepEqual(await drainMailbox(directory, "conversation/1"), []);

    const states: string[] = [];
    const received: string[] = [];
    const listener = listenToConversation({
      directory,
      conversationId: "conversation/2",
      pollMs: 10,
      report: (state) => { states.push(state); },
      handler: (messages) => {
        for (const message of messages) received.push(message.content);
      },
    });
    await writeMailboxDelivery(directory, "conversation/2", first);
    await eventually(async () => (received.length === 1 ? true : undefined), "the listener to read", 2_000);
    await listener.stop();
    assert.deepEqual(states, ["on", "off"]);
    assert.deepEqual(received, ["one"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
