import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Tools, MCP & memory",
  description:
    "Always-on tools, installable shared tools, apps and MCP servers with typed config, memory profiles, layers, subscribers and typed calls.",
};

const mcpEntryFields: { name: string; meaning: string }[] = [
  { name: "name, description", meaning: "Required. Shown to glove-mcp's discovery subagent." },
  { name: "url", meaning: "HTTP endpoint (short form). Use either url or transport." },
  { name: "transport", meaning: "{ kind: \"http\", url } or { kind: \"stdio\", command, args?, cwd? }" },
  { name: "includeTools", meaning: "Exact server tool names or globs. A non-empty list is an allowlist." },
  { name: "excludeTools", meaning: "Exact names or globs to hide, un-namespaced (\"delete_repo\", not \"kb__delete_repo\")." },
  { name: "resources, prompts", meaning: "Mount list/read resource and list/get prompt utility tools. Both default to true." },
  { name: "connectTimeoutMs", meaning: "Bound on connect/initialize. Default 30 s." },
  { name: "requestTimeoutMs", meaning: "Bound on every MCP operation. Default 60 s." },
  { name: "idleTimeoutMs, maxLifetimeMs", meaning: "Stdio only: close an idle child / recycle after a lifetime; reopened on demand. 0 disables." },
  { name: "tags, metadata", meaning: "Optional discovery tags and arbitrary metadata." },
];

