import { foundrySections } from "./foundry-nav";

const SITE_URL = "https://glove.dterminal.net";

export function buildFoundryLlmsTxt(): string {
  const lines = [
    "# Glove Foundry",
    "",
    "> Glove Foundry (glove-foundry) is the application framework that runs Glove agents as a service. Agents are TypeScript files (agents/<route>/agent.ts); Foundry adds persisted agent instances and conversations, a run queue, a typed client, a REST API, OpenAI-compatible /v1/chat/completions and /v1/responses, schedules, sleep and spawn, inbound/outbound integrations with playbooks, tool approvals, run steering, working environments, and a built-in inspector and WebChat.",
    "",
    "Key facts:",
    "- Install: npx glove-foundry init my-agents; run: pnpm dev (http://127.0.0.1:4141). Node 22+; 22.13+ for SQLite memory.",
    "- composeAgent(...) only makes shared tools, apps and MCP servers available; an instance must install() them. Always-on tools go in defineAgent's tools field.",
    "- Agents are data. A definition (defineAgent) is everything a kind of agent can be, like a server-rendered page; each agent is an instance whose name, description, context, installations and workspaceId are data. Never write one definition per agent or put a name, job or per-user setting in code: a new agent is createAgent, a rename is configureAgent or a tool that writes the instance, and neither needs a deploy. Branch on instance data (context.routines, context.kind), not on ids. Split definitions only by what an agent can do or must load. Seed known agents with defineAgentInstance(importedDefinition, data) in the data adapter; create the rest with createAgent(route, data) at runtime.",
    "- Instances are data (FoundryDataAdapter); every run reloads the instance and conversation and re-resolves the definition against the new message.",
    "- Each run executes in a fresh child process: a plain MemoryStore and other in-memory state reset on every message. Persist four things separately: runtime data, transcripts (store), memory, and working-environment files.",
    "- Install capabilities with install() at creation, client.install, or PUT /api/installations; the inspector only displays installations.",
    "- Foundry never acquires, stores or refreshes credentials; accounts carry an opaque accessRef resolved by your adapter.",
    "- A non-loopback bind requires a requestAuthorization adapter.",
    "- Agents talk over the mesh Foundry hosts: mesh: true (or { peers, waitMs, mount }) on defineAgent mounts glove_mesh_list_agents, glove_mesh_send_message, glove_mesh_broadcast and glove_mesh_acknowledge. Agents are addressed by instance id; peers are the other instances in the same workspace. A new message starts a thread (a conversation on the recipient); its final reply comes back to the sender's conversation on its own.",
    "- Voice: run: voiceCall({ room, greeting }) from glove-foundry/voice, with model: s2sDrivenModel(...). Mesh replies and questions are spoken at the next pause; approval-gated and bookkeeping tools are kept off the call.",
    "- Keep agent.ts for assembly: prompts, tools, memory, workspaces and model choices live in modules beside it; agents reach each other by instance id over the mesh, never by importing another agent.ts.",
    "",
    `- Product page: ${SITE_URL}/foundry`,
    `- Complete condensed reference: ${SITE_URL}/foundry/llms-full.txt`,
    `- Glove (core and packages) index: ${SITE_URL}/llms.txt`,
    "- Source: https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry",
    "- Canonical example: https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent",
    "- Layered assistant example (interactor + workers + voice): https://github.com/porkytheblack/glove/tree/main/examples/foundry-layered-assistant",
    "- Rebuilds of always-on agent products, each a runnable example with an illustrated build: Grok Bot (examples/foundry-bot-crew), Claude Duet (examples/foundry-proactive-partner), OpenAI Dots (examples/foundry-standing-agents).",
    "- Agent skill: https://github.com/porkytheblack/glove/blob/main/.claude/skills/glove-foundry/SKILL.md",
    "",
  ];
  for (const section of foundrySections) {
    lines.push(`## ${section.title}`, "");
    for (const item of section.items) {
      lines.push(`- [${item.label}](${SITE_URL}${item.href}): ${item.summary}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const FOUNDRY_BASE_REFERENCE = `# Glove Foundry — condensed reference

Glove Foundry (npm: glove-foundry) is the application framework that runs Glove
agents as a service. You write each agent as a TypeScript file; Foundry provides
persisted agent instances, conversations, a run queue on a managed execution
daemon, a typed client, a REST API, OpenAI-compatible endpoints, schedules,
inbound/outbound integrations, approvals, steering, working environments and a
built-in inspector + WebChat. Every agent is still a normal glove-core agent.

Docs: ${SITE_URL}/foundry/docs · Tutorial: ${SITE_URL}/foundry/docs/tutorial ·
API reference: ${SITE_URL}/foundry/docs/reference · FAQ: ${SITE_URL}/foundry/docs/faq
Source: https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry
Canonical example: https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent

## 1. Install and run

\`\`\`bash
npx glove-foundry init my-agents            # interactive wizard (Clack)
npx glove-foundry init my-agents --template minimal --package-manager pnpm --yes --install
cd my-agents && pnpm dev                     # runtime + inspector on http://127.0.0.1:4141
\`\`\`

- Node 22+ required; 22.13+ for SQLite memory adapters.
- Templates: travel-concierge (default; keyless demo model, one example of every
  convention) and minimal (one agent, one tool; needs OPENROUTER_API_KEY in .env.local).
- --target standalone|nextjs (Next.js apps are detected), --package-manager
  pnpm|npm|yarn|bun, --yes/--no-interactive, --interactive, --install/--no-install, --help.
- Inside a project: glove foundry dev | start | help; run options --root, --port,
  --host, --no-watch. dev watches agents/config and regenerates .foundry/routes.d.ts.
- The wizard never asks for API keys. Starter storage is in-memory and resets.

## 2. Project layout and file conventions

\`\`\`text
agents/<route>/agent.ts              defineAgent — the route id is the folder path
agents/<route>/composition.ts        composeAgent(...) catalogue (ordinary module)
agents/<route>/tools/*.tool.ts       defineSharedTool
agents/<route>/apps/*.app.ts         defineApp
agents/<route>/transmissions/*.transmission.ts  defineTransmission
agents/<route>/events/*.event.ts     defineTransmissionEvent
agents/<route>/predicates/*.predicate.ts        defineTransmissionPredicate
agents/<route>/actions/*.action.ts   definePlaybookAction
agents/<route>/connections/*.connection.ts      defineConnection
agents/<route>/mcp/*.mcp.ts          defineMcp
agents/<route>/memory/*.memory.ts    defineMemory
agents/<route>/layers/*.layer.ts     defineLayer
agents/<route>/subscribers/*.subscriber.ts      defineSubscriber
foundry.application.ts               defineApplication — data adapter, accounts, routes, auth
foundry.config.ts                    defineConfig (from glove-foundry/config) — server, execution
.foundry/routes.d.ts                 generated FoundryRoutes type — do not edit
\`\`\`

- Each convention file default-exports one definition; its filename is its id.
  Nested paths nest ids: tools/calendar/today.tool.ts -> "calendar/today" (a bare
  tool body there is exposed to the model as calendar__today).
- Never add an id to a file-routed definition (the glove-foundry/eslint preset rejects it).
  In code, pass imported values (install(helpdesk)), not strings.
- Schedules are NOT auto-discovered: keep defineSchedule values in ordinary modules
  and return them from the agent's schedules field.
- Keep agent.ts to imports plus one defineAgent call. Write the parts in modules
  beside it: prompt.ts (a function returning the prompt), tools.ts (always-on
  tools), call.ts (payload schema + voiceCall), workspace.ts, *.memory.ts; shared
  choices (model per layer, store, workspace persistence) in lib/. Fields are
  values, imported definitions or one-line resolvers calling those modules.
- String ids are correct only for runtime data: instances, conversations, runs,
  accounts, routes, bindings, and at HTTP/database boundaries.

## 3. The model: definition, instance, conversation, run

- Definition (code): what an agent of this kind can assemble.
- Instance (data, FoundryDataAdapter): { id, definitionId, workspaceId, name?,
  description?, provisioningKey?, context, installations, playbooks, createdAt,
  updatedAt }. Created by createAgent / POST /api/agent-instances /
  defineAgentInstance seeds / subscriptions; edited with configureAgent / PATCH
  /api/agent-instances/:id (name, description, context, installations).
- Agents are data: the definition is the realm of possibilities, the instance is
  the agent. One "bot" definition serves every bot a person makes; its name, job,
  apps, role and team are instance data. A workspace is a tenant (a person's or
  a company's agents), and a conversation's context can carry data too (a group
  chat's members). A tool can write its own instance (ctx.data.putAgent), so an
  agent can rename itself.
- Conversation (data): owned by one instance; an instance may own many.
- Run: one message processed by a freshly assembled agent. Every run reloads the
  instance + conversation and resolves every definition field again, so instance
  edits apply on the next message without a deploy.
- Every run executes in a fresh child process of the managed execution daemon.
  Anything held only in memory — new MemoryStore(...), in-memory memory adapters,
  MemoryFoundryDataAdapter writes made by agent tools, module-level variables —
  does not survive to the next message. Durable state must live outside the process.
- There is no API to delete an instance.

## 4. defineAgent

\`\`\`ts
import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";   // durable transcript, see section 16

export default defineAgent({
  description: "Answers questions about orders",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: (_agent, ctx) => \`You are support for \${ctx.agentInstance.context.company}.\`,
  tools: [{                                   // always-on tools: plain Glove tools
    name: "lookup_order",
    description: "Find an order by id",
    inputSchema: z.object({ orderId: z.string() }),
    async do({ orderId }) { return { status: "success", data: { orderId, state: "shipped" } }; },
  }],
});
\`\`\`

Every assembly field is a literal or a resolver (agent, ctx) => value | Promise.
Fields: description, tags, components, store, model, systemPrompt, displayManager,
serverMode, maxRetries, maxConsecutiveErrors, compactionLimit,
compactionInstructions, maxTurns, enableToolResultSummary, tools, hooks, skills,
subagents, memory, goals, facts, forms, contextProviders, inboxes (always a
function), subscribers, layers, calls, schedules, playbooks, mesh,
workingEnvironment, repl, configure(agent, ctx), build(agent, ctx),
spawn(agent, ctx, message), run(agent, ctx), mcpAdapter, accountSessions.
An agent definition never declares request input/output — Foundry owns
FoundryRequest/FoundryResult.

AgentAssemblyContext: definitionId, agentId (instance id), conversationId,
workspaceId, runId, request, agentInstance, conversation, activations, data,
message (native Glove Message), messageInput, messageText, history, messages,
installations, store, subscriber, controls { signal, emit, commands }.
configure, run, spawn and call handlers get a different execution context:
identity ids, request, message, history, glove, emit, signal, installations,
onCleanup, invoke(callName, input), workingEnvironment, vfs, repl and
goals/facts/forms handles — but not agentInstance, conversation, data, store or
controls (use ctx.emit instead of controls.emit there). A run handler executes
after assembly and receives the assembled runnable; call ctx.defaultRun() for the
normal loop.

## 5. Catalogue vs installation (most common mistake)

composeAgent(...) + components only makes shared tools, apps and MCP servers
AVAILABLE. They mount only on instances that install them:
- install(def, config?, { account? }) in defineAgentInstance / createAgent({ installations })
- client.install(agentId, { kind, id, config }) / client.uninstall(...)
- PUT /api/installations  {"agentId","kind":"tool"|"application"|"mcp","id","accountId?","config?"}
  (DELETE with the same body uninstalls). The inspector displays installations but
  cannot change them. install(def) only works inside the Foundry process (file ids
  are bound by discovery); remote clients send plain { kind, id, config } records.
Tools every instance should have go in defineAgent's tools field. Memory profiles,
layers and subscribers are definition surfaces, not installations: list them in
components AND select them in the memory/layers/subscribers field, or the run fails
with "unknown ...". Installation config is validated when a run assembles, so an
invalid config fails the next run, not the install call. Installing an MCP server
requires the agent definition to set mcpAdapter. Config is typed by the definition's zod schema:
install(helpdesk, { queue: 42 }) is a TypeScript error and is re-validated at runtime.

\`\`\`ts
// agents/support/tools/refunds.tool.ts
import { Effect } from "effect";
import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

export default defineSharedTool({
  description: "Issue refunds up to a per-instance limit",
  config: z.object({ limitUsd: z.number() }),
  create: ({ config }) => Effect.succeed({
    name: "issue_refund",
    description: \`Refund an order (max $\${config.limitUsd})\`,
    inputSchema: z.object({ orderId: z.string(), amountUsd: z.number() }),
    requiresPermission: true,               // pauses on an approval record in Foundry
    async do({ orderId, amountUsd }: { orderId: string; amountUsd: number }) {
      return { status: "success" as const, data: { orderId, amountUsd } };
    },
  }),
});
// A static tool can use { description, tool: {...} } instead of create.
\`\`\`

defineMcp({ description, config?, entry }) — entry is an HTTP { url } or
{ transport: { kind: "stdio", command, args } } plus includeTools/excludeTools
globs, resources, prompts, connectTimeoutMs, requestTimeoutMs, idleTimeoutMs,
maxLifetimeMs. Auth headers, tokens and stdio env come from the agent's
mcpAdapter at connect time, never from config.
defineMemory / configureMemory, defineLayer / configureLayer (setup receives the
native glove), defineSubscriber, defineCall({ name, input, output, handler,
exposeToAgent? }) (exposed as a tool by default; callable via ctx.invoke).

## 6. Apps, transmissions and the outside world

- defineTransmissionEvent({ direction: "inbound" | "outbound", description })
- defineTransmissionPredicate({ match: (event, parameters) => Effect<boolean> })
- defineTransmission({ name, description, account: { required, metadata },
  capabilities, events, inbound: { config, event, classify, predicates },
  outbound: { config, input, output, adapter: { deliver(input, context) }, observe? } })
  — Effect Schema types flow into account metadata, route config, events, input, output.
- defineApp({ description, config?, inbound, outbound, connections?, install? }) —
  install returns Effect<{ tools }>. Installing an app mounts its outbound
  transmissions as validated tools; delivery runs in the parent runtime.
- defineConnection — a supervised long-lived inbound worker: connect(ctx) uses
  ctx.ready() and ctx.receive({ route, eventId, threadKey, conversationKey?,
  conversationScope?, awaitCompletion?, raw }). Started only when an installed app
  has an active inbound playbook or subscription.
- Topology is data: defineAccount({ id, transmission, externalAccountId, label,
  accessRef, metadata }), defineInboundRoute / defineOutboundRoute({ id,
  transmission, account, visibility, enabled, config }), defineBinding; register
  them in defineApplication({ accounts, routes, bindings }).
- Outbound delivery requires an enabled defineBinding for the instance (registered in
  defineApplication bindings); without one delivery fails with "agent has no enabled
  bindings". Transmission ids are global across agents.
- Fire inbound events: POST /api/transmissions/:routeId/fire or client.dispatchInbound.
  Delivery is claimed idempotently by routeId:eventId.
- Credentials: Foundry never does OAuth, stores secrets, refreshes tokens or picks
  accounts. accessRef is opaque; your accountSessions adapter resolves it;
  outbound adapters call context.withAccountSession(operation, use).
- Classifier triage: classifyInbound and classifierPredicate from
  glove-classifier/foundry (see ${SITE_URL}/docs/classifier#foundry).

## 7. Playbooks and provisioning

composePlaybook({ name, transmission, match: { event, routes, predicate: {
definition, parameters } }, directives: [{ action, instruction, parameters? }],
applications, outbound?: [{ route, application, account, event, instruction }],
serialization? }) is called at runtime (usually returned from the agent's playbooks
resolver) and persisted on the instance as id-based data. A playbook can bind only
transmissions owned by installed apps.
Playbook subscriptions (runtime.putPlaybookSubscription / client.putPlaybookSubscription /
PUT /api/playbook-subscriptions) are evaluated even when no instance exists and can
provision agents: singleton, per-thread, per-event, existing, or custom (the
application's provisioner). provisioningKey makes provisioning atomic.
Playbooks and schedules returned by a definition's resolvers are written onto an
instance during its first run, so a brand-new instance ignores inbound events until
it has run once; subscriptions and client.setAgentPlaybooks apply immediately.

## 8. Built-in agent tools (mounted on every Foundry agent)

| Tool | Purpose |
| glove_foundry_spawn | Invoke an agent now ({ definitionId?, agentId?, conversationId?, message, payload? }) |
| glove_foundry_schedule | Create a future/recurring activation; timing { kind: "at", at } / { kind: "after", duration } / { kind: "every", interval } / { kind: "cron", expression, timezone? } |
| glove_foundry_schedules | list / update / pause / resume / cancel this instance's activations |
| glove_foundry_sleep | Record a wake-up for the same instance + conversation ({ kind: "for", duration } or { kind: "until", at } in UTC ISO with Z); the current run ends and a new run starts at wake time |
| glove_foundry_background | Queue a run on the same instance + conversation; with reconvene (default true) it waits up to 60 s and posts a resolved background.reconvene item to the shared inbox (it does not wake the conversation) |
| glove_foundry_transmit | Deliver an outbound event through a route declared by this instance's playbook |
| glove_foundry_conversations | List this instance's conversations |
| glove_foundry_workspace | Read or write a shared workspace value |
| glove_foundry_shared_inbox | List or post shared inbox items |
| glove_foundry_tasks | List or create shared tasks |
| glove_foundry_environment | List non-secret environment metadata |

Durations: "30s", "20m", "2h", or Effect forms like "20 minutes".
defineSchedule({ name, description?, timing, message, payload?, enabled? }) values
returned from the schedules resolver are reconciled into persisted activations
(see the Automations page of the inspector, GET /api/activations). Activations are
persisted before arming and reconstructed on startup with a durable adapter.
Never use setTimeout for agent work.

## 9. Conversations and shared work

One instance owns many conversations (createConversation, conversations,
updateConversation, conversationTranscript — transcript.persisted is false when
no store is configured). Workspaces carry entries (putWorkspaceEntry;
compareAndSetWorkspaceEntry for optimistic coordination), a shared inbox, tasks
and non-secret environment values. Pass artifact paths, not copied documents.

## 10. Working environment and REPL

defineWorkingEnvironment({ options, persistence? }) mounts glove-working-environment
(guarded VFS, scripts, checkpoints, export). It closes after every run; add
foundryDataEnvironmentPersistence({ scope: "agent" | "conversation" | "workspace" })
(workspace = one tree shared by every agent in the workspace) or a native
persistent Vfs to keep files.
defineRepl({ language: "javascript" | "python" | "lisp", session, mount?,
programmaticTools? }) — one REPL per run. programmaticTools.select projects exact
live tools into the sandbox (maxCalls default 50); permission-gated tools are refused
there. Add document/spreadsheet/slide/image/media/fetch/secret adapters from
glove-env-* packages. Browsers and sandboxes: mountBrowser / mountSandbox from
glove-execution inside configure, with ctx.onCleanup.

## 11. Multi-agent

The mesh (Foundry-hosted Glove Mesh). Agents message each other by instance id:

\`\`\`ts
// agents/assistant/agent.ts
mesh: true,
// agents/coder/agent.ts
mesh: { waitMs: 120_000 },
// data: the person's team, one workspace
await foundry.createAgent("assistant", { id: "maya", workspaceId: "maya", name: "Iris" });
await foundry.createAgent("coder", { id: "maya-coder", workspaceId: "maya", name: "Coder",
  description: "Writes and runs code. Takes minutes. Give it the whole task." });
\`\`\`

- Tools: glove_mesh_list_agents({ name? }) → { agents: [{ id, name, description,
  metadata: { definitionId } }] } from instance data; glove_mesh_send_message({ to,
  content, in_reply_to?, blocking? }) → { message_id, thread_id, to };
  glove_mesh_broadcast({ content }) (one thread per peer);
  glove_mesh_acknowledge({ message_id, note? }) (reaches only a waiting run).
- Peers: the other instances in the sender's workspace, filtered by the sender
  definition's mesh.peers(self, peer). An agent can always answer whoever
  messaged it, so peers: () => false makes an agent that only answers. Other
  workspaces are never visible.
- A new message starts a thread: a conversation on the recipient (id
  "thread_<uuid>", context.meshThread holds the record) and a run there. The
  sender's conversation lists its thread ids in context.meshThreads.
- When the recipient's run completes, its final non-empty text is sent back as a
  reply; a failed or cancelled run sends a failed message (a steered run does
  not). Messages either way go into a run listening with ctx.onMeshMessage
  (voiceCall does), otherwise wait until the conversation is free and start one
  run with source.kind "mesh", rendered as <mesh-message id thread from name
  status?="replied|failed">body</mesh-message>.
- blocking: true waits in-run up to waitMs (default 90 000) for the reply and
  returns it as the tool result; on timeout the run should end its turn and
  finishes suspended (suspension { kind: "mesh", commandId, threadId,
  messageId }); the reply then starts a new run. Durable stores are required.
- mesh.mount(ctx) decides per run whether the tools are mounted (e.g. none on a
  read-only scheduled run). Open threads appear in the sender's runtime context;
  ctx.threads / ctx.thread in resolvers.
- Undelivered messages are kept on the thread (undelivered, pending) and handed
  over after a restart. runtime.listThreads({ agentId?, conversationId?, to?,
  status? }). Events: mesh.thread.started, mesh.message.sent, mesh.delivered,
  mesh.thread.replied, mesh.thread.failed, mesh.thread.cancelled, mesh.refused.
- Routing and checks happen in the Foundry runtime, not the run's process, so
  any data adapter works. Never import another agent's agent.ts.

Voice calls: import { voiceCall, webSocketRoom } from "glove-foundry/voice";
run: voiceCall({ room: (ctx) => webSocketRoom({ port, token }), greeting? }) with
model: s2sDrivenModel(...). Saves both sides to the store, speaks mesh
messages at the next pause (max 8 s hold; acks are not spoken), keeps glove_foundry_spawn/sleep/
background/schedules/conversations/workspace/shared_inbox/tasks/environment and
every requiresPermission tool off the call, ends on room end, idleMs (120 000),
maxDurationMs (1 800 000) or cancel. A mesh run (source.kind "mesh") with no
call live is saved to the conversation by default (offCall to override). A room is
{ open(call), close() } calling call.joined()/left(); LiveKit via
glove-voice-livekit's LiveKitTransport + attachRealtime.

Other mechanisms: defineSubagent (isolated child inside the parent's tool call;
tools can be a least-privilege projection of the parent built from parent.tools
— there is no projectTools export; a subagent's layers and subscribers mount per
invocation and are disposed when its request ends), defineCall (typed function),
glove_foundry_spawn (separate run, no result back), glove_foundry_background
(reconvene via inbox), playbook subscriptions (provision
a workforce), workspace/inbox/tasks for coordination.

## 12. Client and HTTP API

\`\`\`ts
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "./.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });
const agent = await foundry.agent("support").create({ workspaceId: "acme", context: { company: "Acme" } });
const conversation = await foundry.createConversation(agent.id);
const run = await foundry.send(agent.id, conversation.id, "Where is order 1042?");
const done = await run.wait({ timeoutMs: 120_000 }); // wait() gives up after 60 s by default
// also run.cancel(), run.steer(text), run.events()
\`\`\`

agent(route).request(...) posts to /api/agents/:route/runs and needs agentId,
conversationId and workspaceId as well as a string message; prefer send().

Native endpoints (selection): GET /health, /health/detailed, /api/manifest,
GET|POST /api/agent-instances, PATCH /api/agent-instances/:id,
GET|POST /api/conversations, GET|POST /api/conversations/:id/messages,
PATCH /api/conversations/:id, GET /api/runs, GET /api/runs/:id,
POST /api/runs/:id/cancel, POST /api/runs/:id/steer, GET /api/events (SSE with
Accept: text/event-stream), GET|PUT|DELETE /api/installations, GET /api/approvals,
POST /api/approvals/:id, /api/workspaces/:id/entries|inbox|tasks|environment,
/api/playbook-subscriptions, /api/activations, /api/transmissions,
POST /api/transmissions/:routeId/fire, /api/accounts, /api/routes, /api/bindings,
/api/application-connections, /api/capabilities, /api/surfaces.
Automation API: POST /v1/runs, GET /v1/runs/:id, GET /v1/runs/:id/events,
POST /v1/runs/:id/stop, POST /v1/runs/:id/steer, GET /v1/capabilities,
GET /v1/approvals, POST /v1/approvals/:id.
JSON bodies are limited to 1 MB by default (413 when exceeded); raise
server.messageBodyBytes for media. Runs, events and pending approvals are held in
the Foundry process's memory and are lost on restart; /health and /health/detailed
return 200 when ok is true and 503 with the same body when it is false
(client.health() returns the body either way). Activations are read-only over HTTP.
Installing an unknown id returns 400.

## 13. OpenAI-compatible endpoints

GET /v1/models lists instances (id = instance id). POST /v1/chat/completions and
POST /v1/responses support streaming and image input. model = an instance id, or a
definition route that has exactly one instance (otherwise 404); instances are never
created implicitly. Continue a conversation by sending the same user,
conversation_id, or x-foundry-conversation-id header (returned on every response);
without one, each request starts a new conversation. On a new conversation the
prior messages in the request are folded into the first turn; on an existing one
only the latest user message is sent because Foundry holds the history (so the
agent needs a durable store). Responses carry no usage block. Tools run server-side inside Foundry; client-sent
tools, sampling parameters and previous_response_id are ignored, and the developer
role is rejected.

## 14. Approvals and steering

A Glove tool with requiresPermission: true (or a function of its input), or an
outbound transmission with requiresPermission, pauses the run on an approval
record: status pending | approved | denied | expired | cancelled; identity = instance
+ conversation + run + tool + serialized input; expires after 5 minutes; fails
closed (deny) on expiry, cancellation or channel loss. Approval records live in a
private temp directory of the Foundry process: they do not survive a restart, and
the mechanism does not engage if defineAgent supplies its own displayManager. Resolve with
client.approvals({ runId, status: "pending" }) and client.resolveApproval(id,
"approve" | "deny"), the /api/approvals or /v1/approvals routes, or the inspector.
Steering (handle.steer(message), /api/runs/:id/steer, /v1/runs/:id/steer, WebChat
Redirect) is interrupt-and-restart: cooperative cancel, a wait (at most 10 s) for
the cancelled run's process to finish unAbortable tools and cleanup, then a
replacement run in the same conversation with lineage. It never injects text mid
side effect.

## 15. Inspector and observability

glove foundry dev serves the inspector at the server URL: Overview, Agents,
definition and instance pages, Chat (WebChat over exact stored transcripts, with
attachments, Stop and Redirect), Runs (filters in the URL: ?status=&source=&q=),
a run opened like browser DevTools (Network: each model request with the system
prompt, messages, runtime context/memory and tools it was sent, and each tool
call with input, result and approval; Console: levelled log; Context: what the
agent had; Summary; URL state ?tab=&item=&pane=), Automations, Integrations,
Workspaces. ⌘K search, j/k navigation, 1-4 run views, c to start a run. Events stream from /api/events;
custom sinks use defineSubscriber or a FoundryObservabilityAdapter. Use
controls.emit({ type, data }) for safe work notes; never emit secrets or hidden
reasoning. The event envelope carries the definition id and run id (not instance,
conversation or workspace ids). Only outbound transmission payloads are redacted by
default — tool results and model text are stored as-is. A custom
FoundryObservabilityAdapter can be supplied only when hosting FoundryRuntime in code;
the CLI uses the in-memory adapter.

## 16. Persistence — four separate boundaries

1. Foundry runtime data: FoundryDataAdapter (MemoryFoundryDataAdapter in dev;
   FileFoundryDataAdapter({ file, agents?, conversations?, subscriptions? }) for one
   host — advisory lock + atomic rename; a transactional adapter for many hosts).
2. Conversation transcripts: the agent store / application conversationStore.
   A plain MemoryStore starts empty on every run (each run is a new process), and
   GET /api/conversations/:id/messages then reports persisted: true with no
   messages — persisted only means a store factory exists. Minimal durable store
   for one host:

\`\`\`ts
// lib/file-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore, type Message } from "glove-core";

export class FileStore extends MemoryStore {
  private constructor(id: string, private readonly file: string) { super(id); }
  static async open(id: string, directory = ".data/transcripts"): Promise<FileStore> {
    await mkdir(directory, { recursive: true });
    const store = new FileStore(id, join(directory, \`\${encodeURIComponent(id)}.json\`));
    const saved = await readFile(store.file, "utf8").then(JSON.parse, () => [] as Message[]);
    await MemoryStore.prototype.appendMessages.call(store, saved); // restore without re-saving
    return store;
  }
  override async appendMessages(messages: Message[]): Promise<void> {
    await super.appendMessages(messages);
    await writeFile(\`\${this.file}.tmp\`, JSON.stringify(await this.getMessages()));
    await rename(\`\${this.file}.tmp\`, this.file);
  }
}
\`\`\`
   Use a database-backed StoreAdapter for several hosts. (glove-sqlite is deprecated.)
3. Structured memory: glove-memory adapters, e.g. createSqliteMemoryAdapters({ file,
   namespace, schema }) from glove-memory/sqlite (Node 22.13+).
4. Working-environment files: foundryDataEnvironmentPersistence or a persistent Vfs.
Persisting one does not persist the others. The execution queue is in-memory;
activations are reconstructed on startup but interrupted live runs are not resumed.

## 17. Application, config and security

defineApplication({ name, data, conversationStore, accounts, routes, bindings,
requestAuthorization, provisioner, services, daemon }).
defineConfig({ agentsDir, applicationFile, server: { host, port, messageBodyBytes },
execution: { pollIntervalMs, maxConcurrent, maxAttempts, retryBackoffMs },
observability: { maxEvents }, branding, strictFileRoutes }) — unknown keys are
rejected. Environment files: .env is loaded before .env.local and an already-set
variable is never overwritten. Run one runtime per data store: two runtimes on the
same store arm every schedule twice. Foundry binds to loopback by default and refuses a non-loopback
host unless requestAuthorization ({ identifier, challenge, authorize(request) =>
Effect<boolean> }) is supplied; the typed client sends matching headers via
authorization: { identifier, headers }. Put TLS and rate limits in front.
glove foundry start runs without watching.

## Goals, facts, and form preparation

Foundry exposes typed lazy goals, facts, forms and contextProviders fields, either
in defineAgent or as agent.ts named exports. defineGoals/defineFacts/defineForms
are pure configuration helpers; native runners own behavior. Execution hooks get
ctx.goals/ctx.facts/ctx.forms handles. Conversation scope is default; scope:
"instance" shares explicitly. foundryGuidanceSubject derives the same ownership
key outside assembly. A goal program seeds only absent state; later revision is
native CAS with a reason. Registries expose forms without starting all of them.
facts.preparationAgent is a separate built runnable with its own scoped store;
goals/forms preparation supplies rule and eligible callbacks. Foundry constructs
the native shared preparer and rejects subject mismatches or missing agents.
contextProviders resolves a list of native read-only providers, re-read each model
iteration and removed on cleanup. glove-memory/sqlite now includes durable goals,
facts and forms. Facts serialize per database through a separate OS-owned SQLite
lock while saves commit independently. Use local volumes, not network filesystems.
The inspector guidance card shows metadata from the latest observed run, not a
live database view. See /foundry/docs/guidance and the guided-intake example.

Dynamic goals are exported by glove-memory/goals (glove-memory 1.2.0+), not a
standalone glove-goals package. Shared evidence is glove-facts 0.1.0+.
Use useGoalRunner/useFormRunner from glove-memory/tools to mount workflow tools
on a conversational Glove runnable. useFacts from glove-facts mounts record_fact;
imports alone do not mount tools. Scope fact storage by subject and context.
With glove-core >=4.0.0, goals/forms/pinned context append live transient user-role
snapshots at the model-input tail before each iteration, leaving system prompt
and saved history unchanged. Runnable proxies forward addContextProvider and
getRuntimeContext; runtime_context subscriber events expose resolved snapshots.
Realtime voice refreshes silently at start/after tools; external changes require
await realtime.refreshContext(). Voice sessions retain superseded snapshots.

new FactPreparation(facts, { agent: preparationAgent }) enables preparation.
Supply a dedicated built IGloveRunnable with its own scoped conversation store
and the application's tracing subscribers. The library appends submit_preparation
once at first use and runs processRequest, preserving tool execution, model
usage and persisted history. Do not use a direct ModelAdapter call or the
conversational agent itself. Without a preparation agent, capture and ordinary
workflow operations remain available and automatic preparation is disabled.

Pass preparation: { preparer, rule, eligible? } to the goals/forms runner.
Host rules allowlist requirements, schemas/evidence policies validate proposals,
and ordinary goal/form commits remain authoritative. One fact can support both
consumers. Corrections flag existing work for review. Capturing a fact alone
does not trigger all workflows; preparation runs on starts/relevant commits,
before mounted turns, or explicit runner.prepare(). Production adapters must
preserve evidence receipts and prepared-form recovery state.

Use Foundry’s lazy goals, facts, forms and contextProviders fields for native
guidance assembly. Browser/sandbox capabilities use explicit configure mounts;
they do not add browser or sandbox fields to agent definitions. Detailed workflow skill:
https://github.com/porkytheblack/glove/blob/main/.claude/skills/glove/references/memory-and-workflows.md#goals-facts-and-form-preparation
`;

export const OPERATOR_REFERENCE = `
## Browser and sandbox mounts

The optional glove-execution package provides mountBrowser(agent, { adapter })
and mountSandbox(agent, { adapter }). glove-core has no browser/sandbox dependency.
Station adapters live in glove-execution/station. Mount explicitly in configure;
register generic context.onCleanup teardown immediately after acquiring resources.
Browser scripts use execute_browser and sandbox scripts use execute_sandbox.
Page evaluation is separate from workflow scripting. Screenshots reach the model
as native images after tool results. Retained scopes grant resource IDs across runs;
script variables are run-scoped.

Runnable example: https://github.com/porkytheblack/glove/tree/main/examples/foundry-operator
Guide: ${SITE_URL}/foundry/docs/browser-and-sandbox

Operator runs locally on port 4243 with OpenRouter, Station, Steel profiles and a Docker
workspace. Human sign-in belongs to the user; Telegram sign-in has not been verified
end to end. Messaging actions require user direction in the application prompt. Port 3000 sandbox services preview through a separate-origin GET bridge.
No host keys, folders or Docker socket are mounted into the sandbox.
Foundry owns one managed local Station daemon for agent jobs and optional resources.
Configure application.daemon with stationDaemon({ stationId, resources, onReady })
from glove-foundry/station. The resource factory runs once inside that daemon and
returns optional browser and sandbox adapters. Agent capabilities still use mounts.
The private onReady connection is { url, stationId, token }; Station 3 requires
operator/admin scope for this resource API. Never expose it in prompts, manifests,
telemetry or frontend code. Programmatic setup with a daemon adapter supplies
applicationFilePath so the managed process can load the resource factory.
Factories release partially acquired resources if they throw before returning;
Foundry owns successfully returned providers through shutdown and startup failure.
Omit daemon for jobs only, or return only browser or sandbox. Each runtime owns
one local Station. Memory defaults to the agent conversation; cross-scope recall,
checkpoint policy and eager/lazy resource acquisition belong to the application.
Operator selects a native defineMemory profile with SQLite context, episodic, entity
and resource adapters, scoped per workspace/instance/conversation. Pinned unfinished
tasks and preferences refresh before each model iteration. Exact current requests
are re-injected independently of compaction; summaries preserve outcomes, constraints,
uncertainty and next actions. The store persists native tasks and inbox items and
measures current context pressure separately from cumulative usage. verify:memory
tests real-model memory writes and recall after forced compaction in an isolated
conversation, without modifying the user's pinned memory.
`;

const REBUILDS_REFERENCE = `## Rebuilds: four always-on agent products

Independent examples, not affiliated with xAI, Anthropic, OpenAI or Meta. Each
runs offline with pnpm verify (scripted models) and deploys on Kuiper. All four
follow "agents are data": definitions say what a kind of agent can be; every
agent is an instance in its person's workspace.

Connected apps work the same way in all four. Each provider (Gmail, Linear,
Google Calendar) is a Foundry app installed on the agent with the person's
account (installation.accountId):
- app mcp: { entry, auth, tools } opens the provider's MCP server (Google's
  gmailmcp/calendarmcp, Linear's mcp.linear.app) with a bearer header from
  accountSessions.withSession({ operation: "mcp:connect" }). tools decides
  allow | ask | hide per tool (default: readOnlyHint allows, the rest ask).
- defineRepl({ programmaticTools: { select: ({ apps }) => apps.flatMap((app) =>
  app.tools.filter((tool) => tool.readOnly)), keepDirect: false } }): reads are
  functions in execute_js (gmail.search_threads(...), linear.list_issues(...))
  and leave the direct tool list. Writes stay direct tools with approvals.
- Sending mail is the app's outbound transmission (glove_app_gmail__gmail_send,
  requiresPermission true). Foundry delivers it in its own process inside the
  account session, on the route the binding grants (capability gmail:send).
- New mail: a gmail-watch connection renews Gmail's users.watch daily, pulls
  the Pub/Sub subscription, reads each message with history.list and emits a
  mail-received event; a playbook runs the agent in a chosen conversation.
- Accounts and tokens live in your store (lib/accounts.ts). Foundry reads them
  through your AccountDirectory, passed with routes and bindings in
  defineApplication({ services }) (fileTopologyStore keeps routes and bindings
  on disk). connectApp writes the account, the routes, the binding and the
  installation; scripts/connect.ts runs the provider's OAuth sign-in with PKCE.
- glove_foundry_transmit only sends on routes the agent's playbooks declare,
  and asks when the route's transmission asks.

Grok Bot → examples/foundry-bot-crew (${SITE_URL}/foundry/docs/rebuilds/grok-bot)
Facts from Cursor's and xAI's Grok Bot docs: launched in beta on 11 August
2026, on Cursor's cloud; bots have a name, a job and a working style; a starred
Primary Bot takes everyday asks and routes to specialists; all of a person's
bots share one cloud computer and the person's connected apps, so isolation is
per person, not per bot; bots hand work to each other and share group chats of
2-6 bots; skills are shared and invoked with /; a routine assigns a workflow to
one bot on a schedule or after an event (up to 50 per bot, up to 50 bots);
approvals are allow once, deny or always allow, and require-approval rules win;
you take over for passwords, 2FA and CAPTCHAs, and other secrets go through a
masked request. SpaceXAI picks the model; here the operator sets one.
- The bots are siblings: one definition and no coordinator kind. One is
  starred as the Primary Bot (context.starred; lib/people.ts primaryOf,
  starBot moves the star); askPrimary (lib/groups.ts) sends an ask that names
  no bot to its chat, and it hands siblings their part over the mesh. A bot runs
  when its person writes to it (its "chat" conversation), when it is
  @-mentioned in a group chat (or nobody is), when a sibling hands it work over
  the mesh, or when one of its routines fires.
- One definition, agents/bot/agent.ts. Every bot is an instance in the person's
  workspace: lib/people.ts botFor({ id, name?, job?, style?, starred?,
  routines?, installations? }) (name "New bot" until it has a job),
  chatWith(botId) (conversation key "chat"). lib/connect.ts makeBot creates
  every bot with the person's apps and refuses a 51st. foundry.application.ts
  seeds Maya's first bot, Inbox Manager, starred, with her Gmail and a routine
  on new mail, plus its chat.
- Prompt and playbooks are built from instance data; every bot uses the same
  model. A bot without a description asks what it is for and calls take_job,
  which writes name, description and an optional working style
  (context.style) with ctx.data.putAgent (no deploy).
- Routines: on a schedule, glove_foundry_schedule (owned by that bot); after an
  event, add_routine writes context.routines ([{ on: "new-mail", skill?,
  instruction }]) and the playbooks resolver builds newMailFor(accountId,
  routine) from it; a bot can have several on one event. add_routine refuses a
  51st routine, counting its schedules. New mail reaches every bot whose
  routine asks, in its chat. configure wraps glove_foundry_schedule with the
  same 50-routine count (one-off "at" schedules don't count).
- Group chats have no host (lib/groups.ts): openGroup creates a conversation per
  member (key "group:<id>", context.group.members); postToGroup sends the
  person's message to the bots it @-mentions, or to all members for @everyone
  or no mention. A member with nothing to add replies empty (posts nothing).
- Gmail and Linear apps (agents/bot/apps): every bot carries the person's
  installations; connect_app (requiresPermission) is the Connect button, and
  connectApp gives the account to every bot in the workspace. Bug triage files
  issues with linear__save_issue (asks first); reads run in code.
- mesh: { waitMs: 60_000 }: siblings find each other with glove_mesh_list_agents
  and hand parts of their work over by id; answers come back on their own.
  Handoffs name output path, done, evidence, open questions, next owner.
- One computer per workspace: foundryDataEnvironmentPersistence({ scope:
  "workspace" }). Skills are workspace entries "skill:<name>" (save_skill has
  requiresPermission), read with glove_read_skill and invoked by the person as
  /name through the definition's skills resolver (agents/bot/skills.ts).
- lib/templates.ts: duplicateBot copies name (as "<name> (copy)"), job, style, routines, schedules
  (context.schedules, armed by the schedules resolver on its first run) and
  installations, not memory or chats; templateOf / fromTemplate carry
  instructions, chosen memories, skills, routines and first-party apps, never
  accounts, chats, custom MCP or scripts; MARKETPLACE lists ready-made ones.
- Each app installation has alwaysAllow and alwaysAsk; alwaysAsk wins.
- Gmail's send, save_skill and request_sign_in ask first (sign-in = the person
  takes over for a password, a 2FA code, a CAPTCHA or single sign-on on the
  shared computer; the bot never sees the password).
- Left out on purpose: routing bot traffic through the person's desktop to get
  past datacenter-IP blocks. Not built: teach-a-task recording.

Claude Duet → examples/foundry-proactive-partner (${SITE_URL}/foundry/docs/rebuilds/claude-duet)
- lib/onboarding.ts: partnerFor(person, preferences) (workspace = person id,
  context { name, timezone, preferences { briefAt, checkInHours, hearAbout } }),
  computerFor(person) (a "Computer" instance), threadFor(person);
  foundry.application.ts seeds Ada's with defineAgentInstance. The computer
  persists with foundryDataEnvironmentPersistence({ scope: "agent" }).
- schedules resolve from instance data: morning-brief cron from briefAt and
  check-in cron from checkInHours, in context.timezone. Changing preferences with
  configureAgent moves the schedule on the next run. Definition schedules attach
  to the conversation of the run that first syncs them, so send a first message
  in the thread. Scheduled runs have request.source.kind === "activation".
- notify_person is the only way to the phone; quiet check-ins reply
  "(nothing new)". The brief flags clashes (a call during a flight).
- Gmail and Calendar apps; the brief reads both in one execute_js program.
  New mail goes into the one thread (playbook, conversation "thread").
- Gmail's send, pay_invoice, sign_document, delete_file wait for approval.
  configure wraps Gmail's send (send.ts guardSends): requiresPermission is
  (input) => !strictlyBlocked(text), so a message the guard refuses is not
  asked about; the wrapper calls the inner tool's run, so the person approves
  once. No tool exists for trading or moving money between accounts.
- lib/guard.ts: strict tier in code (Luhn card numbers, government ID numbers)
  always blocks; sensitive tier (health, personal finance) via a glove-classifier
  noul pair, blocked unless the person's own message asked to share it.
- mesh: true: long jobs go to the Computer over the mesh; its reply comes back
  to the thread and the partner notifies the person. voiceCall for calls.

OpenAI Dots → examples/foundry-standing-agents (${SITE_URL}/foundry/docs/rebuilds/openai-dots)
Facts from OpenAI's announcement and help center: launched at DevDay on 29
September 2026 on GPT-6 Astra; one primary dot you name, with a handle like
@pip-dot (more dots and teams of dots planned), its own cloud computer and
browser, and notes on preferences, decisions and ongoing responsibilities; a
coordinator that splits work across background agents and Codex; proactive
research with read-only tools; triggers: self-scheduled follow-ups, fixed
schedules with a time zone, event triggers; Custom Rules per action: act
without asking, act when asked, ask first, or hand off to you; an auto-review
you can't switch off checks sensitive actions; password changes and money
transfers are always handed to you, and permanent deletion, software installs
and saved-card purchases always need approval; memory = chat + account memory
+ the dot's own notes; Activity View to redirect or pause; safety monitoring
can pause or stop a dot; ChatGPT, Slack, Teams and voice (Teams isn't built
here); specialist dots with their own identity for organisations, in preview.
- One dot definition; each dot is an instance (workspace = owner) whose context
  holds name, kind (primary | specialist), responsibilities [{ job,
  sources, attention, mustNot }], rules (action → "allow" | "when_asked" |
  "ask" | "block", labelled act without asking, act when asked, ask first, hand
  off to you), paused and routing { progress, decisions }. primaryDot(owner, dot), specialistFor(org, { …,
  account }) and builderFor(owner) build the data; foundry.application.ts seeds
  Sam's dot (Pip), builder and app conversation with defineAgentInstance.
- research schedule every 2h. On runs not started by the person (not direct,
  not the owner's Slack message, not a reply over the mesh, not a follow-up),
  and on every run of a paused dot, the tools resolver returns only read tools,
  the Gmail app hides everything but reads, configure removes Gmail's send,
  workingEnvironment resolves to undefined and mesh.mount is false. New mail is
  one of those read-only runs (an event trigger that only reads).
- Follow-ups act: on acting runs, followUps() (agents/dot/research.ts) wraps
  glove_foundry_schedule and glove_foundry_spawn so their payload carries
  followUp: true, and readOnly() treats an activation, spawn or background run
  with that payload as acting. Read-only runs can only list schedules. Cron
  takes a timezone.
- reviewed(action, review) wraps every acting tool. levelFor: ALWAYS_YOURS
  (change_password, transfer_money) is always "block", which never runs and
  hands it to the person; ALWAYS_ASKS (delete_permanently, install_software,
  buy_with_saved_card) never goes below "ask"; ask → requiresPermission: true;
  when_asked acts without asking only on a run the person started; allow runs,
  but an unknown recipient asks (function form of requiresPermission). No rule
  → ask.
- lib/monitor.ts: the run hook counts hand-offs and denials in a row; after
  PAUSE_AFTER (3) it writes paused: true with ctx.data.putAgent. A paused dot
  only reads; configureDot also removes its write tools and the mesh. The
  person resumes it with configureAgent. Stopping doesn't undo actions taken. Gmail's send goes
  through the same review in configure (rule send_email, recipient payload.to;
  known contacts come from gmail__search_threads).
- The dot's own computer: a working environment with
  foundryDataEnvironmentPersistence({ scope: "agent" }). Coding jobs start on
  the person's Builder over the mesh (peers: only the builder; the builder has
  peers: () => false).
- Channels are conversations on one instance (conversationKey "app" and
  "slack"), plus voiceCall for calls. Memory is the person's account memory
  (one namespace per workspace, read-only to the dot) under the dot's own notes
  (per instance), shared across channels. Slack through a transmission, a predicate on the owner's
  Slack user id and a playbook; a forwarder answers url_verification and checks
  x-slack-signature.
- Resolvers read the instance fresh from ctx.data.getAgent, because recurring
  schedules fire with the envelope captured when armed
  (porkytheblack/glove#199).

Meta Muse → examples/foundry-personal-agent (${SITE_URL}/foundry/docs/rebuilds/meta-muse)
Facts from Meta's announcement and reviews: announced 8 September 2026 by Meta
Superintelligence Labs, on its Muse Spark model; one personal agent per person
that does the work (email, bookings, forms, purchases) and turns a goal into a
plan; you set its name, avatar and style; the Muse app and WhatsApp; email,
calendar, banks through Plaid and retail partners, with read and write granted
separately per app; Muse Secure VM, a dedicated VM per person holding the
credentials of connected services; a Sentinel agent on the same machine,
isolated from Muse, without whose approval nothing reaches the internet, which
asks you when needed; it can't see passwords or payment methods; checkout with
Stripe's Link, whose agent wallet issues single-use cards; checks before sending
or buying; keeps working after the app closes; remembers, suggests unprompted
and forgets on request; a log of what it did and plans.
Here: Muse on Claude Sonnet and the Sentinel on Claude Haiku through Kuiper's
model gateway; everyone's Muse shares one unit and its /data disk (memory and
log per person); only the browser and its profile are per person; the Sentinel
guards the browser, while app reads and sends go through Foundry's apps.
- One instance per person (lib/people.ts museFor; name person.agentName ??
  "Muse"; context { name, phone, avatar?, style?, sentinel { read, write,
  blocked } }), conversations "app" and "whatsapp", one defineMemory profile.
  glove_context_unset is how it forgets; the activity subscriber logs only
  "memory changed" for glove_context_* tools, so the log never holds a fact
  as a memory entry (what Muse sent, which may mention it, stays logged).
- Plans are Foundry goals at instance scope (lib/memory.ts personalPlans, goals
  resolver on the definition): one goal per plan, one item per step. A daily
  "suggest" schedule runs a short pass that suggests one thing or replies
  "(nothing to suggest)".
- WhatsApp is a Foundry app (transmission in and out). Inbound on one shared
  route (Muse's business number, an app-owned account); each person's playbook
  has a from-person predicate on their number. Outbound on a route per person
  whose config.to fixes the recipient. scripts/whatsapp-webhook.ts answers
  Meta's verify-token handshake, checks X-Hub-Signature-256 and forwards each
  text message to /api/transmissions/whatsapp-in/fire.
- Access per app is installation config { access: "read" | "act" }. The app's
  mcp.tools policy hides writes under "read"; configure removes Gmail's
  transmission send tool; the send binding is enabled only for "act".
  setAccess and disconnect (lib/connect.ts) are writes.
- The browser (agents/muse/browser.ts): in configure, mountBrowser(agent, {
  adapter: kuiperBrowser({ browsers: kuiper.browsers, sessionIds, session: {
  profileId, persistProfile: true, inactivityTimeout, kuiper: { onInactive:
  "hibernate", record: true } }, cleanup: "keep", guard: sentinel.guard,
  onHandOff, onOpen }) }) from glove-execution/kuiper and @kuiper-sh/sdk. The
  instance keeps context.browser { profileId, sessionId }; Kuiper sessions
  belong to the project, so the next run reconnects by ID. execute_browser:
  browser.sessions/open/navigate/observe/interact/screenshot/handOff/close.
- The Sentinel (agents/muse/sentinel.ts) is the browser's guard: every request
  the browser makes while Muse is connected. Page loads and anything that
  writes get a decision; a page's own files get quick checks. Rules in code
  first (blocked host; personal data in a URL to a host not allowed; allowed
  host), then its own model via glove-classifier llmClassifier with one choice
  question (allow | ask | block); a doubtful allow becomes ask. It sees only
  the request, the person's own words for this run and their allowed sites,
  never Muse's conversation or pages. A blocked load fails with "blocked"
  without the reason, so request_access reads the run's decision: block stays
  blocked with no approval; ask has requiresPermission and the person's yes
  grants the host for reading (GET/HEAD) or writing, separately, in
  context.sentinel.read / write. A read grant never lets it post.
- Turned away: if a site says it doesn't allow automated agents, Muse stops and
  tells the person. Its tabs say what they are: lib/kuiper.ts identify() adds
  AGENT_TOKEN to the browser's real user agent (kuiperBrowser's connect
  option), never a different browser's.
- Sign-in: browser.handOff gives Kuiper's interactive live view to onHandOff,
  which sends it to the person on WhatsApp from host code; Muse never sees the
  link or the password. persistProfile keeps the login in their profile.
  onOpen keeps the session's view-only debugUrl as context.browser.watchUrl for
  the person's app; the prompt never reads it.
- buy (requiresPermission) gets a one-time card and host code types it into
  the checkout open in Muse's browser, in a tab it closes (lib/payments.ts);
  the Sentinel allows that checkout for the run; Muse sees the last four
  digits. The example ships a stand-in issuer only.
- The log (lib/activity.ts): a defineSubscriber in components records every
  tool_use_result; the Sentinel records every decision; the browser's host
  code records opens and hand-offs; plans are open plan steps, Foundry's
  activations and pending approvals (logFor).
`;

// Keep both full-reference routes on the same complete source.
export const FOUNDRY_LLMS_FULL = `${FOUNDRY_BASE_REFERENCE}\n\n${REBUILDS_REFERENCE}\n\n${OPERATOR_REFERENCE}`;
