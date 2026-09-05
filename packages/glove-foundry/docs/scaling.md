# Scaling Foundry: Headquarters, stations, and where the ceiling actually is

> Status: **assessment.** No code changes. Written against `glove-foundry` at
> the execution-storage seam (`defineApplication({ execution })`),
> `station-signal@2.2`, `station-network@2.2`, `station-kit@2.2` and
> `station-adapter-postgres@2.2`.
>
> Every capacity figure below is a **model, not a measurement**. The structural
> findings are read from source and are solid; the arithmetic is there to show
> which limit binds first and roughly when. Measure before committing capital.

## The question

Can a Foundry application be spread across many Station execution stations
behind one Headquarters, and does that carry a system to ~100k users?

Short answer: **the topology is right and mostly already exists, but the limit
that binds first is not the one the topology fixes.** Station's fleet model
scales the *queue*. Foundry's execution model spawns an OS process per agent
run, and that is what runs out first — by roughly two orders of magnitude on
memory for work that is almost entirely I/O-bound. Worse, the two limits push
against each other: adding stations to relieve execution pressure increases
contention on the shared queue head.

## What Station already gives you

`station-network@2.2` defines the fleet directly:

```ts
export type StationRole = "headquarters" | "station" | "standalone";
```

and `station-kit`'s own description of the split:

> A network has one logical **Headquarters** and multiple execution
> **stations**. Headquarters accepts API requests, reconciles schedules and
> broadcasts, and shows fleet state. Stations advertise definitions and
> capacity, then atomically claim eligible signal runs and beacon instances
> from shared adapters.

`runRunners` defaults to `false` for Headquarters, so HQ is control plane and
stations are data plane. `StationNode` carries labels, capacity
(`maxConcurrent` / `activeRuns`), the definitions a station can actually run,
heartbeats and a lease. `SignalPlacement.labels` routes work to stations that
match; `SignalConcurrency` bounds a signal per-station and across the network,
backed by `ControllerLease` in `station-network`. Draining is a `canClaim()`
gate.

This is a real fleet design, and Foundry sits directly on top of it. Which
makes the first finding a small one with a large consequence.

### Foundry does not expose any of it

`FoundryRuntime` constructs its own `SignalRunner` and passes no `role`, no
`networkId`, no `networkCoordinator`, no `stationLabels`, no `canClaim`. Since
the execution-storage seam landed you can share a queue and a schedule store
across processes, and give each process its own `stationId` — which is enough
for several Foundry processes to claim from one queue. It is *not* enough to
be a Station Network: no HQ/station split, no placement, no network-wide
concurrency, no drain.

So today the achievable shape is "N identical Foundry processes sharing a
Postgres queue, each also serving its own API." That works. It is not
Headquarters, and the difference matters at the point where you want some
stations to run only certain agents.

**Seam needed:** extend `execution` with `role`, `network` (id, coordinator,
labels, endpoint) and a drain hook, mirroring `station-kit`'s `defineConfig`.
That is additive and small — the same shape as the storage seam.

## Where the ceiling actually is: one OS process per run

`station-signal` dispatches every run as a fresh process:

```ts
const child = spawn("node", nodeArgs, { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
```

Foundry registers each agent definition as a signal whose entrypoint is
`execution-agent.ts`, and that entrypoint `import()`s the agent file on every
run — which pulls in `glove-core`, the tool surface, MCP clients and the model
SDK, cold, per turn.

For batch work this is a good trade: hard isolation, no leaked state, a clean
module graph. For conversational agent turns it is the wrong shape, because
those turns are **I/O-bound**. A turn spends its life awaiting a model API. The
process is not computing; it is holding memory while it waits.

### The arithmetic

Little's Law: `concurrent runs = arrival rate × mean run duration`.

Parameters, stated so you can substitute your own:

| Parameter | Symbol | Model value |
| --- | --- | --- |
| Users | U | 100,000 |
| Agent runs per user per day | R | 20 |
| Peak-to-mean ratio | P | 4× |
| Mean run duration | D | 10 s |
| Resident memory per run process | M | ~250 MB (estimate) |
| Runs in flight per station | C | 25 |

- Mean arrival: `U × R / 86400` ≈ **23 runs/s**
- Peak arrival: `× P` ≈ **93 runs/s**
- Concurrent at peak: `93 × 10` ≈ **930 runs**
- Memory at peak: `930 × 250 MB` ≈ **233 GB**
- Stations required: `930 / 25` ≈ **37**

Push `D` to 30 s — not unusual for a multi-tool turn — and it becomes ~2,790
concurrent, ~700 GB, ~112 stations. Sustained spawn churn at peak is ~93
process starts per second, each paying a full cold module import.

None of that is impossible. It is just a very expensive way to wait on HTTP.

### What warm execution would cost instead

The same 930 concurrent turns, run as awaits inside long-lived processes, fit
comfortably in single digits of processes — they are I/O-bound, and Node holds
thousands of concurrent awaits without strain. The saving is on the order of
**100×** in memory and removes per-turn spawn latency entirely.

Glove already has this mode. `glove-continuum-signal` ships both:

> **Triggered (asynchronous)** — agents are cold by default. Each wakeup spawns
> a fresh subprocess.
> **Concurrent (synchronous)** — agents are warm in long-lived subprocesses.
> The runner keeps them alive and pushes notifications inline via
> `runner.notify(name, input)`; mid-loop pickup is immediate, no spawn latency.

…with a per-name restart budget so a warm pool degrades rather than dies. Its
README lists "Multi-runner coordination / warm-pool sharding" as the known
missing piece — which is exactly the gap between it and a Station fleet.

