# Architecture

## Boundary rule

Foundry exposes concepts that belong to an agentic application. Its execution engine is private and replaceable.

```text
file-routed code definitions           durable data
────────────────                       ────────────
agent definition ────────────────┐      agent instance
application + transmissions ─────┼──▶   installations + playbooks
tools / MCP / memory / layers ───┤      conversations + workspace state
working environment / REPL ──────┘      VFS snapshots + artifacts
                                        subscriptions + delivery claims

              resolve file identity and serialize here
```

No public config, client, HTTP route, manifest, or inspector component requires knowledge of the private runner.

## Definition versus instance

An agent definition is immutable code. Its convention filename owns its identity; the definition never repeats that route as an `id`. It describes the catalogue and lazy assembly functions available to all instances of that route. Applications, transmissions, predicates, connections, shared tools, MCPs, memory profiles, layers, subscribers, and playbook actions are reusable code primitives. Playbooks are runtime policy composed by an agent resolver or frontend. Schedules are agent-local definition values reconciled into runtime activation data; neither playbooks nor schedules have a global static registry.

An agent instance is mutable desired-state data:

```ts
interface AgentInstance {
  id: string
  definitionId: string
  workspaceId: string
  provisioningKey?: string
  context: Record<string, unknown>
  installations: AgentInstallation[]
  playbooks: AgentPlaybook[]
  createdAt: string
  updatedAt: string
}
```

`FoundryDataAdapter` is the source of truth. Every run reloads the instance and conversation, then assembles a fresh Glove from the referenced definition and current message. Lazy `playbooks` and `schedules` resolvers reconcile desired runtime data before Foundry executes subsequent activations. `configureAgent` atomically replaces frontend-editable context, installations, and playbooks.

Definitions never accept an invocation input or output schema. Foundry owns those contracts.

## Reference normalization

Code references values:

```ts
composePlaybook({
  name: "mention-response",
  transmission: messages,
  match: { event: messageReceived, routes: [inbound], predicate: { definition: isMention } },
  directives: [{ action: respond, instruction: "Answer the message." }],
  applications: [chatApp],
})
```

Persisted records reference ids:

```ts
{
  transmissionId: "messages",
  match: { event: "message-received", routeIds: ["chat-inbound"], predicate: { name: "is-mention" } },
  directives: [{ action: "respond", instruction: "Answer the message." }],
  applications: ["chat-app"]
}
```

File-routed definition helpers retain direct references for reusable code primitives. `composePlaybook` instead runs inside lazy assembly: Foundry derives a stable instance-scoped id, converts its imported references to strings, and persists the resulting policy. Reconstruction accepts the value-only storage/API form.

Runtime records are different: account, route, binding, agent-instance, and conversation IDs are data-owned because those records can be created or edited by a UI or adapter.

## Typed config flow

Config schemas belong to the definition that consumes them. Zod schemas infer the input accepted by `install`, `configureLayer`, and `configureMemory`, and infer decoded config inside their callbacks. Effect transmission schemas infer account metadata, route config, inbound events, and outbound input/output. All schemas are decoded again at runtime boundaries.

`defineConfig` keeps the exact inferred configuration type and rejects unknown framework keys, including nested server, execution, and observability keys.

## Applications and transmissions

An application owns one or many transmission definitions. A transmission may define:

- account metadata schema;
- capability declarations;
- inbound config/event schemas, authentication, normalization, classification, predicates, and serialization; and
- outbound config/input/output schemas and a delivery adapter.

Applications are not installed by default. Their optional install hook is a headless factory that may contribute tools without receiving the Glove runtime or store. Foundry passes an operation-scoped account-session function when the user provided one; it never passes raw credentials.

## Inbound activation

```text
application connection / HTTP fire
              │
              ▼
 authenticate + normalize + classify
              │
              ▼
 match instance playbooks and durable subscriptions
              │
              ├── existing instances
              └── atomically provision zero, one, or many instances
                          │
                          ▼
              merge serialized event into a conversation
                          │
                          ▼
                    enqueue agent runs
```

The delivery key is `routeId:eventId`. The data adapter claims it before provisioning. A completed claim stores run ids; a retry returns those runs. Failed dispatch releases the pending claim.

## Playbook subscription

A subscription is durable data containing one playbook and one or more targets. It is evaluated even if no matching instance exists.

Each target selects a provisioning policy. The built-in policies derive deterministic `provisioningKey` values. A custom policy calls the application-owned provisioner, which can return multiple instance seeds. `provisionAgent` is atomic at the adapter boundary.

The subscription target also carries desired installations and initial context because these are instance data chosen by a frontend/operator, not static agent-definition defaults.

## Application connections

A connection is colocated with its application and names the inbound transmissions it may emit. It receives a narrow context:

- application/connection/definition/workspace identity;
- safe account metadata and routes;
- an abort signal;
- `ready()`;
- `receive()`; and
- optional user-owned `withAccountSession()`.

The supervisor derives desired connections from installed application + active playbook combinations. It starts, stops, retries, and observes them. Its implementation can use any backend; retry/worker topology is not exposed as an authoring primitive.

## Conversations and workspaces

Conversations are independent data records owned by an instance. Transmission conversations derive stable ids from route, instance, and external thread. Direct conversations can be created freely.

Workspace entries, inbox items, tasks, scoped environment values, and optional working-environment snapshots share the data adapter. They are suitable for document handles and coordination state across agents.

## Working environment and REPL boundary

Foundry owns contextual selection, mounting, lifecycle, and observability. The native packages retain their own semantics:

- `glove-working-environment` owns the guarded VFS, script sandbox, tools, snapshots, limits, adapters, and cleanup;
- `glove-js`, `glove-python`, and `glove-lisp` own their interpreter sessions and capability catalogs; and
- consumer adapters own remote VFS storage, locking, credentials, and persistence policy.

An agent can resolve either surface from its current instance, conversation, workspace, or message. Foundry exposes the mounted environment and guarded VFS to execution contexts, snapshots before cleanup when a persistence adapter is present, and emits safe mount/save telemetry. It permits one REPL per assembled agent to prevent colliding execution and discovery tool names.

The durable boundary is the VFS. Native REPL interpreter bindings are run-scoped and are not serialized by Foundry.

## Lazy assembly

Every run resolves model, system prompt, tools, memory, inboxes, subscribers, layers, calls, playbooks, schedules, mesh, working environment, REPL, and custom build/run functions against `AgentAssemblyContext`. Resolvers can use both the instance and the current message, which makes message-dependent provisioning a first-class behavior rather than an environment switch.

Installable applications, shared tools, and MCPs are filtered by the current instance desired state. Memory belongs to the definition but can be selected lazily. Inboxes must always be lazy functions.

## Observability

All public events use Foundry categories: agent, run, model, tool, extension, application, inbox, memory, MCP, activation, system, and log. Each event may correlate definition id, run id, sequence, timestamp, and safe data.

The inspector presents the causal chain rather than backend logs. Raw event data remains available behind each run for debugging.

## Credential boundary

Foundry stores only account metadata and opaque access references. It does not:

- acquire credentials;
- refresh tokens;
- persist secret values in manifests;
- choose an account for a user; or
- expose credential material to prompts or the inspector.

Applications define account-session and provider adapters. Playbooks and instance installation data select account references.
