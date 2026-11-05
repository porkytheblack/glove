/**
 * Addressed events through Foundry's real controller, daemon and child runs:
 * voice calls telling them at pauses, `onEvent` acknowledgement, text-turn
 * preparation, and recovery after the whole process group is SIGKILLed.
 */
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import type { Message } from "glove-core";
import type { FoundryEventRecord } from "../src/event-delivery.js";
import { eventRecordId } from "../src/event-delivery.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const controllerPath = resolve(here, "fixtures/voice-events/controller.ts");
const tsx = import.meta.resolve("tsx");

interface LogEntry { readonly type: string; readonly [key: string]: unknown }

interface Controller {
  call<T = unknown>(command: Record<string, unknown>): Promise<T>;
  /** SIGKILL the controller's process group: controller, daemon and runs, no cleanup. */
  kill(): Promise<void>;
  /** Resolves when the group was killed from inside (a crash checkpoint). */
  readonly crashed: Promise<void>;
}

interface Harness {
  readonly dir: string;
  boot(crashAt?: string): Promise<Controller>;
  control(state: { agentSpeaking?: boolean; userSpeaking?: boolean; end?: boolean }): Promise<void>;
  fact(text: string): Promise<void>;
  log(): Promise<LogEntry[]>;
  transcript(conversationId: string): Promise<Message[]>;
  data(): FileFoundryDataAdapter;
  event(id: string, conversationId: string, agentId: string): Promise<FoundryEventRecord | undefined>;
}

async function withHarness(work: (harness: Harness) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "glove-foundry-voice-events-"));
  const live: ChildProcess[] = [];
  const exited = (child: ChildProcess) => new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) resolveExit();
    else child.once("exit", () => resolveExit());
  });
  const killGroup = async (child: ChildProcess) => {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    await exited(child);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  };
  const data = () => new FileFoundryDataAdapter({ file: join(dir, "foundry.json") });
  try {
    await work({
      dir,
      async boot(crashAt) {
        const child = fork(controllerPath, [], {
          detached: true,
          execArgv: ["--import", tsx],
          stdio: ["ignore", "inherit", "inherit", "ipc"],
          env: { ...process.env, FOUNDRY_VOICE_DIR: dir, FOUNDRY_VOICE_CRASH_AT: crashAt ?? "", FOUNDRY_VOICE_PGID: "" },
        });
        live.push(child);
        // The group leader is the controller itself.
        const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
        let sequence = 0;
        let markStarted!: () => void;
        const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
        child.on("message", (message: { id?: number; value?: unknown; error?: string; started?: boolean }) => {
          if (message.started) { markStarted(); return; }
          const request = pending.get(message.id!);
          if (!request) return;
          pending.delete(message.id!);
          if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
        });
        const gone = exited(child).then(() => {
          for (const request of pending.values()) request.reject(new Error("controller exited"));
          pending.clear();
        });
        await Promise.race([started, gone.then(() => { throw new Error("controller exited during startup"); })]);
        return {
          call: <T>(command: Record<string, unknown>) => new Promise<T>((resolveCall, rejectCall) => {
            const id = ++sequence;
            pending.set(id, { resolve: resolveCall as (value: unknown) => void, reject: rejectCall });
            child.send({ id, command });
          }),
          kill: () => killGroup(child),
          crashed: gone,
        };
      },
      control: (state) => writeFile(join(dir, "control.json"), JSON.stringify(state)),
      fact: (text) => writeFile(join(dir, "fact.txt"), text),
      log: async () => (await readFile(join(dir, "log.jsonl"), "utf8").catch(() => ""))
        .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry),
      transcript: async (conversationId) => {
        const file = join(dir, "transcripts", `${Buffer.from(conversationId).toString("hex")}.json`);
        return (JSON.parse(await readFile(file, "utf8").catch(() => '{"messages":[]}')) as { messages: Message[] }).messages;
      },
      data,
      event: async (id, conversationId, agentId) =>
        (await Effect.runPromise(data().listEvents())).find((item) => item.id === eventRecordId({ agentId, conversationId }, id)),
    });
  } finally {
    for (const child of live) await killGroup(child);
    await rm(dir, { recursive: true, force: true });
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

const settle = (ms = 600) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const CALLER = { definitionId: "caller", agentId: "agent_caller", conversationId: "conversation_call" } as const;

/** Start a call and wait until its caller joined. */
async function startCall(harness: Harness, controller: Controller): Promise<string> {
  const before = (await harness.log()).filter((entry) => entry.type === "joined").length;
  const runId = await controller.call<string>({
    method: "request", route: "caller",
    request: { agentId: CALLER.agentId, conversationId: CALLER.conversationId, workspaceId: "voice-events", message: "start the call" },
  });
  await eventually(async () => (await harness.log()).filter((entry) => entry.type === "joined").length > before, "the caller to join");
  return runId;
}

function meetingEvent(id: string) {
  return {
    method: "event",
    target: { agentId: CALLER.agentId, conversationId: CALLER.conversationId },
    event: { id, source: "mez:meetings", kind: "meeting.changed", content: `meeting ${id} changed` },
    policy: { whenIdle: "defer" },
  };
}

const injected = async (harness: Harness) => (await harness.log()).filter((entry) => entry.type === "injected");

test("a real call holds an event until a pause, then tells only the current fact, as system context", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({ agentSpeaking: true });
    await harness.fact("Your meeting is at 3pm.");
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...CALLER });
    const runId = await startCall(harness, controller);

    await controller.call(meetingEvent("m1"));
    await settle();
    assert.equal((await injected(harness)).length, 0, "nothing over the agent's speech");
    // The fact changes while the event waits: the pause tells the new one.
    await harness.fact("Your meeting moved to 4pm.");
    await harness.control({ agentSpeaking: false });
    const [told] = await eventually(async () => { const items = await injected(harness); return items.length ? items : undefined; }, "the notice");
    assert.equal(told!.text, "Your meeting moved to 4pm.");
    assert.equal(told!.role, "system");

    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m1");
    const receipt = await eventually(async () => {
      const item = await Effect.runPromise(harness.data().getEventReceipt(recordId));
      return item?.transcriptMessageId ? item : undefined;
    }, "the accepted receipt");
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.text, "Your meeting moved to 4pm.");
    const line = (await harness.transcript(CALLER.conversationId)).find((item) => item.id === receipt.transcriptMessageId);
    assert.equal(line?.framework_context, "event", "framework context, not an owner instruction");
    assert.match(line!.text, /^\[event from mez:meetings\] Your meeting moved to 4pm\.$/);

    await harness.control({ end: true });
    assert.equal(await controller.call({ method: "wait", runId }), "completed");
    assert.equal((await eventually(() => harness.event("m1", CALLER.conversationId, CALLER.agentId).then((record) => record?.status === "acknowledged" ? record : undefined), "the acknowledgement")).status, "acknowledged");
    assert.equal((await injected(harness)).length, 1);
    // Receipts live apart from the workspace that agent workspace tools read and write.
    assert.deepEqual(await Effect.runPromise(harness.data().listWorkspaceEntries("voice-events")), []);
    assert.equal((await Effect.runPromise(harness.data().listEventReceipts())).length, 1);
    await controller.call({ method: "stop" });
  });
});

