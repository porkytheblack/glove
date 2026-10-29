# glove-foundry

## 0.6.0

### Minor Changes

- Durable approvals. A pending approval is stored on the data adapter (`putApproval`, `listApprovals`, `settleApproval`, `noteApprovalResume`), which `FileFoundryDataAdapter` and `MemoryFoundryDataAdapter` implement. A file-backed adapter still has the record after a process restart or redeploy. Resolving it then starts a continuation run in the same conversation; the tool runs only when the decision is approve. Deny, expiry, an explicit cancel, and steer still fail closed. Shutdown and the run timeout do not decide the approval, so the wait is not capped by the five-minute run timeout.

  - `defineApplication({ approvals: { timeoutMs } })` sets a millisecond limit (at least one second, no maximum). Omit it, or pass `null`, and the approval does not expire. `FoundryApproval.expiresAt` is `null` in that case. This replaces the fixed five-minute expiry and the ten-minute cap.
  - `needsResume` and `resumeRunId` record that the original run is gone and name the continuation. The continuation request payload is `{ foundryApproval: { id, status, toolName, toolInput } }`.
  - A custom `FoundryDataAdapter` that does not implement the new methods keeps the temporary-directory channel. That directory is still deleted when the runtime stops, so those approvals do not survive a restart. `MemoryFoundryDataAdapter` implements the methods but does not survive a process exit.
  - `createFoundryApproval` no longer defaults to five minutes or clamps the timeout at ten. Omitting `timeoutMs` means no expiry.
  - Permission prompts are the approval wait. Other `pushAndWait` renderers stay on the in-memory display stack.

