---
name: glove-foundry
description: Build agent systems with Glove Foundry instead of hand-rolling the infrastructure around agents — persisted agent instances per user or tenant, conversations, installable tools/apps/MCP, schedules, sleep and spawn, inbound channels (Slack, email, tickets, webhooks) with transmissions and playbooks, approvals and steering, a typed client, REST and OpenAI-compatible APIs, working environments, multi-agent composition and the inspector. Use when a project has foundry.config.ts, foundry.application.ts or agents/**/agent.ts, imports glove-foundry, or needs many agents, background work, inbound events or an agent API. Pair with the glove skill for harness primitives and the kuiper skill to deploy.
---

# Glove Foundry

Glove gives you the primitives of one **harness** (loop, tools, context, state, workspace, surface, team). Foundry turns harnesses into a running **system**: many agents from one definition, acting on their own time, woken by the outside world, overseen by people and callable by other software. Kuiper then runs that system in **production** (see the `kuiper` skill).

Every agent Foundry runs is still a normal glove-core agent: tools, memory, MCP, REPLs, voice and every other Glove package mount the same way inside Foundry as outside it (see the `glove` skill).

Docs: https://glove.dterminal.net/foundry/docs · Tutorial: https://glove.dterminal.net/foundry/docs/tutorial · Condensed reference: https://glove.dterminal.net/foundry/llms-full.txt · Canonical example: https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent

## The mental model

| | Lives in | What it is |
| --- | --- | --- |
| **Definition** | code: `agents/<route>/agent.ts` | What an agent of this kind *can* assemble: model, prompt, tools, catalogue, memory, schedules. The file path is the id. |
| **Instance** | data: `FoundryDataAdapter` | One persisted agent: `{ id, definitionId, workspaceId, name?, description?, context, installations, playbooks }`. Created by your app, the API, a seed, or a subscription when an event arrives. |
| **Conversation** | data | A durable thread owned by one instance. An instance can own many. |
| **Run** | a fresh child process | One message processed by a Glove assembled **from scratch** out of the definition, the instance and the message. Instance edits apply on the next message without a deploy. |

Consequences you must design for:

- **Anything held only in memory dies with the run.** `new MemoryStore(...)` as a `store`, in-memory memory adapters, module-level variables and `MemoryFoundryDataAdapter` writes made by tools do not survive to the next message. Persist the four boundaries below.
- **Code identity comes from filenames; runtime identity is data.** Never add an `id` to a file-routed definition and never repeat string ids for code relationships; pass imported values (`install(helpdesk)`). String ids belong to instances, conversations, runs, accounts, routes, bindings and HTTP/database boundaries.
- **Composition makes things available; installation mounts them.** `composeAgent(...)` lists shared tools, apps and MCP servers an instance *may* install. Tools every instance needs go in `defineAgent`'s `tools`.

## Agents are data

A definition is not an agent. It is everything a kind of agent *can* be, like a server-rendered page that renders whatever props it gets. The agents are instances, and who each one is lives in data: `name`, `description`, `context`, `installations` and `workspaceId`. Adding an agent, renaming it or giving it an app is a write, never a deploy.

- **Never one definition per agent.** `agents/sales-outbound/` next to `agents/inbox-manager/` means nobody can make a new one without a deploy. Write one `bot` definition; each bot is an instance.
- **Never put names, jobs or per-user settings in code** (a prompt that says "You are Sales Outbound", a constant, an env var per customer). Put them on the instance and read them in resolvers.
- **Branch on instance data, not ids**: `ctx.agentInstance.context.routines`, never `ctx.agentId === "maya-inbox"`.
- **Seed known agents with `defineAgentInstance`; create the rest at runtime.** Describe a person's agents as plain data in `lib/`. Seed a demo or fixed account with `defineAgentInstance(importedDefinition, data)` in the data adapter (`agents: [...]`, `conversations: [createConversation(instance, …)]`; written only when the id is missing). Create everyone else with `createAgent(route, data)` when they sign up: the route string belongs at the HTTP boundary, an import everywhere else.
- **Agents can change their own data with a tool.** A `take_job` tool writes `name` and `description` with `ctx.data.putAgent(...)`; your app does the same with `configureAgent(id, { name })`.
- **A workspace is a tenant** (a person, a team, a company). Agents in one are mesh peers and share workspace entries. A conversation carries data too (`conversation.context`, such as the members of a group chat).
- **Split definitions only by what an agent can do or must load**: a voice front with its own `run`, a worker that loads a sandbox SDK, a read-only agent whose tools must never mix with acting ones. Even then, every agent of that kind is an instance.

