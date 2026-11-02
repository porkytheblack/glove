import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Inspector & WebChat",
  description:
    "The built-in Foundry inspector: pages and URLs, WebChat, runs opened like DevTools (Network, Console, Context), shortcuts, the event envelope, custom subscribers, event export and branding.",
};

export default function ObservabilityPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Inspector &amp; WebChat</span>
      <h1>Inspector &amp; WebChat</h1>
      <p className="blog-lede">
        Every Foundry server ships an inspector at its root URL. Browse definitions and
        instances, chat with any instance over its real stored history, start runs, and approve
        or deny tool calls. Open a run the way you would open a page in a browser’s DevTools:
        every model request with the system prompt, messages, memory and tools it was sent,
        every tool call with its input and result, the run’s log, and what the agent had to work
        with. The inspector is a client of the same HTTP API your code uses, and it keeps no state
        of its own.
      </p>

      <h2 id="open">Open it</h2>
      <CodeBlock filename="terminal" language="bash" code={`glove foundry dev
# Glove Foundry
#   Local:    http://127.0.0.1:4141`} />
      <p>
        The server returns the inspector for every <code>GET</code> path outside{" "}
        <code>/api/*</code>, <code>/v1/*</code> and <code>/health*</code>, so every view below is a
        real, bookmarkable URL. When the application sets <code>requestAuthorization</code>, the
        inspector, its API calls and its event stream all pass through it (see{" "}
        <Link href="/foundry/docs/deploy#authorization">Deploy &amp; security</Link>).
      </p>

      <h2 id="pages">Pages</h2>
      <table>
        <thead><tr><th>URL</th><th>Page</th><th>What it answers</th></tr></thead>
        <tbody>
          <tr><td><code>/</code></td><td>Overview</td><td>Is the runtime healthy, what is running, and which approvals are pending?</td></tr>
          <tr><td><code>/agents</code></td><td>Agents</td><td>Which definitions exist and which instances were created from them.</td></tr>
          <tr><td><code>/agents/:definitionId</code></td><td>Agent definition</td><td>What the file route can assemble: lazy fields, catalogue, layers, subscribers, schedules, playbooks.</td></tr>
          <tr><td><code>/instances/:agentId</code></td><td>Agent instance</td><td>Its context, installations, playbooks, conversations and runs.</td></tr>
          <tr><td><code>/chat</code>, <code>/chat/:conversationId?agent=:agentId</code></td><td>Chat (WebChat)</td><td>What this instance and conversation actually said; continue, stop or redirect it.</td></tr>
          <tr><td><code>/runs</code>, <code>/runs?status=&amp;source=&amp;q=</code></td><td>Runs</td><td>Which invocations happened, from which source, with what status and duration.</td></tr>
          <tr><td><code>/runs/:runId</code>, <code>?tab=&amp;item=&amp;pane=</code></td><td>Run</td><td>What the model saw and did at each step: requests, tool calls, log, context and outcome.</td></tr>
          <tr><td><code>/automations</code></td><td>Automations</td><td>Schedules, sleeping runs, playbook subscriptions and inbound application connections.</td></tr>
          <tr><td><code>/integrations</code></td><td>Integrations</td><td>Transmissions, safe account references, routes and bindings.</td></tr>
          <tr><td><code>/workspaces</code>, <code>/workspaces/:workspaceId</code></td><td>Workspaces</td><td>Shared entries, inbox items, tasks and non-secret environment values.</td></tr>
        </tbody>
      </table>
      <p>
        The inspector displays installations but does not change them: install and uninstall with{" "}
        <code>client.install</code> / <code>PUT /api/installations</code> (see{" "}
        <Link href="/foundry/docs/runtime">Client &amp; HTTP API</Link>). It can create instances
        and conversations, start, stop and redirect runs, and resolve approvals. Every truncated
        id has a copy button.
      </p>

      <h2 id="webchat">WebChat</h2>
      <p>
        <strong>Chat</strong> is a browser client for a real instance and conversation, not a
        second transcript system:
      </p>
      <ul>
        <li>The left rail lists runtime instances and each instance’s conversations. <strong>New conversation</strong> (or <code>c</code>) creates one; the first text turn becomes its title, and <strong>Rename</strong> changes the title without changing the id.</li>
        <li>History is the exact native Glove <code>Message</code> list read from the agent’s <code>store</code> or the application’s <code>conversationStore</code>, including tool calls and results. It loads the latest 100 messages; <strong>Earlier</strong> and <strong>Newer</strong> page through longer sessions. Every refresh reloads it from the server.</li>
        <li>The header shows the store’s turn and token counters. <strong>Export</strong> downloads the loaded transcript page as JSON.</li>
        <li>Attach files with the paperclip: images, video and other documents are sent as base64 content parts, so large files need a higher <code>server.messageBodyBytes</code> than the 1 MB default.</li>
        <li><code>Enter</code> sends, <code>Shift+Enter</code> adds a line.</li>
        <li>While a run is active, streamed <code>text_delta</code> events form a temporary reply that is replaced by the stored message when the run settles; output buffered by a failed provider attempt never appears.</li>
        <li><strong>Stop</strong> cancels the active run cooperatively. Sending while a run is active becomes <strong>Redirect</strong>: Foundry interrupts the run and starts your message as a replacement run in the same conversation (see <Link href="/foundry/docs/approvals">Approvals &amp; steering</Link>).</li>
      </ul>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          With no store configured, the page says “This agent has no conversation store” and shows
          no history. With a <code>new MemoryStore(...)</code> store (the templates’ default) the
          history is empty too, because each run executes in its own process. Configure a durable
          store first: <Link href="/foundry/docs/persistence#transcripts">Persistence</Link>.
        </p>
      </div>

      <h2 id="runs">Following a run</h2>
      <p>
        Open <strong>Runs</strong>, then a run. A strip across the top gives its status, duration,
        number of model requests and tool calls, tokens and agent instance. Below it are four
        views, switched with <code>1</code>–<code>4</code>: <strong>Summary</strong>,{" "}
        <strong>Network</strong>, <strong>Console</strong> and <strong>Context</strong>. The view,
        the open request and its pane are all in the URL, so a link opens someone else on the same
        step. The screenshots are runs of the{" "}
        <Link href="/foundry/docs/rebuilds/meta-muse">Meta Muse rebuild</Link> on Claude Sonnet 5.5
        through OpenRouter, with its sample accounts and offline stand-in browsers.
      </p>

      <h3 id="network">Network</h3>
      <figure>
        <img src="/foundry/inspector/network.webp" width={2160} height={1500} alt="The Network view of a run: model requests and tool calls in order, with type, status, initiator, size, time and a waterfall. Three tool calls failed, one of them blocked by the Sentinel." />
        <figcaption>
          Every model request (a square) and tool call (a circle) of a run, in order. Muse tries to
          book a restaurant. The Sentinel blocks a site Rosa hasn’t allowed, she allows it, and the
          page still fails to load: the model asked for HTTPS, and the offline demo serves its sample
          sites over HTTP. At #5 Glove compacts the conversation. The REPL’s own calls sit under the{" "}
          <code>execute_js</code> call that ran them.
        </figcaption>
      </figure>
      <ul>
        <li><strong>Initiator</strong> says what led to a row: a request follows <code>run input</code> or the tools of the previous request (<code>after execute_browser</code>), and a tool call comes from the request whose response asked for it. Click it to jump there.</li>
        <li><strong>Size</strong> is tokens in → out for a model request and the size of the result for a tool call. <strong>Time</strong> and the <strong>Waterfall</strong> show how long each step took and when.</li>
        <li>Filter by text (name, input, result or reply) and by <strong>Model</strong>, <strong>Tools</strong> or <strong>Errors</strong>. The footer totals requests, tool calls, tokens and cache reads, and time spent in the model and in tools.</li>
      </ul>
      <p>
        Click a row, or walk them with <code>j</code> and <code>k</code>, to open it beside the
        list (<code>Esc</code> closes it). A model request has these panes:
      </p>
      <table>
        <thead><tr><th>Pane</th><th>What it shows</th></tr></thead>
        <tbody>
          <tr><td>Overview</td><td>Request id, model, status, duration, tokens and cache, stop reason, initiator, and the tool calls in its response</td></tr>
          <tr><td>Prompt</td><td>The system prompt this request was sent</td></tr>
          <tr><td>Messages</td><td>The conversation as this request sent it. What was already sent folds away, so what’s new is at the end, and every tool call and result links to its row</td></tr>
          <tr><td>Context</td><td>The runtime context at the end of the request: memory, goals, forms, or any context provider. Each entry is marked new, changed or the same as the last request</td></tr>
          <tr><td>Tools</td><td>Each tool the model was offered, with its description and input schema</td></tr>
          <tr><td>Response</td><td>What the model sent back, or the error that ended the request</td></tr>
          <tr><td>Raw</td><td>The recorded events</td></tr>
        </tbody>
      </table>
      <p>
        <strong>Copy request</strong> copies the request as JSON (model, system prompt, messages,
        runtime context and tools), to replay a step against a model or attach it to an issue.
      </p>
      <figure>
        <img src="/foundry/inspector/request-messages.webp" width={2160} height={1500} alt="A model request open beside the list, on its Messages pane: earlier messages folded, then the new request_access call and Rosa's answer." />
        <figcaption>Request #3 of the booking. The nine messages already sent fold away. What’s new is at the end: Muse asking to reach the restaurant, and Rosa’s answer.</figcaption>
      </figure>
      <figure>
        <img src="/foundry/inspector/request-context.webp" width={2160} height={1500} alt="A model request's Context pane: today's date and Rosa's memory that Priya is vegetarian, added at the end of the request." />
        <figcaption>Asked “Who’s vegetarian?”, the request carried what Rosa told Muse earlier on WhatsApp, saved to memory in Muse’s own words.</figcaption>
      </figure>
      <p>
        A tool call has <strong>Overview</strong> (call id, duration, the request that made it, and
        its approval), <strong>Input</strong>, <strong>Result</strong> (JSON held in a string opens as
        a tree) and <strong>Raw</strong>.
      </p>
      <figure>
        <img src="/foundry/inspector/tool-call.webp" width={2160} height={1500} alt="A tool call, gmail_send, open beside the list: called by the first request, approved by Rosa, with the email as a tree." />
        <figcaption>An email to Leo that waited for Rosa: the request that called it, when she approved it, and exactly what it sent.</figcaption>
      </figure>

      <h3 id="console">Console</h3>
      <figure>
        <img src="/foundry/inspector/console.webp" width={2160} height={1500} alt="The Console view: one line per event, model requests and responses with tokens, tool calls, a Sentinel block and a failed page load in red, and an approval wait in amber." />
        <figcaption>The same booking as a log: requests and responses with their tokens, the blocked call and the failed page load in red, and the wait for Rosa’s approval in amber.</figcaption>
      </figure>
      <p>
        The run as a log, one line per event, at DevTools’ levels: errors and warnings are coloured
        (a failed tool call, a failed or retried run, stderr, an approval being waited on), and{" "}
        <strong>Default levels</strong> hides verbose detail such as assembly and streamed text.
        A streamed reply is one line, not one per chunk. Filter by text and by source; click a
        line for its data as a tree, to copy it, or <strong>Open in Network</strong>. A live run’s
        console stays at the bottom unless you scroll up.
      </p>

      <h3 id="context">Context</h3>
      <figure>
        <img src="/foundry/inspector/context.webp" width={2160} height={1500} alt="The Context view: a tree of the system prompt, runtime context, tools and messages per request, the run's input and output, the agent instance's context, installations and playbooks, and memory." />
        <figcaption>What the agent had to work with, like DevTools’ Application panel. Here, the instance’s stored context: Rosa’s details, the sites the Sentinel now allows, and her browser profile.</figcaption>
      </figure>
      <ul>
        <li><strong>Model request</strong>: system prompt, runtime context, tools and messages, as of the request you choose (the latest by default). A run with more than one system prompt, for example with a subagent, lists each with the requests that used it.</li>
        <li><strong>Run</strong>: its input, and its output or error.</li>
        <li><strong>Agent</strong>: the instance’s stored context, installations and playbooks, with links to the instance, workspace and conversation.</li>
        <li><strong>Memory</strong>: goals, facts and forms, and the memory events the run recorded.</li>
      </ul>

      <h3 id="summary">Summary</h3>
      <p>
        The run’s phases (accepted, assembled, agent work, outcome), its output and input, the
        slowest steps, and every failed request or tool call, each linking to Network. A failed
        run states its error at the top of the page, and pending approvals show there with their
        exact input. <strong>Export trace</strong> downloads the run and every event as JSON;{" "}
        <strong>Run again</strong> reopens the run drawer with the same instance and message. The
        inspector shows what was sent, called and returned, never a model’s hidden reasoning.
      </p>

      <h3 id="model-requests">What each model request records</h3>
      <p>
        Glove reports every model call to subscribers that ask for it, as{" "}
        <code>model_request</code> (system prompt, messages, tools) and{" "}
        <code>model_request_end</code> (outcome, response, tokens). A run records them compactly,
        so a long conversation isn’t copied into every request:
      </p>
      <ul>
        <li>The system prompt and tools are recorded in full the first time a run sends them, then by hash.</li>
        <li>Messages are recorded as a change against the previous request with the same system prompt; the inspector puts each request’s list back together.</li>
        <li>Runtime context is recorded with every request.</li>
        <li>Text and JSON are cut at 16,000 characters (the system prompt at 64,000), media becomes a placeholder, a request keeps at most about 400 KB of messages, newest first, and <code>renderData</code> and echoed provider reasoning are left out.</li>
      </ul>
      <p>
        A message whose request has left the event buffer shows as <em>not retained</em>. To keep
        model requests out of the event stream entirely:
      </p>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`export default defineConfig({ observability: { modelRequests: false } });`} />
      <p>
        A <strong>Conversation guidance</strong> card appears on Summary when goals, facts, forms
        or context providers are mounted: goal progress, fact and claim counts, form status, never
        answer values or fact bodies.
      </p>
      <h3 id="runs-list">The Runs list</h3>
      <p>The Runs list keeps its filters in the query string, so a filtered view is a shareable link:</p>
      <table>
        <thead><tr><th>Parameter</th><th>Values</th></tr></thead>
        <tbody>
          <tr><td><code>status</code></td><td><code>running</code> (includes pending), <code>completed</code>, <code>failed</code>, <code>cancelled</code></td></tr>
          <tr><td><code>source</code></td><td>A recorded source kind, such as <code>direct</code>, <code>transmission</code>, <code>activation</code>, <code>spawn</code></td></tr>
          <tr><td><code>q</code></td><td>Free text matched against agent, run id, instance id and recorded input</td></tr>
        </tbody>
      </table>
      <p>
        <code>/runs?status=failed&amp;q=invoice</code> opens the failed runs that mention an
        invoice. Start new work from any page with <strong>New run</strong>: choose a definition and
        an existing instance or “Create a new instance”; the inspector reuses that instance’s
        latest conversation (or creates one) and opens the new run.
      </p>

      <h2 id="live">Live updates, search and keyboard</h2>
      <p>
        The inspector subscribes to <code>/api/events</code> over server-sent events and also
        reconciles on a slow timer. Bursts of events are coalesced into one refresh, and a refresh
        keeps your scroll position (each pane of a run too), expanded rows, open panels and filter
        text. A run’s page reads that run’s own events, then only new ones
        (<code>/api/runs/:id/events?after=&lt;sequence&gt;</code>). Relative times and running
        durations tick every second.
      </p>
      <table>
        <thead><tr><th>Key</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td><code>⌘K</code> / <code>Ctrl+K</code></td><td>Search pages, definitions, instances and retained runs</td></tr>
          <tr><td><code>j</code> / <code>k</code></td><td>Move down / up the current list; on a run’s Network view, open the next / previous request</td></tr>
          <tr><td><code>1</code>–<code>4</code></td><td>On a run: Summary, Network, Console, Context</td></tr>
          <tr><td><code>Enter</code> or <code>o</code></td><td>Open the highlighted row</td></tr>
          <tr><td><code>/</code></td><td>Focus the filter (runs, Network, Console), or open search elsewhere</td></tr>
          <tr><td><code>c</code></td><td>Start a run (on Chat: a new conversation)</td></tr>
          <tr><td><code>r</code></td><td>Refresh runtime data</td></tr>
          <tr><td><code>Esc</code></td><td>Close the drawer or search; on a run, close the open request</td></tr>
          <tr><td><code>⌘Enter</code> / <code>Ctrl+Enter</code></td><td>Submit the run drawer</td></tr>
        </tbody>
      </table>

      <h2 id="events">The event envelope</h2>
      <p>Everything the inspector shows comes from one stream of <code>FoundryEvent</code> records:</p>
      <CodeBlock filename="glove-foundry" language="typescript" code={`interface FoundryEvent {
  readonly id: string;          // UUID
  readonly sequence: number;    // increasing per runtime process; restarts at 1
  readonly timestamp: string;   // ISO 8601
  readonly type: string;        // e.g. "run.completed", "agent.tool_use_result"
  readonly category: FoundryEventCategory;
  readonly agent?: string;      // the agent definition id (route), not the instance id
  readonly runId?: string;
  readonly data: unknown;       // instance, conversation and other details live here
}`} />
      <table>
        <thead><tr><th>Category</th><th>Typical types</th></tr></thead>
        <tbody>
          <tr><td><code>run</code></td><td><code>run.dispatched</code>, <code>run.started</code>, <code>run.completed</code>, <code>run.failed</code>, <code>run.cancelled</code>, <code>run.retry</code>, <code>run.timeout</code></td></tr>
          <tr><td><code>model</code></td><td><code>agent.model_request</code>, <code>agent.model_request_end</code>, <code>agent.text_delta</code>, <code>agent.model_response</code>, <code>agent.model_response_complete</code>, <code>agent.token_consumption</code></td></tr>
          <tr><td><code>tool</code></td><td><code>agent.tool_use</code>, <code>agent.tool_use_result</code></td></tr>
          <tr><td><code>agent</code></td><td><code>agent.instance.created</code>, <code>agent.instance.configured</code>, <code>conversation.created</code>, <code>conversation.updated</code></td></tr>
          <tr><td><code>application</code></td><td><code>installation.installed</code>, <code>transmission.dispatched</code>, <code>transmission.outbound.delivered</code>, playbook subscription changes</td></tr>
          <tr><td><code>activation</code></td><td><code>scheduled-action.created</code>, <code>…paused</code>, <code>…resumed</code>, <code>…cancelled</code></td></tr>
          <tr><td><code>memory</code></td><td><code>agent.foundry.guidance.state</code>, Glove memory events</td></tr>
          <tr><td><code>extension</code></td><td>Layer and subscriber mounts, hooks, skills, subagents</td></tr>
          <tr><td><code>mcp</code>, <code>inbox</code></td><td>MCP connection and discovery events; inbox activity (MCP tool calls are <code>tool</code> events)</td></tr>
          <tr><td><code>system</code></td><td>Assembly (<code>agent.foundry.assembly.*</code>), steering, approvals, and any custom event you emit</td></tr>
          <tr><td><code>log</code></td><td><code>log.stdout</code>, <code>log.stderr</code>: plain output lines from a job process</td></tr>
        </tbody>
      </table>
      <p>
        Events emitted inside a run arrive prefixed with <code>agent.</code>: a Glove{" "}
        <code>tool_use_result</code> becomes <code>agent.tool_use_result</code>, and a custom{" "}
        <code>support.work-note</code> becomes <code>agent.support.work-note</code> in category{" "}
        <code>system</code>.
      </p>

      <h2 id="work-notes">Work notes, not hidden reasoning</h2>
      <p>
        Foundry records what is observable (requests, model responses, tool calls and results,
        state changes and notes you emit) and adds no channel for a model’s private
        chain-of-thought. To show intent, have the agent publish short, safe notes. Any assembly
        resolver can emit through <code>ctx.controls.emit</code>; handlers, layers and subscribers
        get the same function as <code>context.emit</code>.
      </p>
      <CodeBlock filename="agents/support/work-note.ts" language="typescript" code={`import type { GloveFoldArgs } from "glove-core";
import type { AgentAssemblyContext } from "glove-foundry";
import { z } from "zod";

const input = z.object({ note: z.string().max(280) });

/** Lets the agent publish a short, user-safe progress note into the run trace. */
export function workNote(ctx: AgentAssemblyContext): GloveFoldArgs<z.infer<typeof input>> {
  return {
    name: "work_note",
    description:
      "Record one short progress note: what you are doing next and why. " +
      "Never include secrets, credentials or customer personal data.",
    inputSchema: input,
    async do({ note }) {
      ctx.controls.emit({ type: "support.work-note", data: { note } });
      return { status: "success", data: "noted" };
    },
  };
}`} />

      <h2 id="subscribers">Custom subscribers</h2>
      <p>
        A subscriber receives every native Glove event of a run (<code>text_delta</code>,{" "}
        <code>model_response_complete</code>, <code>tool_use</code>,{" "}
        <code>tool_use_result</code>, <code>token_consumption</code>, compaction, hook, skill and
        subagent events) without changing behaviour. One that sets <code>modelRequests: true</code>{" "}
        also gets <code>model_request</code> and <code>model_request_end</code>, whole. It runs in
        the job process. A{" "}
        <code>defineSubscriber</code> file must be in the agent’s catalogue <em>and</em> selected in{" "}
        <code>subscribers</code>; a plain <code>SubscriberAdapter</code> object can be passed in{" "}
        <code>subscribers</code> directly.
      </p>
      <CodeBlock filename="agents/support/subscribers/tool-audit.subscriber.ts" language="typescript" code={`import type { SubscriberEventDataMap } from "glove-core";
