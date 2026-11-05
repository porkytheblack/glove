/**
 * Schedule occurrences survive a crash anywhere between coming due and their
 * run finishing. Each scenario runs a real controller, execution daemon and
 * child runs in their own process group, SIGKILLs the group at a checkpoint
 * with no cleanup, and restarts against the same data file through a fresh
 * adapter.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Effect } from "effect";
import { nextCronOccurrence } from "station-schedules";
import { defineApplication } from "../src/application.js";
import { createFoundryClient } from "../src/client.js";
import type { FoundryCoreCommand } from "../src/core-tools.js";
import { FileFoundryDataAdapter } from "../src/file-data.js";
import { FoundryRuntime } from "../src/runtime.js";
import { FoundryServer } from "../src/server.js";
import {
  MemoryFoundryDataAdapter,
  createAgentInstance,
  createConversation,
  type FoundryActivationRecord,
} from "../src/primitives.js";
import {
  activationScheduleRevision,
  planScheduleOccurrence,
  scheduleOccurrenceId,
  type FoundryScheduleOccurrence,
} from "../src/schedule-occurrences.js";
import { normalizeScheduleTiming, type FoundryScheduleTiming } from "../src/schedule.js";

const here = dirname(fileURLToPath(import.meta.url));
const controller = resolve(here, "fixtures/schedule-crash/controller.ts");
const tsx = import.meta.resolve("tsx");
const DAY = 24 * 60 * 60_000;

interface Reminder { readonly activationId: string; readonly occurrenceId: string; readonly scheduledFor: string; readonly runId: string }

interface Harness {
  readonly file: string;
  readonly seed: (timing: FoundryScheduleTiming, nextOccurrenceAt: string) => Promise<FoundryActivationRecord>;
  /** Start a controller; with a checkpoint, resolves once it has killed its process group. */
  readonly boot: (crashAt?: string) => Promise<Controller>;
  readonly reminders: () => Promise<Reminder[]>;
  /** A fresh adapter each time, as a restarted host would have. */
  readonly data: () => FileFoundryDataAdapter;
  readonly occurrences: () => Promise<ReadonlyArray<FoundryScheduleOccurrence>>;
  readonly activation: () => Promise<FoundryActivationRecord | null>;
}

interface Controller {
  /** SIGKILL the controller's process group: controller, daemon and runs, no cleanup. */
  readonly kill: () => Promise<void>;
}

const ACTIVATION_ID = "activation_reminder";