Docs: https://glove.dterminal.net/foundry/docs/agents-are-data

## The five parts Foundry adds

| Part | Question | Foundry's answer |
| --- | --- | --- |
| **Identity** | Whose agent is this? | One definition in code, many instances in data, each with its own conversations, context, installed capabilities and workspace. |
| **Time** | When does it act? | Schedules, sleep, spawn and background work are built-in agent tools backed by durable activations. |
| **Arrival** | What wakes it up? | Transmissions turn Slack, email, tickets or webhooks into typed events; playbooks route them; subscriptions create the instance if none exists. |
| **Oversight** | Who keeps it in check? | Permission-gated tools become expiring approval records, running work can be steered, the inspector shows every run, model call and tool call. |
| **Access** | How does other software call it? | A typed client, REST, an async run API and OpenAI-compatible endpoints, all writing into durable conversations. |

## Before you build it, use this

| If you're about to write… | Use | API |
| --- | --- | --- |
| a factory that rebuilds the agent per request from a switch over tenants | Definitions with resolvers | `export default defineAgent({ model: () => …, systemPrompt: (_agent, ctx) => …, tools: (_agent, ctx) => … })` |
| a definition per agent, or an agent's name in its prompt | Instances as data | `createAgent(route, { workspaceId, name, description, context, installations })` · `configureAgent(id, { name })` |
| an agents-per-customer table and lookup | Instances | `client.agent(route).create({ workspaceId, context })` · `defineAgentInstance(definition, { … })` |
| thread tables and message routing | Conversations | `client.createConversation(agentId)` · `client.send(agentId, conversationId, text)` · `client.conversationTranscript(…)` |
| per-customer feature flags around tool lists | Installable capabilities | `defineSharedTool` · `defineApp` · `defineMcp` + `install(definition, config)` / `client.install` / `PUT /api/installations` |
| coordination tables between agents | Shared work | `glove_foundry_workspace` · `glove_foundry_tasks` · `glove_foundry_shared_inbox` · `glove_foundry_environment`; `compareAndSetWorkspaceEntry` for optimistic writes |
| serialising runtime state yourself | Data adapters | `new FileFoundryDataAdapter({ file })` (one host) · a transactional `FoundryDataAdapter` (many hosts) |
| cron jobs and a job queue that call your agent | Schedules | `defineSchedule({ name, timing: { kind: "cron", expression, timezone? }, message })` returned from `schedules`; agents use `glove_foundry_schedule` |
| "check back later" state and a timer | Sleep | `glove_foundry_sleep({ kind: "for", duration: "20m", message })` — never `setTimeout` |
| fire-and-forget promises that die with the request | Spawn and background | `glove_foundry_spawn` · `glove_foundry_background` |
| a reminders CRUD API for the agent | Schedule management | `glove_foundry_schedules({ action: "list" \| "update" \| "pause" \| "resume" \| "cancel" })` |
| a webhook handler and an API client per channel | Transmissions | `defineTransmission({ account, inbound, outbound })` (Effect Schema types) |
| polling loops and socket clients you keep alive | Applications and connections | `defineApp({ inbound, outbound, connections })` · `defineConnection(…)` |
| an MCP client per user with their token, all its tools in context | Apps backed by MCP | `defineApp({ mcp: { entry, auth: (session) => headers, tools: (tool) => "allow" \| "ask" \| "hide" } })` installed with `accountId`; reads as functions with `defineRepl({ programmaticTools: { select: ({ apps }) => …, keepDirect: false } })` |
| an accounts table Foundry should read, and routes that vanish on restart | Your account store | `defineApplication({ services: Layer.mergeAll(Layer.succeed(AccountDirectory, …), fileTopologyStore(file), memoryEventStore) })` |
| a dispatcher deciding which agent handles which event | Playbooks | `composePlaybook({ transmission, match, directives })` returned from `playbooks` |
| onboarding code that creates an agent before its first message | Subscriptions | `client.putPlaybookSubscription(…)` / `PUT /api/playbook-subscriptions` (singleton, per-thread, per-event, existing, custom provisioning) |
| waking an LLM agent to read every event | Inbound triage | `classifyInbound(…)` · `classifierPredicate(…)` from `glove-classifier/foundry` |
| an approvals table and a pause/resume flow | Approvals | `requiresPermission` on a tool or outbound transmission → `client.approvals({ status: "pending" })` + `client.resolveApproval(id, "approve" \| "deny")` |
| cancel-and-resend logic that races the old run | Steering | `handle.steer(message)` · `POST /v1/runs/:id/steer` |
| an admin dashboard and a debug chat | Inspector and WebChat | `glove foundry dev` → http://127.0.0.1:4141 |
| log scraping to reconstruct what an agent did | Event stream | `GET /api/events` (SSE) · `defineSubscriber(…)` · `ctx.emit({ type, data })` |
| a hand-written HTTP client for your agent service | Typed client | `createFoundryClient<FoundryRoutes>({ baseUrl })` from `glove-foundry/client` |
| an adapter so chat UIs can reach your agent | OpenAI-compatible API | `POST /v1/chat/completions` · `POST /v1/responses` (`model` = instance id) |
| a job-status API around your agent | Run API and REST | `POST /v1/runs` · `GET /v1/runs/:id/events` · `/api/*` |
| auth middleware in front of every route | Request authorization | `defineApplication({ requestAuthorization: { identifier, challenge, authorize } })` |
| a chat agent that queues jobs for worker agents and polls for results | Glove Mesh, hosted by Foundry | `mesh: true` (or `{ peers, waitMs, mount }`) → `glove_mesh_list_agents` / `glove_mesh_send_message({ to: instanceId, content })`; the recipient's final reply comes back to the conversation as a `<mesh-message status="replied">` |
| a WebSocket call server around `RealtimeAgent` | Voice calls | `run: voiceCall({ room: (ctx) => webSocketRoom({ port, token }), greeting })` from `glove-foundry/voice`, `model: s2sDrivenModel(…)` |
| typed agent-to-agent calls, a subagent router | Calls and subagents | `defineCall({ name, input, output, handler })` · `defineSubagent(…)` |
| a sandbox runner, file store or REPL wiring | Working environment, REPL | `workingEnvironment: defineWorkingEnvironment({ options, persistence })` · `repl: defineRepl({ language, session, programmaticTools })` |
| goal/form/fact plumbing per conversation | Guidance fields | lazy `goals`, `facts`, `forms`, `contextProviders` fields (`defineGoals`, `defineFacts`, `defineForms`) |

