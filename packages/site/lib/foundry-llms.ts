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
    "- Instances are data (FoundryDataAdapter); every run reloads the instance and conversation and re-resolves the definition against the new message.",
    "- Each run executes in a fresh child process: a plain MemoryStore and other in-memory state reset on every message. Persist four things separately: runtime data, transcripts (store), memory, and working-environment files.",
    "- Install capabilities with install() at creation, client.install, or PUT /api/installations; the inspector only displays installations.",
    "- Foundry never acquires, stores or refreshes credentials; accounts carry an opaque accessRef resolved by your adapter.",
    "- A non-loopback bind requires a requestAuthorization adapter.",
    "",
    `- Product page: ${SITE_URL}/foundry`,
    `- Complete condensed reference: ${SITE_URL}/foundry/llms-full.txt`,
    `- Glove (core and packages) index: ${SITE_URL}/llms.txt`,
    "- Source: https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry",
    "- Canonical example: https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent",
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
- String ids are correct only for runtime data: instances, conversations, runs,
  accounts, routes, bindings, and at HTTP/database boundaries.

## 3. The model: definition, instance, conversation, run

- Definition (code): what an agent of this kind can assemble.
- Instance (data, FoundryDataAdapter): { id, definitionId, workspaceId,
  provisioningKey?, context, installations, playbooks, createdAt, updatedAt }.
  Created by createAgent / POST /api/agent-instances / defineAgentInstance seeds /
  subscriptions; edited with configureAgent / PATCH /api/agent-instances/:id.
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
foundryDataEnvironmentPersistence({ scope }) or a native persistent Vfs to keep files.
defineRepl({ language: "javascript" | "python" | "lisp", session, mount?,
programmaticTools? }) — one REPL per run. programmaticTools.select projects exact
live tools into the sandbox (maxCalls default 50); permission-gated tools are refused
there. Add document/spreadsheet/slide/image/media/fetch/secret adapters from
glove-env-* packages. Browsers and sandboxes: mountBrowser / mountSandbox from
glove-execution inside configure, with ctx.onCleanup.

## 11. Multi-agent

defineSubagent (isolated child; tools can be a least-privilege projection of the
parent built from parent.tools — there is no projectTools export; a subagent's
layers and subscribers mount per invocation and are disposed when its request
ends), defineCall (typed function), glove_foundry_spawn (separate run),
glove_foundry_background (reconvene via inbox), mesh field (glove-mesh),
playbook subscriptions (provision a workforce), workspace/inbox/tasks for
coordination. Voice hosts (glove-voice-s2s) delegate durable work to an
instance via the typed client.

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
Redirect) is interrupt-and-restart: cooperative cancel, then a replacement run in
the same conversation with lineage. It never injects text mid side effect.

## 15. Inspector and observability

glove foundry dev serves the inspector at the server URL: Overview, Agents,
definition and instance pages, Chat (WebChat over exact stored transcripts, with
attachments, Stop and Redirect), Runs (filters in the URL: ?status=&source=&q=),
run detail (phase spine + event trace), Automations, Integrations, Workspaces.
⌘K search, j/k navigation, c to start a run. Events stream from /api/events;
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
glove foundry start runs without watching. Glovebox is deprecated; deploy Foundry.

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
https://github.com/porkytheblack/glove/blob/main/.claude/skills/glove/workflows.md
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

// Keep both full-reference routes on the same complete source.
export const FOUNDRY_LLMS_FULL = `${FOUNDRY_BASE_REFERENCE}\n\n${OPERATOR_REFERENCE}`;