- [#215](https://github.com/porkytheblack/glove/pull/215) [`92eb292`](https://github.com/porkytheblack/glove/commit/92eb292314d0420fa73a8ad868b7066e6c192d37) Thanks [@porkytheblack](https://github.com/porkytheblack)! - One run at a time per conversation, and durable inbound events.

  - A conversation never has two runs acting on it at once. A run asked for while another holds the conversation (a second message, a schedule firing, a flushed delivery) waits in arrival order and starts once the run ahead has settled and its process has let go. Different conversations still run in parallel.
    - A run the runtime starts waits parked in the execution queue. It has an id and stays `pending`, holds no concurrency slot, and starts from an envelope built when its turn comes. Time spent waiting does not count against `waitForRun` timeouts, so the OpenAI-compatible endpoint no longer fails on a queued request.
    - A run created inside the execution queue (a schedule firing) asks for the conversation in its process and waits there before it reads any history.
    - Steering holds the conversation through the cancel, and its replacement goes ahead of anything already waiting. Cancelling a waiting run removes it.
  - An inbound transmission event for a thread whose run is still working no longer starts a second run beside it. It joins that run's turn at the next tool step as the same `<transmission>` message. If it arrives during the final answer, it starts the thread's next run once the thread is free, together with anything else that arrived meanwhile (`source.kind` `"transmission"`). `dispatchInbound` returns the run handling the event, which for a busy thread is the one that holds it.
  - Every run now listens on its conversation, so anything delivered to it can join its turn.
  - Pending inbound events: from dispatch until the run that handled it settles, an event is kept in the data adapter, and on startup any still pending are delivered again in arrival order. Runs stopped by shutdown keep theirs. `FileFoundryDataAdapter` and `MemoryFoundryDataAdapter` implement it. The new `FoundryDataAdapter` methods `putPendingInbound`, `deletePendingInbound` and `listPendingInbound` are optional, so custom adapters without them work as before, minus the restart guarantee. New exported types: `FoundryPendingInbound`, `FoundryTransmissionDelivery`.
  - Deliveries held until a run starts listening are now marked handed over. Before, a delegation update delivered that way could be handed over again after a restart.

- [#197](https://github.com/porkytheblack/glove/pull/197) [`91a8254`](https://github.com/porkytheblack/glove/commit/91a82546168dbf2f170d2e9fb2727ce70912f19b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Layered agents and voice calls.

  - `defineAgent({ delegates })` names sibling agents by route. The delegating agent gets `glove_foundry_delegate` and `glove_foundry_reply`. A run working on a delegated task gets `glove_foundry_ask`. Each delegation runs as its own conversation on a worker instance, one per delegating instance and route.
  - Results, questions and failures come back to the conversation that delegated. They go straight into a run that listens with `ctx.onDelegationUpdate`. Otherwise they wait until the conversation is free and start one run, as `<delegation>` messages.
  - A worker's question waits `answerWaitMs` (90 s by default) inside its run, then the run suspends with `suspension.kind: "question"`.
  - Open delegations appear in the delegating agent's runtime context. `runtime.listDelegations()` lists them all.
  - Deliveries that are still owed are recorded on the delegation and handed over again when the runtime restarts.
  - New `glove-foundry/voice` subpath. `voiceCall({ room, greeting })` runs an agent as a live call over `RealtimeAgent`: it saves the transcript, speaks delegation updates at the next pause, and keeps Foundry's bookkeeping tools and approval-gated tools off the call. `webSocketRoom({ port, token })` is a built-in room serving PCM16 over one WebSocket.

- [#215](https://github.com/porkytheblack/glove/pull/215) [`f90dabf`](https://github.com/porkytheblack/glove/commit/f90dabffa1d2e4071c6ce8401a2379d903cc5725) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Delegation updates join the turn that is still working. A run with delegates, open delegations or a delegated task of its own now listens on its conversation for as long as it lasts. A result, question or failure that arrives while the delegating turn is still calling tools joins it at the next tool step as a Glove event, which reads as the same `<delegation>` message a new run would start with and is saved after the tool results. The open-delegations runtime context stops listing a delegation once its result is in. Follow-up replies reach a worker that is still working the same way, and an answer that reaches a worker's turn after `glove_foundry_ask` gave up no longer leaves the run suspended. Updates the run did not read go back to the runtime when it ends and start one new run, as before. `ctx.onDelegationUpdate` handlers take updates first, including any that arrived before they registered. Every listener in a run now shares one mailbox reader, so a worker's reply is no longer lost to an update handler reading the same mailbox.

  Foundry's per-run Glove never wakes itself: events emitted while no turn runs wait for the run's next request.

### Patch Changes

- [#211](https://github.com/porkytheblack/glove/pull/211) [`d1d9508`](https://github.com/porkytheblack/glove/commit/d1d95086ce5738619e3eddaa66dfbd1abfe4d2e1) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `contextProviders` entries can be `{ provider, delivery: "request" | "history", key }` as well as bare providers (`FoundryContextProvider`). `goals` and `forms` options accept glove-memory's new `delivery`. `outbound.requiresPermission` and programmatic-workflow tool gates accept async predicates.

- [#214](https://github.com/porkytheblack/glove/pull/214) [`8f23ff0`](https://github.com/porkytheblack/glove/commit/8f23ff02cae75d1cbf447e8b601349ba70154a08) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Mesh messages can arrive as Glove events instead of inbox items.

  - `mountMesh` takes `delivery: "inbox" | "events"`. The default stays `"inbox"`, so existing integrations are unchanged; `"events"` needs a runnable with `emitEvent` and `addContextProvider` (glove-core 4.4).
  - With events, an incoming message or broadcast is emitted as a Glove event (`source: "mesh:<from>"`, `kind: "direct" | "broadcast" | "reply"`). It joins a running loop at the next tool step. An idle agent wakes for it, or it waits for the user's next message, per the Glove's event policy and the new `whenIdle` option. The model sees it as escaped XML marked as outside information, and re-deliveries of a message id are dropped. Blocking sends wait in memory and show as `<mesh_waiting>` runtime context until the ack or reply, which arrives as an event. No inbox methods are needed on the store.
  - Agents can now react to each other without a person prompting them. Use a Glove `events.policy` (by `source`) or `whenIdle: "defer"` to keep them from waking each other in a loop.
  - `ToolContext` has `waits` (a `PendingWaits`) instead of `store` and `pending`. `inboxWaits` and `EventWaits` are exported for custom tool composition.
  - Foundry mounts mesh with `delivery: "inbox"`: it builds a runnable per run, so messages that arrive between runs must wait in the conversation store.

- Updated dependencies [[`d1d9508`](https://github.com/porkytheblack/glove/commit/d1d95086ce5738619e3eddaa66dfbd1abfe4d2e1), [`d1d9508`](https://github.com/porkytheblack/glove/commit/d1d95086ce5738619e3eddaa66dfbd1abfe4d2e1), [`c6f6cb4`](https://github.com/porkytheblack/glove/commit/c6f6cb4bb1c81357ca16f9fa043890cc0a9ff325), [`8f23ff0`](https://github.com/porkytheblack/glove/commit/8f23ff02cae75d1cbf447e8b601349ba70154a08)]:
  - glove-core@4.4.0
  - glove-memory@2.3.0
  - glove-mesh@0.2.0
  - glove-facts@0.1.5
  - glove-js@0.5.3
  - glove-lisp@0.5.3
  - glove-mcp@1.2.3
  - glove-python@0.4.3
  - glove-voice-s2s@0.4.3
  - glove-working-environment@0.7.0

## 0.5.2

### Patch Changes

- [#190](https://github.com/porkytheblack/glove/pull/190) [`7cddd00`](https://github.com/porkytheblack/glove/commit/7cddd00e06d559f31908a9d5081577e711623f95) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Runtime fixes:

  - **`PUT /api/installations` keeps `accountId`.** The HTTP installation surface (and `client.install` / `client.uninstall`) dropped the account selection, so an application installed over HTTP lost its account. A non-string `accountId` is now rejected with 400.
  - **`/health` and `/health/detailed` answer 503 when `ok` is false.** They returned 200 even when the execution daemon or scheduler failed its ping, so status-code probes never saw an outage. The body is unchanged, `client.health()` still resolves with `ok: false` instead of throwing, and the inspector keeps showing "Runtime needs attention".
  - **Subagent `layers` and `subscribers` are mounted.** `defineSubagent` accepted both but never mounted them. They now mount on each invocation (layers accept `configureLayer(layer, config)`), before `configure`, and are disposed when the subagent's request ends.
  - **Steering no longer overlaps the interrupted run.** Station marks a cancelled run `cancelled` before its process exits, and the process keeps running `unAbortable` tools and cleanup after SIGTERM, so `steer()` started the replacement while the old process could still change the conversation. Each run's process now reports when it lets go of the conversation, and `steer()` waits for that (at most 10 s; the daemon kills the process 5 s after the stop) before it starts the replacement.
  - **`runtime.stop()` no longer leaves a provider connection running.** A reconcile that landed during shutdown (for example a run's playbook sync, handled in the background) could start an application connection after `stop()` had stopped them all. Connections run until interrupted, so the process could not exit. The connection supervisor now refuses new connections once it is stopped.

- [#189](https://github.com/porkytheblack/glove/pull/189) [`e91723c`](https://github.com/porkytheblack/glove/commit/e91723c002f4cd870135f2858586afe5c368bdb5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Starter templates now work end to end on their first run:

  - **Conversation history survives between messages.** Every run executes in its own process, so the templates' `new MemoryStore(...)` forgot earlier turns. Both templates now ship `lib/file-store.ts`, a file-backed transcript store, and use `FileFoundryDataAdapter`, so instances, conversations and schedules also survive the restart `dev` performs on every save. State lives under `.data/` (git-ignored; `foundry/.data/` with a nested `.gitignore` for the Next.js target).
  - **The demo's tools are actually mounted.** `find_flights` (concierge) and `current_time` (minimal) were composed but never installed, so the model could not call them on a new instance. They are now always-on tools; the concierge keeps an installable shared-tool example (`convert-currency`).
  - **The concierge can reply over its chat transport.** A seeded `concierge-demo` instance installs the calendar app and has the binding outbound delivery requires (previously `bindings: []`, so replies failed with "agent has no enabled bindings"). The keyless demo model now replies through the generated messaging tool when a chat message arrives.
  - **Traveller memory and the working environment persist.** Memory uses a small file-backed context adapter (`lib/file-context.ts`) per instance, and the VFS uses `foundryDataEnvironmentPersistence`.
  - The demo model reasons per turn, so it keeps calling tools after the first message.
  - The minimal template no longer depends on `effect`; the Next.js README names `foundry.config.mts`.
  - READMEs explain composing vs installing, where state lives, and how to send the demo a chat message.

- Updated dependencies [[`cddf7fd`](https://github.com/porkytheblack/glove/commit/cddf7fd1f21379fb7b1b842dc7b0d65aeb65c50f)]:
  - glove-memory@2.2.3

## 0.5.1

### Patch Changes

- Updated dependencies [[`109e40d`](https://github.com/porkytheblack/glove/commit/109e40dddafe3bfe1ac2dd113ca325f440613ad8)]:
  - glove-core@4.3.0
  - glove-facts@0.1.4
  - glove-js@0.5.2
  - glove-lisp@0.5.2
  - glove-mcp@1.2.2
  - glove-memory@2.2.2
  - glove-mesh@0.1.7
  - glove-python@0.4.2
  - glove-working-environment@0.7.0

## 0.5.0

### Minor Changes

- [#184](https://github.com/porkytheblack/glove/pull/184) [`0fb8e0b`](https://github.com/porkytheblack/glove/commit/0fb8e0b8725cbf09e283c00438f2b35dc5faab5b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Add adapter-backed browser scripting and persistent sandbox mounts, with Station 3 as the first backend. These optional capabilities use the existing mount approach without adding browser, sandbox or Station dependencies to glove-core. Foundry adds generic mount cleanup registration and moves agent jobs into a separate managed Station daemon process. Foundry requires Node 22+; the capability mount entrypoint remains portable. The daemon remains local and managed by Foundry; external browser/sandbox workers retain their own lifecycles.

  Add retained browser scopes, a portable UTF-8 sandbox writeText operation, and a general-purpose Foundry Operator example with real browser/server verification and illustrated site documentation.

  Runtime context providers now accept portable native content parts as well as text. Browser mounts use this transient channel without accepting or replacing the agent model; media bytes and URLs are omitted from runtime-context telemetry.

  Add optional application-level stationDaemon configuration. The managed Station can host browser and sandbox provider adapters alongside agent jobs, with one resource factory per daemon, private connection delivery, and startup/shutdown cleanup. Operator now uses this single-instance path.

  Serialize scheduled activation transitions across daemon acknowledgements and asynchronous storage so pause, update and cancellation cannot be overwritten by stale dispatch or completion writes.

### Patch Changes

- Updated dependencies [[`0fb8e0b`](https://github.com/porkytheblack/glove/commit/0fb8e0b8725cbf09e283c00438f2b35dc5faab5b), [`653c3f5`](https://github.com/porkytheblack/glove/commit/653c3f54c231675da30afe62725d53e2855261a9), [`331ce80`](https://github.com/porkytheblack/glove/commit/331ce80da3eb0a4b313311d6628a87299b209cc4)]:
  - glove-core@4.2.0
  - glove-working-environment@0.7.0
  - glove-facts@0.1.3
  - glove-js@0.5.1
  - glove-lisp@0.5.1
  - glove-mcp@1.2.1
  - glove-memory@2.2.1
  - glove-mesh@0.1.6
  - glove-python@0.4.1

## 0.4.1

### Patch Changes

- Update `glove-memory` to 2.2.0 so Foundry form installations support opt-in skips and `onSkip` effects.

## 0.4.0

### Minor Changes

- [#176](https://github.com/porkytheblack/glove/pull/176) [`8c36feb`](https://github.com/porkytheblack/glove/commit/8c36feb1139966bcdac8525e79db1714c13c5b6b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Integrate Foundry's production application controls with the current core runtime-context and multimodal contracts. Add durable single-host Foundry data, authoritative conversation transcripts, adapter-owned HTTP authorization, expiring tool approvals, interrupt-and-restart steering, and bounded programmatic tool composition. Preserve message-aware assembly, schedules, sleep, native working environments, and voice host boundaries.

  Add first-class lazy goals, facts, forms and native context-provider fields with typed execution handles, conversation/instance scoping, opt-in shared preparation, and metadata-only inspector progress. Extend the SQLite bundle with durable native goal/form adapters and independently committed fact saves protected by process-death-safe SQLite locks. Add guided-intake documentation and restart/concurrency tests.

  Require Station 2.3.0 or newer for completed-worker drain and cancellation escalation fixes. Add a real-process regression for leaked handles and cancellation.

  Add a Clack-based interactive project initializer with target, starter and package-manager choices, a review before writing files, cancellation and optional dependency installation. Preserve non-interactive automation with explicit flags. Require Node 20.12+ for the initializer (Node 22.13+ recommended for SQLite memory). Resolve scaffold versions against the installed workspace instead of obsolete fallback majors. Expand the package and starter READMEs and the documentation site's setup wizard and CLI reference.

  Add opt-in `glove-memory/sqlite` durable entity, episodic, resource and pinned-context adapters for Node 22.13+ with isolated namespaces, transactional writes, cross-process reads and corruption checks. Existing browser-safe entry points remain unchanged.

  Add MCP stdio transport, tool allowlists, sanitized resources and prompts, bounded timeouts, lease-safe child recycling, live tool refresh and deactivation cleanup. Core tool-registry updates are atomic; Gemini compatibility retains provider thought signatures across tool turns. REPL workflow frames remain bounded and capability-selected.

### Patch Changes

- Updated dependencies [[`8c36feb`](https://github.com/porkytheblack/glove/commit/8c36feb1139966bcdac8525e79db1714c13c5b6b)]:
  - glove-core@4.1.0
  - glove-memory@2.1.0
  - glove-mcp@1.2.0
  - glove-js@0.5.0
  - glove-python@0.4.0
  - glove-lisp@0.5.0
  - glove-facts@0.1.2
  - glove-mesh@0.1.5
  - glove-working-environment@0.6.1

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - glove-core@4.0.0
  - glove-memory@2.0.0
  - glove-js@0.4.3
  - glove-lisp@0.4.3
  - glove-mcp@1.1.3
  - glove-mesh@0.1.4
  - glove-python@0.3.3
  - glove-working-environment@0.6.1

## 0.3.2

### Patch Changes

- Updated dependencies [[`13c6385`](https://github.com/porkytheblack/glove/commit/13c6385497322e1c1f3d504ff7ef95b1c5eced79), [`5e7a590`](https://github.com/porkytheblack/glove/commit/5e7a590a2efca6de39f876c57535e075e813e132)]:
  - glove-memory@1.2.0

## 0.3.1

### Patch Changes

- Updated dependencies [e6210d0]
  - glove-core@3.7.1
  - glove-js@0.4.2
  - glove-lisp@0.4.2
  - glove-mcp@1.1.2
  - glove-memory@1.1.2
  - glove-mesh@0.1.3
  - glove-python@0.3.2
  - glove-working-environment@0.6.1

## 0.3.0

### Minor Changes

- [#157](https://github.com/porkytheblack/glove/pull/157) [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Introduce Glove Foundry, the Effect-native, file-routed framework for typed and observable agent applications.

  - Publish the first `glove-foundry` release with composable code definitions, persisted instances, context-aware lazy assembly, applications and transmissions, dynamic playbooks and schedules, conversations, agent working environments, multi-agent composition, and the Foundry inspection workbench.
  - Add Gemini native image generation and editing to `glove-image`.
  - Refresh the Gemini model catalogue in `glove-core`.
  - Move Gemini Live runtime text onto the realtime input protocol and update its default live model.
  - Deprecate the Glovebox package family in favor of Glove Foundry. Existing Glovebox deployments remain supported as a legacy compatibility surface, while new agent runtimes should use Foundry.

### Patch Changes

- [#168](https://github.com/porkytheblack/glove/pull/168) [`ec70d79`](https://github.com/porkytheblack/glove/commit/ec70d7996f8fbbd9d6a73950e4c2e6f8fc536f45) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Document explicitly mounted HTTP and keystore capabilities, link Foundry's
  working-environment setup to the shared host-policy and persistence guide, and
  clarify that base downloads use provider policy while general HTTP requires
  glove-env-fetch.

- [#159](https://github.com/porkytheblack/glove/pull/159) [`4050224`](https://github.com/porkytheblack/glove/commit/40502241f16621bde4696fb6357006951b121c13) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Rework `glove foundry init` so a new project is complete, correct, and runnable on the first command.

  - **Dependency versions are resolved from the CLI's own manifest** rather than hardcoded. The pinned ranges had drifted: a scaffold asking for `glove-js@^0.3.0` while `glove-foundry@0.1.0` requires `0.4.0` made the package manager install a second copy, and the generated project failed `tsc` before its author wrote a line.
  - **A worked travel-concierge example is the default template.** It searches flights, installs a calendar application, replies over a Telegram/WhatsApp-shaped transmission, remembers the traveller, wakes on a schedule, and owns a sandboxed VFS and REPL — one example per convention. `--template minimal` still gives one agent and one tool.
  - **It runs with no API key.** A deterministic demo model answers until `OPENROUTER_API_KEY` is set, so the first run produces a real trace with real tool calls.
  - **A full README ships with the project**: the definition/instance model, a map of every generated file, the convention table, how to add a tool or install an application, how to wire a real chat provider, and links to every Glove package.
  - **`--target nextjs` adds Foundry to an existing Next.js app**, detected automatically. Agents land under `foundry/`, the app gets a typed `lib/foundry.ts` client and an example route handler, and its `package.json` keeps everything it had. A nested `foundry/package.json` and a `.mts` config scope ESM to the agent tree, without which Node loads the agents through the CommonJS resolver and fails on Foundry's ESM-only export map.
  - `glove foundry dev` now watches the configured `agentsDir` instead of assuming `agents/` at the root, so hot restart works in the Next.js layout.
  - The CLI gains `--template`, `--target`, and `--package-manager`, reports what it created and what to run next, and reports a bad flag as a usage error rather than a stack trace.

- [#159](https://github.com/porkytheblack/glove/pull/159) [`c74845d`](https://github.com/porkytheblack/glove/commit/c74845d4c02269301b4e02bcfcd3b366821f4692) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Rework the Foundry inspector around the questions an operator actually asks of a run.

  - Live events are coalesced into one refresh instead of repainting the page per event, and a refresh now preserves scroll position, expanded events, open output panels, and the text and caret in a filter box. Previously any runtime event wiped what you were typing.
  - Runs carry a duration and a relative start time that tick every second, so an in-flight run reads as in-flight without a reload.
  - Run filters live in the query string. `/runs?status=failed&q=invoice` is a link you can send, and the status tabs carry live counts.
  - A failed run states its error above the spine rather than only inside the recorded output; the event trace adds per-event offsets from the start of the run, category filters, and payload copy.
  - Every truncated identifier has a copy button, lists take `j`/`k`/`Enter`, `/` focuses the run filter, `c` opens the run drawer, and `Command-Enter` submits it.
  - Drop the webfont import the server's own content security policy has always blocked, which removes a guaranteed console error on every page load.

- Updated dependencies [[`6a2980c`](https://github.com/porkytheblack/glove/commit/6a2980c368b2d6351310444d676c50553e148553), [`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-working-environment@0.6.1
  - glove-core@3.7.0
  - glove-js@0.4.1
  - glove-lisp@0.4.1
  - glove-mcp@1.1.1
  - glove-memory@1.1.1
  - glove-mesh@0.1.2
  - glove-python@0.3.1
