import type { ReactNode } from "react";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "API reference",
  description:
    "Every value export of glove-foundry and its subpaths, the built-in agent tools, HTTP endpoints, CLI commands, config keys and environment variables.",
};

/** Render `backticked` spans as <code>. Keeps the tables below plain data. */
function md(text: string): ReactNode {
  return text.split("`").map((part, index) =>
    index % 2 === 1 ? <code key={index}>{part}</code> : part,
  );
}

type Row = readonly [name: string, kind: string, purpose: string];

interface Group {
  readonly id: string;
  readonly title: string;
  readonly guide: { readonly href: string; readonly label: string };
  readonly values: ReadonlyArray<Row>;
  readonly types: ReadonlyArray<string>;
}

const groups: ReadonlyArray<Group> = [
  {
    id: "agents",
    title: "Agents & assembly",
    guide: { href: "/foundry/docs/composition", label: "defineAgent & assembly" },
    values: [
      ["defineAgent", "function", "Define the agent in `agents/<route>/agent.ts` (the route is its id). Needs `description` and either `model` + `systemPrompt` or `run`/`spawn`. Every other field is a value or a resolver `(definition, ctx) => value`."],
      ["defineAgentFromModule", "function", "Normalize a module's default `defineAgent(...)` export, or its named convention exports (`description`, `model`, `tools`, …), into a definition for a route."],
      ["defineSubagent", "function", "Glove subagent with its own prompt, store and optional least-privilege tool projection from the parent. See Multi-agent."],
      ["defineCall", "function", "Typed in-run function with Zod `input`/`output`; also a model tool unless `exposeToAgent: false`. Called from code with `ctx.invoke`."],
      ["defineRoutes", "function", "Freeze a hand-written route → agent-module map for use as the client's type parameter (the generated `FoundryRoutes` type does this for you)."],
      ["isFoundryAgentDefinition", "function", "Type guard for values created by `defineAgent`."],
      ["isFoundryAgent", "function", "Alias of `isFoundryAgentDefinition`."],
    ],
    types: ["AnyFoundryAgent", "AgentAssemblyContext", "AgentAssemblyOptions", "AgentFactoryContext (deprecated)", "AgentHandlerContext", "AgentRuntimeControls", "DefineAgentOptions", "FoundryAgent", "FoundryAgentDefinition", "DefineFoundrySubagentOptions", "FoundrySubagentToolContext", "FoundryHookDefinition", "FoundryCall", "FoundryCallContext", "FoundryCallOptions", "FoundryExecutionContext", "FoundryResolver", "FoundryListResolver", "FoundryAgentConventionModule", "FoundryAgentMode", "FoundryRouteMap", "InferAgentInput", "InferAgentOutput"],
  },
  {
    id: "data",
    title: "Instances, conversations & data",
    guide: { href: "/foundry/docs/definitions-and-instances", label: "Definitions & instances" },
    values: [
      ["createAgentInstance", "function", "Instance record from a definition id string: `(definitionId, { id?, workspaceId?, name?, description?, context?, installations?, playbooks? })`. Defaults: id `agent_<uuid>`, workspace `\"default\"`. `name` and `description` are who the agent is to people and to its peers on the mesh."],
      ["defineAgentInstance", "function", "The same from an imported definition value — the code-authoring form for seeded instances."],
      ["reconstructAgentInstance", "function", "Rehydrate a persisted instance into Foundry's frozen runtime shape (for custom data adapters)."],
      ["createConversation", "function", "Conversation record for an instance: `(agent, { id?, title?, context?, workspaceId? })`. See Conversations."],
      ["MemoryFoundryDataAdapter", "class", "In-process `FoundryDataAdapter`; the default when the application sets no `data`. Private to each process and lost on restart. Seeds: `agents`, `conversations`, `subscriptions`, `activations`, `environment`."],
      ["FileFoundryDataAdapter", "class", "Durable single-host adapter: one JSON `file`, advisory lock between processes (`lockTimeoutMs` 10 000, `staleLockMs` 30 000), atomic rename. Same seeds; inserted only when absent."],
      ["toGloveMessage", "function", "Convert a `FoundryMessageInput` (string or content parts) into the native Glove user `Message`."],
      ["toGloveRequestInput", "function", "Clone a `FoundryMessageInput` into the mutable input `Glove.processRequest` accepts."],
    ],
    types: ["AgentInstance", "Conversation", "CreateAgentInstanceOptions", "UpdateAgentInstanceOptions", "CreateConversationOptions", "UpdateConversationOptions", "EnvironmentValue", "FoundryDataAdapter", "FoundryActivationRecord", "FoundryMessageInput", "InboundDeliveryClaim", "ProvisionAgentOptions", "FoundryRequest", "FoundryResult", "FoundrySuspension", "FoundryTask", "FoundryWorkingEnvironmentSnapshotOwner", "SharedInboxItem", "WorkspaceEntry", "FileFoundryDataAdapterOptions"],
  },
  {
    id: "capabilities",
    title: "Composition & capabilities",
    guide: { href: "/foundry/docs/capabilities", label: "Tools, MCP & memory" },
    values: [
      ["composeAgent", "function", "Merge colocated tools, apps, MCP servers, memory profiles, layers and subscribers into the definition's `components` catalogue. A catalogue only: tools, apps and MCP mount when an instance installs them."],
      ["EMPTY_AGENT_COMPOSITION", "const", "`composeAgent()` with nothing in it."],
      ["defineSharedTool", "function", "Installable tool (`*.tool.ts`), optionally with a config schema."],
      ["defineAgentApplication", "function", "Installable application (`*.app.ts`): `inbound`/`outbound` transmissions, `connections`, and an `install` Effect that contributes tools. Outbound transmissions become `glove_app_*_send` tools."],
      ["defineApp", "function", "Alias of `defineAgentApplication`."],
      ["defineMcp", "function", "Installable MCP server over HTTP or stdio (`*.mcp.ts`)."],
      ["defineMemory", "function", "Memory profile (`*.memory.ts`), mounted through the definition's `memory` field."],
      ["configureMemory", "function", "Select a memory profile with typed config: `configureMemory(profile, config)`."],
      ["install", "function", "Installation data for an instance: `install(definition, config?, { account? })` → `AgentInstallation` (`kind` is `tool`, `application` or `mcp`)."],
      ["installationKey", "function", "`\"<kind>:<id>\"` key used to de-duplicate installations (last write wins)."],
      ["defineLayer", "function", "Native surface (`*.layer.ts`) whose `setup` Effect mounts any Glove package on the assembled runnable."],
      ["configureLayer", "function", "Select a layer with typed config: `configureLayer(layer, config)`."],
      ["defineSubscriber", "function", "Subscriber surface (`*.subscriber.ts`) receiving the run's Glove events."],
      ["isFoundryCapability", "function", "True for shared tools, applications, MCP servers and memory profiles."],
      ["isFoundryLayer, isFoundrySubscriber", "function", "Brand guards."],
      ["isInboxCapableStore", "function", "True when a `StoreAdapter` implements `getInboxItems`, `addInboxItem`, `updateInboxItem`, `getResolvedInboxItems` (needed by `inboxes`)."],
      ["EMPTY_CAPABILITY_REGISTRY, EMPTY_NATIVE_REGISTRY", "const", "Empty catalogues."],
    ],
    types: ["FoundryAgentComponent", "FoundryAgentComposition", "FoundryCompositionSource", "FoundryToolBody", "AgentApplicationOptions", "AgentApplicationContribution", "AgentApplicationInstallContext", "AgentInstallContext", "AgentDefinitionSurfaceContext", "AgentInstallation", "AgentInstallationKind", "InstallationSelection", "FoundryInstallable", "FoundryCapabilityKind", "FoundryAgentApplication", "FoundryApp", "FoundryAccountSessionAdapter", "FoundryCapabilityRegistry", "FoundryCapabilityManifest", "FoundryCapabilityManifestEntry", "FoundryMcp", "FoundryMcpOptions", "FoundryResolvedMcp", "FoundryMemoryProfile", "FoundryMemoryReference", "DefinitionConfigInput", "FoundryMemorySelection", "FoundryMemoryProfileOptions", "FoundrySharedTool", "McpAdapterFactory", "SharedToolOptions", "FoundryLayer", "FoundryLayerOptions", "FoundryLayerReference", "FoundryLayerSelection", "FoundryNativeManifest", "FoundryNativeManifestEntry", "FoundryNativeRegistry", "FoundrySubscriber", "FoundrySubscriberOptions", "FoundrySubscriberSelection", "FoundrySurfaceContext"],
  },
  {
    id: "integrations",
    title: "Integrations: transmissions, apps, connections & topology",
    guide: { href: "/foundry/docs/applications", label: "Apps & transmissions" },
    values: [
      ["defineTransmission", "function", "Provider-neutral transport (`*.transmission.ts`) with inbound/outbound Effect schemas and adapters."],
      ["defineTransmissionEvent", "function", "Named inbound or outbound event of a transmission (`*.event.ts`)."],
      ["defineTransmissionPredicate", "function", "Parameterized match predicate for playbooks (`*.predicate.ts`)."],
      ["transmissionPredicate", "function", "Find a predicate on a transmission's inbound contract: `transmissionPredicate(transmission, id)`."],
      ["isFoundryTransmission", "function", "Brand guard."],
      ["serializeInboundTransmissionXml", "function", "Default XML rendering of an inbound event as the agent's user turn (used when the transmission has no `serialize`)."],
      ["defineConnection", "function", "Long-lived inbound connection (socket, poller) for an application (`*.connection.ts`); calls `receive` per event."],
      ["defineAccount", "function", "Typed account reference for a transmission: id and metadata, never credentials."],
      ["defineInboundRoute, defineOutboundRoute", "function", "Route records with typed per-transmission config."],
      ["defineBinding", "function", "Bind an instance, application, transmission, account, route and capabilities into an `AgentBinding`."],
      ["installedApplicationTransmissionToolName", "function", "Name of an installed app's generated outbound tool: `glove_app_<app>__<transmission>_send`."],
      ["createInstalledApplicationTransmissionTools", "function", "Build those generated tools for an assembly context (the runtime does this)."],
      ["compileApplicationManifest", "function", "Compile transmissions into a credential-free manifest (Effect; fails with `ManifestCompilationError`)."],
      ["FoundryApplicationManifest, FoundryManifestCapability, FoundryManifestTransmission", "Effect Schema", "Manifest schemas (also exported as types)."],
      ["GrantResolver", "Context tag", "Effect service that resolves bindings into one run's `RunGrant`."],
      ["grantResolverLive", "Layer", "Default `GrantResolver`."],
      ["AccountDirectory, TopologyStore, EventStore", "Context tag", "Effect services for account metadata, routes/bindings and event payloads; replace them with the application's `services` layer."],
      ["memoryAccountDirectory", "function", "In-memory `AccountDirectory` layer from a list of accounts."],
      ["memoryTopologyStore, memoryEventStore", "Layer", "In-memory defaults."],
    ],
    types: ["AccountContract", "AnyFoundryTransmission", "CapabilityDefinition", "EgressAdapter", "EgressContext", "FoundryTransmission", "FoundryTransmissionEvent", "InboundContract", "FoundryTransmissionPredicate", "InferAccountMetadata", "InferInboundEvent", "InferInboundConfig", "InferOutboundConfig", "InferOutboundInput", "InferOutboundOutput", "IngressAdapter", "IngressContext", "OutboundContract", "TransmissionOptions", "TransmissionEventDirection", "TransmissionEventOptions", "TransmissionPredicateOptions", "TransmissionSerializationContext", "DefineAccountOptions", "DefineBindingOptions", "DefineInboundRouteOptions", "DefineOutboundRouteOptions", "ApplicationConnectionContext", "ApplicationConnectionState", "ApplicationConnectionStatus", "ConnectionReceiveInput", "DefineConnectionOptions", "FoundryApplicationConnection", "ResolveGrantRequest", "AccountFilter", "AccountSessionAdapter", "AccountSessionRequest", "BindingFilter", "RouteFilter"],
  },
  {
    id: "playbooks",
    title: "Playbooks & subscriptions",
    guide: { href: "/foundry/docs/automation", label: "Playbooks, schedules & sleep" },
    values: [
      ["composePlaybook", "function", "Runtime playbook (match, directives, outbound routes) composed from imported transmission primitives; returned from the definition's `playbooks` field."],
      ["definePlaybookAction", "function", "Named action a playbook directive references (`*.action.ts`)."],
      ["reconstructPlaybook", "function", "Rehydrate a stored playbook into the frozen runtime shape."],
      ["definePlaybookSubscription", "function", "Durable subscription evaluated even when no instance exists (`*.subscription.ts`); provisions targets by policy: `singleton`, `per-thread`, `per-event`, `existing`, `custom`."],
      ["reconstructPlaybookSubscription", "function", "Rehydrate a stored subscription."],
    ],
    types: ["AgentPlaybookInput", "ComposedAgentPlaybook", "ComposedAgentPlaybookInput", "PlaybookMatchInput", "PlaybookOutboundInput", "AgentPlaybook", "FoundryPlaybookAction", "PlaybookActionOptions", "PlaybookDirective", "PlaybookDirectiveInput", "PlaybookMatch", "PlaybookOutboundDirective", "AgentProvisioningPolicy", "CustomProvisionedAgent", "CustomProvisioningContext", "DefinePlaybookSubscriptionOptions", "FoundryInstanceProvisioner", "PlaybookSubscription", "PlaybookSubscriptionTarget", "PlaybookSubscriptionTargetInput"],
  },
  {
    id: "schedules",
    title: "Schedules & built-in tools",
    guide: { href: "/foundry/docs/automation", label: "Playbooks, schedules & sleep" },
    values: [
      ["defineSchedule", "function", "Agent-local schedule `{ name, message, timing, payload?, enabled?, description? }` returned from the `schedules` field. `timing`: `at`, `after`, `every` or `cron` (timezone default `UTC`)."],
      ["isFoundrySchedule", "function", "Brand guard."],
      ["createFoundryCoreTools", "function", "Build the built-in `glove_foundry_*` tools for an assembly context. The runtime mounts them on every run."],
      ["FOUNDRY_CORE_COMMAND_EVENT", "const", "`\"foundry.core.command\"` — the event type that carries tool-issued commands to the runtime."],
    ],
    types: ["DefineFoundryScheduleOptions", "FoundryScheduleDefinition", "FoundryScheduleTiming", "FoundryScheduleTimingInput", "FoundryCoreCommand"],
  },
  {
    id: "mesh",
    title: "Mesh",
    guide: { href: "/foundry/docs/multi-agent#mesh", label: "Multi-agent: the mesh" },
    values: [
      ["meshIdentity", "function", "How an instance appears to its peers on the mesh: `{ id, name, description, metadata: { definitionId } }`, from the instance's `name` and `description` (the id when there is no name)."],
    ],
    types: ["FoundryMeshOptions", "FoundryMeshThread", "FoundryMeshThreadStatus", "FoundryMeshMessage", "FoundryMeshParty"],
  },
  {
    id: "workbench",
    title: "Working environment & REPL",
    guide: { href: "/foundry/docs/working-environments", label: "Working environments" },
    values: [
      ["defineWorkingEnvironment", "function", "Sandboxed persistent VFS plus named scripts for the `workingEnvironment` field."],
      ["defineRepl", "function", "One native JavaScript, Python or Lisp REPL for the `repl` field, with optional programmatic tool calling (`programmaticTools`, `maxCalls` default 50, max 1000)."],
      ["foundryDataEnvironmentPersistence", "function", "VFS persistence through the data adapter's private snapshot methods: `foundryDataEnvironmentPersistence({ scope: \"agent\" | \"conversation\" | \"workspace\" })` (default `agent`; `workspace` is one tree shared by every agent in the workspace)."],
    ],
    types: ["DefineFoundryReplOptions", "DefineFoundryWorkingEnvironmentOptions", "FoundryJavaScriptReplDefinition", "FoundryLispReplDefinition", "FoundryMountedRepl", "FoundryProgrammaticToolContext", "FoundryProgrammaticToolSelection", "FoundryProgrammaticTools", "FoundryPythonReplDefinition", "FoundryReplDefinition", "FoundryVfs", "FoundryVfsHandle", "FoundryWorkingEnvironmentCreateContext", "FoundryWorkingEnvironmentDefinition", "FoundryWorkingEnvironmentPersistenceAdapter", "FoundryWorkingEnvironmentPersistenceContext"],
  },
  {
    id: "guidance",
    title: "Guidance",
    guide: { href: "/foundry/docs/guidance", label: "Goals, facts & forms" },
    values: [
      ["defineGoals, defineFacts, defineForms", "function", "Freeze options for the definition's `goals`, `facts` and `forms` fields. Pure values; no runtime state."],
      ["foundryGuidanceSubject", "function", "Stable subject key for guidance state: `foundryGuidanceSubject(ctx, \"conversation\" | \"instance\")` (default `conversation`)."],
    ],
    types: ["FoundryFactsOptions", "FoundryGoalsOptions", "FoundryFormsOptions", "FoundryGuidanceHandles", "FoundryGuidanceScope"],
  },
  {
    id: "runtime",
    title: "Runtime, server & client",
    guide: { href: "/foundry/docs/runtime", label: "Client & HTTP API" },
    values: [
      ["defineApplication", "function", "Default export of `foundry.application.ts`: `name` plus optional `data`, `conversationStore`, `accounts`, `routes`, `bindings`, `requestAuthorization`, `provisioner`, `services`, `daemon`."],
      ["isFoundryApplication", "function", "Brand guard."],
      ["EMPTY_FOUNDRY_APPLICATION", "const", "`defineApplication({ name: \"Glove Foundry\" })`, used when there is no application file."],
      ["FoundryRuntime", "class", "The control process: `FoundryRuntime.discover({ rootDir, agentsDir, application?, applicationFilePath?, config? })`, then `start()` / `stop()`. Owns data, activations, approvals, mesh threads and the execution daemon; every HTTP endpoint calls one of its methods. `listThreads({ agentId?, conversationId?, to?, status? })` lists mesh threads by who started them, the conversation that started them, the recipient or status."],
      ["FoundryRuntimeError", "tagged error class", "Error of the runtime's Effect APIs (`operation`, `message`)."],
      ["FoundryServer", "class", "HTTP server for the inspector, `/api`, `/v1` and `/health`: `new FoundryServer(runtime, { host?, port?, branding?, messageBodyBytes? })`, `listen()` → `{ host, port, url }`, `close()`."],
      ["createFoundryClient", "function", "Typed HTTP client; also exported by `glove-foundry/client`. Options: `baseUrl` (default `http://127.0.0.1:4141`), `fetch`, `authorization`."],
      ["FoundryClient", "class", "The client class (see the method list below)."],
      ["FoundryRunHandle", "class", "Returned by `send` and `agent(route).request`: `id`, `initial`, `get()`, `wait({ pollMs: 150, timeoutMs: 60_000 })`, `cancel()`, `steer(message)`, `events()`."],
      ["discoverAgents", "function", "Import every agent file under `agentsDir` and return `DiscoveredAgent[]` (`{ agentsDir, strictFileRoutes?, cacheBust? }`)."],
      ["findAgentFiles", "function", "List agent files under a directory: `agent.*`, `<route>/agent.*`, `<route>.agent.*` (`.ts`, `.tsx`, `.mts`, `.js`, `.mjs`)."],
      ["routeFromAgentFile", "function", "Route for an agent file path, or `null`. A root `agent.ts` is the route `default`."],
      ["createManifest", "function", "Build the `FoundryManifest` (per-agent tools, calls, schedules, lazy fields …)."],
      ["writeGeneratedTypes", "function", "Write `.foundry/routes.d.ts` (the `FoundryRoutes` type) and `.foundry/manifest.json`. The CLI runs it on every start."],
    ],
    types: ["FoundryApplication", "FoundryApplicationOptions", "FoundryRequestAuthorizationAdapter", "FoundryRequestAuthorizationInput", "FoundryRuntimeOptions", "FoundryRun", "FoundrySteerResult", "FoundryConversationTranscript", "FoundryServerOptions", "FoundryClientOptions", "FoundryClientAuthorizationAdapter", "FoundryHealth", "FoundrySteerHandleResult", "WaitOptions", "DiscoveredAgent", "FoundryManifest", "FoundryManifestAgent"],
  },
  {
    id: "approvals",
    title: "Approvals",
    guide: { href: "/foundry/docs/approvals", label: "Approvals & steering" },
    values: [
      ["FoundryApprovalDisplayManager", "class", "Default display manager inside agent runs; turns a permission prompt into an expiring approval record and waits for the decision."],
      ["withFoundryPermissions", "function", "Wrap a store that lacks `getPermission`/`setPermission` with a per-run, exact-input permission overlay."],
      ["createFoundryApproval, listFoundryApprovals, resolveFoundryApproval", "function", "File-directory approval records shared by job processes and the control process. Hosts use `client.approvals()` and `client.resolveApproval(id, \"approve\" | \"deny\")` instead."],
    ],
    types: ["FoundryApproval", "FoundryApprovalDecision", "FoundryApprovalStatus"],
  },
  {
    id: "observability",
    title: "Observability",
    guide: { href: "/foundry/docs/observability", label: "Inspector & WebChat" },
    values: [
      ["MemoryObservabilityAdapter", "class", "Default in-memory event log (`maxEvents`, default 10 000 via config). Supply your own `FoundryObservabilityAdapter` as `FoundryRuntimeOptions.observability`."],
    ],
    types: ["EventFilter", "FoundryEvent", "FoundryEventCategory", "FoundryObservabilityAdapter"],
  },
  {
    id: "config",
    title: "Config",
    guide: { href: "/foundry/docs/project-structure", label: "Project structure" },
    values: [
      ["defineConfig", "function", "Type-checked `foundry.config.ts`; unknown keys are type errors. Also exported by `glove-foundry/config`. Keys below."],
    ],
    types: ["FoundryConfig", "FoundryExecutionConfig", "FoundryBrandingConfig"],
  },
  {
    id: "domain",
    title: "Domain schemas & errors",
    guide: { href: "/foundry/docs/applications", label: "Apps & transmissions" },
    values: [
      ["AccountId, AgentDefinitionId, AgentId, BindingId, CapabilityId, EventId, RouteId, RunId, TransmissionId", "Effect Schema", "Branded id schemas (each name is also its type)."],
      ["AccountReference, AccountSummary, AgentBinding, InboundRoute, OutboundRoute, Route, ReplyPolicy, RunGrant, EventReference", "Effect Schema", "Topology and grant records (each name is also its type)."],
      ["AccountNotFound, AccountSessionUnavailable, BindingNotFound, EventNotFound, GrantResolutionError, RouteNotFound, TopologyConflict", "tagged error class", "Domain errors; `FoundryDomainError` is their union."],
      ["ManifestCompilationError", "tagged error class", "Raised by `compileApplicationManifest`."],
    ],
    types: ["FoundryDomainError"],
  },
  {
    id: "internal",
    title: "Advanced & internal",
    guide: { href: "/foundry/docs/composition", label: "defineAgent & assembly" },
    values: [
      ["FOUNDRY_AGENT_DEFINITION_BRAND, FOUNDRY_AGENT_BRAND (deprecated alias), FOUNDRY_SHARED_TOOL_BRAND, FOUNDRY_AGENT_APPLICATION_BRAND, FOUNDRY_MCP_BRAND, FOUNDRY_MEMORY_BRAND, FOUNDRY_LAYER_BRAND, FOUNDRY_SUBSCRIBER_BRAND, FOUNDRY_SCHEDULE_BRAND, FOUNDRY_TRANSMISSION_BRAND, FOUNDRY_TRANSMISSION_EVENT_BRAND, FOUNDRY_TRANSMISSION_PREDICATE_BRAND, FOUNDRY_CONNECTION_BRAND, FOUNDRY_PLAYBOOK_ACTION_BRAND, FOUNDRY_COMPOSED_PLAYBOOK_BRAND, FOUNDRY_APPLICATION_BRAND, FOUNDRY_WORKING_ENVIRONMENT_BRAND, FOUNDRY_REPL_BRAND", "symbol", "`Symbol.for(...)` brands the `define*` helpers stamp on their results; the `is*` guards read them."],
      ["FOUNDRY_APPLICATION_ENV, FOUNDRY_AGENT_ROUTE_ENV, FOUNDRY_AGENT_FILE_ENV, FOUNDRY_APPROVAL_DIRECTORY_ENV", "const", "Names of the internal environment variables listed below."],
      ["FOUNDRY_EVENT_PREFIX, FOUNDRY_EXECUTION_MARKER", "const", "`\"__GLOVE_FOUNDRY_EVENT__\"` (prefix of event lines a job writes to stdout) and `\"__glove_foundry_execution_v1\"` (marks a run's input envelope)."],
      ["internalAgentName, routeFromInternalAgentName", "function", "Route ↔ execution name: `support/triage` ↔ `foundry_support__triage`."],
      ["installRegistry, mountAgentDefinitionMemory, mountFoundrySurfaces", "function", "The mount steps assembly runs for installations, memory, and layers/subscribers. Use them only when hosting definitions outside the runtime."],
    ],
    types: [],
  },
];

