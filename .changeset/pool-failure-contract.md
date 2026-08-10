---
"glove-working-environment": patch
---

Three ways the worker pool could hang or leak, all silent, all now bounded.

- A worker whose spawn fails left its slot in the pool, busy and never ready. It still counted against capacity, so at the default pool size of 1 every later `run_script` waited forever — with no deadline running, because the run deadline is only armed once a worker has been acquired. The slot is now removed and its thread terminated before the backoff.
- A worker that never signalled ready was awaited without a deadline, with the same outcome. `execution.readyTimeoutMs` (default 10s) now bounds it and the failure names the usual causes.
- `close()` woke the queued waiters, and a woken waiter found free capacity and spawned a worker *after* close — running the queued script on a thread nothing would ever terminate. Queued runs are now refused with a closed error.

A pool that cannot hand out a worker now resolves the run with the reason instead of throwing out of `runScript`.
