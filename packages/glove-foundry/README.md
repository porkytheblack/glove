# Glove Foundry

Glove Foundry is an Effect-native application framework for typed, observable Glove agents. It gives agent projects the conventions that Next.js gives web projects: file routes, colocated composition, a development server, generated types, durable runtime data, and a stable client/API.

**[Read the Foundry handbook](https://glove.dterminal.net/foundry/docs)** for the guided architecture, installation, composition, applications, automation, workspaces, multi-agent, observability, and deployment documentation.

The development server includes a hierarchical inspector for definitions, instances, runs, automations, integrations, and shared workspaces. See the [inspector guide](./docs/inspector.md).

## Your first agent application

Dependency installation is selected by default in the setup wizard. Foundry runs
your chosen package manager's `install` command in the generated project and waits
for it to finish before showing next steps. In non-interactive commands, add
`--install` to install automatically; use `--no-install` to defer it explicitly.

Use Node.js 22.13+ (recommended, including SQLite memory support); the CLI requires
at least Node 20.12. Run this in a terminal:

```bash
npx glove-foundry init
```

The Clack-powered setup guides you through a project directory, standalone or
Next.js integration, a starter, and your package manager. Review the plan before
any files are created. Arrow keys move, Enter selects, and Ctrl+C cancels. It never
asks for API keys. Installing dependencies is an explicit choice.

Choose **Guided example** for a first look: its travel concierge works without a
provider key. Choose **Minimal agent** when you want one agent and one tool and are
ready to configure OpenRouter. These are development starters, not durable storage
or preconfigured Telegram/Discord deployments.

For a repeatable, non-interactive setup:

```bash
npx glove-foundry init my-agent-app --template travel-concierge --package-manager pnpm --yes
cd my-agent-app
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4141`, choose **Start a run**, select the concierge, and ask
“Find a flight to Nairobi.” Open that run to follow its model and tool events. Edit
`agents/concierge/agent.ts` to change behavior; the development server reloads it.
Run `pnpm typecheck` and `pnpm lint` after changes.

For live model responses, copy `.env.example` to `.env.local`, set
`OPENROUTER_API_KEY`, and restart `pnpm dev`. Keep that file out of version control.
The guided example stays in deterministic demo mode until a key is configured.

### Initializer options

| Option | Meaning |
| --- | --- |
| `--template travel-concierge\|minimal` | Choose a worked example or small starting point |
| `--target standalone\|nextjs` | Create a project or add agents to an existing app; Next.js is detected |
| `--package-manager pnpm\|npm\|yarn\|bun` | Choose install commands; existing lockfiles are detected |
| `--yes` or `--no-interactive` | Accept defaults without prompts; does not install unless `--install` is supplied |
| `--interactive` | Require a terminal; useful when accidental piping should fail |
| `--install` or `--no-install` | Install dependencies now, or print the command for later |
| `--help` | Show create and runtime command help |

Piped commands never wait for a prompt. Existing standalone directories must be
empty; Next.js integration preserves existing app files and refuses collisions.
If installation fails, your generated project remains available with retry steps.

### Before deploying

Persist **three separate things**: Foundry instance/activation data, Glove
conversation history, and structured memory/VFS state. The demo's in-memory
adapters intentionally reset and must not be mistaken for production persistence.
Use `FileFoundryDataAdapter` for single-host runtime data, a durable conversation
store, and `glove-memory/sqlite` or your own native memory adapters. Add VFS
persistence when agents work on documents. Multi-host deployments need shared,
transactional adapters. See [Building with Foundry](./docs/building-with-foundry.md).

**Troubleshooting:** check `node --version` for engine errors, add a provider key
for the minimal starter, choose another `--port` if 4141 is occupied, and inspect a
failed run's events for provider failures. With npm, use `npm run dev` instead of
`pnpm dev`; generated README commands follow your selected package manager.

Inside an installed project, the framework binary also supports `glove foundry dev`
and `glove foundry start`.

Foundry binds to loopback by default. A non-loopback host fails closed unless the
application supplies `requestAuthorization`, an Effect-native adapter that returns
only an authorization decision. It may validate bearer/basic credentials, cookies,
or an identity from a trusted proxy; Foundry never stores or observes the credential.
The typed client accepts a matching per-request `authorization` adapter. Terminate
TLS and apply rate/network policy at the deployment boundary.

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

Applications are headless, installable capability definitions. They may own multiple inbound and outbound transmissions. Outbound transmissions become tools only when the application is installed on an instance. Calling one of those tools awaits and returns the outbound adapter's schema-validated result; grants, credentials, and adapter execution remain in the parent runtime. Set `outbound.requiresPermission` to a boolean or payload predicate for exact-input approval. `outbound.project` can remove presentation-only material from model-visible data, while `outbound.render` retains a UI-only projection in tool history—for example, a browser screenshot can render without copying its base64 bytes into model context. Framework-authored fire-and-forget transmissions keep their asynchronous command semantics.

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
      awaitCompletion: true,
      raw: event,
    }))
  }),
})
```

Foundry supervises connection lifetime and retry, but never acquires or refreshes credentials. Account references contain only metadata and an opaque `accessRef`. Your `accountSessions` or provider adapter owns credential material and refresh.

`receive()` resolves after durable dispatch by default. A stateful consumer that
awaits each event in order can set `awaitCompletion: true`; its Effect then remains
open until every matching run is terminal, preventing successive chat turns from
racing one transcript. Leave it unset for dispatch-oriented streams or manage a
per-conversation queue in a transport that needs unrelated threads to proceed in
parallel.

Connections are desired only when:

- an instance has installed the application and has a matching inbound playbook; or
- an enabled playbook subscription targets the application installation.

This covers webhook/socket ingestion and long-lived provider bots without exposing the execution backend as a framework primitive.

MCP entries can resolve lazily from typed installation data in the same way. The instance owns the selected URL, metadata, and tool exclusions; the agent-owned `mcpAdapter` receives the decoded selections and resolves fresh auth headers only when `glove-mcp` connects.

```ts
const projectMcp = defineMcp({
  description: "Instance-selected project MCP",
  config: z.object({
    serverUrl: z.string().url(),
    tokenEnvironment: z.string(),
  }),
  entry: ({ config }) => ({
    name: "Project tools",
    description: "Project-specific capabilities",
    url: config.serverUrl,
  }),
})

