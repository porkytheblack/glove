import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Client & HTTP API",
  description:
    "The typed Foundry client, every native /api endpoint, the /v1/runs automation API, live event streams, message contracts and health checks.",
};

export default function RuntimePage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Client &amp; HTTP API</span>
      <h1>Client &amp; HTTP API</h1>
      <p className="blog-lede">
        One Foundry process serves everything over HTTP on <code>127.0.0.1:4141</code>: a
        typed control plane for your own TypeScript code, an OpenAI-compatible API for
        existing SDKs and chat UIs, and an asynchronous run API for automation. All three
        drive the same persisted instances, conversations and runs, and every request
        shows up in the inspector.
      </p>

      <h2 id="three-surfaces">Three ways to talk to Foundry</h2>
      <table>
        <thead><tr><th>You are building…</th><th>Use</th><th>What you get</th></tr></thead>
        <tbody>
          <tr>
            <td>A TypeScript backend that manages instances, conversations, installations or approvals</td>
            <td>Typed client: <code>createFoundryClient</code> from <code>glove-foundry/client</code> (native <code>/api</code>)</td>
            <td>The whole control plane, route names checked against your files, run handles with <code>wait</code>/<code>cancel</code>/<code>steer</code>.</td>
          </tr>
          <tr>
            <td>An app, chat UI or eval harness that already speaks OpenAI</td>
            <td><code>/v1/chat/completions</code>, <code>/v1/responses</code>, <code>/v1/models</code> — see <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link></td>
            <td>Drop-in request/response and SSE streaming; the request blocks until the run ends.</td>
          </tr>
          <tr>
            <td>A cron job, CI step or service in another language that fires work and checks back later</td>
            <td><code>/v1/runs</code> automation API</td>
            <td><code>202 Accepted</code> immediately, then status, event stream, stop and steer by run id.</td>
          </tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        Host and port come from <code>server.host</code> / <code>server.port</code> in{" "}
        <code>foundry.config.ts</code> (defaults <code>127.0.0.1</code> and <code>4141</code>).
        Foundry refuses to bind a non-loopback host unless <code>foundry.application.ts</code>{" "}
        sets <code>requestAuthorization</code>; once set, every request — inspector HTML,{" "}
        <code>/api</code>, <code>/v1</code>, <code>/health</code> and event streams — must pass
        it, or gets <code>401</code>. See <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>.
      </p></div>

      <h2 id="typed-client">The typed client</h2>
      <p>
        <code>createFoundryClient&lt;FoundryRoutes&gt;()</code> is a thin, dependency-free{" "}
        <code>fetch</code> wrapper. <code>FoundryRoutes</code> is generated into{" "}
        <code>.foundry/routes.d.ts</code> by <code>glove foundry dev</code>/<code>start</code>, so{" "}
        <code>foundry.agent(&quot;support&quot;)</code> fails to compile if{" "}
        <code>agents/support/agent.ts</code> does not exist.
      </p>
      <CodeBlock filename="scripts/ask-support.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
  // Optional: only needed when foundry.application.ts sets requestAuthorization.
  authorization: {
    identifier: "foundry-api-token",
    headers: () => ({ authorization: \`Bearer \${process.env.FOUNDRY_API_TOKEN}\` }),
  },
});

// 1. Persist an instance of agents/support/agent.ts (the route is type-checked).
const support = await foundry.agent("support").create({
  id: "support-acme",
  workspaceId: "acme",
  context: { tenant: "acme", tier: "pro" },
});

// 2. Open a durable conversation owned by that instance.
const conversation = await foundry.createConversation(support.id, {
  title: "Order 1042",
});

// 3. Every message becomes a run. send() returns as soon as the run is queued.
const handle = await foundry.send(support.id, conversation.id, "Where is order 1042?");
console.log(\`trace: http://127.0.0.1:4141/runs/\${handle.id}\`);

// 4. Wait for a terminal status: completed, failed or cancelled.
const run = await handle.wait({ timeoutMs: 120_000 });
if (run.status === "completed") {
  console.log(run.output?.value); // the final assistant text
} else {
  console.error(run.status, run.error);
}`} />
      <table>
        <thead><tr><th>FoundryClientOptions</th><th>Default</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>baseUrl</code></td><td><code>http://127.0.0.1:4141</code></td><td>Foundry origin; a trailing slash is stripped.</td></tr>
          <tr><td><code>fetch</code></td><td><code>globalThis.fetch</code></td><td>Custom fetch (tests, proxies, edge runtimes).</td></tr>
          <tr><td><code>authorization</code></td><td>none</td><td><code>{"{ identifier, headers({ url, method }) }"}</code>; <code>headers</code> may be async and runs before every request, so tokens can be refreshed outside Foundry.</td></tr>
        </tbody>
      </table>
      <p>
        Every method throws an <code>Error</code> whose message is the server&apos;s{" "}
        <code>error</code> field when the response is not 2xx. <code>create</code> throws if the
        instance id already exists — look it up with <code>agentInstances(&quot;support&quot;)</code>{" "}
        first if your script is re-runnable.
      </p>

      <h3 id="agent-helper">foundry.agent(route)</h3>
      <p>
        Returns exactly two functions bound to a definition route:
      </p>
      <ul>
        <li><code>create(options?)</code> → <code>POST /api/agent-instances</code> with <code>definitionId: route</code>. Options: <code>id</code>, <code>workspaceId</code> (default <code>&quot;default&quot;</code>), <code>context</code>, <code>installations</code>, <code>playbooks</code>.</li>
        <li><code>request(request: FoundryRequest)</code> → <code>POST /api/agents/:route/runs</code>, returning a <code>FoundryRunHandle</code>. You must pass <code>agentId</code>, <code>conversationId</code> and <code>workspaceId</code>; Foundry rejects the run unless the instance uses this route&apos;s definition, the conversation belongs to the instance and all three share the workspace. Over this endpoint <code>message</code> must be a non-empty string.</li>
      </ul>
      <CodeBlock filename="scripts/ask-support.ts" language="typescript" code={`// continues scripts/ask-support.ts above (foundry, support, conversation)
const summary = await foundry.agent("support").request({
  agentId: support.id,
  conversationId: conversation.id,
  workspaceId: support.workspaceId,
  message: "Summarise this conversation for the ticket.",
  payload: { ticketId: "T-77" }, // reaches the agent as request.payload
});
await summary.wait();`} />
      <p>
        For everyday chat, prefer <code>send(agentId, conversationId, message, {"{ payload?, context? }"})</code>:
        it looks up the definition and workspace for you and accepts multimodal content parts.
      </p>

      <h3 id="run-handle">Run handles</h3>
      <p>
        <code>send</code>, <code>agent(route).request</code> and <code>handle.steer</code> return a{" "}
        <code>FoundryRunHandle</code>:
      </p>
      <table>
        <thead><tr><th>Member</th><th>Behaviour</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td>Run id (also the inspector URL <code>/runs/:id</code>).</td></tr>
          <tr><td><code>initial</code></td><td>The <code>FoundryRun</code> returned when the run was accepted.</td></tr>
          <tr><td><code>get()</code></td><td>Fresh <code>FoundryRun</code> (<code>GET /api/runs/:id</code>).</td></tr>
          <tr><td><code>wait({"{ pollMs?, timeoutMs?, signal? }"})</code></td><td>Polls until <code>completed</code>, <code>failed</code> or <code>cancelled</code> and returns the run — it does not throw on <code>failed</code>. Defaults: <code>pollMs</code> 150, <code>timeoutMs</code> 60 000. Throws on timeout or abort; neither cancels the run.</td></tr>
          <tr><td><code>cancel()</code></td><td>Cooperative cancel; resolves <code>true</code> if the runtime accepted it.</td></tr>
          <tr><td><code>steer(message)</code></td><td>Interrupt-and-restart in the same conversation. Resolves <code>{"{ fromRunId, interrupted, run }"}</code> where <code>run</code> is a new handle. See <Link href="/foundry/docs/approvals#steering">Steering</Link>.</td></tr>
          <tr><td><code>events()</code></td><td>The run&apos;s retained <code>FoundryEvent</code>s (latest 500).</td></tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        A run&apos;s own timeout (<code>run.timeoutMs</code>) is 300 000 ms by default, but{" "}
        <code>wait()</code> gives up after 60 s unless you pass <code>timeoutMs</code>. Long
        tool-using turns need a larger value.
      </p></div>

      <h3 id="client-reference">Client method reference</h3>
      <p>Every public <code>FoundryClient</code> method, grouped by what it manages.</p>
      <table>
        <thead><tr><th>Method</th><th>Returns</th><th>HTTP</th></tr></thead>
        <tbody>
          <tr><td colSpan={3}><strong>Instances</strong></td></tr>
          <tr><td><code>agent(route)</code></td><td><code>{"{ create, request }"}</code></td><td>see above</td></tr>
          <tr><td><code>createAgent(definitionId, options?)</code></td><td><code>AgentInstance</code></td><td><code>POST /api/agent-instances</code></td></tr>
          <tr><td><code>agentInstances(definitionId?)</code></td><td><code>AgentInstance[]</code></td><td><code>GET /api/agent-instances</code></td></tr>
          <tr><td><code>configureAgent(agentId, {"{ context?, installations?, playbooks? }"})</code></td><td><code>AgentInstance</code></td><td><code>PATCH /api/agent-instances/:id</code></td></tr>
          <tr><td><code>setAgentPlaybooks(agentId, playbooks)</code></td><td><code>AgentInstance</code></td><td><code>PUT /api/agent-instances/:id/playbooks</code></td></tr>
          <tr><td colSpan={3}><strong>Conversations</strong></td></tr>
          <tr><td><code>createConversation(agentId, {"{ id?, workspaceId?, title?, context? }"})</code></td><td><code>Conversation</code></td><td><code>POST /api/conversations</code></td></tr>
          <tr><td><code>conversations(agentId)</code></td><td><code>Conversation[]</code></td><td><code>GET /api/conversations?agent=</code></td></tr>
          <tr><td><code>updateConversation(agentId, conversationId, {"{ title?, context? }"})</code></td><td><code>Conversation</code></td><td><code>PATCH /api/conversations/:id</code></td></tr>
          <tr><td><code>conversationTranscript(agentId, conversationId, {"{ offset?, limit? }"})</code></td><td><code>FoundryConversationTranscript</code></td><td><code>GET /api/conversations/:id/messages</code></td></tr>
          <tr><td colSpan={3}><strong>Runs</strong></td></tr>
          <tr><td><code>send(agentId, conversationId, message, {"{ payload?, context? }"})</code></td><td><code>FoundryRunHandle</code></td><td><code>POST /api/conversations/:id/messages</code></td></tr>
          <tr><td><code>getRun(runId)</code></td><td><code>FoundryRun</code></td><td><code>GET /api/runs/:id</code></td></tr>
          <tr><td><code>runs(route?)</code></td><td><code>FoundryRun[]</code></td><td><code>GET /api/runs?agent=</code></td></tr>
          <tr><td><code>cancelRun(runId)</code></td><td><code>boolean</code></td><td><code>POST /api/runs/:id/cancel</code></td></tr>
          <tr><td><code>steerRun(runId, message)</code></td><td><code>FoundrySteerResult</code> (plain run record, not a handle)</td><td><code>POST /api/runs/:id/steer</code></td></tr>
          <tr><td><code>getEvents({"{ runId?, agent?, after?, category? }"})</code></td><td><code>FoundryEvent[]</code></td><td><code>GET /api/events</code></td></tr>
          <tr><td colSpan={3}><strong>Approvals</strong></td></tr>
          <tr><td><code>approvals({"{ runId?, status? }"})</code></td><td><code>FoundryApproval[]</code></td><td><code>GET /api/approvals</code></td></tr>
          <tr><td><code>resolveApproval(approvalId, &quot;approve&quot; | &quot;deny&quot;)</code></td><td><code>FoundryApproval</code></td><td><code>POST /api/approvals/:id</code></td></tr>
          <tr><td colSpan={3}><strong>Workspace data</strong></td></tr>
          <tr><td><code>workspaceEntries(workspaceId)</code> / <code>putWorkspaceEntry(workspaceId, key, value)</code></td><td><code>WorkspaceEntry[]</code> / <code>WorkspaceEntry</code></td><td><code>GET</code> / <code>PUT /api/workspaces/:id/entries</code></td></tr>
          <tr><td><code>sharedInbox(workspaceId)</code> / <code>postSharedInbox(workspaceId, {"{ topic, payload?, agentId?, conversationId? }"})</code></td><td><code>SharedInboxItem[]</code> / <code>SharedInboxItem</code></td><td><code>GET</code> / <code>POST /api/workspaces/:id/inbox</code></td></tr>
          <tr><td><code>updateSharedInbox(workspaceId, itemId, status)</code></td><td><code>SharedInboxItem</code></td><td><code>PATCH /api/workspaces/:id/inbox/:itemId</code></td></tr>
          <tr><td><code>tasks(workspaceId)</code> / <code>createTask(workspaceId, {"{ title, detail?, agentId?, conversationId? }"})</code></td><td><code>FoundryTask[]</code> / <code>FoundryTask</code></td><td><code>GET</code> / <code>POST /api/workspaces/:id/tasks</code></td></tr>
          <tr><td><code>updateTask(workspaceId, taskId, status)</code></td><td><code>FoundryTask</code></td><td><code>PATCH /api/workspaces/:id/tasks/:taskId</code></td></tr>
          <tr><td><code>dataEnvironment(workspaceId, {"{ agentId?, conversationId? }"}?)</code></td><td><code>EnvironmentValue[]</code></td><td><code>GET /api/workspaces/:id/environment</code></td></tr>
          <tr><td colSpan={3}><strong>Transmissions, playbooks &amp; activations</strong></td></tr>
          <tr><td><code>dispatchInbound({"{ routeId, eventId, threadKey, conversationKey?, conversationScope?, raw }"})</code></td><td><code>FoundryRun[]</code></td><td><code>POST /api/transmissions/:routeId/fire</code></td></tr>
          <tr><td><code>dispatchOutbound({"{ routeId, agentId, runId, payload }"})</code></td><td>adapter output</td><td><code>POST /api/transmissions/:routeId/deliver</code></td></tr>
          <tr><td><code>playbookSubscriptions(workspaceId?)</code></td><td><code>PlaybookSubscription[]</code></td><td><code>GET /api/playbook-subscriptions</code></td></tr>
          <tr><td><code>putPlaybookSubscription(subscription)</code> / <code>deletePlaybookSubscription(id)</code></td><td><code>PlaybookSubscription</code> / <code>boolean</code></td><td><code>PUT</code> / <code>DELETE /api/playbook-subscriptions</code></td></tr>
          <tr><td><code>activations(workspaceId?)</code></td><td><code>FoundryActivationRecord[]</code></td><td><code>GET /api/activations</code></td></tr>
          <tr><td colSpan={3}><strong>Application connections</strong></td></tr>
          <tr><td><code>applicationConnections()</code></td><td><code>ApplicationConnectionState[]</code></td><td><code>GET /api/application-connections</code></td></tr>
          <tr><td><code>reconnectApplicationConnection(id)</code></td><td><code>void</code></td><td><code>POST /api/application-connections/:id/reconnect</code></td></tr>
          <tr><td colSpan={3}><strong>Definitions &amp; installations</strong></td></tr>
          <tr><td><code>manifest()</code></td><td><code>{"{ agents, application, definitions }"}</code></td><td><code>GET /api/manifest</code></td></tr>
          <tr><td><code>capabilities(definitionId)</code></td><td><code>FoundryCapabilityManifest</code></td><td><code>GET /api/capabilities?definition=</code></td></tr>
          <tr><td><code>surfaces(definitionId)</code></td><td><code>FoundryNativeManifest</code></td><td><code>GET /api/surfaces?definition=</code></td></tr>
          <tr><td><code>installations(agentId)</code></td><td><code>AgentInstallation[]</code></td><td><code>GET /api/installations?agent=</code></td></tr>
          <tr><td><code>install(agentId, {"{ kind, id, config? }"})</code> / <code>uninstall(agentId, …)</code></td><td><code>AgentInstance</code></td><td><code>PUT</code> / <code>DELETE /api/installations</code></td></tr>
          <tr><td colSpan={3}><strong>Topology &amp; grants</strong></td></tr>
          <tr><td><code>accounts()</code></td><td><code>AccountSummary[]</code></td><td><code>GET /api/accounts</code></td></tr>
          <tr><td><code>routes()</code> / <code>putRoute(route)</code> / <code>removeRoute(id)</code></td><td><code>Route[]</code> / <code>Route</code> / <code>void</code></td><td><code>GET</code> / <code>PUT /api/routes</code>, <code>DELETE /api/routes/:id</code></td></tr>
          <tr><td><code>bindings()</code> / <code>putBinding(binding)</code> / <code>removeBinding(id)</code></td><td><code>AgentBinding[]</code> / <code>AgentBinding</code> / <code>void</code></td><td><code>GET</code> / <code>PUT /api/bindings</code>, <code>DELETE /api/bindings/:id</code></td></tr>
          <tr><td><code>resolveGrant({"{ runId, agentId, originRouteId? }"})</code></td><td><code>RunGrant</code></td><td><code>POST /api/grants/resolve</code></td></tr>
          <tr><td colSpan={3}><strong>Health</strong></td></tr>
          <tr><td><code>health()</code></td><td><code>FoundryHealth</code></td><td><code>GET /health</code></td></tr>
        </tbody>
      </table>
      <p>
        The client has no wrapper for <code>/v1/*</code>, <code>/health/detailed</code>,{" "}
        <code>GET /api/agents</code> or <code>GET /api/transmissions</code>; call those with{" "}
        <code>fetch</code>.
      </p>

      <h2 id="http-api">Native HTTP API</h2>
      <p>
        These are the routes the typed client and the inspector use. Request and response
        bodies are JSON. Errors are always <code>{"{ \"error\": \"message\" }"}</code>: <code>401</code>{" "}
        from authorization, <code>404</code> for an unknown path or run, <code>413</code> for an
        oversized body, and <code>400</code> for everything else — including unknown instance,
        conversation or definition ids.
      </p>
      <table>
        <thead><tr><th>Endpoint</th><th>Body / query</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td colSpan={3}><strong>Inspector &amp; health</strong></td></tr>
          <tr><td><code>GET /</code> and any other non-API path</td><td>—</td><td>Inspector HTML (WebChat lives at <code>/chat/:conversationId?agent=:agentId</code>).</td></tr>
          <tr><td><code>GET /health</code></td><td>—</td><td><code>FoundryHealth</code></td></tr>
          <tr><td><code>GET /health/detailed</code></td><td>—</td><td>Health plus <code>connections</code> and every retained run.</td></tr>
          <tr><td colSpan={3}><strong>Definitions</strong></td></tr>
          <tr><td><code>GET /api/manifest</code></td><td>—</td><td><code>{"{ agents, application, definitions: { [route]: { capabilities, surfaces } } }"}</code></td></tr>
          <tr><td><code>GET /api/agents</code></td><td>—</td><td>Discovered definitions.</td></tr>
          <tr><td><code>GET /api/capabilities</code></td><td><code>?definition=</code> (required)</td><td>The definition&apos;s installable catalogue.</td></tr>
          <tr><td><code>GET /api/surfaces</code></td><td><code>?definition=</code> (required)</td><td>Layers and subscribers.</td></tr>
          <tr><td colSpan={3}><strong>Instances &amp; installations</strong></td></tr>
          <tr><td><code>GET /api/agent-instances</code></td><td><code>?definition=</code></td><td><code>AgentInstance[]</code></td></tr>
          <tr><td><code>POST /api/agent-instances</code></td><td><code>definitionId</code>, <code>id?</code>, <code>workspaceId?</code>, <code>context?</code>, <code>installations?</code>, <code>playbooks?</code></td><td><code>201</code> <code>AgentInstance</code></td></tr>
          <tr><td><code>PATCH /api/agent-instances/:id</code></td><td><code>context?</code>, <code>installations?</code>, <code>playbooks?</code> — each given field is replaced whole</td><td><code>AgentInstance</code></td></tr>
          <tr><td><code>PUT /api/agent-instances/:id/playbooks</code></td><td><code>playbooks</code></td><td><code>AgentInstance</code></td></tr>
          <tr><td><code>GET /api/installations</code></td><td><code>?agent=</code> (required)</td><td><code>AgentInstallation[]</code></td></tr>
          <tr><td><code>PUT /api/installations</code></td><td><code>agentId</code>, <code>kind</code> (<code>tool</code> | <code>application</code> | <code>mcp</code>), <code>id</code>, <code>config?</code></td><td>Installs; returns <code>AgentInstance</code>.</td></tr>
          <tr><td><code>DELETE /api/installations</code></td><td>same body</td><td>Uninstalls; returns <code>AgentInstance</code>.</td></tr>
          <tr><td colSpan={3}><strong>Conversations &amp; runs</strong></td></tr>
          <tr><td><code>GET /api/conversations</code></td><td><code>?agent=</code> (required)</td><td><code>Conversation[]</code></td></tr>
          <tr><td><code>POST /api/conversations</code></td><td><code>agentId</code>, <code>id?</code>, <code>workspaceId?</code>, <code>title?</code>, <code>context?</code></td><td><code>201</code> <code>Conversation</code></td></tr>
          <tr><td><code>PATCH /api/conversations/:id</code></td><td><code>agentId</code>, <code>title?</code> (1–120 chars), <code>context?</code></td><td><code>Conversation</code></td></tr>
          <tr><td><code>GET /api/conversations/:id/messages</code></td><td><code>?agent=</code> (required), <code>offset</code>, <code>limit</code> (1–500, default 100 = latest page)</td><td><code>FoundryConversationTranscript</code></td></tr>
          <tr><td><code>POST /api/conversations/:id/messages</code></td><td><code>agentId</code>, <code>message</code>, <code>payload?</code>, <code>context?</code></td><td><code>202</code> <code>FoundryRun</code></td></tr>
          <tr><td><code>POST /api/agents/:route/runs</code></td><td><code>FoundryRequest</code> (string <code>message</code>)</td><td><code>202</code> <code>FoundryRun</code></td></tr>
          <tr><td><code>GET /api/runs</code></td><td><code>?agent=</code> (definition route)</td><td><code>FoundryRun[]</code></td></tr>
          <tr><td><code>GET /api/runs/:id</code></td><td>—</td><td><code>FoundryRun</code> or <code>404</code></td></tr>
          <tr><td><code>GET /api/runs/:id/events</code></td><td>—</td><td>Up to 5 000 events of that run.</td></tr>
          <tr><td><code>POST /api/runs/:id/cancel</code></td><td>—</td><td><code>{"{ cancelled: boolean }"}</code></td></tr>
          <tr><td><code>POST /api/runs/:id/steer</code></td><td><code>message</code> (or <code>input</code> / <code>guidance</code>)</td><td><code>202</code> <code>{"{ fromRunId, interrupted, run }"}</code></td></tr>
          <tr><td><code>GET /api/events</code></td><td><code>runId</code>, <code>agent</code>, <code>category</code>, <code>after</code>, <code>limit</code></td><td>JSON array, or SSE with <code>Accept: text/event-stream</code></td></tr>
          <tr><td colSpan={3}><strong>Approvals</strong></td></tr>
          <tr><td><code>GET /api/approvals</code></td><td><code>runId</code> (or <code>run_id</code>), <code>status</code></td><td><code>FoundryApproval[]</code>, oldest first</td></tr>
          <tr><td><code>POST /api/approvals/:id</code></td><td><code>decision</code>: <code>&quot;approve&quot;</code> | <code>&quot;deny&quot;</code></td><td><code>FoundryApproval</code></td></tr>
          <tr><td colSpan={3}><strong>Workspaces</strong></td></tr>
          <tr><td><code>GET</code> / <code>PUT /api/workspaces/:id/entries</code></td><td>PUT: <code>key</code>, <code>value</code></td><td>entries / <code>WorkspaceEntry</code></td></tr>
          <tr><td><code>GET</code> / <code>POST /api/workspaces/:id/inbox</code></td><td>POST: <code>topic</code>, <code>payload?</code>, <code>agentId?</code>, <code>conversationId?</code></td><td>items / <code>201</code> item (<code>pending</code>)</td></tr>
          <tr><td><code>PATCH /api/workspaces/:id/inbox/:itemId</code></td><td><code>status</code>: <code>pending</code> | <code>resolved</code> | <code>dismissed</code></td><td><code>SharedInboxItem</code></td></tr>
          <tr><td><code>GET</code> / <code>POST /api/workspaces/:id/tasks</code></td><td>POST: <code>title</code>, <code>detail?</code>, <code>agentId?</code>, <code>conversationId?</code></td><td>tasks / <code>201</code> task (<code>open</code>)</td></tr>
          <tr><td><code>PATCH /api/workspaces/:id/tasks/:taskId</code></td><td><code>status</code>: <code>open</code> | <code>in-progress</code> | <code>completed</code> | <code>cancelled</code></td><td><code>FoundryTask</code></td></tr>
          <tr><td><code>GET /api/workspaces/:id/environment</code></td><td><code>?agent=</code>, <code>?conversation=</code></td><td>Non-secret <code>EnvironmentValue[]</code></td></tr>
          <tr><td colSpan={3}><strong>Automation &amp; integrations</strong></td></tr>
          <tr><td><code>GET /api/activations</code></td><td><code>?workspace=</code></td><td>Schedule and sleep records.</td></tr>
          <tr><td><code>GET</code> / <code>PUT /api/playbook-subscriptions</code></td><td>GET <code>?workspace=</code>; PUT a <code>PlaybookSubscription</code></td><td>subscriptions / the saved one</td></tr>
          <tr><td><code>DELETE /api/playbook-subscriptions/:id</code></td><td>—</td><td><code>{"{ removed: boolean }"}</code></td></tr>
          <tr><td><code>GET /api/transmissions</code></td><td>—</td><td>Compiled transmission manifest.</td></tr>
          <tr><td><code>POST /api/transmissions/:routeId/fire</code></td><td><code>eventId</code>, <code>threadKey</code>, <code>conversationKey?</code>, <code>conversationScope?</code> (<code>route</code> | <code>agent</code>), <code>raw</code></td><td><code>202</code> runs started (an event id is delivered once)</td></tr>
          <tr><td><code>POST /api/transmissions/:routeId/deliver</code></td><td><code>agentId</code>, <code>runId</code>, <code>payload</code></td><td>Outbound adapter output.</td></tr>
          <tr><td><code>GET /api/application-connections</code></td><td>—</td><td>Connection states.</td></tr>
          <tr><td><code>POST /api/application-connections/:id/reconnect</code></td><td>—</td><td><code>{"{ ok: true }"}</code></td></tr>
          <tr><td><code>GET /api/accounts</code></td><td>—</td><td>Safe account summaries (no secrets).</td></tr>
          <tr><td><code>GET</code> / <code>PUT /api/routes</code>, <code>DELETE /api/routes/:id</code></td><td>PUT a <code>Route</code></td><td>routes / route / <code>{"{ removed: true }"}</code></td></tr>
          <tr><td><code>GET</code> / <code>PUT /api/bindings</code>, <code>DELETE /api/bindings/:id</code></td><td>PUT an <code>AgentBinding</code></td><td>bindings / binding / <code>{"{ removed: true }"}</code></td></tr>
          <tr><td><code>POST /api/grants/resolve</code></td><td><code>runId</code>, <code>agentId</code>, <code>originRouteId?</code></td><td><code>RunGrant</code></td></tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        <code>PUT /api/installations</code> reads only <code>agentId</code>, <code>kind</code>,{" "}
        <code>id</code> and <code>config</code>; an <code>accountId</code> in the body is dropped.
        To install an application bound to an account over HTTP, send the full list with{" "}
        <code>PATCH /api/agent-instances/:id</code> (<code>configureAgent</code>), which keeps{" "}
        <code>accountId</code>.
      </p></div>

      <h3 id="events">Live event streams</h3>
      <p>
        <code>GET /api/events</code> returns the latest 500 matching events as JSON (<code>limit</code>{" "}
        up to 5 000). Send <code>Accept: text/event-stream</code> and the same URL first replays
        matching retained events, then pushes new ones as they happen:
      </p>
      <CodeBlock filename="terminal" language="bash" code={`curl -N -H 'accept: text/event-stream' \\
  'http://127.0.0.1:4141/api/events?runId=RUN_ID'

: glove-foundry

id: 412
data: {"id":"…","sequence":412,"timestamp":"…","type":"agent.text_delta","category":"model","agent":"support","runId":"RUN_ID","data":{"text":"Order 1042 "}}`} />
      <ul>
        <li>Each frame carries <code>id: &lt;sequence&gt;</code>. To resume after a disconnect, pass <code>?after=&lt;last sequence&gt;</code>; the <code>Last-Event-ID</code> header is not read.</li>
        <li>A <code>: heartbeat</code> comment is written every 15 s. <code>/api/events</code> streams stay open; <code>/v1/runs/:id/events</code> streams close after the run&apos;s terminal event.</li>
        <li>Events live in memory (<code>observability.maxEvents</code>, default 10 000) and are not persisted across restarts. Durable history is the conversation store; see <Link href="/foundry/docs/observability">Inspector &amp; WebChat</Link>.</li>
        <li><code>FoundryEvent</code> fields: <code>id</code>, <code>sequence</code>, <code>timestamp</code>, <code>type</code>, <code>category</code> (<code>agent</code>, <code>run</code>, <code>model</code>, <code>tool</code>, <code>extension</code>, <code>application</code>, <code>inbox</code>, <code>memory</code>, <code>mcp</code>, <code>activation</code>, <code>system</code>, <code>log</code>), <code>agent?</code>, <code>runId?</code>, <code>data</code>. Events emitted inside an agent process are prefixed <code>agent.</code>.</li>
      </ul>

      <h3 id="health">Health checks</h3>
      <p>
        <code>GET /health</code> returns <code>FoundryHealth</code>:{" "}
        <code>{"{ ok, execution, environment, activations, agents, capabilities, surfaces }"}</code>.{" "}
        <code>ok</code> is true when the execution daemon, its environment and the activation
        scheduler all answer a ping; the last three fields are counts.{" "}
        <code>GET /health/detailed</code> adds <code>connections</code> and the full retained{" "}
        <code>runs</code> list, so keep it off public load-balancer probes. Both pass through{" "}
        <code>requestAuthorization</code> when it is configured.
      </p>

      <h2 id="runs-api">/v1/runs automation API</h2>
      <p>
        Fire work from anything that can send HTTP, get a run id back immediately, and
        check on it later. Runs land in a durable conversation, so a nightly job can keep
        one conversation per job name.
      </p>
      <table>
        <thead><tr><th>Endpoint</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td><code>POST /v1/runs</code></td><td><code>202</code> <code>FoundryRun</code> + <code>x-foundry-conversation-id</code> header</td></tr>
          <tr><td><code>GET /v1/runs/:id</code></td><td><code>FoundryRun</code> or <code>404</code></td></tr>
          <tr><td><code>GET /v1/runs/:id/events</code></td><td>JSON array, or SSE with <code>Accept: text/event-stream</code> (closes when the run ends); <code>after</code> and <code>category</code> filters apply</td></tr>
          <tr><td><code>POST /v1/runs/:id/stop</code></td><td><code>{"{ id, stopped: boolean }"}</code></td></tr>
          <tr><td><code>POST /v1/runs/:id/steer</code></td><td><code>202</code> <code>{"{ fromRunId, interrupted, run }"}</code>; body <code>input</code>, <code>message</code> or <code>guidance</code></td></tr>
          <tr><td><code>GET /v1/approvals</code>, <code>POST /v1/approvals/:id</code></td><td>Same as the <code>/api/approvals</code> pair</td></tr>
          <tr><td><code>GET /v1/capabilities</code></td><td>Which protocols and controls this server supports</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>POST /v1/runs field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>model</code> or <code>agent_id</code></td><td>Required. An agent instance id, or a definition route that has exactly one instance. Foundry never creates an instance here.</td></tr>
          <tr><td><code>input</code> or <code>message</code></td><td>Required. A string or an array of Glove content parts.</td></tr>
          <tr><td><code>conversation_id</code></td><td>Conversation key. A key starting with <code>control-</code> (under 128 chars) is used verbatim; any other key maps to a stable <code>control-&lt;hash&gt;</code> id per instance; no key starts a new conversation.</td></tr>
          <tr><td><code>user</code></td><td>Fallback conversation key when <code>conversation_id</code> is absent.</td></tr>
          <tr><td><code>context</code></td><td>Object merged into <code>request.context</code>, plus <code>protocol: &quot;foundry-control&quot;</code>.</td></tr>
        </tbody>
      </table>
      <p>
        An <code>x-foundry-conversation-id</code> request header overrides both keys. The
        response header always carries the real conversation id; send it back to continue.
      </p>
      <CodeBlock filename="terminal" language="bash" code={`# 1. Start a run. 202 Accepted; the body is the FoundryRun.
curl -si http://127.0.0.1:4141/v1/runs \\
  -H 'content-type: application/json' \\
  -d '{"model":"support-acme","input":"Check every open order for delays.","conversation_id":"nightly-audit","context":{"trigger":"cron"}}'

# 2. Poll it.
curl -s http://127.0.0.1:4141/v1/runs/RUN_ID

# 3. Or follow it live; the stream closes after run.completed / run.failed / run.cancelled.
curl -N -H 'accept: text/event-stream' http://127.0.0.1:4141/v1/runs/RUN_ID/events

# 4. Change direction, or stop.
curl -s -X POST http://127.0.0.1:4141/v1/runs/RUN_ID/steer \\
  -H 'content-type: application/json' -d '{"input":"Only check orders placed this week."}'
curl -s -X POST http://127.0.0.1:4141/v1/runs/RUN_ID/stop`} />
      <CodeBlock filename="GET /v1/capabilities (protocols)" language="json" code={`{
  "object": "foundry.capabilities",
  "protocols": {
    "native": true,
    "openaiChatCompletions": { "streaming": true, "multimodalInput": true },
    "openaiResponses": { "streaming": true, "multimodalInput": true },
    "runControl": {
      "create": true, "status": true, "events": true, "stop": true, "steer": true,
      "steeringMode": "interrupt-and-restart"
    },
    "approvals": { "list": true, "resolve": true, "default": "deny" }
  },
  "runtime": { "ok": true, "execution": true, "environment": true, "activations": true, "agents": 1, "capabilities": 3, "surfaces": 0 }
}`} />

      <h2 id="contracts">Request, run and result contracts</h2>
      <table>
        <thead><tr><th>FoundryRequest</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>agentId</code>, <code>conversationId</code>, <code>workspaceId</code></td><td>Required. Must belong together.</td></tr>
          <tr><td><code>message</code></td><td><code>FoundryMessageInput</code>: a string or Glove <code>ContentPart[]</code>.</td></tr>
          <tr><td><code>payload?</code></td><td>Arbitrary JSON for your resolvers and <code>run</code> handler (<code>ctx.request.payload</code>).</td></tr>
          <tr><td><code>context?</code></td><td>Per-run key/values (<code>ctx.request.context</code>). The <code>/v1</code> endpoints add <code>protocol</code>; steered runs carry <code>steeredFromRunId</code> and <code>steeringMode</code>.</td></tr>
          <tr><td><code>source?</code></td><td><code>{"{ kind: \"direct\" | \"transmission\" | \"activation\" | \"spawn\" | \"background\", … }"}</code>; <code>send</code> sets <code>direct</code>.</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>FoundryRun</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>id</code>, <code>agent</code></td><td>Run id and definition route.</td></tr>
          <tr><td><code>status</code></td><td><code>pending</code> | <code>running</code> | <code>completed</code> | <code>failed</code> | <code>cancelled</code></td></tr>
          <tr><td><code>input</code></td><td>The <code>FoundryRequest</code>.</td></tr>
          <tr><td><code>output?</code></td><td><code>FoundryResult</code> once completed.</td></tr>
          <tr><td><code>agentId?</code>, <code>conversationId?</code>, <code>workspaceId?</code></td><td>Copied from the request.</td></tr>
          <tr><td><code>error?</code>, <code>attempts</code>, <code>maxAttempts</code>, <code>timeoutMs</code></td><td>Failure text and execution policy.</td></tr>
          <tr><td><code>createdAt</code>, <code>startedAt?</code>, <code>completedAt?</code></td><td>ISO timestamps.</td></tr>
        </tbody>
      </table>
      <p>
        <code>FoundryResult</code> is{" "}
        <code>{"{ status: \"completed\" | \"suspended\", value, agentId, conversationId, workspaceId, suspension? }"}</code>.{" "}
        For a normal model loop <code>value</code> is the final assistant message text; with a{" "}
        <code>run</code> or <code>spawn</code> handler it is whatever the handler returned,
        JSON-serialized. <code>status</code> is <code>&quot;suspended&quot;</code> with{" "}
        <code>suspension: {"{ commandId, wakeAt }"}</code> when the agent put itself to sleep (see{" "}
        <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>).
      </p>

      <h3 id="messages">Messages: Glove content parts</h3>
      <p>
        Foundry accepts exactly what <code>Glove.processRequest</code> accepts: a string, or an
        array of parts <code>{"{ type: \"text\" | \"image\" | \"video\" | \"document\", text?, name?, source?: { type: \"base64\" | \"url\", media_type, data?, url? } }"}</code>.
        Media parts may carry a human-facing <code>name</code>. Inside the run, text parts are
        joined with newlines into the message text; a media-only message gets the text{" "}
        <code>[multimodal message]</code>. The whole history, including media, reaches lazy
        assembly as native Glove messages.
      </p>
      <CodeBlock filename="scripts/ask-support.ts" language="typescript" code={`import { readFile } from "node:fs/promises";
// foundry, support and conversation as in the first example on this page

const invoice = (await readFile("invoice-1042.pdf")).toString("base64");

const handle = await foundry.send(support.id, conversation.id, [
  { type: "text", text: "The customer sent a photo of the box and the invoice." },
  {
    type: "image",
    name: "damaged-box.jpg",
    source: { type: "url", media_type: "image/jpeg", url: "https://example.com/damaged-box.jpg" },
  },
  {
    type: "document",
    name: "invoice-1042.pdf",
    source: { type: "base64", media_type: "application/pdf", data: invoice },
  },
]);`} />
      <p>
        JSON bodies are capped at 1 MB (1 048 576 bytes) by default. Set{" "}
        <code>server.messageBodyBytes</code> in <code>foundry.config.ts</code> (an integer from
        1 048 576 to 134 217 728) to accept larger base64 media. The raised limit applies only
        to message-bearing endpoints: <code>POST /api/conversations/:id/messages</code>,{" "}
        <code>/api/runs/:id/steer</code>, <code>/v1/chat/completions</code>,{" "}
        <code>/v1/responses</code>, <code>/v1/runs</code> and <code>/v1/runs/:id/steer</code>.
        Everything else, including <code>/api/agents/:route/runs</code>, stays at 1 MB.
      </p>

      <h2 id="run-handlers">Custom run handlers</h2>
      <p>
        Give a route deterministic behaviour — an order-status lookup, an ingestion step, a
        wrapper that post-processes the model&apos;s answer — by setting <code>run</code> on{" "}
        <code>defineAgent</code> (or exporting <code>run</code> from a convention module). It
        runs after lazy assembly with the assembled runnable and a handler context; its return
        value becomes <code>run.output.value</code>. Without a <code>model</code>, the agent is
        model-free: calling the standard loop throws, so the handler must not.
      </p>
      <CodeBlock filename="agents/order-status/agent.ts" language="typescript" code={`import { defineAgent } from "glove-foundry";
import { z } from "zod";

const Payload = z.object({ orderId: z.string() });

export default defineAgent({
  description: "Deterministic order-status endpoint; no model is configured",
  run: async (_agent, { input, emit }) => {
    // input is the FoundryRequest; payload arrives untouched from send(..., { payload }).
    const { orderId } = Payload.parse(input.payload);
    const status = orderId === "1042" ? "shipped" : "processing"; // your code: query the order system
    emit({ type: "order-status.checked", data: { orderId, status } });
    return { orderId, status }; // becomes run.output.value
  },
});`} />
      <p>
        Call it like any other agent:{" "}
        <code>foundry.send(agent.id, conversation.id, &quot;status&quot;, {"{ payload: { orderId: \"1042\" } }"})</code>.
        To keep the model and add logic around it, call <code>ctx.defaultRun(message?)</code>{" "}
        (the normal Glove loop) inside <code>run</code> and return what you like. The full field
        list is on <Link href="/foundry/docs/composition">defineAgent &amp; assembly</Link>.
      </p>

      <h2 id="programmatic">Embedding the runtime</h2>
      <p>
        <code>glove foundry dev</code> and <code>start</code> do this for you. For tests or a
        custom host process, both classes are public exports of <code>glove-foundry</code>:
      </p>
      <CodeBlock filename="scripts/serve.ts" language="typescript" code={`import { resolve } from "node:path";
import { FoundryRuntime, FoundryServer } from "glove-foundry";
import application from "../foundry.application.js";
import config from "../foundry.config.js";

const rootDir = process.cwd();
const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  // Lets agent processes load the application's conversationStore and data adapter.
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
});
await runtime.start();

const server = new FoundryServer(runtime, {
  host: "127.0.0.1",
  port: 4141, // 0 picks a free port
  messageBodyBytes: 8 * 1024 * 1024,
});
const { url } = await server.listen();
console.log(\`Foundry listening on \${url}\`);

// The runtime exposes the same operations in-process.
const agent = await runtime.createAgent("support", { workspaceId: "acme" });
const conversation = await runtime.createConversation(agent.id);
const run = await runtime.send(agent.id, conversation.id, "Where is order 1042?");
const done = await runtime.waitForRun(run.id, { timeoutMs: 120_000 });
console.log(done?.status, done?.output);

await server.close();
await runtime.stop();`} />
      <p>
        <code>FoundryServerOptions</code> is <code>{"{ host?, port?, branding?, messageBodyBytes? }"}</code>.{" "}
        <code>listen()</code> resolves <code>{"{ host, port, url }"}</code> and throws on a
        non-loopback host without <code>requestAuthorization</code>. Agent turns always run in a
        separate managed execution daemon, not in this process; see{" "}
        <Link href="/foundry/docs/browser-and-sandbox">Browser &amp; sandbox</Link> for the
        execution model.
      </p>
    </article>
  );
}
