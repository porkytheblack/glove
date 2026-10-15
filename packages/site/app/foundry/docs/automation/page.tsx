import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Playbooks, schedules & sleep",
  description:
    "Make agents act unprompted: playbooks for inbound events, subscriptions that provision agents, cron and interval schedules, sleep, spawn and background runs.",
};

export default function AutomationPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Connect &amp; automate / Playbooks, schedules &amp; sleep</span>
      <h1>Playbooks, schedules &amp; sleep</h1>
      <p className="blog-lede">
        Make agents act without being asked. A playbook wakes an instance when a matching
        event arrives. A subscription can create the agent first. A schedule wakes it at
        9am every weekday, and an agent can put itself to sleep for 20 minutes or hand
        work to another run. All of it is persisted through your data adapter.
      </p>

      <h2 id="playbooks">Playbooks</h2>
      <p>
        A playbook says: <em>when this kind of event arrives on these routes and passes
        this predicate, wake this instance with these instructions, and let it reply
        through these routes.</em> It is plain JSON data with no functions, so it can be
        stored on an instance, edited by a UI or attached by a subscription. The code
        that runs (authentication, normalization, predicates, delivery) stays on the{" "}
        <Link href="/foundry/docs/applications#transmission">transmission</Link>. This page
        continues the <code>agents/support</code> example from{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>
      <CodeBlock filename="agents/support/urgent-tickets.ts" language="typescript" code={`import { composePlaybook } from "glove-foundry";
import triage from "./actions/triage.action.js";
import helpdesk from "./apps/helpdesk.app.js";
import ticketCreated from "./events/ticket-created.event.js";
import ticketReplied from "./events/ticket-replied.event.js";
import priorityAtLeast from "./predicates/priority-at-least.predicate.js";
import { acmeHelpdesk, ticketsInbound, ticketsOutbound } from "./topology.js";
import tickets from "./transmissions/tickets.transmission.js";

export const urgentTickets = composePlaybook({
  name: "urgent-tickets",
  enabled: true,
  transmission: tickets,
  match: {
    event: ticketCreated,
    routes: [ticketsInbound],
    predicate: { definition: priorityAtLeast, parameters: { minimum: 3 } },
  },
  directives: [
    {
      action: triage,
      instruction: "Work out what the customer needs, then reply on the ticket.",
      parameters: { tone: "warm", maxSentences: 5 },
    },
  ],
  applications: [helpdesk],
  outbound: [
    {
      route: ticketsOutbound,
      application: helpdesk,
      account: acmeHelpdesk,
      applicationAccount: acmeHelpdesk,
      event: ticketReplied,
      instruction: "Reply on the same ticket.",
    },
  ],
  serialization: { payload: "json" },
});`} />
      <CodeBlock filename="agents/support/actions/triage.action.ts" language="typescript" code={`import { definePlaybookAction } from "glove-foundry";

/** A named verb. Its id ("triage") comes from the filename and is rendered into the turn. */
export default definePlaybookAction({
  description: "Work out what the customer needs and answer on the ticket.",
});`} />
      <table>
        <thead><tr><th>Field</th><th>Rules</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>Required, unique per agent definition. The stored id is derived from definition, instance and name (<code>playbook-</code> + hash).</td></tr>
          <tr><td><code>transmission</code></td><td>Required. Must have an <code>inbound</code> contract and be owned by an app the instance installed.</td></tr>
          <tr><td><code>enabled</code></td><td>Default <code>true</code>. <code>false</code> never matches.</td></tr>
          <tr><td><code>match.event</code></td><td>An event declared in the transmission’s <code>events</code>. Omit to match every event.</td></tr>
          <tr><td><code>match.routes</code></td><td>Inbound routes of this transmission. Omit to match every route.</td></tr>
          <tr><td><code>match.predicate</code></td><td><code>{"{ definition, parameters? }"}</code>. The definition must be listed in the transmission’s <code>inbound.predicates</code>.</td></tr>
          <tr><td><code>directives</code></td><td>At least one <code>{"{ action, instruction, parameters? }"}</code>. <code>action</code> is a <code>definePlaybookAction</code> label; nothing executes. All three are rendered into the agent’s turn.</td></tr>
          <tr><td><code>applications</code></td><td>Apps this playbook relies on. Each must be installed. Their send tools are offered the <code>outbound</code> entries that name no <code>application</code>.</td></tr>
          <tr><td><code>outbound</code></td><td><code>{"{ route, application?, account?, applicationAccount?, event?, instruction? }"}</code>. <code>route</code> must be outbound; <code>account</code> must equal the route’s account; <code>application</code> must be installed and own the route’s transmission; <code>event</code> must be declared by the transmission.</td></tr>
          <tr><td><code>serialization</code></td><td>Free-form JSON. The default XML renderer includes it as a <code>&lt;serialization&gt;</code> element; a custom <code>inbound.serialize</code> reads it from <code>context.playbooks</code>.</td></tr>
        </tbody>
      </table>
      <p>
        <code>composePlaybook</code> throws on a missing name, instruction or directive, an
        event the transmission does not declare, or <code>parameters</code>/<code>serialization</code>{" "}
        that are not plain JSON (functions, <code>undefined</code>, class instances,
        non-finite numbers, cycles). The rest is checked when the playbook is saved on an
        instance. Listing an outbound route tells the agent where to reply and narrows the
        send tool’s <code>routeId</code>; it does not authorize delivery. A{" "}
        <Link href="/foundry/docs/applications#topology">binding</Link> does.
      </p>

      <h3 id="definition-playbooks">Playbooks from the agent definition</h3>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { composeAgent, defineAgent } from "glove-foundry";
import helpdesk from "./apps/helpdesk.app.js";
import weekdayDigest from "./schedules/weekday-digest.js";
import { urgentTickets } from "./urgent-tickets.js";

export default defineAgent({
  description: "Answers help-desk tickets",
  components: composeAgent(helpdesk),
  // model, systemPrompt, accountSessions: see Apps & transmissions

  // Only valid where helpdesk is installed, so decide per instance.
  playbooks: (_agent, { installations }) =>
    installations.some((item) => item.kind === "application" && item.id === helpdesk.id)
      ? [urgentTickets]
      : [],

  // See "Schedules" below. An instance can opt out through its context.
  schedules: (_agent, { agentInstance }) =>
    agentInstance.context.digest === false ? [] : [weekdayDigest],
});`} />
      <ul>
        <li>The resolver runs each time an instance is assembled for a run. Foundry writes the result onto the instance with <code>origin: &quot;agent-definition&quot;</code>, keeps a stored playbook whose content is unchanged, and removes definition playbooks the resolver stops returning.</li>
        <li>A playbook referencing an app the instance has not installed fails validation, which is why the resolver checks <code>installations</code> (the <code>travel-concierge</code> template does the same).</li>
        <li>A new instance has no definition playbooks until its first run. Until then inbound events pass it by.</li>
        <li>If <code>defineAgent</code> has no <code>playbooks</code> field, Foundry never changes the instance’s playbooks.</li>
      </ul>

      <h3 id="instance-playbooks">Playbooks as instance data</h3>
      <p>
        A product UI can author playbooks per instance through the API. At that boundary
        definitions are referenced by their string ids:
      </p>
      <CodeBlock filename="scripts/refund-playbook.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({ baseUrl: "http://127.0.0.1:4141" });

await foundry.setAgentPlaybooks("support-desk", [
  {
    id: "refund-requests",
    transmissionId: "tickets",
    match: {
      event: "ticket-created",
      routeIds: ["tickets-inbound"],
      predicate: { name: "priority-at-least", parameters: { minimum: 1 } },
    },
    directives: [
      { action: "triage", instruction: "If the customer asks for a refund, check the order and reply." },
    ],
    applications: ["helpdesk"],
    outbound: [{ routeId: "tickets-outbound", applicationId: "helpdesk" }],
  },
]);`} />
      <p>
        <code>setAgentPlaybooks</code> (<code>PUT /api/agent-instances/:id/playbooks</code>,
        body <code>{"{ playbooks }"}</code>) validates and replaces the stored list.
        Playbooks without <code>origin: &quot;agent-definition&quot;</code> survive later
        definition syncs; definition playbooks you leave out come back on the next run.
        You can also pass <code>playbooks</code> to <code>createAgent</code>,{" "}
        <code>configureAgent</code> or <code>defineAgentInstance</code>. The value form
        renames each reference: <code>transmission</code> → <code>transmissionId</code>,{" "}
        <code>routes</code> → <code>routeIds</code>, <code>predicate.definition</code> →{" "}
        <code>predicate.name</code>, <code>route</code> → <code>routeId</code>,{" "}
        <code>application</code> → <code>applicationId</code>, <code>account</code> →{" "}
        <code>accountId</code>, <code>applicationAccount</code> →{" "}
        <code>applicationAccountId</code>; events, actions and apps become their ids. In
        code, the <code>glove-foundry/eslint</code> preset rejects these string forms
        inside <code>composePlaybook</code>.
      </p>

      <h2 id="subscriptions">Subscriptions: provision agents on demand</h2>
      <p>
        A playbook on an instance only wakes that instance. A subscription is a playbook
        plus targets: when an event matches, Foundry finds or creates the target
        instances, gives each the playbook and installations, opens the thread’s
        conversation and starts one run per instance. One urgent ticket can create a
        dedicated agent for that ticket.
      </p>
      <CodeBlock filename="agents/support/subscriptions/urgent-swarm.subscription.ts" language="typescript" code={`import { definePlaybookSubscription, install } from "glove-foundry";
import support from "../agent.js";
import triage from "../actions/triage.action.js";
import helpdesk from "../apps/helpdesk.app.js";
import ticketCreated from "../events/ticket-created.event.js";
import priorityAtLeast from "../predicates/priority-at-least.predicate.js";
import { acmeHelpdesk, ticketsInbound, ticketsOutbound } from "../topology.js";
import tickets from "../transmissions/tickets.transmission.js";

export default definePlaybookSubscription({
  workspaceId: "acme",
  playbook: {
    transmission: tickets,
    match: {
      event: ticketCreated,
      routes: [ticketsInbound],
      predicate: { definition: priorityAtLeast, parameters: { minimum: 4 } },
    },
    directives: [{ action: triage, instruction: "Urgent ticket: own it end to end." }],
    applications: [helpdesk],
    outbound: [{ route: ticketsOutbound, application: helpdesk }],
  },
  targets: [
    {
      agent: support,
      provisioning: { mode: "per-thread" }, // one support agent per ticket
      context: { tier: "urgent" },
      installations: [install(helpdesk, { queue: "support" }, { account: acmeHelpdesk })],
    },
  ],
});`} />
      <p>
        The id comes from the filename (<code>urgent-swarm</code>), and the playbook takes
        the same id. Defaults: <code>workspaceId: &quot;default&quot;</code>,{" "}
        <code>enabled: true</code>, provisioning <code>singleton</code>. Register it by
        seeding the data adapter, which also accepts a custom provisioner:
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import { Effect } from "effect";
import { MemoryFoundryDataAdapter, defineApplication } from "glove-foundry";
import urgentSwarm from "./agents/support/subscriptions/urgent-swarm.subscription.js";

