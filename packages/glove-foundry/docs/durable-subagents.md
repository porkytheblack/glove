# Durable subagents

A durable subagent is an agent instance owned by another agent instance. Declare a
named worker in `defineAgent`; Foundry creates it on first use and keeps its identity,
conversations and owned data available for future work.

Use durable subagents when one agent needs several intelligent workers with separate
responsibilities. Each can have its own model, instructions, tools, memory access and
run budget, handle many tasks over time, receive events independently, and own further
workers. The parent can keep serving requests while that work proceeds. This applies
to chat agents, background services, scheduled work and systems with no conversational
front. A realtime front is one possible consumer of the same primitives.

## What exists in code and storage

| Concept | Meaning |
| --- | --- |
| Worker definition | A normal `defineAgent` value describing a model, instructions and capabilities. Several slots or parents can reuse it. |
| Named slot | A key in `durableSubagents`, with a worker definition, inheritance selections and delivery defaults. |
| Owned worker instance | One persisted agent for a particular parent instance and slot name, with its own instance ID in the parent's workspace. |
| Conversation | A context owned by that worker. Its default event conversation and individual delegated-task conversations are separate. |
| Run | An execution assembled to process work in a conversation. The same worker instance can be used by many runs. |

Two parent instances using the same definition get different workers. Two slots on
one parent get different workers even when they reuse the same definition. Reusing a
definition does not adopt an unrelated existing instance.

The identity and stored state are durable. A worker does not need a continuously
running JavaScript process or model session. Foundry assembles it again for each run;
an idle worker does not occupy an execution slot just to exist.

## Declare the relationship

Keep workers as ordinary agent definitions, then select them in the parent. An inline
`defineAgent` value works too. Models and persistence adapters use normal Foundry
configuration; there is no separate worker harness to construct.

```ts
import { defineAgent, restrictApp } from "glove-foundry";
import worker from "../worker/agent.js";
import knowledgeBase from "./apps/knowledge-base.app.js";
import { components } from "./composition.js";

export default defineAgent({
  description: "Coordinate requests and independent workers",
  model: fastModel,
  systemPrompt: "Help the user and coordinate your workers.",
  components,
  durableSubagents: {
    analysis: {
      agent: worker,
      eventDelivery: { whenIdle: "wake" },
      inherit: {
        context: true,
        tools: ["search_documents"],
        memory: { scope: "shared", access: "reader", profiles: ["personal"] },
        apps: [restrictApp(knowledgeBase, {
          tools: ["search", "read_document"],
          operations: ["documents.read"],
        })],
      },
      cleanup: async ({ agent, conversationIds }) => {
        // Application-owned adapters: delete only this worker's private data.
        await privateMemory.deleteNamespace(agent.id);
        await transcripts.deleteConversations(conversationIds);
      },
    },
    planner: {
      agent: defineAgent({
        description: "Long-term planning",
        model: thoroughModel,
        systemPrompt: "Maintain long-term plans.",
        runTimeoutMs: 4 * 60 * 60 * 1000,
        maxConcurrentRuns: 1,
      }),
    },
  },
});
```

Imported definitions and inline `defineAgent` values work, including nested workers.
Definitions remain immutable. Discovery derives a route such as
`coordinator/workers/analysis`; `workers` inside a route is reserved for this purpose.
Names must be lowercase slugs; `parent` is reserved. Cycles and route collisions fail
discovery. Declare these relationships statically; ordinary assembly fields remain lazy.

## Provisioning and reuse

Declaring a slot makes a worker available; it does not create every possible instance
at startup. A first message or delegated task atomically provisions the owned worker.
An application can also ensure one explicitly:

```ts
import { createFoundryClient } from "glove-foundry/client";

const client = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL! });
const parent = await client.agent("coordinator").create({ workspaceId: "workspace-a" });
const worker = client.subagent(parent.id, "analysis"); // handle only; no request yet
const instance = await worker.ensure();              // create once or return the existing instance
await worker.send("Review the current plan.");       // also ensures the worker if needed
```