## Project layout

```text
agents/<route>/agent.ts                 defineAgent (route id = folder path; nested folders nest ids)
agents/<route>/composition.ts           composeAgent(...) catalogue
agents/<route>/tools/*.tool.ts          defineSharedTool
agents/<route>/apps/*.app.ts            defineApp
agents/<route>/transmissions/*.transmission.ts   defineTransmission
agents/<route>/events/*.event.ts        defineTransmissionEvent
agents/<route>/predicates/*.predicate.ts         defineTransmissionPredicate
agents/<route>/actions/*.action.ts      definePlaybookAction
agents/<route>/connections/*.connection.ts       defineConnection
agents/<route>/mcp/*.mcp.ts             defineMcp
agents/<route>/memory/*.memory.ts       defineMemory
agents/<route>/layers/*.layer.ts        defineLayer
agents/<route>/subscribers/*.subscriber.ts       defineSubscriber
foundry.application.ts                  defineApplication: data adapter, conversation store, accounts, routes, bindings, auth, daemon
foundry.config.ts                       defineConfig (from glove-foundry/config): server, execution, observability
.foundry/routes.d.ts                    generated FoundryRoutes type — never edit
```

**Keep `agent.ts` for assembly.** It holds imports and one `defineAgent` call whose fields are values, imported definitions or one-line resolvers. Write the parts beside it: `prompt.ts` (a function that returns the prompt), `tools.ts` (always-on tools), `call.ts` (payload schema + `voiceCall`), `workspace.ts`, `*.memory.ts`; shared choices (the model per layer, the store, workspace persistence) in `lib/`. Agents reach each other by instance id over the mesh, never by importing another `agent.ts`.

