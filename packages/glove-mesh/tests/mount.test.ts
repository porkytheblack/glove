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
}

function makeFoldTarget(): RecorderTarget {
  const folded: GloveFoldArgs<unknown>[] = [];
  const target: RecorderTarget = {
    folded,
    fold: <I>(args: GloveFoldArgs<I>) => {
      folded.push(args as GloveFoldArgs<unknown>);
      return target;
    },
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
    const target = makeFoldTarget();
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
    await assert.rejects(
      () =>
        mountMesh(target, {
          adapter,
          identity: ID_A,
          store: halfStore,
        }),
      (err: unknown) => err instanceof MeshStoreUnsupportedError,
    );
  });
});

describe("mountMesh — tool folding", () => {
  it("folds all four mesh tools and registers the identity", async () => {
    const net = new MeshNetwork();
    const adapter = new InMemoryMeshAdapter(net, "a");
    const store = new MemoryStore("a");
    const target = makeFoldTarget();

    await mountMesh(target, { adapter, identity: ID_A, store });

    const names = target.folded.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "mesh_acknowledge",
      "mesh_broadcast",
      "mesh_list_agents",
      "mesh_send_message",
    ]);
    assert.deepEqual(net.getAgent("a"), ID_A);
  });
});

describe("mountMesh — inbound direct message", () => {
  it("inserts a resolved inbox item tagged mesh:from:<sender>", async () => {
    const net = new MeshNetwork();
    const adapterA = new InMemoryMeshAdapter(net, "a");
    const adapterB = new InMemoryMeshAdapter(net, "b");
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");
    const targetA = makeFoldTarget();
    const targetB = makeFoldTarget();

    await mountMesh(targetA, { adapter: adapterA, identity: ID_A, store: storeA });
    await mountMesh(targetB, { adapter: adapterB, identity: ID_B, store: storeB });

    const result = await callTool(targetA.folded, "mesh_send_message", {
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
    const adapterA = new InMemoryMeshAdapter(net, "a");
    const adapterB = new InMemoryMeshAdapter(net, "b");
    const storeA = new MemoryStore("a");
    const storeB = new MemoryStore("b");

    await mountMesh(makeFoldTarget(), { adapter: adapterA, identity: ID_A, store: storeA });
    const targetB = makeFoldTarget();
    await mountMesh(targetB, { adapter: adapterB, identity: ID_B, store: storeB });
    // B sends a broadcast — A should receive it (tested via storeA).
    const targetBSend = makeFoldTarget();
    await mountMesh(targetBSend, { adapter: new InMemoryMeshAdapter(net, "b2"), identity: { id: "b2", name: "B2", description: "" }, store: new MemoryStore("b2") });

    // For simpler assertion, broadcast from B and check storeA.
    const result = await callTool(targetB.folded, "mesh_broadcast", {
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
    const targetA = makeFoldTarget();
    const targetB = makeFoldTarget();
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
      store: storeA,
    });
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
      store: storeB,
    });

    const sendResult = await callTool(targetA.folded, "mesh_send_message", {
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
    const ackResult = await callTool(targetB.folded, "mesh_acknowledge", {
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
    const targetA = makeFoldTarget();
    const targetB = makeFoldTarget();
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
      store: storeA,
    });
    await mountMesh(targetB, {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: ID_B,
      store: storeB,
    });

    const sendResult = await callTool(targetA.folded, "mesh_send_message", {
      to: "b",
      content: "what's the status?",
      blocking: true,
    });
    const msgId = (sendResult as { data: { message_id: string } }).data.message_id;

    // B replies via mesh_send_message with in_reply_to.
    const replyResult = await callTool(targetB.folded, "mesh_send_message", {
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

describe("mountMesh — mesh_list_agents", () => {
  it("returns peers excluding self, with capability and name filtering", async () => {
    const net = new MeshNetwork();
    const storeA = new MemoryStore("a");
    const targetA = makeFoldTarget();
    await mountMesh(targetA, {
      adapter: new InMemoryMeshAdapter(net, "a"),
      identity: ID_A,
      store: storeA,
    });
    await mountMesh(makeFoldTarget(), {
      adapter: new InMemoryMeshAdapter(net, "b"),
      identity: { id: "b", name: "Beta", description: "", capabilities: ["chat"] },
      store: new MemoryStore("b"),
    });
    await mountMesh(makeFoldTarget(), {
      adapter: new InMemoryMeshAdapter(net, "c"),
      identity: { id: "c", name: "Gamma", description: "", capabilities: ["research"] },
      store: new MemoryStore("c"),
    });

    const all = (await callTool(targetA.folded, "mesh_list_agents", {})) as {
      status: string;
      data: { count: number; agents: { id: string }[] };
    };
    assert.equal(all.data.count, 2);
    assert.deepEqual(all.data.agents.map((a) => a.id).sort(), ["b", "c"]);

    const onlyChat = (await callTool(targetA.folded, "mesh_list_agents", {
      filter: { capability: "chat" },
    })) as { data: { agents: { id: string }[] } };
    assert.deepEqual(onlyChat.data.agents.map((a) => a.id), ["b"]);

    const onlyGamma = (await callTool(targetA.folded, "mesh_list_agents", {
      filter: { name_contains: "gam" },
    })) as { data: { agents: { id: string }[] } };
    assert.deepEqual(onlyGamma.data.agents.map((a) => a.id), ["c"]);
  });
});
