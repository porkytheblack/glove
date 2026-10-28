# Building with Foundry: definitions, capabilities and runtime surfaces

> Read when authoring agent definitions and their colocated pieces (apps, transmissions, playbooks, schedules, working environments, guidance, voice hosts, multi-agent composition) or when calling and operating agents. Rules here are the ones that keep definitions portable and runtime data honest.
>
> Part of the `glove-foundry` skill. Start from [SKILL.md](../SKILL.md); exact signatures are in [condensed-reference.md](condensed-reference.md).

## Preserve the mental model

Foundry separates immutable code definitions from mutable runtime data.

- `agents/<route>/agent.ts` defines reusable behavior and lazy assembly. It is not a running agent and never declares request input or result output.
- Agent instances are persisted data with their own ids, workspace, context, installations, and playbooks. They can be provisioned, updated, removed, and reconstructed without changing the definition.
- Conversations are first-class instance-owned records. One instance may own many conversations.
- Applications, transmissions, predicates, actions, shared tools, MCP definitions, memory profiles, layers, subscribers, and schedules are composable code values colocated with the owning agent.
- Installations, selected accounts/routes, playbooks, subscriptions, scheduled activations, workspace state, and conversations are runtime data.

Filenames own static identity. Convention files default-export one definition, and static code references imported values. Do not repeat string ids for code-owned relationships or add an `id` to a file-routed definition. String ids are appropriate only after serialization or at database, HTTP, frontend, and other data boundaries.

## Author colocated, composable definitions

Use the conventional project shape and keep pieces atomic:

```text
agents/<agent>/
  agent.ts
  composition.ts
  apps/*.app.ts
  transmissions/*.transmission.ts
  events/*.event.ts
  predicates/*.predicate.ts
  actions/*.action.ts
  connections/*.connection.ts
  tools/*.tool.ts
  mcp/*.mcp.ts
  memory/*.memory.ts
  inboxes/*.inbox.ts
  layers/*.layer.ts
  subscribers/*.subscriber.ts
  schedules/*.ts
```

Keep `agent.ts` to assembly: imports and one `defineAgent` whose fields are values,
imported definitions or one-line resolvers. Put prompts (`prompt.ts`, a function),
always-on tools (`tools.ts`), payload parsing and calls (`call.ts`), workspaces
(`workspace.ts`) and per-layer model choices (`lib/models.ts`) in their own modules.

Use `composeAgent(...)` to assemble the agent-local catalogue. Composition makes definitions available; it does not install applications, MCPs, or shared tools. An instance chooses those surfaces dynamically with typed `install(...)` records.

Prefer the definition helper that owns the contract (`defineAgent`, `defineApp`, `defineTransmission`, `defineSharedTool`, `defineMcp`, `defineMemory`, `defineLayer`, `defineSchedule`, and related helpers). Let the definition's Zod or Effect schema carry config types through installation and runtime decoding. Do not add parallel handwritten config types or cast away inference.

## Resolve behavior lazily

Agent assembly is contextual. Use a direct value for fixed behavior and a resolver when the result can depend on the instance, conversation, workspace, installation state, current Glove message, prior messages, or request.

Common lazy fields include model, system prompt, tools, memory, inboxes, layers, subscribers, calls, subagents, mesh, playbooks, schedules, working environment, REPL, build, and run.

- Inboxes must be lazy; do not model an inbox as a static singleton.
- Applications, MCPs, and shared tools are available through composition but mounted only when installed on the current instance.
- Memory belongs to the agent definition and may be selected lazily for the current context.
- A custom `build` augments assembly; a custom `run` controls execution. Prefer the default path unless a real lifecycle requirement needs an override.
- Use the native Glove `Message` shape. Do not invent a Foundry-specific input/output contract inside `defineAgent`.

## Applications, transmissions, and credentials

An application may own multiple inbound and outbound transmissions. Outbound transmissions become validated tools only when the application is installed. Transmission definitions own authentication, normalization, classification, predicates, serialization, and delivery behavior; playbooks remain data-oriented policy.

To triage inbound events with a classifier model (TypeSafe Jev, or any `ClassifierAdapter`) before an agent starts, use `glove-classifier/foundry`. `classifyInbound({ classifier, question: choice(...), events, fallback, minConfidence, state })` is the transmission's `inbound.classify`. `defineTransmissionPredicate(classifierPredicate({ classifier, questions, where, state }))` lets a playbook match only when the answers satisfy `where`; playbook predicate parameters `{ min, max, choice, where }` override the thresholds. Both return Effects that fail with `ClassifierError`.

