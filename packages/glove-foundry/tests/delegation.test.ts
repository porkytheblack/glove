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
  RunEventQueue,
  deliveryEvent,
  formatRunEvents,
  listenToConversation,
  normalizeDelegates,
  openRunMailbox,
  renderDelivery,
  renderOpenDelegations,
  workerAgentId,
  writeMailboxDelivery,
  type FoundryConversationDelivery,
  type FoundryDelegation,
} from "../src/delegation.js";

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
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-delegation-"));
  const logFile = join(directory, "delegation.log");
  process.env.FOUNDRY_TEST_DELEGATION_LOG = logFile;
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "delegation-agents"),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25, maxConcurrent: 4 } },
  });
  await runtime.start();
  try {
    await work(runtime, logFile);
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_DELEGATION_LOG;
    await rm(directory, { recursive: true, force: true });
  }
}

test("a delegated result comes back to the delegating conversation as a new run", async () => {
  await withRuntime(async (runtime, logFile) => {
    const agent = await runtime.createAgent("assistant", { id: "ada", context: { user: "ada" } });
    const conversation = await runtime.createConversation(agent.id, { id: "ada-chat" });
    const first = await runtime.send(agent.id, conversation.id, "build me a greeting");
    assert.equal((await runtime.waitForRun(first.id, { timeoutMs: 30_000 }))?.status, "completed");

    const relay = await eventually(async () => {
      const runs = await runtime.listRuns("assistant");
      return runs.find((run) =>
        run.conversationId === conversation.id && sourceKind(run) === "delegation" && run.status === "completed");
    }, "the result run");
    assert.match(String((relay.output as { value?: unknown }).value), /^relay: hello world done$/);

    const [delegation] = await runtime.listDelegations({ conversationId: conversation.id });
    assert.equal(delegation?.status, "completed");
    assert.equal(delegation?.to, "coder");
    assert.equal(delegation?.result, "hello world done");
    assert.equal(delegation?.workerAgentId, workerAgentId("ada", "coder"));

    // The worker is its own instance, carrying the delegator's identity data.
    const worker = (await runtime.listAgentInstances("coder"))[0];
    assert.equal(worker?.id, "ada.coder");
    assert.equal(worker?.context.user, "ada");

    const coderTask = (await entries(logFile)).find((entry) => entry.event === "coder-task");
    assert.match(String(coderTask?.task), /<delegated-task id="delegation_[^"]+" from="assistant">\nwrite hello\n<\/delegated-task>/);
  });
});

test("a worker's question reaches the delegator, and the reply starts the worker again", async () => {
  await withRuntime(async (runtime, logFile) => {
    const agent = await runtime.createAgent("assistant", { id: "bo" });
    const conversation = await runtime.createConversation(agent.id, { id: "bo-chat" });
    await runtime.send(agent.id, conversation.id, "paint slowly");

    const delegation = await eventually(async () => {
      const [item] = await runtime.listDelegations({ conversationId: conversation.id, status: "completed" });
      return item;
    }, "the painter to finish", 45_000);
    assert.equal(delegation.result, "painted blue");

    const painterRuns = (await runtime.listRuns("painter")).filter((run) => run.conversationId === delegation.id);
    assert.equal(painterRuns.length, 2, "one run asked, the reply started a second");
    const asked = painterRuns.find((run) => (run.output as { status?: string } | undefined)?.status === "suspended");
    assert.deepEqual(
      (asked?.output as { suspension?: unknown } | undefined)?.suspension,
      {
        kind: "question",
        commandId: (asked?.output as { suspension: { commandId: string } }).suspension.commandId,
        delegationId: delegation.id,
        question: "Red or blue?",
      },
    );

    const log = await entries(logFile);
    assert.ok(log.some((entry) => entry.event === "assistant-answering" && entry.delegationId === delegation.id));
    assert.ok(log.some((entry) => entry.event === "painter-resumed" && entry.colour === "blue"));
    await eventually(async () =>
      (await entries(logFile)).find((entry) => entry.event === "assistant-relayed" && entry.result === "painted blue"),
      "the assistant to relay the painting");
  });
});

test("a worker waiting in its run gets the answer as its tool result", async () => {
  await withRuntime(async (runtime, logFile) => {
    const agent = await runtime.createAgent("assistant", { id: "cy" });
    const conversation = await runtime.createConversation(agent.id, { id: "cy-chat" });
    await runtime.send(agent.id, conversation.id, "paint quickly");

    const delegation = await eventually(async () => {
      const [item] = await runtime.listDelegations({ conversationId: conversation.id, status: "completed" });
      return item;
    }, "the quick painter to finish", 45_000);
    assert.equal(delegation.result, "painted blue");
    const runs = (await runtime.listRuns("quick-painter")).filter((run) => run.conversationId === delegation.id);
    assert.equal(runs.length, 1, "the answer arrived inside the waiting run");
    assert.equal((runs[0]!.output as { status?: string }).status, "completed");
    assert.ok((await entries(logFile)).some((entry) => entry.event === "quick-painter-answered" && entry.answer === "blue"));
  });
});

