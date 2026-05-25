import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContinuumRunner,
  MemoryAdapter,
  type AgentEventEnvelope,
  type ContinuumSubscriber,
  type Run,
} from "../src/index.js";
import { echoTriggered } from "./fixtures/triggered-agent.js";
import { echoConcurrent } from "./fixtures/concurrent-agent.js";

const here = dirname(fileURLToPath(import.meta.url));
const triggeredPath = resolve(here, "fixtures/triggered-agent.ts");
const concurrentPath = resolve(here, "fixtures/concurrent-agent.ts");

interface Recorder {
  events: string[];
  agentEvents: AgentEventEnvelope[];
  runs: Run[];
  subscriber: ContinuumSubscriber;
}

function recorder(): Recorder {
  const rec: Recorder = {
    events: [],
    agentEvents: [],
    runs: [],
    subscriber: {
      onAgentDiscovered: (e) =>
        rec.events.push(`discovered:${e.agentName}:${e.mode}`),
      onAgentSpawned: (e) =>
        rec.events.push(`spawned:${e.agentName}:${e.mode}`),
      onAgentReady: (e) => rec.events.push(`ready:${e.agentName}`),
      onAgentTerminated: (e) =>
        rec.events.push(`terminated:${e.agentName}:${e.reason}`),
      onRunDispatched: (e) => rec.events.push(`dispatched:${e.run.id}`),
      onRunStarted: (e) => rec.events.push(`started:${e.run.id}`),
      onRunCompleted: (e) => {
        rec.events.push(`completed:${e.run.id}`);
        rec.runs.push(e.run);
      },
      onRunFailed: (e) => {
        rec.events.push(`failed:${e.run.id}:${e.error ?? ""}`);
        rec.runs.push(e.run);
      },
      onRunTimeout: (e) => rec.events.push(`timeout:${e.run.id}`),
      onRunRetry: (e) =>
        rec.events.push(`retry:${e.run.id}:${e.attempt}/${e.maxAttempts}`),
      onNotifyDelivered: (e) =>
        rec.events.push(`notify-delivered:${e.run.id}`),
      onAgentEvent: (env) => rec.agentEvents.push(env),
    },
  };
  return rec;
}

test("triggered agent: discover → trigger → completed lifecycle", async () => {
  const rec = recorder();
  const adapter = new MemoryAdapter();
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [rec.subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(echoTriggered, triggeredPath);

  const startPromise = runner.start();
  try {
    const runId = await echoTriggered.trigger({ phrase: "hello continuum" });
    const final = await runner.waitForRun(runId, {
      timeoutMs: 30_000,
      pollMs: 50,
    });
    assert.ok(final, "triggered run should reach terminal state");
    assert.equal(final!.status, "completed", "triggered run completed");
    assert.ok(
      final!.output && final!.output.includes("hello continuum"),
      `output should contain the echoed phrase, got: ${final!.output}`,
    );
    assert.ok(
      rec.events.find((e) => e.startsWith("dispatched:")),
      "onRunDispatched fired",
    );
    assert.ok(
      rec.events.find((e) => e.startsWith("started:")),
      "onRunStarted fired",
    );
    assert.ok(
      rec.events.find((e) => e.startsWith("completed:")),
      "onRunCompleted fired",
    );
    const textDelta = rec.agentEvents.find(
      (e) => e.event_type === "text_delta",
    );
    assert.ok(
      textDelta,
      `text_delta envelope should have been forwarded; got ${rec.agentEvents.map((e) => e.event_type).join(",")}`,
    );
    assert.equal(textDelta!.agentName, "echo-triggered");
    assert.equal(textDelta!.mode, "triggered");
  } finally {
    await runner.stop({ graceful: true, timeoutMs: 5_000 });
    await startPromise.catch(() => {});
  }
});

test("concurrent agent: warm spawn → two notifies → completed each", async () => {
  const rec = recorder();
  const adapter = new MemoryAdapter();
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [rec.subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(echoConcurrent, concurrentPath);

  const startPromise = runner.start();
  try {
    // Allow warm spawn to land before first notify.
    const readyDeadline = Date.now() + 10_000;
    while (Date.now() < readyDeadline) {
      if (rec.events.find((e) => e === "ready:echo-concurrent")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      rec.events.find((e) => e === "ready:echo-concurrent"),
      `warm subprocess should signal ready; events so far: ${rec.events.join(", ")}`,
    );

    const a = await runner.notify("echo-concurrent", { phrase: "first" });
    const finalA = await runner.waitForRun(a, {
      timeoutMs: 30_000,
      pollMs: 50,
    });
    assert.equal(finalA!.status, "completed", "first notify completed");
    assert.ok(finalA!.output && finalA!.output.includes("first"));

    const b = await runner.notify("echo-concurrent", { phrase: "second" });
    const finalB = await runner.waitForRun(b, {
      timeoutMs: 30_000,
      pollMs: 50,
    });
    assert.equal(finalB!.status, "completed", "second notify completed");
    assert.ok(finalB!.output && finalB!.output.includes("second"));

    const deliveries = rec.events.filter((e) =>
      e.startsWith("notify-delivered:"),
    );
    assert.equal(deliveries.length, 2, "two notify-delivered events");
  } finally {
    await runner.stop({ graceful: true, timeoutMs: 5_000 });
    await startPromise.catch(() => {});
  }
});