const coreTools: ReadonlyArray<Row> = [
  ["glove_foundry_spawn", "{ message, definitionId?, agentId?, conversationId?, payload? }", "Queue a run now. Omitted `agentId`/`conversationId` create new ones. Returns a command id only."],
  ["glove_foundry_schedule", "{ message, timing, definitionId?, agentId?, conversationId?, payload? }", "Create a future or recurring activation. `timing`: `{ kind: \"at\", at }`, `{ kind: \"after\", duration }`, `{ kind: \"every\", interval }`, `{ kind: \"cron\", expression, timezone }`."],
  ["glove_foundry_schedules", "{ action: \"list\" | \"update\" | \"pause\" | \"resume\" | \"cancel\", … }", "Manage this instance's schedules; `list` takes `status` (`active` default, `paused`, `completed`, `cancelled`, `all`)."],
  ["glove_foundry_sleep", "{ kind: \"until\", at } | { kind: \"for\", duration }, message?", "Suspend, then wake the same instance and conversation. Default message: \"Continue the suspended work.\""],
  ["glove_foundry_background", "{ message, definitionId?, payload?, reconvene? }", "Queue a run on the same instance and conversation; `reconvene` (default `true`) posts a `background.reconvene` shared inbox item."],
  ["glove_foundry_transmit", "{ routeId, payload }", "Deliver through an outbound route authorized for this run."],
  ["glove_foundry_conversations", "{}", "List this instance's conversations."],
  ["glove_foundry_workspace", "{ action: \"get\" | \"set\" | \"list\", key?, value? }", "Read or write workspace entries."],
  ["glove_foundry_shared_inbox", "{ action: \"list\" | \"post\" | \"update\", … }", "List, post (`topic`, `payload`, `agentId?`, `conversationId?`) or set `status`."],
  ["glove_foundry_tasks", "{ action: \"list\" | \"create\" | \"update\", … }", "List, create (`title`, `detail?`) or set `status`."],
  ["glove_foundry_environment", "{}", "List non-secret environment values for this workspace, instance and conversation."],
  ["glove_mesh_list_agents", "{ name? }", "Only with `mesh`. The agents this one can message: id, name and description from each instance."],
  ["glove_mesh_send_message", "{ to, content, in_reply_to?, blocking? }", "Only with `mesh`. Message an agent by instance id. A new message starts a thread; the recipient's final reply, or a question it sends, comes back as a `<mesh-message>` message. `in_reply_to` answers a message in a thread. `blocking` waits up to `waitMs` in the run, then the run suspends until the reply arrives."],
  ["glove_mesh_broadcast", "{ content }", "Only with `mesh`. Start a thread with every agent this one can message."],
  ["glove_mesh_acknowledge", "{ message_id, note? }", "Only with `mesh`. Tell an agent its message arrived without answering yet; it reaches only a run that is waiting."],
  ["glove_app_<app>__<transmission>_send", "{ routeId, payload }", "Generated per outbound transmission of each installed application."],
];

