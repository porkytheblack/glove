import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryMeshAdapter,
  MeshNetwork,
  MeshUnknownAgentError,
  MeshUnknownMessageError,
  type AgentIdentity,
  type IncomingMeshMessage,
  type MeshMessage,
} from "../src";

function nowIso(): string {
  return new Date().toISOString();
}

function makeMessage(from: string, to: string | undefined, content: string): MeshMessage {
  return {
    id: `msg_${from}_${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    content,
    created_at: nowIso(),
  };
}

const ID_A: AgentIdentity = { id: "a", name: "Agent A", description: "first" };
const ID_B: AgentIdentity = { id: "b", name: "Agent B", description: "second", capabilities: ["chat"] };
const ID_C: AgentIdentity = { id: "c", name: "Agent C", description: "third", capabilities: ["chat", "research"] };

describe("MeshNetwork registry", () => {
  it("registers, lists, and unregisters agents", () => {
    const net = new MeshNetwork();
    net.registerAgent("a", ID_A);
    net.registerAgent("b", ID_B);
    assert.equal(net.listAgents().length, 2);
    assert.deepEqual(net.getAgent("a"), ID_A);
    net.unregisterAgent("a");
    assert.equal(net.listAgents().length, 1);
    assert.equal(net.getAgent("a"), null);
  });
});

describe("InMemoryMeshAdapter direct send", () => {
  it("delivers a direct message to the recipient handler with kind=direct", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    await a.register(ID_A);
    await b.register(ID_B);

    const received: IncomingMeshMessage[] = [];
    b.subscribe(async (m) => {
      received.push(m);
    });

    await a.send(makeMessage("a", "b", "hello b"));

    assert.equal(received.length, 1);
    assert.equal(received[0]!.kind, "direct");
    assert.equal(received[0]!.from, "a");
    assert.equal(received[0]!.to, "b");
    assert.equal(received[0]!.content, "hello b");
  });

  it("does not deliver a direct message to the sender", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    await a.register(ID_A);
    await b.register(ID_B);

    const aReceived: IncomingMeshMessage[] = [];
    a.subscribe(async (m) => {
      aReceived.push(m);
    });

    await a.send(makeMessage("a", "b", "hello"));
    assert.equal(aReceived.length, 0);
  });
});

describe("InMemoryMeshAdapter broadcast", () => {
  it("fans out to every other agent, excluding the sender", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    const c = new InMemoryMeshAdapter(net, "c");
    await a.register(ID_A);
    await b.register(ID_B);
    await c.register(ID_C);

    const bReceived: IncomingMeshMessage[] = [];
    const cReceived: IncomingMeshMessage[] = [];
    const aReceived: IncomingMeshMessage[] = [];
    b.subscribe(async (m) => { bReceived.push(m); });
    c.subscribe(async (m) => { cReceived.push(m); });
    a.subscribe(async (m) => { aReceived.push(m); });

    const msg: Omit<MeshMessage, "to"> = {
      id: "bcast_1",
      from: "a",
      content: "announcement",
      created_at: nowIso(),
    };
    await a.broadcast(msg);

    assert.equal(bReceived.length, 1);
    assert.equal(cReceived.length, 1);
    assert.equal(aReceived.length, 0);
    assert.equal(bReceived[0]!.kind, "broadcast");
    assert.equal(cReceived[0]!.kind, "broadcast");
  });
});

describe("InMemoryMeshAdapter acknowledge", () => {
  it("routes an ack back to the original sender with kind=ack and ack_of", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    await a.register(ID_A);
    await b.register(ID_B);

    const aReceived: IncomingMeshMessage[] = [];
    a.subscribe(async (m) => { aReceived.push(m); });

    const sent = makeMessage("a", "b", "please ack");
    await a.send(sent);
    await b.acknowledge(sent.id, "got it");

    assert.equal(aReceived.length, 1);
    assert.equal(aReceived[0]!.kind, "ack");
    assert.equal(aReceived[0]!.ack_of, sent.id);
    assert.equal(aReceived[0]!.ack_note, "got it");
    assert.equal(aReceived[0]!.from, "b");
  });

  it("throws MeshUnknownMessageError when acking a message it has no record of", async () => {
    const net = new MeshNetwork();
    const b = new InMemoryMeshAdapter(net, "b");
    await b.register(ID_B);

    await assert.rejects(
      () => b.acknowledge("msg_unknown"),
      (err: unknown) => err instanceof MeshUnknownMessageError,
    );
  });
});

describe("MeshNetwork handler isolation", () => {
  it("one handler throwing does not stop fan-out to other handlers", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    await a.register(ID_A);
    await b.register(ID_B);

    const ok: IncomingMeshMessage[] = [];
    b.subscribe(async () => {
      throw new Error("boom");
    });
    b.subscribe(async (m) => {
      ok.push(m);
    });

    await a.send(makeMessage("a", "b", "test"));
    assert.equal(ok.length, 1);
  });
});

describe("InMemoryMeshAdapter fail-fast routing", () => {
  it("throws MeshUnknownAgentError when sending to an unregistered recipient", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    await a.register(ID_A);

    await assert.rejects(
      () => a.send(makeMessage("a", "nobody", "hello")),
      (err: unknown) => err instanceof MeshUnknownAgentError,
    );
  });

  it("throws MeshUnknownAgentError when `to` is missing on a direct send", async () => {
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    await a.register(ID_A);

    await assert.rejects(
      // Pass `to: undefined` via the lower-level network method to exercise the
      // missing-recipient guard. The adapter's send() already requires `to`.
      () => net.deliverDirect(makeMessage("a", undefined, "no recipient")),
      (err: unknown) => err instanceof MeshUnknownAgentError,
    );
  });

  it("broadcast uses the registration table — registered-but-unsubscribed peers don't get fan-out by default", async () => {
    // Documents the new semantics: agents are sourced from the registry, not
    // the handler map. An agent registered without a handler is included in
    // the recipient list (delivery is a silent no-op via fanOut, but no error).
    const net = new MeshNetwork();
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    const c = new InMemoryMeshAdapter(net, "c");
    await a.register(ID_A);
    await b.register(ID_B);
    await c.register(ID_C);

    const bReceived: IncomingMeshMessage[] = [];
    b.subscribe(async (m) => { bReceived.push(m); });
    // C is registered but never subscribes — broadcast must not throw.

    const msg: Omit<MeshMessage, "to"> = {
      id: "bcast_solo",
      from: "a",
      content: "hi all",
      created_at: nowIso(),
    };

    await a.broadcast(msg);
    assert.equal(bReceived.length, 1);
    assert.equal(bReceived[0]!.kind, "broadcast");
  });
});

describe("MeshNetwork sender table LRU", () => {
  it("evicts old sender entries past capacity", async () => {
    const net = new MeshNetwork({ senderTableCapacity: 3 });
    const a = new InMemoryMeshAdapter(net, "a");
    const b = new InMemoryMeshAdapter(net, "b");
    await a.register(ID_A);
    await b.register(ID_B);
    b.subscribe(async () => {});

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = makeMessage("a", "b", `msg ${i}`);
      ids.push(m.id);
      await a.send(m);
    }

    // First two should have been evicted.
    assert.equal(net.resolveSenderFor(ids[0]!), null);
    assert.equal(net.resolveSenderFor(ids[1]!), null);
    assert.equal(net.resolveSenderFor(ids[2]!), "a");
    assert.equal(net.resolveSenderFor(ids[3]!), "a");
    assert.equal(net.resolveSenderFor(ids[4]!), "a");
  });
});
