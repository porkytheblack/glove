# Environment lifecycle for a multi-tenant host

`createWorkingEnvironment()` is cheap. Keeping the result is not.

This is the guide for hosts that hold more than one environment at a time — a
chat server with a session per conversation, a per-tenant desk, anything where
the number of live environments is a function of how many people have a tab
open rather than how many are working. Everything here is a host-side decision;
none of it changes what the model sees.

## What an environment costs while nobody is using it

Measured on Node 22, an environment with the four format adapters registered,
nothing running:

| | per environment | returned by |
|---|---|---|
| Worker thread + its heap | ~16.5 MB, 1 OS thread | `close()`, or `execution.idleTimeoutMs` |
| The tree (in-memory filesystem) | its own bytes, up to `maxVfsBytes` | `close()` |
| Version rings + run history | inside the tree, bounded by `maxVersionsPerFile` / `maxHistoryLines` | `close()` |
| Adapter-held resources (a warm browser, a decoder) | adapter-specific | `close()` → `adapter.close()` |

Five open environments measured at **+82.5 MB and +5 threads**, all of it
returned on `close()` and none of it before. That is the shape of the problem:
it is not a leak, it is residency. A host holding two hundred idle sessions is
paying for two hundred conversations that nobody is having.

The tree is the part that is genuinely yours to size (`limits.maxVfsBytes` is
host heap under the default in-memory filesystem, and it is *per environment*).
The rest of this guide is about not holding it.

## Level 1 — idle workers reap themselves

Default, nothing to wire:

```ts
execution: { idleTimeoutMs: 60_000 }   // the default; 0 keeps workers forever
```

A worker that has not run anything for a minute is terminated. The environment
stays completely usable — its tree, history and adapters are untouched — and
the next script spawns a replacement, which takes ~82 ms. That is noise beside
the model round trip that precedes any script, which is why the trade is on by
default.

Raise it if you are running a latency-critical single-tenant host and would
rather hold the thread. Set `0` to opt out entirely.

This reclaims the thread and its heap. It does **not** reclaim the tree, and it
is not a substitute for closing.

## Level 2 — close on idle, resume from a snapshot

The rest only comes back on `close()`, so a long-lived host needs a policy for
when a session is over. The one that works is: **treat a snapshot as the
session, and the live environment as a cache of it.**

```ts
interface Session {
  env: WorkingEnvironment;
  lastUsedAt: number;
}

const live = new Map<string, Session>();
const parked = new Map<string, EnvSnapshot>();   // or Redis, S3, a table

const IDLE_MS = 15 * 60_000;
const MAX_LIVE = 50;

async function session(id: string): Promise<WorkingEnvironment> {
  const found = live.get(id);
  if (found) {
    found.lastUsedAt = Date.now();
    return found.env;
  }
  const env = await createWorkingEnvironment({
    // The resume path. An absent snapshot is a new session — `fromSnapshot`
    // is the only difference between the two.
    ...(parked.has(id) ? { filesystem: fromSnapshot(parked.get(id)!) } : {}),
    stdlib: [documents(), spreadsheets(), images()],
    execution: { prewarm: true },
  });
  live.set(id, { env, lastUsedAt: Date.now() });
  return env;
}

async function park(id: string): Promise<void> {
  const found = live.get(id);
  if (!found) return;
  live.delete(id);
  parked.set(id, await found.env.snapshot());   // snapshot BEFORE close
  await found.env.close();
}

/** Run on a timer (unref'd) and after each request. */
async function sweep(): Promise<void> {
  const now = Date.now();
  for (const [id, s] of live) if (now - s.lastUsedAt > IDLE_MS) await park(id);
  // A ceiling as well as a TTL: a burst of traffic can put more sessions in
  // flight than the host can afford long before any of them go idle.
  const over = [...live.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  for (const [id] of over.slice(0, Math.max(0, live.size - MAX_LIVE))) await park(id);
}
```

Three things that are easy to get wrong:

- **Snapshot before you close, not after.** `close()` shuts the worker pool and
  disposes adapters; `snapshot()` needs neither, but a closed environment is not
  a usable one and the ordering has to be deliberate.
- **A sweep on a timer AND on request.** A request-driven sweep never runs on
  the host that has stopped receiving requests — which is exactly the host with
  idle sessions to reap. Unref the timer, or it holds the process open.
- **Cap the live set as well as the age.** A TTL alone lets a burst put more
  environments in flight than the box can hold.

### What survives the round trip, and what you re-supply

