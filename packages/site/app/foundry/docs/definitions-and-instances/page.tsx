import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Definitions & instances" };

export default function DefinitionsAndInstancesPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Model the system / 02</span>
      <h1>Definitions and instances</h1>
      <p className="blog-lede">
        A definition describes a kind of agent. An instance is one durable agent
        assembled from that definition plus persisted data. Keeping them separate
        is what makes dynamic provisioning possible without turning configuration into code generation.
      </p>

      <h2 id="definitions">Definitions live in code</h2>
      <p>
        <code>agents/release-planner/agent.ts</code> is discovered as the
        <code>release-planner</code> route. You do not repeat that identity inside
        <code>defineAgent</code>. The generated route map gives clients a closed,
        type-safe set of definitions.
      </p>
      <CodeBlock filename="agents/release-planner/agent.ts" language="typescript" code={`import { defineAgent } from "glove-foundry";

export default defineAgent({
  description: "Turns an objective into a verified release plan",
  systemPrompt: (_agent, ctx) => promptFor(ctx.message, ctx.history),
  tools: (_agent, ctx) => toolsFor(ctx.agentInstance, ctx.message),
});`} />
      <p>
        Colocated primitives follow the same rule. A tool, app, memory adapter,
        subscriber, or schedule receives its runtime identity from its file during
        discovery. In static code, import the value itself: <code>install(releaseNotes)</code>,
        not <code>install(&quot;release-notes&quot;)</code>.
      </p>

      <h2 id="instances">Instances live in data</h2>
      <p>
        An instance records what a particular agent has been given: its runtime ID,
        definition route, workspace, application installations, playbooks, schedules,
        and arbitrary context. Foundry can load that record after a restart and reconstruct
        the agent from the current code definition.
      </p>
      <CodeBlock filename="agents/release-planner/instances.ts" language="typescript" code={`import { defineAgentInstance, install } from "glove-foundry";
import releasePlanner from "./agent.js";
import releaseNotes from "./apps/release-notes.app.js";

export const coordinator = defineAgentInstance(releasePlanner, {
  // Instance identity is data. It may instead be assigned by your adapter.
  id: "release-coordinator-01",
  workspaceId: "launch-q4",
  context: { role: "release-coordinator" },
  installations: [install(releaseNotes, { channel: "launch" })],
  playbooks: [],
});`} />

      <h2 id="boundary">Where strings are correct</h2>
      <table>
        <thead><tr><th>Situation</th><th>Reference</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>Definition imports another static primitive</td><td>Imported object</td><td>Renames fail at compile time and editors follow the reference.</td></tr>
          <tr><td>Generated client selects an agent route</td><td>Generated string union</td><td>The HTTP route is serialized, but still checked against discovered files.</td></tr>
          <tr><td>Persisted instance points to a definition</td><td>Serialized route</td><td>Data must survive processes and deployments.</td></tr>
          <tr><td>Run points to an instance or conversation</td><td>Runtime ID</td><td>These identities are created and updated dynamically.</td></tr>
        </tbody>
      </table>

      <h2 id="updates">Instances can change</h2>
      <p>
        Install or uninstall applications, replace playbooks, update instance context,
        add schedules, or move workspace bindings through the data adapter. The next
        run reconstructs from the latest persisted record and resolves every lazy
        definition again against the new message.
      </p>

      <h2 id="provisioning">Instances can be provisioned by events</h2>
      <p>
        A playbook subscription can target an existing singleton, one agent per
        external thread, one per event, or a fixed fan-out. When an inbound
        transmission matches and no target instance exists, the provisioning adapter
        atomically creates the instance and conversation before dispatch. Duplicate
        delivery is claimed idempotently.
      </p>
    </article>
  );
}