test("a run that listens receives the result itself, and no extra run starts", async () => {
  await withRuntime(async (runtime) => {
    const agent = await runtime.createAgent("assistant", { id: "di" });
    const conversation = await runtime.createConversation(agent.id, { id: "di-call" });
    const call = await runtime.send(agent.id, conversation.id, "listen for it");
    const done = await runtime.waitForRun(call.id, { timeoutMs: 30_000 });
    assert.equal(done?.status, "completed");
    assert.equal((done?.output as { value?: unknown }).value, "live: hello world done");

    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const runs = (await runtime.listRuns("assistant")).filter((run) => run.conversationId === conversation.id);
    assert.equal(runs.length, 1, "the result went to the live run, not a new one");
  });
});

test("a result that arrives while the delegating turn still runs joins it at the next tool step", async () => {
  await withRuntime(async (runtime, logFile) => {
    const agent = await runtime.createAgent("planner", { id: "ed" });
    const conversation = await runtime.createConversation(agent.id, { id: "ed-chat" });
    const run = await runtime.send(agent.id, conversation.id, "plan it");
    const done = await runtime.waitForRun(run.id, { timeoutMs: 30_000 });
    assert.equal(done?.status, "completed");
    assert.equal((done?.output as { value?: unknown }).value, "inline: hello world done");

    const heard = (await entries(logFile)).find((entry) => entry.event === "planner-heard");
    assert.equal(heard?.stillListed, false, "a delegation that answered is no longer listed as open");
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const runs = (await runtime.listRuns("planner")).filter((item) => item.conversationId === conversation.id);
    assert.equal(runs.length, 1, "no second run for a result the turn already read");
    const [delegation] = await runtime.listDelegations({ conversationId: conversation.id });
    assert.equal(delegation?.status, "completed");
  });
});

test("delegating to an agent that does not exist reports back instead of failing silently", async () => {
  await withRuntime(async (runtime) => {
    const agent = await runtime.createAgent("assistant", { id: "ed" });
    const conversation = await runtime.createConversation(agent.id, { id: "ed-chat" });
    const before = Date.now();
    // Emit the command the way a tool would, through a real run's event stream.
    const runtimeInternals = runtime as unknown as {
      executeDelegationCommand(command: unknown, parentRunId: string): Promise<void>;
    };
    await runtimeInternals.executeDelegationCommand({
      id: "command_00000000-0000-4000-8000-000000000000",
      type: "delegate",
      definitionId: "assistant",
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      delegationId: "delegation_00000000-0000-4000-8000-000000000001",
      to: "nobody",
      task: "anything",
    }, "run_fixture");
    const notice = await eventually(async () => {
      const runs = await runtime.listRuns("assistant");
      return runs.find((run) => run.conversationId === conversation.id && sourceKind(run) === "delegation");
    }, "the failure notice");
    assert.match(String((notice.input as { message: string }).message), /status="failed"[\s\S]*There is no "nobody" agent/);
    assert.ok(Date.parse(notice.createdAt) >= before - 1_000);
  });
});

