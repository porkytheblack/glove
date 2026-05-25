# glove-continuum-signal

Runtime substrate for inter-agent collaboration in the Glove ecosystem. Modeled
on [station-signal](https://github.com/porkytheblack/station/tree/main/packages/station-signal);
applies the same principles (branded fluent builders, pluggable persistence
adapters, pluggable subscribers, single-source-of-truth lifecycle authority,
auto-discovery from a directory, subprocess-per-unit isolation) to AI agents
built with [glove-core](https://github.com/porkytheblack/glove).

Two execution modes:

- **Triggered (asynchronous)** — agents are cold by default. An external force
  (`.trigger(input)`, a schedule fire, an inbound mesh message) wakes them.
  They resume their persistent store, run a turn, return, go cold. Each wakeup
  spawns a fresh subprocess.
- **Concurrent (synchronous)** — agents are warm in long-lived subprocesses.
  The runner keeps them alive and pushes notifications inline via
  `runner.notify(name, input)`; mid-loop pickup is immediate, no spawn latency.

```ts
import { agent, z, ContinuumRunner, MemoryAdapter } from "glove-continuum-signal";
import { Glove, MemoryStore, Displaymanager } from "glove-core";

export const pizzaBaker = agent("pizza-baker")
  .input(z.object({ orderId: z.string() }))
  .triggered()
  .timeout(60_000)
  .retries(2)
  .every("5m").withInput({ orderId: "tick" })
  .store((name) => new MyPersistentStore(name)) // inbox-capable; see below
  .factory(async (ctx) => {
    return new Glove({
      store: ctx.store ?? undefined,
      model,
      displayManager: new Displaymanager(),
      systemPrompt: "You bake pizzas.",
      compaction_config: { compaction_instructions: "…" },
    })
      .fold(checkOrderTool)
      .build(ctx.store ?? undefined);
  });

const runner = new ContinuumRunner({
  adapter: new MemoryAdapter(),
  pollIntervalMs: 1_000,
});
runner.registerAgent(pizzaBaker, import.meta.url);
await runner.start();

// Fire-and-forget; returns a run id immediately.
const runId = await pizzaBaker.trigger({ orderId: "abc-123" });
const final = await runner.waitForRun(runId);
console.log(final?.status, final?.output);
```

## Persistent stores

Triggered agents need a `StoreAdapter` that survives across subprocess wakeups
to give them context-of-continuity. `glove-core`'s `MemoryStore` is in-process
and resets per-wakeup; supply a persistent backend via `.store(name => …)`.

```ts
agent("my-agent")
  .input(z.object({ ... }))
  .triggered()
  .store((name) => new SqliteStore(`./agents/${name}.db`))
  .factory(...)
```

Discovery emits a WARN for triggered agents that omit `.store(...)` — they
will lose conversation history across triggers, which defeats the purpose of
triggered (vs. one-shot) execution.

## glove-mesh integration

Mesh is a per-agent concern, mounted inside the factory:

```ts
import { mountMesh } from "glove-mesh";

agent("pizza-watcher")
  .input(z.object({ event: z.string() }))
  .concurrent()
  .store((name) => new MyInboxCapableStore(name))
  .factory(async (ctx) => {
    const glove = new Glove({ store: ctx.store ?? undefined, ... }).build();

    await mountMesh(glove, {
      adapter: new MyMeshAdapter(ctx.name),
      identity: { id: ctx.name, name: ctx.name, description: "…" },
    });

    return glove;
  });
```

**`mountMesh` requires an inbox-capable store** — it asserts that the store
implements `getInboxItems` / `addInboxItem` / `updateInboxItem` /
`getResolvedInboxItems`, throwing `MeshStoreUnsupportedError` otherwise.
`MemoryStore` from `glove-core` already implements them; custom stores must
too if mesh is mounted on the resulting glove.

`InMemoryMeshAdapter` from `glove-mesh` only works within a single process.
For cross-subprocess agent-to-agent transport, supply a real adapter (Redis,
NATS, HTTP webhooks, …). The package tests include a `FilesystemMeshAdapter`
(`tests/fixtures/fs-mesh-adapter.ts`) as a worked example of a multiprocess
adapter built on the filesystem — atomic tmp+rename writes, ~100ms polling
subscribe, per-message sender lookup so `acknowledge()` routes back to the
original sender even across process restarts. Suitable for tests and local
multiprocess scenarios; a production cross-machine mesh wants a real broker.

### End-to-end proof: two continuum agents talking via mesh

`tests/agent-to-agent-mesh.test.ts` exercises the full chain in one
`ContinuumRunner` with two warm concurrent agents (`mesh-sender` +
`mesh-receiver`) sharing a `FilesystemMeshAdapter`:

```
runner.notify("mesh-sender", { to: "mesh-receiver", content })
  → sender's bootstrap subprocess receives notify IPC
  → MeshSendingModel emits glove_mesh_send_message tool call
  → executor runs the mesh tool
  → FilesystemMeshAdapter.send writes <root>/inbox/mesh-receiver/<msgId>.json
  → receiver's subprocess polls the inbox dir (~100ms)
  → mountMesh's subscribe handler fires inside the receiver
  → store.addInboxItem flushes the receiver's persisted store
  → test parent reads the receiver's store and verifies delivery
```

Two separate subprocesses, no shared memory, mesh as the only transport.

## Subscribers + observability

```ts
import { ConsoleSubscriber } from "glove-continuum-signal";

new ContinuumRunner({
  subscribers: [
    new ConsoleSubscriber(),
    {
      onAgentEvent: (env) => {
        if (env.event_type === "tool_use") {
          metrics.inc("tool_calls", { agent: env.agentName });
        }
      },
    },
  ],
});
```

Lifecycle callbacks (`onAgentDiscovered`, `onAgentSpawned`, `onAgentReady`,
`onAgentTerminated`, `onAgentRestarted`, `onRunDispatched`, `onRunStarted`,
`onRunCompleted`, `onRunFailed`, `onRunTimeout`, `onRunRetry`,
`onRunCancelled`, `onRunSkipped`, `onRunRescheduled`, `onNotifyDelivered`,
`onCompleteError`, `onLogOutput`) plus a single fat `onAgentEvent(envelope)`
that forwards every Glove `SubscriberEvent` from any child subprocess upstream,
wrapped with the agent identity.

## Trust model

The runner trusts agent code: a registered agent file is `await import()`-ed
during discovery and runs in the subprocess with the parent's environment.
`agentsDir` should never point at user-influenced content. As defense in depth,
`NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, and `DYLD_INSERT_LIBRARIES`
are stripped from the parent env before forwarding, and an agent's `.env({…})`
cannot override them.

The parent runner is single source of truth for run status (H1 from
station-signal); children only emit IPC envelopes. For warm concurrent
subprocesses, the parent validates that `notify:*` envelope `runId`s belong to
the sending subprocess (`pendingNotifies` ownership check) — a misbehaving
warm child can't spoof another agent's run completion. The `resolved` flag
and active-count decrement on terminal IPC are set in the synchronous
critical path of the message handler (before any `await`), so slow adapter
backends can't trip a double-decrement when the 200ms exit grace overlaps a
pending status update.

Warm subprocesses get a per-name restart budget (`warmRestartPolicy.maxRestarts`,
default 5). The counter resets after 60s of post-`ready` stability, so a
long-running deployment doesn't permanently lose its warm agents to
occasional blips. Crash-loops still hit the budget and stop trying.

## Out of scope for v1

- Inter-agent message schema and addressing — `glove-mesh`.
- Distributed claim leasing for recurring schedules — future
  `glove-continuum-schedules` wrapper.
- Multi-runner coordination / warm-pool sharding — future wrapper.
- Dashboard / discovery API — future `glove-continuum-kit` wrapper.

## License

MIT — same as Glove.