import { defineSubscriber } from "glove-foundry";

/** One compact, payload-free audit event per finished tool call. */
export default defineSubscriber({
  description: "Audit tool outcomes without recording their payloads",
  create: (context) => ({
    async record(type, data) {
      if (type !== "tool_use_result") return;
      const result = data as SubscriberEventDataMap["tool_use_result"];
      context.emit({
        type: "support.audit.tool",
        data: {
          tool: result.tool_name,
          status: result.result.status,
          durationMs: result.duration_ms,
          conversationId: context.conversationId,
        },
      });
    },
  }),
});`} />
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { composeAgent, defineAgent } from "glove-foundry";
import toolAudit from "./subscribers/tool-audit.subscriber.js";
import { workNote } from "./work-note.js";

export default defineAgent({
  description: "Answers customer questions and keeps case notes",
  // Defined subscribers must be in the catalogue AND selected in \`subscribers\`.
  components: composeAgent(toolAudit),
  subscribers: [toolAudit],
  tools: (_agent, ctx) => [workNote(ctx)],
  model: () =>
    createAdapter({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
      stream: true,
    }),
  systemPrompt:
    "You are a support agent. Before each multi-step task, call work_note with one sentence about your plan.",
});`} />
      <p>
        Run against a real runtime, one tool call produced <code>agent.support.work-note</code>,{" "}
        <code>agent.tool_use_result</code> and <code>agent.support.audit.tool</code> in the run’s
        trace.
      </p>

      <h2 id="export">Exporting events</h2>
      <p>
        Events live in an in-memory buffer of the last <code>observability.maxEvents</code>{" "}
        (default 10,000) and are gone after a restart. Read them over HTTP:
      </p>
      <table>
        <thead><tr><th>Request</th><th>Returns</th></tr></thead>
        <tbody>
          <tr><td><code>GET /api/events</code></td><td>JSON array. Query: <code>after</code> (sequence), <code>agent</code> (definition id), <code>runId</code>, <code>category</code>, <code>limit</code> (default 500, max 5,000)</td></tr>
          <tr><td><code>GET /api/events</code> with <code>Accept: text/event-stream</code></td><td>Matching retained events, then live ones. Each message is <code>id: &lt;sequence&gt;</code> plus <code>data: &lt;FoundryEvent JSON&gt;</code>; a comment heartbeat every 15 s. Resume with <code>?after=&lt;last sequence&gt;</code> (the <code>Last-Event-ID</code> header is not read).</td></tr>
          <tr><td><code>GET /api/runs/:id/events</code>, <code>GET /v1/runs/:id/events</code></td><td>One run’s events (up to 5,000). The <code>/v1</code> stream closes when the run ends.</td></tr>
          <tr><td><code>client.getEvents({"{ runId, agent, after, category }"})</code></td><td>The same JSON from the typed client.</td></tr>
        </tbody>
      </table>
      <CodeBlock filename="terminal" language="bash" code={`curl -N -H 'accept: text/event-stream' 'http://127.0.0.1:4141/api/events?category=run'`} />
      <p>
        To ship events to OpenTelemetry, a warehouse or an audit store from inside the process,
        host the runtime yourself and pass an <code>observability</code> adapter. The CLI always
        uses the built-in <code>MemoryObservabilityAdapter</code>; a custom one must implement{" "}
        <code>FoundryObservabilityAdapter</code> (<code>append</code>, which returns the stored
        event synchronously, <code>list</code>, <code>subscribe</code> and optional{" "}
        <code>clear</code>). Wrapping the built-in adapter is the shortest path:
      </p>
      <CodeBlock filename="scripts/serve.ts" language="typescript" code={`import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FoundryRuntime,
  FoundryServer,
  MemoryObservabilityAdapter,
  type FoundryEvent,
} from "glove-foundry";
import application from "../foundry.application.js";
import config from "../foundry.config.js";

const rootDir = resolve(import.meta.dirname, "..");
const exportFile = resolve(rootDir, ".data/events.ndjson");
await mkdir(resolve(rootDir, ".data"), { recursive: true });

const observability = new MemoryObservabilityAdapter({ maxEvents: 10_000 });
// Listeners run synchronously inside every append: never throw, never block.
let queue = Promise.resolve();
observability.subscribe((event: FoundryEvent) => {
  queue = queue
    .then(() => appendFile(exportFile, \`\${JSON.stringify(event)}\\n\`)) // your code: OTel, a warehouse…
    .catch(() => undefined);
});

const runtime = await FoundryRuntime.discover({
  rootDir,
  agentsDir: resolve(rootDir, "agents"),
  application,
  // Job processes import the application from this path; without it they run without your adapters.
  applicationFilePath: resolve(rootDir, "foundry.application.ts"),
  config,
  observability,
});
await runtime.start();
const server = new FoundryServer(runtime, { host: "127.0.0.1", port: Number(process.env.PORT ?? 4141) });
console.log(\`Foundry listening on \${(await server.listen()).url}\`);

const stop = async () => {
  await server.close();
  await runtime.stop();
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());`} />
      <p>
        Run it with <code>node --import tsx scripts/serve.ts</code>. Unlike the CLI, this host does
        not load <code>.env</code> files or regenerate <code>.foundry/routes.d.ts</code> (call{" "}
        <code>writeGeneratedTypes</code> if you need them). Dedupe exported events by{" "}
        <code>id</code>: <code>sequence</code> restarts with the process.
      </p>

      <h2 id="redaction">What is recorded, and what is redacted</h2>
      <ul>
        <li>
          Native Glove events are recorded as they are: model requests (system prompt, messages,
          memory and tools, recorded compactly), model responses, tool inputs and results, and
          runtime context can contain conversation content. Apply access control and retention to
          the event stream like you would to transcripts, or set{" "}
          <code>observability.modelRequests: false</code> to leave model requests out.
        </li>
        <li>
          Outbound transmission payloads are redacted by default (recorded as{" "}
          <code>{"{ redacted: true }"}</code>). Define <code>outbound.observe(input)</code> on the
          transmission to record a deliberate, secret-safe projection such as a thread id and a
          character count (see <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>).
        </li>
        <li>
          The <code>foundry.guidance.state</code> event carries progress metadata only, never form
          answers or fact bodies.
        </li>
        <li>
          Request credentials checked by <code>requestAuthorization</code> and account sessions
          never enter events. Never put secrets in instance context, tool results or emitted notes.
        </li>
        <li>
          If you enable reasoning capture on a model adapter, that text is stored on transcript
          messages like any other field; the inspector does not render it.
        </li>
      </ul>

      <h2 id="branding">Branding</h2>
      <CodeBlock filename="foundry.config.ts" language="typescript" code={`import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  branding: {
    name: "Acme Support",        // shell title; default "Glove Foundry"
    label: "Agent operations",   // line under the name; default "Runtime inspector"
    descriptor: "Console",       // browser title suffix; default "Inspector"
    accent: "#2f6fed",           // six-digit hex; anything else is ignored
  },
});`} />
      <p>
        The browser title becomes <code>&lt;name&gt; · &lt;descriptor&gt;</code>. Branding is read by{" "}
        <code>glove foundry dev</code>/<code>start</code>; a custom host passes it as{" "}
        <code>new FoundryServer(runtime, {"{ branding }"})</code>.
      </p>
    </article>
  );
}
