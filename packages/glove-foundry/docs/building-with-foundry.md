# Building with Glove Foundry

Foundry uses the filesystem for code identity and imported values for code relationships. You should not maintain matching string IDs for static definitions.

## Create and run

```bash
npx glove foundry support-workforce
cd support-workforce
pnpm install
cp .env.example .env.local
pnpm dev
```

`glove foundry dev` discovers the source graph, derives identities, checks types and conventions, generates `.foundry/routes.d.ts`, and starts the runtime and inspector.

## The filesystem is the static registry

```text
agents/
  lead/
    agent.ts                              -> agent id: lead
    apps/helpdesk.app.ts                  -> application id: helpdesk
    transmissions/tickets.transmission.ts -> transmission id: tickets
    predicates/is-urgent.predicate.ts      -> predicate id: is-urgent
    connections/ticket-events.connection.ts
    tools/customer-lookup.tool.ts
    mcp/notion.mcp.ts
    memory/customer.memory.ts
    layers/request-context.layer.ts
    subscribers/audit.subscriber.ts
    schedules/daily-review.ts
```

Nested files produce nested IDs: `tools/calendar/today.tool.ts` becomes `calendar/today`. Every convention file default-exports one definition. That default export is the value other files import and reference.

An explicit `id` remains a compatibility escape hatch for programmatic definitions, but the packaged ESLint preset rejects it in normal file-routed authoring.

## Define an agent

```ts
// agents/lead/agent.ts
import { MemoryStore } from "glove-core"
import { createAdapter } from "glove-core/models/providers"
import { defineAgent } from "glove-foundry"
import { components } from "./composition.js"

export default defineAgent({
  description: "Coordinates customer work",
  components,
  store: ({ conversationId }) => new MemoryStore(`lead:${conversationId}`),
  model: () => createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
  }),
  systemPrompt: (_agent, ctx) =>
    `You are the lead. Workspace: ${ctx.workspaceId}. Message: ${ctx.message.text}`,
  tools: (_agent, ctx) =>
    ctx.message.text.includes("customer") ? [customerLookupTool] : [],
  inboxes: (_agent, ctx) => loadInbox(ctx.workspaceId, ctx.agentId),
})
```

An agent definition describes lazy assembly. It never declares request input or result output; those are Foundry contracts. An agent definition is also not an instance. Instances are durable data and may be created, updated, removed, or reconstructed independently.

## Define and compose colocated pieces

```ts
// agents/lead/tools/customer-lookup.tool.ts
import { defineSharedTool } from "glove-foundry"
import { Effect } from "effect"
import { z } from "zod"

const customerLookup = defineSharedTool({
  description: "Look up a customer",
  config: z.object({ region: z.string() }),
  create: ({ config }) => Effect.succeed(makeCustomerLookupTool(config.region)),
})

export default customerLookup
```

```ts
// agents/lead/composition.ts
import { composeAgent } from "glove-foundry"
import helpdesk from "./apps/helpdesk.app.js"
import customerLookup from "./tools/customer-lookup.tool.js"
import customerMemory from "./memory/customer.memory.js"

export const components = composeAgent(helpdesk, customerLookup, customerMemory)
```

`composeAgent` builds the agent-local catalogue. It does not install applications, MCPs, or shared tools. An instance selects those dynamically.

## Mount a working environment, VFS, and REPL

Foundry mounts the native Glove packages; it does not reimplement their sandboxes. A working environment supplies a persistent virtual filesystem, named scripts, checkpoints, history, artifact export, and a closed model-facing verb set. A REPL is a separate computation surface over registered functions.

```bash
pnpm add glove-working-environment glove-js
# Use glove-python or glove-lisp instead when that is the better agent surface.
```

```ts
// agents/lead/workbench.ts
import { JsSession, defineFn } from "glove-js"
import {
  defineRepl,
  defineWorkingEnvironment,
  foundryDataEnvironmentPersistence,
} from "glove-foundry"
import { z } from "zod"

export const workspace = defineWorkingEnvironment({
  options: ({ assembly }) => ({
    limits: { maxVfsBytes: 64 * 1024 * 1024 },
    onVerb: event => assembly.controls.emit({
      type: "lead.workspace.verb",
      data: event,
    }),
  }),
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
})

export function createRepl(actor: string) {
  const session = JsSession.create({ actor })
  session.register(defineFn({
    name: "customers__active",
    description: "List active customers",
    input: z.object({ region: z.string().optional() }),
    readOnlyHint: true,
    handler: input => customerAdapter.listActive(input),
  }))
  return defineRepl({
    language: "javascript",
    session,
    mount: { discovery: "auto" },
  })
}
```