Each convention file default-exports one definition. Schedules are **not** auto-discovered: keep `defineSchedule` values in ordinary modules and return them from the agent's `schedules` field. Memory profiles, layers and subscribers are definition surfaces: list them in `components` **and** select them in `memory` / `layers` / `subscribers`.

## defineAgent

Every assembly field is a literal or a resolver `(agent, ctx) => value | Promise<value>`, re-resolved on every run against the instance, conversation and current message. Fields: `description`, `tags`, `components`, `store`, `model`, `systemPrompt`, `displayManager`, `serverMode`, `maxRetries`, `maxConsecutiveErrors`, `compactionLimit`, `compactionInstructions`, `maxTurns`, `enableToolResultSummary`, `tools`, `hooks`, `skills`, `subagents`, `memory`, `goals`, `facts`, `forms`, `contextProviders`, `inboxes` (always a function), `subscribers`, `layers`, `calls`, `schedules`, `playbooks`, `mesh`, `workingEnvironment`, `repl`, `configure(agent, ctx)`, `build(agent, ctx)`, `spawn(agent, ctx, message)`, `run(agent, ctx)`, `mcpAdapter`, `accountSessions`.

```ts
import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // durable transcripts; the starter templates ship one

export default defineAgent({
  description: "Answers questions about orders",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini" }),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: (_agent, ctx) => `You are support for ${ctx.agentInstance.context.company}.`,
  tools: [{
    name: "lookup_order",
    description: "Find an order by id",
    inputSchema: z.object({ orderId: z.string() }),
    async do({ orderId }) { return { status: "success", data: { orderId, state: "shipped" } }; },
  }],
});
```

A definition never declares request input/output (Foundry owns them) and is never an instance. `configure(agent, ctx)` is where you call capability mounts (`mountBrowser`, `mountMcp`, …) and register `ctx.onCleanup` immediately after acquiring a resource. A custom `run` should end in `ctx.defaultRun()` unless it truly replaces the loop.

## Persistence: four separate boundaries

1. **Runtime data** (instances, conversations, activations, workspace, VFS snapshots): `FileFoundryDataAdapter({ file })` for one host; a transactional adapter for several.
2. **Transcripts**: the agent `store` / application `conversationStore`. A plain `MemoryStore` starts empty on every run.
3. **Structured memory**: glove-memory adapters, e.g. `createSqliteMemoryAdapters({ file, namespace, schema })` from `glove-memory/sqlite` (Node 22.13+), scoped by trusted instance identity.
4. **Working-environment files**: `foundryDataEnvironmentPersistence({ scope })` or a persistent `Vfs`.

Persisting one does not persist the others. Run **one runtime per data store** (every runtime arms the schedules it finds). Runs, events and pending approvals live in the Foundry process and are lost on restart; activations are rebuilt from the data adapter.

## Calling and operating

```ts
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "./.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: process.env.FOUNDRY_URL! });
const agent = await foundry.agent("support").create({ workspaceId: "acme", context: { company: "Acme" } });
const conversation = await foundry.createConversation(agent.id);
const run = await foundry.send(agent.id, conversation.id, "Where is order 1042?");
const done = await run.wait({ timeoutMs: 120_000 }); // also run.cancel(), run.steer(text), run.events()
```