test("an event whose fact was cancelled while it waited is suppressed: nothing said, acknowledged", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({ userSpeaking: true });
    await harness.fact("Your meeting is at 3pm.");
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...CALLER });
    const runId = await startCall(harness, controller);
    await controller.call(meetingEvent("m2"));
    await settle();
    await harness.fact("cancelled");
    await harness.control({ userSpeaking: false });
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m2");
    const receipt = await eventually(() => Effect.runPromise(harness.data().getEventReceipt(recordId)).then((item) => item?.status === "suppressed" ? item : undefined), "the suppression");
    assert.equal(receipt.reason, "the meeting was cancelled");
    await harness.control({ end: true });
    assert.equal(await controller.call({ method: "wait", runId }), "completed");
    await eventually(() => harness.event("m2", CALLER.conversationId, CALLER.agentId).then((record) => record?.status === "acknowledged"), "the acknowledgement");
    assert.equal((await injected(harness)).length, 0);
    await controller.call({ method: "stop" });
  });
});

test("preparation that fails tells nothing and keeps the event; a later pause tells it", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({});
    await harness.fact("error");
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...CALLER });
    const runId = await startCall(harness, controller);
    await controller.call(meetingEvent("m3"));
    await settle(800);
    assert.equal((await injected(harness)).length, 0);
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m3");
    assert.equal((await Effect.runPromise(harness.data().getEventReceipt(recordId)))?.status, "queued");
    await harness.fact("Your meeting moved to 5pm.");
    const [told] = await eventually(async () => { const items = await injected(harness); return items.length ? items : undefined; }, "the retried notice", 15_000);
    assert.equal(told!.text, "Your meeting moved to 5pm.");
    await harness.control({ end: true });
    assert.equal(await controller.call({ method: "wait", runId }), "completed");
    await controller.call({ method: "stop" });
  });
});

