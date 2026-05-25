# glove-mesh

Inter-agent communication for the [Glove](https://github.com/porkytheblack/glove) framework. Wire multiple agents together so they can send each other messages, broadcast to the network, and acknowledge receipt — all on top of the existing `glove-inbox` primitive.

The package is strictly additive: it does not change `glove-core`. Each agent keeps its own `StoreAdapter`. The mesh layer routes messages and drops them into recipient inboxes as resolved items, so the existing inbox-injection path surfaces them on the next `ask()`.

## Install

```sh
pnpm add glove-mesh
```

Requires `glove-core` as a peer.

## What it gives the agent

Four model-callable tools:

| Tool | Purpose |
|---|---|
| `mesh_send_message` | Send a private message to another agent. Optionally blocking. |
| `mesh_broadcast` | Send a message to every other registered agent. Optionally blocking. |
| `mesh_list_agents` | Discover who's on the network. Filter by capability or name substring. |
| `mesh_acknowledge` | Confirm receipt of an incoming message. Unblocks the original sender. |

## Quick start (in-process, two agents)

```ts
import { Glove, MemoryStore, Displaymanager, createAdapter } from "glove-core";
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

// One shared bus for the in-process demo.
const network = new MeshNetwork();

async function makeAgent(id: string, name: string, description: string) {
  const store = new MemoryStore(id);
  const glove = new Glove({
    store,
    model: createAdapter({ provider: "anthropic" }),
    displayManager: new Displaymanager(),
    systemPrompt: `You are ${name}. ${description}`,
    serverMode: true,
    compaction_config: { compaction_instructions: "Summarize the conversation." },
  }).build(store);

  await mountMesh(glove, {
    adapter: new InMemoryMeshAdapter(network, id),
    identity: { id, name, description, capabilities: ["chat"] },
  });

  return glove;
}

const planner = await makeAgent("planner", "Planner", "Plans tasks for the team.");
const worker = await makeAgent("worker", "Worker", "Executes assigned tasks.");

await planner.processRequest(
  "Find an agent that can execute tasks and send them a hello with blocking=true.",
);
// On the worker's next ask(), it will see the message in its inbox.
await worker.processRequest("Check your inbox and acknowledge anything you see.");
// On the planner's next ask(), the acknowledgement resolves the blocking send.
await planner.processRequest("Continue.");
```

For distributed setups (multiple processes, multiple hosts), implement `MeshAdapter` directly over your transport — Redis pub/sub, NATS, HTTP webhooks, anything.

## The `MeshAdapter` contract

Implement one per agent. Same shape as `McpAdapter` / `StoreAdapter` — `identifier` field, async methods.

```ts
interface MeshAdapter {
  identifier: string;

  // Identity
  register(identity: AgentIdentity): Promise<void>;
  unregister(): Promise<void>;
  listAgents(): Promise<AgentIdentity[]>;
  getAgent(id: string): Promise<AgentIdentity | null>;

  // Outbound
  send(message: MeshMessage): Promise<void>;
  broadcast(message: Omit<MeshMessage, "to">): Promise<void>;
  acknowledge(messageId: string, note?: string): Promise<void>;

  // Inbound
  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void;
}
```

Guarantees expected of an adapter:

- `send` resolves when the transport has accepted the message, not when the recipient has handled it.
- `broadcast` excludes the sender.
- The handler passed to `subscribe` MUST NOT have its errors bubble — log and continue so fan-out to other agents stays intact.
- `acknowledge` routes an `IncomingMeshMessage` with `kind: "ack"` back to the original sender of `messageId`.

## BYO transport sketch

For a distributed setup the adapter is the seam:

```ts
class RedisMeshAdapter implements MeshAdapter {
  identifier: string;
  constructor(private redis: Redis, private agentId: string) {
    this.identifier = `redis-mesh-${agentId}`;
  }

  async register(identity) { await this.redis.hset("mesh:agents", this.agentId, JSON.stringify(identity)); }
  async unregister()       { await this.redis.hdel("mesh:agents", this.agentId); }
  async listAgents() {
    const raw = await this.redis.hgetall("mesh:agents");
    return Object.values(raw).map((s) => JSON.parse(s));
  }
  async getAgent(id) {
    const raw = await this.redis.hget("mesh:agents", id);
    return raw ? JSON.parse(raw) : null;
  }

  async send(msg)               { await this.redis.publish(`mesh:agent:${msg.to}`, JSON.stringify({ kind: "direct", ...msg })); }
  async broadcast(msg)          { await this.redis.publish("mesh:broadcast", JSON.stringify({ kind: "broadcast", ...msg, from: this.agentId })); }
  async acknowledge(id, note?)  { /* look up original sender, publish ack */ }

  subscribe(handler) {
    const sub = this.redis.duplicate();
    sub.subscribe(`mesh:agent:${this.agentId}`, "mesh:broadcast");
    sub.on("message", async (_chan, raw) => {
      try { await handler(JSON.parse(raw)); }
      catch (err) { console.warn("[mesh] handler:", err); }
    });
    return () => { sub.unsubscribe(); sub.quit(); };
  }
}
```

## Blocking sends

| Tool call | Pending inbox item? | Resolves on |
|---|---|---|
| `mesh_send_message({ blocking: false })` | No | n/a — returns immediately. |
| `mesh_send_message({ blocking: true })` | Yes, tagged `mesh:waiting:<msg_id>` | An ack with `ack_of === msg_id`, **or** a reply (`mesh_send_message` with `in_reply_to === msg_id`). |
| `mesh_broadcast({ blocking: true })` | Yes, tagged `mesh:waiting:<msg_id>` | The first ack received from any peer. Later acks arrive as ordinary inbox items. |
| `mesh_acknowledge` (this agent acking an inbound) | No | n/a — itself. |

The pending blocking inbox item synthesises a transient reminder each turn via `Agent.buildPendingBlockingMessage` (built into glove-core's agent loop) until it resolves. When the ack/reply arrives, the resolved item shows up in the model's view via the standard `[Inbox: N item(s) resolved]` injection.

## Inbox tag convention

Mesh-originated inbox items use namespaced tags so consumers can filter mesh traffic out of inbox histories:

| Tag prefix | Direction | Meaning |
|---|---|---|
| `mesh:from:<sender>` | inbound | direct message from another agent |
| `mesh:broadcast:from:<sender>` | inbound | broadcast from another agent |
| `mesh:waiting:<msg_id>` | local | pending blocking item for an outbound send |

## No authentication

The `from` field on every `MeshMessage` is sender-claimed and not verified. If you need authenticated messaging, sign messages before calling `send`/`broadcast` and verify in your `subscribe` handler — `glove-mesh` itself stays out of the way. This mirrors how `McpAdapter.getAccessToken` keeps auth a consumer concern.

## Limitations (v1)

- `InMemoryMeshAdapter` is process-local and loses state on restart. Use a real transport for anything that needs to survive restarts or span machines.
- The `MeshNetwork` LRU that maps `message_id → sender_id` (for ack routing) is bounded at 1024 entries. Acks for very old messages are best-effort.
- Broadcast blocking resolves on the FIRST ack, not all — document this for your operators.
- No new `SubscriberEvent` types: observability rides on the existing `tool_use_result` events for the four mesh tools, plus your `StoreAdapter`'s inbox writes.
- No group/topic concept; broadcast targets every registered agent.

## How this differs from `glove_post_to_inbox`

- `glove_post_to_inbox` is for "I will resolve this myself later from outside the conversation" — the resolver is an external service the consumer runs.
- `mesh_send_message` is for "I'm talking to another Glove agent" — the resolver is another agent on the mesh.

Both write to the same `StoreAdapter` inbox surface; the tag prefix tells them apart.
