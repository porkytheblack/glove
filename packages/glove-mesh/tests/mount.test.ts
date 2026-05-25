import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, type GloveFoldArgs, type StoreAdapter } from "glove-core";
import {
  InMemoryMeshAdapter,
  MeshNetwork,
  MeshStoreUnsupportedError,
  mountMesh,
  type AgentIdentity,
} from "../src";

const STUB_DISPLAY = {} as any;
const STUB_GLOVE = {} as any;

const ID_A: AgentIdentity = { id: "a", name: "Agent A", description: "first" };
const ID_B: AgentIdentity = { id: "b", name: "Agent B", description: "second" };

interface RecorderTarget {
  folded: GloveFoldArgs<unknown>[];
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  readonly store: StoreAdapter;
}

function makeFoldTarget(store: StoreAdapter): RecorderTarget {
  const folded: GloveFoldArgs<unknown>[] = [];
  const target: RecorderTarget = {
    folded,
    fold: <I>(args: GloveFoldArgs<I>) => {
      folded.push(args as GloveFoldArgs<unknown>);
      return target;
    },
    store,
  };
  return target;
}

function findTool(folded: GloveFoldArgs<unknown>[], name: string): GloveFoldArgs<unknown> {
  const t = folded.find((t) => t.name === name);
  if (!t) throw new Error(`tool not folded: ${name}`);
  return t;
}

async function callTool<I>(
  folded: GloveFoldArgs<unknown>[],
  name: string,
  input: I,
) {
  const t = findTool(folded, name);
  return await t.do(input, STUB_DISPLAY, STUB_GLOVE);
}

describe("mountMesh — store capability gate", () => {
  it("throws MeshStoreUnsupportedError when the store lacks inbox methods", async () => {
    const net = new MeshNetwork();
    const adapter = new InMemoryMeshAdapter(net, "a");
    const halfStore: StoreAdapter = {
      identifier: "stub",
      getMessages: async () => [],
      appendMessages: async () => {},
      getTokenCount: async () => 0,
      addTokens: async () => {},
      getTurnCount: async () => 0,
      incrementTurn: async () => {},
      resetCounters: async () => {},
    };
    const target = makeFoldTarget(halfStore);
    await assert.rejects(
      () => mountMesh(target, { adapter, identity: ID_A }),
      (err: unknown) => err instanceof MeshStoreUnsupportedError,
    );
  });
});

describe("mountMesh — tool folding", () => {
  it("folds all four mesh tools and registers the identity", async () => {
    const net = new MeshNetwork();
    const adapter = new InMemoryMeshAdapter(net, "a");
    const store = new MemoryStore("a");
    const target = makeFoldTarget(store);

    await mountMesh(target, { adapter, identity: ID_A });

    const names = target.folded.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "glove_mesh_acknowledge",
      "glove_mesh_broadcast",
      "glove_mesh_list_agents",
      "glove_mesh_send_message",
    ]);
    assert.deepEqual(net.getAgent("a"), ID_A);
  });
});

describe("mountMesh — inbound direct message", () => {
  it("inserts a resolved inbox item tagged mesh:from:<sender>", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");
    const targetA = makeFoldTarget(storeA);
    const targetB = makeFoldTarget(storeB);

    await mountMesh(targetA, { adapter: new InMemoryMeshAdapter(net, "a"), identity: ID_A });
    await mountMesh(targetB, { adapter: new InMemoryMeshAdapter(net, "b"), identity: ID_B });

    const result = await callTool(targetA.folded, "glove_mesh_send_message", {
      to: "b",
      content: "hi there",
      blocking: false,
    });
    assert.equal((result as { status: string }).status, "success");

    const itemsB = await storeB.getInboxItems!();
    assert.equal(itemsB.length, 1);
    assert.equal(itemsB[0]!.status, "resolved");
    assert.equal(itemsB[0]!.tag, "mesh:from:a");
    assert.equal(itemsB[0]!.response, "hi there");
    assert.match(itemsB[0]!.request, /Message from "Agent A" \(a\)/);
  });

  it("tags broadcasts with mesh:broadcast:from:<sender>", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");

    await mountMesh(makeFoldTarget(storeA), {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
    });
    const targetB = makeFoldTarget(storeB);
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
    });

    const result = await callTool(targetB.folded, "glove_mesh_broadcast", {
      content: "team-wide ping",
      blocking: false,
    });
    assert.equal((result as { status: string }).status, "success");

    const itemsA = await storeA.getInboxItems!();
    const broadcast = itemsA.find((i) => i.tag.startsWith("mesh:broadcast:"));
    assert.ok(broadcast, "expected broadcast item in A's inbox");
    assert.equal(broadcast.tag, "mesh:broadcast:from:b");
    assert.equal(broadcast.response, "team-wide ping");
    assert.equal(broadcast.status, "resolved");
  });
});