The ownership key is the parent instance ID plus the slot name. New messages, tasks
and controller restarts reuse that instance when the data adapter is persistent.
Ensuring a worker does not start a model run. Listing and inspection do not provision
or reactivate workers. A new parent gets new workers; changing a slot name identifies
a different worker rather than renaming its stored instance.

## Direct messages and task delegation

A durable worker is a place to send work over time. Task delegation adds an assignment,
clarification questions, task status and a correlated final result to that independent
lifetime. Direct messages communicate facts, priority changes or spontaneous findings
without creating a tracked task. Both use the same addressed event-delivery layer.

Calls to
`glove_foundry_delegate({ to: "analysis", task: "Write a report" })` use the owned
worker. Existing `delegates` continue to work. A durable name takes precedence
when it also names a sibling delegate. Each task gets a separate conversation;
its final result and questions return to the originating parent conversation.

`glove_foundry_message({ to: "analysis", message: "Watch this competitor" })`
sends a spontaneous message without creating a task. The worker can send
`glove_foundry_message({ to: "parent", message: "Something changed" })` at any time.
An instance ID identifies the worker; a conversation ID identifies the particular
context in which it processes an event. By default messages address a stable event
conversation belonging to the recipient. They do not automatically enter an active
task or the latest parent chat. Supply
`delivery.conversationId` to address an existing conversation explicitly. Foundry
validates that it belongs to the recipient and shares its workspace; it never guesses
the latest chat. The model tool accepts only declared children and the actual parent.
It cannot address arbitrary instance IDs. Events sent by the tool include a
`metadata.replyTo` agent/conversation address, which a worker can use to target its
reply. There is no automatic reply loop.

```ts
await worker.send("Include these three companies.", {
  id: "analysis-update-42",           // stable across retries
  conversationId: reportConversationId,
  whenIdle: "defer",                  // join the next turn
  deferTimeoutMs: 30_000,             // or wake after 30 seconds
  expiresAt: "2027-01-01T00:00:00Z",
});

// The same layer supports direct addressed events from an application.
await client.emitEvent(
  { agentId: workerId, conversationId: reportConversationId },
  { id: "source-change-42", source: "app:watcher", kind: "source.changed", content: "The source changed." },
  { whenIdle: "wake" },
);

// From the worker, target the parent conversation explicitly.
await messageTool.run({
  to: "parent", message: "A finding needs your attention.",
  delivery: { conversationId: parentConversationId, whenIdle: "wake" },
});
```

## Delivery policies

`defineAgent({ eventDelivery })` sets the recipient's default policy; a durable slot
can replace that default object with `durableSubagents.analysis.eventDelivery`. Each
send can override fields of the effective policy. The default is `whenIdle: "wake"`.
`defer` with no effective timeout waits
for another turn; with `deferTimeoutMs`, the original acceptance time determines the
wake deadline, including across restarts. `expiresAt` discards stale events before
injection. Policies affect idle conversations; events sent to a conversation with a
live run join its next native event boundary. Different conversations can run
independently within execution limits. A waking event can carry other deferred events into the same
turn. These are deterministic controller policies; they do not infer user presence.

The message tool waits for durable acceptance, not for the recipient's answer.
Receipts contain `messageId`, `agentId`, `conversationId`, and a `runId` when one is
handling the event. A receipt is not a completion notification. IDs are scoped to
the exact target. Reusing an ID with different content or policy fails.

## Shared durable runtime events

Direct messages, initial delegated tasks, results, questions, replies, and inbound
transmissions use the same adapter-backed event journal. Each record stores its
explicit target, stable native event ID, policy, pending/acknowledged/expired state,
and handling run. Delegation retains its task status and correlation semantics on
top of that transport. Its results still return to the originating conversation.