async function withHarness(work: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-schedule-recovery-"));
  const file = join(directory, "foundry.json");
  const log = join(directory, "reminders.jsonl");
  const live: ChildProcess[] = [];
  const data = () => new FileFoundryDataAdapter({ file });
  const exited = (child: ChildProcess) => new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) resolveExit();
    else child.once("exit", () => resolveExit());
  });
  const killGroup = async (child: ChildProcess) => {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
    await exited(child);
  };
  try {
    await work({
      file,
      data,
      seed: async (timing, nextOccurrenceAt) => {
        const adapter = data();
        const agent = createAgentInstance("reminder", { id: "agent_reminder", workspaceId: "workspace_reminder" });
        const conversation = createConversation(agent, { id: "conversation_reminder", workspaceId: agent.workspaceId });
        await Effect.runPromise(adapter.putAgent(agent));
        await Effect.runPromise(adapter.putConversation(conversation));
        const now = new Date().toISOString();
        const base = {
          id: ACTIVATION_ID,
          kind: "scheduled" as const,
          definitionId: "reminder",
          agentId: agent.id,
          conversationId: conversation.id,
          workspaceId: agent.workspaceId,
          message: "Send the daily reminder.",
          timing,
          origin: "agent-tool" as const,
          status: "active" as const,
          createdByRunId: "run_setup",
          createdAt: now,
          updatedAt: now,
        };
        const activation: FoundryActivationRecord = {
          ...base, scheduleRevision: activationScheduleRevision(base), nextOccurrenceAt,
        };
        await Effect.runPromise(adapter.putActivation(activation));
        return activation;
      },
      boot: async (crashAt) => {
        const child = spawn(process.execPath, ["--import", tsx, controller], {
          detached: true,
          stdio: ["ignore", "pipe", "inherit", "ipc"],
          env: {
            ...process.env,
            FOUNDRY_SCHEDULE_DATA: file,
            FOUNDRY_SCHEDULE_REMINDER_LOG: log,
            FOUNDRY_SCHEDULE_CRASH_AT: crashAt ?? "",
          },
        });
        live.push(child);
        let output = "";
        child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
        const deadline = Date.now() + 60_000;
        if (crashAt) {
          await Promise.race([exited(child), new Promise((resolveWait) => setTimeout(resolveWait, 60_000))]);
          if (child.exitCode === null && child.signalCode === null) {
            await killGroup(child);
            assert.fail(`controller never reached checkpoint ${crashAt}`);
          }
          assert.match(output, new RegExp(`"crashed":"${crashAt}"`), `controller exited without crashing at ${crashAt}`);
          // The daemon and runs were in the same group; give the kernel a moment to reap them.
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        } else {
          while (!output.includes('"started":true')) {
            assert.ok(child.exitCode === null && child.signalCode === null, "controller exited during startup");
            assert.ok(Date.now() < deadline, "controller did not start");
            await new Promise((resolveWait) => setTimeout(resolveWait, 25));
          }
        }
        return { kill: () => killGroup(child) };
      },
      reminders: async () => (await readFile(log, "utf8").catch(() => ""))
        .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Reminder),
      occurrences: () => Effect.runPromise(data().listScheduleOccurrences({ activationId: ACTIVATION_ID })),
      activation: () => Effect.runPromise(data().getActivation(ACTIVATION_ID)),
    });
  } finally {
    for (const child of live) await killGroup(child);
    await rm(directory, { recursive: true, force: true });
  }
}

async function eventually<T>(read: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value as T;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

const settle = (ms = 1_500) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

/**
 * A daily 09:00 Africa/Nairobi reminder whose next local 09:00 is about
 * twelve hours away, so no further occurrence comes due during a test, and
 * whose cursor is two days in the past: the occurrence it owes is overdue.
 */
function dailyNairobi(misfire?: "fire-once" | "skip" | "catch-up") {
  const nairobiHour = (new Date().getUTCHours() + 12 + 3) % 24;
  const timing = normalizeScheduleTiming({
    kind: "cron", expression: `0 ${nairobiHour} * * *`, timezone: "Africa/Nairobi", ...(misfire ? { misfire } : {}),
  });
  const owed = nextCronOccurrence(`0 ${nairobiHour} * * *`, "Africa/Nairobi", new Date(Date.now() - 3 * DAY));
  return { timing, owed: owed.toISOString() };
}

async function completedOccurrence(harness: Harness): Promise<FoundryScheduleOccurrence> {
  return eventually(async () => (await harness.occurrences()).find((item) => item.status === "completed"), "a completed occurrence");
}

test("S01: a delivered occurrence keeps its identity, time and single reminder across SIGKILL restarts", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    const { timing, owed } = dailyNairobi();
    await harness.seed(timing, owed);
    const first = await harness.boot();
    const delivered = await completedOccurrence(harness);
    assert.equal((await harness.reminders()).length, 1);
    await first.kill();

    for (let restart = 0; restart < 2; restart++) {
      const again = await harness.boot();
      await settle();
      const occurrences = await harness.occurrences();
      assert.equal(occurrences.length, 1, "a restart must not create another occurrence");
      assert.equal(occurrences[0]!.id, delivered.id);
      assert.equal(occurrences[0]!.scheduledFor, owed);
      assert.equal(occurrences[0]!.status, "completed");
      assert.equal(occurrences[0]!.runId, delivered.runId);
      const reminders = await harness.reminders();
      assert.equal(reminders.length, 1, "exactly one public reminder");
      assert.equal(reminders[0]!.occurrenceId, delivered.id);
      assert.equal(reminders[0]!.scheduledFor, owed);
      await again.kill();
    }
    const activation = await harness.activation();
    assert.ok(Date.parse(activation!.nextOccurrenceAt!) > Date.now(), "the cursor is past the delivered occurrence");
  });
});

