import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { AppAnatomy } from "@/components/diagrams";
import { MessageJourneyStory } from "@/components/foundry-stories";

export const metadata = {
  title: "Apps & transmissions",
  description:
    "Connect an agent to Telegram, Slack, a help desk or any webhook: inbound events become runs, replies go out through validated tools.",
};

export default function ApplicationsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Connect &amp; automate / Apps &amp; transmissions</span>
      <h1>Apps &amp; transmissions</h1>
      <p className="blog-lede">
        Connect an agent to Telegram, Slack, a ticket system or any webhook. Inbound
        messages arrive as runs in a durable conversation per thread; replies go out
        through a schema-validated tool the agent calls. Credentials stay in your
        code; Foundry never stores or logs them.
      </p>

      <h2 id="what-you-get">What you get</h2>
      <ul>
        <li>An external event becomes a run of every agent instance whose playbook matches it. Events that match nothing start nothing, and predicates filter them before any model call.</li>
        <li>Each external thread maps to one conversation, so a ticket or chat keeps its history across messages.</li>
        <li>Replies are a generated tool (for example <code>glove_app_helpdesk__tickets_send</code>) whose input and output are checked against your schemas. It can require a human approval first.</li>
        <li>Duplicate deliveries of the same event are ignored. Retries are safe.</li>
        <li>OAuth, token refresh and secret storage stay in an adapter you write. Foundry stores only an opaque <code>accessRef</code>.</li>
      </ul>
      <h2 id="anatomy">What an app is made of</h2>
      <p>
        An app is code you write once and instances install. The topology (which account,
        which queue, who may send) is data, because people and adapters create it.
      </p>
      <AppAnatomy />

      <h2 id="journey">How a message travels</h2>
      <p>
        Follow one help-desk ticket from the provider&apos;s webhook to the agent&apos;s reply.
        Each step names the piece this page builds.
      </p>
      <MessageJourneyStory />

      <h2 id="build">Build one</h2>
      <p>
        This page builds one complete integration: help-desk tickets flowing into the{" "}
        <code>agents/support</code> agent and replies flowing back out. The same shape
        works for chat apps, email or any provider with a webhook or an API you can poll.
      </p>
      <table>
        <thead><tr><th>Piece</th><th>File in <code>agents/support/</code> → id</th><th>Role</th></tr></thead>
        <tbody>
          <tr><td><code>defineTransmissionEvent</code></td><td><code>events/ticket-created.event.ts</code> → <code>ticket-created</code></td><td>A named kind of message, <code>inbound</code> or <code>outbound</code>.</td></tr>
          <tr><td><code>defineTransmissionPredicate</code></td><td><code>predicates/priority-at-least.predicate.ts</code></td><td>A parameterized yes/no check that playbooks reference.</td></tr>
          <tr><td><code>defineTransmission</code></td><td><code>transmissions/tickets.transmission.ts</code> → <code>tickets</code></td><td>The transport contract: schemas, ingress and delivery adapters.</td></tr>
          <tr><td><code>defineConnection</code></td><td><code>connections/tickets-poller.connection.ts</code></td><td>Optional supervised listener (socket, long poll) that emits inbound events.</td></tr>
          <tr><td><code>defineApp</code></td><td><code>apps/helpdesk.app.ts</code> → <code>helpdesk</code></td><td>Bundles transmissions, connections and extra tools. Instances install it.</td></tr>
          <tr><td><code>definePlaybookAction</code>, <code>composePlaybook</code></td><td><code>actions/triage.action.ts</code>, <code>agent.ts</code></td><td>Which events wake an instance and what it should do. See <Link href="/foundry/docs/automation#playbooks">Playbooks</Link>.</td></tr>
          <tr><td><code>defineAccount</code>, <code>defineInboundRoute</code>, <code>defineOutboundRoute</code>, <code>defineBinding</code></td><td><code>topology.ts</code> (and the root <code>foundry.application.ts</code>); explicit <code>id</code>s</td><td>Runtime data: which external account, which queue, who may send.</td></tr>
        </tbody>
      </table>

      <h2 id="events-and-predicates">Events and predicates</h2>
      <CodeBlock filename="agents/support/events/ticket-created.event.ts" language="typescript" code={`import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "inbound",
  description: "A customer opened a help-desk ticket.",
});`} />
      <CodeBlock filename="agents/support/events/ticket-replied.event.ts" language="typescript" code={`import { defineTransmissionEvent } from "glove-foundry";

export default defineTransmissionEvent({
  direction: "outbound",
  description: "The agent posted a public reply on the ticket.",
});`} />
      <p>
        A predicate receives the normalized event, the <code>parameters</code> a
        playbook supplies, and the ingress context (<code>{"{ route, account? }"}</code>),
        and returns <code>Effect&lt;boolean&gt;</code>. One predicate serves many playbooks
        with different thresholds.
      </p>
      <CodeBlock filename="agents/support/predicates/priority-at-least.predicate.ts" language="typescript" code={`import { Effect } from "effect";
import { defineTransmissionPredicate } from "glove-foundry";

/** Priority runs 1 (low) to 4 (urgent). Playbooks pass the threshold as a parameter. */
export default defineTransmissionPredicate({
  description: "The ticket's priority is at least parameters.minimum (default 3).",
  match: (event: { readonly priority: number }, parameters) =>
    Effect.succeed(event.priority >= Number(parameters.minimum ?? 3)),
});`} />

      <h2 id="transmission">The transmission</h2>
      <p>
        A transmission describes a transport, not a vendor SDK: what arrives, how to
        check and normalize it, what can be sent back, and how to deliver it. All
        schemas are Effect <code>Schema</code>s and all adapters return Effects.
      </p>
      <CodeBlock filename="agents/support/transmissions/tickets.transmission.ts" language="typescript" code={`import { Effect, Schema } from "effect";
import { defineTransmission } from "glove-foundry";
import ticketCreated from "../events/ticket-created.event.js";
import ticketReplied from "../events/ticket-replied.event.js";
import priorityAtLeast from "../predicates/priority-at-least.predicate.js";

/** Declared authority. A binding can only grant capabilities listed here. */
export const replyToTicket = {
  id: "tickets:reply",
  description: "Post a public reply on a ticket",
  account: "required",
  effect: "write",
} as const;

/** The provider's webhook body, exactly as the help desk sends it. */
export const HelpdeskWebhook = Schema.Struct({
  event_id: Schema.String,
  queue: Schema.String,
  ticket: Schema.Struct({
    id: Schema.String,
    subject: Schema.String,
    description: Schema.String,
    priority: Schema.Literal("low", "normal", "high", "urgent"),
    requester_email: Schema.String,
  }),
});

const PRIORITY = { low: 1, normal: 2, high: 3, urgent: 4 } as const;

// your code: the provider SDK. This fake keeps the sample runnable.
const helpdeskApi = {
  async reply(_token: string, ticketId: string, _body: string, _signal: AbortSignal) {
    return { commentId: \`comment_\${ticketId}_\${Date.now()}\` };
  },
};

export default defineTransmission({
  name: "Tickets",
  description: "Help-desk tickets in, public ticket replies out",
  account: {
    required: true,
    metadata: Schema.Struct({ subdomain: Schema.String }),
  },
  capabilities: [replyToTicket],
  events: [ticketCreated, ticketReplied],
  inbound: {
    config: Schema.Struct({ queue: Schema.String }),
    // The normalized event that predicates, playbooks and the agent see.
    event: Schema.Struct({
      ticketId: Schema.String,
      subject: Schema.String,
      body: Schema.String,
      priority: Schema.Number,
      requester: Schema.String,
    }),
    adapter: {
      // Refuse events for a queue this route does not serve.
      authenticate: (raw, { route }) =>
        Schema.decodeUnknown(HelpdeskWebhook)(raw).pipe(
          Effect.map((hook) => hook.queue === route.config.queue),
          Effect.orElseSucceed(() => false),
        ),
      // Provider shape in, your event shape out.
      normalize: (raw) =>
        Schema.decodeUnknown(HelpdeskWebhook)(raw).pipe(
          Effect.map(({ ticket }) => ({
            ticketId: ticket.id,
            subject: ticket.subject,
            body: ticket.description,
            priority: PRIORITY[ticket.priority],
            requester: ticket.requester_email,
          })),
          Effect.orDie,
        ),
    },
    classify: () => Effect.succeed(ticketCreated),
    predicates: [priorityAtLeast],
  },
  outbound: {
    config: Schema.Struct({ queue: Schema.String }),
    input: Schema.Struct({ ticketId: Schema.String, body: Schema.String }),
    output: Schema.Struct({ commentId: Schema.String }),
    // Long replies wait for a human approval before delivery.
    requiresPermission: (input: { readonly body: string }) => input.body.length > 1_500,
    // Secret-safe trace data. Without observe, the payload is not retained at all.
    observe: (input: { readonly ticketId: string; readonly body: string }) => ({
      ticketId: input.ticketId,
      characters: input.body.length,
    }),
    adapter: {
      deliver: (input: { readonly ticketId: string; readonly body: string }, context) =>
        context.withAccountSession
          ? context
              .withAccountSession("tickets:reply", (session) =>
                Effect.tryPromise(() =>
                  helpdeskApi.reply(
                    (session as { readonly token: string }).token,
                    input.ticketId,
                    input.body,
                    context.signal,
                  ),
                ),
              )
              .pipe(Effect.orDie)
          : Effect.die(new Error("Add accountSessions to the agent to reply on tickets.")),
    },
  },
});`} />
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>name</code>, <code>description</code></td><td>Required. Shown in the inspector and the outbound tool description.</td></tr>
          <tr><td><code>account</code></td><td><code>{"{ required, metadata }"}</code>. <code>metadata</code> is the schema for safe, descriptive account fields.</td></tr>
          <tr><td><code>capabilities</code></td><td><code>{"{ id, description, account, effect }"}</code> records. Ids look like <code>tickets:reply</code>. Bindings may only grant declared ones.</td></tr>
          <tr><td><code>events</code></td><td>Every event this transmission can receive or send. Playbooks and <code>classify</code> may only use these.</td></tr>
          <tr><td><code>inbound.config</code> / <code>outbound.config</code></td><td>Schema for each route’s <code>config</code>.</td></tr>
          <tr><td><code>inbound.event</code></td><td>Schema of the normalized event.</td></tr>
          <tr><td><code>inbound.adapter</code></td><td>Optional <code>{"{ authenticate(raw, ctx), normalize(raw, ctx) }"}</code>. Without it Foundry decodes <code>raw</code> against <code>inbound.event</code>. With it, the value <code>normalize</code> returns is used as-is.</td></tr>
          <tr><td><code>inbound.classify</code></td><td><code>(event, ctx) =&gt; Effect&lt;event definition&gt;</code>. The result must be in <code>events</code>. Without it, the event name is read from a <code>type</code>, <code>kind</code> or <code>event</code> string field, falling back to <code>&quot;event&quot;</code>.</td></tr>
          <tr><td><code>inbound.predicates</code></td><td>The predicates playbooks may reference.</td></tr>
          <tr><td><code>inbound.serialize</code></td><td>Optional <code>(event, ctx) =&gt; Effect&lt;string&gt;</code> replacing the default XML turn (below). <code>ctx</code> carries <code>eventId</code>, <code>eventName</code>, <code>threadKey</code> and the matched <code>playbooks</code>.</td></tr>
          <tr><td><code>outbound.input</code> / <code>output</code></td><td>The send tool’s payload schema and the delivery result schema. Both are enforced.</td></tr>
          <tr><td><code>outbound.adapter.deliver</code></td><td><code>(input, ctx) =&gt; Effect&lt;output&gt;</code>. <code>ctx</code>: <code>route</code>, <code>account?</code>, <code>grant</code>, <code>signal</code>, <code>withAccountSession?</code>.</td></tr>
          <tr><td><code>outbound.requiresPermission</code></td><td><code>boolean</code> or <code>(input) =&gt; boolean</code>. Gates the send behind an <Link href="/foundry/docs/approvals">approval</Link>.</td></tr>
          <tr><td><code>outbound.project</code> / <code>render</code></td><td>Map the output to what the model sees / to UI-only render data (for example, drop image bytes from the model result).</td></tr>
          <tr><td><code>outbound.observe</code></td><td>Map the input to secret-safe trace data. Omit it and traces record no payload.</td></tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        <code>defineTransmission</code> throws if <code>account.metadata</code>,{" "}
        <code>inbound.config</code> or <code>outbound.config</code> declares a field
        named like a credential (<code>token</code>, <code>accessToken</code>,{" "}
        <code>refreshToken</code>, <code>secret</code>, <code>clientSecret</code>,{" "}
        <code>password</code>, <code>apiKey</code>, <code>credential</code>,{" "}
        <code>credentials</code>, any casing). Put an opaque <code>accessRef</code> on
        the account instead.
      </p></div>

      <h2 id="app">The app</h2>
      <p>
        An app bundles transmissions, optional connections and extra tools into one
        installable unit. List it in the agent’s <code>components</code> to make it
        available; it does nothing for an instance until that instance{" "}
        <em>installs</em> it (see <Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link>).
      </p>
      <CodeBlock filename="agents/support/apps/helpdesk.app.ts" language="typescript" code={`import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import ticketsPoller from "../connections/tickets-poller.connection.js";
import tickets from "../transmissions/tickets.transmission.js";

const helpdesk = defineApp({
  description: "Receive help-desk tickets and reply on them",
  config: z.object({ queue: z.string().default("support") }),
  inbound: [tickets], // tickets can start runs on instances that install this app
  outbound: [tickets], // mounted as the tool glove_app_helpdesk__tickets_send
  connections: [ticketsPoller], // optional; omit it when tickets arrive by webhook
  install: ({ config, accountId }) =>
    Effect.succeed({
      tools: [
        {
          name: "helpdesk_queue",
          description: "Report which help-desk queue and account this agent serves",
          inputSchema: z.object({}),
          async do() {
            return { status: "success" as const, data: { queue: config.queue, accountId } };
          },
        },
      ],
    }),
});

export default helpdesk;`} />
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>description</code></td><td>Required.</td></tr>
          <tr><td><code>config</code></td><td>Zod schema. <code>install(helpdesk, {"{ queue: \"support\" }"})</code> is type-checked against it and decoded again at runtime.</td></tr>
          <tr><td><code>inbound</code> / <code>outbound</code></td><td>Transmissions this app receives from / sends through. A transmission listed as inbound must have an <code>inbound</code> contract, and likewise for outbound. One app can own several of each.</td></tr>
          <tr><td><code>transmissions</code></td><td>Mixed list, for bidirectional definitions. Prefer <code>inbound</code>/<code>outbound</code>.</td></tr>
          <tr><td><code>connections</code></td><td>Long-lived listeners. Each must only emit transmissions this app owns.</td></tr>
          <tr><td><code>install(ctx)</code></td><td>Returns <code>Effect&lt;{"{ tools? }"} | void&gt;</code>. Runs on every assembly of an installing instance. <code>ctx</code> has <code>config</code>, <code>accountId?</code>, <code>withAccountSession?</code>, the agent/conversation/run ids and the current message, but no Glove instance.</td></tr>
        </tbody>
      </table>
      <p>
        The runtime learns about a transmission through the apps listed in some agent’s{" "}
        <code>components</code>. Transmission ids are global to the runtime: if two agents
        each define their own <code>transmissions/tickets.transmission.ts</code>, startup
        fails. Share one definition (import it from both apps) instead.
      </p>

      <h2 id="topology">Accounts, routes and bindings</h2>
      <p>
        Topology is runtime <em>data</em>, so it carries explicit ids that a UI or
        database can own. An account is an external identity, a route is one inbound
        or outbound lane through a transmission, and a binding authorizes an instance
        to send. Every <code>config</code> and <code>metadata</code> object is decoded
        against the transmission’s schema when you define it.
      </p>
      <CodeBlock filename="agents/support/topology.ts" language="typescript" code={`import { defineAccount, defineInboundRoute, defineOutboundRoute } from "glove-foundry";
import tickets from "./transmissions/tickets.transmission.js";

export const acmeHelpdesk = defineAccount({
  id: "acme-helpdesk",
  transmission: tickets,
  externalAccountId: "acme", // the provider's id for this account
  label: "Acme help desk",
  accessRef: "vault://helpdesk/acme", // opaque: only your accountSessions adapter reads it
  metadata: { subdomain: "acme" }, // checked against tickets.account.metadata
});

export const ticketsInbound = defineInboundRoute({
  id: "tickets-inbound",
  transmission: tickets,
  account: acmeHelpdesk,
  visibility: "workspace",
  enabled: true,
  config: { queue: "support" }, // checked against tickets.inbound.config
});

export const ticketsOutbound = defineOutboundRoute({
  id: "tickets-outbound",
  transmission: tickets,
  account: acmeHelpdesk,
  visibility: "workspace",
  enabled: true,
  config: { queue: "support" }, // checked against tickets.outbound.config
});`} />
      <CodeBlock filename="agents/support/instances.ts" language="typescript" code={`import { defineAgentInstance, install } from "glove-foundry";
import support from "./agent.js";
import helpdesk from "./apps/helpdesk.app.js";
import { acmeHelpdesk } from "./topology.js";

export const supportDesk = defineAgentInstance(support, {
  id: "support-desk",
  workspaceId: "acme",
  installations: [install(helpdesk, { queue: "support" }, { account: acmeHelpdesk })],
});`} />
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { MemoryFoundryDataAdapter, defineApplication, defineBinding } from "glove-foundry";
import helpdesk from "./agents/support/apps/helpdesk.app.js";
import { supportDesk } from "./agents/support/instances.js";
import { acmeHelpdesk, ticketsInbound, ticketsOutbound } from "./agents/support/topology.js";
import tickets, { replyToTicket } from "./agents/support/transmissions/tickets.transmission.js";