A live run receives native `AgentEvent` values through `emitEvent`: during a tool
loop they join the next boundary; a realtime runtime can receive them through
`holdTurns({ onEvent })` and `takeEvents()`. Open tasks remain live runtime-context
snapshots. Event-triggered model turns use `processEvents()` and native event
framing, with no synthetic user request. Deferred events are seeded before a new
request's first model call. Custom Foundry handlers can inspect `ctx.events`; a
successful return acknowledges the events that started their run.

The filesystem handoff to a live process is only a transport. It is not the source
of durability, and no mesh adapter, mesh inbox, or inbox-capable Glove store is
required. Setting `delivery: "events"` on an existing mesh configuration uses native live events too; raw
mesh transport and direct `glove.emitEvent` calls do not themselves create Foundry
journal records. Use `runtime.emitEvent`/`client.emitEvent` or the messaging tool
when delivery must survive the absence of a running process. Legacy mesh inbox mode
is the default; select native live delivery explicitly on your transport, for example
`mesh: { adapter: meshAdapter, delivery: "events" }`, where `meshAdapter` implements `MeshAdapter`.

Foundry acknowledges events only after a successful receiving run reports that it
consumed them. Unread events stay pending; shutdown, failures and archival retain
unfinished delivery. Startup reconciles completed run receipts before replaying
pending events. Delivery is **at least once**, including a crash after an external
side effect but before acknowledgment. Make external effects idempotent using event
IDs. Completed and expired IDs remain in the journal to suppress duplicate retries;
worker purge removes this owned journal data. Native transcript persistence and event
acknowledgment are separate transactions, so a crash can also replay an event already
present in history.

Persistent adapters implement atomic `claimEvent` (insert-if-absent), `putEvent`, and
`listEvents`; messaging fails explicitly when these methods are absent. The bundled
memory adapter is process-local; the file adapter persists the journal and receipts.
The execution controller owns idle timers so a worker process need not stay alive
while deferred work waits. Use one active controller per execution deployment.

Use `FileFoundryDataAdapter` or a persistent transactional adapter, and configure an
application `conversationStore` (or worker `store`) for transcripts. Instance and
message persistence does not itself persist native Glove transcripts, memory, or
external files. These keep their existing Foundry persistence boundaries.

## Execution budgets and responsiveness

A worker's run is independent of the run that delegated to it. A parent can finish a
request while the worker continues; a question or result can later wake the originating
parent conversation. Models and run budgets can be chosen separately for each role.

`runTimeoutMs` sets a definition's run deadline; the existing default remains five
minutes. `maxConcurrentRuns` limits that definition's simultaneous runs. Set runtime
`execution.maxConcurrent` above the combined background limits to leave slots for
responsive agents. This is capacity control, not preemption or a latency guarantee.

## Inheritance and permissions

Nothing is inherited implicitly: no transcript, context, tools, applications, MCP,
playbooks, schedules, or memory. A reused definition retains its own explicit abilities.

- `context: true` copies instance context **once when provisioned**. Later parent
  edits do not overwrite worker state.
- `tools` selects always-on tools from the parent's `tools` resolver by exact name.
  They resolve in the child's context. Approval requirements remain intact. Installed
  shared tools are not copied by this selector; declare them on the worker or expose
  them through a restricted app.
- `memory: "shared"` reuses selected parent profiles with parent **agent-scoped**
  adapter identity and read-only tools. `"isolated"` uses the child's identity with the
  same profile definitions. Omit memory inheritance to retain only the worker's own
  profiles. Adapter factories must actually namespace storage by the supplied identity;
  a factory that ignores it cannot be isolated by Foundry.
- Memory objects can choose `profiles` and request `access: "curator"`; this never
  upgrades a parent reader surface. Read-only inheritance also removes ambient-context
  mutation tools. Custom `mount` profiles cannot be safely inspected and are rejected
  for inheritance. Shared memory is agent-scoped, not a copy of a parent conversation;
  its stable conversation scope is the parent's stable agent event conversation.