export default defineApplication({
  name: "Acme Support",
  data: new MemoryFoundryDataAdapter({ subscriptions: [urgentSwarm] }),
  // Used by targets with provisioning: { mode: "custom", adapter: "per-requester" }.
  provisioner: {
    identifier: "acme-provisioner",
    provision: (adapter, ctx) => {
      if (adapter !== "per-requester") return Effect.succeed([]);
      const requester = (ctx.event as { readonly requester: string }).requester;
      return Effect.succeed([
        {
          provisioningKey: \`requester:\${ctx.subscription.workspaceId}:\${requester}\`,
          context: { requester },
        },
      ]);
    },
  },
});`} />
      <table>
        <thead><tr><th><code>provisioning</code></th><th>Which instances receive the event</th></tr></thead>
        <tbody>
          <tr><td><code>{"{ mode: \"singleton\", key? }"}</code></td><td>One shared instance per subscription target (and <code>key</code>).</td></tr>
          <tr><td><code>{"{ mode: \"per-thread\" }"}</code></td><td>One instance per route and <code>threadKey</code>.</td></tr>
          <tr><td><code>{"{ mode: \"per-event\" }"}</code></td><td>A new instance per route and <code>eventId</code>.</td></tr>
          <tr><td><code>{"{ mode: \"existing\", agentIds }"}</code></td><td>Those instances. The playbook and target installations are added to them.</td></tr>
          <tr><td><code>{"{ mode: \"custom\", adapter }"}</code></td><td><code>provisioner.provision(adapter, ctx)</code> on <code>defineApplication</code>. <code>ctx</code>: <code>subscription</code>, <code>target</code>, <code>route</code>, <code>eventId</code>, <code>eventName</code>, <code>threadKey</code>, normalized <code>event</code>. Return <code>{"{ provisioningKey, id?, workspaceId?, context?, installations?, playbooks? }"}</code> seeds; missing fields come from the target.</td></tr>
        </tbody>
      </table>
      <ul>
        <li>Provisioning goes through <code>FoundryDataAdapter.provisionAgent</code>, which returns the existing instance for a known <code>provisioningKey</code>. Built-in keys look like <code>subscription:acme:urgent-swarm:0:per-thread:tickets-inbound:T-1001</code>, so concurrent events for one ticket never create two agents. Durable adapters must enforce the key atomically.</li>
        <li>Each new instance gets the subscription’s workspace, the target’s <code>context</code> and <code>installations</code>, and the playbook. Because the subscription carries the playbook, it reacts to the very first event.</li>
        <li>An instance matched both by its own playbook and by a subscription gets one run with both playbooks.</li>
        <li>Saving validates targets: the definition must exist, installations must be in its <code>components</code>, and the playbook must be valid for those installations.</li>
        <li>The whole dispatch sits behind the <Link href="/foundry/docs/applications#idempotency"><code>{"<routeId>:<eventId>"}</code> delivery claim</Link>, so a retried event never provisions twice.</li>
      </ul>
      <p>
        At runtime, list, upsert and delete with <code>client.playbookSubscriptions(workspaceId?)</code>,{" "}
        <code>client.putPlaybookSubscription(subscription)</code> and{" "}
        <code>client.deletePlaybookSubscription(id)</code> (<code>GET</code>/<code>PUT /api/playbook-subscriptions</code>,{" "}
        <code>DELETE /api/playbook-subscriptions/:id</code>). Over the API the subscription
        is plain data, with <code>definitionId</code> in each target:
      </p>
      <CodeBlock filename="scripts/after-hours.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({ baseUrl: "http://127.0.0.1:4141" });
const now = new Date().toISOString();

await foundry.putPlaybookSubscription({
  id: "after-hours",
  workspaceId: "acme",
  enabled: true,
  playbook: {
    id: "after-hours",
    transmissionId: "tickets",
    match: { event: "ticket-created", routeIds: ["tickets-inbound"] },
    directives: [{ action: "triage", instruction: "Acknowledge the ticket and promise a reply by 9am." }],
    applications: ["helpdesk"],
    outbound: [{ routeId: "tickets-outbound", applicationId: "helpdesk" }],
  },
  targets: [
    {
      definitionId: "support",
      provisioning: { mode: "singleton", key: "after-hours" },
      context: { shift: "night" },
      installations: [
        { kind: "application", id: "helpdesk", accountId: "acme-helpdesk", config: { queue: "support" } },
      ],
    },
  ],
  createdAt: now,
  updatedAt: now,
});`} />
      <p>
        When you embed the runtime, <code>runtime.putPlaybookSubscription(...)</code> accepts
        either this data form or the <code>definePlaybookSubscription</code> options.
      </p>

      <h2 id="schedules">Schedules</h2>
      <p>
        Give an agent recurring or future work in its definition. Agents never call{" "}
        <code>setTimeout</code>; Foundry persists an activation and starts a run when it is due.
      </p>
      <CodeBlock filename="agents/support/schedules/weekday-digest.ts" language="typescript" code={`import { defineSchedule } from "glove-foundry";

export default defineSchedule({
  name: "weekday-digest",
  description: "Summarise open tickets every weekday morning.",
  timing: { kind: "cron", expression: "45 8 * * 1-5", timezone: "Europe/London" },
  message: "List tickets still waiting on us and post a digest to the shared inbox.",
  payload: { queue: "support" },
});`} />
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>Required, unique within one agent definition. Not a runtime id.</td></tr>
          <tr><td><code>message</code></td><td>Required. The user turn of each scheduled run.</td></tr>
          <tr><td><code>timing</code></td><td>One of the four kinds below.</td></tr>
          <tr><td><code>payload</code></td><td>Optional JSON passed as the run’s <code>payload</code>.</td></tr>
          <tr><td><code>enabled</code></td><td>Default <code>true</code>. <code>false</code> cancels the activation.</td></tr>
          <tr><td><code>description</code></td><td>Optional, for people.</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th><code>timing</code></th><th>Example</th><th>Stored as</th></tr></thead>
        <tbody>
          <tr><td><code>{"{ kind: \"at\", at }"}</code></td><td><code>{"{ kind: \"at\", at: \"2026-12-01T09:00:00Z\" }"}</code></td><td>one-shot at that instant</td></tr>
          <tr><td><code>{"{ kind: \"after\", duration }"}</code></td><td><code>{"{ kind: \"after\", duration: \"2h\" }"}</code></td><td>one-shot <code>at</code> = now + duration</td></tr>
          <tr><td><code>{"{ kind: \"every\", interval }"}</code></td><td><code>{"{ kind: \"every\", interval: \"30m\" }"}</code></td><td><code>{"{ kind: \"every\", intervalMs }"}</code></td></tr>
          <tr><td><code>{"{ kind: \"cron\", expression, timezone? }"}</code></td><td><code>{"{ kind: \"cron\", expression: \"0 9 * * 1-5\" }"}</code></td><td>five-field cron, minute resolution, IANA <code>timezone</code> (default <code>UTC</code>)</td></tr>
        </tbody>
      </table>
      <p>
        A schedule exists only if an agent’s <code>schedules</code> resolver returns it
        (see the <code>agent.ts</code> above). There is no schedule file convention and no
        global registry. How the resolver’s output is reconciled:
      </p>
      <ul>
        <li>It runs on every assembly of an instance. A new instance’s schedules are armed after its first run, and fire into the conversation of the run that first loaded them.</li>
        <li>The activation id is derived from definition, instance and schedule name, so each instance has one activation per name.</li>
        <li>Unchanged definition (same <code>message</code>, <code>payload</code>, <code>timing</code>, <code>enabled</code>): the stored activation is kept, including edits and pauses made with <code>glove_foundry_schedules</code>.</li>
        <li>Changed definition: the activation is replaced and re-armed, discarding runtime edits and pause state.</li>
        <li>Dropped from the resolver result, or <code>enabled: false</code>: cancelled. Cancellation is final for that instance and name; returning the schedule later does not re-arm it, so rename it to start over.</li>
        <li><code>after</code> counts from the assembly that first loads the schedule.</li>
      </ul>
      <p>
        One-shot activations go <code>pending</code> → <code>active</code> →{" "}
        <code>completed</code> (or <code>cancelled</code> if their run was cancelled); one
        that came due while the runtime was down fires as soon as it starts. Recurring
        activations stay <code>active</code>, skip a tick while the previous scheduled run
        is still going, and collapse ticks that are more than 60 s late into a single
        firing. Every firing is
        a normal run with <code>source: {"{ kind: \"activation\", id }"}</code>.
      </p>
      <p>
        See every activation on the inspector’s <strong>Automations</strong> page (scheduled
        wake-ups, playbook listeners and inbound connections), or read them with{" "}
        <code>GET /api/activations?workspace=acme</code> /{" "}
        <code>client.activations(&quot;acme&quot;)</code>. These are read-only: there is no HTTP
        endpoint to pause or cancel an activation. The owning agent manages it with{" "}
        <code>glove_foundry_schedules</code>, or you change the definition.
      </p>
      <table>
        <thead><tr><th>Activation field</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td>Derived for definition schedules; the tool’s <code>commandId</code> for agent-created ones.</td></tr>
          <tr><td><code>kind</code></td><td><code>&quot;scheduled&quot;</code> or <code>&quot;sleep&quot;</code></td></tr>
          <tr><td><code>definitionId</code>, <code>agentId</code>, <code>conversationId</code>, <code>workspaceId</code></td><td>Where the run will happen.</td></tr>
          <tr><td><code>message</code>, <code>payload?</code></td><td>The run’s input.</td></tr>
          <tr><td><code>timing</code></td><td><code>{"{ kind: \"at\", at }"}</code> | <code>{"{ kind: \"every\", intervalMs }"}</code> | <code>{"{ kind: \"cron\", expression, timezone }"}</code></td></tr>
          <tr><td><code>origin</code></td><td><code>&quot;agent-definition&quot;</code> or <code>&quot;agent-tool&quot;</code>; plus <code>scheduleName</code> and <code>definitionRevision</code> for the former.</td></tr>
          <tr><td><code>status</code></td><td><code>pending</code> | <code>active</code> | <code>paused</code> | <code>completed</code> | <code>cancelled</code></td></tr>
          <tr><td><code>createdByRunId</code>, <code>lastRunId?</code>, <code>createdAt</code>, <code>updatedAt</code></td><td>Provenance.</td></tr>
        </tbody>
      </table>

      <h2 id="core-tools">Built-in agent tools</h2>
      <p>
        Every Foundry agent gets these tools on every run, before your own tools; nothing
        needs to be installed. Tools that start or schedule work return immediately with{" "}
        <code>{"{ commandId, accepted: true, type }"}</code> (plus <code>timing</code> or{" "}
        <code>wakeAt</code>); the parent runtime carries the command out.
      </p>
      <table>
        <thead><tr><th>Tool</th><th>Input</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>glove_foundry_spawn</code></td><td><code>message</code>, <code>payload?</code>, <code>definitionId?</code>, <code>agentId?</code>, <code>conversationId?</code></td><td>Start a run now. Defaults to this definition; without <code>agentId</code> it creates a new instance (no installations), without <code>conversationId</code> a new conversation.</td></tr>
          <tr><td><code>glove_foundry_schedule</code></td><td><code>message</code>, <code>timing</code>, <code>payload?</code>, <code>definitionId?</code>, <code>agentId?</code>, <code>conversationId?</code></td><td>Create a future or recurring activation. With no ids it targets this instance and conversation. <code>timing</code> as in the table above; <code>at</code> must be an ISO datetime ending in <code>Z</code>. The returned <code>commandId</code> is the activation id.</td></tr>
          <tr><td><code>glove_foundry_schedules</code></td><td><code>action</code>: <code>list</code> (<code>status?</code>: <code>active</code> default, <code>paused</code>, <code>completed</code>, <code>cancelled</code>, <code>all</code>), <code>update</code> (<code>activationId</code>, <code>message?</code>, <code>payload?</code>, <code>timing?</code>), <code>pause</code>, <code>resume</code>, <code>cancel</code> (<code>activationId</code>)</td><td>Manage this instance’s scheduled activations, both definition and tool-created. Other instances’ schedules are invisible. Updating a paused one keeps it paused; <code>resume</code> works only from <code>paused</code>; completed or cancelled ones cannot be paused.</td></tr>
          <tr><td><code>glove_foundry_sleep</code></td><td><code>{"{ kind: \"for\", duration, message? }"}</code> or <code>{"{ kind: \"until\", at, message? }"}</code></td><td>Persist a wake-up for this instance and conversation. <code>message</code> defaults to “Continue the suspended work.”</td></tr>
          <tr><td><code>glove_foundry_background</code></td><td><code>message</code>, <code>payload?</code>, <code>definitionId?</code>, <code>reconvene?</code> (default <code>true</code>)</td><td>Queue a separate run now on this instance and conversation. With <code>reconvene</code>, its finished run is posted to the shared inbox under topic <code>background.reconvene</code>.</td></tr>
          <tr><td><code>glove_foundry_transmit</code></td><td><code>routeId</code>, <code>payload</code></td><td>Deliver through an outbound route this run is authorized for (see <Link href="/foundry/docs/applications#outbound-tool">outbound</Link>) and return the adapter’s validated output.</td></tr>
          <tr><td><code>glove_foundry_conversations</code></td><td>none</td><td>List this instance’s conversations.</td></tr>
          <tr><td><code>glove_foundry_workspace</code></td><td><code>action</code>: <code>get</code> (<code>key</code>), <code>set</code> (<code>key</code>, <code>value</code>), <code>list</code></td><td>Read and write the workspace’s shared key-value entries.</td></tr>
          <tr><td><code>glove_foundry_shared_inbox</code></td><td><code>action</code>: <code>list</code>, <code>post</code> (<code>topic</code>, <code>payload</code>, <code>agentId?</code>, <code>conversationId?</code>), <code>update</code> (<code>itemId</code>, <code>status</code>: <code>pending</code> | <code>resolved</code> | <code>dismissed</code>)</td><td>The workspace inbox other agents and conversations read.</td></tr>
          <tr><td><code>glove_foundry_tasks</code></td><td><code>action</code>: <code>list</code>, <code>create</code> (<code>title</code>, <code>detail?</code>), <code>update</code> (<code>taskId</code>, <code>status</code>: <code>open</code> | <code>in-progress</code> | <code>completed</code> | <code>cancelled</code>)</td><td>Workspace tasks; created tasks belong to this conversation.</td></tr>
          <tr><td><code>glove_foundry_environment</code></td><td>none</td><td>List non-secret environment metadata visible to this workspace, instance and conversation.</td></tr>
        </tbody>
      </table>
      <p>
        Installed apps add one <code>glove_app_&lt;app&gt;__&lt;transmission&gt;_send</code> tool
        per outbound transmission. Workspace, inbox and tasks are described in{" "}
        <Link href="/foundry/docs/conversations">Conversations &amp; shared work</Link>.
      </p>
      <p>
        <strong>Durations</strong> are either compact, an integer plus <code>ms</code>,{" "}
        <code>s</code>, <code>m</code>, <code>h</code>, <code>d</code> or <code>w</code>{" "}
        (<code>30s</code>, <code>20m</code>, <code>2h</code>, <code>1d</code>), or Effect form,
        a number, a space and <code>millis</code>, <code>seconds</code>, <code>minutes</code>,{" "}
        <code>hours</code>, <code>days</code> or <code>weeks</code>, singular or plural
        (<code>20 minutes</code>, <code>1.5 hours</code>). They must be greater than zero;{" "}
        <code>20 min</code> is rejected.
      </p>

      <h3 id="choosing">Schedule, sleep, spawn or background?</h3>
      <table>
        <thead><tr><th>Tool</th><th>Starts</th><th>Runs as</th><th>Use it to</th></tr></thead>
        <tbody>
          <tr><td><code>glove_foundry_schedule</code></td><td>later, once or repeating</td><td>this instance and conversation by default, or another target</td><td>set reminders and recurring jobs the agent can list, edit, pause and cancel.</td></tr>
          <tr><td><code>glove_foundry_sleep</code></td><td>later, once</td><td>always this instance and conversation</td><td>wait for a deploy, a cooldown or a deadline, then continue. Not listed by <code>glove_foundry_schedules</code>.</td></tr>
          <tr><td><code>glove_foundry_spawn</code></td><td>now</td><td>a new instance and conversation unless ids are given</td><td>hand work to a fresh agent or another definition.</td></tr>
          <tr><td><code>glove_foundry_background</code></td><td>now</td><td>a second run on this instance and conversation</td><td>run a side task and collect its result from the shared inbox.</td></tr>
        </tbody>
      </table>
      <p>
        Sleep does not block: the tool returns <code>wakeAt</code> and the current run ends
        when the model finishes its turn. At <code>wakeAt</code> a new run starts in the same
        conversation with the full history and the sleep message, so it reads as a
        continuation. A scheduled activation is a separate future run you can manage.
      </p>

      <h2 id="durability">Durability</h2>
      <ul>
        <li>Schedule and sleep activations are written through <code>FoundryDataAdapter.putActivation</code> before the execution backend is armed.</li>
        <li>On start, Foundry reloads every activation and re-arms the <code>pending</code> and <code>active</code> ones. <code>paused</code>, <code>completed</code> and <code>cancelled</code> stay disarmed, so a paused schedule is still paused after a restart.</li>
        <li>Instances (with their playbooks and installations), subscriptions and inbound delivery claims live in the same adapter.</li>
        <li><code>MemoryFoundryDataAdapter</code>, the default when <code>defineApplication</code> has no <code>data</code>, loses all of it on restart. Use it for development only; use <code>FileFoundryDataAdapter({"{ file }"})</code> on one host or implement <code>FoundryDataAdapter</code> for a database. See <Link href="/foundry/docs/persistence">Persistence</Link>.</li>
        <li>Routes and bindings are not in the data adapter; they live in the topology store (see <Link href="/foundry/docs/applications#topology">topology</Link>).</li>
      </ul>
    </article>
  );
}
