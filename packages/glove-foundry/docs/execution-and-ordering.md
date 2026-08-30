# Execution ownership and conversation ordering

> Status: **design exploration.** No code changes yet. This note records what
> Foundry's execution layer does today, what the Station packages underneath it
> already provide, and the one gap that has no owner — plus what the industry
> does about it.

## Why this note exists

Foundry's architecture doc promises that "the execution engine is private and
replaceable," and its production checklist asks deployments for "execution
leases, bounded concurrency, cancellation." A reader reasonably concludes that
Foundry runs multi-replica once you supply durable adapters.

It does not, today — but the reason is much smaller than it looks. Almost
everything needed already exists one layer down and is simply not reachable
from `defineApplication`.

## What is actually there

`FoundryRuntime`'s constructor (`src/runtime.ts`) wires the execution layer like
this:

```ts
this.scheduleAdapter = new ScheduleMemoryAdapter();
const signalAdapter = new MemoryAdapter();
// …
this.signalRunner = new SignalRunner({
  adapter: signalAdapter,
  stationId: "foundry-local",
  // …
});
```

Both adapters are hardcoded and neither is derived from the application's
`FoundryDataAdapter`. `stationId` is a constant string. Nothing about this is
configurable.

Underneath, `station-signal@2.2` is already a distributed queue:

| Capability | Where it lives |
| --- | --- |
| Atomic pending → running transition | `SignalQueueAdapter.claimRun(id, claim)` |
| Fencing token per attempt | `Run.leaseToken` — "only the holder may renew or complete this attempt" |
| Lease renewal, fenced | `renewRunLease(id, leaseToken, expiresAt)` |
| Fenced writes | `updateClaimedRun(id, leaseToken, patch)` |
| Crash recovery | `requeueExpiredRuns(now)` |
| Per-process identity | `SignalRunnerOptions.stationId`, `leaseDurationMs` |
| Cross-station concurrency caps | `networkCoordinator` + `.concurrency({ network })` |
| Drain gate | `canClaim()` |
| Mixed-capability fleets | `failUnknownSignals: false` |

And `station-adapter-postgres@2.2` implements every one of those methods. Its
`SchedulePostgresAdapter.claimDue()` carries the comment: *"Multiple runners
against the same database will not double-fire."*

So the schedule double-firing problem and the missing run leases are not
missing features. They are **features Foundry hides**.

## Gap 1 — the execution backend is not injectable

The fix is a seam on `defineApplication`, which already exists to "define
infrastructure" and is the one file in a Foundry project that is allowed to know
about deployment:

```ts
export default defineApplication({
  name: "my-app",
  data: myDurableDataAdapter,
  execution: {
    runs: new PostgresAdapter({ pool }),
    schedules: new SchedulePostgresAdapter({ pool }),
    stationId: process.env.REPLICA_ID,
  },
})
```

Defaults stay exactly as they are, so `pnpm dev` is unchanged and no existing
project breaks. What it buys: shared run queues across replicas, crash recovery
through `requeueExpiredRuns`, and schedules that fire once no matter how many
processes are running.

There is a vocabulary tension worth naming. Foundry's boundary rule says
"backend worker/network terminology must not leak into definitions." Typing this
field as Station's `SignalQueueAdapter` does leak Station into the public
surface — but into `foundry.application.ts`, which is infrastructure, not into
`agents/<route>/agent.ts`, which is the surface the rule protects. The
alternative — a Foundry-named adapter interface that Foundry adapts onto Station
— buys purity at the cost of a wrapper per method and an ecosystem of published
Station adapters that no longer plug in directly. **Recommendation: accept the
Station types in the infrastructure file, and keep the lint rule that forbids
them in agent files.**

## Gap 2 — nothing orders runs within a conversation

This one is real, and it has no owner today.

`SignalConcurrency` is `{ station?: number; network?: number }` — a *count*, not
a *key*. Nothing anywhere in the stack expresses "at most one run in flight for
this conversation." Two messages arriving on the same conversation can execute
concurrently against the same Glove store, and the second may compact or append
over the first.

Station cannot fix this alone: it has no concept of a conversation, and it
should not acquire one. Foundry has the concept but enqueues through
`triggerSignal` and never sees the claim decision. So the capability falls
between the two packages.

### How the industry solves it

Every mature system reduces this to the same primitive: **a partition key that
the queue itself serializes on.**

- **SQS FIFO** — `MessageGroupId`. Messages in one group are delivered strictly
  in order and a second is not delivered until the first is deleted or its
  visibility times out. Different groups run in parallel.
- **Kafka** — the partition key. One partition, one consumer, ordered.
- **Temporal** — workflow id. A second start against a live workflow id is
  rejected or queued by policy; the workflow is the serialization domain.
- **Oban (Postgres)** — `unique` + partitioned concurrency; the claim query
  filters on a key.
- **Sidekiq-unique-jobs / Resque** — a lock keyed by job arguments, taken at
  claim time.
- **Cadence/Temporal "sticky execution"** and **Akka/Orleans virtual actors** —
  the strongest form: route every message for an entity id to one owner.

Two properties are load-bearing in all of them, and any design here needs both:

1. The gate is **at claim time, in the queue**, not in application code after
   dispatch. Gating later means a worker is already burned and can starve.
2. The lock **expires**. A replica that dies mid-run must not wedge its
   conversation forever, which is why every implementation pairs the key with a
   visibility timeout or lease.

### Three ways to land it

**A. Partition key in `station-signal` (recommended).** Add an optional
`partitionKey` to `Run`, and have the claim query refuse a run whose key already
has a running attempt. In Postgres this is one predicate on the existing
`claimRun` statement — the same shape as SQS message groups. Foundry then maps
`conversationId` onto it and gets ordering for free, as would every other
Station user. Cost: a change in a second package and a new adapter method for
adapters that want it (optional, with the current behaviour as the fallback).

**B. Conversation slot on `FoundryDataAdapter`.** Foundry acquires a durable,
expiring slot keyed by conversation before `triggerSignal`, releases it on
completion, and holds back queued work. Keeps the change inside one package, but
Foundry ends up maintaining a second pending queue beside Station's — the exact
duplication the private-backend boundary exists to avoid.

**C. Cooperative deferral.** The run acquires the slot as its first act and
re-enqueues itself with backoff if it cannot. Smallest change, no new
interfaces, but it spends a child process per contended attempt and turns a
hot conversation into a retry storm.

A is the only one that puts the gate where the industry puts it. B is a
reasonable stopgap that can be deleted when A lands. C is not worth building.

## Suggested order

1. Make the execution backend injectable (Gap 1). Small, no design risk,
   unblocks durable multi-replica execution and fixes schedule double-firing
   using adapters that already ship.
2. Give `stationId` a real per-process default instead of the constant
   `"foundry-local"`, so two replicas are distinguishable in run ownership.
3. Decide A vs. B for conversation ordering (Gap 2) and implement it.
4. Document the multi-replica deployment shape, including that until step 3
   lands, conversation ordering is not guaranteed.

Steps 1 and 2 are worth doing regardless of how step 3 is decided.
