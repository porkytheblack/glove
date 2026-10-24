import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { Blueprint, SystemDiagram } from "@/components/diagrams";
import { docsMetadata } from "@/lib/docs-nav";

export const metadata = docsMetadata("/docs/harnesses/support");

export default function SupportHarnessPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Harness blueprint</span>
      <h1>Support desk</h1>
      <p className="blog-lede">
        A support harness answers customers where they already are: a ticket queue, a chat
        widget, an email thread. It is defined by the system layer. Each customer gets their own
        agent with their own installed integrations (identity), tickets wake it (arrival), cheap
        classifiers decide what deserves a model at all, and anything that moves money waits for
        a person (oversight). The agent loop in the middle is ordinary Glove.
      </p>

      <Blueprint
        uses={[
          "Agent loop",
          "Model adapters",
          "Tools",
          "Permission gates",
          "Classifiers",
          "MCP servers",
          "Runtime context providers",
          "Store",
          "Forms",
          "Facts",
          "Subagents",
          "Definitions",
          "Instances",
          "Conversations",
          "Installable capabilities",
          "Data adapters",
          "Transmissions",
          "Applications and connections",
          "Playbooks",
          "Subscriptions",
          "Inbound triage",
          "Approvals",
          "Inspector and WebChat",
          "Typed client",
          "Request authorization",
          "Zero-config deploys",
          "Persistent disk",
          "Model gateway",
          "Agent inspection",
        ]}
        write={[
          "The help-desk transmission: webhook in, reply out, through your provider SDK",
          "Domain tools over your systems: orders, refunds, accounts",
          "The refund form and the rules for when a reply needs approval",
          "An account-session adapter that resolves credentials by reference",
        ]}
      />

      <h2 id="how-it-fits">How it fits together</h2>
      <p>
        A customer opens ticket T-1001, &ldquo;order 4417 never arrived&rdquo;. The help desk
        posts a webhook; your route verifies the signature and calls{" "}
        <code>dispatchInbound</code> with the provider&apos;s event id and the ticket id as the
        thread key. Foundry claims <code>routeId:eventId</code> before anything else, so a
        provider retry never starts a second run.
      </p>
      <p>
        The transmission authenticates and normalises the payload, then its{" "}
        <code>classify</code> step asks a classifier model which kind of event this is:
        refund, bug or other, in milliseconds and without an LLM reading the customer&apos;s data.
        A playbook subscription matches refund events and finds the customer&apos;s instance, or
        creates one, with the help-desk app installed against their account. The event becomes a
        turn in the ticket&apos;s conversation and a run starts.
      </p>
      <p>
        The run looks the order up, records what the customer already said as facts, and walks the
        refund form so it only asks for what is missing. When it calls <code>issue_refund</code>,
        the permission gate pauses the run on an approval record. A person approves it in the
        inspector or from your own queue; the refund goes through and the agent replies on the
        ticket through the transmission&apos;s outbound tool. Every step is a correlated event you
        can open later.
      </p>
      <SystemDiagram caption="One ticket through a support desk: the webhook becomes a typed event, the classifier picks the event kind, the playbook finds or provisions the customer's instance, and the run replies on the ticket, pausing on an approval before money moves." />

      <h2 id="skeleton">Skeleton</h2>
      <p>
        The transmission, app, routes and webhook route are written out in full in{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>, which builds the
        same help desk. These are the pieces that make it a support desk.
      </p>
      <CodeBlock
        filename="agents/support/agent.ts"
        language="typescript"
        code={`import { getToolJsonSchema } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { MemorySchema } from "glove-memory/core";
import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import {
  defineAgent,
  defineFacts,
  defineForms,
  defineSubagent,
  foundryGuidanceSubject,
  type AgentAssemblyContext,
} from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";
import { components } from "./composition.js"; // composeAgent(helpdesk, …)
import { refundForms } from "./refund-form.js"; // a FormRegistry with the refund form
import { orders } from "../../lib/orders.js"; // your code: your order system

const guidance = (ctx: AgentAssemblyContext) =>
  createSqliteMemoryAdapters({
    file: "/data/guidance.sqlite",
    namespace: foundryGuidanceSubject(ctx, "conversation"),
    schema: new MemorySchema(),
  });

export default defineAgent({
  description: "Answers one customer's tickets",
  components,
  model: () => createAdapter({ provider: "anthropic", model: "claude-sonnet-5-5" }),
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: (_agent, ctx) =>
    \`You support \${String(ctx.agentInstance.context.customer)}. Reply on the ticket. Never promise a refund before it is issued.\`,
  contextProviders: (_agent, ctx) => [
    // Re-read before every model call, so a plan change mid-ticket is seen at once.
    async () => \`Account: \${JSON.stringify(await orders.account(String(ctx.agentInstance.context.customer)))}\`,
  ],
  tools: [
    {
      name: "lookup_order",
      description: "Get an order's status, items and shipping events.",
      inputSchema: z.object({ orderId: z.string() }),
      async do({ orderId }) {
        return { status: "success" as const, data: await orders.get(orderId) };
      },
    },
    {
      name: "issue_refund",
      description: "Refund an order, fully or in part.",
      inputSchema: z.object({ orderId: z.string(), amount: z.number().positive() }),
      requiresPermission: true, // becomes an expiring approval record
      async do(input) {
        return { status: "success" as const, data: await orders.refund(input) };
      },
    },
  ],
  facts: (_agent, ctx) => defineFacts({ adapter: guidance(ctx).facts }),
  forms: (_agent, ctx) => defineForms({ adapter: guidance(ctx).forms, registry: refundForms }),
  subagents: [
    defineSubagent({
      name: "order-researcher",
      description: "Read-only: gather what happened to one order.",
      systemPrompt: "Gather facts about one order. Never change anything. Return a short summary.",
      tools: ({ parent }) => parent.tools.filter((tool) => tool.name === "lookup_order").map((tool) => ({
        name: tool.name,
        description: tool.description,
        jsonSchema: getToolJsonSchema(tool),
        do: (input, _display, _glove, signal) => tool.run(input, undefined, signal),
      })),
    }),
  ],
});`}
      />
      <p>
        The subagent re-exposes only the parent&apos;s read tool, so it can research an order but
        never refund one. Triage happens before any of this runs, in the transmission&apos;s
        inbound contract:
      </p>
      <CodeBlock
        filename="agents/support/transmissions/tickets.transmission.ts (inbound)"
        language="typescript"
        code={`import { choice, jev } from "glove-classifier";
import { classifyInbound } from "glove-classifier/foundry";

// inside defineTransmission({ inbound: { … } })
classify: classifyInbound({
  classifier: jev(), // TypeSafe's Jev; any ClassifierAdapter works
  question: choice("What is this ticket about?", ["refund", "bug", "other"]),
  events: { refund: refundRequested, bug: bugReported },
  fallback: generalInquiry, // below minConfidence, or "other"
  minConfidence: 0.6,
  state: (event: { subject: string; body: string }) => \`\${event.subject}\\n\${event.body}\`,
}),`}
      />
      <p>
        And a subscription gives every customer their own agent the first time they write in,
        with the help desk installed against their account:
      </p>
      <CodeBlock
        filename="agents/support/subscriptions/refunds.subscription.ts"
        language="typescript"
        code={`import { definePlaybookSubscription, install } from "glove-foundry";
import support from "../agent.js";
import helpdesk from "../apps/helpdesk.app.js";
import handle from "../actions/handle.action.js";
import refundRequested from "../events/refund-requested.event.js";
import tickets from "../transmissions/tickets.transmission.js";
import { acmeHelpdesk, ticketsInbound, ticketsOutbound } from "../topology.js";

export default definePlaybookSubscription({
  workspaceId: "acme",
  playbook: {
    transmission: tickets,
    match: { event: refundRequested, routes: [ticketsInbound] },
    directives: [{ action: handle, instruction: "Resolve the refund request on this ticket." }],
    applications: [helpdesk],
    outbound: [{ route: ticketsOutbound, application: helpdesk }],
  },
  targets: [{
    agent: support,
    // "per-requester" is your provisioner in foundry.application.ts:
    // it returns a provisioningKey per customer, so each customer gets one instance.
    provisioning: { mode: "custom", adapter: "per-requester" },
    installations: [install(helpdesk, { queue: "support" }, { account: acmeHelpdesk })],
  }],
});`}
      />
      <p>
        Resolve approvals from anything that can call the API. Your support console, for
        example, can list what is waiting:
      </p>
      <CodeBlock
        filename="console/approvals.ts"
        language="typescript"
        code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL });
