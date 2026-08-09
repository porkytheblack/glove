---
"glove-working-environment": minor
---

Idle worker reaping, and a lifecycle guide for hosts that hold many sessions.

An environment nobody is using was measured at ~16.5 MB and one OS thread of steady residency — five open environments at +82.5 MB and +5 threads, all of it returned on `close()` and none of it before. A host with a session per conversation had no built-in way to get any of it back, and the package's only guidance was "call `close()` when a session ends".

- **`execution.idleTimeoutMs`** (default 60000, `0` disables) terminates a worker nobody has used. The environment stays completely usable — tree, history and adapters untouched — and the next script spawns a replacement in ~82 ms, which is noise beside the model round trip that precedes any script. A busy worker is never reaped, the sweep is `unref`'d so it cannot hold the process open, and `close()` clears it.
- **`LIFECYCLE.md`** is the rest of the answer, which is a host policy rather than a knob: what an idle environment actually costs, a worked registry with a TTL *and* a live ceiling, close-on-idle with `snapshot()`/`fromSnapshot` as the resume path, exactly what a snapshot carries and what you re-supply (`stdlib`, `readOnlyPaths`, limits, callbacks), sizing `N × maxVfsBytes` and `N × execution.memoryMb`, and shutting down with a grace.

`examples/document-desk` adopts the pattern: desks carry `lastUsedAt`, are closed after fifteen idle minutes or past a ceiling of twelve, and are swept on an unref'd interval as well as per request — a request-driven sweep never runs on the host that has stopped receiving requests, which is the one with idle sessions to reap.
