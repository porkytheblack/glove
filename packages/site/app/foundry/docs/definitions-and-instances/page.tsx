import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Definitions & instances",
  description:
    "What belongs in code and what in data: the AgentInstance record, seeding and creating instances, configureAgent, and per-run reconstruction.",
};

const instanceFields: { name: string; type: string; notes: string }[] = [
  { name: "id", type: "string", notes: "Yours, or agent_<uuid> when omitted. Unique per data adapter." },
  { name: "definitionId", type: "string", notes: "The definition route, e.g. support. Fixed for the instance's life." },
  { name: "workspaceId", type: "string", notes: "Default \"default\". Its conversations and requests must use the same workspace." },
  { name: "provisioningKey?", type: "string", notes: "Set only by event-driven provisioning; the data adapter keeps it unique." },
  { name: "name?", type: "string", notes: "Who the agent is, to people and to its peers on the mesh. Data: change it with configureAgent or from a tool. Defaults to the id." },
  { name: "description?", type: "string", notes: "What the agent does, in a sentence its peers read to choose it." },
  { name: "context", type: "Record<string, unknown>", notes: "Free-form JSON. Resolvers read it as ctx.agentInstance.context." },
  { name: "installations", type: "AgentInstallation[]", notes: "{ kind: \"tool\" | \"application\" | \"mcp\", id, config?, accountId? }" },
  { name: "playbooks", type: "AgentPlaybook[]", notes: "Inbound-event policy (see Playbooks, schedules & sleep)." },
  { name: "createdAt, updatedAt", type: "ISO-8601 string", notes: "updatedAt changes on every configure/install." },
];

export default function DefinitionsAndInstancesPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Build agents / Definitions &amp; instances</span>
      <h1>Definitions and instances</h1>
      <p className="blog-lede">
        A definition is code that describes a kind of agent. An instance is one durable
        agent built from it, with its own id, workspace, context, installed capabilities
        and playbooks. You serve a new customer by creating data, not by writing code, and
        every run rebuilds the agent from the latest code and the latest data.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">›</span>
        <p>
          A definition is not one agent. It is everything that kind of agent could be; which
          agent it is, what it is called, what it does and who it works with are instance
          data. If you are about to add a definition to add an agent, read{" "}
          <Link href="/foundry/docs/agents-are-data">Agents are data</Link> first.
        </p>
      </div>

      <h2 id="split">What lives where</h2>
      <table>
        <thead><tr><th></th><th>Definition</th><th>Instance</th></tr></thead>
        <tbody>
          <tr><td>Lives in</td><td><code>agents/&lt;route&gt;/agent.ts</code></td><td>Your <code>FoundryDataAdapter</code></td></tr>
          <tr><td>Identity</td><td>The file path: <code>agents/support/agent.ts</code> is <code>support</code></td><td>An <code>id</code> string such as <code>support-acme</code></td></tr>
          <tr><td>Holds</td><td>Model, prompt, tools, assembly logic, the capability catalogue</td><td>Name, description, context, installations, playbooks, workspace</td></tr>
          <tr><td>Changes by</td><td>Deploying code</td><td><code>configureAgent</code>, install/uninstall, provisioning</td></tr>
          <tr><td>How many</td><td>One per route</td><td>Any number per definition</td></tr>
        </tbody>
      </table>
      <p>
        Conversations belong to an instance (one instance can own many) and runs belong to a
        conversation; see <Link href="/foundry/docs/conversations">Conversations</Link>.
      </p>

      <h2 id="definitions">Definitions live in code</h2>
      <p>
        <code>agents/support/agent.ts</code> is discovered as the <code>support</code> route.
        You never repeat that identity inside <code>defineAgent</code>, and the generated{" "}
        <code>.foundry/routes.d.ts</code> gives clients a closed, type-checked set of routes.
        Colocated primitives follow the same rule: a tool, app, MCP server, memory profile,
        layer or subscriber gets its id from its file name during discovery. In code you
        import the value itself — <code>install(helpdesk)</code>, not{" "}
        <code>install(&quot;helpdesk&quot;)</code> — so renames fail at compile time.
      </p>
      <p>
        A definition reads instance data through its resolvers. This one prompt serves every
        tenant:
      </p>
      <CodeBlock filename="agents/support/agent.ts (excerpt)" language="typescript" code={`systemPrompt: (_agent, { agentInstance }) =>
  \`You are the support agent for \${String(agentInstance.context.tenant ?? "our store")}.\`,`} />
      <p>
        All fields and the assembly context are listed in{" "}
        <Link href="/foundry/docs/composition">defineAgent &amp; assembly</Link>.
      </p>

      <h2 id="instance-record">The AgentInstance record</h2>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
        <tbody>
          {instanceFields.map((row) => (
            <tr key={row.name}>
              <td><code>{row.name}</code></td>
              <td><code>{row.type}</code></td>
              <td>{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Foundry freezes the record it reads back and deep-copies <code>context</code> and
        installation <code>config</code>, so a resolver cannot mutate persisted data by
        accident. Keep <code>context</code> JSON-serializable and free of secrets: it is
        returned by the API and shown in the inspector.
      </p>

      <h2 id="creating">Creating instances</h2>
      <table>
        <thead><tr><th>Where</th><th>API</th></tr></thead>
        <tbody>
          <tr><td>Code, loaded at startup</td><td><code>defineAgentInstance(definition, options)</code> in a data adapter&apos;s <code>agents</code> seed list</td></tr>
          <tr><td>Your server process</td><td><code>runtime.createAgent(&quot;support&quot;, options)</code> on a <code>FoundryRuntime</code></td></tr>
          <tr><td>Typed client</td><td><code>foundry.agent(&quot;support&quot;).create(options)</code> or <code>foundry.createAgent(&quot;support&quot;, options)</code></td></tr>
          <tr><td>HTTP</td><td><code>POST /api/agent-instances</code> with <code>{"{ definitionId, ...options }"}</code> → <code>201</code> and the record</td></tr>
          <tr><td>Inspector</td><td><em>New run</em> can create an instance in the current or default workspace</td></tr>
          <tr><td>Inbound events</td><td>Playbook subscriptions provision instances (below)</td></tr>
        </tbody>
      </table>
      <p>
        <code>options</code> is <code>{"{ id?, workspaceId?, name?, description?, context?, installations?, playbooks? }"}</code>.
        Omitted fields default to <code>agent_&lt;uuid&gt;</code>, <code>&quot;default&quot;</code>,
        none, none, <code>{"{}"}</code>, <code>[]</code> and <code>[]</code>. There is no{" "}
        <code>provisioningKey</code> option; only provisioning sets it. <code>createAgent</code>{" "}
        rejects an unknown definition, an installation that is not in that definition&apos;s{" "}
        <code>components</code>, invalid playbooks, and an id that already exists.
      </p>

      <h3 id="seeding">Seeding instances from code</h3>
      <p>
        <code>defineAgentInstance</code> returns a plain <code>AgentInstance</code> value and
        registers nothing. It becomes real when you hand it to the data adapter in{" "}
        <code>foundry.application.ts</code>. Pair it with <code>createConversation</code> so the
        instance has a thread to talk in.
      </p>
      <CodeBlock filename="agents/support/instances.ts" language="typescript" code={`import { createConversation, defineAgentInstance, install } from "glove-foundry";
import support from "./agent.js";
import helpdesk from "./apps/helpdesk.app.js";
import lookupOrder from "./tools/lookup-order.tool.js";

export const acmeSupport = defineAgentInstance(support, {
  id: "support-acme",
  workspaceId: "acme",
  context: { tenant: "Acme", canRefund: true },
  installations: [
    install(lookupOrder, { region: "eu" }),
    install(helpdesk, { queue: "billing" }),
  ],
});

export const acmeMain = createConversation(acmeSupport, {
  id: "support-acme-main",
  title: "Acme support",
});`} />
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { acmeMain, acmeSupport } from "./agents/support/instances.js";

export default defineApplication({
  name: "Support",
  data: new FileFoundryDataAdapter({
    file: ".foundry/data/state.json",
    agents: [acmeSupport],
    conversations: [acmeMain],
  }),
});`} />
      <ul>
        <li><code>definitionId</code> is read from the imported definition&apos;s file identity, which Foundry binds during discovery. Pass seeds to an adapter; do not serialize them yourself.</li>
        <li><code>MemoryFoundryDataAdapter</code> accepts the same <code>agents</code>, <code>conversations</code>, <code>subscriptions</code>, <code>activations</code> and <code>environment</code> seeds. It reloads them on every start and loses everything else at restart.</li>
        <li><code>FileFoundryDataAdapter</code> writes a seed only when no record with that id exists yet. Editing a seed later does <strong>not</strong> change an instance already in the state file; use <code>configureAgent</code>, or delete the file in development.</li>
        <li>At startup Foundry validates every stored instance. One that names an unknown definition, or installs something missing from its definition&apos;s <code>components</code>, stops the runtime from starting.</li>
      </ul>
      <p>
        Adapters and durability are covered in <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h3 id="runtime-create">Creating at runtime</h3>
      <CodeBlock filename="scripts/onboard.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

const agent = await foundry.agent("support").create({
  id: "support-globex",
  workspaceId: "globex",
  context: { tenant: "Globex", canRefund: false },
  installations: [{ kind: "tool", id: "lookup-order", config: { region: "us" } }],
});
const conversation = await foundry.createConversation(agent.id, { title: "Globex support" });
const run = await foundry.send(agent.id, conversation.id, "Where is order A-1001?");
console.log((await run.wait()).output);`} />
      <CodeBlock filename="HTTP" language="http" code={`POST /api/agent-instances
content-type: application/json

{
  "definitionId": "support",
  "id": "support-globex",
  "workspaceId": "globex",
  "context": { "tenant": "Globex" },
  "installations": [{ "kind": "tool", "id": "lookup-order", "config": { "region": "us" } }]
}`} />

      <h2 id="updating">Changing an instance</h2>
      <p>
        <code>configureAgent(agentId, {"{ name?, description?, context?, installations?, playbooks? }"})</code> exists on
        the runtime and the client, and as <code>PATCH /api/agent-instances/:id</code>. A tool
        can also write its own instance through <code>ctx.data.putAgent</code>, which is how
        an agent renames itself.
      </p>
      <ul>
        <li>Each field you pass <strong>replaces</strong> that whole field. <code>context</code> is not merged; spread the current value yourself.</li>
        <li>Fields you omit are kept. <code>id</code>, <code>definitionId</code>, <code>workspaceId</code> and <code>provisioningKey</code> cannot be changed; create a new instance instead.</li>
        <li>Installations and playbooks are validated exactly as in <code>createAgent</code>.</li>
        <li>To add or remove one capability, use <code>install</code>/<code>uninstall</code> (<code>PUT</code>/<code>DELETE /api/installations</code>); see <Link href="/foundry/docs/capabilities#installing">Installing on an instance</Link>. Playbooks alone: <code>setAgentPlaybooks</code> or <code>PUT /api/agent-instances/:id/playbooks</code>.</li>
        <li>There is no API to delete an instance.</li>
      </ul>
      <CodeBlock filename="scripts/disable-refunds.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({ baseUrl: "http://127.0.0.1:4141" });

const current = (await foundry.agentInstances("support")).find((a) => a.id === "support-acme");
if (!current) throw new Error("support-acme not found");

await foundry.configureAgent(current.id, {
  context: { ...current.context, canRefund: false }, // replace, so carry the rest over
});`} />
      <CodeBlock filename="HTTP" language="http" code={`PATCH /api/agent-instances/support-acme
content-type: application/json

{ "context": { "tenant": "Acme", "canRefund": false } }`} />

      <h2 id="reconstruction">Every run rebuilds the agent</h2>
      <p>Nothing about an assembled agent is cached between runs. For each inbound message:</p>
      <ol>
        <li>A message arrives: <code>foundry.send</code>, <code>POST /api/conversations/:id/messages</code>, an OpenAI-compatible request, a schedule, a sleep wake-up, or a transmission.</li>
        <li>The host loads the instance and conversation from the data adapter and checks that the conversation belongs to the instance, that both share the request&apos;s workspace, and that the instance&apos;s <code>definitionId</code> matches the route.</li>
        <li>That snapshot — request, instance, conversation and the instance&apos;s activations — is handed to a fresh run process.</li>
        <li>The run loads the current definition code and re-runs every lazy resolver against the new message, then mounts the instance&apos;s installations (<Link href="/foundry/docs/composition#lifecycle">full order</Link>).</li>
      </ol>
      <ul>
        <li>A <code>configureAgent</code> or install change applies from the next run, with no restart. A run already in progress keeps the snapshot it started with.</li>
        <li>New definition code applies to every existing instance on its next run; instance data is untouched.</li>
        <li>History comes from the conversation store, not from the instance; see <Link href="/foundry/docs/conversations">Conversations</Link>.</li>
      </ul>

      <h2 id="boundary">Where strings are correct</h2>
      <table>
        <thead><tr><th>Situation</th><th>Reference</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>A definition imports another static primitive</td><td>Imported value (<code>install(helpdesk)</code>)</td><td>Renames fail at compile time and editors follow the reference.</td></tr>
          <tr><td>A typed client selects an agent route</td><td>Generated string union (<code>agent(&quot;support&quot;)</code>)</td><td>Serialized over HTTP, but checked against discovered files.</td></tr>
          <tr><td>A client or HTTP call installs a capability</td><td><code>{"{ kind, id }"}</code> strings</td><td>File ids are bound by discovery inside Foundry; outside it, <code>install(def)</code> cannot read an id.</td></tr>
          <tr><td>A persisted instance points to its definition</td><td><code>definitionId</code> string</td><td>Data must survive processes and deployments.</td></tr>
          <tr><td>A run targets an instance or conversation</td><td>Runtime ids</td><td>These identities are created and updated dynamically.</td></tr>
        </tbody>
      </table>

      <h2 id="provisioning">Instances provisioned by events</h2>
      <p>
        You do not have to create every instance ahead of time. A playbook subscription
        listens for an inbound transmission and targets a definition with a provisioning
        mode: <code>singleton</code>, <code>per-thread</code>, <code>per-event</code>,{" "}
        <code>existing</code> (listed instance ids) or <code>custom</code> (your application&apos;s
        provisioner). When a matching event arrives and the target instance does not exist,
        Foundry calls the data adapter&apos;s <code>provisionAgent</code>, which creates the
        instance atomically under a <code>provisioningKey</code> (an existing key returns the
        existing instance), creates or reuses the conversation for that thread, and starts the
        run. Inbound deliveries are claimed by route and event id, so a retried
        delivery does not create duplicate instances or runs. See{" "}
        <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>.
      </p>
    </article>
  );
}
