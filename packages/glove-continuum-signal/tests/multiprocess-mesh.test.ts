import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContinuumRunner,
  MemoryAdapter,
  type AgentEventEnvelope,
  type ContinuumSubscriber,
} from "../src/index.js";
import { meshListener } from "./fixtures/mesh-listener.js";
import { FilesystemMeshAdapter } from "./fixtures/fs-mesh-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const listenerPath = resolve(here, "fixtures/mesh-listener.ts");

interface PersistedListener {
  inbox: Array<{
    id: string;
    tag: string;
    request: string;
    response: string | null;
    status: string;
  }>;
}

test("multiprocess mesh: parent-process adapter sends → warm subagent's subprocess delivers to its inbox", async () => {
  const tmp = mkdtempSync(`${tmpdir()}/continuum-mesh-`);
  const meshRoot = `${tmp}/mesh`;
  const storePath = `${tmp}/listener-store.json`;

  // Both the agent subprocess AND the parent test process consume the same
  // env vars — the agent fixture's `.store(…)` reads `CONTINUUM_TEST_STORE_PATH`
  // and its factory reads `CONTINUUM_TEST_MESH_ROOT`. Set them on the parent
  // process so they get forwarded to the spawned subprocess.
  process.env.CONTINUUM_TEST_MESH_ROOT = meshRoot;
  process.env.CONTINUUM_TEST_STORE_PATH = storePath;

  const events: string[] = [];
  const agentEvents: AgentEventEnvelope[] = [];
  const subscriber: ContinuumSubscriber = {
    onAgentSpawned: (e) =>
      events.push(`spawned:${e.agentName}:${e.mode}`),
    onAgentReady: (e) => events.push(`ready:${e.agentName}`),
    onAgentTerminated: (e) =>
      events.push(`terminated:${e.agentName}:${e.reason}`),
    onRunDispatched: (e) => events.push(`dispatched:${e.run.id}`),
    onRunCompleted: (e) => events.push(`completed:${e.run.id}`),
    onRunFailed: (e) => events.push(`failed:${e.run.id}:${e.error ?? ""}`),
    onAgentEvent: (env) => agentEvents.push(env),
  };

  const runner = new ContinuumRunner({
    adapter: new MemoryAdapter(),
    subscribers: [subscriber],
    pollIntervalMs: 50,
  });
  runner.registerAgent(meshListener, listenerPath);

  const startPromise = runner.start();
  try {
    // Wait for the warm subprocess to ready up (factory mounts mesh inside).
    const readyDeadline = Date.now() + 15_000;
    while (Date.now() < readyDeadline) {
      if (events.find((e) => e === "ready:mesh-listener")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(
      events.find((e) => e === "ready:mesh-listener"),
      `mesh-listener should ready up; events: ${events.join(", ")}`,
    );

    // Now construct an adapter in the PARENT process pointing at the same
    // mesh root. The listener subprocess has its own adapter polling the
    // shared filesystem. Cross-subprocess delivery succeeds when a message
    // written by the parent's adapter lands in the subprocess-side store.
    const parentAdapter = new FilesystemMeshAdapter({
      root: meshRoot,
      agentId: "test-parent",
    });
    await parentAdapter.register({
      id: "test-parent",
      name: "Test Parent",
      description: "The parent process driving the test.",
    });

    const messageId = `parent-${Date.now()}`;
    await parentAdapter.send({
      id: messageId,
      from: "test-parent",
      to: "mesh-listener",
      content: "ping from parent process",
      created_at: new Date().toISOString(),
    });

    // Poll the listener's persisted store until the inbox shows the message,
    // or time out. The polling interval on the FS adapter is 100ms by
    // default; allow generous slack for FS + IPC + persistence.
    const deliverDeadline = Date.now() + 10_000;
    let delivered: PersistedListener | null = null;
    while (Date.now() < deliverDeadline) {
      try {
        const raw = readFileSync(storePath, "utf8");
        const parsed = JSON.parse(raw) as PersistedListener;
        if (parsed.inbox?.length) {
          delivered = parsed;
          break;
        }
      } catch {
        // store file not yet present; keep polling
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.ok(
      delivered && delivered.inbox.length >= 1,
      `mesh-listener should have at least 1 inbox item from cross-process mesh send; got ${JSON.stringify(delivered)}`,
    );
    const item = delivered!.inbox[0];
    // glove-mesh's buildInboxItemFromIncoming maps the mesh content onto the
    // InboxItem's `response` field (with `request` carrying a synthetic
    // "Message from X" descriptor). Either field signals delivery; check
    // the one that should literally contain the wire content.
    assert.ok(
      (item.response ?? "").includes("ping from parent process") ||
        item.request.includes("ping from parent process"),
      `inbox item should carry the original message content; got: ${JSON.stringify(item)}`,
    );
    // glove-mesh tags non-ack arrivals as "mesh:from:<peerName-or-id>"; just
    // check the sender id is in there somewhere.
    assert.ok(
      item.tag.includes("test-parent") || item.tag.includes("Test Parent"),
      `inbox item tag should reference the sender; got: ${item.tag}`,
    );

    // Sanity: the runner observed mesh tool registrations as ordinary tool
    // events when mountMesh folded its four tools. This isn't a delivery
    // proof; it's a "mesh is wired into the running subprocess" proof.
    // (Tool fold events aren't subscriber events, so we don't assert here —
    // delivery itself is the proof.)
  } finally {
    delete process.env.CONTINUUM_TEST_MESH_ROOT;
    delete process.env.CONTINUUM_TEST_STORE_PATH;
    await runner.stop({ graceful: true, timeoutMs: 5_000 });
    await startPromise.catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("multiprocess mesh: two parent-process adapters can see each other via listAgents", async () => {
  const tmp = mkdtempSync(`${tmpdir()}/continuum-mesh-list-`);
  try {
    const alpha = new FilesystemMeshAdapter({
      root: tmp,
      agentId: "alpha",
    });
    const beta = new FilesystemMeshAdapter({
      root: tmp,
      agentId: "beta",
    });
    await alpha.register({
      id: "alpha",
      name: "Alpha",
      description: "first",
    });
    await beta.register({ id: "beta", name: "Beta", description: "second" });

    const fromAlpha = await alpha.listAgents();
    const fromBeta = await beta.listAgents();
    const namesA = new Set(fromAlpha.map((a) => a.id));
    const namesB = new Set(fromBeta.map((a) => a.id));
    assert.ok(
      namesA.has("alpha") && namesA.has("beta"),
      `alpha sees both agents; got ${[...namesA].join(",")}`,
    );
    assert.ok(
      namesB.has("alpha") && namesB.has("beta"),
      `beta sees both agents; got ${[...namesB].join(",")}`,
    );

    await alpha.unregister();
    const afterUnreg = await beta.listAgents();
    const namesAfter = new Set(afterUnreg.map((a) => a.id));
    assert.ok(
      !namesAfter.has("alpha") && namesAfter.has("beta"),
      `alpha gone after unregister; got ${[...namesAfter].join(",")}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("multiprocess mesh: acknowledge() routes an ack back to the original sender's inbox", async () => {
  const tmp = mkdtempSync(`${tmpdir()}/continuum-mesh-ack-`);
  try {
    const sender = new FilesystemMeshAdapter({
      root: tmp,
      agentId: "sender",
    });
    const receiver = new FilesystemMeshAdapter({
      root: tmp,
      agentId: "receiver",
    });
    await sender.register({
      id: "sender",
      name: "Sender",
      description: "s",
    });
    await receiver.register({
      id: "receiver",
      name: "Receiver",
      description: "r",
    });

    const inbound: Array<{ kind: string; from: string; content: string }> = [];
    const unsubSender = sender.subscribe(async (msg) => {
      inbound.push({ kind: msg.kind, from: msg.from, content: msg.content });
    });
    const unsubReceiver = receiver.subscribe(async (msg) => {
      // Receiver auto-acks every direct message it gets.
      if (msg.kind === "direct") {
        await receiver.acknowledge(msg.id, "got it");
      }
    });

    const msgId = `m-${Date.now()}`;
    await sender.send({
      id: msgId,
      from: "sender",
      to: "receiver",
      content: "please ack",
      created_at: new Date().toISOString(),
    });

    // Poll until the sender sees the ack.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (inbound.find((m) => m.kind === "ack")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    unsubSender();
    unsubReceiver();

    const ack = inbound.find((m) => m.kind === "ack");
    assert.ok(ack, `sender should receive an ack envelope; got ${JSON.stringify(inbound)}`);
    assert.equal(ack!.from, "receiver", "ack came from the receiver");
    assert.ok(
      ack!.content === "got it" || ack!.content.includes("got it"),
      `ack should carry the note; got: ${ack!.content}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