- **OpenAI SDKs**: `model` is an instance id (or a route with exactly one instance); instances are never created implicitly. Reuse `user`, `conversation_id` or the returned `x-foundry-conversation-id` header to continue a conversation.
- **Approvals** expire after 5 minutes and fail closed; they do not engage if `defineAgent` supplies its own `displayManager`.
- **Steering** is interrupt-and-restart in the same conversation; it never injects text mid side effect.
- **Health**: `GET /health` and `/health/detailed` answer 200 when `ok` is true, 503 with the same body otherwise.
- **Security**: Foundry binds loopback by default and refuses a public interface without `requestAuthorization`. Foundry never acquires, stores or refreshes credentials; accounts carry an opaque `accessRef` your adapter resolves.

## Agents talking to agents: the mesh

`mesh: true` (or `{ peers, waitMs, mount }`) puts an agent on Glove Mesh, hosted by Foundry. It gets `glove_mesh_list_agents`, `glove_mesh_send_message`, `glove_mesh_broadcast` and `glove_mesh_acknowledge` (the same names and inputs as glove-mesh) and addresses other agents by **instance id**. Its peers are the other instances in its workspace that pass `peers(self, peer)`; their names and descriptions come from the instances. An agent can always answer whoever messaged it.

A new message starts a **thread**, a conversation on the recipient. The recipient's final non-empty reply goes back on its own as a `<mesh-message status="replied">` message: into a run that is listening (a call), or as one new run (`request.source.kind === "mesh"`) once the conversation is free. A failed or cancelled run sends `status="failed"`. The recipient can ask back with `glove_mesh_send_message` to the sender, who answers with `in_reply_to`. `blocking: true` waits up to `waitMs` (default 90 s) in the same run; after that the run suspends (`suspension.kind === "mesh"`) and the reply arrives as the next run. `mount(ctx)` decides per run whether the tools are mounted at all, such as none on scheduled research. `runtime.listThreads({ agentId?, conversationId?, to?, status? })` lists threads.

