# glove-foundry

## 0.13.0

### Minor Changes

- [#237](https://github.com/porkytheblack/glove/pull/237) [`bc071c8`](https://github.com/porkytheblack/glove/commit/bc071c81d1d8933a3c589a1e26b8d6b579a8b3f8) Thanks [@porkytheblack](https://github.com/porkytheblack)! - - **Mailbox names:** mailbox directories and lease files are now named with the sha256 of the conversation or run id, so a live run in a conversation whose id is over 127 bytes can take deliveries. Before, the hex of the id passed the 255-byte name limit and the write failed with `ENAMETOOLONG`.
  - **A person's mesh message mid-run:** when a person's mesh message is delivered into a live run, it now keeps `from.kind` and `peer`.
  - **New thread routes:** mesh threads now have HTTP routes and typed-client methods: `GET /api/threads`, `GET /api/threads/:id`, `POST /api/threads/:id/messages`, `POST /api/threads/:id/take-over` and `POST /api/threads/:id/held/:messageId`. The client methods are `threads`, `thread`, `meshHumanMessage`, `meshTakeOver` and `releaseMeshMessage`.
  - **Subscription fan-out:** a subscription's playbook no longer wakes every instance it provisioned. Only the subscription routes it, by its targets, so an event for one thread wakes that thread's instances.

## 0.12.0

### Minor Changes

- [#235](https://github.com/porkytheblack/glove/pull/235) [`c414379`](https://github.com/porkytheblack/glove/commit/c414379c9b2e8c798a741b28ad262b41748c1026) Thanks [@porkytheblack](https://github.com/porkytheblack)! - The hosted mesh can now cross workspaces under the application's rules, and a definition can decide which built-in tools a run gets.

  - `defineApplication({ mesh: { peers, authorize, bindThread, commit, refusal } })`:
    - `peers` lists who a sender can reach, in any workspace.
    - `authorize` decides each message: deliver, hold, draft (behind a Foundry approval) or refuse with the application's wording. Deliver, hold and draft look the same to the sender.
    - `bindThread` names a thread after the application's record.
    - `commit` writes each message there before it is delivered. A thread outbox retries the commit and delivers after a failure or restart.
  - `runtime.meshHumanMessage`, `runtime.meshTakeOver` and `runtime.releaseMeshMessage` add people to threads, take agents out of them and decide held messages.
  - New trace events: `mesh.held`, `mesh.drafted`, `mesh.released`, `mesh.discarded`, `mesh.committed` and `mesh.taken_over`.
  - The controller checks that a mesh command comes from the run's own agent and conversation.
  - Without an application `mesh`, peers stay in the workspace and nothing is gated.
  - `builtins` on `defineAgent` takes `{ block }`, `{ allow }` (or a list) or `{ filter }`, optionally per run, and withholds the built-in tools it excludes. The controller refuses commands that only a withheld tool could send.
  - `FOUNDRY_BUILTIN_TOOLS`, `builtinAllowed` and `isFoundryBuiltin` are exported.
  - `voiceCall` reports the tools it keeps off a call as `foundry.voice.tools.excluded`.

## 0.11.0

### Minor Changes

- [#230](https://github.com/porkytheblack/glove/pull/230) [`2377ca4`](https://github.com/porkytheblack/glove/commit/2377ca467bf8d723c6bd27e4ffe7780ed6aa97c9) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Addressed events with explicit acknowledgement, fresh preparation, and voice calls that tell them at a pause with durable delivery receipts.

  - **`context.onEvent(handler, match?)`.** A handler takes addressed events (agent messages and transmissions) one at a time, both those that started the run and those that arrive while it runs. Nothing consumes one but its `ack()`: registering, returning and the run ending do not, and a mixed batch acknowledges only the events acknowledged. An event left unacknowledged that arrived mid-run goes back to the runtime when the run ends; one that started the run stays pending for the next run. The run waits for handler calls still running, and so does the returned stop function. Delegation updates, mesh messages and runs without `onEvent` are unchanged. `context.eventTurn` says whether events started the run.
  - **`defineAgent({ prepareEvent })`.** Reads current facts just before a text turn sees an addressed event, whether it starts the run or joins a turn already going. `{ say }` replaces its content, `{ suppress }` finishes it unseen, and a throw withholds it. The runtime delivers a withheld event again after a delay that doubles from 1s to 5 minutes.
  - **`voiceCall({ events: { accept, prepare, afterCall, resolveUncertain, transcript, respond } })`.**
    - Accepted events wait for a pause in speech and are prepared at that pause. If speech starts while `prepare` runs, the next pause prepares again.
    - Told events go to the model with the `system` role and are transcribed as framework event context, never as the caller.
    - A failing event never holds up delegation updates or other events.
    - An event that wakes a voice agent with no call open no longer opens a room: `afterCall` takes it, or it stays pending.
  - **Delivery receipts.** Each event's receipt moves through `queued`, `dispatching`, `accepted`, `suppressed`, `redirecting` and `redirected`, and is written before every step that has an effect.
    - A redelivered event is never told twice.
    - A dispatch whose outcome is unknown is never replayed or sent to chat.
    - A late-chat effect is retried under the same `effectId`.
    - A transcript line missing after a crash is written once without speaking.
    - "Accepted" means the provider's transport took the text, not that anyone heard it.
  - **New optional `FoundryDataAdapter` methods:** `claimEventReceipt`, `putEventReceipt`, `getEventReceipt` and `listEventReceipts`. The memory and file adapters implement them, apart from workspace entries so agent workspace tools never reach them. Without them, receipts last only as long as the process.
  - **New exports:** `FoundryHandledEvent`, `FoundryEventPreparation`, `FoundryEventReceipt`, `eventReceiptStore`, `lateChatEffectId` and `eventTranscriptMessageId`, plus `VoiceCallEvents` and `defaultEventTranscript` from `glove-foundry/voice`.

### Patch Changes

- Updated dependencies [[`2377ca4`](https://github.com/porkytheblack/glove/commit/2377ca467bf8d723c6bd27e4ffe7780ed6aa97c9)]:
  - glove-voice-s2s@0.5.0

## 0.10.1

### Patch Changes

- [#228](https://github.com/porkytheblack/glove/pull/228) [`c39e68d`](https://github.com/porkytheblack/glove/commit/c39e68dcded0ae806de087213895c7e942418b9a) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Schedule revisions no longer depend on object key order.

  `activationScheduleRevision` hashed `JSON.stringify` of the activation as stored, so a store that reorders object keys (a PostgreSQL `jsonb` column returns `{ kind, timezone, expression }` for `{ kind, expression, timezone }`) changed the revision without any change to the schedule. On restart, Foundry then cancelled a pending or accepted occurrence as `superseded` and reset the schedule's cursor to now, so an overdue reminder was never sent.

  - The revision is now a hash of JSON with every object's keys sorted, recursively. Array order and JSON value rules are unchanged. Reordered keys give the same revision; a real change to the message, target, timing or payload gives a different one.
  - Revisions stored by 0.10.0 still match their configuration, including with the timing keys in any order, and are kept as stored. A schedule resumes from its cursor and its outstanding occurrences keep their ids. A 0.10.0 revision is replaced only when the schedule itself changes. A 0.10.0 payload whose object keys a store has already reordered cannot be matched.
  - New export: `scheduleRevisionMatches(activation, revision)`.

## 0.10.0

### Minor Changes

- [#226](https://github.com/porkytheblack/glove/pull/226) [`e6e61a8`](https://github.com/porkytheblack/glove/commit/e6e61a8f81a56df85aa7ced866a757ea38ee9ece) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Schedule occurrences are durable: a crash between a schedule coming due and its run finishing no longer loses or hides it.

  - Foundry's controller now arms recurring schedules itself, as it already did one-shot schedules and sleeps. Station's in-memory scheduler is no longer used, so no schedule state lives in the execution daemon.
  - Each activation keeps `nextOccurrenceAt`, the scheduled time of the next occurrence it owes, and `scheduleRevision`. A restart resumes from that cursor instead of recomputing the next time from now.
  - When an activation comes due, Foundry stores a `FoundryScheduleOccurrence` first, then moves the cursor past it, then hands it to the conversation. Its id is derived from the activation, the schedule revision and the scheduled instant, so retries after a crash keep it. Status is `pending`, `accepted`, `completed`, `failed`, `skipped` or `cancelled`, with the run, attempts, `scheduledFor` and a reason.
  - On startup Foundry delivers every unfinished occurrence before re-arming, unless its activation was paused, cancelled or changed since. Delivery is at least once. Each run gets `request.source.occurrenceId` and `request.source.scheduledFor`; key side effects on the occurrence id.
  - New optional `FoundryDataAdapter` methods: `claimScheduleOccurrence` (atomic insert-if-absent), `putScheduleOccurrence`, `getScheduleOccurrence` and `listScheduleOccurrences(filter?)`. `MemoryFoundryDataAdapter` and `FileFoundryDataAdapter` implement them and keep the latest 100 settled occurrences per activation. Without them, occurrences are kept in memory.
  - Read occurrences with `runtime.listScheduleOccurrences(filter)`, `GET /api/schedule-occurrences` or `client.scheduleOccurrences(filter)`.
  - Recurring timing takes `misfire`: `"fire-once"` (default, as before: the earliest missed occurrence, with its original `scheduledFor`), `"catch-up"` (each missed occurrence in order) or `"skip"` (record one more than a minute late as skipped). Cron expressions and time zones are validated when the schedule is defined.

  Behaviour changes:

  - A recurring occurrence that comes due while its conversation is busy now waits its turn through the conversation gate, and starts from the conversation as it is then. Before, it started at once from an envelope built when the schedule was armed.
  - Resuming a paused schedule starts it again from now, and pausing, cancelling or changing a schedule cancels occurrences no run has yet.
  - A run stopped by shutdown is not an outcome: the next start delivers its occurrence again.

## 0.9.0

### Minor Changes

- [#224](https://github.com/porkytheblack/glove/pull/224) [`752d987`](https://github.com/porkytheblack/glove/commit/752d987f0f65a26ef74c6846666b40699fbe0af4) Thanks [@porkytheblack](https://github.com/porkytheblack)! - A run in the inspector opens three more views, about how Foundry composed and connected it:

  - **Composition**, like DevTools' Sources: each assembly step with its time, and every tool the agent had under the step or installation that added it (Foundry core tools, app transmissions, the definition's tools, delegation, mesh, the working environment, calls, each installed app, MCP servers, the REPL), with how often it was called. Also the playbooks, schedules and activations, delegates and durable subagents, mesh, memory, layers, subscribers, hooks, skills and calls. A run records this as one `foundry.assembly.composed` event before its first turn.
  - **Queues**, like a WebSocket's Messages pane: everything that crossed the run's boundary. Inbound, what started it, transmission follow-ups, delegation updates, agent and mesh messages, deliveries handed to it live and resolved inbox items, each with when it joined the conversation and the model request that first saw it. Outbound, transmissions, delegations, questions and replies, messages, spawns, schedules, sleeps, inbox items and approvals, each with what came of it and the run it started.
  - **Call chain**, like DevTools' initiator chain across runs: the runs this one came from and the runs it started, through delegations and their questions, replies and results, spawns, schedules, sleeps and steering.

  Network and Console use glove-core's new turn, tool-start and request events: a subagent's requests and tool calls sit under it, a run with several turns shows where each began, waterfall bars split waiting (first token, permission check) from work, a tool's wait behind earlier calls shows before its bar, and requests and tool calls have a Timing pane. Streamed text is one console line per request.

### Patch Changes

- Updated dependencies [[`f72b9b4`](https://github.com/porkytheblack/glove/commit/f72b9b4ac749ca4f9098940a2c96c7878d1bdc60)]:
  - glove-core@4.8.0
  - glove-facts@0.1.9
  - glove-js@0.5.7
  - glove-lisp@0.5.7
  - glove-mcp@1.2.7
  - glove-memory@2.3.4
  - glove-mesh@0.2.4
  - glove-python@0.4.7
  - glove-voice-s2s@0.4.7
  - glove-working-environment@0.7.0

## 0.8.0

### Minor Changes

- [#222](https://github.com/porkytheblack/glove/pull/222) [`5b24bf7`](https://github.com/porkytheblack/glove/commit/5b24bf7b559684fb28c18c231e67014b167842a3) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Durable, resumable approvals.

  **glove-core.** A permission prompt can be deferred. A display manager that will not decide now throws `ToolPermissionDeferred` from `pushAndWait`. The turn stops at that tool call: calls before it in the same step keep their results, and no result is recorded for it or the calls after it. The request rejects with `TurnSuspended` (`deferral`, `completed`, `pending`). `glove.resumeToolCalls(signal?)` carries the turn on later: it runs the calls left without a result, with the decision the host saved through `store.setPermission`, then continues the loop. It returns `undefined` when the latest tool step has nothing pending or the conversation moved on. `Agent.pendingToolCalls()` reports what a resume would run. The permission prompt's input now includes `toolCallId`. `isToolPermissionDeferred` and `isTurnSuspended` work across copies of glove-core.

  **glove-foundry.** Approvals are stored and outlive the run that asked.

  - The data adapter keeps them: `putApproval`, `getApproval` and `listApprovals` (optional). `FileFoundryDataAdapter` and `MemoryFoundryDataAdapter` implement them. With these and the event journal, approvals are durable.
  - The run waits `approvals.waitMs` (60 s by default) for a decision. If nobody decides, it suspends at that call: the run ends with `status: "suspended"` and `suspension: { kind: "approval", approvalId, toolName }`, and the conversation is free. The approval stays open for `approvals.expiresAfterMs` (7 days by default), through restarts.
  - A decision made after the run suspended goes to the conversation as a durable event. The run that takes it resumes the turn at the waiting call: approved, it runs and its real result is saved; denied, it is refused. If the conversation moved on, the decision arrives as an event and the agent may call the tool again with the same input, which then runs or is refused without asking. A decision delivered twice does not run the call twice.
  - Every approval has an address. `GET /api/approvals/:id` and `GET /v1/approvals/:id` return one; `client.approval(id)` reads it; the inspector shows it at `/approvals/:id`. `defineApplication({ approvals: { url } })` gives each approval a page in your app, kept as `approval.url`, so a message or an email can link straight to it.
  - Cancelling or steering the run that asked cancels its open approvals. After a restart, open approvals are marked suspended and decisions not yet handed back are delivered.
  - New fields on `FoundryApproval`: `toolCallId`, `url`, `suspendedAt`, `resumedAt`, `resumeRunId`, `settledInRun`. New events: `agent.foundry.approval.suspended`, `approval.resumed`.

  Behaviour change: with the bundled adapters, an approval nobody answers no longer expires after 5 minutes with the call refused. The run suspends after 60 s and the approval stays open for 7 days. Set `approvals: { waitMs, expiresAfterMs }` to change either. A custom adapter without the approval methods keeps the old behaviour.

- [#200](https://github.com/porkytheblack/glove/pull/200) [`f064b7a`](https://github.com/porkytheblack/glove/commit/f064b7a162087687e972eb109828e2b6bd2882f3) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Apps can be backed by an MCP server, the REPL sees installed apps as groups, and topology can live in a file.

  - `defineApp({ mcp: { entry, auth, tools } })` mounts an MCP server's tools through the app. The connection opens with the installation's account: `auth(session)` turns the agent's `accountSessions` session into HTTP headers or stdio environment, so Foundry never holds the credential. `tools(tool, ctx)` returns `"allow"`, `"ask"` or `"hide"` for each tool. By default read-only tools run and everything else waits for approval. Connections close when the run ends. An app that connects with an account refuses an installation without one.
  - `programmaticTools.select` receives `apps`: one group per installed app, its live tools named for code (`gmail.search_threads(...)`), grouped under the app and marked read-only where the server says so. `keepDirect: false` takes the selected tools out of the model's tool list, so they are reached only from code; a tool that needs approval always stays direct.
  - `fileTopologyStore(file)` keeps routes and bindings in a JSON file, so topology an application writes at runtime survives a restart on one host. Use it in `defineApplication({ services })` with your account directory and `memoryEventStore`.
  - Application connections find their account through the account directory, so accounts an application's own directory adds at runtime get their connections.
  - `glove_foundry_transmit` delivers only through outbound routes the instance's playbooks declare, and asks for approval whenever the route's transmission requires it, as its application's send tool does. When the route could belong to more than one application's transmission (the directive names no `applicationId`), it asks if any of them would. Before, a route granted by a binding was enough and no approval was asked.
  - `configure`, `run` and call handlers receive `agentInstance`, `conversation` and `data`, as resolvers and `build` do, so an agent can apply its own rules around an installed app's tools.

- [#200](https://github.com/porkytheblack/glove/pull/200) [`d1ae4de`](https://github.com/porkytheblack/glove/commit/d1ae4de5002abac83c42f1ecb8bc3e9443d59f8f) Thanks [@porkytheblack](https://github.com/porkytheblack)! - The inspector opens a run like a browser's DevTools.

  - **Network** lists every model request and tool call in order, with type, status, initiator, size, time and a waterfall. Filter by text or by model, tools or errors.
    - A model request opens to Overview, Prompt (the system prompt), Messages (the conversation as that request sent it, with earlier messages folded), Context (memory and other runtime context, marked new or changed), Tools (descriptions and schemas), Response and Raw.
    - **Copy request** copies the request as JSON.
    - A tool call opens to its input, result, the request that made it, and its approval.
  - **Console** is the run as a levelled log. Streamed text is one line, and you can filter by text, level and source.
  - **Context** is a tree of what the agent had: per request (system prompt, runtime context, tools, messages), the run's input and output, the instance's context, installations and playbooks, and goals, facts, forms and memory.
  - **Summary** has the phases, the output, the slowest steps and the errors. **Export trace** downloads the run and its events.
  - The view, the open request and its pane are in the URL (`?tab=&item=&pane=`). `1`–`4` switch views, `j`/`k` walk requests and `Esc` closes one.
  - A run's page reads that run's own events (`/api/runs/:id/events`, which now takes `?after=`), so a long run isn't cut off by the global event list.

  Runs record each model request from Glove's new `model_request` events, compactly:

  - The system prompt and tools are recorded in full once per run, then by hash.
  - Messages are recorded as a change against the previous request. Runtime context is recorded each time.
  - Text and JSON are cut, media becomes a placeholder, and `renderData` and echoed reasoning are left out.

  Set `observability: { modelRequests: false }` in `foundry.config.ts` to leave them out of the event stream. Runs recorded without them still list their tool calls and responses.

- [#200](https://github.com/porkytheblack/glove/pull/200) [`f0ffa03`](https://github.com/porkytheblack/glove/commit/f0ffa03643b39b68756f4c63c1dfb812d838fab9) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Foundry hosts Glove Mesh for agents that already exist as instances, instances carry a name and a description, and voice calls speak mesh messages.

  - `defineAgent({ mesh: true })` gives an agent the Glove Mesh tools, for peers that already exist, such as a person's bots. Owned workers stay on `delegates` and `durableSubagents`. The tools are `glove_mesh_list_agents`, `glove_mesh_send_message`, `glove_mesh_broadcast` and `glove_mesh_acknowledge`. Agents are addressed by instance id. Its peers are the other instances in its workspace, so who is on a team is data, not code.
  - `mesh: true` or `{ peers, waitMs, mount }` is the hosted mesh; a value with an `adapter` is still the raw glove-mesh transport. `peers(self, peer)` narrows who an agent may see and message, from instance data. An agent can always answer whoever messaged it. `waitMs` (90 s by default) is how long a blocking send waits inside the run. `mount(ctx)` decides per run whether the tools are there at all, so a read-only run can have none.
  - A new message starts a thread: a conversation on the recipient. Its final reply goes back to the conversation that sent it on its own, and a run that fails or is cancelled sends a failure. Messages either way go straight into a run that listens with `ctx.onMeshMessage`. Otherwise they wait until the conversation is free and start one run, with source kind `"mesh"`, as `<mesh-message>` messages.
  - A blocking send that runs out of time suspends the run with `suspension.kind: "mesh"`. Open threads appear in the sender's runtime context. `runtime.listThreads()` lists them all. Mesh messages ride the same event journal as delegation updates, so they are handed over again after a restart. Older thread records with their own lists of owed messages move to the journal on start.
  - `AgentInstance` has `name` and `description`. `createAgent`, `configureAgent` and the HTTP API set them, the inspector shows them, and the mesh lists agents by them. A tool can write them, so an agent can rename itself.
  - `foundryDataEnvironmentPersistence({ scope: "workspace" })` keeps one working environment for every agent in a workspace, such as a computer a person's agents share. Saves replace the snapshot, so the last run to finish wins.
  - Schedules no longer skip because another instance of the same definition is busy. Overlap was checked per definition, so with many instances of one definition a busy agent made the others miss their schedules.
  - `voiceCall` from `glove-foundry/voice` also speaks mesh messages at the next pause (`announceMesh`, default `announceMeshMessage`), alongside delegation updates, and hands either to `offCall` when no call is live.

### Patch Changes

- [#200](https://github.com/porkytheblack/glove/pull/200) [`55d078a`](https://github.com/porkytheblack/glove/commit/55d078a9dcb7c9b182794f989ebc9df19abb75d7) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Stopping Foundry no longer fails now and then with "execution daemon disconnected" ([#208](https://github.com/porkytheblack/glove/issues/208)). Asked to stop, the background process closed its channel right after sending its reply, and the reply could be lost. It now closes the channel once the reply is written, and the host treats the process going away during a stop as stopped. When the process goes away unasked, the error names its exit code or signal, and the host's stderr gets the end of its output, with secret-looking values masked.

- [#200](https://github.com/porkytheblack/glove/pull/200) [`f0ffa03`](https://github.com/porkytheblack/glove/commit/f0ffa03643b39b68756f4c63c1dfb812d838fab9) Thanks [@porkytheblack](https://github.com/porkytheblack)! - An app installed with an account now gets `withAccountSession` inside a run. The run's envelope dropped the installation's `accountId`, so app tools that need the account's session saw it as missing.

- Updated dependencies [[`dbc7e0f`](https://github.com/porkytheblack/glove/commit/dbc7e0fcb44cd1ee57d389a83c92b00fd6d9be3c), [`d51fc4b`](https://github.com/porkytheblack/glove/commit/d51fc4ba6f775960ee09825b15b5b9ff81e36599), [`5b24bf7`](https://github.com/porkytheblack/glove/commit/5b24bf7b559684fb28c18c231e67014b167842a3)]:
  - glove-core@4.7.0
  - glove-facts@0.1.8
  - glove-js@0.5.6
  - glove-lisp@0.5.6
  - glove-mcp@1.2.6
  - glove-memory@2.3.3
  - glove-mesh@0.2.3
  - glove-python@0.4.6
  - glove-voice-s2s@0.4.6
  - glove-working-environment@0.7.0

## 0.7.0

### Minor Changes

- [#218](https://github.com/porkytheblack/glove/pull/218) [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Add owned durable subagents to defineAgent, with reusable definitions, explicit memory/tool/app inheritance, restricted app views, persistent two-way messaging, and delegation to durable workers. Add worker inspection, archive/resume/purge APIs, ownership-aware cleanup, and per-definition run time and concurrency limits.

  Route messages, task starts, and task updates through a shared durable event journal with explicit agent/conversation targeting, wake/defer/expiry policies, restart recovery and retained deduplication receipts. Deliver through native runtime events without mesh inboxes; add an awaited Glove processEvents turn for durable hosts.

  Preserve events cancelled before history persistence, and route deliveries and acknowledgment tracking through the final runnable returned by a custom build.

### Patch Changes

- Updated dependencies [[`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c), [`ca88985`](https://github.com/porkytheblack/glove/commit/ca8898526d5baeabe0469921658977451dab921c)]:
  - glove-core@4.6.0
  - glove-facts@0.1.7
  - glove-js@0.5.5
  - glove-lisp@0.5.5
  - glove-mcp@1.2.5
  - glove-memory@2.3.2
  - glove-mesh@0.2.2
  - glove-python@0.4.5
  - glove-voice-s2s@0.4.5
  - glove-working-environment@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [[`6f04d7e`](https://github.com/porkytheblack/glove/commit/6f04d7e1db19b30676254753c6a2a68c04d427cb), [`b9d4eda`](https://github.com/porkytheblack/glove/commit/b9d4eda4a932ed0b8502f0a1c3b41755990597db)]:
  - glove-core@4.5.0
  - glove-voice-s2s@0.4.4
  - glove-facts@0.1.6
  - glove-js@0.5.4
  - glove-lisp@0.5.4
  - glove-mcp@1.2.4
  - glove-memory@2.3.1
  - glove-mesh@0.2.1
  - glove-python@0.4.4
  - glove-working-environment@0.7.0

## 0.6.0

### Minor Changes

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