for (const approval of await foundry.approvals({ status: "pending" })) {
  // show approval.toolName and approval.toolInput to a person, then:
  await foundry.resolveApproval(approval.id, "approve"); // or "deny"
}`}
      />

      <h2 id="dont-build">What not to build</h2>
      <ul>
        <li>
          <strong>A webhook handler and a dispatcher per channel.</strong>{" "}
          <Link href="/foundry/docs/applications">Transmissions</Link> normalise events and{" "}
          <Link href="/foundry/docs/automation#playbooks">playbooks</Link> route them, with
          idempotent delivery keyed on the provider&apos;s event id.
        </li>
        <li>
          <strong>Onboarding code that creates an agent before a customer&apos;s first ticket.</strong>{" "}
          <Link href="/foundry/docs/automation#subscriptions">Subscriptions</Link> provision the
          instance when the event arrives, atomically.
        </li>
        <li>
          <strong>An LLM call to sort every ticket.</strong>{" "}
          <Link href="/docs/classifier">Classifiers</Link> answer typed questions in milliseconds,
          and <code>classifyInbound</code> runs before any agent starts.
        </li>
        <li>
          <strong>A slot-filling state machine for refunds.</strong>{" "}
          <Link href="/docs/forms">Forms</Link> validate each answer, allow skips and undo, and
          run executors when complete; <Link href="/docs/facts">facts</Link> keep what the customer
          said before you asked.
        </li>
        <li>
          <strong>An approvals table and a pause/resume flow.</strong>{" "}
          <Link href="/foundry/docs/approvals"><code>requiresPermission</code></Link> becomes an
          expiring, fail-closed approval record with the exact input.
        </li>
        <li>
          <strong>Tool lists behind per-customer feature flags.</strong>{" "}
          <Link href="/foundry/docs/capabilities">Installable capabilities</Link> mount only on the
          instances that install them, with typed config.
        </li>
      </ul>

      <h2 id="deploy">Deploy on Kuiper</h2>
      <ol>
        <li>
          Deploy the Foundry folder as a unit: <code>kuiper units create support</code>, then{" "}
          <code>kuiper link -u support --repo … --branch main</code> so every push deploys.
        </li>
        <li>
          Add a <code>requestAuthorization</code> adapter that accepts a bearer token, store it with{" "}
          <code>kuiper secrets set FOUNDRY_TOKEN=-</code> and bind it with{" "}
          <code>&apos;FOUNDRY_TOKEN=${"{{"}secrets.FOUNDRY_TOKEN{"}}"}&apos;</code>. Your webhook
          route and console send it.
        </li>
        <li>
          If the webhook receiver is a separate unit (a Next.js app, say), point it at Foundry over
          the private network: <code>&apos;FOUNDRY_URL=${"{{"}support.INTERNAL_URL{"}}"}&apos;</code>.
        </li>
        <li>
          Keep runtime data, transcripts and guidance state under <code>/data</code>. For several
          hosts, implement <code>FoundryDataAdapter</code> on a{" "}
          <a href="https://kuiper.sh/docs/databases/">managed Postgres</a>.
        </li>
        <li>
          Route models through the gateway so every call is recorded with its tokens and cost
          (<code>kuiper models calls --unit support</code>).
        </li>
      </ol>
      <p>
        The unit&apos;s Inspect card and the project&apos;s Agents page show runs, conversations and
        pending approvals. Full walkthrough: <Link href="/foundry/docs/kuiper">Deploy on Kuiper</Link>.
      </p>

      <h2 id="further">Go further</h2>
      <ul>
        <li>
          <Link href="/foundry/docs/tutorial">Foundry tutorial</Link>: a customer-support agent end
          to end, with an approval and an OpenAI SDK client.
        </li>
        <li>
          <a href="https://github.com/porkytheblack/glove/tree/main/examples/classifier-inbox">
            examples/classifier-inbox
          </a>
          : a labelled inbox triaged with classifiers, measured against an LLM.
        </li>
        <li>
          Build the parts one at a time: <Link href="/docs/build/state">make it remember</Link>,{" "}
          <Link href="/docs/build/system">make it a system</Link>.
        </li>
        <li>
          Reference: <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>,{" "}
          <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>,{" "}
          <Link href="/foundry/docs/guidance">Goals, facts &amp; forms</Link>,{" "}
          <Link href="/docs/goal-oriented-agents">Goal-oriented agents</Link>.
        </li>
      </ul>
    </article>
  );
}