**Layered agents.** Split an assistant by how fast each part must reply, what context it keeps and how long it runs. The **interactor** (fast model, personal memory, the person's chat or call) and its **workers** (their own tools, sandbox or browser, no memory of the person) are instances in the person's workspace and reach each other over the mesh. For calls, `run: voiceCall(...)` speaks mesh messages at the next pause and keeps approval-gated tools off the line. Details: [references/building.md](references/building.md#layered-agents-and-voice); runnable: `examples/foundry-layered-assistant`.

## Whole products to copy from

Four always-on products rebuilt from these primitives, each runnable offline with `pnpm verify` and deployable on Kuiper:

- `examples/foundry-bot-crew` (like Grok Bot): one `bot` definition. Every bot is an instance in its owner's workspace, and its name, job and apps are data; a new bot names itself with a `take_job` tool. The bots are siblings, with no bot routing for the others: each runs when its person writes to it, when it is @-mentioned in a group chat, when a sibling hands it work over the mesh, or when its routine fires. A routine on a schedule is the bot's own `glove_foundry_schedule`; after an event, `add_routine` writes `context.routines` and the playbook is built from it. A group chat has no host: a conversation per member, and `postToGroup` sends to the bots a message mentions. Gmail and Linear are Foundry apps installed with the person's accounts (`connect_app` asks, `connectApp` gives the account to every bot): MCP reads in code, Gmail's send as an approved outbound transmission, new mail through a `gmail-watch` connection to every bot whose routine asks. Also: one computer per workspace (`foundryDataEnvironmentPersistence({ scope: "workspace" })`), skills in workspace entries, approvals. Maya's first bot is seeded with `defineAgentInstance`.
- `examples/foundry-proactive-partner` (like Claude Duet): one partner instance and one conversation per person, connected Gmail and Calendar apps read in one program, new mail into the thread, Gmail's send wrapped by a guard in `configure`, cron schedules built from the person's preferences in their time zone, a notify tool used only when needed, approval-gated actions with the function form of `requiresPermission`, a guard on outbound text, its own computer reached over the mesh, `voiceCall`.
- `examples/foundry-standing-agents` (like OpenAI's dots): one `dot` definition, working from a connected Gmail app whose send goes through the dot's auto-review; each person's dot is an instance they name, with their ongoing responsibilities and Custom Rules (allow, ask, block) in context, and a specialist dot is the same definition in an organisation's workspace with its own account. Runs it starts itself get read-only tools, no computer and no mesh (resolvers plus `mesh.mount`); an auto-review wrapper gates every action, with built-in safety always the person's; it has its own computer; one conversation per channel (app, Slack, a call) shares memory; coding jobs go to the person's builder over the mesh.
- `examples/foundry-personal-agent` (like Meta's Muse): one Muse per person, in the app and on WhatsApp (a Foundry app with a transmission each way, one shared inbound route, a route per person that fixes the recipient), sharing memory. Connected apps at the access the person picks (installation `config.access`: read hides writes and turns off the send binding). Its own browser on Kuiper (`kuiperBrowser` from `glove-execution/kuiper`, session and profile IDs on the instance, reconnected each run) behind a Sentinel as the browser's `guard` (rules in code, then its own `llmClassifier` model; it never sees Muse's conversation), sign-ins the person does in Kuiper's live view (`browser.handOff`, delivered by host code), `buy` with a one-time card typed into the checkout by host code, a subscriber-written log, `glove_context_unset` to forget.

All four connect apps the same way; copy `lib/accounts.ts`, `lib/connect.ts`, `lib/oauth.ts` and `agents/*/apps/` from any of them.

## Built-in agent tools (on every Foundry agent)

`glove_foundry_spawn`, `glove_foundry_schedule`, `glove_foundry_schedules`, `glove_foundry_sleep`, `glove_foundry_background`, `glove_foundry_transmit`, `glove_foundry_conversations`, `glove_foundry_workspace`, `glove_foundry_shared_inbox`, `glove_foundry_tasks`, `glove_foundry_environment`. Inputs are in [references/condensed-reference.md](references/condensed-reference.md#8-built-in-agent-tools-mounted-on-every-foundry-agent).

## Create, run and check a project

```bash
npx glove-foundry init my-agents          # wizard; --template travel-concierge|minimal, --target standalone|nextjs
cd my-agents && pnpm dev                    # runtime + inspector on http://127.0.0.1:4141
pnpm typecheck && pnpm lint                 # generated scripts: tsc --noEmit, eslint with the glove-foundry preset
```

Node 22+ (22.13+ for SQLite memory). In an existing Next.js app `init .` adds `foundry/`, `lib/foundry.ts` and `foundry:dev` / `foundry:start` scripts; the runtime stays a separate process reached over HTTP.

## Deploy

Kuiper deploys a Foundry folder with no Dockerfile (`glove foundry start --host 0.0.0.0 --port 4141`, a `/data` disk, one replica), wires secrets and the model gateway through variables, and reads runs into its dashboard. Before deploying: add `requestAuthorization`, persist all four boundaries under `/data`, and read the `kuiper` skill. Guide: https://glove.dterminal.net/foundry/docs/kuiper · elsewhere: https://glove.dterminal.net/foundry/docs/deploy

## Reference files

| File | Read when |
| --- | --- |
| [references/condensed-reference.md](references/condensed-reference.md) | Exact fields, endpoints, CLI flags, built-in tool inputs, the durable `FileStore`, application/config keys |
| [references/building.md](references/building.md) | Authoring rules for definitions, applications, transmissions, credentials, playbooks, schedules, managed execution, working environments, guidance, layered agents and voice calls, multi-agent systems |
| [references/contributing.md](references/contributing.md) | Only when changing the glove-foundry package, its inspector or its examples |