test("killed after the provider accepted an event: the restart repairs the transcript and never tells it again", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({});
    await harness.fact("Your meeting moved to 4pm.");
    const first = await harness.boot("after-accepted");
    await first.call({ method: "setup", ...CALLER });
    await startCall(harness, first);
    void first.call(meetingEvent("m4")).catch(() => undefined);
    await first.crashed;
    assert.equal((await injected(harness)).length, 1);
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m4");
    const crashed = await Effect.runPromise(harness.data().getEventReceipt(recordId));
    assert.equal(crashed?.status, "accepted");
    assert.equal(crashed?.transcriptMessageId, undefined, "killed before the transcript line");
    assert.equal((await harness.event("m4", CALLER.conversationId, CALLER.agentId))?.status, "pending");

    const second = await harness.boot();
    const runId = await startCall(harness, second);
    const repaired = await eventually(() => Effect.runPromise(harness.data().getEventReceipt(recordId)).then((item) => item?.transcriptMessageId ? item : undefined), "the transcript repair");
    const lines = (await harness.transcript(CALLER.conversationId)).filter((item) => item.id === repaired.transcriptMessageId);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.framework_context, "event");
    await harness.control({ end: true });
    assert.equal(await second.call({ method: "wait", runId }), "completed");
    assert.equal((await harness.event("m4", CALLER.conversationId, CALLER.agentId))?.status, "acknowledged");
    assert.equal((await injected(harness)).length, 1, "told once across both processes");
    await second.call({ method: "stop" });
  });
});

test("killed mid-dispatch: the uncertain event is never told again or sent to chat", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({});
    await harness.fact("Your meeting moved to 4pm.");
    const first = await harness.boot("after-inject");
    await first.call({ method: "setup", ...CALLER });
    await startCall(harness, first);
    void first.call(meetingEvent("m5")).catch(() => undefined);
    await first.crashed;
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m5");
    assert.equal((await Effect.runPromise(harness.data().getEventReceipt(recordId)))?.status, "dispatching");

    const second = await harness.boot();
    const runId = await startCall(harness, second);
    await settle(1_000);
    await harness.control({ end: true });
    assert.equal(await second.call({ method: "wait", runId }), "completed");
    assert.equal((await injected(harness)).length, 1, "only the dispatch before the kill");
    assert.equal((await harness.log()).filter((entry) => entry.type === "after-call").length, 0, "never sent to chat instead");
    assert.equal((await Effect.runPromise(harness.data().getEventReceipt(recordId)))?.status, "dispatching");
    assert.equal((await harness.event("m5", CALLER.conversationId, CALLER.agentId))?.status, "pending", "kept, unresolved");
    await second.call({ method: "stop" });
  });
});

test("a call that ends with an event never attempted hands it to the late-chat policy once", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.control({ agentSpeaking: true });
    await harness.fact("Your meeting moved to 4pm.");
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...CALLER });
    const runId = await startCall(harness, controller);
    await controller.call(meetingEvent("m6"));
    await settle();
    await harness.control({ agentSpeaking: true, end: true });
    assert.equal(await controller.call({ method: "wait", runId }), "completed");
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m6");
    const receipt = await Effect.runPromise(harness.data().getEventReceipt(recordId));
    assert.equal(receipt?.status, "redirected");
    const after = (await harness.log()).filter((entry) => entry.type === "after-call");
    assert.deepEqual(after.map((entry) => entry.effectId), [receipt!.effectId]);
    assert.equal((await injected(harness)).length, 0);
    assert.equal((await eventually(() => harness.event("m6", CALLER.conversationId, CALLER.agentId).then((record) => record?.status === "acknowledged" ? record : undefined), "the acknowledgement")).status, "acknowledged");
    await controller.call({ method: "stop" });
  });
});

test("an event that wakes a voice agent with no call opens no room; a crash in the late-chat effect retries that same effect", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.fact("Your meeting moved to 4pm.");
    const first = await harness.boot("in-after-call");
    await first.call({ method: "setup", ...CALLER });
    void first.call({ ...meetingEvent("m7"), policy: { whenIdle: "wake" } }).catch(() => undefined);
    await first.crashed;
    const recordId = eventRecordId({ agentId: CALLER.agentId, conversationId: CALLER.conversationId }, "m7");
    const redirecting = await Effect.runPromise(harness.data().getEventReceipt(recordId));
    assert.equal(redirecting?.status, "redirecting");

    const second = await harness.boot();
    const redirected = await eventually(() => Effect.runPromise(harness.data().getEventReceipt(recordId)).then((item) => item?.status === "redirected" ? item : undefined), "the retried effect");
    await eventually(() => harness.event("m7", CALLER.conversationId, CALLER.agentId).then((record) => record?.status === "acknowledged"), "the acknowledgement");
    const after = (await harness.log()).filter((entry) => entry.type === "after-call");
    assert.equal(after.length, 2);
    assert.ok(after.every((entry) => entry.effectId === redirected.effectId), "the same effect id on the retry");
    assert.equal((await harness.log()).filter((entry) => entry.type === "joined").length, 0, "no room");
    await second.call({ method: "stop" });
  });
});