- `apps` borrows only currently installed parent applications, including their selected
  account and configuration. It is recomputed for each run, not copied into worker
  desired state. Removing the parent's installation revokes it. The persistent
  application data adapter is rechecked before borrowed app tool and account-session
  operations, including long-running workers. Already-running external effects cannot
  be undone by revocation.

`restrictApp(app, { tools, operations, transmissions })` is a restricted view of an
app's existing identity. Every list is an exact allowlist; omitted lists grant
nothing. Chaining modifiers intersects permissions. `tools` filters contributed tools;
`operations` gates `withAccountSession`; `transmissions` gates generated transmission
tools, inbound connections and outbound dispatch. Raw strings/unmodified apps in
`inherit.apps` grant none of these operations until restricted explicitly. Duplicate
child/inherited catalogue identities fail rather than letting an unrestricted entry
shadow a restricted one.

Outbound route grants/bindings remain separately required and are **not inherited**.
App modifiers cannot grant a route, acquire credentials, or disable tool approval.
The HTTP API remains protected by the application request-authorization adapter.

These are model capability boundaries, not a sandbox for hostile application code.
App installers, tool implementations, memory factories, `configure`, and cleanup hooks
are trusted code. For example, an app should use its supplied account-session adapter
instead of bypassing it with process-global credentials.

## Management and retention

```ts
const worker = client.subagent(parentId, "analysis");
const instance = await worker.ensure();
await worker.send("Include these three companies.");
const state = await worker.data();
const children = await client.subagents(parentId);
await worker.archive();
await worker.resume();
await worker.archive();
await worker.purge();
```

`data()` lists the instance, conversations, children, activations, pending messages, event journal records,
owned tasks and inbox items. Normal transcript and environment APIs work with its
instance/conversation IDs. Listing and inspection do not provision or reactivate it.

Archival marks the worker inactive first, archives existing descendants, disarms
schedules, and stops queued/running work. Its data and unfinished events remain. New
messages, delegation and direct runs fail while archived. Resume activates only the
selected worker and replays pending events. Descendants and paused schedules require
explicit resumption. Removing a declaration detaches existing workers; it does not
delete their records or prevent inspection/archival.

Purge requires archival, no running work, all descendants already purged, adapter
support, and an explicit idempotent `cleanup` hook for application-owned private
memory, transcripts and external files. Keep the declaration until cleanup finishes.
Use a no-op hook only when the application has no external worker data. Hook failure
preserves the archived records so cleanup can be retried.

The bundled adapters atomically remove owned conversations, pending deliveries, event records and deduplication receipts,
activations, VFS snapshots, tasks, inbox items and scoped environment data. Shared
workspace entries, parent memory and app accounts are never purged. A minimal instance
tombstone retains ownership and provisioning identity, preventing an old message or
retry from silently recreating the worker. Use a new name for a replacement. Execution
history and observability have their own retention; purge does not erase those logs
or third-party records.

The REST equivalents live under
`/api/agent-instances/:parent/subagents`: `GET` lists workers;
`POST /:name` ensures one; `POST /:name/messages` accepts `{ message, delivery? }`;
`GET /:name/data` inspects it; `POST /:name/archive`, `/resume`, and `/purge`
manage its lifecycle. The runtime exposes matching `subagent`, `listSubagents`,
`messageSubagent`, `subagentData`, `archiveSubagent`, `resumeSubagent`, and
`purgeSubagent` methods.

`POST /api/events` accepts `{ target: { agentId, conversationId }, event, policy? }`,
matching `runtime.emitEvent` and `client.emitEvent`. It uses the same application
request authorization as the rest of the HTTP API.

## Complete worked example

The [realtime front and durable researcher walkthrough](https://glove.dterminal.net/foundry/docs/durable-subagents/realtime-example)
applies these primitives in a runnable project with persistent stores, memory/app
inheritance, direct messages, task delegation, delivery policies and restart checks.
Source: `examples/foundry-durable-research`. The ownership and delivery model above
applies regardless of how the agents receive work.
