import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContinuumRunner,
  MemoryAdapter,
  type ContinuumSubscriber,
} from "../src/index.js";
import { meshSender, meshReceiver } from "./fixtures/mesh-pair.js";

const here = dirname(fileURLToPath(import.meta.url));
const pairPath = resolve(here, "fixtures/mesh-pair.ts");

interface PersistedReceiver {
  inbox: Array<{
    id: string;
    tag: string;
    request: string;
    response: string | null;
    status: string;
  }>;
}

test("agent-to-agent mesh: notify(sender) → sender's tool call → receiver's mesh subscribe → receiver's inbox", async () => {
  const tmp = mkdtempSync(`${tmpdir()}/continuum-mesh-pair-`);
  const meshRoot = `${tmp}/mesh`;
  const receiverStorePath = join(meshRoot, "stores", "mesh-receiver.json");

  process.env.CONTINUUM_TEST_MESH_ROOT = meshRoot;

  const events: string[] = [];
  const subscriber: ContinuumSubscriber = {
    onAgentReady: (e) => events.push(`ready:${e.agentName}`),
    onAgentTerminated: (e) =>
      events.push(`terminated:${e.agentName}:${e.reason}`),
    onRunCompleted: (e) =>
      events.push(`completed:${e.run.agentName}:${e.run.id}`),
    onRunFailed: (e) =>
      events.push(`failed:${e.run.agentName}:${e.run.id}:${e.error ?? ""}`),
  };

  const runner = new ContinuumRunner({
    adapter: new MemoryAdapter(),
    subscribers: [subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(meshSender, pairPath);
  runner.registerAgent(meshReceiver, pairPath);

  const startPromise = runner.start();
  try {
    // Wait for BOTH warm subprocesses to ready up. Each one's factory mounts
    // mesh and starts polling the shared filesystem network.
    const readyDeadline = Date.now() + 20_000;
    while (Date.now() < readyDeadline) {
      const haveSender = events.includes("ready:mesh-sender");
      const haveReceiver = events.includes("ready:mesh-receiver");
      if (haveSender && haveReceiver) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      events.includes("ready:mesh-sender"),
      `mesh-sender should ready up; events: ${events.join(", ")}`,
    );
    assert.ok(
      events.includes("ready:mesh-receiver"),
      `mesh-receiver should ready up; events: ${events.join(", ")}`,
    );

    // Drive the sender to dispatch a mesh message. The sender's model parses
    // the prompt JSON, emits glove_mesh_send_message, the executor runs the
    // mesh tool, which writes through the FilesystemMeshAdapter to disk.
    // The receiver's subscribe loop (polling its inbox dir at 100ms) picks
    // it up and writes to its persistent store.
    const phrase = "agent-to-agent ping over filesystem mesh";
    const runId = await runner.notify("mesh-sender", {
      to: "mesh-receiver",
      content: phrase,
    });
    const finalSend = await runner.waitForRun(runId, {
      timeoutMs: 20_000,
      pollMs: 50,
    });
    assert.equal(
      finalSend?.status,
      "completed",
      `sender notify should complete (status ${finalSend?.status}, events: ${events.join(", ")})`,
    );

    // Now poll the receiver's persisted store until the inbox shows the
    // delivered message. The store flushes synchronously per addInboxItem,
    // so this should land within one or two FS-adapter poll intervals.
    const deliverDeadline = Date.now() + 10_000;
    let delivered: PersistedReceiver | null = null;
    while (Date.now() < deliverDeadline) {
      if (existsSync(receiverStorePath)) {
        try {
          const raw = readFileSync(receiverStorePath, "utf8");
          const parsed = JSON.parse(raw) as PersistedReceiver;
          if (parsed.inbox?.length) {
            delivered = parsed;
            break;
          }
        } catch {
          // half-write; keep polling
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(
      delivered && delivered.inbox.length >= 1,
      `mesh-receiver should have at least 1 inbox item from agent-to-agent send; got ${JSON.stringify(delivered)}`,
    );
    const item = delivered!.inbox[0];
    // glove-mesh stores wire content on `response`; either field is acceptable.
    const carriesContent =
      (item.response ?? "").includes(phrase) ||
      item.request.includes(phrase);
    assert.ok(
      carriesContent,
      `inbox item should carry the original content; got ${JSON.stringify(item)}`,
    );
    // The sender id should be present in the tag.
    assert.ok(
      item.tag.includes("mesh-sender"),
      `inbox tag should reference the sender; got: ${item.tag}`,
    );
  } finally {
    delete process.env.CONTINUUM_TEST_MESH_ROOT;
    await runner.stop({ graceful: true, timeoutMs: 5_000 });
    await startPromise.catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
});
