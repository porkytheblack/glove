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
| **Instance** | data: `FoundryDataAdapter` | One persisted agent: `{ id, definitionId, workspaceId, context, installations, playbooks }`. Created by your app, the API, a seed, or a subscription when an event arrives. |
| **Conversation** | data | A durable thread owned by one instance. An instance can own many. |
| **Run** | a fresh child process | One message processed by a Glove assembled **from scratch** out of the definition, the instance and the message. Instance edits apply on the next message without a deploy. |

Consequences you must design for:

- **Anything held only in memory dies with the run.** `new MemoryStore(...)` as a `store`, in-memory memory adapters, module-level variables and `MemoryFoundryDataAdapter` writes made by tools do not survive to the next message. Persist the four boundaries below.
- **Code identity comes from filenames; runtime identity is data.** Never add an `id` to a file-routed definition and never repeat string ids for code relationships; pass imported values (`install(helpdesk)`). String ids belong to instances, conversations, runs, accounts, routes, bindings and HTTP/database boundaries.
- **Composition makes things available; installation mounts them.** `composeAgent(...)` lists shared tools, apps and MCP servers an instance *may* install. Tools every instance needs go in `defineAgent`'s `tools`.

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
| a chat agent that queues jobs for worker agents and polls for results | Delegates (layered agents) | `delegates: [{ agent: "coder", description }]` → `glove_foundry_delegate` / `glove_foundry_reply`; workers get `glove_foundry_ask`; results come back to the conversation |
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

**Keep `agent.ts` for assembly.** It holds imports and one `defineAgent` call whose fields are values, imported definitions or one-line resolvers. Write the parts beside it: `prompt.ts` (a function that returns the prompt), `tools.ts` (always-on tools), `call.ts` (payload schema + `voiceCall`), `workspace.ts`, `*.memory.ts`; shared choices (the model per layer, the store, workspace persistence) in `lib/`. Agents refer to each other by route (`delegates`), never by importing another `agent.ts`.

Each convention file default-exports one definition. Schedules are **not** auto-discovered: keep `defineSchedule` values in ordinary modules and return them from the agent's `schedules` field. Memory profiles, layers and subscribers are definition surfaces: list them in `components` **and** select them in `memory` / `layers` / `subscribers`.

## defineAgent

Every assembly field is a literal or a resolver `(agent, ctx) => value | Promise<value>`, re-resolved on every run against the instance, conversation and current message. Fields: `description`, `tags`, `components`, `store`, `model`, `systemPrompt`, `displayManager`, `serverMode`, `maxRetries`, `maxConsecutiveErrors`, `compactionLimit`, `compactionInstructions`, `maxTurns`, `enableToolResultSummary`, `tools`, `hooks`, `skills`, `subagents`, `memory`, `goals`, `facts`, `forms`, `contextProviders`, `inboxes` (always a function), `subscribers`, `layers`, `calls`, `schedules`, `playbooks`, `mesh`, `workingEnvironment`, `repl`, `configure(agent, ctx)`, `build(agent, ctx)`, `spawn(agent, ctx, message)`, `run(agent, ctx)`, `delegates`, `answerWaitMs`, `mcpAdapter`, `accountSessions`.

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

## Layered agents and voice

Split an assistant by how fast each part must reply, what context it keeps and how long it runs. The **interactor** (fast model, personal memory, the person's chat or call) lists sibling **workers** in `delegates`; workers get their own tools (sandbox, browser, APIs) and no memory of the person. `glove_foundry_delegate({ to, task })` returns at once; the worker's final reply comes back to the delegating conversation as a `<delegation status="completed">` message, into a listening run or as a new run once the conversation is free. A worker asks with `glove_foundry_ask` (waits `answerWaitMs`, default 90 s, in-run, then suspends); the interactor answers with `glove_foundry_reply`, from memory or after asking the person. For calls, `run: voiceCall(...)` speaks delegation updates at the next pause and keeps approval-gated tools off the line. Details: [references/building.md](references/building.md#layered-agents-and-voice); runnable: `examples/foundry-layered-assistant`.

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
