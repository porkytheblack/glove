---
"glove-core": minor
"glove-execution": minor
"glove-foundry": minor
---

Add adapter-backed browser scripting and persistent sandbox mounts, with Station 3 as the first backend. These optional capabilities use the existing mount approach without adding browser, sandbox or Station dependencies to glove-core. Foundry adds generic mount cleanup registration and moves agent jobs into a separate managed Station daemon process. Foundry requires Node 22+; the capability mount entrypoint remains portable. The daemon remains local and managed by Foundry; external browser/sandbox workers retain their own lifecycles.

Add retained browser scopes, a portable UTF-8 sandbox writeText operation, and a general-purpose Foundry Operator example with real browser/server verification and illustrated site documentation.

Runtime context providers now accept portable native content parts as well as text. Browser mounts use this transient channel without accepting or replacing the agent model; media bytes and URLs are omitted from runtime-context telemetry.

Add optional application-level stationDaemon configuration. The managed Station can host browser and sandbox provider adapters alongside agent jobs, with one resource factory per daemon, private connection delivery, and startup/shutdown cleanup. Operator now uses this single-instance path.

Serialize scheduled activation transitions across daemon acknowledgements and asynchronous storage so pause, update and cancellation cannot be overwritten by stale dispatch or completion writes.
