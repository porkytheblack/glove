---
"glove-working-environment": minor
---

Make one bad script survivable: scripts now run in supervised, terminable worker threads.

**`limits.runTimeoutMs` was advisory.** It was enforced three ways and all three missed the same case, because a `vm` timeout covers only a synchronous evaluation, a deadline race needs the event loop to turn, and a per-capability check needs the script to call something. A script that just computes satisfies none of them. Measured with a 3s limit: the run took 60,005ms, the host's 100ms timer fired *zero* times, and the run was then recorded as a success. One accidental `for (;;) { await null; }` from a model — and models write that — took down every agent sharing the process. After: 3,252ms, 32 host ticks, `ok: false`, and an error naming `limits.runTimeoutMs`.

Scripts execute in a pooled worker thread and `terminate()` is the backstop — the only mechanism that stops running code regardless of what it is doing. The supervision follows station-beacon's shape: exponential backoff on respawn, and a worker that had to be killed is destroyed rather than handed to the next run, so one runaway script cannot leave the environment permanently broken. Threads are pooled because spawning one costs ~40ms against ~0.5ms for a round trip; the default is one per environment, which is right for an agent loop that runs a script at a time.

**A time limit is no protection against allocation**, because the process dies before the deadline arrives. Measured inside the default 30s budget, a script pushing arrays in a loop reached 7.6 GiB of host RSS — and an OOM kill takes every other agent in the process with it. Workers now carry a heap ceiling (`execution.memoryMb`, default 256): V8 terminates just that thread, the pool replaces it, and the run fails naming the option. Same probe after: 237 MiB and 261ms.

That ceiling can be silently overridden — a process-level `--max-old-space-size` beats per-worker `resourceLimits` while still reading back the value you asked for. So the worker reports what V8 actually gave it and the environment warns once, naming the cause and the fix, because an operator who believes they have a ceiling and does not is the worst available outcome. Route it to your logger with `execution.onWarning`.

**`close()` drains.** An in-flight run gets a bounded grace (default 5s, `close({ graceMs })`) to reach its own end before its worker is terminated — a script part-way through writing its outputs leaves half a file behind, and on a host-directory filesystem that half file outlives the process. Past the grace it is terminated and `runScript` resolves with an error saying the environment was closed, rather than hanging for the rest of `runTimeoutMs`.

**Two contract changes for adapter authors**, both from the thread boundary a capability call now crosses:

- **Declare every binding `Promise<…>`**, including ones whose host implementation is synchronous. `auditAdapter` fails an adapter that doesn't, because a `.d.ts` reading `parse(text): Row[]` is what makes a model write `const rows = parse(text)` and get a promise — usually surfacing much later as an empty result rather than an error. Only flagged when every declaration of a name is synchronous, so overloads and same-named callback parameters cannot trip it.
- **Return data, not functions or live host objects.** A function cannot cross a thread; the attempt now fails naming your binding instead of hanging until the wall-clock limit.

`env:std` and `env:assert` are pure computation and run inside the worker rather than over RPC, so they stay synchronous: `json.parse(text)` still returns a value.

**Safer defaults.** `limits.maxVfsBytes` drops from 256 MiB to 128 MiB. With the default in-memory filesystem it is host heap, per environment, so a host running N agents in one process pays N times over. The asymmetry decides it: too low is a named error an operator raises in one line, too high is an OOM kill. Both this and `execution.memoryMb` now document that arithmetic where you set them.

Also fixed: host stack frames could reach sandboxed code. Frames were kept by matching `/(scripts|tmp|inbox|out)/` anywhere in the line as a proxy for "a VFS path" — but `out/` and `scripts/` are ordinary directory names in a real deployment, and host `/tmp` collides with VFS `/tmp` exactly. In production those frames would have named the host application's source layout to the one party the design exists to keep it from. Frames are now kept only when the file is one the executor handed to `vm.Script`.
