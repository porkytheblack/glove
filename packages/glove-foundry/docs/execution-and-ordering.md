# Execution ownership and conversation ordering

> Status: **decided and implemented.** Execution storage and fleet role are now
> application choices (`defineApplication({ execution })`). Conversation
> ordering is deliberately **not** a framework concern — see "Ordering is the
> application's call" below.

## Why this note exists

Foundry's architecture doc promises that "the execution engine is private and
replaceable," and its production checklist asks deployments for "execution
leases, bounded concurrency, cancellation." A reader reasonably concludes that
Foundry runs multi-replica once you supply durable adapters.

It did not, and the reason was much smaller than it looked: almost everything
needed already existed one layer down and was simply not reachable from
`defineApplication`. This note records what was there, what changed, and the
one thing deliberately left to applications.

## What was already there

`FoundryRuntime`'s constructor used to wire the execution layer like this:

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

Both adapters were hardcoded, neither was derived from the application's
`FoundryDataAdapter`, and `stationId` was a constant. None of it was
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

So the schedule double-firing problem and the missing run leases were never
missing features. They were **features Foundry hid**.

## Execution storage is now an application choice

The seam lives on `defineApplication`, which already exists to define
infrastructure and is the one file in a Foundry project allowed to know about
deployment:

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

Every field is optional and the defaults are unchanged, so `pnpm dev` behaves
as before and no existing project breaks. What supplying them buys: a run queue
several processes can claim from, crash recovery through `requeueExpiredRuns`,
and a due schedule that fires once however many processes are running.

Two details are load-bearing.

**Ownership follows construction.** `SignalRunner.stop()` closes its adapter
unconditionally — right for one Foundry built, wrong for one the application
did, since that adapter may share a connection pool with the data adapter and
closing it would take the application's storage down with the runtime. A
supplied run queue is therefore borrowed: Foundry uses it and never closes it.
The schedule store follows the same rule.

**`stationId` is per-process, not a constant.** It used to be the literal
`"foundry-local"`, which is fine while runs never leave the process that made
them and wrong the moment they do — two processes claiming under one identity
cannot tell each other's abandoned work apart. The default is now
`foundry-<host>-<pid>-<random>`. A deployment that can name its replicas should
set it explicitly, so a lost run is traceable to the process that lost it.

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

## Ordering is the application's call

There is a second thing the stack does not do, and after discussion it is
staying that way — recorded here so the absence reads as a decision rather than
an oversight.

`SignalConcurrency` is `{ station?: number; network?: number }` — a *count*, not
a *key*. Nothing anywhere in the stack expresses "at most one run in flight for
this conversation." Two messages arriving on the same conversation can execute
concurrently against the same Glove store, and the second may compact or append
over the first.

**Foundry does not serialize runs within a conversation, and will not.**
Whether two messages on one conversation may run at once is a product decision,
not a runtime invariant: a support agent wants strict ordering, a batch
classifier wants maximum parallelism, and a note-taker is happy with
last-write-wins. A framework that picks one imposes latency on the apps that
wanted another, and picks wrongly for a good fraction of them.

The application already holds every seam it needs to decide for itself. It owns
the `FoundryDataAdapter`, so it can keep a per-conversation lease beside its own
tables; it owns the store behind each conversation; and it owns the ingress that
calls `request`, so it can queue, coalesce, or drop at the door. Concretely, an
application that wants strict ordering takes an expiring lease keyed by
conversation before calling `request` and releases it when the run settles —
roughly twenty lines against storage it already runs.

### Prior art, for whoever builds it

Every mature system reduces this to the same primitive: **a partition key that
the queue itself serializes on.** An application implementing its own policy
should borrow the shape rather than invent one.

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

Two properties are load-bearing in all of them, and any implementation needs
both:

1. The gate is **as early as possible** — ideally at claim time, and at worst
   before dispatch. Gating after a worker has started means the worker is
   already burned and can starve.
2. The lock **expires**. A process that dies mid-run must not wedge its
   conversation forever, which is why every implementation pairs the key with a
   visibility timeout or lease.

### If it ever does belong in the stack

Should the same policy show up in enough applications to look like a default,
the place for it is a partition key in `station-signal`, not a queue inside
Foundry: an optional key on `Run`, with the claim query refusing a run whose key
already has a running attempt. In Postgres that is one predicate on the existing
`claimRun` — the same shape as SQS message groups — and every Station user would
get it, not just Foundry. Building it inside Foundry instead would mean Foundry
maintaining a second pending queue beside Station's, which is the duplication
the private-backend boundary exists to prevent.

That is a future option, not a plan.

## Roles: Headquarters and stations

Storage alone lets several processes share a queue. It does not make them a
fleet — every process would still reconcile every schedule and arm every
pending activation. The role split fixes that:

```ts
// Headquarters — serves the API, reconciles schedules, claims nothing.
defineApplication({
  name: "my-app",
  execution: {
    runs, schedules, role: "headquarters", stationId: "hq-1",
    network: { id: "prod", adapter: networkAdapter },
  },
})

// Station — claims and executes; reconciles nothing.
defineApplication({
  name: "my-app",
  execution: {
    runs, schedules, role: "station", stationId: process.env.REPLICA_ID,
    network: { id: "prod", adapter: networkAdapter, labels: { region: "ke" } },
    canClaim: () => Promise.resolve(!draining),
  },
})
```

`standalone` remains the default and still does both, so nothing changes for
an existing project or for `pnpm dev`.

The planes follow Station's own derivation:

| | control plane | execution plane |
| --- | --- | --- |
| `headquarters` | yes | no |
| `station` | no | yes |
| `standalone` | yes | yes |

Headquarters still runs the poll loop — the schedule reconciler rides its
cadence — but advertises `maxConcurrent: 0`, so it reconciles without claiming.

**This is what makes boot safe at size.** `reconstructActivations()` reads
every pending activation and arms it locally. Run that on twenty stations and
a deploy re-arms the whole system twenty times; `claimDue` keeps it *correct*,
but the cost is multiplied exactly when it hurts. Only the control plane arms,
so adding stations no longer adds boot-time work.

With a `network.adapter` a process registers itself, heartbeats its capacity
and labels, and announces departure on stop rather than waiting out its lease.
Labels are what `SignalPlacement` matches, and the adapter is what network-wide
concurrency coordinates through. Without one, a non-standalone role warns and
runs blind — correct alone, invisible to peers.

## Where this leaves things

Done:

1. Execution storage is injectable via `defineApplication({ execution })`.
2. `stationId` defaults to a real per-process identity.
3. Supplied adapters are borrowed, never closed by the runtime.
4. Roles split the control and execution planes, so only Headquarters
   reconciles schedules and arms activations.
5. Fleet membership: registration, heartbeat, labels, capacity, drain gate,
   and a clean departure on stop.

Not done, by decision: conversation ordering. An application that needs it
implements it, and the prior art above says how.

Still open, and measured rather than guessed in
[`scaling.md`](./scaling.md): execution is one OS process per run, which is the
limit that binds first well before the queue does.