describe("mountMesh — blocking send + ack round-trip", () => {
  it("inserts pending blocking item; ack resolves it with the ack note", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");
    const targetA = makeFoldTarget(storeA);
    const targetB = makeFoldTarget(storeB);
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
    });
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
    });

    const sendResult = await callTool(targetA.folded, "glove_mesh_send_message", {
      to: "b",
      content: "please confirm",
      blocking: true,
    });
    const sendData = (sendResult as { data: { message_id: string; blocking: boolean } })
      .data;
    assert.equal(sendData.blocking, true);
    const msgId = sendData.message_id;

    // A now has a pending blocking item.
    const aPending = (await storeA.getInboxItems!()).filter((i) => i.status === "pending");
    assert.equal(aPending.length, 1);
    assert.equal(aPending[0]!.tag, `mesh:waiting:${msgId}`);
    assert.equal(aPending[0]!.blocking, true);

    // B sees the incoming message; B acks it.
    const ackResult = await callTool(targetB.folded, "glove_mesh_acknowledge", {
      message_id: msgId,
      note: "received",
    });
    assert.equal((ackResult as { status: string }).status, "success");

    // A's pending item is now resolved.
    const aItems = await storeA.getInboxItems!();
    const previouslyPending = aItems.find((i) => i.tag === `mesh:waiting:${msgId}`);
    assert.ok(previouslyPending);
    assert.equal(previouslyPending.status, "resolved");
    assert.equal(previouslyPending.response, "received");
  });
});

describe("mountMesh — reply implies ack", () => {
  it("a direct reply with in_reply_to resolves the original blocking send AND surfaces a new resolved item", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");
    const targetA = makeFoldTarget(storeA);
    const targetB = makeFoldTarget(storeB);
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
    });
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
    });

    const sendResult = await callTool(targetA.folded, "glove_mesh_send_message", {
      to: "b",
      content: "what's the status?",
      blocking: true,
    });
    const msgId = (sendResult as { data: { message_id: string } }).data.message_id;

    // B replies via glove_mesh_send_message with in_reply_to.
    const replyResult = await callTool(targetB.folded, "glove_mesh_send_message", {
      to: "a",
      content: "all good",
      in_reply_to: msgId,
      blocking: false,
    });
    assert.equal((replyResult as { status: string }).status, "success");

    // A's pending item is resolved AND there's a new resolved item with the reply body.
    const aItems = await storeA.getInboxItems!();
    const resolvedWaiting = aItems.find((i) => i.tag === `mesh:waiting:${msgId}`);
    assert.ok(resolvedWaiting);
    assert.equal(resolvedWaiting.status, "resolved");
    assert.equal(resolvedWaiting.response, "all good");

    const newReplyItem = aItems.find((i) => i.tag === "mesh:from:b");
    assert.ok(newReplyItem);
    assert.equal(newReplyItem.status, "resolved");
    assert.equal(newReplyItem.response, "all good");
  });
});

describe("mountMesh — glove_mesh_list_agents", () => {
  it("returns peers excluding self, with capability and name filtering", async () => {
    const net = new MeshNetwork();
    const targetA = makeFoldTarget(new MemoryStore("a"));
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
    });
    await mountMesh(makeFoldTarget(new MemoryStore("b")), {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: { id: "b", name: "Beta", description: "", capabilities: ["chat"] },
    });
    await mountMesh(makeFoldTarget(new MemoryStore("c")), {
      adapter: new InMemoryMeshAdapter(net, "c"),
      identity: { id: "c", name: "Gamma", description: "", capabilities: ["research"] },
    });

    const all = (await callTool(targetA.folded, "glove_mesh_list_agents", {})) as {
      status: string;
      data: { count: number; agents: { id: string }[] };
    };
    assert.equal(all.data.count, 2);
    assert.deepEqual(all.data.agents.map((a) => a.id).sort(), ["b", "c"]);

    const onlyChat = (await callTool(targetA.folded, "glove_mesh_list_agents", {
      filter: { capability: "chat" },
    })) as { data: { agents: { id: string }[] } };
    assert.deepEqual(onlyChat.data.agents.map((a) => a.id), ["b"]);

    const onlyGamma = (await callTool(targetA.folded, "glove_mesh_list_agents", {
      filter: { name_contains: "gam" },
    })) as { data: { agents: { id: string }[] } };
    assert.deepEqual(onlyGamma.data.agents.map((a) => a.id), ["c"]);
  });
});

describe("mountMesh — adapter.send throwing", () => {
  it("rolls back the pending blocking inbox item and returns an error result", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const target = makeFoldTarget(storeA);

    // Wrap a real in-memory adapter, but make `send` throw.
    const realAdapter = new InMemoryMeshAdapter(net, "a");
    const throwingAdapter = {
      ...realAdapter,
      identifier: realAdapter.identifier,
      register: realAdapter.register.bind(realAdapter),
      unregister: realAdapter.unregister.bind(realAdapter),
      listAgents: realAdapter.listAgents.bind(realAdapter),
      getAgent: realAdapter.getAgent.bind(realAdapter),
      broadcast: realAdapter.broadcast.bind(realAdapter),
      acknowledge: realAdapter.acknowledge.bind(realAdapter),
      subscribe: realAdapter.subscribe.bind(realAdapter),
      send: async () => {
        throw new Error("transport down");
      },
    };

    await mountMesh(target, { adapter: throwingAdapter, identity: ID_A });

    const result = await callTool(target.folded, "glove_mesh_send_message", {
      to: "nobody",
      content: "hi",
      blocking: true,
    });

    assert.equal((result as { status: string }).status, "error");
    assert.match(
      (result as { message: string }).message,
      /glove_mesh_send_message failed: transport down/,
    );

    // The pending blocking item was rolled back to "consumed" (not stuck pending).
    const items = await storeA.getInboxItems!();
    const stillPending = items.filter((i) => i.status === "pending");
    assert.equal(stillPending.length, 0, "no pending items should remain after send failure");
    const consumed = items.find((i) => i.status === "consumed");
    assert.ok(consumed, "rolled-back item should exist with status=consumed");
    assert.match(consumed!.response ?? "", /Send failed: transport down/);
  });
});