test("a result still owed when the runtime stopped is handed over when it starts again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-redeliver-"));
  const file = join(directory, "foundry.json");
  const now = new Date().toISOString();
  const delegationId = "delegation_00000000-0000-4000-8000-0000000000aa";
  // The state a stop leaves behind: the coder finished, the assistant never heard.
  const seed = new FileFoundryDataAdapter({ file });
  await Effect.runPromise(seed.putAgent(createAgentInstance("assistant", { id: "fy" })));
  await Effect.runPromise(seed.putAgent(createAgentInstance("coder", { id: "fy.coder" })));
  await Effect.runPromise(seed.putConversation({
    id: "fy-chat", agentId: "fy", workspaceId: "default", context: {}, createdAt: now, updatedAt: now,
  }));
  await Effect.runPromise(seed.putConversation({
    id: delegationId, agentId: "fy.coder", workspaceId: "default", createdAt: now, updatedAt: now,
    context: {
      delegation: {
        id: delegationId, to: "coder", workerAgentId: "fy.coder", workspaceId: "default",
        from: { definitionId: "assistant", agentId: "fy", conversationId: "fy-chat", runId: "run_before" },
        task: "write hello", status: "completed", result: "hello world done", undelivered: "result",
        createdAt: now, updatedAt: now,
      },
    },
  }));
  const runtime = await FoundryRuntime.discover({
    rootDir,
    agentsDir: resolve(rootDir, "delegation-agents"),
    application: defineApplication({ name: "redeliver", data: new FileFoundryDataAdapter({ file }) }),
    config: { execution: { pollIntervalMs: 25, idlePollIntervalMs: 25 } },
  });
  await runtime.start();
  try {
    const relay = await eventually(async () => {
      const runs = await runtime.listRuns("assistant");
      return runs.find((run) => run.conversationId === "fy-chat" && run.status === "completed");
    }, "the owed result to arrive");
    assert.equal((relay.output as { value?: unknown }).value, "relay: hello world done");
    await eventually(async () => {
      const [item] = await runtime.listDelegations({ conversationId: "fy-chat" });
      return item && item.undelivered === undefined ? item : undefined;
    }, "the record to show it was handed over");
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("delegates are named by route and listed once", () => {
  assert.deepEqual(normalizeDelegates(["coder", { agent: "team/browser", description: "Uses the web." }]), [
    { agent: "coder", description: "The coder agent." },
    { agent: "team/browser", description: "Uses the web." },
  ]);
  assert.throws(() => normalizeDelegates(["Coder"]), /Invalid delegate "Coder"/);
  assert.throws(() => normalizeDelegates(["coder", "coder"]), /listed twice/);
  assert.equal(workerAgentId("agent_1", "team/browser"), "agent_1.team.browser");
});

test("deliveries read as tagged messages and open work as runtime context", () => {
  const base = { delegationId: "delegation_x", agent: "coder", task: "Fix the build" };
  assert.equal(
    renderDelivery({ kind: "result", ...base, result: "Fixed." }),
    '<delegation id="delegation_x" agent="coder" status="completed">\nTask: Fix the build\nResult:\nFixed.\n</delegation>',
  );
  assert.match(renderDelivery({ kind: "question", ...base, question: "Which branch?" }), /needs an answer to continue: Which branch\?/);
  assert.match(renderDelivery({ kind: "failed", ...base, error: "boom" }), /It stopped: boom/);
  assert.equal(
    renderDelivery({ kind: "reply", delegationId: "delegation_x", from: "assistant", message: "main" }),
    '<delegation-reply id="delegation_x" from="assistant">\nmain\n</delegation-reply>',
  );
  const open: FoundryDelegation = {
    id: "delegation_x", to: "coder", workerAgentId: "a.coder", workspaceId: "default",
    from: { definitionId: "assistant", agentId: "a", conversationId: "c", runId: "r" },
    task: "Fix the build", status: "waiting", question: "Which branch?", createdAt: "", updatedAt: "",
  };
  assert.equal(renderOpenDelegations([]), null);
  assert.match(String(renderOpenDelegations([open])), /delegation_x \(coder\): waiting for your answer to "Which branch\?"/);
});

test("the mailbox hands each delivery over once, oldest first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-mailbox-"));
  try {
    const first: FoundryConversationDelivery = { kind: "reply", delegationId: "d", from: "a", message: "one" };
    const second: FoundryConversationDelivery = { kind: "reply", delegationId: "d", from: "a", message: "two" };
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
      handler: (deliveries) => {
        for (const delivery of deliveries) if (delivery.kind === "reply") received.push(delivery.message);
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

test("a run's mailbox routes replies to their waiter and updates to handlers, and hands back what the run left", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-run-mailbox-"));
  const conversationId = "conversation/run";
  try {
    const queue = new RunEventQueue();
    const states: string[] = [];
    const mailbox = openRunMailbox({
      directory,
      conversationId,
      pollMs: 10,
      report: (state) => { states.push(state); },
      sink: {
        async forward(deliveries) { for (const delivery of deliveries) await queue.push(deliveryEvent(delivery)); },
        async reclaim(match) { return (await queue.reclaim(match)).map(({ delivery }) => delivery); },
      },
    });
    const update = { kind: "result", delegationId: "delegation_a", agent: "coder", task: "t", result: "done" } as const;
    const reply = { kind: "reply", delegationId: "delegation_b", from: "assistant", message: "blue" } as const;

    // Nobody waits: both are forwarded, and read as the messages a run would start with.
    await writeMailboxDelivery(directory, conversationId, update);
    await eventually(async () => ((await queue.peek()).length === 1 ? true : undefined), "the update to be forwarded", 2_000);
    assert.equal(formatRunEvents(await queue.peek(), "loop").text, renderDelivery(update));

    // A waiting ask gets its reply first.
    const answer = mailbox.waitForReply("delegation_b", 2_000, new AbortController().signal);
    await writeMailboxDelivery(directory, conversationId, reply);
    assert.equal((await answer)?.message, "blue");

    // A handler takes what was already forwarded, then what comes next.
    const handled: string[] = [];
    const stop = mailbox.onUpdates((updates) => { for (const item of updates) handled.push(item.delegationId); });
    await eventually(async () => (handled.length === 1 ? true : undefined), "the handler to take the waiting update", 2_000);
    assert.equal((await queue.peek()).length, 0);
    await stop();

    // What the run never used goes back to the mailbox before the runtime hears it stopped.
    await writeMailboxDelivery(directory, conversationId, { ...reply, message: "more" });
    await eventually(async () => ((await queue.peek()).length === 1 ? true : undefined), "the late reply to be forwarded", 2_000);
    await mailbox.close();
    assert.deepEqual(states, ["on", "off"]);
    assert.deepEqual(await drainMailbox(directory, conversationId), [{ ...reply, message: "more" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
