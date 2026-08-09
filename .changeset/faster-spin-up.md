---
"glove-working-environment": minor
---

Three cheap wins on the way in: a lazy read-only adapter, a `/std` rewrite that only writes what changed, and a pool a host can pre-warm.

- **The validation-time adapter bindings are built on first use.** `create()` is called twice per adapter — once normally, once against a filesystem that refuses mutations, for write-time validation — and the second instance was ~4 ms of a 15.6 ms create, spent on an object a host that only mounts files and takes a snapshot never touches. It is now built when a worker first needs it. The read-WRITE instantiation still runs eagerly, so `create()` returning a non-object still fails at create; a factory that throws only on the read-only path now surfaces at the first validation instead, re-labelled to name the adapter and say which of its two instantiations failed.
- **`/std` and `/skills` are written only where they differ.** Both were wiped and rebuilt on every create — 32 identical writes and two recursive removes when restoring a snapshot the same host produced, which on `hostDirectory` are real writes and on `cachedRemote` are network round trips. The recursive remove now runs only when something is genuinely stale (an adapter the host dropped between sessions), which is the case it existed for.
- **`execution: { prewarm: true }` and `env.warmup()`.** A cold pool made the first script of a session pay for thread start-up — including the first script the model *writes*, since write-time validation runs in a worker too. Prewarm spawns in the background; `warmup()` is the same thing at a moment of the host's choosing, and can be awaited. Neither can fail a create: a spawn that does not come up leaves the pool exactly as it was, retried on demand with the pool's own backoff and named errors.

Measured on one box with three format adapters registered, medians over 25 iterations: create on a fresh tree **11.0 ms → 6.4 ms**, create restoring an identical snapshot **11.2 ms → 6.3 ms**, and the first action of a session (write a script, run it) **~300 ms cold against ~13 ms prewarmed**.
