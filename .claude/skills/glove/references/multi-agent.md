# Many agents: mesh and continuum

> Read when agents must message each other (glove-mesh) or run as supervised subprocesses (glove-continuum-signal). For subagents, read [extensions.md](extensions.md#subagents); for durable multi-agent systems, use the `glove-foundry` skill.
>
> On Foundry, use `mesh: true` on `defineAgent` instead of mounting glove-mesh yourself: Foundry hosts the mesh with the same four tools, addresses agents by instance id, finds peers in the agent's workspace, sends the recipient's final reply back to the conversation that asked, and a `voiceCall` speaks messages mid-call. See the `glove-foundry` skill's "Agents talking to agents". Mount glove-mesh directly (below) only outside Foundry.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Mesh Network (`glove-mesh`)

`glove-mesh` lets multiple Glove agents talk to each other — direct messages, broadcasts, acknowledgements — on top of the existing `glove-inbox` primitive. The package is behaviorally additive to `glove-core` except for one small runtime API addition: `IGloveRunnable.store` (a `readonly` accessor that `mountMesh` reads to write resolved inbox items directly). No agent-loop semantics change. The package itself ships no authentication; the consumer's `MeshAdapter` owns transport and any signing/verification.

### When to use it

- Two or more Glove agents running async or in parallel in the same process (or across processes/hosts) need to coordinate.
- You want the agent loop to surface peer messages as plain context the model can read, without writing custom subscriber/store integration.

If you just need one agent to delegate work to another sub-task in isolation, use `defineSubAgent` instead — subagents run nested under the parent. Mesh is for peers.

### Mental model

Each agent owns its own `StoreAdapter`+inbox. The `MeshAdapter` is a per-agent view of the network (matches `McpAdapter`'s per-conversation pattern). When agent A calls `glove_mesh_send_message({ to: "b", content: ... })`, the framework drops a `status: "resolved"` `InboxItem` with tag `mesh:from:a` into B's store. B's existing `Agent.injectResolvedInboxItems` path (glove-core) surfaces it as a synthetic user message on B's next `ask()` — exactly like an externally-resolved inbox item.

The "shared inbox" is conceptual: the mesh is shared; the inbox stays per-agent.

### `mountMesh` — the canonical entry point

After `new Glove(...).build()`:

```typescript
import { mountMesh, MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

const network = new MeshNetwork();          // in-process bus; for distributed, BYO

await mountMesh(glove, {
  adapter: new InMemoryMeshAdapter(network, "agent-a"),
  identity: {
    id: "agent-a",
    name: "Agent A",
    description: "Plans tasks for the team.",
    capabilities: ["chat", "planning"],
  },
});
```

What it does:

1. Validates `glove.store` implements the four inbox methods (`getInboxItems`, `addInboxItem`, `updateInboxItem`, `getResolvedInboxItems`) — throws `MeshStoreUnsupportedError` otherwise.
2. Awaits `adapter.register(identity)` so peers can discover this agent.
3. Calls `adapter.subscribe(handler)` once. The handler converts incoming messages into resolved inbox items (or resolves a pending blocking item on ack).
4. Folds four tools onto the running Glove: `glove_mesh_send_message`, `glove_mesh_broadcast`, `glove_mesh_list_agents`, `glove_mesh_acknowledge`.

Returns `Promise<void>` (not chainable). Mirrors `mountMcp`'s async-setup convention.

### The four tools

| Tool | Input | Behavior |
|------|-------|----------|
| `glove_mesh_send_message` | `{ to, content, in_reply_to?, blocking? }` | Calls `adapter.send`. Blocking inserts a pending blocking inbox item tagged `mesh:waiting:<msg_id>` that resolves on ack or reply. |
| `glove_mesh_broadcast` | `{ content, blocking? }` | Calls `adapter.broadcast`. Blocking resolves on the FIRST ack received. |
| `glove_mesh_list_agents` | `{ filter?: { capability?, name_contains? } }` | Calls `adapter.listAgents`; filters; excludes self. |
| `glove_mesh_acknowledge` | `{ message_id, note? }` | Calls `adapter.acknowledge`. Lightweight confirmation; for substantive replies use `glove_mesh_send_message` with `in_reply_to` instead. |

### `MeshAdapter` contract

Implement one per agent. Consumer-supplied — the package never knows about your transport.

```typescript
interface MeshAdapter {
  identifier: string;

  // Identity / registration
  register(identity: AgentIdentity): Promise<void>;
  unregister(): Promise<void>;
  listAgents(): Promise<AgentIdentity[]>;
  getAgent(id: string): Promise<AgentIdentity | null>;

  // Outbound
  send(message: MeshMessage): Promise<void>;
  broadcast(message: Omit<MeshMessage, "to">): Promise<void>;
  acknowledge(messageId: string, note?: string): Promise<void>;

  // Inbound — framework registers ONE handler per agent
  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void;
}
```

Adapter guarantees the framework relies on:

- `send` resolves when the transport has accepted the message, not when the recipient handles it.
- `broadcast` excludes the sender from fan-out.
- Handler errors must NOT bubble — log and continue so fan-out to other agents stays intact.
- `acknowledge` routes an `IncomingMeshMessage` with `kind: "ack"` back to the original sender of `messageId`.

### Reference `InMemoryMeshAdapter`

For dev, tests, and single-host setups. `MeshNetwork` is the shared bus; construct once, hand the same instance to every `InMemoryMeshAdapter` in the process.

```typescript
import { MeshNetwork, InMemoryMeshAdapter } from "glove-mesh";

const net = new MeshNetwork();
const a = new InMemoryMeshAdapter(net, "agent-a");
const b = new InMemoryMeshAdapter(net, "agent-b");
```

`MeshNetwork` keeps a bounded LRU (default 1024) of `message_id → sender_id` so `acknowledge` can route back without the model threading sender on every ack.

### Blocking sends

| Tool call | Pending item? | Resolves on |
|-----------|---------------|-------------|
| `glove_mesh_send_message({ blocking: false })` | No | n/a |
| `glove_mesh_send_message({ blocking: true })` | Yes — tag `mesh:waiting:<msg_id>` | ack with `ack_of === msg_id`, OR a reply (`glove_mesh_send_message` with `in_reply_to === msg_id`) |
| `glove_mesh_broadcast({ blocking: true })` | Yes | first ack from any peer |
| `glove_mesh_acknowledge` (this agent acking inbound) | No | n/a — itself |

A pending blocking item synthesises a transient reminder each turn via `Agent.buildPendingBlockingMessage` until it resolves. When the ack/reply arrives, the resolved item shows up via the standard `[Inbox: N item(s) resolved]` injection.

**Reply implies ack.** A direct incoming with `in_reply_to: X` does BOTH: inserts a new resolved inbox item with the reply body AND resolves the pending item for `X`. Saves the recipient one tool call.

### Tag convention

Mesh items use namespaced tags so consumers can filter mesh traffic out of inbox histories:

| Tag prefix | Direction | Meaning |
|------------|-----------|---------|
| `mesh:from:<sender>` | inbound | direct message |
| `mesh:broadcast:from:<sender>` | inbound | broadcast |
| `mesh:waiting:<msg_id>` | local | pending blocking item for an outbound send |

### Auth model — there isn't one

`MeshMessage.from` is sender-claimed and unverified. If you need authenticated messaging, sign messages before calling `send`/`broadcast` and verify in your `subscribe` handler. Mirrors how `McpAdapter.getAccessToken` keeps auth a consumer concern.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Mount mesh on an agent | `mountMesh(glove, { adapter, identity })` from `glove-mesh` |
| Adapter contract | `MeshAdapter` from `glove-mesh/core` |
| Message types | `AgentIdentity`, `MeshMessage`, `IncomingMeshMessage` from `glove-mesh/core` |
| In-process bus | `MeshNetwork`, `InMemoryMeshAdapter` from `glove-mesh/in-memory` |
| Individual tool builders | `buildMeshSendTool`, `buildMeshBroadcastTool`, `buildMeshListAgentsTool`, `buildMeshAcknowledgeTool` from `glove-mesh/tools` |
| Error classes | `MeshError`, `MeshNotRegisteredError`, `MeshUnknownAgentError`, `MeshUnknownMessageError`, `MeshStoreUnsupportedError` from `glove-mesh/core` |

### How it differs from `glove_post_to_inbox`

- `glove_post_to_inbox` — "I will resolve this myself later from outside the conversation" (external service, webhook, cron).
- `glove_mesh_send_message` — "I'm talking to another Glove agent on the mesh" (peer-to-peer).

Both write to the same `StoreAdapter` inbox surface; the tag prefix tells them apart.

### Limitations (v1)

- `InMemoryMeshAdapter` is process-local; restarts wipe state. Real transports are the consumer's job.
- Sender-table LRU caps at 1024 — acks for very old messages are best-effort.
- Broadcast blocking resolves on the FIRST ack, not all peers.
- No new `SubscriberEvent` types; observability rides on `tool_use_result` for the four tools and inbox-state writes.
- No group/topic concept. Broadcast targets every registered agent.

## Continuum (`glove-continuum-signal`)

Subprocess-based runtime substrate that supervises Glove agents like `station-signal` supervises background jobs. Two execution modes:

- **Triggered (asynchronous)** — agents are cold by default. An external force (`.trigger(input)`, a schedule fire, an inbound mesh message) wakes them. They resume their persistent store, run a turn, return, go cold. Each wakeup spawns a fresh subprocess.
- **Concurrent (synchronous)** — agents are warm in long-lived subprocesses. The runner keeps them alive and pushes notifications inline via `runner.notify(name, input)`; mid-loop pickup is immediate, no spawn latency.

The substrate is NOT an inter-agent protocol — that's `glove-mesh`. Continuum gives mesh a stable per-agent identity, an inbox-capable persistent store, and a long-lived subprocess for warm agents; mesh runs entirely inside that subprocess against whatever transport the consumer's `MeshAdapter` provides.

### When to use

- Multiple long-running agents in one deployment, each with isolated subprocesses but observed centrally.
- Agents that keep state across many wakeups (continuity-of-context for triggered agents).
- Firing agent work from an HTTP handler / cron / webhook and picking it up async — like a background job, but the job is a full Glove agent.
- Mesh between agents on the same host without an external broker (pair with the example `FilesystemMeshAdapter`).

For a single in-process agent in a Next.js handler, you don't need continuum — keep using `createChatHandler`.

### The `agent()` builder — mode-as-fork

```typescript
import { agent, z } from "glove-continuum-signal";
import { Glove, Displaymanager } from "glove-core";
import { createAdapter } from "glove-core/models/providers";

export const pizzaBaker = agent("pizza-baker")
  .input(z.object({ orderId: z.string() }))
  .output(z.object({ ready: z.boolean() }))
  .triggered()                                                // forks into TriggeredAgentBuilder
  .timeout(60_000)
  .retries(2)
  .every("5m").withInput({ orderId: "tick" })
  .env({ OVEN: "hot" })
  .store((name) => new MyPersistentStore(`./agents/${name}.db`))
  .onComplete(async (out, in_) => audit(out, in_))
  .factory(async (ctx) =>
    new Glove({
      store: ctx.store ?? undefined,
      model: createAdapter({ provider: "anthropic" }),
      displayManager: new Displaymanager(),
      systemPrompt: "You bake pizzas.",
      compaction_config: { compaction_instructions: "..." },
    })
      .fold(checkOrderTool)
      .build(ctx.store ?? undefined),
  );

// Fire-and-forget. Returns a run id immediately.
const runId = await pizzaBaker.trigger({ orderId: "abc-123" });
```

`.triggered()` returns `TriggeredAgentBuilder<TInput>` — `.retries()` / `.every()` / `.withInput()` are only available here. `.concurrent()` returns `ConcurrentAgentBuilder<TInput>` — its built agent gets a `.notify(input)` instance method on top of `.trigger(input)` (both enqueue `kind: "notify"` runs that route to the warm subprocess; `notify()` is the clearer name when you're sure the peer is warm). Calling `.notify()` on a triggered agent is a type error, not a runtime error.

**Factory context** (`AgentFactoryContext`):
- `name` — registered agent name
- `runId` — per-wakeup for triggered; `"warmup"` during concurrent factory setup
- `mode` — `"triggered" | "concurrent"`
- `store` — the `StoreAdapter` the runtime built from `.store(factory)` (or `null` if `.store(...)` wasn't called)
- `subscriber` — an IPC-forwarding `SubscriberAdapter` the bootstrap re-attaches defensively after the factory returns
- `controls.emit({ type, data })` — emit a custom event back to the runner's subscribers, wrapped as an `agent:event` envelope
- `controls.signal` — `AbortSignal` that fires on graceful stop / restart / terminal fail; use it to unmount mesh, close DB pools, etc.

### The `ContinuumRunner`

```typescript
import {
  ContinuumRunner,
  MemoryAdapter,
  ConsoleSubscriber,
} from "glove-continuum-signal";

const runner = new ContinuumRunner({
  agentsDir: "./agents",                  // auto-discover branded agents (recursive)
  adapter: new MemoryAdapter(),           // or your own ContinuumAdapter
  subscribers: [new ConsoleSubscriber()],
  pollIntervalMs: 1_000,
  maxConcurrent: 5,                       // triggered-run budget
  warmRestartPolicy: { maxRestarts: 5, backoffMs: 1_000 },
});

await runner.start();

// Triggered: spawn-per-wakeup. Returns a run id immediately.
const runId = await pizzaBaker.trigger({ orderId: "abc-123" });
const final = await runner.waitForRun(runId);

// Concurrent: routes to the warm subprocess inline.
const notifyId = await runner.notify("pizza-watcher", { event: "oven_ready" });

await runner.stop({ graceful: true, timeoutMs: 10_000 });
```

`runner.notify(name, input)` is the runner-bound equivalent of `concurrentAgent.notify(input)` — handy when you have the runner reference but not the agent reference (e.g. from a wrapper that holds the runner).

### Persistent stores

Triggered agents NEED a `StoreAdapter` that survives across wakeups, otherwise context resets every time. Configure via `.store(name => …)` — the runtime calls this on each spawn with the agent's name, and the resulting store is passed to the factory via `ctx.store`. Discovery emits a warning for triggered agents that omit `.store(...)`. Concurrent agents are usually fine with in-memory stores because their subprocess is long-lived (still want persistence if the runner can restart).

### Mesh integration

Mount mesh per-agent inside the factory:

```typescript
import { mountMesh } from "glove-mesh";
import { makeRedisMeshAdapter } from "./infra/mesh.js";

agent("pizza-watcher")
  .input(z.object({ event: z.string() }))
  .concurrent()
  .store((name) => new MyInboxCapableStore(`./agents/${name}.db`))
  .factory(async (ctx) => {
    const glove = new Glove({ store: ctx.store ?? undefined, /* ... */ }).build();
    await mountMesh(glove, {
      adapter: makeRedisMeshAdapter(ctx.name),
      identity: { id: ctx.name, name: ctx.name, description: "..." },
    });
    return glove;
  });
```

`mountMesh` requires the store to implement inbox methods (`getInboxItems` / `addInboxItem` / `updateInboxItem` / `getResolvedInboxItems`). Glove's default `MemoryStore` implements them; custom stores must too. `InMemoryMeshAdapter` from `glove-mesh` is single-process; for cross-subprocess agent-to-agent transport pick a real adapter (Redis, NATS, HTTP webhooks, …) or use the example `FilesystemMeshAdapter` from `glove-continuum-signal/tests/fixtures/fs-mesh-adapter.ts` (atomic tmp+rename writes, ~100ms polling subscribe, per-msg sender lookup for cross-process `acknowledge()`).

### Adapter contract (`ContinuumAdapter`)

Mirrors `station-signal`'s `SignalQueueAdapter` with three deltas: `agentName` everywhere (not `signalName`), `RunKind` includes `"notify"`, and steps are dropped (the Glove turn IS the unit; fine-grained observability lives on the forwarded subscriber event stream, not as relational `Step` rows). `MemoryAdapter` ships as default; consumers BYO for SQLite/Postgres/etc. `HttpTriggerAdapter` powers remote `.trigger()` via `configure({ endpoint, apiKey })`.

### Subscriber model

`ContinuumSubscriber` exposes lifecycle callbacks (`onAgentDiscovered`, `onAgentSpawned`, `onAgentReady`, `onAgentTerminated`, `onAgentRestarted`, `onRunDispatched`, `onRunStarted`, `onRunCompleted`, `onRunFailed`, `onRunTimeout`, `onRunRetry`, `onRunCancelled`, `onRunSkipped`, `onRunRescheduled`, `onNotifyDelivered`, `onCompleteError`, `onLogOutput`) plus a single fat `onAgentEvent(envelope)` that forwards every Glove `SubscriberEvent` from any child subprocess upstream:

```typescript
interface AgentEventEnvelope<T extends SubscriberEvent["type"]> {
  agentName: string;
  runId: string | null;           // null for ambient warm-agent events between notifies
  mode: AgentMode;
  event_type: T;
  data: SubscriberEventDataMap[T];
  timestamp: string;
}
```

Single envelope (rather than per-type callbacks) because the Glove `SubscriberEvent` union is 14+ types and grows independently. Wrappers fan out per-type trivially.

### Trust model

- A registered agent file is `await import()`-ed during discovery and runs in a subprocess with the parent's environment. `agentsDir` should never point at user-influenced content.
- `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, and `DYLD_INSERT_LIBRARIES` are stripped from the parent env before forwarding, and an agent's `.env({...})` cannot override them.
- For warm subprocesses, the parent validates that `notify:*` envelope `runId`s belong to the sending subprocess (`pendingNotifies` ownership check) — a misbehaving warm child can't spoof another agent's run completion.
- Warm subprocesses get a per-name restart budget (`warmRestartPolicy.maxRestarts`, default 5) that resets after 60s of post-`ready` stability, so a long-running deployment doesn't permanently lose its warm agents to occasional blips. Crash-loops still hit the budget and stop trying.

### How it differs from station-signal

| Aspect | station-signal | glove-continuum-signal |
|--------|---------------|------------------------|
| Unit of work | Stateless job (run handler or stepped pipeline) | Stateful Glove agent turn |
| Builder terminal | `.run(fn)` / `.step().build()` | `.factory(ctx => Glove)` |
| Modes | Spawn-per-run only | Triggered (spawn-per-wakeup) + Concurrent (warm subprocess + notify IPC) |
| Persistence | Step records in the adapter | Per-agent `StoreAdapter` carried across wakeups via `.store(name => …)` |
| Children touch adapter? | Yes (write `Step` rows) | No (parent is sole source of truth) |
| Observability | Per-type subscriber callbacks | Lifecycle callbacks + one fat `onAgentEvent(envelope)` for forwarded Glove events |
| Inter-unit messaging | N/A | Defers to `glove-mesh` (mounted in factory) |

### Limitations (v1)

- Single-runner only. Multi-runner warm-pool sharding and distributed claim leasing for recurring schedules are deferred to future wrapper packages.
- `configure()` is a module-level singleton; multiple runners in one process race on it. Use `runner.notify()` when you need to address a specific runner's adapter.
- A stuck notify in a warm subprocess fails its own run on timeout but doesn't kill the subprocess; subsequent notifies queue behind it on the bootstrap's promise chain. Restart the warm agent if you observe persistent starvation.
- Notify cancellation is best-effort — the parent flips status to `cancelled`, but the warm subprocess's promise chain keeps running. Plan around it for mutation-critical work.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Define an agent | `agent("name").input(zod).triggered()` or `.concurrent()`, then `.factory(ctx => glove)`, from `glove-continuum-signal` |
| Run agents | `new ContinuumRunner({ agentsDir, adapter, subscribers, ... })` from `glove-continuum-signal` |
| Push to a warm agent | `runner.notify(name, input)` or `concurrentAgent.notify(input)` |
| Persistence contract | `ContinuumAdapter` from `glove-continuum-signal` |
| Default in-process adapter | `MemoryAdapter` from `glove-continuum-signal` |
| Remote trigger | `configure({ endpoint, apiKey })` + `HttpTriggerAdapter` from `glove-continuum-signal` |
| Observability | `ContinuumSubscriber`, `ConsoleSubscriber`, `AgentEventEnvelope` from `glove-continuum-signal` |
| Brand symbol | `AGENT_BRAND = Symbol.for("glove-continuum-agent")`, `isAgent(v)` from `glove-continuum-signal` |
| Mount mesh inside factory | `mountMesh(glove, { adapter, identity })` from `glove-mesh` (see Mesh section) |