```ts
// agents/lead/agent.ts
export default defineAgent({
  workingEnvironment: workspace,
  repl: (_agent, ctx) =>
    ctx.messageText.includes("analyse") ? createRepl(ctx.agentId) : undefined,
  run: async (_agent, ctx) => {
    await ctx.vfs?.writeFile("/tmp/request.txt", ctx.messageText)
    return ctx.defaultRun()
  },
  // model, prompt, and other surfaces...
})
```

`workingEnvironment` and `repl` accept the same direct-value-or-lazy-resolver shape as the other assembly fields. JavaScript, Python, and Lisp sessions are supported through one discriminated `defineRepl` API. Foundry exposes the mounted `workingEnvironment`, its guarded `vfs` handle, and the native `repl` session to layers, `configure`, calls, and `run` handlers.

The working environment is closed after every Foundry run. Add a persistence adapter to restore its VFS on the next run. `foundryDataEnvironmentPersistence` uses the data adapter's private snapshot seam, derives ownership from the definition and instance or conversation, and never exposes VFS contents as workspace entries. It requires a durable `FoundryDataAdapter` shared by execution workers. For high-concurrency or large trees, provide a native persistent `Vfs` such as `cachedRemote` in the environment options and let that adapter own locking and storage credentials.

REPL bindings persist for the duration of the assembled run. Glove's native REPL packages intentionally do not define a cross-process snapshot format, so durable artifacts belong in the working environment VFS rather than hidden interpreter variables.

## Definitions reference definitions

Keep each transmission primitive atomic:

```ts
// agents/lead/predicates/is-urgent.predicate.ts
import { Effect } from "effect"
import { defineTransmissionPredicate } from "glove-foundry"

export default defineTransmissionPredicate({
  match: (event: { priority: number }, parameters) =>
    Effect.succeed(event.priority >= Number(parameters.minimum ?? 1)),
})
```

```ts
// agents/lead/events/ticket-created.event.ts
import { defineTransmissionEvent } from "glove-foundry"

export default defineTransmissionEvent({ direction: "inbound" })

// agents/lead/actions/resolve.action.ts
import { definePlaybookAction } from "glove-foundry"

export default definePlaybookAction({
  description: "Resolve the event that activated the playbook",
})
```

```ts
// agents/lead/transmissions/tickets.transmission.ts
import { Effect, Schema } from "effect"
import { defineTransmission } from "glove-foundry"
import ticketCreated from "../events/ticket-created.event.js"
import isUrgent from "../predicates/is-urgent.predicate.js"

const tickets = defineTransmission({
  name: "Tickets",
  description: "Ticket provider contract",
  events: [ticketCreated],
  account: {
    required: true,
    metadata: Schema.Struct({ workspace: Schema.String }),
  },
  inbound: {
    config: Schema.Struct({ queue: Schema.String }),
    event: Schema.Struct({
      id: Schema.String,
      threadId: Schema.String,
      priority: Schema.Number,
      body: Schema.String,
    }),
    classify: () => Effect.succeed(ticketCreated),
    predicates: [isUrgent],
  },
  outbound: {
    config: Schema.Struct({ queue: Schema.String }),
    input: Schema.Struct({ threadId: Schema.String, body: Schema.String }),
    output: Schema.Struct({ messageId: Schema.String }),
    adapter: { deliver: (input) => userTicketAdapter.deliver(input) },
  },
})

export default tickets
```

```ts
// agents/lead/apps/helpdesk.app.ts
import { defineApp } from "glove-foundry"
import tickets from "../transmissions/tickets.transmission.js"
import ticketEvents from "../connections/ticket-events.connection.js"

export default defineApp({
  description: "Ticket application",
  inbound: [tickets],
  outbound: [tickets],
  connections: [ticketEvents],
})
```

The application can own multiple inbound and outbound transmissions. Installing it mounts outbound transmissions as validated tools. Connections remain dormant until an active instance or subscription needs the installed app and playbook.

## Config is inferred from its definition

Zod config schemas flow into `install`, layer and memory selection, and the install callback:

```ts
const helpdesk = defineApp({
  description: "Ticket application",
  config: z.object({ queue: z.string(), retries: z.number().default(2) }),
  install: ({ config }) => {
    config.queue   // string
    config.retries // number
    return Effect.void
  },
})

install(helpdesk, { queue: "support" })        // valid
install(helpdesk, { queue: 42 })               // TypeScript error
```

Effect transmission schemas flow into account metadata, route config, inbound events, outbound inputs, and outbound outputs. Use `configureLayer(layer, config)` and `configureMemory(memory, config)` when those definitions expose config schemas. `defineConfig({...})` rejects unknown top-level and nested framework keys while retaining the exact inferred value type.

Runtime decoding still runs at every persistence or execution boundary; TypeScript is not the only validator.

## Runtime topology is data

Accounts, routes, bindings, agent instances, and conversations are data records. Their IDs are not static code identities: a UI or adapter may create and update them, so their IDs remain explicit.

