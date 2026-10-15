---
"glove-foundry": patch
---

Runtime fixes:

- **`PUT /api/installations` keeps `accountId`.** The HTTP installation surface (and `client.install` / `client.uninstall`) dropped the account selection, so an application installed over HTTP lost its account. A non-string `accountId` is now rejected with 400.
- **`/health` and `/health/detailed` answer 503 when `ok` is false.** They returned 200 even when the execution daemon or scheduler failed its ping, so status-code probes never saw an outage. The body is unchanged, `client.health()` still resolves with `ok: false` instead of throwing, and the inspector keeps showing "Runtime needs attention".
- **Subagent `layers` and `subscribers` are mounted.** `defineSubagent` accepted both but never mounted them. They now mount on each invocation (layers accept `configureLayer(layer, config)`), before `configure`, and are disposed when the subagent's request ends.
- **Steering no longer overlaps the interrupted run.** Station marks a cancelled run `cancelled` before its process exits, and the process keeps running `unAbortable` tools and cleanup after SIGTERM, so `steer()` started the replacement while the old process could still change the conversation. Each run's process now reports when it lets go of the conversation, and `steer()` waits for that (at most 10 s; the daemon kills the process 5 s after the stop) before it starts the replacement.
