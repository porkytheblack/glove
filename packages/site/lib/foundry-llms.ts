import { foundrySections } from "./foundry-nav";

const SITE_URL = "https://glove.dterminal.net";

export function buildFoundryLlmsTxt(): string {
  const lines = [
    "# Glove Foundry",
    "",
    "> Glove Foundry is the Effect-native, file-routed application framework for typed, observable Glove agent systems. Definitions live in code; mutable agent instances, installations, playbooks, schedules, conversations, and workspace state live in data.",
    "",
    `- Product: ${SITE_URL}/foundry`,
    `- Condensed reference: ${SITE_URL}/foundry/llms-full.txt`,
    "- Package: glove-foundry",
    "- Live memory: glove-core 3.8+ appends goals/forms/context as runtime snapshots at the model-input tail; system instructions and saved history remain unchanged.",
    `- Dynamic goals (glove-memory/goals): ${SITE_URL}/docs/goals`,
    `- Shared facts and traced preparation (glove-facts): ${SITE_URL}/docs/facts`,
    "- Source: https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry",
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

export const FOUNDRY_LLMS_FULL = `# Glove Foundry — condensed reference

Glove Foundry is an Effect-native, file-routed TypeScript application framework
for Glove agent systems. It provides discovery, typed composition, persisted agent
instances, conversations, dynamic application installations, inbound/outbound
transmissions, runtime playbooks, schedules, working environments, multi-agent
coordination, HTTP activation, and a correlated inspector.

Docs: ${SITE_URL}/foundry/docs
Source: https://github.com/porkytheblack/glove/tree/main/packages/glove-foundry

## Install and run

\`\`\`bash
npx glove-foundry init my-agent-system
cd my-agent-system
pnpm install
pnpm dev
\`\`\`

After the package is installed, \`glove foundry dev\` and
\`glove foundry start\` are available. Node.js 20+ is required. Development mode
generates \`.foundry/routes.d.ts\`, starts the runtime and inspector, and watches
definitions. Configuration is typed with \`defineConfig\`.

## Identity and references

- Agent definition identity comes from \`agents/<route>/agent.ts\`.
- Colocated static primitives receive identity from their discovered file route.
- Do not repeat IDs inside definitions.
- Static code imports and passes definition objects directly.
- Generated HTTP clients use a generated union of serialized agent routes.
- Persisted instance, conversation, run, schedule, and external account IDs are data
  and are correctly represented as strings at that boundary.

## Definitions versus instances

A definition is code describing what a kind of agent may become. \`defineAgent\`
does not declare request input or output. An instance is persisted data selecting a
definition route plus context, workspace, installations, playbooks, schedules, and
other mutable choices. Foundry reconstructs the agent from the latest definition and
instance record for every run.

\`\`\`ts
export default defineAgent({
  description: "A release planning agent",
  model: (_agent, ctx) => modelFor(ctx.message, ctx.agentInstance),
  store: ({ conversationId }) => storeFor(conversationId),
  tools: (_agent, ctx) => toolsFor(ctx.installations, ctx.message),
  systemPrompt: (_agent, ctx) => promptFor(ctx.message, ctx.history),
  memory: (_agent, ctx) => memoryFor(ctx.agentInstance, ctx.message),
  inboxes: (_agent, ctx) => loadInboxes(ctx.agentId, ctx.message),
  workingEnvironment: (_agent, ctx) => workspaceFor(ctx.workspaceId),
  repl: (_agent, ctx) => replFor(ctx.agentId, ctx.message),
  playbooks: (_agent, ctx) => playbooksFor(ctx.agentInstance, ctx.message),
});
\`\`\`

Resolvers may be synchronous or async. Major surfaces receive the current instance,
conversation, native Glove message/content parts, request payload, history,
installations, workspace, run controls, and message text. Literal values are allowed
for stable components.

## Applications and transmissions

Applications are installable definitions, not global capabilities. An agent instance
owns its installations. One app may own multiple inbound and outbound transmissions.
Outbound capabilities become tools only after the app is installed and the relevant
account/capability grant is resolved.

Transmission definitions own provider-specific authentication, normalization,
classification, executable predicates, outbound delivery, and schemas. Playbooks are
serializable runtime data that match classified events, serialize them into a
conversation, provide directives, and declare optional outbound routing.

Foundry never acquires, stores, selects, or refreshes credentials. Supply a user-owned
adapter. Accounts contain metadata and identity, not secret material. Do not place
secrets in instances, manifests, or telemetry.

## Playbook activation

A persisted playbook subscription can target an existing singleton, one instance per
external thread, one instance per event, a fixed fan-out, or a user-defined
provisioner. An inbound event can therefore instantiate one or many subscribed agents
even when no instances exist. Provisioning, conversation creation, and delivery
claims must be atomic and idempotent in production adapters.

Definitions may return composed playbooks as defaults, but playbooks do not require
static definition files. Instances own the selected runtime values.

## Schedules, sleep, and background work

Agent definitions may lazily return predefined \`defineSchedule(...)\` values. Foundry
materializes them as instance-bound runtime schedules. Agents can also create ad hoc
once or recurring triggers with \`glove_foundry_schedule\`; list, update, and cancel
owned schedules with \`glove_foundry_schedules\`; sleep the same logical run with
\`glove_foundry_sleep\`; and start reconvening background work with
\`glove_foundry_background\`.

## Conversations and workspaces

One instance may have many conversations. Messages are native Glove messages, including
typed content parts and attachments. Workspaces provide structured entries, a shared
inbox, tasks, and scoped data-environment values. Pass canonical artifact paths or
references between agents instead of copying whole documents into prompts.

## Working environments and REPLs

\`defineWorkingEnvironment\` mounts \`glove-working-environment\`: a bounded VFS,
script execution, artifact export, progress callbacks, and model-facing verbs. Add
Glove environment adapters for documents, spreadsheets, slides, images, render/OCR,
archives, media, motion, email, HTTP files (\`glove-env-fetch\`) and host keystores
(\`glove-env-secret\`). Configure fetch origins and credential aliases in host
options. Native fetch blocks non-public DNS/IPs unless an exact private origin
is granted; custom transports own equivalent safety. Keep each SecretStore scoped
to its owning instance and re-supply it on every run; VFS snapshots exclude its
values. References reveal no plaintext and grant no access by themselves. \`defineRepl\` mounts JavaScript, Python, or Lisp
sessions whose available functions may depend on the current message.

## Multi-agent

- \`defineSubagent\`: an isolated specialist inside the current logical run.
- \`defineCall\`: a Zod-typed local or inter-agent function.
- \`glove_foundry_spawn\`: start immediate work for an instance or definition.
- \`glove_foundry_background\`: run independently and optionally reconvene.
- \`glove-mesh\`: durable direct, broadcast, and acknowledged instance messaging.
- Glove S2S/S2V packages: layer reasoning or vision agents behind a live voice agent.

## Runtime and client

\`\`\`ts
import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "./.foundry/routes.js";

const client = createFoundryClient<FoundryRoutes>();
const instance = await client.agent("assistant").create();
const conversation = await client.createConversation(instance.id);
const handle = await client.send(instance.id, conversation.id, "Do the work");
const result = await handle.wait();
\`\`\`

Primary endpoints:

- \`POST /api/agent-instances\`
- \`PATCH /api/agent-instances/:id\`
- \`POST /api/conversations\`
- \`POST /api/conversations/:conversationId/messages\`
- \`POST /api/transmissions/:routeId/fire\`
- \`GET /api/runs\`
- \`GET /api/events?runId=:id\`

## Observability

Events correlate definition, instance, workspace, conversation, run, pass, tool,
transmission, schedule, message, handoff, and artifact activity. The inspector shows
declared work intent, safe progress, actions, outputs, failures, retries, and timings.
It must not expose private chain-of-thought, raw credentials, or unredacted provider
payloads. Custom subscribers may export the same event stream.

## Production

Development memory adapters are not durable. Production requires adapters with atomic
provisioning and inbound claims, durable conversations and schedules, execution leases,
bounded concurrency, cancellation, VFS/artifact persistence, redaction, and health
checks. Foundry's public vocabulary stays deployment-neutral; backend worker/network
terminology must not leak into definitions.


## Goals, facts, and form preparation

Dynamic goals are exported by glove-memory/goals (glove-memory 1.2.0+), not a
standalone glove-goals package. Shared evidence is glove-facts 0.1.0+.
Use useGoalRunner/useFormRunner from glove-memory/tools to mount workflow tools
on a conversational Glove runnable. useFacts from glove-facts mounts record_fact;
imports alone do not mount tools. Scope fact storage by subject and context.
With glove-core >=3.8.0, goals/forms/pinned context append live transient user-role
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

Use existing build/assembly extension points; these packages do not introduce
new Foundry goals/facts definition fields. Detailed workflow skill:
https://github.com/porkytheblack/glove/blob/main/.claude/skills/glove/workflows.md
`;