```ts
// agents/lead/topology.ts
import { defineAccount, defineInboundRoute } from "glove-foundry"
import tickets from "./transmissions/tickets.transmission.js"

export const supportAccount = defineAccount({
  id: "support-account",
  transmission: tickets,
  externalAccountId: "support-team",
  accessRef: "my-adapter://support-team",
  metadata: { workspace: "support" },
})

export const ticketInbound = defineInboundRoute({
  id: "ticket-inbound",
  transmission: tickets,
  account: supportAccount,
  visibility: "workspace",
  enabled: true,
  config: { queue: "support" }, // inferred from tickets.inbound.config
})
```

`accessRef` is opaque to Foundry. Credential acquisition and refresh belong to the user-owned account-session adapter.

## Runtime-composed playbooks and dynamic installations

```ts
// agents/lead/agent.ts
import { composePlaybook, defineAgent } from "glove-foundry"
import resolve from "../actions/resolve.action.js"
import helpdesk from "../apps/helpdesk.app.js"
import ticketCreated from "../events/ticket-created.event.js"
import isUrgent from "../predicates/is-urgent.predicate.js"
import tickets from "../transmissions/tickets.transmission.js"
import { supportAccount, ticketInbound } from "../topology.js"

export default defineAgent({
  description: "Support lead",
  playbooks: (_agent, ctx) => [composePlaybook({
    name: "urgent-ticket",
    transmission: tickets,
    match: {
      event: ticketCreated,
      routes: [ticketInbound],
      predicate: { definition: isUrgent, parameters: { minimum: ctx.agentInstance.context.minimum ?? 3 } },
    },
    directives: [{ action: resolve, instruction: "Investigate and respond." }],
    applications: [helpdesk],
  })],
  // model and other surfaces...
})
```

```ts
import { defineAgentInstance, install } from "glove-foundry"
import lead from "./agent.js"
import helpdesk from "./apps/helpdesk.app.js"

export const leadInstance = defineAgentInstance(lead, {
  workspaceId: "support",
  installations: [install(helpdesk, { queue: "support", retries: 3 })],
  playbooks: [], // populated by the lazy agent resolver on its first assembly
})
```

`composePlaybook` is called at runtime, not exported as a static playbook definition. Foundry derives the playbook id, converts direct primitive references into a value-only record, and reconciles it onto the instance. A frontend can also provide instance playbook data directly; definition-origin policy and frontend-origin policy remain distinguishable.

## Background activation without an existing instance

```ts
const [urgentTicket] = persistedAgent.playbooks
await runtime.putPlaybookSubscription({
  id: subscriptionId,
  workspaceId: persistedAgent.workspaceId,
  enabled: true,
  playbook: urgentTicket,
  targets: runtimeSelectedTargets,
  createdAt: now,
  updatedAt: now,
})
```

The subscription is evaluated even when no matching instance exists. A matching inbound event can atomically provision one or many subscribed agents, create their conversations, and start their runs.

## Agent-local schedules and future work

```ts
const dailyReview = defineSchedule({
  name: "daily-review",
  timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  message: "Review unresolved support work.",
})

export default defineAgent({
  schedules: (_agent, ctx) => ctx.agentInstance.context.paused ? [] : [dailyReview],
  // ...
})
```

```ts
// A running agent uses the framework-owned tool:
glove_foundry_schedule({
  message: "Review open support work.",
  timing: { kind: "every", interval: "24h" },
})

// Suspend this conversation and wake the same instance later:
glove_foundry_sleep({
  kind: "for",
  duration: "20m",
  message: "Check whether the deployment has finished, then resolve it.",
})

glove_foundry_schedules({ action: "list" })
glove_foundry_schedules({ action: "update", activationId, timing: { kind: "every", interval: "2h" } })
glove_foundry_schedules({ action: "cancel", activationId })
```

Schedules are agent-local composable values; Foundry has no root schedule registry or automatically discovered schedule files. Immediate spawning, future activation, recurrence, management, and suspension are separate runtime operations. Foundry stores activation state through `FoundryDataAdapter` before arming its private execution backend, so a durable adapter can reconstruct pending work on startup. Sleep preserves the instance and conversation so the wake-up resumes with the same stored context.

## Boundary checklist

- Static code identity comes from the convention filename.
- Static code relationships use imported values.
- IDs appear when definitions are serialized into durable data.
- Runtime data IDs remain explicit because users and adapters create those records.
- Applications, shared tools, and MCPs mount only when an instance installs them.
- Memory and inboxes are agent-definition surfaces and may resolve from current context/message.
- Working environments and one native REPL are agent-definition surfaces and may resolve from current context/message.
- VFS persistence, remote storage, and locking remain adapter-owned.
- Transmissions own executable integration logic; playbooks remain serializable policy.
- Provider adapters own credential acquisition and refresh.