const clientMethods: ReadonlyArray<readonly [string, string]> = [
  ["health()", "GET /health"],
  ["agent(route).create(options) · createAgent(definitionId, options) · agentInstances(definitionId?)", "POST · GET /api/agent-instances"],
  ["agent(route).request(request)", "POST /api/agents/:route/runs"],
  ["configureAgent(agentId, { name?, description?, context?, installations?, playbooks? }) · setAgentPlaybooks(agentId, playbooks)", "PATCH /api/agent-instances/:id · PUT …/:id/playbooks"],
  ["installations(agentId) · install(agentId, installation) · uninstall(agentId, installation)", "GET · PUT · DELETE /api/installations"],
  ["createConversation · conversations · updateConversation · conversationTranscript", "/api/conversations[/:id[/messages]]"],
  ["send(agentId, conversationId, message, { payload?, context? })", "POST /api/conversations/:id/messages"],
  ["getRun · runs(route?) · cancelRun · steerRun · getEvents(filter?)", "/api/runs/:id · /api/runs · …/cancel · …/steer · /api/events"],
  ["approvals(filter?) · resolveApproval(id, decision)", "GET /api/approvals · POST /api/approvals/:id"],
  ["workspaceEntries · putWorkspaceEntry · sharedInbox · postSharedInbox · updateSharedInbox · tasks · createTask · updateTask · dataEnvironment", "/api/workspaces/:ws/{entries,inbox,tasks,environment}"],
  ["dispatchInbound(input) · dispatchOutbound(input)", "POST /api/transmissions/:routeId/{fire,deliver}"],
  ["playbookSubscriptions · putPlaybookSubscription · deletePlaybookSubscription · activations", "/api/playbook-subscriptions · /api/activations"],
  ["applicationConnections() · reconnectApplicationConnection(id)", "/api/application-connections[/:id/reconnect]"],
  ["manifest() · capabilities(definitionId) · surfaces(definitionId)", "GET /api/manifest · /api/capabilities · /api/surfaces"],
  ["accounts · routes · putRoute · removeRoute · bindings · putBinding · removeBinding · resolveGrant", "/api/accounts · /api/routes · /api/bindings · /api/grants/resolve"],
];