test("S02: an occurrence claimed and advanced past before handoff is delivered after SIGKILL", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    const { timing, owed } = dailyNairobi();
    await harness.seed(timing, owed);
    await harness.boot("after-advance");

    const [claimed] = await harness.occurrences();
    assert.equal(claimed?.status, "pending", "the obligation is stored before the cursor moves");
    assert.equal(claimed?.scheduledFor, owed);
    assert.ok(Date.parse((await harness.activation())!.nextOccurrenceAt!) > Date.now(), "the cursor moved past it");
    assert.equal((await harness.reminders()).length, 0);

    const restarted = await harness.boot();
    const delivered = await completedOccurrence(harness);
    assert.equal(delivered.id, claimed!.id);
    assert.equal(delivered.scheduledFor, owed);
    assert.equal(delivered.attempts, 1);
    const reminders = await harness.reminders();
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0]!.occurrenceId, claimed!.id);
    assert.equal((await harness.occurrences()).length, 1);
    await restarted.kill();
  });
});

// [checkpoint, reminders the crashed process can have sent before dying]
const checkpoints: ReadonlyArray<readonly [string, ReadonlyArray<number>]> = [
  ["before-claim", [1]],
  ["after-claim", [1]],
  ["after-advance", [1]],
  // The run was enqueued; it may have started before the kill reached it.
  ["before-receipt", [1, 2]],
  ["after-receipt", [1, 2]],
  // The run finished (reminder sent) but its outcome was not stored: delivery is at least once.
  ["before-ack", [2]],
  ["after-ack", [1]],
];

for (const [checkpoint, expected] of checkpoints) {
  test(`a crash ${checkpoint} keeps one occurrence identity and delivers it`, { timeout: 180_000 }, async () => {
    await withHarness(async (harness) => {
      const { timing, owed } = dailyNairobi();
      await harness.seed(timing, owed);
      await harness.boot(checkpoint);
      if (checkpoint === "before-claim") {
        assert.equal((await harness.occurrences()).length, 0);
        assert.equal((await harness.activation())!.nextOccurrenceAt, owed, "the cursor did not move");
      }

      const restarted = await harness.boot();
      const delivered = await completedOccurrence(harness);
      await settle(500);
      await restarted.kill();
      // And once more: a settled occurrence is never delivered again.
      const last = await harness.boot();
      await settle();
      await last.kill();

      const occurrences = await harness.occurrences();
      assert.equal(occurrences.length, 1);
      assert.equal(occurrences[0]!.id, delivered.id);
      assert.equal(occurrences[0]!.id, scheduleOccurrenceId(ACTIVATION_ID, delivered.revision, owed));
      assert.equal(occurrences[0]!.scheduledFor, owed);
      assert.equal(occurrences[0]!.status, "completed");
      const reminders = await harness.reminders();
      assert.ok(expected.includes(reminders.length), `${reminders.length} reminders after ${checkpoint}`);
      assert.ok(reminders.every((item) => item.occurrenceId === delivered.id && item.scheduledFor === owed),
        "every retry carries the same occurrence identity");
      // Recorded handoffs: a second only when the first was recorded and its outcome was not.
      assert.equal(occurrences[0]!.attempts, checkpoint === "after-receipt" || checkpoint === "before-ack" ? 2 : 1);
    });
  });
}

test("S04: a cancellation committed before the restart stops a claimed occurrence from firing", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    const { timing, owed } = dailyNairobi();
    await harness.seed(timing, owed);
    await harness.boot("after-advance");
    const activation = (await harness.activation())!;
    await Effect.runPromise(harness.data().putActivation({ ...activation, status: "cancelled", updatedAt: new Date().toISOString() }));

    const restarted = await harness.boot();
    await settle();
    await restarted.kill();
    const [occurrence] = await harness.occurrences();
    assert.equal(occurrence?.status, "cancelled");
    assert.equal(occurrence?.reason, "cancelled");
    assert.equal((await harness.reminders()).length, 0);
    assert.equal((await harness.activation())?.status, "cancelled");
  });
});