describe("mountMesh — double mount", () => {
  it("folds tools twice when called twice on the same target (current behavior, no crash)", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const target = makeFoldTarget(storeA);

    await mountMesh(target, { adapter: new InMemoryMeshAdapter(net, "a"), identity: ID_A });
    await mountMesh(target, { adapter: new InMemoryMeshAdapter(net, "a"), identity: ID_A });

    // Each mount folds 4 tools → 8 total. Documents the current (additive)
    // behavior so a future change to dedupe is a deliberate decision.
    assert.equal(target.folded.length, 8);
  });
});

describe("mountMesh — duplicate ack idempotency", () => {
  it("a second ack for the same message_id is a no-op (does not crash, does not re-resolve)", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");
    const targetA = makeFoldTarget(storeA);
    const targetB = makeFoldTarget(storeB);
    await mountMesh(targetA, { adapter: new InMemoryMeshAdapter(net, "a"), identity: ID_A });
    await mountMesh(targetB, { adapter: new InMemoryMeshAdapter(net, "b"), identity: ID_B });

    const sendResult = await callTool(targetA.folded, "glove_mesh_send_message", {
      to: "b",
      content: "confirm",
      blocking: true,
    });
    const msgId = (sendResult as { data: { message_id: string } }).data.message_id;

    // First ack — resolves the pending item.
    await callTool(targetB.folded, "glove_mesh_acknowledge", {
      message_id: msgId,
      note: "first",
    });
    const afterFirst = await storeA.getInboxItems!();
    const resolvedFirst = afterFirst.find((i) => i.tag === `mesh:waiting:${msgId}`)!;
    assert.equal(resolvedFirst.status, "resolved");
    assert.equal(resolvedFirst.response, "first");

    // Second ack — should not crash, should not overwrite the response.
    const secondResult = await callTool(targetB.folded, "glove_mesh_acknowledge", {
      message_id: msgId,
      note: "second",
    });
    assert.equal((secondResult as { status: string }).status, "success");
    const afterSecond = await storeA.getInboxItems!();
    const resolvedSecond = afterSecond.find((i) => i.tag === `mesh:waiting:${msgId}`)!;
    assert.equal(resolvedSecond.status, "resolved");
    // Closure map already deleted the pending entry on first ack, so the
    // second ack's resolvePendingFor short-circuits — response stays "first".
    assert.equal(resolvedSecond.response, "first");
  });
});

describe("mountMesh — adapter error returns structured ToolResultData", () => {
  it("glove_mesh_list_agents returns status=error when adapter.listAgents throws", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const target = makeFoldTarget(storeA);

    const real = new InMemoryMeshAdapter(net, "a");
    const throwingAdapter = {
      ...real,
      identifier: real.identifier,
      register: real.register.bind(real),
      unregister: real.unregister.bind(real),
      getAgent: real.getAgent.bind(real),
      send: real.send.bind(real),
      broadcast: real.broadcast.bind(real),
      acknowledge: real.acknowledge.bind(real),
      subscribe: real.subscribe.bind(real),
      listAgents: async () => {
        throw new Error("registry down");
      },
    };

    await mountMesh(target, { adapter: throwingAdapter, identity: ID_A });

    const result = await callTool(target.folded, "glove_mesh_list_agents", {});
    assert.equal((result as { status: string }).status, "error");
    assert.match(
      (result as { message: string }).message,
      /glove_mesh_list_agents failed: registry down/,
    );
  });

  it("glove_mesh_send_message returns status=error when ctx.store.addInboxItem throws", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    // Inject an addInboxItem that throws to exercise the new pre-send guard.
    storeA.addInboxItem = async () => {
      throw new Error("disk full");
    };
    const target = makeFoldTarget(storeA);

    await mountMesh(target, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
    });
    // Register a second agent so the recipient validation passes — we want to
    // hit the addInboxItem failure, not the unknown-agent guard.
    const targetB = makeFoldTarget(new MemoryStore("b"));
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
    });

    const result = await callTool(target.folded, "glove_mesh_send_message", {
      to: "b",
      content: "hi",
      blocking: true,
    });
    assert.equal((result as { status: string }).status, "error");
    assert.match(
      (result as { message: string }).message,
      /failed to record pending blocking item .* disk full/,
    );
  });
});
