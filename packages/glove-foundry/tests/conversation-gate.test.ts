import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import { defineApplication } from "../src/application.js";
import { install } from "../src/capabilities.js";
import { ConversationGate } from "../src/conversation-gate.js";
import { discoverAgents } from "../src/discovery.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { composePlaybook, composedPlaybookRevision, definePlaybookAction, materializeComposedPlaybook } from "../src/playbook.js";
import { MemoryFoundryDataAdapter, type FoundryDataAdapter } from "../src/primitives.js";
import { FoundryRuntime, type FoundryRun } from "../src/runtime.js";
import { definePlaybookSubscription } from "../src/subscription.js";
import { ticketMessage, tickets, ticketsApp, ticketsRoute } from "./fixtures/gate-tickets.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "fixtures");
const agentsDir = resolve(rootDir, "gate-agents");

interface LogEntry { readonly t: number; readonly event: string; readonly [key: string]: unknown }

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

const done = (run: FoundryRun | null | undefined): boolean =>
  Boolean(run && run.status !== "pending" && run.status !== "running");

test("the gate starts one run per conversation at a time, in arrival order, with steering first", async () => {
  const started: string[] = [];
  const idle: string[] = [];
  const gate = new ConversationGate({ idle: (conversationId) => { idle.push(conversationId); } });
  let next = 0;
  const admit = (conversationId: string, options: { front?: boolean } = {}) =>
    gate.admit(
      conversationId,
      async (parked) => {
        const id = `run-${++next}`;
        if (!parked) started.push(id);
        return id;
      },
      async (runId) => { started.push(runId); return true; },
      options,
    );

  const first = await admit("c");
  const second = await admit("c");
  const other = await admit("d");
  assert.deepEqual(started, [first, other], "a second run on a busy conversation waits; another conversation does not");
  assert.equal(gate.activeRun("c"), first);

  const release = gate.hold("c");
  const third = await admit("c");
  const steered = await admit("c", { front: true });
  gate.settled(first);
  assert.deepEqual(started, [first, other], "nothing starts while the conversation is held");
  release();
  assert.deepEqual(started, [first, other, steered], "the steering replacement goes ahead of the waiting runs");

  gate.settled(third); // cancelled while it waited
  gate.settled(steered);
  assert.deepEqual(started, [first, other, steered, second]);
  gate.settled(second);
  assert.equal(gate.busy("c"), false);
  assert.deepEqual(idle, ["c"]);

  // A run the gate did not create (a schedule firing) waits for its turn.
  const busy = await admit("e");
  let granted = false;
  const claim = gate.claim("e", "schedule-run").then(() => { granted = true; });
  await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  assert.equal(granted, false);
  gate.settled(busy);
  await claim;
  assert.equal(gate.activeRun("e"), "schedule-run");

  // A waiting run that can no longer start counts as settled.
  const gate2 = new ConversationGate({ idle: () => {} });
  const a = await gate2.admit("c", async () => "a", async () => true);
  const b = await gate2.admit("c", async () => "b", async () => false);
  const c = await gate2.admit("c", async () => "c", async () => true);
  gate2.settled(a);
  await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  assert.equal(gate2.activeRun("c"), c, `${b} could not start, so ${c} did`);
});

async function withRuntime(
  options: { readonly data?: FoundryDataAdapter; readonly inbound?: boolean },
  work: (runtime: FoundryRuntime, logFile: string, route: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-gate-"));
  const logFile = join(directory, "gate.log");
  process.env.FOUNDRY_TEST_DELEGATION_LOG = logFile;
  const [base] = await discoverAgents({ agentsDir });
  const route = ticketsRoute;
  const composed = composePlaybook({
    name: "answer",
    transmission: tickets,
    match: { event: ticketMessage, routes: [route] },
    directives: [{ action: definePlaybookAction({ id: "answer" }), instruction: "Answer the ticket." }],
    applications: [ticketsApp],
  });
  const definition = base!.definition;
  const subscription = definePlaybookSubscription({
    id: "tickets-workforce",
    workspaceId: "default",
    playbook: materializeComposedPlaybook(composed, "answer", composedPlaybookRevision(composed)),
    targets: [{ agent: definition, provisioning: { mode: "per-thread" }, installations: [install(ticketsApp)], context: {} }],
  });
  const data = options.data ?? new MemoryFoundryDataAdapter({ subscriptions: options.inbound ? [subscription] : [] });
  if (options.data && options.inbound) await Effect.runPromise(data.putPlaybookSubscription(subscription));
  const runtime = new FoundryRuntime({
    rootDir,
    agents: [base!],
    application: defineApplication({ name: "Gate test", data }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10, maxConcurrent: 4 } },
  });
  if (options.inbound) await runtime.putRoute(route);
  await runtime.start();
  try {
    await work(runtime, logFile, route.id);
  } finally {
    await runtime.stop();
    delete process.env.FOUNDRY_TEST_DELEGATION_LOG;
    await rm(directory, { recursive: true, force: true });
  }
}