const configKeys: ReadonlyArray<readonly [string, string, string]> = [
  ["agentsDir", "\"agents\"", "Where agent folders live (`\"foundry/agents\"` in the Next.js target)."],
  ["applicationFile", "\"foundry.application.ts\"", "Infrastructure file; optional."],
  ["server.host", "\"127.0.0.1\"", "Non-loopback hosts require `requestAuthorization`."],
  ["server.port", "4141", "`--port` overrides it."],
  ["server.messageBodyBytes", "1048576 (1 MB)", "JSON limit for message-bearing endpoints; 1 MB to 128 MB."],
  ["execution.maxConcurrent", "5", "Runs executing at once."],
  ["execution.maxAttempts", "1", "Attempts per run."],
  ["execution.retryBackoffMs", "1000", "Delay between attempts."],
  ["execution.pollIntervalMs", "100", "Queue poll interval."],
  ["execution.idlePollIntervalMs", "1000", "Deprecated; not forwarded to the Station 3 daemon."],
  ["observability.maxEvents", "10000", "Events kept by the in-memory log."],
  ["branding.name / label / descriptor / accent", "\"Glove Foundry\" / — / \"Inspector\" / —", "Inspector shell; `accent` is a six-digit hex colour."],
  ["strictFileRoutes", "true", "Reject an agent module whose deprecated `id` export differs from its file route."],
];

