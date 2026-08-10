---
"glove-working-environment": patch
---

Concurrency hardening batch.

- `RunLog` and `VersionStore` cache the load *promise*, not just its result. A flag set before the first await let a second concurrent caller through against an empty index and write a version ring the real load was about to replace.
- `mount()` and `export()` copy their buffers. `InMemoryFs` stores and returns the buffer it is given, so a host that mounted a pooled read buffer, or wrote into what it exported, was editing the tree in place — no verb recorded, no version taken.
- `env.fs` refuses **mutations** after `close()` with a clear error. Reads, `export()` and `snapshot()` still work, because draining a closed environment is the correct flow.
- A freed worker is handed directly to the waiter that has been queued longest, rather than merely waking it and leaving the slot up for grabs.
- `hostDirectory` documents the one-environment-per-directory rule (two over the same directory corrupt each other's undo history through a shared version index and colliding blob ids), and `definePureModule` documents that a pure module must be stateless — it is a per-process, per-worker singleton shared across every environment and tenant.