const HANDLER = { definitionId: "handler", agentId: "agent_handler", conversationId: "conversation_handler" } as const;
const handlerEvent = (id: string, content: string, policy: Record<string, unknown> = { whenIdle: "defer", deferTimeoutMs: 300 }) => ({
  method: "event", target: { agentId: HANDLER.agentId, conversationId: HANDLER.conversationId },
  event: { id, source: "mez:notices", kind: "notice", content }, policy,
});

test("onEvent: only ack() consumes, in a mixed batch and from a handler call still running at return", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...HANDLER });
    await controller.call(handlerEvent("e1", "ack one"));
    await controller.call(handlerEvent("e2", "keep two"));
    await controller.call(handlerEvent("e3", "slow-ack three"));
    await eventually(async () => (await harness.log()).filter((entry) => entry.type === "handled").length === 3, "three handled events");
    const status = async (id: string) => (await harness.event(id, HANDLER.conversationId, HANDLER.agentId))?.status;
    await eventually(async () => (await status("e1")) === "acknowledged" && (await status("e3")) === "acknowledged", "the acknowledgements");
    await settle();
    assert.equal(await status("e2"), "pending", "an event the handler did not finish stays pending");
    assert.ok((await harness.log()).filter((entry) => entry.type === "handled").every((entry) => entry.initial === true));
    await controller.call({ method: "stop" });
  });
});

test("onEvent: an event arriving mid-run that the handler does not finish goes to the next run", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    await harness.fact("hold");
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...HANDLER });
    const request = { agentId: HANDLER.agentId, conversationId: HANDLER.conversationId, workspaceId: "voice-events", message: "work" };
    const first = await controller.call<string>({ method: "request", route: "handler", request });
    await settle(400);
    await controller.call(handlerEvent("mid", "keep mid", { whenIdle: "defer" }));
    await eventually(async () => (await harness.log()).some((entry) => entry.type === "handled" && entry.eventId === "mid"), "the mid-run event");
    await harness.fact("");
    assert.equal(await controller.call({ method: "wait", runId: first }), "completed");
    assert.equal((await harness.event("mid", HANDLER.conversationId, HANDLER.agentId))?.status, "pending");
    const second = await controller.call<string>({ method: "request", route: "handler", request });
    assert.equal(await controller.call({ method: "wait", runId: second }), "completed");
    const handled = (await harness.log()).filter((entry) => entry.type === "handled" && entry.eventId === "mid");
    assert.deepEqual(handled.map((entry) => entry.runId), [first, second]);
    await controller.call({ method: "stop" });
  });
});

const TEXTER = { definitionId: "texter", agentId: "agent_texter", conversationId: "conversation_texter" } as const;
const textEvent = (id: string) => ({
  method: "event", target: { agentId: TEXTER.agentId, conversationId: TEXTER.conversationId },
  event: { id, source: "mez:meetings", kind: "meeting.changed", content: `stale copy of ${id}` }, policy: { whenIdle: "wake" },
});

test("prepareEvent: a text turn sees current facts, never a suppressed event, and a failed preparation is retried later", { timeout: 120_000 }, async () => {
  await withHarness(async (harness) => {
    const controller = await harness.boot();
    await controller.call({ method: "setup", ...TEXTER });
    const status = async (id: string) => (await harness.event(id, TEXTER.conversationId, TEXTER.agentId))?.status;
    const said = async () => (await harness.transcript(TEXTER.conversationId)).map((item) => item.text).join("\n");

    await harness.fact("Fresh: the meeting is at 4pm.");
    await controller.call(textEvent("t1"));
    await eventually(async () => (await status("t1")) === "acknowledged", "t1");
    assert.match(await said(), /Fresh: the meeting is at 4pm\./);
    assert.doesNotMatch(await said(), /stale copy/);

    await harness.fact("cancelled");
    await controller.call(textEvent("t2"));
    await eventually(async () => (await status("t2")) === "acknowledged", "t2");
    assert.doesNotMatch(await said(), /t2/);

    await harness.fact("error");
    await controller.call(textEvent("t3"));
    await settle(800);
    assert.equal(await status("t3"), "pending", "withheld, not acknowledged");
    await harness.fact("Later: the meeting is at 6pm.");
    await eventually(async () => (await status("t3")) === "acknowledged", "the retry", 20_000);
    assert.match(await said(), /Later: the meeting is at 6pm\./);
    assert.doesNotMatch(await said(), /stale copy/);
    await controller.call({ method: "stop" });
  });
});