test("a schedule changed before the restart supersedes its claimed occurrence", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    const { timing, owed } = dailyNairobi();
    await harness.seed(timing, owed);
    await harness.boot("after-advance");
    const activation = (await harness.activation())!;
    await Effect.runPromise(harness.data().putActivation({ ...activation, message: "Send the new reminder.", updatedAt: new Date().toISOString() }));

    const restarted = await harness.boot();
    await settle();
    await restarted.kill();
    const [occurrence] = await harness.occurrences();
    assert.equal(occurrence?.status, "cancelled");
    assert.equal(occurrence?.reason, "superseded");
    assert.equal((await harness.reminders()).length, 0);
    const changed = (await harness.activation())!;
    assert.notEqual(changed.scheduleRevision, occurrence?.revision);
    assert.ok(Date.parse(changed.nextOccurrenceAt!) > Date.now());
  });
});

test("misfire policies after downtime: skip records the miss, catch-up delivers each in order", { timeout: 180_000 }, async () => {
  await withHarness(async (harness) => {
    const { timing, owed } = dailyNairobi("skip");
    await harness.seed(timing, owed);
    const running = await harness.boot();
    const [skipped] = await eventually(async () => {
      const items = await harness.occurrences();
      return items.length ? items : undefined;
    }, "a skipped occurrence");
    await running.kill();
    assert.equal(skipped?.status, "skipped");
    assert.equal(skipped?.reason, "misfire");
    assert.equal(skipped?.scheduledFor, owed);
    assert.equal((await harness.reminders()).length, 0);
  });
  await withHarness(async (harness) => {
    const now = Date.now();
    const timing = normalizeScheduleTiming({ kind: "every", interval: "1h", misfire: "catch-up" });
    const owed = new Date(now - 150 * 60_000).toISOString();
    await harness.seed(timing, owed);
    const running = await harness.boot();
    const delivered = await eventually(async () => {
      const items = await harness.occurrences();
      return items.filter((item) => item.status === "completed").length === 3 ? items : undefined;
    }, "three caught-up occurrences");
    await running.kill();
    assert.deepEqual(delivered.map((item) => item.scheduledFor), [0, 1, 2].map((hours) =>
      new Date(Date.parse(owed) + hours * 3_600_000).toISOString()));
    assert.equal(new Set((await harness.reminders()).map((item) => item.occurrenceId)).size, 3);
  });
});

