# Glove Foundry

Glove Foundry is an Effect-native application framework for typed, observable Glove agents. It gives agent projects the conventions that Next.js gives web projects: file routes, colocated composition, a development server, generated types, durable runtime data, and a stable client/API.

**[Read the Foundry handbook](https://glove.dterminal.net/foundry/docs)** for the guided architecture, installation, composition, applications, automation, workspaces, multi-agent, observability, and deployment documentation.

The development server includes a hierarchical inspector for definitions, instances, runs, automations, integrations, and shared workspaces. See the [inspector guide](./docs/inspector.md).

```bash
npx glove-foundry init my-agent-app
cd my-agent-app
pnpm install
pnpm dev
```

Inside an installed project, the framework binary also supports `glove foundry dev`
and `glove foundry start`.

## The mental model

Foundry keeps code and data deliberately separate.

| Kind | Lives in | Purpose |
| --- | --- | --- |
| Agent definition | `agents/<route>/agent.ts` | Reusable behavior and lazy assembly |
| Application, transmission, tool, MCP, memory, layer | Beside the owning agent | Reusable capability catalogue |
| Agent instance | `FoundryDataAdapter` | Workspace identity, context, installations, playbooks |
| Conversation | `FoundryDataAdapter` | One conversation owned by one instance |
| Playbook subscription | `FoundryDataAdapter` | Background policy that may provision zero, one, or many instances |
| Route/account/binding | Application data or topology adapter | External integration topology without credential material |
| Application connection | Application definition | Long-lived inbound provider worker |
| Schedule definition | Lazy agent resolver | Agent-local desired timing policy |
| Scheduled activation | `FoundryDataAdapter` | Reconstructed trigger created from a definition or agent tool |

An agent definition never declares request input or output. Foundry owns the `FoundryRequest` and `FoundryResult` contracts. An instance can be changed and reconstructed without editing its definition.

## Colocated agent composition

```text
agents/
  support-lead/
    agent.ts
    composition.ts
    apps/helpdesk.app.ts
    actions/respond.action.ts
    events/message-received.event.ts
    transmissions/messages.transmission.ts
    predicates/is-urgent.predicate.ts
    connections/provider-events.connection.ts
    tools/customer-context.tool.ts
    mcp/knowledge.mcp.ts
    memory/customer.memory.ts
    inboxes/work.inbox.ts
    layers/audit.layer.ts
    subscribers/metrics.subscriber.ts
foundry.application.ts
foundry.config.ts
```

```ts
// agents/support-lead/agent.ts
import { defineAgent } from "glove-foundry"
import { components } from "./composition.js"

export default defineAgent({
  description: "Owns difficult support conversations",
  components,
  model: (_agent, ctx) => chooseModel(ctx.message),
  systemPrompt: (_agent, ctx) => promptFor(ctx.agentInstance, ctx.message),
  tools: async (_agent, ctx) => toolsAllowedFor(ctx.agentInstance, ctx.message),
  memory: (_agent, ctx) => memoryFor(ctx.agentInstance, ctx.conversation),
  inboxes: (_agent, ctx) => loadInbox(ctx.agentId, ctx.conversationId),
})
```

Every lazy resolver receives the current native Glove `Message`, prior messages, request, definition id, instance id, conversation id, workspace id, instance context, and current installations.

## Filenames own code identity; data owns runtime identity

Every static primitive default-exports one definition. Foundry derives its id
from the convention path: `agents/support-lead/tools/calendar/today.tool.ts`
becomes `calendar/today`. Static definitions do not repeat an `id` string.

Code-authored relationships use imported values. Runtime policies are composed lazily by the agent definition and normalized only when they become instance data.

```ts
const inbound = defineInboundRoute({
  id: "helpdesk-inbound",
  transmission: helpdeskTransmission,
  account: supportAccount,
  visibility: "workspace",
  enabled: true,
  config: {},
})

export default defineAgent({
  description: "Support lead",
  playbooks: (_agent, ctx) => [composePlaybook({
    name: "urgent-support",
    transmission: helpdeskTransmission,
    match: {
      event: messageReceived,
      routes: [inbound],
      predicate: { definition: isUrgent, parameters: { minimum: ctx.agentInstance.context.minimum ?? 3 } },
    },
    directives: [{ action: respond, instruction: "Resolve the request." }],
    applications: [helpdeskApp],
  })],
  // model, tools, and other lazy surfaces...
})
```

The stored instance contains `definitionId`, installation ids, transmission ids, event ids, action ids, account ids, and route ids because JSON and databases cannot preserve object identity. Reconstructors validate and freeze that data on load. Raw string references remain appropriate at HTTP, database, and frontend boundaries. Accounts, routes, bindings, instances, and conversations also keep explicit IDs because they are dynamic records that a UI or adapter may create. Code points to those dynamic records through the record value, such as `{ account: supportAccount }`; it does not copy their ids.

Definition config is followed through the imported value. Zod config schemas infer `install(...)` and decoded install-hook config; Effect transmission schemas infer account metadata, route config, inbound events, and outbound input/output. `defineConfig` preserves its exact type and rejects unknown framework keys.

## Applications, transmissions, and connections

Applications are headless, installable capability definitions. They may own multiple inbound and outbound transmissions. Outbound transmissions become tools only when the application is installed on an instance.

```ts
// connections/provider-events.connection.ts
export default defineConnection({
  description: "Receives provider events",
  transmissions: [messageTransmission, reactionTransmission],
  connect: (ctx) => Effect.gen(function* () {
    const session = yield* openUserOwnedProviderAdapter(ctx.account)
    yield* ctx.ready()
    yield* session.consume((event) => ctx.receive({
      route: chooseRoute(ctx.routes, event),
      eventId: event.id,
      threadKey: event.threadId,
      raw: event,
    }))
  }),
})
```

Foundry supervises connection lifetime and retry, but never acquires or refreshes credentials. Account references contain only metadata and an opaque `accessRef`. Your `accountSessions` or provider adapter owns credential material and refresh.

Connections are desired only when:

- an instance has installed the application and has a matching inbound playbook; or
- an enabled playbook subscription targets the application installation.

This covers webhook/socket ingestion and long-lived provider bots without exposing the execution backend as a framework primitive.

## Background playbooks and lazy provisioning

A playbook is serializable runtime policy. It is composed by an agent resolver or frontend from transmission primitives, then persisted on the instance. Executable normalization, authentication, predicates, serialization, and delivery live on the transmission definition.

```ts
const [urgentSupport] = agentInstance.playbooks
await runtime.putPlaybookSubscription({
  id: subscriptionId, // runtime data id from your UI/data layer
  workspaceId: agentInstance.workspaceId,
  enabled: true,
  playbook: urgentSupport,
  targets: runtimeSelectedTargets,
  createdAt: now,
  updatedAt: now,
})
```

Provisioning modes:

- `singleton`: one stable instance for the subscription target.
- `per-thread`: one instance per inbound route/thread.
- `per-event`: a new stable instance per external event id.
- `existing`: deliver only to listed persisted instance ids.
- `custom`: delegate one-to-many selection to the application `provisioner` adapter.

The data adapter atomically enforces `provisioningKey`. Inbound delivery claims are also adapter-backed, so retrying the same route/event does not create duplicate runs.

## Conversations and shared work

One agent instance can own many conversations. Foundry also provides adapter-backed workspace entries, shared inbox items, tasks, and scoped environment values. These are data primitives, not prompt conventions, so agents can pass documents and work records by reference instead of copying context.

## Immediate work, future work, and sleep

Schedules are composable agent-local primitives, never a root registry. A lazy `schedules(agent, ctx)` resolver loads desired schedules into Foundry, while running agents can manage their persisted triggers through framework-owned tools:

- `glove_foundry_spawn` invokes work immediately.
- `glove_foundry_schedule` creates a one-time (`at` or `after`), interval (`every`), or calendar-aware (`cron`) activation.
- `glove_foundry_schedules` lists, updates, or cancels triggers owned by the current instance.
- `glove_foundry_sleep` suspends the current logical run until an absolute time or for a duration, then wakes the same instance and conversation with a resolution message.

Both operations persist adapter-backed activation data before the execution backend is armed. Pending wake-ups and recurring work are reconstructed when the runtime starts; the bundled memory adapter is for development, while a durable `FoundryDataAdapter` supplies production persistence.

Durations accept compact forms such as `30s`, `20m`, and `2h`, as well as Effect duration forms such as `20 minutes`. The execution backend remains private; agent projects see only these purpose-built tools and correlated activation events.

## Development and inspection

```bash
pnpm dev
```

The inspector presents a causal activation path:

```text
arrival → matching playbook → provisioned workforce → runs and outcomes
```

It also shows instance installations, active playbook subscriptions, application connections, and the correlated trace for each run. Backend-specific runner concepts are not part of the Foundry UI or public client.

Useful endpoints:

```text
GET  /api/manifest
GET  /api/agent-instances
PATCH /api/agent-instances/:id
GET  /api/playbook-subscriptions
PUT  /api/playbook-subscriptions
GET  /api/application-connections
POST /api/transmissions/:routeId/fire
GET  /api/runs
GET  /api/events
```

See [Building with Foundry](./docs/building-with-foundry.md), [Architecture](./docs/architecture.md), and the runnable [`examples/foundry-agent`](../../examples/foundry-agent).