const envVars: ReadonlyArray<readonly [string, string]> = [
  [".env, .env.local", "Loaded from the project root by `glove foundry dev` / `start` (`.env` first). A variable that is already set is never overwritten."],
  ["GLOVE_FOUNDRY_APPLICATION_FILE", "Set by the runtime for the execution daemon and job processes: absolute path of `foundry.application.ts`, which each process imports. Unset when there is no application file."],
  ["GLOVE_FOUNDRY_APPROVAL_DIRECTORY", "Set by the runtime: private directory for approval records."],
  ["GLOVE_FOUNDRY_CORE_COMMAND_DIRECTORY", "Set by the runtime: private directory for tool → runtime command requests (transmit calls)."],
  ["GLOVE_FOUNDRY_AGENT_ROUTE, GLOVE_FOUNDRY_AGENT_FILE", "Read only by the legacy `execution-agent` entrypoint; the daemon passes agent identity explicitly."],
  ["STATION_SIGNAL_RUN_ID", "Set by Station in each job process; becomes `ctx.runId` (\"unknown\" if absent)."],
  ["npm_config_user_agent", "Read by `init` to detect the package manager when there is no lockfile."],
  ["NODE_OPTIONS, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_INSERT_LIBRARIES", "Removed from the environment of the execution daemon."],
  ["FOUNDRY_URL", "Not read by Foundry. The generated Next.js `lib/foundry.ts` uses it as the client `baseUrl`."],
];