`snapshot()` serializes **the tree, and only the tree** — files, scripts, their
generated `.d.ts` siblings, `/skills`, `/std`, the per-file version rings and
`/.env/history.jsonl`. So the agent's script library, its undo history and its
run log all come back.

Everything that is a *host wiring decision* is not in the snapshot and must be
passed again on restore:

| Re-supply on restore | Why it is not stored |
|---|---|
| `stdlib` | Adapters are host objects, not data. A tree restored without one it used reports it on `env.warnings` rather than breaking mid-task; `strictAdapters: true` makes it throw. |
| `readOnlyPaths` | A zone is a policy, not a fact about the tree. |
| `vision`, `onPresent`, `onAsk`, `onVerb`, `execution.onProgress` | Callbacks into the live host. |
| `limits` | Sized for the host, which may have changed. |

The conversation is not in here either — that belongs to the agent's own store
(`MemoryStore`, or whatever you gave `Glove`). Park both together or you will
resume a tree with no memory of why any of it exists.

### What restoring costs

An identical restore is cheap on purpose. `/std` and `/skills` are regenerated
on every create, but only *written* where the bytes differ, so restoring a tree
the same host produced writes nothing at all — which matters most when the
filesystem is `hostDirectory` or `cachedRemote`, where every avoided write is a
real one. A dropped adapter still triggers a full sweep of `/std`, because docs
describing a capability that no longer exists are worse than no docs.

## Level 3 — pay the spin-up where nobody is waiting

A cold pool makes the first script of a session pay for thread start-up — and
that includes the first script the model *writes*, since write-time validation
runs in a worker too.

```ts
const env = await createWorkingEnvironment({ …, execution: { prewarm: true } });
```

The spawn happens in the background; `createWorkingEnvironment` returns as soon
as the tree is ready. Measured on the same box: first action **~300 ms cold**
against **~13 ms prewarmed**.

`env.warmup()` is the same thing at a moment of your choosing — after restoring
a snapshot, or while the first model turn is already in flight — and can be
awaited. Neither can fail a create: a spawn that does not come up leaves the
pool exactly as it was, to be retried on demand with the pool's own backoff and
named errors.

Prewarm and `idleTimeoutMs` compose the way you would want: prewarm pays the
spawn when the session starts, the reaper takes it back if the session turns
out to be over.

## Sizing the box

Two of the limits are per-environment claims on the host, and a host running N
agents in one process pays N times:

- `limits.maxVfsBytes` (default 128 MiB) is **host heap** under the default
  in-memory filesystem.
- `execution.memoryMb` (default 256) is a **worker thread's heap**, claimed
  only while a worker exists — so `idleTimeoutMs` bounds how many of those you
  are holding at once, not just how many sessions exist.

Both defaults err low deliberately. Too low is a named error an operator raises
in one line; too high is an OOM kill that takes every other agent in the
process with it.

For a tree that genuinely outgrows the heap, move it off the heap rather than
raising the cap — `hostDirectory(dir)` for a real directory,
`cachedRemote(store, { prefix })` for object storage. Both keep `snapshot()`
working; `cachedRemote` also wants a **per-session prefix**, because there is
no distributed locking and two hosts on one prefix would race on version rings
and run history.

## Shutting the host down

`close()` gives an in-flight run a bounded grace (5s by default,
`close({ graceMs })` per call) to reach its own end before its worker is
terminated — so a script part-way through writing its outputs finishes the
file rather than leaving half of one behind. That matters most when the
filesystem is a real directory, where the torn file outlives the process.

Past the grace, the worker is terminated and its `runScript` resolves with an
error saying the environment was closed. Nothing is left hanging. Adapters are
disposed after the pool, never before — an in-flight run given its grace may
still be calling into one.

```ts
process.on("SIGTERM", async () => {
  await Promise.all([...live.values()].map((s) => s.env.close({ graceMs: 2_000 })));
  process.exit(0);
});
```

## A checklist

- [ ] `execution.idleTimeoutMs` left at its default, or set deliberately
- [ ] Sessions have a `lastUsedAt` and a TTL sweep, on a timer **and** per request
- [ ] The live set has a ceiling as well as a TTL
- [ ] `snapshot()` before `close()`, both stored with the conversation
- [ ] `stdlib`, `readOnlyPaths`, `limits` and the callbacks re-supplied on restore
- [ ] `execution.prewarm` (or `env.warmup()`) on the resume path
- [ ] `N × maxVfsBytes` and `N × execution.memoryMb` fit in the box
- [ ] SIGTERM closes the live environments with a grace