test("two messages to one conversation run one after the other, never side by side", async () => {
  await withRuntime({}, async (runtime) => {
    const agent = await runtime.createAgent("threader", { id: "ann" });
    const conversation = await runtime.createConversation(agent.id, { id: "ann-chat" });
    const elsewhere = await runtime.createConversation(agent.id, { id: "ann-other" });
    const [first, second, other] = await Promise.all([
      runtime.send(agent.id, conversation.id, "first"),
      runtime.send(agent.id, conversation.id, "second"),
      runtime.send(agent.id, elsewhere.id, "other"),
    ]);
    let overlapped = false;
    for (;;) {
      const runs = await Promise.all([first, second].map((run) => runtime.getRun(run.id)));
      assert.ok(runs.filter((run) => run?.status === "running").length <= 1, "never two runs on one conversation");
      const [a, b, c] = [...runs, await runtime.getRun(other.id)];
      if (c?.status === "running" && (a?.status === "running" || b?.status === "running")) overlapped = true;
      if (runs.every(done) && done(c)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const a = (await runtime.getRun(first.id))!;
    const b = (await runtime.getRun(second.id))!;
    assert.equal(a.status, "completed");
    assert.equal(b.status, "completed");
    assert.ok(Date.parse(b.startedAt!) >= Date.parse(a.completedAt!), "the second started after the first finished");
    assert.match(String((b.output as { value?: unknown }).value), /^done: second/);
    assert.ok(overlapped, "a different conversation is not held up");
  });
});

test("a run cancelled while it waits does not hold up the conversation", async () => {
  await withRuntime({}, async (runtime) => {
    const agent = await runtime.createAgent("threader", { id: "dee" });
    const conversation = await runtime.createConversation(agent.id, { id: "dee-chat" });
    const first = await runtime.send(agent.id, conversation.id, "first");
    const waiting = await runtime.send(agent.id, conversation.id, "never");
    assert.equal(await runtime.cancel(waiting.id), true);
    const third = await runtime.send(agent.id, conversation.id, "third");
    assert.equal((await runtime.waitForRun(waiting.id, { timeoutMs: 30_000 }))?.status, "cancelled");
    assert.equal((await runtime.waitForRun(first.id, { timeoutMs: 30_000 }))?.status, "completed");
    const done = await runtime.waitForRun(third.id, { timeoutMs: 30_000 });
    assert.equal(done?.status, "completed");
    assert.match(String((done?.output as { value?: unknown }).value), /^done: third/);
  });
});

test("a run Foundry did not start (a schedule firing) waits in its process for the conversation", async () => {
  await withRuntime({}, async (runtime, logFile) => {
    const agent = await runtime.createAgent("threader", { id: "cy" });
    const conversation = await runtime.createConversation(agent.id, { id: "cy-chat" });
    const first = await runtime.send(agent.id, conversation.id, "first");
    // What a schedule does: put a run straight into the execution queue.
    const internals = runtime as unknown as {
      signalRunner: { triggerSignal(name: string, input: unknown): Promise<string> };
      executionEnvelope(request: unknown): Promise<unknown>;
    };
    const scheduled = await internals.signalRunner.triggerSignal("foundry_threader", await internals.executionEnvelope({
      agentId: agent.id,
      conversationId: conversation.id,
      workspaceId: agent.workspaceId,
      message: "scheduled",
      source: { kind: "activation" },
    }));
    const firstDone = (await runtime.waitForRun(first.id, { timeoutMs: 30_000 }))!;
    const scheduledDone = (await runtime.waitForRun(scheduled, { timeoutMs: 30_000 }))!;
    assert.equal(firstDone.status, "completed");
    assert.equal(scheduledDone.status, "completed");
    const calls = (await entries(logFile)).filter((entry) => entry.event === "threader-call" && entry.runId === scheduled);
    assert.ok(calls.length > 0);
    assert.ok(calls[0]!.t >= Date.parse(firstDone.completedAt!), "it read the conversation only after the first run let go");
  });
});

test("an inbound event for a thread whose run is still working joins that run", async () => {
  const data = new MemoryFoundryDataAdapter();
  await withRuntime({ data, inbound: true }, async (runtime, _log, route) => {
    const [first] = await runtime.dispatchInbound({ routeId: route, eventId: "e1", threadKey: "t1", raw: { type: "ticket", text: "hold" } });
    assert.ok(first);
    const joined = await runtime.dispatchInbound({ routeId: route, eventId: "e2", threadKey: "t1", raw: { type: "ticket", text: "second message" } });
    assert.deepEqual(joined.map((run) => run.id), [first.id], "the event went to the run already on the thread");

    const finished = await runtime.waitForRun(first.id, { timeoutMs: 30_000 });
    assert.equal(finished?.status, "completed");
    const value = String((finished?.output as { value?: unknown }).value);
    assert.match(value, /^joined: <transmission direction="inbound"/);
    assert.match(value, /event-id="e2"/);
    assert.match(value, /second message/);

    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    const runs = (await runtime.listRuns("threader")).filter((run) => run.conversationId === first.conversationId);
    assert.equal(runs.length, 1, "no second run beside it");
    await eventually(async () =>
      (await Effect.runPromise(data.listPendingInbound())).length === 0 ? true : undefined, "the pending events to clear");
  });
});

test("an inbound event that misses the running turn starts the thread's next run once it is free", async () => {
  const data = new MemoryFoundryDataAdapter();
  await withRuntime({ data, inbound: true }, async (runtime, logFile, route) => {
    const [first] = await runtime.dispatchInbound({ routeId: route, eventId: "l1", threadKey: "t2", raw: { type: "ticket", text: "linger" } });
    await eventually(async () =>
      (await entries(logFile)).some((entry) => entry.event === "threader-lingering") ? true : undefined, "the final answer to start");
    const [during] = await runtime.dispatchInbound({ routeId: route, eventId: "l2", threadKey: "t2", raw: { type: "ticket", text: "late note" } });
    assert.equal(during?.id, first!.id);
    assert.equal((await Effect.runPromise(data.listPendingInbound())).length, 2, "both events are kept until a run finishes with them");

    const next = await eventually(async () => {
      const runs = (await runtime.listRuns("threader")).filter((run) =>
        run.conversationId === first!.conversationId && run.id !== first!.id && done(run));
      return runs[0];
    }, "the thread's next run");
    const lingered = (await runtime.getRun(first!.id))!;
    assert.equal((lingered.output as { value?: unknown }).value, "lingered");
    assert.ok(Date.parse(next.startedAt!) >= Date.parse(lingered.completedAt!));
    assert.equal(next.status, "completed");
    const message = String((next.input as { message?: unknown }).message);
    assert.match(message, /event-id="l2"/);
    assert.match(message, /late note/);
    assert.equal((next.input as { source?: { kind?: string } }).source?.kind, "transmission");
    await eventually(async () =>
      (await Effect.runPromise(data.listPendingInbound())).length === 0 ? true : undefined, "the pending events to clear");
  });
});

test("an inbound event no run finished with is delivered again after a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-gate-data-"));
  try {
    const file = join(directory, "foundry.json");
    let conversationId = "";
    let agentId = "";
    await withRuntime({ data: new FileFoundryDataAdapter({ file }) }, async (runtime) => {
      const agent = await runtime.createAgent("threader", { id: "bea" });
      const conversation = await runtime.createConversation(agent.id, { id: "bea-thread" });
      agentId = agent.id;
      conversationId = conversation.id;
    });
    // As if the process stopped while the event's run was still queued.
    const crashed = new FileFoundryDataAdapter({ file });
    await Effect.runPromise(crashed.putPendingInbound({
      id: "tickets-inbound:r1:bea",
      definitionId: "threader",
      runId: "a-run-from-the-previous-process",
      createdAt: new Date().toISOString(),
      request: {
        agentId,
        conversationId,
        workspaceId: "default",
        message: '<transmission direction="inbound" event-id="r1">recovered</transmission>',
        source: { kind: "transmission", id: "tickets-inbound", eventId: "r1", threadKey: "t3" },
      },
    }));

    const data = new FileFoundryDataAdapter({ file });
    await withRuntime({ data }, async (runtime) => {
      const run = await eventually(async () =>
        (await runtime.listRuns("threader")).find((item) => item.conversationId === conversationId && done(item)),
        "the recovered event's run");
      assert.equal(run.status, "completed");
      assert.match(String((run.input as { message?: unknown }).message), /recovered/);
      await eventually(async () =>
        (await Effect.runPromise(data.listPendingInbound())).length === 0 ? true : undefined, "the record to clear");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
