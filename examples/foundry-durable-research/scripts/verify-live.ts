import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { FileFoundryDataAdapter, type FoundryDelegation } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";

// Opt-in live test: only models are remote; all application data is fictional.
assert.ok(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required for verify:live.");
const root = await mkdtemp(join(tmpdir(), "durable-research-live-"));
const token = randomUUID();
const data = new FileFoundryDataAdapter({ file: join(root, "foundry.json") });
const env = {
  ...process.env, RESEARCH_PROVIDER: "openai", RESEARCH_DATA_DIR: root,
  RESEARCH_LIVE_TEST_ROOT: root, RESEARCH_ROOM_TOKEN: token, RESEARCH_ROOM_PORT: "0",
  RESEARCH_DOCUMENT_DELAY_MS: "3000", REALTIME_MODEL: process.env.REALTIME_MODEL ?? "gpt-realtime",
  RESEARCH_TEXT_MODEL: process.env.RESEARCH_TEXT_MODEL ?? "gpt-4.1-mini",
};
const redact = (text: string) => text.replaceAll(process.env.OPENAI_API_KEY!, "[REDACTED]");
const checks: { name: string; at: string; detail?: unknown }[] = [];
const roomMessages: { role: string; text: string; receivedAt: number }[] = [];
const controllerPids: number[] = [];
let logs = "";
let child: ChildProcess | undefined;
let client!: ReturnType<typeof createFoundryClient>;
let streamAbort: AbortController | undefined;
let readRoom: Promise<void> | undefined;
const journal = () => Effect.runPromise(data.listEvents());
const pass = (name: string, detail?: unknown) => {
  checks.push({ name, at: new Date().toISOString(), detail });
  console.log(`PASS ${name}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
};
async function eventually<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Controller exited during ${label}.`);
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function startController() {
  child = fork(fileURLToPath(new URL("./live-controller.ts", import.meta.url)), [], {
    env, execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout!.on("data", (chunk) => { logs += redact(String(chunk)); });
  child.stderr!.on("data", (chunk) => { logs += redact(String(chunk)); });
  const ready = await new Promise<{ url: string; pid: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Controller startup timed out")), 30_000);
    child!.once("message", (message) => { clearTimeout(timer); resolve(message as { url: string; pid: number }); });
    child!.once("error", reject);
    child!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Controller exited: ${code}`)); });
  });
  controllerPids.push(ready.pid);
  client = createFoundryClient({ baseUrl: ready.url });
}
async function stopController() {
  const stopping = child;
  if (!stopping || stopping.exitCode !== null || stopping.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stopping.kill("SIGKILL"); reject(new Error("Controller shutdown timed out")); }, 30_000);
    stopping.once("exit", () => { clearTimeout(timer); resolve(); });
    stopping.kill("SIGTERM");
  });
  child = undefined;
}
async function assistantSays(marker: string, after = 0) {
  return eventually(`live front says ${marker}`, async () => roomMessages.find((message) => message.role === "assistant" && message.text.includes(marker) && message.receivedAt >= after));
}
async function acknowledged(id: string) {
  return eventually(`${id} acknowledged`, async () => {
    const entry = (await journal()).find((entry) => entry.event.id === id);
    if (entry?.status === "acknowledged") return entry;
    if (entry?.runId) {
      // Until recovery reassigns it, a pending receipt can reference a run
      // from the previous controller's execution store.
      const run = (await client.runs()).find((candidate) => candidate.id === entry.runId);
      if (run) assert.notEqual(run.status, "failed", redact(`Delivery failed: ${JSON.stringify(run.error ?? run.output)}`));
    }
    return undefined;
  });
}
async function completedReply(marker: string) {
  return eventually(`parent handles ${marker}`, async () => {
    const entries = await journal();
    const replies = entries.filter((entry) => entry.target.agentId === "test-front" && entry.target.conversationId === "test-live"
      && JSON.stringify(entry.event.content).includes(marker));
    // At-least-once recovery may repeat the worker's outbound side effect.
    // Wait for every accepted copy, not just an earlier acknowledged reply.
    return replies.length && replies.every((entry) => entry.status === "acknowledged") ? replies.at(-1) : undefined;
  });
}
async function tasks() {
  return (await client.subagent("test-front", "research").data()).conversations
    .map((conversation) => conversation.context.delegation as FoundryDelegation | undefined).filter((task) => task !== undefined);
}
let failure: string | undefined;
try {
  await startController();
  await client.createAgent("front", { id: "test-front", workspaceId: "live-test", context: { preference: "EU hosting" }, installations: [{ kind: "application", id: "library" }] });
  await client.createConversation("test-front", { id: "test-live" });
  const worker = await client.subagent("test-front", "research").ensure();
  assert.equal(worker.context.preference, "EU hosting");
  const live = await client.send("test-front", "test-live", "Start the test session.", { payload: { mode: "live" } });
  const ready = await eventually("realtime room", async () => {
    const run = await client.getRun(live.id);
    assert.ok(!["failed", "cancelled", "completed"].includes(run.status), `Live run ended: ${JSON.stringify(run.error ?? run.output)}`);
    return (await client.getEvents({ runId: live.id })).find((event) => event.type === "agent.research.front.ready");
  });
  const roomUrl = `http://127.0.0.1:${(ready.data as { port: number }).port}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const say = async (text: string) => {
    const response = await fetch(`${roomUrl}/say`, { method: "POST", headers, body: JSON.stringify({ text }) });
    assert.equal(response.status, 202, "room accepts user input");
  };
  streamAbort = new AbortController();
  const stream = await fetch(`${roomUrl}/events`, { headers, signal: streamAbort.signal });
  readRoom = (async () => {
    let pending = ""; const decoder = new TextDecoder();
    for await (const chunk of stream.body!) {
      pending += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const message = { ...JSON.parse(pending.slice(0, end)), receivedAt: Date.now() } as { role: string; text: string; receivedAt: number };
        roomMessages.push(message); pending = pending.slice(end + 1);
        if (message.role === "assistant" || message.role === "error") console.log(redact(`${message.role}: ${message.text}`).slice(0, 600));
      }
    }
  })().catch((error) => { if (!streamAbort?.signal.aborted) throw error; });
  await say('Reply with READY_LIVE. Keep all replies brief throughout this integration test.');
  await assistantSays("READY_LIVE");
  pass("native realtime front responds");

  await say('Call glove_foundry_message with exactly this JSON: {"to":"research","message":"Protocol test: send parent a direct message containing PONG_DIRECT, targeting parent conversation test-live with whenIdle=wake. Do not research or delegate.","delivery":{"id":"ping-direct","whenIdle":"wake"}}. Omit conversationId in YOUR outgoing delivery: test-live is only the WORKER reply target. When the worker reply arrives, tell me PONG_DIRECT.');
  await acknowledged("ping-direct");
  const pong = (await journal()).find((entry) => entry.target.conversationId === "test-live" && JSON.stringify(entry.event.content).includes("PONG_DIRECT"));
  assert.ok(pong, "worker actually sent the reply, not just a front-model claim");
  await assistantSays("PONG_DIRECT", Date.parse(pong.createdAt));
  assert.equal(pong.runId, live.id);
  assert.equal((await client.runs("front")).filter((run) => run.conversationId === "test-live").length, 1);
  pass("front → worker → same live front via durable direct messages");

  await say('Delegate exactly one task to research: "Before reading any source, call glove_foundry_ask to ask What budget should I use? Wait for the answer. Then search for the Atlas brief, read its exact document ID and state whether it fits EU hosting and that budget. Include TASK_DONE in your final answer." The budget is not known yet: wait for the worker question and ask me. Do not send a reply or invent a budget before I answer. Tell me TASK_DONE only after its result arrives.');
  const task = await eventually("task accepted", async () => (await tasks()).find((item) => item.task.includes("TASK_DONE")));
  assert.equal(task.workerAgentId, worker.id);
  await say('While research is pending, reply immediately with STILL_HERE; leave the task running.');
  await assistantSays("STILL_HERE");
  assert.notEqual((await tasks()).find((item) => item.id === task.id)?.status, "completed", "front responds before background work finishes");
  pass("front remains responsive during pending research");
  const question = await eventually("worker question reaches the live front", async () => (await journal()).find((entry) => entry.delivery.kind === "question" && entry.delivery.delegationId === task.id && entry.runId === live.id));
  await assistantSays("budget", Date.parse(question.createdAt));
  await say('My budget is $50/user/month. Answer the research worker with glove_foundry_reply and let the original task finish.');
  const finished = await eventually("delegated task completion", async () => (await tasks()).find((item) => item.id === task.id && item.status === "completed"));
  assert.match(finished.result ?? "", /TASK_DONE/);
  const resultEvent = await eventually("task result assigned to a receiving run", async () => (await journal()).find((entry) => entry.delivery.kind === "result" && entry.delivery.delegationId === task.id && entry.runId));
  const taskEvents = (await journal()).filter((entry) => "delegationId" in entry.delivery && entry.delivery.delegationId === task.id);
  for (const kind of ["question", "reply", "result"]) assert.ok(taskEvents.some((entry) => entry.delivery.kind === kind), `journal contains ${kind}`);
  assert.equal(resultEvent.runId, live.id);
  await assistantSays("TASK_DONE", Date.parse(resultEvent.createdAt));
  const workerTranscript = await client.conversationTranscript(worker.id, task.id);
  assert.ok(JSON.stringify(workerTranscript.messages).includes("read_document"), "worker used the inherited mock app");
  assert.ok(!JSON.stringify(workerTranscript.messages).includes('"name":"write_note"'), "worker did not invoke the write tool");
  pass("delegation asks, receives an answer and returns a result", { taskId: task.id });

  await fetch(`${roomUrl}/end`, { method: "POST", headers });
  assert.equal((await live.wait({ timeoutMs: 30_000 })).status, "completed");
  streamAbort.abort(); await readRoom;
  await eventually("live run acknowledges consumed events", async () => (await journal()).find((entry) => entry.id === pong.id && entry.status === "acknowledged"));
  pass("live-session consumption acknowledged on successful close");

  const restartChat = await client.createConversation(worker.id, { id: "restart-target" });
  const target = { agentId: worker.id, conversationId: restartChat.id };
  const deferred = { id: "restart-deferred", source: "test:app", content: 'Read document id atlas, then call glove_foundry_message with to="parent", delivery={"conversationId":"test-live","whenIdle":"wake"}, and message containing RESTART_DELIVERED plus the price. The parent conversation ID is test-live; it must be in delivery.conversationId. Do not delegate.' };
  const policy = { whenIdle: "defer" as const, deferTimeoutMs: 5000 };
  await client.emitEvent(target, deferred, policy);
  await client.emitEvent(target, { id: "restart-expired", source: "test:app", content: "NEVER_DELIVER_THIS", expiresAt: "2000-01-01T00:00:00Z" }, policy);
  assert.equal((await journal()).find((entry) => entry.event.id === deferred.id)?.runId, undefined);
  await stopController();
  await startController();
  assert.equal((await client.subagent("test-front", "research").ensure()).id, worker.id);
  const recovered = await acknowledged(deferred.id);
  assert.deepEqual(recovered.target, target);
  await completedReply("RESTART_DELIVERED");
  assert.equal((await journal()).find((entry) => entry.event.id === "restart-expired")?.status, "expired");
  const afterRestart = await client.conversationTranscript(worker.id, restartChat.id);
  assert.ok(!JSON.stringify(afterRestart.messages).includes("NEVER_DELIVER_THIS"));
  const parentHistory = await client.conversationTranscript("test-front", "test-live");
  const receivedAt = parentHistory.messages.findIndex((message) => message.framework_context === "event" && message.text?.includes("RESTART_DELIVERED"));
  assert.ok(receivedAt >= 0, "the exact parent conversation persisted the event");
  assert.ok(parentHistory.messages.slice(receivedAt + 1).some((message) => message.sender === "agent" && message.text), "idle parent produced a text response after consuming the event");
  pass("deferred event survives controller restart; exact target, expiry and idle parent fallback verified");

  // Stop a real worker while its simulated external read is in progress.
  const interruptChat = await client.createConversation(worker.id, { id: "interrupted-target" });
  const interrupted = await client.subagent("test-front", "research").send(
    'Read document id cedar now, then call glove_foundry_message with to="parent", delivery={"conversationId":"test-live","whenIdle":"wake"}, and message containing RECOVERED_INFLIGHT plus the price. The parent conversation ID is test-live; it must be in delivery.conversationId. Do not delegate.',
    { id: "interrupted-event", conversationId: interruptChat.id, whenIdle: "wake" },
  );
  await eventually("mock document read starts", async () => (await client.getEvents({ runId: interrupted.runId })).find((event) => event.type.includes("tool") && JSON.stringify(event.data).includes("read_document")));
  await stopController();
  assert.equal((await journal()).find((entry) => entry.event.id === "interrupted-event")?.status, "pending");
  await startController();
  const replayed = await acknowledged("interrupted-event");
  assert.notEqual(replayed.runId, interrupted.runId);
  await completedReply("RECOVERED_INFLIGHT");
  pass("in-flight event replays in a new worker process after restart");

  const before = (await client.runs()).length;
  await client.emitEvent(target, deferred, policy);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal((await client.runs()).length, before, "acknowledged retry must not create a new run");
  await assert.rejects(client.emitEvent({ agentId: worker.id, conversationId: "test-live" }, { id: "wrong-target", source: "test", content: "reject" }), /owned/);
  pass("deduplication and conversation ownership enforced after restart");
  assert.deepEqual(roomMessages.filter((message) => message.role === "error"), [], "no realtime provider errors");
  assert.equal((await journal()).filter((entry) => entry.status === "pending").length, 0, "all accepted test events are settled before teardown");
} catch (error) {
  failure = redact(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error(failure);
  process.exitCode = 1;
} finally {
  streamAbort?.abort(); await readRoom?.catch(() => {});
  await stopController();
  await writeFile(join(root, "report.json"), redact(JSON.stringify({ checks, failure, controllerPids, models: { realtime: env.REALTIME_MODEL, text: env.RESEARCH_TEXT_MODEL }, roomMessages, events: await journal() }, null, 2)));
  await writeFile(join(root, "controller.log"), logs);
  console.log(`Test artifacts: ${root}`);
}
