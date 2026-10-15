import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Inspector & WebChat",
  description:
    "The built-in Foundry inspector: pages and URLs, WebChat, run traces, shortcuts, the event envelope, custom subscribers, event export and branding.",
};

export default function ObservabilityPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Operate / Inspector &amp; WebChat</span>
      <h1>Inspector &amp; WebChat</h1>
      <p className="blog-lede">
        Every Foundry server ships an inspector at its root URL: browse definitions and
        instances, chat with any instance over its real stored history, start runs, follow
        each run’s event trace live, and approve or deny tool calls. It is a client of the
        same HTTP API your code uses, and it keeps no state of its own.
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
          <tr><td><code>/runs/:runId</code></td><td>Run detail</td><td>Which phases and events produced this outcome.</td></tr>
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

      <h2 id="runs">Runs and the run trace</h2>
      <p>
        Run detail opens with a four-phase spine: <strong>Accepted</strong> (the invocation and its
        source were recorded), <strong>Assembled</strong> (context-dependent fields resolved and
        mounted), <strong>Agent work</strong> (model and tool activity), and the outcome
        (completed, failed, cancelled, or still running with a live duration). A failed run states
        its error above the spine. <strong>Run again</strong> reopens the run drawer with the same
        instance and message.
      </p>
      <ul>
        <li>The event trace is collapsed by default. Each row shows wall-clock time and offset from the start of the run.</li>
        <li>Filter the trace by event category, expand a row to see its payload, and copy the payload from the expanded row.</li>
        <li>A <strong>Conversation guidance</strong> card appears when goals, facts, forms or context providers are mounted: goal progress, fact and claim counts, form status. It never includes answer values or fact bodies.</li>
        <li>Pending approvals show the exact tool input with approve and deny controls, on the overview and on the blocked run.</li>
      </ul>
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
        keeps your scroll position, expanded rows, open panels and filter text. Relative times and
        running durations tick every second.
      </p>
      <table>
        <thead><tr><th>Key</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td><code>⌘K</code> / <code>Ctrl+K</code></td><td>Search pages, definitions, instances and retained runs</td></tr>
          <tr><td><code>j</code> / <code>k</code></td><td>Move down / up the current list</td></tr>
          <tr><td><code>Enter</code> or <code>o</code></td><td>Open the highlighted row</td></tr>
          <tr><td><code>/</code></td><td>Focus the run filter, or open search elsewhere</td></tr>
          <tr><td><code>c</code></td><td>Start a run (on Chat: a new conversation)</td></tr>
          <tr><td><code>r</code></td><td>Refresh runtime data</td></tr>
          <tr><td><code>Esc</code></td><td>Close the drawer or search</td></tr>
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
          <tr><td><code>model</code></td><td><code>agent.text_delta</code>, <code>agent.model_response</code>, <code>agent.model_response_complete</code>, <code>agent.token_consumption</code></td></tr>
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
        subagent events) without changing behaviour. It runs in the job process. A{" "}
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
          Native Glove events are recorded as they are: model responses, tool inputs and results,
          and runtime context can contain conversation content. Apply access control and
          retention to the event stream like you would to transcripts.
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