Connections are colocated with their application and receive the narrow Foundry connection context. Keep backend concepts such as Station networks, beacons, signals, or worker topology out of public agent definitions, client types, manifests, and inspector language. Expose only purpose-built agent-system concepts such as inbound connections, activations, scheduled work, and runs.

Foundry never acquires, refreshes, or stores credential material. Account records contain safe metadata and opaque access references. The consumer's account-session/provider adapter owns credential lookup and refresh. Never copy secrets into instance data, manifests, prompts, telemetry, or inspector payloads.

## Playbooks, inbound activation, and provisioning

Playbooks are serializable instance policy composed at runtime from imported transmission primitives. They match inbound events, supply directives and serialization, and describe any outbound response route. They are not a global file-routed registry.

Agent definitions may lazily return desired playbooks, and persisted instances may carry frontend-authored playbooks. Durable playbook subscriptions are evaluated even when no instance exists and may provision zero, one, or many subscribed agents before delivering the event into a conversation.

When changing inbound behavior, preserve idempotency: claim delivery by route and event before provisioning or enqueueing runs. Provision through the data adapter so `provisioningKey` remains atomic.

## Schedules, sleep, and future work

Schedules are agent-local definition values that reconcile into persisted activations. They are not a system-wide static registry.

- A lazy `schedules` resolver may load predefined desired schedules for an agent instance.
- Agents create future or recurring work with Foundry's schedule tool.
- Agents must be able to list, update, and cancel their own scheduled triggers.
- Sleep suspends the logical run and wakes the same instance and conversation later with a resolution message.
- Pending and recurring activations must reconstruct from a durable `FoundryDataAdapter` on restart.

Do not expose the private execution backend as the authoring model for schedules or sleep.

## Managed execution and optional browser/sandbox resources

Foundry owns a local Station 3 daemon for agent jobs. Applications can opt into `daemon: stationDaemon({ stationId, resources, onReady })`, importing `stationDaemon` from `glove-foundry/station`, to host browser and/or sandbox provider adapters on that same instance. The resource factory runs once in the managed process. Keep provider acquisition and private connection storage in application infrastructure; programmatic runtime setup supplies `applicationFilePath`. Foundry owns successful startup/shutdown and failed-startup cleanup. A factory that fails before returning releases its partial acquisitions.

Mount capabilities with `mountBrowser(agent, { adapter })` and `mountSandbox(agent, { adapter })` from optional `glove-execution`, inside `configure`. Register `context.onCleanup` immediately after acquisition. Mounts never accept or replace the agent model. Default scripts use `glove-js`; Station transport is isolated in `glove-execution/station`. Core remains portable and has no native browser/sandbox backend. Screenshots use transient native content after tool results; media bytes are omitted from runtime-context telemetry. Do not automatically replay scripts after a mutation with an unknown outcome.