The trade is real and worth stating plainly: cold spawn buys per-run isolation.
A leaking tool, a poisoned global, or a native crash is contained to one turn.
Warm pools give that up in exchange for the memory. The sane resolution is not
to pick one globally but to make it **per definition** — a chat droid runs
warm, a document build or an untrusted-code tool runs cold.

## The second limit, which the first one makes worse

The Postgres queue adapter fetches due work like this:

```sql
SELECT * FROM runs
 WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= $1)
 ORDER BY created_at ASC
 LIMIT $2
```

Three properties matter at fleet scale:

1. **The claim is read-then-race.** Every station reads the same head of the
   queue and then races on `claimRun`, whose `WHERE status='pending'` guard
   makes the race *correct* but not *cheap*: with N stations, roughly
   `(N-1)/N` of claim attempts lose and retry.
2. **Placement is filtered client-side.** `SignalPlacement.labels` is checked
   in the runner *after* the rows come back. A label-partitioned fleet still
   has every station pulling rows it will discard.
3. **The batch is generous by design** — `max(maxConcurrent × 5, 100)`, so at
   least 100 rows per poll per station, at a 100 ms default interval.

At the 37 stations the execution model demands: `37 × 10 polls/s × 100 rows` ≈
**37,000 rows/s** read off one index range, most of them discarded, plus the
losing claim attempts. `getRunsRunning()` is unbounded and runs per station
every 30 s. Connection count is `stations × pool size` — 37 × 10 = 370, which
needs pgbouncer.

So the two limits interact badly: **the fix for execution pressure (more
stations) is the cause of queue pressure.** Warm execution breaks that coupling
by needing far fewer stations in the first place.

**Fixes, in order of value:**

- Narrow both queries server-side — an optional filter argument on
  `getRunsDue` (eligible signal names) and on `getRunsRunning` (this station's
  id), so a partitioned fleet reads only its own work instead of fetching and
  discarding its peers'. **Done** in
  [station#16](https://github.com/porkytheblack/station/pull/16).
- Remove the read-then-race with a one-statement select-and-claim. Harder than
  it looks, see below.

A correction to an earlier draft of this note: adding `FOR UPDATE SKIP LOCKED`
to `getRunsDue` **would not help.** It is a read on a pooled autocommit
connection, so its row locks release before the claim is attempted — the race
is unchanged. The real fix is a single statement that selects and claims
together:

```sql
UPDATE runs SET status = 'running', … 
 WHERE id = (SELECT id FROM runs WHERE … ORDER BY created_at
             FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *
```

That collides with retry backoff, which the runner computes client-side from
`attempts`, `lastRunAt` and its own `retryBackoffMs` rather than storing in
`nextRunAt`. A one-statement claim cannot apply it, so this needs either
backoff encoded in SQL or moved into `nextRunAt` at failure time — a behaviour
change worth deciding on its own.

## A Foundry-specific hazard at this scale

`FoundryRuntime.reconstructActivations()` reads **every** pending activation at
boot and arms it locally:

```ts
for (const activation of await Effect.runPromise(this.data.listActivations())) { … }
```

At 100k users with per-user schedules and sleeping runs, that is potentially
hundreds of thousands of rows read by every process, on every deploy. With a
shared schedule store the `claimDue` compare-and-swap keeps firing correct, so
this is a startup-cost and memory problem rather than a correctness one — but
it is the kind that turns a rolling deploy into an outage.

It wants: workspace/shard-scoped activation listing, and arming only on
stations that own the shard.

## The shape that actually scales: shard the queue, not just the workers

`networkId` exists in `station-network`, which means multiple independent
Station Networks can run side by side — each with its own Headquarters, its own
stations, and **its own queue table**. That is the real horizontal escape
hatch, and it is the one that survives 100k users:

```
                    ingress (stateless, load-balanced)
                                 │
              consistent hash on workspaceId → shard
                    ┌────────────┼────────────┐
                 shard A       shard B      shard C
                 HQ + N        HQ + N       HQ + N
                 own queue     own queue    own queue
```

Sharding by workspace rather than by user keeps a tenant's conversations,
schedules and activations inside one network, which means ordering and
locality stay a local problem. It also caps every figure above per shard: ten
shards turn "37 stations against one hot index" into "4 stations against ten
independent ones", and the queue contention analysis stops mattering.

This is also why the conversation-ordering decision — that ordering is the
application's job — holds up at scale: with workspace-sharded networks, an
application's ordering policy is enforced within a shard it fully controls.

## Assessment

**Can Foundry run behind Headquarters with many stations?** Structurally yes;
Station provides the whole fleet model. Foundry needs one more additive seam
(role, network identity, labels, drain) beyond the storage seam that already
landed. That is small work.

**Does that carry 100k users?** Not on its own. In rough order of what binds
first:

1. **Process-per-run.** The dominant cost, ~100× more memory than the work
   needs. Wants per-definition warm execution, which Glove already has in
   `glove-continuum-signal` but Foundry does not use.
2. **Queue contention.** Server-side query narrowing is done
   ([station#16](https://github.com/porkytheblack/station/pull/16)); the
   read-then-race remains, and needs the backoff question settled first.
3. **Boot-time activation reconstruction.** Needs shard-scoped listing before a
   deploy at this size is safe.
4. **Everything else** — connection pooling, unbounded running-run sweeps —
   is ordinary operational tuning.

**The recommendation:** do not try to reach 100k users by adding stations to
one network. Shard into workspace-partitioned networks first, because it caps
every other limit; then make execution warm per definition, because it is where
the money is; then settle the claim query, which is less nearly-free than this
note originally claimed.

**Before any of it, measure.** The two numbers that decide everything here are
mean run duration and resident memory per run process. Both are properties of
your agents, not of Foundry, and both are cheap to obtain from a single station
under real traffic.