export default function ReferencePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Reference / API reference</span>
      <h1>API reference</h1>
      <p className="blog-lede">
        Every value exported by <code>glove-foundry</code> 0.5.1 and its subpaths, grouped
        by purpose, with the built-in agent tools, client methods, CLI, config keys and
        environment variables. Each group links to the handbook page that explains it.
      </p>

      <h2 id="entrypoints">Entry points</h2>
      <table>
        <thead><tr><th>Import</th><th>Exports</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>glove-foundry</code></td><td>Everything on this page except the rows marked otherwise</td><td>ESM only. Node 22 or newer.</td></tr>
          <tr><td><code>glove-foundry/client</code></td><td><code>createFoundryClient</code>, <code>FoundryClient</code>, <code>FoundryRunHandle</code>; types <code>FoundryClientOptions</code>, <code>FoundryClientAuthorizationAdapter</code>, <code>FoundryHealth</code>, <code>FoundrySteerHandleResult</code>, <code>WaitOptions</code></td><td>No runtime imports: safe in browsers, route handlers and voice hosts.</td></tr>
          <tr><td><code>glove-foundry/config</code></td><td><code>defineConfig</code>, <code>DEFAULT_FOUNDRY_CONFIG</code>; types <code>FoundryConfig</code>, <code>FoundryExecutionConfig</code>, <code>FoundryBrandingConfig</code></td><td><code>DEFAULT_FOUNDRY_CONFIG</code> is only exported here.</td></tr>
          <tr><td><code>glove-foundry/station</code></td><td><code>stationDaemon</code>; types <code>FoundryStationDaemonOptions</code>, <code>FoundryStationDaemonAdapter</code>, <code>FoundryStationConnection</code>, <code>FoundryStationResources</code></td><td>Only exported here.</td></tr>
          <tr><td><code>glove-foundry/voice</code></td><td><code>voiceCall</code>, <code>webSocketRoom</code>, <code>announceMeshMessage</code>, <code>VOICE_EXCLUDED_FOUNDRY_TOOLS</code>; types <code>VoiceCallOptions</code>, <code>VoiceCallResult</code>, <code>FoundryVoiceRoom</code>, <code>FoundryVoiceCall</code>, <code>WebSocketRoomOptions</code>, <code>VoiceRoomClientMessage</code>, <code>VoiceRoomServerMessage</code></td><td>Only exported here. See <Link href="/foundry/docs/voice">Voice agents</Link>.</td></tr>
          <tr><td><code>glove-foundry/eslint</code></td><td><code>foundryEslintConfig</code> (also the default export), <code>foundryEslintPlugin</code></td><td>Requires <code>eslint</code> 9+ (optional peer dependency).</td></tr>
          <tr><td>bin <code>glove</code>, <code>glove-foundry</code></td><td>The CLI</td><td>See <a href="#cli">CLI</a>.</td></tr>
        </tbody>
      </table>

      {groups.map((group) => (
        <section key={group.id}>
          <h2 id={group.id}>{group.title}</h2>
          <p>
            Guide: <Link href={group.guide.href}>{group.guide.label}</Link>
          </p>
          <table>
            <thead><tr><th>Export</th><th>Kind</th><th>Purpose</th></tr></thead>
            <tbody>
              {group.values.map(([name, kind, purpose]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td>{kind}</td>
                  <td>{md(purpose)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {group.types.length > 0 ? (
            <p>
              <strong>Types:</strong>{" "}
              {group.types.map((name, index) => (
                <span key={name}>
                  {index > 0 ? ", " : null}
                  <code>{name}</code>
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ))}

      <h2 id="station">Station (<code>glove-foundry/station</code>)</h2>
      <p>
        Guide: <Link href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox agent</Link>
      </p>
      <table>
        <thead><tr><th>Export</th><th>Kind</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr>
            <td><code>stationDaemon</code></td>
            <td>function</td>
            <td>
              Configure the managed execution daemon for <code>defineApplication({"{ daemon }"})</code>:{" "}
              <code>stationId</code> (required, <code>[a-zA-Z0-9_-]</code>, 1–128 chars),{" "}
              <code>name?</code>, <code>port?</code> (omitted: a free loopback port),{" "}
              <code>resources?()</code> → <code>{"{ browser?, sandbox? }"}</code>,{" "}
              <code>onReady?(connection)</code> with <code>{"{ url, stationId, token }"}</code>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="voice">Voice (<code>glove-foundry/voice</code>)</h2>
      <table>
        <thead><tr><th>Export</th><th>Kind</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>voiceCall</code></td><td>function</td><td>Returns a <code>run</code> that hosts a live call over the assembled agent: <code>{"{ room, greeting?, idleMs?, maxDurationMs?, openDelayMs?, transcript?, realtime?, announce?, offCall? }"}</code>. The agent&apos;s model must be <code>s2sDrivenModel(...)</code>, or pass <code>realtime.adapter</code>.</td></tr>
          <tr><td><code>webSocketRoom</code></td><td>function</td><td>A room served by the run on its own port: <code>{"{ port, token, host?, path?, sampleRate?, agentName?, model? }"}</code>. PCM16 both ways plus JSON captions and state.</td></tr>
          <tr><td><code>announceMeshMessage</code></td><td>function</td><td>The default wording for a mesh message (a reply, a failure or a question from another agent) put to the model mid-call.</td></tr>
          <tr><td><code>VOICE_EXCLUDED_FOUNDRY_TOOLS</code></td><td>const</td><td>Foundry tools kept off every call. Tools with <code>requiresPermission</code> are kept off too.</td></tr>
        </tbody>
      </table>

      <h2 id="eslint">ESLint (<code>glove-foundry/eslint</code>)</h2>
      <p>
        Guide: <Link href="/foundry/docs/project-structure">Project structure</Link>.{" "}
        <code>foundryEslintConfig</code> is a flat-config object named{" "}
        <code>glove-foundry/recommended</code> for <code>**/*.{"{ts,tsx,mts,js,mjs}"}</code>{" "}
        that enables three rules as errors.
      </p>
      <CodeBlock filename="eslint.config.js" language="typescript" code={`import tseslint from "typescript-eslint";
import foundry from "glove-foundry/eslint";

export default [
  { ignores: [".foundry/**"] },
  ...tseslint.configs.recommended,
  foundry,
];`} />
      <table>
        <thead><tr><th>Rule</th><th>Reports</th></tr></thead>
        <tbody>
          <tr><td><code>glove-foundry/no-agent-contracts</code></td><td><code>input</code>/<code>output</code> passed to <code>defineAgent</code> or exported from an agent module.</td></tr>
          <tr><td><code>glove-foundry/no-file-definition-id</code></td><td>An <code>id</code> passed to a file-routed helper (<code>defineAgent</code>, <code>defineSharedTool</code>, <code>defineApp</code>, <code>defineMcp</code>, <code>defineMemory</code>, <code>defineLayer</code>, <code>defineSubscriber</code>, <code>defineTransmission*</code>, <code>defineConnection</code>, <code>definePlaybookAction</code>, <code>definePlaybookSubscription</code>, …).</td></tr>
          <tr><td><code>glove-foundry/no-raw-definition-references</code></td><td>String ids where an imported definition is expected: <code>transmissionId</code>, <code>applicationId</code>, <code>routeId</code>, <code>routeIds</code>, literal <code>event</code>/<code>action</code> and <code>applicationAccountId</code> in <code>composePlaybook</code>; <code>accountId</code> in <code>install</code> config.</td></tr>
        </tbody>
      </table>

      <h2 id="core-tools">Built-in agent tools</h2>
      <p>
        Mounted on every assembled run; no installation needed. Guides:{" "}
        <Link href="/foundry/docs/automation">Automation</Link>,{" "}
        <Link href="/foundry/docs/conversations#agent-tools">Conversations</Link>,{" "}
        <Link href="/foundry/docs/multi-agent#spawn">Multi-agent</Link>. Definitions with{" "}
        <code>subagents</code> also get Glove&apos;s <code>glove_invoke_subagent</code>;
        <code>mesh</code> adds the four <code>glove_mesh_*</code> tools at the end of the
        table (unless its <code>mount</code> leaves them out of a run); calls with{" "}
        <code>exposeToAgent</code> appear under their own names.
      </p>
      <table>
        <thead><tr><th>Tool</th><th>Input</th><th>Effect</th></tr></thead>
        <tbody>
          {coreTools.map(([name, input, effect]) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td><code>{input}</code></td>
              <td>{md(effect)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="client">Client methods</h2>
      <p>
        <code>FoundryClient</code> methods and the native endpoints they call. Every
        method throws the server&apos;s <code>error</code> message on a non-2xx response.
        Full detail: <Link href="/foundry/docs/runtime">Client &amp; HTTP API</Link>.
      </p>
      <table>
        <thead><tr><th>Methods</th><th>Endpoint</th></tr></thead>
        <tbody>
          {clientMethods.map(([methods, endpoint]) => (
            <tr key={methods}>
              <td><code>{methods}</code></td>
              <td><code>{endpoint}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Endpoints without a client method: <code>GET /health/detailed</code>,{" "}
        <code>GET /api/agents</code>, <code>GET /api/transmissions</code>,{" "}
        <code>GET /api/runs/:id/events</code>, and the OpenAI-compatible and automation
        routes <code>GET /v1/models</code>, <code>POST /v1/chat/completions</code>,{" "}
        <code>POST /v1/responses</code>, <code>GET /v1/capabilities</code>,{" "}
        <code>POST /v1/runs</code>, <code>GET /v1/runs/:id</code>,{" "}
        <code>GET /v1/runs/:id/events</code>, <code>POST /v1/runs/:id/stop</code>,{" "}
        <code>POST /v1/runs/:id/steer</code>, <code>GET /v1/approvals</code>,{" "}
        <code>POST /v1/approvals/:id</code> (see{" "}
        <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>). Any other{" "}
        <code>GET</code> outside <code>/api</code>, <code>/v1</code> and{" "}
        <code>/health</code> serves the inspector.
      </p>

      <h2 id="cli">CLI</h2>
      <p>
        Both bins run the same program; <code>glove foundry &lt;command&gt;</code> and{" "}
        <code>glove-foundry &lt;command&gt;</code> are equivalent. Guide:{" "}
        <Link href="/foundry/docs/getting-started">Install &amp; CLI</Link>.
      </p>
      <table>
        <thead><tr><th>Command</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>glove foundry init [directory]</code></td><td>Create a project (interactive in a terminal). <code>glove foundry my-app</code> is the same. Non-interactive default directory: <code>glove-foundry-app</code>.</td></tr>
          <tr><td><code>glove foundry dev</code></td><td>Run the runtime and inspector, restarting on changes to the agents directory, <code>.env</code>, <code>.env.local</code>, <code>foundry.application.*</code>, <code>foundry.config.*</code> and root <code>tools/</code>, <code>applications/</code>, <code>mcp/</code>, <code>memory/</code>, <code>inboxes/</code>.</td></tr>
          <tr><td><code>glove foundry start</code></td><td>Run without file watching.</td></tr>
          <tr><td><code>glove foundry help</code></td><td>Print usage (also <code>--help</code>, <code>-h</code>).</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>Flag</th><th>Applies to</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>--template travel-concierge|minimal</code></td><td>init</td><td>Default <code>travel-concierge</code>.</td></tr>
          <tr><td><code>--target standalone|nextjs</code></td><td>init</td><td>Detected: a directory holding a Next.js app gets <code>nextjs</code>.</td></tr>
          <tr><td><code>--package-manager pnpm|npm|yarn|bun</code></td><td>init</td><td>Detected from lockfiles.</td></tr>
          <tr><td><code>--yes</code>, <code>--no-interactive</code></td><td>init</td><td>Accept defaults without prompts; installs only with <code>--install</code>.</td></tr>
          <tr><td><code>--interactive</code></td><td>init</td><td>Require a terminal; cannot combine with <code>--yes</code>.</td></tr>
          <tr><td><code>--install</code> / <code>--no-install</code></td><td>init</td><td>Install dependencies now, or print the command.</td></tr>
          <tr><td><code>--root &lt;dir&gt;</code></td><td>dev, start</td><td>Project root (default: current directory).</td></tr>
          <tr><td><code>--port &lt;n&gt;</code>, <code>--host &lt;addr&gt;</code></td><td>dev, start</td><td>Override <code>server.port</code> / <code>server.host</code>.</td></tr>
          <tr><td><code>--no-watch</code></td><td>dev</td><td>Disable hot restart.</td></tr>
        </tbody>
      </table>
      <p>
        On every start the CLI loads <code>foundry.config.{"{ts,mts,js,mjs}"}</code> (default
        export), loads the application file if present, discovers agents and writes{" "}
        <code>.foundry/routes.d.ts</code> and <code>.foundry/manifest.json</code>.
      </p>

      <h2 id="config-keys"><code>defineConfig</code> keys</h2>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4141 },
  execution: { maxConcurrent: 10, maxAttempts: 2 },
  branding: { name: "Acme Support", accent: "#0f766e" },
});`} />
      <table>
        <thead><tr><th>Key</th><th>Default</th><th>Notes</th></tr></thead>
        <tbody>
          {configKeys.map(([key, value, notes]) => (
            <tr key={key}>
              <td><code>{key}</code></td>
              <td><code>{value}</code></td>
              <td>{md(notes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="environment">Environment variables</h2>
      <p>
        Foundry itself reads very little from the environment. Model and provider keys
        are read by your own code and adapters, never by Foundry.
      </p>
      <table>
        <thead><tr><th>Variable</th><th>Meaning</th></tr></thead>
        <tbody>
          {envVars.map(([name, meaning]) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td>{md(meaning)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
