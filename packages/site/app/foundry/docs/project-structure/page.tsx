import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { AssemblyDiagram } from "@/components/diagrams";

export const metadata = {
  title: "Project structure & conventions",
  description:
    "Every file Foundry discovers, imports or generates: agent folders, convention suffixes, id rules, application and config files, route types and ESLint.",
};

export default function FoundryProjectStructurePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / Project structure</span>
      <h1>Project structure &amp; conventions</h1>
      <p className="blog-lede">
        In Foundry the filesystem is the registry for code: a file’s path is its id, and code
        refers to other definitions by importing them. Runtime records — instances,
        conversations, installations, schedules — live in a data adapter, not in files. This
        page lists every file Foundry reads, recognizes or generates.
      </p>

      <h2 id="standalone">Standalone layout</h2>
      <p>
        <code>npx glove-foundry init my-app</code> creates a project that owns its own{" "}
        <code>package.json</code>. Grown to use every convention, it looks like this:
      </p>
      <CodeBlock filename="my-app/" language="text" code={`agents/
  support/
    agent.ts                              definition "support"            (discovered)
    composition.ts                        composeAgent(...) catalogue     (plain module)
    tools/lookup-order.tool.ts            tool "lookup-order"             (discovered)
    apps/helpdesk.app.ts                  application "helpdesk"          (discovered)
    transmissions/tickets.transmission.ts transmission "tickets"          (discovered)
    events/ticket-created.event.ts        event "ticket-created"          (discovered)
    predicates/is-urgent.predicate.ts     predicate "is-urgent"           (discovered)
    actions/resolve.action.ts             playbook action "resolve"       (discovered)
    connections/ticket-feed.connection.ts connection "ticket-feed"        (discovered)
    subscriptions/urgent.subscription.ts  playbook subscription "urgent"  (discovered)
    mcp/knowledge.mcp.ts                  MCP server "knowledge"          (discovered)
    memory/customer.memory.ts             memory profile "customer"       (discovered)
    layers/request-context.layer.ts       layer "request-context"         (discovered)
    subscribers/audit.subscriber.ts       subscriber "audit"              (discovered)
    schedules/follow-up.ts                defineSchedule value            (plain module)
    topology.ts                           accounts and routes             (plain module)
lib/                                      your helpers (stores, clients, models)
src/client.ts                             scripts that call the runtime
foundry.application.ts                    runtime infrastructure: data, stores, auth
foundry.config.ts                         runtime process settings
.foundry/routes.d.ts                      generated route types (commit it)
.foundry/manifest.json                    generated manifest (git-ignored)
.env.example  .env.local                  environment; .env.local is git-ignored
eslint.config.js  tsconfig.json  package.json`} />
      <p>
        The generated <code>package.json</code> is <code>&quot;type&quot;: &quot;module&quot;</code>,
        requires Node <code>&gt;=22</code>, and has four scripts: <code>dev</code> (
        <code>glove foundry dev</code>), <code>start</code> (<code>glove foundry start</code>),{" "}
        <code>lint</code> (<code>eslint .</code>) and <code>typecheck</code> (
        <code>tsc --noEmit</code>). Its <code>tsconfig.json</code> includes <code>agents</code>,{" "}
        <code>lib</code>, <code>src</code>, both root config files and{" "}
        <code>.foundry/routes.d.ts</code>. The <code>minimal</code> template starts with one agent
        (<code>agents/assistant/</code>) and one tool; <code>travel-concierge</code> has one
        example of each convention.
      </p>

      <h2 id="nextjs">Next.js layout</h2>
      <p>
        <code>npx glove foundry init .</code> inside a Next.js app (detected from{" "}
        <code>next.config.*</code> or a <code>next</code> dependency, or forced with{" "}
        <code>--target nextjs</code>) joins the app instead of taking it over. Existing files are
        never overwritten.
      </p>
      <table>
        <thead><tr><th>Path</th><th>What it is</th></tr></thead>
        <tbody>
          <tr><td><code>foundry/agents/**</code></td><td>The agents, same conventions as above</td></tr>
          <tr><td><code>foundry/foundry.application.ts</code></td><td>Data adapter, accounts, routes</td></tr>
          <tr><td><code>foundry/package.json</code></td><td><code>{"{"} &quot;type&quot;: &quot;module&quot; {"}"}</code> scoped to the agent tree, so the app keeps its own module system</td></tr>
          <tr><td><code>foundry.config.mts</code></td><td>Sets <code>agentsDir: &quot;foundry/agents&quot;</code> and <code>applicationFile: &quot;foundry/foundry.application.ts&quot;</code></td></tr>
          <tr><td><code>lib/foundry.ts</code></td><td><code>createFoundryClient&lt;FoundryRoutes&gt;</code> with <code>baseUrl: process.env.FOUNDRY_URL ?? &quot;http://127.0.0.1:4141&quot;</code></td></tr>
          <tr><td><code>app/api/&lt;agent&gt;/route.ts</code></td><td>Example <code>POST</code> handler: create instance, conversation, send, <code>run.wait()</code></td></tr>
          <tr><td><code>foundry/README.md</code>, <code>foundry.env.example</code></td><td>Guide and environment template</td></tr>
          <tr><td><code>package.json</code></td><td>Gains <code>foundry:dev</code>, <code>foundry:start</code> and the Glove dependencies; nothing else changes</td></tr>
        </tbody>
      </table>
      <p>
        No <code>tsconfig.json</code> or ESLint config is generated for this target; the app’s own
        apply. The runtime is a separate process (<code>pnpm foundry:dev</code> next to{" "}
        <code>pnpm dev</code>) and the app reaches it over HTTP. See{" "}
        <Link href="/foundry/docs/nextjs">Next.js integration</Link>.
      </p>

      <h2 id="conventions">File conventions</h2>
      <p>
        <strong>Agents.</strong> Foundry scans <code>agentsDir</code> (default{" "}
        <code>agents</code>) for <code>.ts</code>, <code>.tsx</code>, <code>.mts</code>,{" "}
        <code>.js</code> and <code>.mjs</code> files (not <code>.d.ts</code>):
      </p>
      <table>
        <thead><tr><th>File</th><th>Agent id</th></tr></thead>
        <tbody>
          <tr><td><code>agents/support/agent.ts</code></td><td><code>support</code></td></tr>
          <tr><td><code>agents/teams/billing/agent.ts</code></td><td><code>teams/billing</code></td></tr>
          <tr><td><code>agents/support.agent.ts</code></td><td><code>support</code> (single-file form; prefer a folder)</td></tr>
          <tr><td><code>agents/agent.ts</code></td><td><code>default</code></td></tr>
        </tbody>
      </table>
      <p>
        An agent file default-exports <code>defineAgent(...)</code>. Two files resolving to the
        same id fail discovery with <code>Duplicate Foundry agent id</code>.
      </p>
      <p>
        <strong>Agent-local definitions.</strong> For each agent file, Foundry recursively scans
        the folder that contains it and binds every file whose name (before the extension) ends
        in one of these suffixes. Each must default-export one definition of the matching kind.
      </p>
      <table>
        <thead><tr><th>Suffix</th><th>Default export</th><th>How it is used</th></tr></thead>
        <tbody>
          <tr><td><code>*.tool.ts</code></td><td><code>defineSharedTool(...)</code>, or a bare Glove tool body</td><td>Catalogue → installed per instance</td></tr>
          <tr><td><code>*.app.ts</code></td><td><code>defineApp(...)</code> (alias of <code>defineAgentApplication</code>)</td><td>Catalogue → installed per instance</td></tr>
          <tr><td><code>*.mcp.ts</code></td><td><code>defineMcp(...)</code></td><td>Catalogue → installed per instance</td></tr>
          <tr><td><code>*.memory.ts</code></td><td><code>defineMemory(...)</code></td><td>Catalogue + <code>memory</code> field</td></tr>
          <tr><td><code>*.layer.ts</code></td><td><code>defineLayer(...)</code></td><td>Catalogue + <code>layers</code> field</td></tr>
          <tr><td><code>*.subscriber.ts</code></td><td><code>defineSubscriber(...)</code></td><td>Catalogue + <code>subscribers</code> field</td></tr>
          <tr><td><code>*.transmission.ts</code></td><td><code>defineTransmission(...)</code></td><td>Imported by apps and playbooks</td></tr>
          <tr><td><code>*.event.ts</code></td><td><code>defineTransmissionEvent(...)</code></td><td>Imported by transmissions and playbooks</td></tr>
          <tr><td><code>*.predicate.ts</code></td><td><code>defineTransmissionPredicate(...)</code></td><td>Imported by transmissions and playbooks</td></tr>
          <tr><td><code>*.action.ts</code></td><td><code>definePlaybookAction(...)</code></td><td>Imported by <code>composePlaybook</code> directives</td></tr>
          <tr><td><code>*.connection.ts</code></td><td><code>defineConnection(...)</code></td><td>Imported by an app’s <code>connections</code></td></tr>
          <tr><td><code>*.subscription.ts</code></td><td><code>definePlaybookSubscription(...)</code></td><td>Background playbook policy</td></tr>
        </tbody>
      </table>
      <p>
        <strong>Not conventions.</strong> These are ordinary modules you import; Foundry never
        looks for them: <code>composition.ts</code>, schedules (<code>defineSchedule</code> values
        go in the <code>schedules</code> field — there is no <code>.schedule.ts</code> suffix),
        instances (<code>defineAgentInstance</code>), topology records (
        <code>defineAccount</code>, <code>defineInboundRoute</code>,{" "}
        <code>defineOutboundRoute</code>, <code>defineBinding</code>), working environments and
        REPLs, inbox loaders, typed calls and subagents. Root-level <code>tools/</code>,{" "}
        <code>applications/</code>, <code>mcp/</code> or <code>memory/</code> folders are not
        discovered: capabilities are agent-local.
      </p>

      <h3 id="ids">How paths become ids</h3>
      <p>
        A local definition’s id is its path relative to the agent’s folder, minus the extension
        and suffix. If the first folder is one of the conventional names (
        <code>tools</code>, <code>apps</code>, <code>mcp</code>, <code>memory</code>,{" "}
        <code>layers</code>, <code>subscribers</code>, <code>transmissions</code>,{" "}
        <code>events</code>, <code>predicates</code>, <code>actions</code>,{" "}
        <code>connections</code>, <code>subscriptions</code>, <code>playbooks</code>), it is
        dropped. Deeper folders stay.
      </p>
      <table>
        <thead><tr><th>File (under <code>agents/support/</code>)</th><th>Id</th></tr></thead>
        <tbody>
          <tr><td><code>tools/lookup-order.tool.ts</code></td><td><code>lookup-order</code></td></tr>
          <tr><td><code>tools/calendar/today.tool.ts</code></td><td><code>calendar/today</code></td></tr>
          <tr><td><code>lookup-order.tool.ts</code></td><td><code>lookup-order</code></td></tr>
          <tr><td><code>billing/refund.tool.ts</code></td><td><code>billing/refund</code></td></tr>
          <tr><td><code>apps/helpdesk/search.tool.ts</code></td><td><code>helpdesk/search</code></td></tr>
        </tbody>
      </table>
      <p>
        The id is what installations reference (<code>{"{"} kind: &quot;tool&quot;, id:
        &quot;calendar/today&quot; {"}"}</code>). The name the <em>model</em> sees is the tool’s{" "}
        <code>name</code>. A bare tool body (an object with <code>description</code>,{" "}
        <code>inputSchema</code> and <code>do</code>, but no <code>name</code>) gets its name
        from the id: <code>/</code> becomes <code>__</code> and <code>-</code> becomes{" "}
        <code>_</code>, so <code>calendar/today</code> is the tool{" "}
        <code>calendar__today</code>.
      </p>
      <CodeBlock filename="agents/support/tools/calendar/today.tool.ts" language="typescript" code={`import { z } from "zod";

// No defineSharedTool, no name: Foundry names it "calendar__today" from the path.
export default {
  description: "Return today's date in ISO format",
  inputSchema: z.object({}),
  async do() {
    return { status: "success" as const, data: new Date().toISOString().slice(0, 10) };
  },
};`} />

      <h3 id="id-rules">Id rules</h3>
      <ul>
        <li>
          Ids are lowercase path segments of letters, digits and hyphens, starting with a letter,
          separated by <code>/</code> (<code>^[a-z][a-z0-9-]*(/[a-z][a-z0-9-]*)*$</code>). Name
          files in kebab-case: <code>lookupOrder.tool.ts</code> produces the id{" "}
          <code>lookupOrder</code>, and any run of an instance that installs it fails with{" "}
          <code>Invalid Foundry tool id</code>.
        </li>
        <li>Agent ids are validated at discovery; an invalid folder name stops startup.</li>
        <li>
          Do not pass <code>id</code> to file-routed helpers. The option still exists for
          programmatic definitions, but a mismatch with the file route throws, and the ESLint
          preset rejects it.
        </li>
        <li>
          A definition that is not default-exported from a convention file inside an agent folder
          is never bound. Using it fails with <code>Foundry tool identity has not been bound
          yet</code> (or the matching kind).
        </li>
        <li>
          Runtime records keep explicit ids because people and adapters create them: instances,
          conversations, accounts, routes and bindings. Code refers to them by value (
          <code>{"{"} account: supportAccount {"}"}</code>), never by copying the string.
        </li>
      </ul>

      <h2 id="assembly">agent.ts assembles; the parts live beside it</h2>
      <p>
        <code>agent.ts</code> is the first file a person or a coding agent opens to learn what an
        agent is, so keep it to that: imports and one <code>defineAgent</code> call whose fields
        are values, imported definitions, or one-line resolvers. Write what the agent is made
        of in modules beside it. Each part can then be read, tested and reused on its own, and
        the definition stays a page you can take in at a glance.
      </p>
      <AssemblyDiagram />
      <CodeBlock
        filename="agents/assistant/"
        language="text"
        code={`agent.ts              imports the parts and wires them into fields
prompt.ts             interactorPrompt(onCall): the instructions, as a function
personal.memory.ts    defineMemory(...): a convention file, so it owns its id
call.ts               the call: payload schema, isCall(), voiceCall({ room, greeting })
tools.ts              always-on tools as plain Glove tool objects
tools/*.tool.ts       tools an instance installs`}
      />
      <ul>
        <li><strong>Prompts are functions.</strong> <code>prompt.ts</code> exports a function that takes what changes the prompt (the surface, the instance) and returns a string. The field is <code>systemPrompt: (_agent, ctx) =&gt; interactorPrompt(isCall(ctx))</code>.</li>
        <li><strong>Tools live in tools files.</strong> Always-on tools go in a plain <code>tools.ts</code>; tools an instance installs go in <code>tools/*.tool.ts</code>. Tool bodies call your services from <code>lib/</code>.</li>
        <li><strong>Pieces with an identity use their convention file.</strong> Memory, apps, MCP servers, layers and subscribers are <code>*.memory.ts</code>, <code>*.app.ts</code> and so on, so the file owns the id.</li>
        <li><strong>Choices shared by several agents go in <code>lib/</code>.</strong> The model for each layer, the conversation store, workspace persistence.</li>
        <li><strong>Parse a request once.</strong> If the payload decides behaviour (a call, a campaign), a module exports the schema and a predicate, and every field uses them.</li>
        <li><strong>Agents reach each other by instance id, at run time.</strong> Put them on <Link href="/foundry/docs/multi-agent#mesh">the mesh</Link> and let them find their peers with <code>glove_mesh_list_agents</code>. Never import another agent&apos;s <code>agent.ts</code>, or its dependencies load in every one of your runs.</li>
        <li><strong>A folder is a kind of agent, not an agent.</strong> One <code>agents/bot/</code> serves every bot your users create; names, jobs and teammates are <Link href="/foundry/docs/agents-are-data">instance data</Link>.</li>
      </ul>
      <p>
        <code>examples/foundry-layered-assistant</code> follows these rules end to end; its{" "}
        <code>agent.ts</code> files are under 40 lines each.
      </p>

      <h2 id="application">foundry.application.ts</h2>
      <p>
        Runtime infrastructure: where data lives and who may call the HTTP surface. It must
        default-export <code>defineApplication(...)</code>. Foundry loads it in the runtime
        process <em>and</em> in every agent run’s worker process, so anything it creates must be
        safe to construct more than once. Without the file, Foundry uses an empty application
        with in-memory data.
      </p>
      <table>
        <thead><tr><th>Option</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>Required, non-empty</td></tr>
          <tr><td><code>data</code></td><td><code>FoundryDataAdapter</code> for instances, conversations, installations, playbooks, subscriptions, activations, workspace entries, inbox, tasks and VFS snapshots. Default <code>MemoryFoundryDataAdapter</code> (lost on restart); <code>FileFoundryDataAdapter</code> for one host</td></tr>
          <tr><td><code>conversationStore</code></td><td><code>(scope) =&gt; StoreAdapter</code> used for transcripts when a definition has no <code>store</code> of its own</td></tr>
          <tr><td><code>requestAuthorization</code></td><td><code>{"{"} identifier, challenge?, authorize(request) {"}"}</code> returning <code>Effect&lt;boolean&gt;</code>; gates every HTTP request and is required to bind a non-loopback host</td></tr>
          <tr><td><code>accounts</code>, <code>routes</code>, <code>bindings</code></td><td>Integration topology from <code>defineAccount</code>, <code>defineInboundRoute</code>/<code>defineOutboundRoute</code>, <code>defineBinding</code>; duplicate ids throw</td></tr>
          <tr><td><code>provisioner</code></td><td>Your strategy for playbook subscriptions with <code>provisioning.mode = &quot;custom&quot;</code></td></tr>
          <tr><td><code>daemon</code></td><td><code>stationDaemon(...)</code> from <code>glove-foundry/station</code> for browser/sandbox resources</td></tr>
          <tr><td><code>services</code></td><td>Effect <code>Layer</code> replacing the in-memory <code>AccountDirectory</code>, <code>TopologyStore</code> and <code>EventStore</code></td></tr>
        </tbody>
      </table>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { FileFoundryDataAdapter, defineAgentInstance, defineApplication, install } from "glove-foundry";
import support from "./agents/support/agent.js";
import lookupOrder from "./agents/support/tools/lookup-order.tool.js";

const supportEu = defineAgentInstance(support, {
  id: "support-eu",
  workspaceId: "acme",
  installations: [install(lookupOrder, { region: "eu" })],
});

export default defineApplication({
  name: "Support desk",
  // Seeds are inserted only when the file has no instance with that id.
  data: new FileFoundryDataAdapter({ file: ".data/foundry.json", agents: [supportEu] }),
});`} />
      <p>
        Agent definitions do not belong here; they are discovered from <code>agents/</code>.
        See <Link href="/foundry/docs/persistence">Persistence</Link> and{" "}
        <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>.
      </p>

      <h2 id="config">foundry.config.ts</h2>
      <p>
        Settings for the runtime process. Foundry looks for <code>foundry.config.ts</code>,{" "}
        <code>.mts</code>, <code>.js</code> or <code>.mjs</code> in the project root; it must
        default-export a value. <code>defineConfig</code> (from{" "}
        <code>glove-foundry/config</code>) makes unknown keys a type error. CLI flags{" "}
        <code>--port</code> and <code>--host</code> override the file.
      </p>
      <table>
        <thead><tr><th>Key</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>agentsDir</code></td><td><code>&quot;agents&quot;</code></td><td>Where agents are discovered</td></tr>
          <tr><td><code>applicationFile</code></td><td><code>&quot;foundry.application.ts&quot;</code></td><td>Path of the application file</td></tr>
          <tr><td><code>server.host</code></td><td><code>&quot;127.0.0.1&quot;</code></td><td>Non-loopback requires <code>requestAuthorization</code></td></tr>
          <tr><td><code>server.port</code></td><td><code>4141</code></td><td>HTTP API, inspector and WebChat</td></tr>
          <tr><td><code>server.messageBodyBytes</code></td><td>1 MB (1048576)</td><td>JSON limit for message-bearing endpoints; integer from 1048576 to 134217728</td></tr>
          <tr><td><code>execution.maxConcurrent</code></td><td><code>5</code></td><td>Runs executing at once</td></tr>
          <tr><td><code>execution.maxAttempts</code></td><td><code>1</code></td><td>Attempts per run</td></tr>
          <tr><td><code>execution.retryBackoffMs</code></td><td><code>1000</code></td><td>Delay between attempts</td></tr>
          <tr><td><code>execution.pollIntervalMs</code></td><td><code>100</code></td><td>Execution polling interval</td></tr>
          <tr><td><code>execution.idlePollIntervalMs</code></td><td><code>1000</code></td><td>Deprecated; kept for source compatibility</td></tr>
          <tr><td><code>observability.maxEvents</code></td><td><code>10000</code></td><td>Events retained for traces</td></tr>
          <tr><td><code>branding.name</code> / <code>label</code> / <code>descriptor</code> / <code>accent</code></td><td>Glove Foundry / — / Inspector / —</td><td>Inspector shell text and a six-digit hex accent</td></tr>
          <tr><td><code>strictFileRoutes</code></td><td><code>true</code></td><td>Reject an agent module whose exported <code>id</code> differs from its file route</td></tr>
        </tbody>
      </table>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4141, messageBodyBytes: 40 * 1024 * 1024 },
  execution: { pollIntervalMs: 100, maxConcurrent: 4 },
});`} />

      <h2 id="generated">Generated files</h2>
      <p>
        Every <code>glove foundry dev</code> and <code>start</code> rewrites two files in{" "}
        <code>.foundry/</code> before the server listens:
      </p>
      <CodeBlock filename=".foundry/routes.d.ts" language="typescript" code={`// Generated by Glove Foundry. Do not edit.
export type FoundryRoutes = {
  readonly "support": typeof import("../agents/support/agent.js");
};`} />
      <p>
        Pass it to the client so route names are checked at compile time:{" "}
        <code>createFoundryClient&lt;FoundryRoutes&gt;()</code> makes{" "}
        <code>foundry.agent(&quot;suport&quot;)</code> a type error. It is a type-only import, so
        no agent code reaches the calling app. Commit it (the starter does), so{" "}
        <code>typecheck</code> works before the first run.
      </p>
      <p>
        <code>.foundry/manifest.json</code> (<code>version: 1</code>) describes each discovered
        agent: <code>id</code>, <code>description</code>, <code>file</code>, <code>tags</code>,{" "}
        <code>handler</code> (<code>&quot;glove&quot;</code>, or <code>&quot;custom&quot;</code>{" "}
        when <code>run</code>/<code>spawn</code> is set), the statically known names of{" "}
        <code>tools</code>, <code>hooks</code>, <code>skills</code>, <code>subagents</code>,{" "}
        <code>memory</code>, <code>layers</code>, <code>subscribers</code>, <code>calls</code>,{" "}
        <code>schedules</code> and <code>playbooks</code>, flags for <code>inboxLoader</code>,{" "}
        <code>mesh</code>, <code>workingEnvironment</code> and <code>repl</code>, and{" "}
        <code>lazy</code> — the fields given as resolvers, whose contents are only known per run.
        The starter git-ignores it. <code>GET /api/manifest</code> serves the same data plus each
        definition’s capability catalogue.
      </p>

      <h2 id="eslint">The ESLint preset</h2>
      <p>
        <code>glove-foundry/eslint</code> default-exports a flat-config object named{" "}
        <code>glove-foundry/recommended</code> that applies to{" "}
        <code>**/*.{"{"}ts,tsx,mts,js,mjs{"}"}</code>. The starter’s config:
      </p>
      <CodeBlock filename="eslint.config.js" language="javascript" code={`import tseslint from "typescript-eslint";
import foundry from "glove-foundry/eslint";

export default [
  { ignores: [".foundry/**"] },
  ...tseslint.configs.recommended,
  foundry,
];`} />
      <table>
        <thead><tr><th>Rule (all <code>error</code>)</th><th>Rejects</th><th>Use instead</th></tr></thead>
        <tbody>
          <tr><td><code>glove-foundry/no-agent-contracts</code></td><td><code>input</code> or <code>output</code> in <code>defineAgent({"{"}…{"}"})</code>, and <code>export const input/output</code></td><td>Nothing: Foundry owns the request and result contracts; use <code>defineCall</code> for typed operations</td></tr>
          <tr><td><code>glove-foundry/no-file-definition-id</code></td><td>An <code>id</code> property in <code>defineAgent</code>, <code>defineSharedTool</code>, <code>defineApp</code>, <code>defineAgentApplication</code>, <code>defineMcp</code>, <code>defineMemory</code>, <code>defineLayer</code>, <code>defineSubscriber</code>, <code>defineTransmission</code>, <code>defineTransmissionEvent</code>, <code>defineTransmissionPredicate</code>, <code>definePlaybookAction</code>, <code>defineConnection</code>, <code>definePlaybookSubscription</code></td><td>The filename</td></tr>
          <tr><td><code>glove-foundry/no-raw-definition-references</code></td><td><code>accountId</code> in <code>install(def, config)</code>; <code>transmissionId</code>, <code>applicationId</code>, <code>routeId</code>, <code>routeIds</code>, <code>applicationAccountId</code> and string-literal <code>event</code>/<code>action</code> inside <code>composePlaybook</code></td><td><code>install(def, config, {"{"} account {"}"})</code>; imported <code>transmission</code>, <code>application</code>, <code>route(s)</code>, <code>applicationAccount</code>, <code>event</code>, <code>action</code> values</td></tr>
        </tbody>
      </table>
      <p>
        The plugin is also exported as <code>foundryEslintPlugin</code> and the preset as{" "}
        <code>foundryEslintConfig</code>.
      </p>

      <h2 id="catalogue-vs-installation">Catalogue, installation, or definition field?</h2>
      <p>
        <code>components: composeAgent(...)</code> is a catalogue: it says which parts an
        instance <em>may</em> use. Nothing in it reaches the model until something else selects
        it. This table is the whole rule:
      </p>
      <table>
        <thead><tr><th>Part</th><th>Goes in</th><th>Mounted on a run when</th></tr></thead>
        <tbody>
          <tr><td>Plain Glove tool (<code>name</code>, <code>description</code>, <code>inputSchema</code>, <code>do</code>)</td><td><code>tools</code> field</td><td>Always, on every instance</td></tr>
          <tr><td>Shared tool (<code>*.tool.ts</code>)</td><td><code>composeAgent</code></td><td>The instance has a <code>tool</code> installation for its id</td></tr>
          <tr><td>Application (<code>*.app.ts</code>)</td><td><code>composeAgent</code></td><td>The instance has an <code>application</code> installation; its outbound transmissions become tools named <code>glove_app_&lt;app&gt;__&lt;transmission&gt;_send</code>, plus any tools its <code>install</code> hook returns</td></tr>
          <tr><td>MCP server (<code>*.mcp.ts</code>)</td><td><code>composeAgent</code></td><td>The instance has an <code>mcp</code> installation; the definition must also set <code>mcpAdapter</code></td></tr>
          <tr><td>Memory profile (<code>*.memory.ts</code>)</td><td><code>composeAgent</code> <em>and</em> the <code>memory</code> field</td><td>Listed in <code>memory</code> (directly or via <code>configureMemory</code>); no installation</td></tr>
          <tr><td>Layer (<code>*.layer.ts</code>)</td><td><code>composeAgent</code> <em>and</em> the <code>layers</code> field</td><td>Listed in <code>layers</code> (or <code>configureLayer</code>); no installation</td></tr>
          <tr><td>Subscriber (<code>*.subscriber.ts</code>)</td><td><code>composeAgent</code> <em>and</em> the <code>subscribers</code> field</td><td>Listed in <code>subscribers</code>; a raw <code>SubscriberAdapter</code> object needs no catalogue entry</td></tr>
          <tr><td>Schedule (<code>defineSchedule</code>)</td><td><code>schedules</code> field</td><td>Reconciled into an activation on the instance’s next run</td></tr>
          <tr><td>Typed call (<code>defineCall</code>)</td><td><code>calls</code> field</td><td>Always; also exposed as a tool unless <code>exposeToAgent: false</code></td></tr>
          <tr><td>Hooks, skills, subagents</td><td><code>hooks</code>, <code>skills</code>, <code>subagents</code> fields</td><td>Always</td></tr>
          <tr><td>Built-in <code>glove_foundry_*</code> tools</td><td>Nothing</td><td>Always: <code>spawn</code>, <code>schedule</code>, <code>schedules</code>, <code>sleep</code>, <code>background</code>, <code>transmit</code>, <code>conversations</code>, <code>workspace</code>, <code>shared_inbox</code>, <code>tasks</code>, <code>environment</code></td></tr>
        </tbody>
      </table>
      <p>
        Selecting a memory profile, layer or subscriber that is missing from{" "}
        <code>composeAgent</code> fails the run (<code>Unknown agent memory profile</code>,{" "}
        <code>references unknown layer</code>). Installing an id that is missing from it is
        rejected (<code>Unknown Foundry tool capability</code>). Installations are added with{" "}
        <code>install(def, config?, {"{"} account? {"}"})</code> in{" "}
        <code>defineAgentInstance</code>, <code>installations</code> on{" "}
        <code>client.agent(route).create</code>, <code>client.install</code>, or{" "}
        <code>PUT /api/installations</code>. Walk through it in the{" "}
        <Link href="/foundry/docs/tutorial#step-4-installable-tool">tutorial</Link>; every field is
        in <Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link>.
      </p>
    </article>
  );
}
