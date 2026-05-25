import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContinuumRunner,
  MemoryAdapter,
  type AgentEventEnvelope,
  type ContinuumSubscriber,
} from "../src/index.js";
import { hangingAgent } from "./fixtures/hanging-agent.js";
import { meshConcurrent } from "./fixtures/mesh-agent.js";

const here = dirname(fileURLToPath(import.meta.url));
const hangingPath = resolve(here, "fixtures/hanging-agent.ts");
const meshPath = resolve(here, "fixtures/mesh-agent.ts");

interface Recorder {
  events: string[];
  agentEvents: AgentEventEnvelope[];
  subscriber: ContinuumSubscriber;
}

function recorder(): Recorder {
  const rec: Recorder = {
    events: [],
    agentEvents: [],
    subscriber: {
      onAgentDiscovered: (e) => rec.events.push(`discovered:${e.agentName}`),
      onAgentSpawned: (e) => rec.events.push(`spawned:${e.agentName}`),
      onAgentReady: (e) => rec.events.push(`ready:${e.agentName}`),
      onAgentTerminated: (e) =>
        rec.events.push(`terminated:${e.agentName}`),
      onRunDispatched: (e) => rec.events.push(`dispatched:${e.run.id}`),
      onRunStarted: (e) => rec.events.push(`started:${e.run.id}`),
      onRunCompleted: (e) => rec.events.push(`completed:${e.run.id}`),
      onRunTimeout: (e) => rec.events.push(`timeout:${e.run.id}`),
      onRunFailed: (e) => rec.events.push(`failed:${e.run.id}`),
      onRunRetry: (e) => rec.events.push(`retry:${e.run.id}`),
      onAgentEvent: (env) => rec.agentEvents.push(env),
    },
  };
  return rec;
}

test("triggered agent: hanging factory hits parent timeout, paired timeout+failed events fire", async () => {
  const rec = recorder();
  const adapter = new MemoryAdapter();
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [rec.subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(hangingAgent, hangingPath);

  const startPromise = runner.start();
  try {
    const runId = await hangingAgent.trigger({ noop: "x" });
    const final = await runner.waitForRun(runId, {
      timeoutMs: 15_000,
      pollMs: 50,
    });
    assert.ok(final, "hanging run should reach terminal state");
    assert.equal(final!.status, "failed", "hanging run failed");
    const timeouts = rec.events.filter((e) => e.startsWith("timeout:"));
    const failed = rec.events.filter((e) => e.startsWith("failed:"));
    assert.equal(timeouts.length, 1, "exactly one onRunTimeout");
    assert.equal(failed.length, 1, "exactly one onRunFailed");
    // dispatched + started + timeout + failed should all be present.
    assert.ok(rec.events.find((e) => e.startsWith("dispatched:")));
    // The factory hangs before it can send "run:started", so we don't assert
    // started here; the bracket symmetry we care about is timeout+failed.
  } finally {
    await runner.stop({ graceful: false, timeoutMs: 2_000 });
    await startPromise.catch(() => {});
  }
});

test("concurrent agent with glove-mesh mounted in factory: tools fold, factory completes, runner sees text_delta", async () => {
  const rec = recorder();
  const adapter = new MemoryAdapter();
  const runner = new ContinuumRunner({
    adapter,
    subscribers: [rec.subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(meshConcurrent, meshPath);

  const startPromise = runner.start();
  try {
    const readyDeadline = Date.now() + 15_000;
    while (Date.now() < readyDeadline) {
      if (rec.events.find((e) => e === "ready:mesh-concurrent")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      rec.events.find((e) => e === "ready:mesh-concurrent"),
      `mesh-concurrent should ready up; events: ${rec.events.join(", ")}`,
    );

    const runId = await runner.notify("mesh-concurrent", {
      phrase: "ping",
    });
    const final = await runner.waitForRun(runId, {
      timeoutMs: 15_000,
      pollMs: 50,
    });
    assert.equal(final!.status, "completed", "mesh-concurrent notify completed");
    assert.ok(final!.output && final!.output.includes("ping"));
    const textDelta = rec.agentEvents.find(
      (e) =>
        e.event_type === "text_delta" && e.agentName === "mesh-concurrent",
    );
    assert.ok(
      textDelta,
      "text_delta forwarded from mesh-mounted concurrent agent",
    );
  } finally {
    await runner.stop({ graceful: true, timeoutMs: 5_000 });
    await startPromise.catch(() => {});
  }
});