Memory defaults to an agent conversation. Broader recall, task checkpoints, prompts and eager/lazy capability acquisition are application decisions. Separate browser session/profile, sandbox file/service, script binding and memory lifetimes. See [execution ownership and setup](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/execution.md) and [Operator](https://github.com/porkytheblack/glove/blob/main/examples/foundry-operator/README.md). Node 22+ is required for Foundry; SQLite memory requires 22.13+.

## Working environment, VFS, REPL, and media

Foundry mounts native Glove surfaces instead of reimplementing them.

- Use `defineWorkingEnvironment(...)` for a guarded VFS, scripts, history, checkpoints, and artifact export.
- Add a persistence adapter when work must survive across runs. Treat the VFS as the durable boundary; REPL bindings are run-scoped.
- Use `defineRepl(...)` with `glove-js`, `glove-python`, or `glove-lisp` for computation over explicitly registered functions.
- Use `glove-image` and the working-environment format adapters for image, document, slide, spreadsheet, archive, audio, or video work.
- Pass artifacts between agents by durable workspace/VFS references rather than copying large document bodies into prompts.
- For HTTP calls/downloads/uploads and host keystores, read [HTTP files and host secrets](https://github.com/porkytheblack/glove/blob/main/packages/glove-working-environment/HTTP-AND-SECRETS.md). Mount `fetchFiles()` and `secret()` in the environment options; scope the host store to the owning instance and re-supply it after restore. Snapshots do not persist secrets or network grants.
- Native fetch blocks non-public DNS/IP destinations; private services require exact host opt-ins. Keep credentials in host aliases, not scripts or manifests. Custom transports own equivalent network/TLS safety. In adapter bindings, read `ctx.signal` at call time so run termination aborts host I/O.

## Goals, facts, and prepared workflows

Goals, forms, and pinned context require glove-core >=4.0.0 for live runtime snapshots. By default they append transient user-role messages at the model-input tail before each model iteration without rewriting system instructions or saved history. `goals: { …, delivery: "history" }` (and `forms`) save the snapshot to history once per change instead; `contextProviders` entries can be bare providers or `{ provider, delivery: "request" | "history", key }`. Runnable proxies forward `addContextProvider` and `getRuntimeContext`; subscribers receive `runtime_context` snapshots. Realtime voice refreshes silently at start and after tools; call `await realtime.refreshContext()` after external changes.

Use `glove-memory/goals` for dynamic goals and `glove-facts` for reusable scoped evidence; there is no standalone `glove-goals` package. Mount `useGoalRunner` or `useFormRunner` from `glove-memory/tools` on the conversational runnable, and `useFacts` from `glove-facts` for capture.

Enable shared preparation with `new FactPreparation(facts, { agent: preparationAgent })`. Supply a dedicated, built Glove runnable and separate store per fact scope, with the application's tracing subscribers attached. The library mounts `submit_preparation` and calls `processRequest`; do not bypass Glove with a direct model invocation or substitute the conversational agent. No agent means automatic preparation is off while capture/manual progression remain available. Host rules allowlist fields/items; workflow commits retain authority over values, progress and effects.

Use the first-class lazy `goals`, `facts`, `forms`, and `contextProviders` fields. Read [Foundry guidance](https://github.com/porkytheblack/glove/blob/main/packages/glove-foundry/docs/guidance.md) for mounting, typed execution handles, conversation-default scope, instance sharing, native preparation, and durable SQLite adapters. A definition-provided program seeds absent goals; later revisions require native CAS and a reason. Context providers are read-only transient snapshots, never a second inference loop. Keep the [shared workflow guide](https://github.com/porkytheblack/glove/blob/main/.claude/skills/glove/references/memory-and-workflows.md#goals-facts-and-form-preparation) and [facts adapter contracts](https://github.com/porkytheblack/glove/blob/main/packages/glove-facts/README.md) authoritative for evidence, correction, tracing and recovery.

## Layered agents and voice

Decide layers by three questions: how fast must it reply, what context must it
keep, how long does it run. Then give each agent only the access its job needs.

- Interactor (layer 1): fast model or `s2sDrivenModel`, personal memory
  (`*.memory.ts` with glove-memory, one namespace per instance), talks to the
  person, lists workers in `delegates: [{ agent: "<route>", description }]`.
  Write descriptions for the model that has to choose.
- Workers (layer 2): ordinary definitions with their own model, tools,
  `workingEnvironment`, browser or sandbox mounts, and a durable `store`. No
  personal memory; no tool that reaches the person. Set `answerWaitMs` when a
  worker holds live state worth keeping while it waits for an answer.
- Name delegates by route; never import another agent's `agent.ts` (its
  dependencies would load in every run of the importer).
- Foundry creates one worker instance per interactor instance and route
  (`<agentId>.<route>`, context copied from the interactor instance plus
  `delegatedBy`) and one conversation per delegation (id = delegation id).
  Keep secrets out of instance context.
- Results, questions and failures arrive in the delegating conversation as
  `<delegation id agent status>` messages: to a `ctx.onDelegationUpdate(handler)`,
  else into the delegating turn at its next tool step while it is still calling
  tools (a Glove event), else as one new run (`source.kind` `"delegation"`) once
  the run has ended and no run holds the conversation. Replies reach a working
  worker the same way. Open delegations appear in
  runtime context. `runtime.listDelegations(filter)` lists them; trace events are
  `delegation.started|question|replied|completed|failed|cancelled|delivered`.
- Voice: `run: voiceCall({ room, greeting?, idleMs?, maxDurationMs?, openDelayMs?,
  realtime?, announce?, offCall? })` from `glove-foundry/voice`. It hosts
  `RealtimeAgent` over the assembled agent, saves both sides to the store, speaks
  delegation updates at the next pause (8 s max hold), and keeps Foundry's
  bookkeeping tools and every `requiresPermission` tool off the call (the
  realtime path has no approval step). A delegation run with no live call is
  saved to the conversation unless `offCall` handles it; or route
  `source.kind === "delegation"` runs to `ctx.defaultRun()` with a text model.
- Rooms are `{ open(call), close() }` calling `call.joined()` / `call.left()`.
  `webSocketRoom({ port, token })` serves PCM16 + JSON on its own port (put it
  behind a proxy on single-port hosts such as Kuiper); a LiveKit room wraps
  `LiveKitTransport` + `attachRealtime` from glove-voice-livekit and connects
  outward. Gemini Live: `openDelayMs: 500`.
- GPT-Live (`provider: "openai-live"`): the host owns continuous PCM pacing
  including silence, timestamped transcript fragments, and playback/avatar
  utterance boundaries; Realtime VAD and final-turn assumptions do not apply.
  Read the [GPT-Live contract](https://github.com/porkytheblack/glove/blob/main/packages/glove-voice-s2s/README.md#gpt-live).

## Multi-agent systems

Choose the smallest correct composition surface:

- `delegates` for a fast agent that hands slow or tool-heavy work to siblings and hears back (see above).
- `defineSubagent` for an isolated nested task under a parent run. Its `tools` can project a least-privilege subset of `parent.tools`; its `layers` (including `configureLayer(layer, config)`) and `subscribers` mount on each invocation, before `configure`, and are disposed when the subagent's request ends.
- Foundry calls for typed agent-to-agent or agent-to-service invocation.
- Mesh for peer messaging and acknowledgements.
- Playbook subscriptions for inbound events that can provision a workforce.
- Workspaces, conversations, inbox items, tasks, and artifacts for durable coordination.

Keep agent definition identity separate from agent instance identity in traces and APIs. Make concurrent campaigns distinct instances/conversations/runs so orchestration and progress remain legible.

## Calling and operating agents

Foundry already provides these surfaces; do not rebuild them in application code.

- Typed client: `createFoundryClient<FoundryRoutes>({ baseUrl })` from `glove-foundry/client` — `agent(route).create`, `createConversation`, `send` → `FoundryRunHandle` (`wait`, `cancel`, `steer`, `events`), `conversationTranscript`, `install`/`uninstall`, workspace/inbox/tasks, approvals.
- Native REST under `/api/*` (instances, conversations, messages, runs, events with SSE, installations, approvals, workspaces, playbook subscriptions, activations, transmissions, topology) and an automation API under `/v1/runs`.
- OpenAI-compatible `GET /v1/models`, `POST /v1/chat/completions` and `POST /v1/responses`. `model` is an instance id, or a definition route with exactly one instance; instances are never created implicitly. Reuse `user`, `conversation_id`, or the returned `x-foundry-conversation-id` header to continue a durable conversation.
- Approvals: a tool with `requiresPermission` (or an outbound transmission with `requiresPermission`) pauses the run on an expiring approval record (default 5 minutes, fail-closed). Resolve with `client.approvals(...)` + `client.resolveApproval(id, "approve" | "deny")` or the inspector.
- Steering is interrupt-and-restart: `handle.steer(message)` cancels the active run, waits (at most 10 s) for its process to finish `unAbortable` tools and cleanup, then starts a replacement run in the same conversation, so the replacement never reads history the old process is still writing.
- Built-in agent tools on every Foundry agent: `glove_foundry_spawn`, `glove_foundry_schedule`, `glove_foundry_schedules`, `glove_foundry_sleep`, `glove_foundry_background`, `glove_foundry_transmit`, `glove_foundry_conversations`, `glove_foundry_workspace`, `glove_foundry_shared_inbox`, `glove_foundry_tasks`, `glove_foundry_environment`.
- Every run executes in a fresh child process. `new MemoryStore(...)`, in-memory memory adapters and `MemoryFoundryDataAdapter` writes made inside a run do not survive to the next message, so an agent whose `store` returns a plain `MemoryStore` forgets earlier turns. The starter templates keep everything under `.data/` (`FileFoundryDataAdapter`, `lib/file-store.ts`; the concierge also `lib/file-context.ts` and VFS persistence). Persistence has four independent boundaries: `FoundryDataAdapter` (`FileFoundryDataAdapter` for one host), a durable conversation `store`/`conversationStore`, native memory adapters, and working-environment VFS persistence.
- Install capabilities with `install(...)` on the instance, `client.install`, or `PUT /api/installations` (`{ agentId, kind, id, accountId?, config? }`; `accountId` selects a persisted account and must not go inside `config`); the inspector displays installations but cannot change them. Outbound delivery needs an enabled `defineBinding` for the instance.
- Health: `GET /health` (and `/health/detailed`) answer 200 when `ok` is true and 503 with the same body when a subsystem is down; `client.health()` returns the body either way.
- One runtime per data store: every runtime arms the schedules it finds, so replicas sharing a store would each fire them.

Handbook: https://glove.dterminal.net/foundry/docs · condensed reference: https://glove.dterminal.net/foundry/llms-full.txt