export default function CapabilitiesPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Build agents / Tools, MCP &amp; memory</span>
      <h1>Tools, MCP and memory</h1>
      <p className="blog-lede">
        Foundry has three ways to give an agent abilities, and they differ in who decides:
        the definition decides for every instance, an instance installs from a typed
        catalogue, or the definition selects a native Glove surface such as memory.
        Picking the right tier is what lets one agent definition serve many customers
        with different integrations.
      </p>

      <h2 id="decision">Which tier?</h2>
      <table>
        <thead><tr><th>You want</th><th>Use</th><th>Mounted when</th><th>Configured by</th></tr></thead>
        <tbody>
          <tr><td>A tool every instance has</td><td><code>tools</code> field</td><td>Every run (a resolver can filter per message)</td><td>Code</td></tr>
          <tr><td>A tool only some instances have, with per-instance settings</td><td><code>defineSharedTool</code> + <code>install</code></td><td>The instance has an installation for it</td><td>Installation <code>config</code> (zod)</td></tr>
          <tr><td>A bundle of tools and inbound/outbound transports</td><td><code>defineApp</code> + <code>install</code></td><td>Installed</td><td>Installation config and account</td></tr>
          <tr><td>An external MCP server</td><td><code>defineMcp</code> + <code>install</code> + <code>mcpAdapter</code></td><td>Installed</td><td><code>entry</code> / config; auth in the adapter</td></tr>
          <tr><td>Memory (context, entities, episodes, resources)</td><td><code>defineMemory</code> + <code>memory</code> field</td><td>The definition selects it</td><td><code>configureMemory</code></td></tr>
          <tr><td>Raw access to the Glove agent each run</td><td><code>defineLayer</code> + <code>layers</code> field</td><td>Selected</td><td><code>configureLayer</code></td></tr>
          <tr><td>Observe model and tool events</td><td><code>defineSubscriber</code> + <code>subscribers</code></td><td>Selected</td><td>Code</td></tr>
          <tr><td>A typed function the model or your <code>run</code> can call</td><td><code>defineCall</code> + <code>calls</code></td><td>Listed</td><td>Code</td></tr>
          <tr><td>Hooks, skills, subagents</td><td><code>hooks</code>, <code>skills</code>, <code>subagents</code></td><td>Listed</td><td>Code</td></tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        <code>composeAgent(...)</code> in <code>components</code> is only a catalogue.
        Shared tools, apps and MCP servers listed there are <strong>not mounted</strong>{" "}
        until an instance installs them. Memory profiles, layers and Foundry subscribers
        must be in the catalogue <em>and</em> selected in the <code>memory</code>,{" "}
        <code>layers</code> or <code>subscribers</code> field; a selection missing from the
        catalogue fails the run with &ldquo;unknown memory profile/layer/subscriber&rdquo;.
      </p></div>

      <h2 id="always-on">Always-on tools</h2>
      <p>
        The <code>tools</code> field takes plain Glove <code>GloveFoldArgs</code> objects (
        <code>name</code>, <code>description</code>, <code>inputSchema</code> or{" "}
        <code>jsonSchema</code>, <code>do</code>, optional <code>requiresPermission</code>).
        Use a literal array for a fixed set or a resolver to vary it per message; the{" "}
        <Link href="/foundry/docs/composition#message-dependent">assembly page</Link> has a
        full example. Every instance gets these tools; nothing has to be installed.
      </p>

      <h2 id="installable">Installable capabilities</h2>
      <p>
        Installables are colocated files, one default export each. The file name is the
        id: <code>agents/support/tools/lookup-order.tool.ts</code> is the shared tool{" "}
        <code>lookup-order</code>.
      </p>

      <h3 id="shared-tools">defineSharedTool</h3>
      <p>
        Give either a static <code>tool</code>, or <code>create(ctx)</code> returning an{" "}
        <code>Effect</code> of a tool, built per run from the installation&apos;s decoded config.
      </p>
      <CodeBlock filename="agents/support/tools/lookup-order.tool.ts" language="typescript" code={`import { Effect } from "effect";
import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

const lookupOrder = defineSharedTool({
  description: "Look up an order in a regional order system",
  config: z.object({
    region: z.enum(["us", "eu"]),
    includeHistory: z.boolean().default(false),
  }),
  create: ({ config, agentId }) =>
    Effect.succeed({
      name: "lookup_order",
      description: \`Look up an order in the \${config.region.toUpperCase()} order system\`,
      inputSchema: z.object({ orderId: z.string() }),
      async do({ orderId }) {
        // your code: call the order API for config.region
        return { status: "success" as const, data: { orderId, region: config.region, agentId } };
      },
    }),
});

export default lookupOrder;`} />
      <p>
        <code>create</code> receives the run&apos;s identity and message fields, the Glove agent,
        the store, <code>installation</code> and typed <code>config</code>. When the installation
        selected an account it also gets <code>accountId</code>, plus{" "}
        <code>withAccountSession</code> if the agent defines <code>accountSessions</code>. A{" "}
        <code>*.tool.ts</code> may instead default-export a bare tool body (no{" "}
        <code>name</code>); <code>composeAgent</code> wraps it and names the tool from the file (
        <code>lookup-order</code> → <code>lookup_order</code>).
      </p>

      <h3 id="apps">defineApp</h3>
      <p>
        An app is an installable bundle. Its <code>install</code> callback may contribute tools,
        its outbound transmissions become tools, and its inbound transmissions become available
        to the instance&apos;s playbooks. The install context deliberately has no Glove agent or store.
      </p>
      <CodeBlock filename="agents/support/apps/helpdesk.app.ts" language="typescript" code={`import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";

const helpdesk = defineApp({
  description: "Read and update tickets in one helpdesk queue",
  config: z.object({ queue: z.string(), retries: z.number().default(2) }),
  // inbound: [tickets], outbound: [tickets] — see Apps & transmissions
  install: ({ config }) =>
    Effect.succeed({
      tools: [{
        name: "helpdesk_queue",
        description: "Return the helpdesk queue this agent works",
        inputSchema: z.object({}),
        async do() {
          return { status: "success" as const, data: { queue: config.queue, retries: config.retries } };
        },
      }],
    }),
});

export default helpdesk;`} />
      <p>
        Transmissions, accounts, routes and connections are covered in{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>

      <h3 id="mcp">defineMcp</h3>
      <p>
        An MCP definition is a catalogue entry for one server, over HTTP or a local stdio
        process. Its tools appear as <code>&lt;mcp id&gt;__&lt;server tool&gt;</code>, for
        example <code>docs-search__search_pages</code>.
      </p>
      <CodeBlock filename="agents/support/mcp/docs-search.mcp.ts" language="typescript" code={`import { defineMcp } from "glove-foundry";

const docsSearch = defineMcp({
  description: "Search the public product documentation",
  entry: {
    name: "Docs search",
    description: "Search and read product documentation pages",
    url: "https://mcp.example.com/docs",
    includeTools: ["search_*", "read_page"],
    prompts: false,
    requestTimeoutMs: 30_000,
  },
});

export default docsSearch;`} />
      <CodeBlock filename="agents/support/mcp/kb.mcp.ts" language="typescript" code={`import { defineMcp } from "glove-foundry";

const kb = defineMcp({
  description: "Internal knowledge base over stdio",
  entry: {
    name: "Knowledge base",
    description: "Read internal support articles",
    transport: { kind: "stdio", command: "/opt/mcp/kb-server", args: ["--stdio"] },
    excludeTools: ["delete_*", "write_*"],
    connectTimeoutMs: 15_000,
    idleTimeoutMs: 15 * 60_000,
    maxLifetimeMs: 24 * 60 * 60_000,
  },
});

export default kb;`} />
      <p>
        <code>entry</code> can also be a function of the installation&apos;s typed config, so each
        instance can point at a different server:
      </p>
      <CodeBlock filename="agents/support/mcp/tracker.mcp.ts" language="typescript" code={`import { defineMcp } from "glove-foundry";
import { z } from "zod";

const tracker = defineMcp({
  description: "Issue tracker scoped to one project",
  config: z.object({ project: z.string() }),
  entry: ({ config }) => ({
    name: "Issue tracker",
    description: \`Issues for project \${config.project}\`,
    url: \`https://tracker.example.com/mcp?project=\${encodeURIComponent(config.project)}\`,
  }),
});

export default tracker;`} />
      <table>
        <thead><tr><th>entry field</th><th>Meaning</th></tr></thead>
        <tbody>
          {mcpEntryFields.map((row) => (
            <tr key={row.name}><td><code>{row.name}</code></td><td>{row.meaning}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        Do not put an <code>id</code> in <code>entry</code>; Foundry uses the file id.
        Credentials never belong in <code>entry</code> or installation config. They come from
        the agent&apos;s <code>mcpAdapter</code>, which Foundry calls once per run that has MCP
        installations. <strong>An instance that installs an MCP definition fails to assemble if
        the agent has no <code>mcpAdapter</code>.</strong>
      </p>
      <CodeBlock filename="agents/support/agent.ts (excerpt)" language="typescript" code={`import { Effect } from "effect";
import { defineAgent } from "glove-foundry";

export default defineAgent({
  // ...description, components, model, systemPrompt
  mcpAdapter: ({ agentId, resolved }) =>
    Effect.succeed({
      identifier: \`support:\${agentId}\`,
      getActive: async () => resolved.map((item) => item.definition.id),
      activate: async () => {},
      deactivate: async () => {},
      // HTTP: headers (or getAccessToken for a bearer token), resolved per connection
      getAuthHeaders: async (id: string): Promise<Record<string, string>> =>
        id === "docs-search" ? { authorization: \`Bearer \${process.env.DOCS_MCP_TOKEN ?? ""}\` } : {},
      // stdio: environment for the child process, resolved at every (re)spawn
      getStdioEnvironment: async (id: string): Promise<Record<string, string>> =>
        id === "kb" ? { KB_TOKEN: process.env.KB_TOKEN ?? "" } : {},
    }),
});`} />
      <ul>
        <li>The factory receives the run context plus <code>installed</code> (MCP definitions) and <code>resolved</code> (<code>{"{ definition, installation, config, entry }"}</code> per installed server).</li>
        <li>Foundry overrides <code>getActive</code> with the installed ids, so every installed server is connected at assembly. Glove-mcp&apos;s discovery subagent is also registered.</li>
        <li>Connecting fails open: a server that cannot be reached is skipped and the run continues without its tools.</li>
        <li><code>getAuthHeaders</code> takes precedence over <code>getAccessToken</code>. Foundry never acquires or refreshes tokens; your adapter does. See <Link href="/docs/mcp">glove-mcp</Link>.</li>
      </ul>

      <h3 id="catalogue">Put them in the catalogue</h3>
      <CodeBlock filename="agents/support/composition.ts" language="typescript" code={`import { composeAgent } from "glove-foundry";
import helpdesk from "./apps/helpdesk.app.js";
import tenantContext from "./layers/tenant.layer.js";
import docsSearch from "./mcp/docs-search.mcp.js";
import kb from "./mcp/kb.mcp.js";
import tracker from "./mcp/tracker.mcp.js";
import customerMemory from "./memory/customer.memory.js";
import audit from "./subscribers/audit.subscriber.js";
import lookupOrder from "./tools/lookup-order.tool.js";

export const components = composeAgent(
  lookupOrder, helpdesk, docsSearch, kb, tracker, // installable per instance
  customerMemory, tenantContext, audit,           // selected by the definition
);`} />
      <p>Then <code>components</code> goes on the definition: <code>defineAgent({"{ components, ... }"})</code>.</p>

      <h3 id="installing">Installing on an instance</h3>
      <p>
        <code>install(definition, config?, {"{ account? }"})</code> produces an{" "}
        <code>AgentInstallation</code> record: <code>{"{ kind: \"tool\" | \"application\" | \"mcp\", id, config?, accountId? }"}</code>.
        Install at creation in code:
      </p>
      <CodeBlock filename="agents/support/instances.ts" language="typescript" code={`import { defineAgentInstance, install } from "glove-foundry";
import support from "./agent.js";
import helpdesk from "./apps/helpdesk.app.js";
import docsSearch from "./mcp/docs-search.mcp.js";
import tracker from "./mcp/tracker.mcp.js";
import lookupOrder from "./tools/lookup-order.tool.js";

export const acmeSupport = defineAgentInstance(support, {
  id: "support-acme",
  workspaceId: "acme",
  context: { tenant: "Acme", canRefund: true },
  installations: [
    install(lookupOrder, { region: "eu" }), // includeHistory defaults to false
    install(helpdesk, { queue: "billing" }),
    install(docsSearch),                    // no config schema, no config
    install(tracker, { project: "SUP" }),
  ],
});`} />
      <p>
        Register the instance with your data adapter (see{" "}
        <Link href="/foundry/docs/definitions-and-instances#seeding">seeding instances</Link>).
        At runtime, from a client or over HTTP, use plain records with string ids:
      </p>
      <CodeBlock filename="scripts/provision.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

const agent = await foundry.agent("support").create({
  workspaceId: "globex",
  installations: [{ kind: "application", id: "helpdesk", config: { queue: "sales" } }],
});
await foundry.install(agent.id, { kind: "tool", id: "lookup-order", config: { region: "us" } });
await foundry.uninstall(agent.id, { kind: "application", id: "helpdesk" });
console.log(await foundry.installations(agent.id));`} />
      <CodeBlock filename="HTTP" language="http" code={`PUT /api/installations
content-type: application/json

{ "agentId": "support-acme", "kind": "mcp", "id": "tracker", "config": { "project": "OPS" } }

DELETE /api/installations
content-type: application/json

{ "agentId": "support-acme", "kind": "mcp", "id": "tracker" }

GET /api/installations?agent=support-acme`} />
      <ul>
        <li>Install checks that <code>kind</code> + <code>id</code> exist in <em>that definition&apos;s</em> <code>components</code>; otherwise it fails with &ldquo;Unknown Foundry tool capability&rdquo;.</li>
        <li>Config is decoded against the zod schema when a run assembles, not at install time. Invalid persisted config fails the next run (&ldquo;Invalid config for tool …&rdquo;).</li>
        <li>One installation per <code>kind</code> + <code>id</code>: installing again replaces the earlier config.</li>
        <li>Installation changes apply from the next run. Uninstalling an app that one of the instance&apos;s playbooks needs is rejected.</li>
        <li>Select an account with <code>install(def, config, {"{ account }"})</code> in code or an <code>accountId</code> in <code>PATCH /api/agent-instances/:id</code> installations. <code>PUT /api/installations</code> ignores <code>accountId</code>, and config may not contain an <code>accountId</code> key.</li>
        <li>The inspector shows a definition&apos;s catalogue and an instance&apos;s installations, read-only. Install through code, the client or HTTP.</li>
      </ul>

      <h3 id="typed-config">Typed config</h3>
      <p>
        The zod schema on a definition types <code>install</code>&apos;s second argument
        (zod <em>input</em>, so defaulted fields are optional) and the <code>config</code> your{" "}
        <code>create</code>/<code>install</code>/<code>entry</code> receives (zod <em>output</em>):
      </p>
      <CodeBlock filename="agents/support/instances.ts" language="typescript" code={`install(helpdesk, { queue: "billing" });           // ok: retries defaults to 2
// @ts-expect-error queue must be a string
install(helpdesk, { queue: 42 });
// @ts-expect-error lookupOrder declares a config schema, so config is required
install(lookupOrder);
// @ts-expect-error docsSearch has no config schema
install(docsSearch, { anything: true });`} />

      <h2 id="definition-surfaces">Definition surfaces: memory, layers, subscribers</h2>
      <p>
        These are not installations. The definition selects them, optionally per message, and
        they mount for every run that selects them.
      </p>

      <h3 id="memory">defineMemory</h3>
      <CodeBlock filename="agents/support/memory/customer.memory.ts" language="typescript" code={`import { Effect } from "effect";
import { defineMemory } from "glove-foundry";
import { MemorySchema } from "glove-memory/core";
import { InMemoryContextAdapter, InMemoryEntityAdapter } from "glove-memory/in-memory";

const schema = new MemorySchema();

const customerMemory = defineMemory({
  description: "What we know about customers and this conversation",
  context: {
    adapter: ({ agentId }) =>
      Effect.succeed(new InMemoryContextAdapter({ schema, identifier: \`support-context:\${agentId}\` })),
  },
  entity: {
    access: "curator", // read + write tools; "reader" (default) is read-only
    adapter: () => Effect.succeed(new InMemoryEntityAdapter({ schema })),
  },
});

export default customerMemory;`} />
      <table>
        <thead><tr><th>Key</th><th>Adapter returned by <code>adapter(ctx)</code></th><th>Mounts</th></tr></thead>
        <tbody>
          <tr><td><code>context</code></td><td><code>ContextAdapter</code></td><td>Ambient context on the main agent (<code>useContext</code>)</td></tr>
          <tr><td><code>entity</code></td><td><code>EntityMemoryAdapter</code></td><td>Entity reader or curator tools</td></tr>
          <tr><td><code>episodic</code></td><td><code>EpisodicMemoryAdapter</code></td><td>Episodic reader or curator tools</td></tr>
          <tr><td><code>resources</code></td><td><code>ResourceFsAdapter</code></td><td>Resource reader or curator tools</td></tr>
          <tr><td><code>mount</code></td><td>(function returning <code>Effect&lt;void&gt;</code>)</td><td>Anything else, with the Glove agent in hand</td></tr>
        </tbody>
      </table>
      <p>
        At least one key is required. <code>entity</code>, <code>episodic</code> and{" "}
        <code>resources</code> accept <code>access</code> and a <code>tools</code> option;{" "}
        <code>context</code> accepts <code>tools</code>. Each adapter factory gets the run
        context, the Glove agent, the store and the profile&apos;s decoded <code>config</code>.
        With a <code>config</code> schema, select it with{" "}
        <code>configureMemory(profile, config)</code> (typed at the call site; the factory sees{" "}
        <code>config</code> as <code>unknown</code>). In-memory adapters are recreated in every
        run&apos;s process; use durable adapters from <Link href="/docs/memory">glove-memory</Link>{" "}
        for anything that must persist.
      </p>

      <h3 id="layers">defineLayer and configureLayer</h3>
      <p>
        A layer&apos;s <code>setup</code> receives the native Glove agent as <code>glove</code>{" "}
        plus the run context and typed <code>config</code>, returns an <code>Effect</code>, and
        may return a cleanup function.
      </p>
      <CodeBlock filename="agents/support/layers/tenant.layer.ts" language="typescript" code={`import { Effect } from "effect";
import { defineLayer } from "glove-foundry";
import { z } from "zod";

const tenantContext = defineLayer({
  description: "Pin the tenant name into every model iteration",
  config: z.object({ tenant: z.string() }),
  setup: ({ glove, config }) =>
    Effect.sync(() => {
      const remove = glove.addContextProvider(() => \`Tenant: \${config.tenant}\`);
      return remove; // cleanup when the run ends
    }),
});

export default tenantContext;`} />

      <h3 id="subscribers">defineSubscriber</h3>
      <CodeBlock filename="agents/support/subscribers/audit.subscriber.ts" language="typescript" code={`import { defineSubscriber } from "glove-foundry";

const audit = defineSubscriber({
  description: "Record every tool result as a custom run event",
  create: ({ emit }) => ({
    async record(type) {
      if (type === "tool_use_result") emit({ type: "support.audit.tool-result" });
    },
  }),
});

export default audit;`} />

      <h3 id="selecting">Selecting them on the definition</h3>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { configureLayer, defineAgent } from "glove-foundry";
import { components } from "./composition.js";
import tenantContext from "./layers/tenant.layer.js";
import customerMemory from "./memory/customer.memory.js";
import audit from "./subscribers/audit.subscriber.js";

export default defineAgent({
  description: "Answers customer questions about orders",
  components,
  store: ({ conversationId }) => new MemoryStore(\`support:\${conversationId}\`),
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: (_agent, { installations }) =>
    \`You are a support agent. Installed: \${installations.map((i) => \`\${i.kind}:\${i.id}\`).join(", ") || "nothing"}.\`,

  memory: [customerMemory],
  layers: (_agent, { agentInstance }) => [
    configureLayer(tenantContext, { tenant: String(agentInstance.context.tenant ?? "default") }),
  ],
  subscribers: [
    audit,
    // a plain Glove SubscriberAdapter needs no catalogue entry
    { async record(type) { if (type === "model_response_complete") console.log("model turn done"); } },
  ],
});`} />
      <p>
        <code>hooks</code>, <code>skills</code> and <code>subagents</code> are also plain
        definition fields taking Glove&apos;s <code>{"{ name, handler }"}</code> hooks,{" "}
        <code>DefineSkillArgs</code> and <code>DefineSubAgentArgs</code> (build subagents with{" "}
        <code>defineSubagent</code>; see <Link href="/foundry/docs/multi-agent">Multi-agent</Link>).
      </p>

      <h2 id="calls">Typed calls</h2>
      <p>
        <code>defineCall</code> declares a function with zod input and output. By default the
        model sees it as a tool named after the call; with <code>exposeToAgent: false</code> it
        is only reachable from code through <code>ctx.invoke</code>.
      </p>
      <CodeBlock filename="agents/support/agent.ts (excerpt)" language="typescript" code={`import { defineAgent, defineCall } from "glove-foundry";
import { z } from "zod";

export default defineAgent({
  // ...description, components, model, systemPrompt
  calls: [
    defineCall({
      name: "escalate",
      description: "Escalate the conversation to a human with a reason",
      input: z.object({ reason: z.string().min(5) }),
      output: z.object({ ticketId: z.string() }),
      handler: ({ reason }, ctx) => ({ ticketId: \`esc-\${ctx.conversationId}-\${reason.length}\` }),
    }),
    defineCall({
      name: "audit_note",
      description: "Internal: record an audit note",
      input: z.object({ note: z.string() }),
      output: z.object({ ok: z.literal(true) }),
      exposeToAgent: false,
      handler: () => ({ ok: true as const }),
    }),
  ],
  run: async (_agent, ctx) => {
    await ctx.invoke("audit_note", { note: \`run \${ctx.runId}\` });
    return ctx.defaultRun();
  },
});`} />
      <ul>
        <li>Names must match <code>/^[A-Za-z][A-Za-z0-9_-]*$/</code> and be unique per run.</li>
        <li><code>invoke</code> parses the input and the handler&apos;s output with the schemas; a failure throws (or, as a tool, returns an error result to the model).</li>
        <li>Handlers receive the execution context, including <code>invoke</code>, so calls can compose.</li>
        <li>Calls are run-local: there is no HTTP endpoint for them. Other agents reach an agent through its runs, mesh or subagents (see <Link href="/foundry/docs/multi-agent">Multi-agent</Link>).</li>
      </ul>

      <h2 id="inspect">Seeing what is available and installed</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Client</th><th>Returns</th></tr></thead>
        <tbody>
          <tr><td><code>GET /api/capabilities?definition=support</code></td><td><code>capabilities(&quot;support&quot;)</code></td><td><code>{"{ tools, applications, mcp, memory }"}</code>, each entry <code>{"{ id, kind, description, ownership }"}</code>; ownership is <code>instance</code> for installables, <code>definition</code> for memory</td></tr>
          <tr><td><code>GET /api/surfaces?definition=support</code></td><td><code>surfaces(&quot;support&quot;)</code></td><td><code>{"{ layers, subscribers }"}</code> in the catalogue</td></tr>
          <tr><td><code>GET /api/installations?agent=&lt;id&gt;</code></td><td><code>installations(id)</code></td><td>The instance&apos;s installation records</td></tr>
          <tr><td><code>GET /api/manifest</code></td><td><code>manifest()</code></td><td>All of the above per definition, plus static tool, call and memory names and the list of lazy fields</td></tr>
        </tbody>
      </table>
      <p>
        In the <Link href="/foundry/docs/observability">inspector</Link>, an agent definition
        page shows the <em>Capability catalogue</em> and <em>Native composition</em> cards, and
        an instance page shows <em>Installed capabilities</em>. Run traces record{" "}
        <code>foundry.installation.completed</code>, <code>foundry.definition.memory.mounted</code>,{" "}
        <code>foundry.layer.mounted</code> and <code>foundry.subscriber.mounted</code> events for
        every run.
      </p>
    </article>
  );
}