// Outbound delivery is authorized per instance: this grants support-desk the reply route.
const supportDeskReplies = defineBinding({
  id: "support-desk-replies",
  agent: supportDesk,
  application: helpdesk,
  transmission: tickets,
  account: acmeHelpdesk,
  route: ticketsOutbound,
  capabilities: [replyToTicket],
  enabled: true,
});

export default defineApplication({
  name: "Acme Support",
  data: new MemoryFoundryDataAdapter({ agents: [supportDesk] }),
  accounts: [acmeHelpdesk],
  routes: [ticketsInbound, ticketsOutbound],
  bindings: [supportDeskReplies],
});`} />
      <table>
        <thead><tr><th>Record</th><th>Fields</th><th>Change at runtime</th></tr></thead>
        <tbody>
          <tr><td>Account</td><td><code>id</code>, <code>transmission</code>, <code>externalAccountId</code>, <code>label?</code>, <code>accessRef</code>, <code>metadata</code></td><td>No. Read-only via <code>GET /api/accounts</code>, which omits <code>accessRef</code>.</td></tr>
          <tr><td>Inbound / outbound route</td><td><code>id</code>, <code>transmission</code>, <code>account?</code>, <code>visibility</code> (<code>&quot;private&quot;</code> | <code>&quot;workspace&quot;</code>), <code>enabled</code>, <code>config</code></td><td><code>client.putRoute</code> / <code>removeRoute</code> (<code>PUT /api/routes</code>, <code>DELETE /api/routes/:id</code>)</td></tr>
          <tr><td>Binding</td><td><code>id</code>, <code>agent</code>, <code>application?</code>, <code>transmission</code>, <code>account?</code>, <code>route?</code>, <code>capabilities</code>, <code>reply?</code>, <code>enabled</code></td><td><code>client.putBinding</code> / <code>removeBinding</code> (<code>PUT /api/bindings</code>, <code>DELETE /api/bindings/:id</code>)</td></tr>
        </tbody>
      </table>
      <ul>
        <li><strong>Outbound needs a binding.</strong> Delivery resolves a per-run grant from the instance’s enabled bindings. An instance with none fails with <code>agent has no enabled bindings</code>; a route not named by a binding’s <code>route</code> (or <code>reply: {"{ mode: \"route\", route }"}</code>) fails with <code>not authorized for outbound route</code>. Inbound does not need a binding.</li>
        <li>A binding is validated against an existing instance. Seed the instance in the data adapter (as above), or create the binding after <code>client.createAgent(...)</code> with <code>client.putBinding(defineBinding({"{ agent: created, … }"}))</code>.</li>
        <li>By default routes and bindings live in an in-memory topology store, re-seeded from <code>defineApplication</code> on every start. Pass <code>services</code> (your own <code>TopologyStore</code>, <code>AccountDirectory</code> and <code>EventStore</code> layers) to persist runtime edits.</li>
      </ul>

      <h2 id="agent">Wire it into the agent</h2>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { Effect } from "effect";
import { createAdapter } from "glove-core/models/providers";
import { composeAgent, composePlaybook, defineAgent } from "glove-foundry";
import triage from "./actions/triage.action.js";
import helpdesk from "./apps/helpdesk.app.js";
import ticketCreated from "./events/ticket-created.event.js";
import ticketReplied from "./events/ticket-replied.event.js";
import priorityAtLeast from "./predicates/priority-at-least.predicate.js";
import { acmeHelpdesk, ticketsInbound, ticketsOutbound } from "./topology.js";
import tickets from "./transmissions/tickets.transmission.js";

// your code: resolve the credential behind an account. Foundry never sees it.
async function helpdeskToken(_accountId: string): Promise<string> {
  return process.env.HELPDESK_API_TOKEN ?? "dev-token";
}

const urgentTickets = composePlaybook({
  name: "urgent-tickets",
  transmission: tickets,
  match: {
    event: ticketCreated,
    routes: [ticketsInbound],
    predicate: { definition: priorityAtLeast, parameters: { minimum: 3 } },
  },
  directives: [{ action: triage, instruction: "Work out what the customer needs, then reply on the ticket." }],
  applications: [helpdesk],
  outbound: [{
    route: ticketsOutbound,
    application: helpdesk,
    account: acmeHelpdesk,
    event: ticketReplied,
    instruction: "Reply on the same ticket.",
  }],
});

export default defineAgent({
  description: "Answers help-desk tickets",
  components: composeAgent(helpdesk), // available, not yet mounted
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "You are Acme's support agent. Be brief and specific.",

  // The credential boundary. Foundry passes an accountId and an operation name.
  accountSessions: {
    identifier: "helpdesk-tokens",
    withSession: (request, use) =>
      Effect.promise(() => helpdeskToken(request.accountId)).pipe(
        Effect.flatMap((token) => use({ token })),
      ),
  },

  // A playbook is only valid on an instance that installed helpdesk.
  playbooks: (_agent, { installations }) =>
    installations.some((item) => item.kind === "application" && item.id === helpdesk.id)
      ? [urgentTickets]
      : [],
});`} />
      <p>
        <code>actions/triage.action.ts</code> is one line:{" "}
        <code>export default definePlaybookAction({"{ description: \"…\" }"})</code>.
        Every playbook field is covered in{" "}
        <Link href="/foundry/docs/automation#playbooks">Playbooks, schedules &amp; sleep</Link>.
      </p>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        Playbooks returned by <code>defineAgent({"{ playbooks }"})</code> are written onto
        the instance while it is assembled for a run. A freshly created instance therefore
        ignores inbound events until it has run once (send it any message). To react from
        the first event, attach the playbook as instance data
        (<code>client.setAgentPlaybooks</code>) or use a{" "}
        <Link href="/foundry/docs/automation#subscriptions">playbook subscription</Link>.
      </p></div>

      <h2 id="inbound-flow">What happens when an event arrives</h2>
      <ol>
        <li>The inbound route must exist, be inbound and be <code>enabled</code>.</li>
        <li>Foundry claims the delivery <code>{"<routeId>:<eventId>"}</code>. A completed claim returns the original runs; a concurrent duplicate waits up to 30 s for them.</li>
        <li><code>authenticate</code> runs; <code>false</code> rejects the event (HTTP 400) and releases the claim so the provider can retry.</li>
        <li><code>normalize</code> runs (or <code>raw</code> is decoded against <code>inbound.event</code>), then <code>classify</code>.</li>
        <li>Candidates are instances that installed an app owning this transmission as inbound. Each candidate’s playbooks are matched on transmission, route, event and predicate. Enabled <Link href="/foundry/docs/automation#subscriptions">subscriptions</Link> are matched too and may provision new instances.</li>
        <li>For each matched instance Foundry reuses or creates the conversation <code>{"transmission:<routeId>:<agentId>:<threadKey>"}</code> and enqueues one run whose message is the serialized event plus every matched playbook’s directives. The run’s <code>source</code> is <code>{"{ kind: \"transmission\", id: <routeId>, provider: <transmissionId>, eventId, threadKey }"}</code>, its <code>payload</code> is the normalized event, and its <code>context</code> carries the matched <code>playbookIds</code> and <code>outbound</code> entries.</li>
        <li>The call returns the started runs. No match returns <code>[]</code> and nothing runs.</li>
      </ol>
      <p>Without <code>inbound.serialize</code>, the agent receives deterministic XML (JSON is XML-escaped):</p>
      <CodeBlock filename="agent turn" language="xml" code={`<transmission direction="inbound" definition="tickets" route="tickets-inbound" event="ticket-created" event-id="evt_1001" thread="T-1001">
  <payload format="json">{&quot;body&quot;:&quot;Where is order 4417?&quot;,&quot;priority&quot;:4,&quot;requester&quot;:&quot;dana@example.com&quot;,&quot;subject&quot;:&quot;Order never arrived&quot;,&quot;ticketId&quot;:&quot;T-1001&quot;}</payload>
  <playbook id="playbook-3f9c…">
      <directive action="triage">
        <instruction>Work out what the customer needs, then reply on the ticket.</instruction>
      </directive>
      <outbound route="tickets-outbound" application="helpdesk" event="ticket-replied" account="acme-helpdesk">Reply on the same ticket.</outbound>
  </playbook>
</transmission>`} />

      <h2 id="fire-over-http">Fire an inbound event</h2>
      <p>From any process that can reach the runtime:</p>
      <CodeBlock filename="terminal" language="bash" code={`curl -X POST http://127.0.0.1:4141/api/transmissions/tickets-inbound/fire \\
  -H 'content-type: application/json' \\
  -d '{
    "eventId": "evt_1001",
    "threadKey": "T-1001",
    "raw": {
      "event_id": "evt_1001",
      "queue": "support",
      "ticket": { "id": "T-1001", "subject": "Order never arrived",
        "description": "Where is order 4417?", "priority": "urgent",
        "requester_email": "dana@example.com" }
    }
  }'
# 202 Accepted -> the started runs, [] when no playbook matched:
# [{ "id": "…", "agent": "support", "status": "pending", "agentId": "support-desk",
#    "conversationId": "transmission:tickets-inbound:support-desk:T-1001", … }]`} />
      <table>
        <thead><tr><th>Body field</th><th>Required</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>eventId</code></td><td>yes</td><td>The provider’s delivery id. Deduplication key together with the route id.</td></tr>
          <tr><td><code>threadKey</code></td><td>yes</td><td>The external thread (ticket, chat, email thread). One conversation per key per instance.</td></tr>
          <tr><td><code>raw</code></td><td>no</td><td>Whatever your <code>inbound.adapter</code> expects, or the event itself when there is no adapter.</td></tr>
          <tr><td><code>conversationKey</code></td><td>no</td><td>A durable key that replaces <code>threadKey</code> for conversation lookup.</td></tr>
          <tr><td><code>conversationScope</code></td><td>no</td><td><code>&quot;route&quot;</code> (default) isolates per route. <code>&quot;agent&quot;</code> joins every route that sends the same <code>conversationKey</code>; only use it after you have authenticated and linked the identities.</td></tr>
        </tbody>
      </table>
      <p>
        The body limit is 1 MiB. The endpoint sits behind your{" "}
        <code>requestAuthorization</code> adapter like every <code>/api</code> route (see{" "}
        <Link href="/foundry/docs/deploy">Deploy &amp; security</Link>). The typed client
        method is <code>dispatchInbound</code>, which takes the same fields plus{" "}
        <code>routeId</code> and resolves to <code>ReadonlyArray&lt;FoundryRun&gt;</code>.
      </p>

      <h2 id="webhooks">Webhook recipe</h2>
      <p>
        Verify the provider’s signature where you have the raw bytes, then forward.
        This is a Next.js route handler; any HTTP framework works the same way.
      </p>
      <CodeBlock filename="app/api/helpdesk-webhook/route.ts" language="typescript" code={`import { createHmac, timingSafeEqual } from "node:crypto";
import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
  // Only needed when foundry.application.ts sets requestAuthorization.
  authorization: {
    identifier: "helpdesk-webhook",
    headers: () => ({ authorization: \`Bearer \${process.env.FOUNDRY_API_TOKEN ?? ""}\` }),
  },
});

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const expected = createHmac("sha256", process.env.HELPDESK_WEBHOOK_SECRET ?? "")
    .update(body)
    .digest("hex");
  const signature = request.headers.get("x-helpdesk-signature") ?? "";
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  const hook = JSON.parse(body) as { event_id: string; ticket: { id: string } };
  const runs = await foundry.dispatchInbound({
    routeId: "tickets-inbound",
    eventId: hook.event_id, // a provider retry reuses it, so nothing runs twice
    threadKey: hook.ticket.id, // one conversation per ticket
    raw: hook, // goes through tickets.inbound.adapter
  });
  return Response.json({ runIds: runs.map((run) => run.id) }, { status: 202 });
}`} />

      <h2 id="connections">Connections: listeners Foundry supervises</h2>
      <p>
        When a provider pushes over a socket or must be polled, define a connection.
        Foundry starts it only while some instance (or subscription) has an enabled
        playbook for one of its transmissions on an enabled inbound route, runs one per
        agent definition, workspace, app and account, and restarts it when it fails.
      </p>
      <CodeBlock filename="agents/support/connections/tickets-poller.connection.ts" language="typescript" code={`import { Effect } from "effect";
import { defineConnection } from "glove-foundry";
import tickets, { HelpdeskWebhook } from "../transmissions/tickets.transmission.js";

// your code: ask the help desk for tickets created since the last poll.
async function fetchNewTickets(
  _queue: string,
  _signal: AbortSignal,
): Promise<ReadonlyArray<typeof HelpdeskWebhook.Type>> {
  return [];
}

export default defineConnection({
  description: "Polls the help desk for new tickets every 30 seconds",
  transmissions: [tickets],
  connect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.ready(); // the inspector now shows this connection as "connected"
      while (!ctx.signal.aborted) {
        for (const route of ctx.routes) {
          const batch = yield* Effect.tryPromise(() =>
            fetchNewTickets(String(route.config.queue), ctx.signal),
          );
          for (const hook of batch) {
            yield* ctx.receive({
              route,
              eventId: hook.event_id, // dedupe key: "<routeId>:<eventId>"
              threadKey: hook.ticket.id, // one conversation per ticket
              raw: hook,
            });
          }
        }
        yield* Effect.sleep("30 seconds");
      }
    }),
});`} />
      <table>
        <thead><tr><th><code>ctx</code> member</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>ready()</code></td><td>Mark the connection <code>connected</code>.</td></tr>
          <tr><td><code>receive(input)</code></td><td>Dispatch one event. <code>input</code>: <code>route</code>, <code>eventId</code>, <code>threadKey</code>, <code>raw</code>, optional <code>conversationKey</code>, <code>conversationScope</code>, and <code>awaitCompletion</code> (wait until every started run finishes, to keep a chat transcript ordered).</td></tr>
          <tr><td><code>routes</code></td><td>The enabled inbound routes this connection serves. Emitting through any other route fails.</td></tr>
          <tr><td><code>account?</code>, <code>withAccountSession?</code></td><td>The routes’ account and its session boundary (present when the agent defines <code>accountSessions</code>).</td></tr>
          <tr><td><code>signal</code></td><td>Aborted when Foundry stops the connection.</td></tr>
          <tr><td><code>applicationId</code>, <code>connectionId</code>, <code>definitionId</code>, <code>workspaceId</code></td><td>Where this connection belongs.</td></tr>
        </tbody>
      </table>
      <p>
        If <code>connect</code> fails or simply returns, Foundry reconnects with
        exponential backoff starting at 250 ms and capped at 30 s. Status
        (<code>connecting</code>, <code>connected</code>, <code>reconnecting</code>,{" "}
        <code>disconnected</code>, <code>failed</code>), attempts and the last error are
        shown on the inspector’s Automations page, returned by{" "}
        <code>GET /api/application-connections</code>, and a connection can be restarted
        with <code>POST /api/application-connections/:id/reconnect</code>.
      </p>

      <h2 id="outbound-tool">Outbound: the generated send tool</h2>
      <p>
        Every outbound transmission of an installed app becomes one tool on that
        instance, named by <code>installedApplicationTransmissionToolName(app, transmission)</code>:
      </p>
      <CodeBlock filename="naming" language="text" code={`glove_app_<app id>__<transmission id>_send      ("/" becomes "__", "-" becomes "_")

helpdesk + tickets              -> glove_app_helpdesk__tickets_send
support-desk + email/replies    -> glove_app_support_desk__email__replies_send`} />
      <ul>
        <li>Input is <code>{"{ routeId, payload }"}</code>. <code>payload</code> is <code>outbound.input</code>; <code>routeId</code> is limited to the outbound routes the instance’s enabled playbooks list for this app, or any route the run is authorized for when none do.</li>
        <li>The payload is decoded in the agent process, then delivered by the parent runtime, which checks the route, the app installation and the run’s grant, calls <code>deliver</code>, and decodes the result with <code>outbound.output</code>. Credentials and account sessions never enter the agent process.</li>
        <li>The tool result is <code>project(output)</code> (or the output); <code>render(output)</code> becomes UI-only render data.</li>
        <li>The payload travels to the parent through a private file (mode <code>0600</code>) that is deleted once settled; the event stream only carries <code>observe(input)</code>.</li>
        <li>Stopping the run aborts <code>context.signal</code> inside <code>deliver</code>.</li>
      </ul>
      <p>
        Every agent also has the generic <code>glove_foundry_transmit</code> tool
        (<code>{"{ routeId, payload }"}</code>) for routes not tied to an app; it is
        listed with the other <Link href="/foundry/docs/automation#core-tools">built-in tools</Link>.
        Operators can deliver directly with <code>POST /api/transmissions/:routeId/deliver</code>{" "}
        (<code>{"{ agentId, runId, payload }"}</code>), which applies the same grant check.
      </p>

      <h2 id="idempotency">Delivery idempotency</h2>
      <p>
        Every inbound event is claimed under <code>{"<routeId>:<eventId>"}</code> through{" "}
        <code>FoundryDataAdapter.claimInboundDelivery</code> before anything runs. A repeat
        returns the runs of the first delivery; a failure releases the claim. With{" "}
        <code>FileFoundryDataAdapter</code> or your own durable adapter, claims survive
        restarts, so use the provider’s own delivery id as <code>eventId</code>. A
        database-backed adapter must implement the claim atomically. See{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p>

      <h2 id="credentials">The credential boundary</h2>
      <p>
        Foundry never runs OAuth, never refreshes a token and never chooses where
        secrets live. You give it one adapter, <code>accountSessions</code> on{" "}
        <code>defineAgent</code> (shown <a href="#agent">above</a>):{" "}
        <code>{"{ identifier, withSession(request, use) }"}</code>, where{" "}
        <code>request</code> is <code>{"{ accountId, operation, agentId, conversationId, workspaceId }"}</code>{" "}
        and you call <code>use(session)</code> with whatever your provider code needs.
        Foundry exposes it as <code>withAccountSession(operation, use)</code>:
      </p>
      <table>
        <thead><tr><th>Where</th><th>What you get</th></tr></thead>
        <tbody>
          <tr><td><code>outbound.adapter.deliver</code></td><td><code>context.withAccountSession(operation, use)</code> when the route has an account and the agent defines <code>accountSessions</code>. Also <code>context.account</code> (including <code>accessRef</code>).</td></tr>
          <tr><td><code>defineConnection</code> <code>connect</code></td><td><code>ctx.withAccountSession</code> and <code>ctx.account</code>, same conditions.</td></tr>
          <tr><td><code>defineApp</code> <code>install</code></td><td><code>ctx.withAccountSession</code> when the installation selected an account (<code>install(app, config, {"{ account }"})</code>) and the agent defines <code>accountSessions</code>.</td></tr>
        </tbody>
      </table>
      <ul>
        <li><code>accessRef</code> is an opaque pointer for your adapter. Foundry does not resolve it, does not put it in manifests, and omits it from <code>GET /api/accounts</code>.</li>
        <li>The session value you pass to <code>use</code> is never written to Foundry data or traces.</li>
        <li>Installation <code>config</code> may not contain <code>accountId</code>; select the account with <code>install</code>’s third argument.</li>
      </ul>

      <h2 id="classifier">Triage with a classifier</h2>
      <p>
        To decide <em>which</em> event a message is, or whether a playbook should wake,
        with a small classifier model instead of string matching, use{" "}
        <code>glove-classifier/foundry</code>. <code>classifyInbound(...)</code> returns a
        function for <code>inbound.classify</code> that maps a choice question’s answer to
        your event definitions (with a <code>fallback</code> below{" "}
        <code>minConfidence</code>). <code>classifierPredicate(...)</code> returns options
        for <code>defineTransmissionPredicate</code> that match when the answers satisfy{" "}
        <code>where</code>; playbooks can override <code>min</code>, <code>max</code>,{" "}
        <code>choice</code> or <code>where</code> through their predicate parameters. See{" "}
        <Link href="/docs/classifier#foundry">Classifier models → Foundry</Link>.
      </p>
    </article>
  );
}
