---
name: glove-foundry
description: Build, extend, debug, or review typed agent applications with Glove Foundry. Use for Foundry file routes, definitions and instances, lazy assembly, applications and transmissions, playbooks, schedules, conversations, working environments, multi-agent composition, observability, the inspector, or migration from Glovebox.
---

# Glove Foundry

Build Foundry projects as cohesive agent applications: typed code definitions, durable runtime data, message-aware assembly, and observable execution. Foundry is the preferred Glove application/runtime framework. Glovebox is deprecated and should only be maintained when a task explicitly targets a legacy Glovebox deployment.

## Start with the repository

Before changing Foundry, inspect the current public surface and the closest executable example. Do not rely on remembered APIs.

- Read [`packages/glove-foundry/docs/building-with-foundry.md`](../../../packages/glove-foundry/docs/building-with-foundry.md) for authoring conventions.
- Read [`packages/glove-foundry/docs/architecture.md`](../../../packages/glove-foundry/docs/architecture.md) when changing definitions, instances, activation, persistence, credentials, or runtime boundaries.
- Read [`packages/glove-foundry/docs/inspector.md`](../../../packages/glove-foundry/docs/inspector.md) for observability and workbench changes.
- Use [`examples/foundry-agent`](../../../examples/foundry-agent) as the canonical small application. Use the Braind Storm and voice examples only when their specialized behavior is relevant.
- Inspect exports in [`packages/glove-foundry/src/index.ts`](../../../packages/glove-foundry/src/index.ts) and tests beside the affected module before inventing a helper.

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

Connections are colocated with their application and receive the narrow Foundry connection context. Keep backend concepts such as Station networks, beacons, signals, or worker topology out of public Foundry definitions, client types, manifests, and inspector language. Expose only purpose-built agent-system concepts such as inbound connections, activations, scheduled work, and runs.

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

## Working environment, VFS, REPL, and media

Foundry mounts native Glove surfaces instead of reimplementing them.

- Use `defineWorkingEnvironment(...)` for a guarded VFS, scripts, history, checkpoints, and artifact export.
- Add a persistence adapter when work must survive across runs. Treat the VFS as the durable boundary; REPL bindings are run-scoped.
- Use `defineRepl(...)` with `glove-js`, `glove-python`, or `glove-lisp` for computation over explicitly registered functions.
- Use `glove-image` and the working-environment format adapters for image, document, slide, spreadsheet, archive, audio, or video work.
- Pass artifacts between agents by durable workspace/VFS references rather than copying large document bodies into prompts.

## Multi-agent systems

Choose the smallest correct composition surface:

- `defineSubagent` for an isolated nested task under a parent run.
- Foundry calls for typed agent-to-agent or agent-to-service invocation.
- Mesh for peer messaging and acknowledgements.
- Playbook subscriptions for inbound events that can provision a workforce.
- Workspaces, conversations, inbox items, tasks, and artifacts for durable coordination.

Keep agent definition identity separate from agent instance identity in traces and APIs. Make concurrent campaigns distinct instances/conversations/runs so orchestration and progress remain legible.

## Effect and error handling

Foundry's service, persistence, transmission, and orchestration internals are Effect-native. Preserve typed errors, resource scopes, cancellation, and service boundaries. Use `Effect.gen`, schemas, layers, and scoped finalizers where they clarify lifecycle or failure semantics. Do not wrap Effect code in ad-hoc promises merely to suppress its error channel.

User-provided Glove callbacks may return promises where the public type permits it. Keep adapters replaceable and avoid coupling domain definitions to the in-memory implementation.

## Observability and inspector language

Emit safe, correlated events using Foundry concepts: definition, instance, conversation, activation, run, model, tool, application, transmission, inbox, memory, MCP, workspace, artifact, and system. Show work intent, action, handoff, status, and result—not private hidden reasoning or raw secrets.

The inspector should make the causal path obvious:

```text
arrival -> matched playbook -> provisioned instance(s) -> conversations -> runs -> artifacts/outcomes
```

Avoid provider/backend error jargon in primary UI copy. Put detailed raw events behind diagnostics while presenting a plain-language current state and next action.

## Verification

Run checks proportional to the change. For framework work, the normal floor is:

```bash
pnpm --filter glove-foundry typecheck
pnpm --filter glove-foundry test
pnpm --filter glove-foundry build
pnpm --filter glove-foundry-example typecheck
pnpm --filter glove-foundry-example verify:architecture
pnpm --filter glove-foundry-example verify
```

For scaffold or public API changes, also generate a temporary project and verify its typecheck. For inspector/site changes, build the site and exercise the affected UI. Assert behavioral invariants rather than snapshots of prose. Finish with `git diff --check` and check that no credential value entered generated files, events, or manifests.
