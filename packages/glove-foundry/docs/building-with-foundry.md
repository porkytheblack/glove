# Building with Glove Foundry

Foundry uses the filesystem for code identity and imported values for code relationships. You should not maintain matching string IDs for static definitions.

## Create and run

Use Node 20.12 or newer; Node 22.13+ is recommended and required by optional SQLite memory adapters. In a terminal, `init` opens a guided wizard: choose a directory, standalone or Next.js integration, guided or minimal starter, package manager, and dependency installation. Review the plan before any files are written. Arrow keys select, Enter confirms, and Ctrl+C cancels without creating the project. The wizard never requests credentials.

For CI or repeatable setup, use explicit choices:

```bash
npx glove-foundry init support-workforce --yes --target standalone --template travel-concierge --package-manager pnpm --no-install
```

`--no-interactive` also skips prompts; piped input never opens them. `--interactive` requires a terminal. `--install` opts into installation in scripts; otherwise install dependencies yourself. Existing project files are preserved; installation failures leave the generated project available for retry. Use `glove foundry init --help` for all setup and runtime flags. The [setup wizard and CLI reference](https://glove.dterminal.net/foundry/docs/getting-started) walks through the entire first run.

```bash
npx glove foundry init support-workforce
cd support-workforce
cp .env.example .env.local
pnpm install
pnpm dev
```

`glove foundry dev` discovers the source graph, derives identities, generates `.foundry/routes.d.ts`, and starts the runtime and inspector. Run the generated `typecheck` and `lint` scripts separately to validate types and authoring conventions.

The HTTP server keeps JSON requests at 1 MB by default. For a trusted multimodal
client that sends base64 images or documents, raise the explicit typed bound rather
than removing it:

```ts
export default defineConfig({
  server: { port: 4141, messageBodyBytes: 40 * 1024 * 1024 },
})
```

Native Glove media parts may include a human-facing `name`. A custom `run` handler can
persist or normalize those parts and then call `context.defaultRun(enrichedMessage)`
to keep the standard Glove loop and conversation semantics.

The generated project depends on the exact Glove versions the `glove-foundry` that created it was built against. That is not tidiness: a narrower range makes the package manager install a second copy of `glove-js`, and the two `JsSession` classes then fail to type-match.

### Templates

| `--template` | What you get |
| --- | --- |
| `travel-concierge` (default) | A travel agent that searches flights, installs a calendar application, replies over a chat transmission, remembers the traveller, wakes on a schedule, and owns a sandboxed VFS and REPL. One example per convention. |
| `minimal` | One agent and one tool. |

The travel concierge runs before you configure a provider — `lib/demo-model.ts` answers deterministically until `OPENROUTER_API_KEY` is set, so the first run produces a real trace with real tool calls.

### Adding Foundry to an existing Next.js app

```bash
cd my-next-app
npx glove foundry init . --target nextjs   # or just: npx glove foundry init .
```

A directory holding a Next.js app is detected, so `--target` is usually unnecessary. Foundry then joins the project rather than taking it over:

| Path | What lands there |
| --- | --- |
| `foundry/agents/**` | The agents |
| `foundry/foundry.application.ts` | Data adapter, accounts, routes |
| `foundry/package.json` | `{"type":"module"}`, scoping ESM to the agents |
| `foundry.config.mts` | Points the runtime at `foundry/agents` |
| `lib/foundry.ts` | A typed client your app imports |
| `app/api/<agent>/route.ts` | An example route handler |

Your `package.json` keeps its name, scripts, and dependencies; it gains `foundry:dev`, `foundry:start`, and the Glove packages. Nothing it already owns is overwritten.

The runtime is a separate process from `next dev`, deliberately — it holds durable state and should not restart when a component changes. The app reaches it over HTTP through `lib/foundry.ts`, so no part of the agent graph is bundled into your app, and `FoundryRoutes` stays a type-only import.

Two details make this work in a Next.js project specifically. A Next.js app is not `"type": "module"`, so Node would load the agents through the CommonJS resolver and fail on Foundry's ESM-only export map; the nested `foundry/package.json` scopes ESM to the agent tree, and `.mts` makes the config unambiguous whatever the root declares.

In production, set `FOUNDRY_URL` to wherever the runtime is deployed and keep it
inside a deliberate trust boundary. Loopback is the default. Foundry refuses to bind
another interface unless `foundry.application.ts` supplies an Effect-native request
authorization adapter:

```ts
import { Effect } from "effect"
import { defineApplication } from "glove-foundry"

export default defineApplication({
  name: "Support workforce",
  requestAuthorization: {
    identifier: "company-control-auth",
    challenge: 'Bearer realm="Support Foundry"',
    authorize: request => Effect.tryPromise({
      try: () => companyIdentityAdapter.authorize({
        authorization: request.authorization,
        cookie: request.cookie,
        path: request.path,
      }),
      catch: cause => new Error("Control authorization unavailable", { cause }),
    }),
  },
})
```

This is verification, not credential acquisition: your adapter owns tokens, cookies,
OIDC/trusted-proxy identity, refresh, revocation, and rate policy. The result is only
a boolean; credential material does not enter Foundry state, manifests, prompts, or
events. Put TLS and a restrictive firewall/proxy in front of any network-visible
listener.

A remote typed client resolves its own headers at request time:

```ts
const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL,
  authorization: {
    identifier: "company-control-client",
    headers: () => companyIdentityAdapter.requestHeaders(),
  },
})
```

For a single-host deployment, persist Foundry's mutable data with the bundled atomic file adapter:

```ts
import { FileFoundryDataAdapter, defineApplication } from "glove-foundry"
import { join } from "node:path"

const data = new FileFoundryDataAdapter({
  file: join(process.env.AGENT_DATA_DIR ?? ".data", "foundry.json"),
  agents: [primaryInstance],
  conversations: [primaryConversation],
  subscriptions: [inboundSubscription],
})

export default defineApplication({
  name: "Support workforce",
  data,
  conversationStore: createConversationStore,
})
```

`FileFoundryDataAdapter` coordinates sibling execution processes with an advisory lock and commits by atomic rename. It persists instances, subscriptions, delivery claims, activations, conversations, workspace data, VFS snapshots, inbox items, tasks, and non-secret environment data. Use a transactional database adapter when several hosts need to share the same state.

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

### HTTP and stdio MCP definitions

An MCP definition is a typed catalogue entry, not a global connection. Its instance
installation decides whether it is present for an agent. HTTP remains concise; stdio
uses an explicit transport:

```ts
const projectTools = defineMcp({
  description: "Approved project operations",
  entry: {
    name: "Project tools",
    description: "Search and update the mounted project",
    transport: {
      kind: "stdio",
      command: "/opt/agents/project-mcp",
      args: ["--stdio"],
    },
    includeTools: ["search_*", "read_*", "create_issue"],
    excludeTools: ["delete_repository"],
    resources: true,
    prompts: false,
    connectTimeoutMs: 15_000,
    requestTimeoutMs: 60_000,
    idleTimeoutMs: 15 * 60_000,
    maxLifetimeMs: 24 * 60 * 60_000,
  },
})
```

For HTTP, return `{ url: "https://mcp.example.com/mcp", ... }` or an explicit
`{ transport: { kind: "http", url }, ... }`. Authentication and stdio environment
values are connection-time adapter concerns: implement `getAuthHeaders` /
`getAccessToken` for HTTP and `getStdioEnvironment` for stdio. Never place their
resolved values in definition config, installation data, manifests, or events.

`includeTools` and `excludeTools` accept exact un-namespaced names or globs. A
non-empty allowlist is authoritative. `resources` and `prompts` independently control
capability-aware list/read and list/get utility tools. Selection and defensive result sanitization happen at the shared MCP
connection boundary, so boot reload, lazy activation, and scratchpad bridges see
the same safe capability set. Finite connection and request timeouts keep broken
servers from stalling a run indefinitely.
Stdio-only idle and lifetime limits can recycle memory-heavy children without
interrupting in-flight calls; adapter environment values are resolved again on reopen.

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
    programmaticTools: {
      maxCalls: 50,
      select: ({ tools }) => tools
        .filter((tool) => tool.name.startsWith("workspace_"))
        .map((tool) => ({
          tool,
          name: `workspace__${tool.name.slice("workspace_".length)}`,
          server: "workspace",
          readOnly: ["workspace_read_file", "workspace_ls", "workspace_grep"]
            .includes(tool.name),
        })),
    },
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

`programmaticTools` turns an explicit least-privilege projection of the live
agent tool registry into functions inside that sandbox. The selector runs after
application transmissions, instance-installed tools and MCPs, calls, memory,
mesh, and `configure`, so it sees the actual message-specific assembly. It must
return those exact tool objects (or `{ tool, ...discoveryMetadata }` wrappers),
not copied names. Nothing is projected by default.

This is the programmatic tool-calling path for workflows with several reads,
loops, filters, or branches: the model writes one complete program and only its
last, structurally bounded value returns to conversation context. A shared
`maxCalls` budget defaults to 50 for the assembled run. Foundry validates Zod
inputs again, forwards cancellation, records safe started/completed/failed
events for each underlying call, and refuses to execute a tool whose current
input requires interactive approval. The agent must call that tool normally so
the approval surface remains visible. Do not select outbound or destructive
tools merely because a sandbox can call them.

The working environment is closed after every Foundry run. Add a persistence adapter to restore its VFS on the next run. `foundryDataEnvironmentPersistence` uses the data adapter's private snapshot seam, derives ownership from the definition and instance or conversation, and never exposes VFS contents as workspace entries. It requires a durable `FoundryDataAdapter` shared by execution workers. For high-concurrency or large trees, provide a native persistent `Vfs` such as `cachedRemote` in the environment options and let that adapter own locking and storage credentials.

For HTTP requests and file transfers, put `fetchFiles()` from `glove-env-fetch` in the environment options’ `stdlib`. Mount `secret()` from `glove-env-secret` when scripts need scoped key metadata or references, and supply the same instance-scoped host store to fetch credential aliases. Neither credentials nor the store are included in the VFS snapshot; re-supply them each run. The [HTTP and secrets guide](../../glove-working-environment/HTTP-AND-SECRETS.md) covers the complete setup, private-network opt-ins, cancellation, and persistent store boundaries.

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
    observe: ({ threadId, body }) => ({ threadId, characters: body.length }),
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

The application can own multiple inbound and outbound transmissions. Installing it mounts outbound transmissions as validated tools. Each generated tool awaits the parent-owned delivery adapter and returns its output after the transmission's output schema validates it. The agent subprocess never receives provider credentials or an account session. Cancellation propagates back to adapters through `context.signal`. Connections remain dormant until an active instance or subscription needs the installed app and playbook.

Outbound inputs cross the worker boundary through a private, mode-0600 command record rather than the event stream or child stdout. Foundry deletes a settled exchange. Retained observability is redacted by default; define `outbound.observe(input)` when the transmission can expose a deliberate, secret-safe projection such as a route, byte count, or digest. Never return credentials or file bodies from that projection.

Outbound adapters that select an account receive `context.withAccountSession`. Use it to enter the same user-owned, operation-scoped credential boundary used by application installers and inbound connections:

```ts
adapter: {
  deliver: (input, context) => context.withAccountSession!(
    "tickets:reply",
    session => sendTicketReply(session, input, context.signal),
  ),
}
```

The session value is never added to Foundry data or observability. Credential acquisition, refresh, SDK construction, and cleanup remain responsibilities of the adapter supplied on the agent definition.

Inbound connections normally isolate conversations by route and `threadKey`. A
trusted identity adapter can additionally provide an agent-scoped
`conversationKey` when two authenticated external identities represent the same
principal:

```ts
yield* context.receive({
  route,
  eventId: event.id,
  threadKey: providerThread.id,
  conversationKey: `principal:${resolvedIdentity.id}`,
  conversationScope: "agent",
  awaitCompletion: true,
  raw: event,
})
```

Foundry reuses an existing conversation whose data context has that key, or creates
a deterministic conversation for the agent. The transport thread remains on the
event and outbound route, so joining private history never changes where a reply is
delivered. Only use this after an adapter authenticates and explicitly links the
identities; route-scoped isolation remains the default.

`receive()` normally resolves once matching runs have been durably dispatched. Set
`awaitCompletion: true` for a stateful chat or voice transport that must not accept
the next turn until every subscribed run reaches a terminal state. This keeps a
conversation transcript ordered without changing direct requests or unrelated
connections. A high-throughput adapter can instead keep the default and implement
its own per-conversation queue.

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
glove_foundry_schedules({ action: "pause", activationId })
glove_foundry_schedules({ action: "resume", activationId })
glove_foundry_schedules({ action: "cancel", activationId })
```

Schedules are agent-local composable values; Foundry has no root schedule registry or automatically discovered schedule files. Immediate spawning, future activation, recurrence, management, and suspension are separate runtime operations. Pausing disarms a trigger without losing its message, timing, payload, ownership, or definition provenance; edits made while paused remain paused until an explicit resume. Foundry stores activation state through `FoundryDataAdapter` before arming its private execution backend, so a durable adapter can reconstruct active work—and keep paused work disarmed—on startup. Sleep preserves the instance and conversation so the wake-up resumes with the same stored context.

Schedule management reloads the owning instance's persisted activations on each
tool call and overlays the current run's pending commands. A recurring run can
therefore inspect and cancel its own trigger even when it was inserted after the
assembly snapshot. Another instance's schedules do not appear in that tool view.

For an application-specific loop or goal controller, reuse these tools and store
the policy in `FoundryDataAdapter`; do not create another timer service. Mount native
`glove-memory/goals` for goal tracking. Durable coordination can use the optional
`compareAndSetWorkspaceEntry(entry, expectedUpdatedAt)` adapter method: `null`
means the key must be absent, an update compares the previously read timestamp,
and every accepted replacement must advance that timestamp. Validate the value
with the consumer's schema and retry conflicts against fresh state. Both bundled
adapters support it; database adapters should implement it transactionally. Every
writer to that coordinated key must use the same contract.

## Client and control protocols

Foundry exposes one runtime through three HTTP shapes. The native `/api` routes are
the typed control plane used by `createFoundryClient`. OpenAI-compatible clients can
use streaming or non-streaming `/v1/chat/completions` and `/v1/responses`. Automation
hosts can create an asynchronous run, inspect it, follow its events, and stop it:

```text
POST /v1/runs
GET  /v1/runs/:runId
GET  /v1/runs/:runId/events
POST /v1/runs/:runId/stop
POST /v1/runs/:runId/steer
GET  /v1/capabilities
GET  /health/detailed
```

All three paths resolve the supplied model to a persisted agent instance and write
into a durable conversation. Reuse `conversation_id`, `user`, or the returned
`x-foundry-conversation-id` header to continue the same conversation. Run-event
requests return JSON by default and become live server-sent events when the client
sends `Accept: text/event-stream`.

`/v1/capabilities` is authoritative: a client must inspect it instead of assuming a
control feature exists. Steering is explicitly `interrupt-and-restart`: Foundry
cooperatively cancels active work, waits for a terminal boundary, then starts the
guidance as a replacement run in the same durable conversation with lineage back to
the source. It never injects arbitrary text halfway through a tool side effect.
The typed client exposes the same boundary as `handle.steer(message)`, returning a
new run handle plus the source id and whether active work was interrupted.

Build chat hosts with `createFoundryClient`: resume durable conversations, read
`conversationTranscript`, follow correlated run events, and route new guidance
during active work through the typed steering operation.

## Effect approvals

A Glove tool can set `requiresPermission: true` or return a boolean from
`requiresPermission(input)`. In Foundry, an unset decision becomes a public,
expiring approval record rather than an unresolved in-process display promise.
The worker pauses; a trusted host lists and resolves the exact request:

```ts
const [approval] = await client.approvals({
  runId: handle.id,
  status: "pending",
});

if (approval) {
  await client.resolveApproval(approval.id, "approve"); // or "deny"
}
```

Approval identity includes the agent instance, conversation, run, tool name, and
serialized tool input. Decisions are fail-closed when the channel is unavailable,
the run is cancelled, or the request expires. A custom conversation store that
omits permission methods receives a per-run exact-input overlay; stores that
implement Glove permissions may persist the decision under their own policy.
The inspector shows pending decisions on its overview and on the blocked run, with
the exact payload and direct approve/deny controls.

## Voice hosts

For typed `goals`, `facts`, `forms`, and `contextProviders` fields, see
[Guided conversations](./guidance.md). They mount native runners and providers
and expose typed execution handles; no custom layer is required.

Voice is a host adapter, not a second agent-definition vocabulary. Keep realtime
audio, provider turn detection, interruption, telephony, and device access in the
host. Delegate substantive work to a persisted Foundry instance and conversation
through the native client or `/v1/responses`; the resulting run stays durable and
observable.

Use `glove-voice-s2s` for Gemini Live, OpenAI Realtime, or GPT-Live and `glove-voice` for a
speech-to-text / Glove / text-to-speech pipeline. A realtime host can expose a
delegation tool backed by the typed Foundry client, or mount `RealtimeAgent` against
the assembled Glove in a scoped layer. Stop the voice session in the layer's
cleanup. Keep provider credentials and audio device access in the host adapter.

GPT-Live selects `provider: "openai-live"` in `s2sDrivenModel` or
`createS2SAdapter`. Its Responses backend chooses the exposed Glove tools; this
does not turn a voice session into a durable Foundry run. For durable work, expose
a delegation tool that calls the target instance/conversation through the Foundry
client. The host owns continuous PCM pacing (including silence), timestamped
transcript fragments, playback and avatar utterance boundaries, and awaited
shutdown for final usage. The adapter does not implement Live client delegation
or browser WebRTC. Read the [GPT-Live guide](../../glove-voice-s2s/README.md#gpt-live)
before adapting an existing room example; Realtime VAD and final-turn assumptions
do not apply.

`examples/foundry-braind-storm` demonstrates a voice lead delegating durable work
to Foundry agents. Phone bridges, LiveKit rooms and native audio hosts can use the
same instance/conversation boundary. Messenger-specific voice gateways and codecs
are consumer adapters, not built-in Foundry telephony services.

Core 4 runtime context is transient: goals, forms and pinned memory reach the model
without rewriting system instructions or persisted user turns. Native realtime
agents refresh that context silently at startup and after tool calls. Call
`await realtime.refreshContext()` after externally changing it, and forward
`addContextProvider` and `getRuntimeContext` from any custom runnable wrapper.

### Durable knowledge and documents

Persist conversation history, structured memory and VFS files separately. A durable
Foundry data adapter alone does not make an in-memory Glove store durable. For
single-host Node 22.13+ deployments, `glove-memory/sqlite` provides
`createSqliteMemoryAdapters({ file, namespace, schema })` for entity, episodic,
resource and pinned-context memory. Select namespaces from trusted instance
identity, not incoming tool input. See the [memory persistence guide](../../glove-memory/README.md).

Mount `documents()` from `glove-env-documents` through
`defineWorkingEnvironment({ options: { stdlib: [documents()] }, persistence })`.
It supplies native PDF and DOCX creation, inspection, editing and extraction within
the guarded VFS. Add the optional PDF extraction and rendering dependencies where
needed. Pass documents between agents as authorized durable artifact references;
do not copy entire file bodies into orchestration events. Persist the VFS before
run cleanup. See the [document adapter](../../glove-env-documents/README.md).

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
- Voice and device hosts own audio transport while Foundry owns the durable agent run.