export default defineAgent({
  // ...
  mcpAdapter: ({ resolved, conversationId }) =>
    Effect.succeed(mcpAdapterFor(conversationId, resolved)),
})
```

Credential acquisition and refresh still belong to `mcpAdapterFor`; persisted installation config should contain only a reference such as an environment-variable or vault-record name.

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

One agent instance can own many conversations. Messages use native Glove content parts,
and media parts may retain an optional human-facing filename. The server keeps JSON at
a conservative 1 MB by default; a trusted multimodal deployment can set the typed
`server.messageBodyBytes` bound for larger base64 messages. Foundry also provides
adapter-backed workspace entries, shared inbox items, tasks, and scoped environment
values. These are data primitives, not prompt conventions, so agents can pass documents
and work records by reference instead of copying context.

The built-in **Chat** page is a durable WebChat surface over those same primitives.
It lists conversations per runtime instance, reloads exact native Glove history from
the configured `store`/`conversationStore`, accepts text and file content parts, and
supports cancel plus interrupt-and-restart steering. The typed client exposes the
same read boundary:

```ts
const transcript = await foundry.conversationTranscript(agent.id, conversation.id, {
  limit: 100,
})
```

`transcript.persisted` is `false` when the agent has no configured conversation
store. Foundry does not fabricate history from retained runs or UI state.

## Least-privilege subagents

Subagents may declare fixed tools or project an invocation-time subset from the
fully assembled parent. That lets a delegate inherit an installed application or
MCP read operation without receiving the parent's write/admin surface. The
projection is resolved only when the subagent is called, after instance
installations and message-dependent assembly have completed.

```ts
defineSubagent({
  name: "researcher",
  description: "Research one bounded question",
  systemPrompt: "Return evidence, uncertainty, and a concise conclusion.",
  tools: ({ parent }) => projectTools(parent, [
    webSearchToolName,
    webReadToolName,
    "workspace_read_file",
  ]),
})
```

The child keeps its isolated store, compaction policy, model, prompt, skills,
layers, and subscribers. Parent subscribers still receive the subagent lifecycle
bracket, so delegation remains visible in the same run trace.

## Programmatic tool workflows

`defineRepl` can expose an explicit projection of the fully assembled agent as
sandbox functions. This lets an agent use one Python, JavaScript, or Lisp program
to read, filter, loop, branch, and invoke several approved capabilities while
only the final value enters its conversation context:

```ts
defineRepl({
  language: "python",
  session: PySession.create({ actor: agentId }),
  mount: { frame: "workflow", discovery: "auto" },
  programmaticTools: {
    maxCalls: 50,
    select: ({ tools }) => tools
      .filter((tool) => tool.name.startsWith("workspace_"))
      .map((tool) => ({ tool, server: "workspace" })),
  },
})
```

Selection happens after dynamic installations and `configure`; returned entries
carry direct live tool references rather than parallel ids. The surface is empty
unless the definition opts in. Foundry revalidates Zod inputs, propagates aborts,
records safe per-call events, and refuses permission-gated calls inside the
program so an interactive approval cannot be bypassed.

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
GET  /api/conversations/:id/messages?agent=:agentId
POST /api/conversations/:id/messages
PATCH /api/conversations/:id
GET  /api/playbook-subscriptions
PUT  /api/playbook-subscriptions
GET  /api/application-connections
POST /api/transmissions/:routeId/fire
GET  /api/runs
GET  /api/events
GET  /v1/models
POST /v1/chat/completions
```

The `/v1/chat/completions` endpoint accepts an agent instance id as `model`, supports SSE streaming, and returns `x-foundry-conversation-id`. Reuse `user`, `conversation_id`, or that header to continue the same durable Foundry conversation from an OpenAI-compatible client.

See [Building with Foundry](./docs/building-with-foundry.md), [Architecture](./docs/architecture.md), the compact [`examples/foundry-agent`](../../examples/foundry-agent), and the [Braind Storm workforce](../../examples/foundry-braind-storm).