test("concurrent claims of one occurrence store one obligation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glove-foundry-occurrence-claims-"));
  try {
    const occurrence: FoundryScheduleOccurrence = {
      id: scheduleOccurrenceId("activation_race", "revision", "2026-11-03T06:00:00.000Z"),
      activationId: "activation_race",
      revision: "revision",
      scheduledFor: "2026-11-03T06:00:00.000Z",
      definitionId: "reminder",
      agentId: "agent",
      conversationId: "conversation",
      workspaceId: "workspace",
      request: { agentId: "agent", conversationId: "conversation", workspaceId: "workspace", message: "Remind." },
      status: "pending",
      attempts: 0,
      createdAt: "2026-11-03T06:00:00.000Z",
      updatedAt: "2026-11-03T06:00:00.000Z",
    };
    const file = join(directory, "foundry.json");
    const claims = await Promise.all(Array.from({ length: 8 }, () =>
      Effect.runPromise(new FileFoundryDataAdapter({ file }).claimScheduleOccurrence(occurrence))));
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await Effect.runPromise(new FileFoundryDataAdapter({ file }).listScheduleOccurrences())).length, 1);

    const memory = new MemoryFoundryDataAdapter();
    const memoryClaims = await Promise.all(Array.from({ length: 8 }, () =>
      Effect.runPromise(memory.claimScheduleOccurrence(occurrence))));
    assert.equal(memoryClaims.filter(Boolean).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("occurrence identity depends only on activation, schedule revision and scheduled instant", () => {
  const base = {
    definitionId: "reminder", agentId: "agent", conversationId: "conversation",
    message: "Remind.", timing: normalizeScheduleTiming({ kind: "cron", expression: "0 9 * * *", timezone: "Africa/Nairobi" }),
  };
  const revision = activationScheduleRevision(base);
  // Status, cursor and timestamps are not schedule configuration.
  assert.equal(activationScheduleRevision({ ...base, status: "paused", updatedAt: "later", nextOccurrenceAt: "x" } as never), revision);
  assert.notEqual(activationScheduleRevision({ ...base, message: "Remind again." }), revision);
  assert.equal(
    scheduleOccurrenceId("activation", revision, "2026-11-03T06:00:00Z"),
    scheduleOccurrenceId("activation", revision, "2026-11-03T09:00:00+03:00"),
  );
  assert.notEqual(
    scheduleOccurrenceId("activation", revision, "2026-11-03T06:00:00Z"),
    scheduleOccurrenceId("activation", "other", "2026-11-03T06:00:00Z"),
  );
});

test("late recovery reports the original Nairobi occurrence under each misfire policy", () => {
  const owed = new Date("2026-11-03T06:00:00.000Z"); // 09:00 in Nairobi
  const now = new Date("2026-11-05T07:00:00.000Z");
  const daily = (misfire?: "fire-once" | "skip" | "catch-up") => normalizeScheduleTiming({
    kind: "cron", expression: "0 9 * * *", timezone: "Africa/Nairobi", ...(misfire ? { misfire } : {}),
  });
  assert.deepEqual(planScheduleOccurrence(daily(), owed, now),
    { deliver: true, next: new Date("2026-11-06T06:00:00.000Z"), coalesced: 2 });
  assert.deepEqual(planScheduleOccurrence(daily("catch-up"), owed, now),
    { deliver: true, next: new Date("2026-11-04T06:00:00.000Z"), coalesced: 0 });
  assert.deepEqual(planScheduleOccurrence(daily("skip"), owed, now),
    { deliver: false, next: new Date("2026-11-06T06:00:00.000Z"), coalesced: 0 });
  // On time, within the minute of grace, skip still delivers.
  assert.equal(planScheduleOccurrence(daily("skip"), owed, new Date("2026-11-03T06:00:30.000Z")).deliver, true);
});

test("DST boundaries: a missing local time is skipped and a repeated one is two occurrences", () => {
  const plan = (expression: string, from: string) =>
    planScheduleOccurrence(normalizeScheduleTiming({ kind: "cron", expression, timezone: "America/New_York" }), new Date(from), new Date(from));
  // 02:30 does not exist on 8 March 2026 in New York.
  assert.equal(plan("30 2 * * *", "2026-03-07T07:30:00.000Z").next?.toISOString(), "2026-03-09T06:30:00.000Z");
  // 01:30 happens twice on 1 November 2026: EDT, then EST.
  const first = plan("30 1 * * *", "2026-10-31T05:30:00.000Z").next!;
  assert.equal(first.toISOString(), "2026-11-01T05:30:00.000Z");
  const second = plan("30 1 * * *", first.toISOString()).next!;
  assert.equal(second.toISOString(), "2026-11-01T06:30:00.000Z");
  assert.notEqual(scheduleOccurrenceId("a", "r", first.toISOString()), scheduleOccurrenceId("a", "r", second.toISOString()));
});

test("the client lists occurrences and each run receives its occurrence identity", { timeout: 60_000 }, async () => {
  const data = new MemoryFoundryDataAdapter();
  const runtime = await FoundryRuntime.discover({
    rootDir: resolve(here, "fixtures"),
    agentsDir: resolve(here, "fixtures/agents"),
    application: defineApplication({ name: "occurrence-api", data }),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  const server = new FoundryServer(runtime, { host: "127.0.0.1", port: 0 });
  const { url } = await server.listen();
  try {
    const agent = await runtime.createAgent("assistant", { id: "occurrence-agent", workspaceId: "occurrence-api" });
    const conversation = await runtime.createConversation(agent.id, { id: "occurrence-conversation" });
    const command: FoundryCoreCommand = {
      id: "activation_occurrence_api", type: "schedule", definitionId: "assistant", agentId: agent.id,
      conversationId: conversation.id, workspaceId: agent.workspaceId, message: "Tick.",
      timing: { kind: "every", intervalMs: 300 },
    };
    await (runtime as unknown as {
      executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
    }).executeCoreCommand(command, "parent-occurrence-api");
    const client = createFoundryClient({ baseUrl: url });
    const completed = await eventually(async () => {
      const items = await client.scheduleOccurrences({ activationId: command.id, status: "completed" });
      return items.length >= 2 ? items : undefined;
    }, "two completed occurrences");
    assert.equal(new Set(completed.map((item) => item.id)).size, completed.length);
    assert.ok(completed.every((item, index) => index === 0 || item.scheduledFor > completed[index - 1]!.scheduledFor));
    for (const occurrence of completed) {
      const run = await runtime.getRun(occurrence.runId!);
      const source = (run?.input as { source?: { id?: string; occurrenceId?: string; scheduledFor?: string } }).source;
      assert.deepEqual(source, { kind: "activation", id: command.id, occurrenceId: occurrence.id, scheduledFor: occurrence.scheduledFor });
    }
    assert.equal((await client.scheduleOccurrences({ workspaceId: "elsewhere" })).length, 0);
    assert.equal((await runtime.listActivations(agent.workspaceId))[0]?.lastRunId !== undefined, true);
  } finally {
    await server.close();
    await runtime.stop();
  }
});

test("pausing a recurring schedule mid-handoff lets that run finish, fires nothing more, and resume starts from now", { timeout: 60_000 }, async () => {
  const runtime = await FoundryRuntime.discover({
    rootDir: resolve(here, "fixtures"),
    agentsDir: resolve(here, "fixtures/agents"),
    config: { execution: { pollIntervalMs: 10, idlePollIntervalMs: 10 } },
  });
  await runtime.start();
  const internals = runtime as unknown as {
    enqueueCoreRequest(...args: unknown[]): Promise<string>;
    executeCoreCommand(command: FoundryCoreCommand, parentRunId: string): Promise<void>;
  };
  const enqueue = internals.enqueueCoreRequest.bind(runtime);
  let release!: () => void;
  const held = new Promise<void>((resolveHold) => { release = resolveHold; });
  let entered!: () => void;
  const handing = new Promise<void>((resolveEntered) => { entered = resolveEntered; });
  let calls = 0;
  internals.enqueueCoreRequest = async (...args) => {
    const runId = await enqueue(...args);
    if (calls++ === 0) { entered(); await held; }
    return runId;
  };
  try {
    const agent = await runtime.createAgent("assistant", { id: "pause-race-agent", workspaceId: "pause-race" });
    const conversation = await runtime.createConversation(agent.id, { id: "pause-race-conversation" });
    const target = { definitionId: "assistant", agentId: agent.id, conversationId: conversation.id, workspaceId: agent.workspaceId };
    const id = "activation_pause_race";
    await internals.executeCoreCommand({ id, type: "schedule", ...target, message: "Tick.", timing: { kind: "every", intervalMs: 200 } }, "parent");
    await handing;
    const paused = internals.executeCoreCommand({ id: "pause_race", type: "schedule.pause", ...target, activationId: id }, "parent");
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    release();
    await paused;
    await eventually(async () => (await runtime.listScheduleOccurrences({ activationId: id, status: "completed" })).length === 1, "the in-flight occurrence to finish");
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const whilePaused = await runtime.listScheduleOccurrences({ activationId: id });
    assert.equal(whilePaused.length, 1, "nothing fires while paused");
    assert.equal((await runtime.listActivations(agent.workspaceId)).find((item) => item.id === id)?.status, "paused");

    const resumedAt = new Date().toISOString();
    await internals.executeCoreCommand({ id: "resume_race", type: "schedule.resume", ...target, activationId: id }, "parent");
    const next = await eventually(async () =>
      (await runtime.listScheduleOccurrences({ activationId: id })).find((item) => item.id !== whilePaused[0]!.id), "an occurrence after resume");
    assert.ok(next.scheduledFor > resumedAt, "resume does not deliver occurrences from inside the pause");
    await internals.executeCoreCommand({ id: "cancel_race", type: "schedule.cancel", ...target, activationId: id }, "parent");
  } finally {
    release();
    await runtime.stop();
  }
});
