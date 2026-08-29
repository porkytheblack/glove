import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Runtime & HTTP API" };

export default function RuntimePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / 09</span>
      <h1>Runtime and HTTP API</h1>
      <p className="blog-lede">
        The development server and production runtime expose stable agent-system
        operations over HTTP while Effect services coordinate discovery, persistence,
        execution, activation, scheduling, connections, and observation underneath.
      </p>

      <h2 id="application">Application adapters</h2>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`export default defineApplication({
  name: "Brand workforce",
  data: durableFoundryData,
  conversationStore: ({ conversationId }) => storeFor(conversationId),
  provisioner: customInstanceProvisioner,
  services: productionServiceLayer,
  accounts: [supportAccount],
  routes: [supportInbound, supportOutbound],
  bindings: [supportBinding],
});`} />
      <p>
        Only configure services you own. Development defaults use memory adapters. A
        production application should select durability and concurrency explicitly and
        validate adapter health before accepting traffic.
      </p>

      <h2 id="endpoints">Primary activation endpoints</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>POST /api/agent-instances</code></td><td>Provision an instance from a discovered definition route.</td></tr>
          <tr><td><code>PATCH /api/agent-instances/:id</code></td><td>Update instance context and installed runtime data.</td></tr>
          <tr><td><code>POST /api/conversations</code></td><td>Create a durable conversation for an instance.</td></tr>
          <tr><td><code>POST /api/conversations/:id/messages</code></td><td>Append a Glove-compatible message and enqueue a run.</td></tr>
          <tr><td><code>POST /api/transmissions/:routeId/fire</code></td><td>Deliver a normalized inbound event through playbook subscriptions.</td></tr>
          <tr><td><code>GET /api/events?runId=:id</code></td><td>Read the correlated event timeline for a run.</td></tr>
        </tbody>
      </table>

      <h2 id="typed-client">Use the generated client routes</h2>
      <CodeBlock filename="client.ts" language="typescript" code={`import type { FoundryRoutes } from "./.foundry/routes.js";
import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient<FoundryRoutes>();
const analyst = foundry.agent("analyst"); // checked against the file routes
const handle = await analyst.request({
  message: "Compare the three campaign directions.",
});
const run = await handle.wait({ timeoutMs: 120_000 });`} />

      <h2 id="handlers">Custom handlers</h2>
      <p>
        If a route exports a typed <code>run</code> handler, Foundry validates its
        payload and result without assembling a model loop. Use this for deterministic
        endpoints, ingestion, or orchestration glue. <code>defineAgent</code> itself
        never defines request input or output; those are runtime route concerns.
      </p>

      <h2 id="messages">Glove message parity</h2>
      <p>
        Foundry accepts the native Glove message content model: text plus typed content
        parts and attachments. The current message and complete history flow into lazy
        assembly, so tools, prompts, memory, inboxes, and workbenches can respond to
        media as well as text.
      </p>

      <h2 id="errors">Typed failure, explicit retry</h2>
      <p>
        Runtime adapters expose typed failures through Effect. Retry policy belongs at
        the failing boundary: provider pressure may retry a model pass, while an inbound
        delivery claim prevents the external event from provisioning the same instances
        twice. Cancellation interrupts scoped work and records the transition.
      </p>
    </article>
  );
}
