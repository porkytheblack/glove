import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Conversations & shared work",
  description:
    "Many conversations per agent instance, transcripts, transmission threads, and the workspace entries, shared inbox, tasks and environment values agents share.",
};

export default function ConversationsPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world / Conversations &amp; shared work</span>
      <h1>Conversations &amp; shared work</h1>
      <p className="blog-lede">
        One agent instance can hold any number of independent conversations, and every
        instance in a workspace shares four durable records: key/value entries, a shared
        inbox, a task list and read-only environment values. Your host code and the
        agent&apos;s built-in tools read and write the same records.
      </p>

      <h2 id="model">What lives where</h2>
      <p>
        An <strong>instance</strong> belongs to exactly one workspace (its{" "}
        <code>workspaceId</code>, default <code>&quot;default&quot;</code>). A{" "}
        <strong>conversation</strong> belongs to one instance. The{" "}
        <strong>workspace</strong> is just that shared id: anything stored under it is
        visible to every instance and conversation in it.
      </p>
      <table>
        <thead><tr><th>Record</th><th>Scope</th><th>Stored in</th><th>Created by</th></tr></thead>
        <tbody>
          <tr><td>Conversation</td><td>one instance</td><td>the Foundry data adapter (metadata only)</td><td>host API, transmissions, spawn, the OpenAI-compatible API, the inspector</td></tr>
          <tr><td>Message history</td><td>one conversation</td><td>the definition&apos;s <code>store</code> or the application&apos;s <code>conversationStore</code></td><td>the Glove loop during a run</td></tr>
          <tr><td>Workspace entry</td><td>workspace</td><td>data adapter</td><td>host API, <code>glove_foundry_workspace</code>, your tools</td></tr>
          <tr><td>Shared inbox item</td><td>workspace</td><td>data adapter</td><td>host API, <code>glove_foundry_shared_inbox</code>, background reconvene</td></tr>
          <tr><td>Task</td><td>workspace</td><td>data adapter</td><td>host API, <code>glove_foundry_tasks</code></td></tr>
          <tr><td>Environment value</td><td>workspace, instance or conversation</td><td>data adapter</td><td>the adapter&apos;s <code>environment</code> seed option only</td></tr>
        </tbody>
      </table>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          Every run executes in its own child process, and that process builds its data
          adapter from <code>foundry.application.ts</code>. With no <code>data</code>{" "}
          configured, each process gets a private <code>MemoryFoundryDataAdapter</code>, so
          what an agent writes with the built-in tools is invisible to the host and to the
          next run. Configure a shared adapter such as <code>FileFoundryDataAdapter</code>{" "}
          (single host) or your own database adapter. See{" "}
          <Link href="/foundry/docs/persistence">Persistence</Link>.
        </p>
      </div>

      <h2 id="conversation-record">The conversation record</h2>
      <CodeBlock filename="glove-foundry (primitives.ts)" language="typescript" code={`interface Conversation {
  readonly id: string;           // default: "conversation_<uuid>"
  readonly agentId: string;      // owning instance
  readonly workspaceId: string;  // default: the instance's workspaceId
  readonly title?: string;
  readonly context: Readonly<Record<string, unknown>>; // your metadata
  readonly createdAt: string;
  readonly updatedAt: string;    // bumped on every message
}`} />
      <ul>
        <li>
          A conversation can only receive messages if its <code>workspaceId</code> equals
          its instance&apos;s. Otherwise the run is refused with &ldquo;The request, agent
          instance, and conversation must share a workspace.&rdquo; Choose the workspace
          when you create the <em>instance</em>; leave <code>workspaceId</code> off
          conversations.
        </li>
        <li>Creating a conversation with an id that already exists is an error.</li>
        <li>Titles set through an update must be 1–120 characters.</li>
        <li>
          <code>context</code> is yours. Foundry writes its own keys only on
          conversations it creates (<code>routeId</code>, <code>threadKey</code>,{" "}
          <code>conversationKey</code>, <code>conversationScope</code> for transmissions;{" "}
          <code>spawnedByRunId</code> for spawned work; <code>protocol</code> for{" "}
          <code>/v1</code> sessions).
        </li>
      </ul>

      <h2 id="create">Create, message, list and rename</h2>
      <p>
        Two customers write to the same support instance at once. Each gets its own
        conversation, so histories never mix, and both runs proceed in parallel. Two
        messages to the <em>same</em> conversation run one after the other; see{" "}
        <a href="#one-run-at-a-time">one run at a time</a>.
      </p>
      <CodeBlock filename="scripts/support-threads.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({
  baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141",
});

// One instance of agents/support/agent.ts in the "acme" workspace.
const support = await foundry.createAgent("support", { workspaceId: "acme" });

const billing = await foundry.createConversation(support.id, {
  title: "Order 4411 — double charge",
  context: { customerId: "cus_42", channel: "web" },
});
const shipping = await foundry.createConversation(support.id, {
  title: "Order 4412 — late delivery",
});

const [first] = await Promise.all([
  foundry.send(support.id, billing.id, "I was charged twice for order 4411."),
  foundry.send(support.id, shipping.id, "Where is order 4412?"),
]);
const done = await first.wait({ timeoutMs: 120_000 });
console.log(done.status, done.output);

const threads = await foundry.conversations(support.id);
await foundry.updateConversation(support.id, billing.id, {
  title: "Order 4411 — refunded",
});`} />
      <table>
        <thead><tr><th>Client method</th><th>HTTP</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>createConversation(agentId, {"{ id?, title?, context?, workspaceId? }"})</code></td><td><code>POST /api/conversations</code></td><td>Body adds <code>agentId</code>. 201.</td></tr>
          <tr><td><code>conversations(agentId)</code></td><td><code>GET /api/conversations?agent=</code></td><td><code>agent</code> is required.</td></tr>
          <tr><td><code>updateConversation(agentId, id, {"{ title?, context? }"})</code></td><td><code>PATCH /api/conversations/:id</code></td><td><code>context</code> replaces the whole object.</td></tr>
          <tr><td><code>send(agentId, id, message, {"{ payload?, context? }"})</code></td><td><code>POST /api/conversations/:id/messages</code></td><td>202 with the run. <code>message</code> is a string or Glove content parts.</td></tr>
          <tr><td><code>conversationTranscript(agentId, id, {"{ offset?, limit? }"})</code></td><td><code>GET /api/conversations/:id/messages?agent=</code></td><td>See below.</td></tr>
        </tbody>
      </table>
      <h3 id="one-run-at-a-time">One run at a time per conversation</h3>
      <p>
        Different conversations run in parallel. One conversation never has two runs acting
        on it at once: a run that is asked for while another holds the conversation waits,
        in arrival order, and starts once the run ahead has finished and its process has let
        go. Nothing needs configuring, and it covers every way a run starts: messages, the
        API, schedules and wake-ups, delegation results and inbound events.
      </p>
      <ul>
        <li>A waiting run exists and has an id; its status stays <code>pending</code>. It holds no
          concurrency slot, and the time it waits does not count against its timeout or
          against <code>wait()</code>. It starts from the conversation as the runs ahead of it
          left it.</li>
        <li>Cancelling a waiting run removes it; the ones behind it move up.</li>
        <li>To change course rather than queue,{" "}
          <Link href="/foundry/docs/approvals#steering">steer</Link>: the replacement goes ahead
          of anything already waiting.</li>
        <li>Inbound events and delegation updates do not wait if they can help it: one that
          arrives while the running turn is still calling tools joins that turn at its next
          tool step. Only what arrives during its final answer waits, and then starts the
          conversation&apos;s next run together with anything else that arrived meanwhile.</li>
        <li>A schedule firing (created inside the execution queue) waits in its process,
          before it reads any history.</li>
      </ul>
      <p>
        To ship fixed conversations with the code (a website chat thread, a voice line),
        seed them into the data adapter. Seeds are inserted only when their id is absent,
        so restarts keep existing data.
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import {
  FileFoundryDataAdapter,
  createConversation,
  defineAgentInstance,
  defineApplication,
} from "glove-foundry";
import support from "./agents/support/agent.js";

const supportDesk = defineAgentInstance(support, { id: "support-desk", workspaceId: "acme" });

export default defineApplication({
  name: "Support",
  data: new FileFoundryDataAdapter({
    file: ".foundry-data/state.json",
    agents: [supportDesk],
    conversations: [
      createConversation(supportDesk, { id: "support-web", title: "Website chat" }),
    ],
  }),
});`} />
      <p>
        Inside a run, the built-in <code>glove_foundry_conversations</code> tool lists the
        current instance&apos;s conversations.
      </p>

      <h2 id="transcripts">Read transcripts</h2>
      <p>
        A transcript is the exact native Glove history read from the conversation store
        the agent itself uses. Foundry never rebuilds history from runs or events. The
        built-in <Link href="/foundry/docs/observability">WebChat</Link> uses the same
        call.
      </p>
      <CodeBlock filename="scripts/support-threads.ts" language="typescript" code={`const transcript = await foundry.conversationTranscript(support.id, billing.id, { limit: 50 });

if (!transcript.persisted) console.warn("support has no conversation store configured");
for (const message of transcript.messages) console.log(\`\${message.sender}: \${message.text}\`);

if (transcript.page.hasEarlier) {
  const earlier = await foundry.conversationTranscript(support.id, billing.id, {
    offset: Math.max(0, transcript.page.offset - 50),
    limit: 50,
  });
}`} />
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>conversation</code></td><td>The conversation record.</td></tr>
          <tr><td><code>messages</code></td><td>Native Glove <code>Message[]</code> for the requested page.</td></tr>
          <tr><td><code>turnCount</code>, <code>tokenCount</code>, <code>tokenConsumption?</code></td><td>The store&apos;s own counters.</td></tr>
          <tr><td><code>page</code></td><td><code>{"{ offset, limit, total, hasEarlier, hasLater }"}</code>. <code>limit</code> defaults to 100 (1–500). Without <code>offset</code> you get the <em>latest</em> page.</td></tr>
          <tr><td><code>persisted</code></td><td><code>false</code> when neither the definition&apos;s <code>store</code> nor the application&apos;s <code>conversationStore</code> is set; <code>messages</code> is then empty.</td></tr>
        </tbody>
      </table>
      <div className="docs-note">
        <span className="docs-note-icon">!</span>
        <p>
          <code>persisted: true</code> only means a store factory exists. The control
          process calls that factory to read the transcript, so a factory that returns a
          fresh <code>new MemoryStore(...)</code> (as the starter templates do) reads back
          nothing. Use a durable store for real history.
        </p>
      </div>

      <h2 id="transmission-conversations">Conversations created by transmissions</h2>
      <p>
        When an inbound transmission event reaches an instance, Foundry finds or creates
        the conversation for that thread. You never create these yourself, and the same
        thread always lands in the same conversation.
      </p>
      <table>
        <thead><tr><th><code>conversationScope</code></th><th>Conversation id</th><th>Use for</th></tr></thead>
        <tbody>
          <tr><td><code>&quot;route&quot;</code> (default)</td><td><code>transmission:&lt;routeId&gt;:&lt;agentId&gt;:&lt;encoded key&gt;</code></td><td>One conversation per provider thread per route.</td></tr>
          <tr><td><code>&quot;agent&quot;</code></td><td>an existing conversation whose <code>context.conversationKey</code> equals the key, else <code>transmission:agent:&lt;agentId&gt;:&lt;encoded key&gt;</code></td><td>Joining several routes (email, chat, phone) into one conversation per customer.</td></tr>
        </tbody>
      </table>
      <p>
        The key is <code>conversationKey</code> when supplied, otherwise the provider{" "}
        <code>threadKey</code>. A connection passes both in its <code>receive</code> input (
        <code>ConnectionReceiveInput</code>); a webhook bridge passes them to{" "}
        <code>POST /api/transmissions/:routeId/fire</code>:
      </p>
      <CodeBlock filename="scripts/forward-ticket.ts" language="typescript" code={`const runs = await foundry.dispatchInbound({
  routeId: "tickets-inbound",
  eventId: "evt_9001",            // dedupe key: the same event never runs twice
  threadKey: "ticket-4411",       // provider thread
  conversationKey: "customer:cus_42",
  conversationScope: "agent",     // reuse this customer's conversation across routes
  raw: { type: "message", text: "Any update?" },
});`} />
      <p>
        To attach a transmission thread to a conversation you created yourself, put the
        same key in its context — <code>createConversation(agentId, {"{ context: { conversationKey: \"customer:cus_42\" } }"})</code>{" "}
        — and deliver with <code>conversationScope: &quot;agent&quot;</code>. More than one
        conversation with the same key is an error. Only use <code>&quot;agent&quot;</code>{" "}
        scope when a trusted adapter produced the key. See{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>
      <p>
        A second event on a thread whose run is still working does not start a run beside
        it: it joins that run&apos;s turn at the next tool step, or starts the thread&apos;s
        next run once it is free (<a href="#one-run-at-a-time">one run at a time</a>).
      </p>

      <h2 id="workspace">The workspace primitives</h2>
      <table>
        <thead><tr><th>Primitive</th><th>Shape</th><th>Statuses</th><th>Typical use</th></tr></thead>
        <tbody>
          <tr><td>Workspace entry</td><td><code>{"{ workspaceId, key, value, updatedAt }"}</code></td><td>—</td><td>Shared decisions, policies, artifact references, claims.</td></tr>
          <tr><td>Shared inbox item</td><td><code>{"{ id, workspaceId, agentId?, conversationId?, topic, payload, status, createdAt, updatedAt }"}</code></td><td><code>pending</code> · <code>resolved</code> · <code>dismissed</code></td><td>Handoffs and results addressed to an instance or conversation.</td></tr>
          <tr><td>Task</td><td><code>{"{ id, workspaceId, agentId?, conversationId?, title, detail?, status, createdAt, updatedAt }"}</code></td><td><code>open</code> · <code>in-progress</code> · <code>completed</code> · <code>cancelled</code></td><td>Units of work with an owner and progress.</td></tr>
          <tr><td>Environment value</td><td><code>{"{ key, value, scope, workspaceId, agentId?, conversationId? }"}</code></td><td>—</td><td>Non-secret configuration such as a region or escalation address.</td></tr>
        </tbody>
      </table>

      <h3 id="host-api">From host code</h3>
      <CodeBlock filename="scripts/support-ops.ts" language="typescript" code={`await foundry.putWorkspaceEntry("acme", "refund-policy", { maxAutoRefund: 50, currency: "USD" });
const entries = await foundry.workspaceEntries("acme");

const handoff = await foundry.postSharedInbox("acme", {
  topic: "escalation",
  payload: { orderId: "4411", reason: "refund above the auto-approval limit" },
  agentId: support.id,          // optional addressee
  conversationId: billing.id,   // optional
});
await foundry.updateSharedInbox("acme", handoff.id, "resolved");

const task = await foundry.createTask("acme", {
  title: "Refund order 4411",
  detail: "Duplicate charge confirmed by payments.",
  agentId: support.id,
  conversationId: billing.id,
});
await foundry.updateTask("acme", task.id, "in-progress");

// Workspace values, plus agent- and conversation-scoped ones when ids are given.
const values = await foundry.dataEnvironment("acme", { agentId: support.id, conversationId: billing.id });`} />
      <table>
        <thead><tr><th>Client method</th><th>HTTP</th></tr></thead>
        <tbody>
          <tr><td><code>workspaceEntries(ws)</code> · <code>putWorkspaceEntry(ws, key, value)</code></td><td><code>GET</code> · <code>PUT /api/workspaces/:ws/entries</code> (body <code>{"{ key, value }"}</code>)</td></tr>
          <tr><td><code>sharedInbox(ws)</code> · <code>postSharedInbox(ws, input)</code></td><td><code>GET</code> · <code>POST /api/workspaces/:ws/inbox</code> (new items are <code>pending</code>)</td></tr>
          <tr><td><code>updateSharedInbox(ws, itemId, status)</code></td><td><code>PATCH /api/workspaces/:ws/inbox/:itemId</code> (body <code>{"{ status }"}</code>)</td></tr>
          <tr><td><code>tasks(ws)</code> · <code>createTask(ws, input)</code></td><td><code>GET</code> · <code>POST /api/workspaces/:ws/tasks</code> (new tasks are <code>open</code>)</td></tr>
          <tr><td><code>updateTask(ws, taskId, status)</code></td><td><code>PATCH /api/workspaces/:ws/tasks/:taskId</code></td></tr>
          <tr><td><code>dataEnvironment(ws, {"{ agentId?, conversationId? }"})</code></td><td><code>GET /api/workspaces/:ws/environment?agent=&amp;conversation=</code></td></tr>
        </tbody>
      </table>
      <p>
        There is no delete endpoint for entries, inbox items or tasks, and no write
        endpoint for environment values; <code>putWorkspaceEntry</code> is last-write-wins.
      </p>

      <h3 id="agent-tools">From the agent: built-in tools</h3>
      <p>
        Every assembled run gets these tools automatically (alongside the scheduling and
        spawn tools covered in <Link href="/foundry/docs/automation">Automation</Link>).
        They operate on the run&apos;s own workspace; an agent cannot reach another
        workspace through them.
      </p>
      <table>
        <thead><tr><th>Tool</th><th>Input</th><th>Behaviour</th></tr></thead>
        <tbody>
          <tr><td><code>glove_foundry_workspace</code></td><td><code>{"{ action: \"get\", key }"}</code> · <code>{"{ action: \"set\", key, value }"}</code> · <code>{"{ action: \"list\" }"}</code></td><td><code>set</code> is last-write-wins.</td></tr>
          <tr><td><code>glove_foundry_shared_inbox</code></td><td><code>{"{ action: \"list\" }"}</code> · <code>{"{ action: \"post\", topic, payload, agentId?, conversationId? }"}</code> · <code>{"{ action: \"update\", itemId, status }"}</code></td><td>Posts default the addressee to the current instance and conversation; new items are <code>pending</code>.</td></tr>
          <tr><td><code>glove_foundry_tasks</code></td><td><code>{"{ action: \"list\" }"}</code> · <code>{"{ action: \"create\", title, detail? }"}</code> · <code>{"{ action: \"update\", taskId, status }"}</code></td><td>Created tasks are owned by the current instance and conversation, status <code>open</code>.</td></tr>
          <tr><td><code>glove_foundry_environment</code></td><td><code>{"{}"}</code></td><td>Lists workspace values plus this instance&apos;s and this conversation&apos;s.</td></tr>
          <tr><td><code>glove_foundry_conversations</code></td><td><code>{"{}"}</code></td><td>Lists this instance&apos;s conversations.</td></tr>
        </tbody>
      </table>

      <h3 id="ctx-data">Your own tools over <code>ctx.data</code></h3>
      <p>
        For anything the built-ins don&apos;t cover, write a tool with the resolver form
        of <code>tools</code>. The assembly context carries the data adapter as{" "}
        <code>ctx.data</code> (every method returns an Effect) plus{" "}
        <code>workspaceId</code>, <code>agentId</code> and <code>conversationId</code>.
        This is also how agents use <code>compareAndSetWorkspaceEntry</code>, the
        adapter&apos;s optional atomic update: pass <code>null</code> to require that the
        key does not exist yet, or the current <code>updatedAt</code> to require that
        nobody changed it; the new entry must carry a later <code>updatedAt</code>. It
        returns <code>false</code> when someone else won. Both built-in adapters
        implement it.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { Effect } from "effect";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

export default defineAgent({
  description: "Answers customer support tickets",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "You resolve support tickets. Claim a ticket before you work on it.",
  store: ({ conversationId }) => FileStore.open(conversationId),
  tools: (_agent, ctx) => [
    {
      name: "claim_ticket",
      description: "Claim a ticket so no other agent works on it at the same time.",
      inputSchema: z.object({ ticketId: z.string() }),
      async do({ ticketId }) {
        const attempt = ctx.data.compareAndSetWorkspaceEntry?.(
          {
            workspaceId: ctx.workspaceId,
            key: \`claim:\${ticketId}\`,
            value: { agentId: ctx.agentId, conversationId: ctx.conversationId },
            updatedAt: new Date().toISOString(),
          },
          null, // succeed only if nobody has claimed it yet
        );
        if (!attempt) {
          return { status: "error" as const, data: null, message: "This data adapter has no atomic update." };
        }
        const claimed = await Effect.runPromise(attempt);
        return { status: "success" as const, data: { ticketId, claimed } };
      },
    },
  ],
});`} />
      <p>
        <code>ctx.data</code> exists on the assembly context used by resolvers. The
        contexts passed to <code>defineCall</code> handlers, layers and{" "}
        <code>run</code> do not carry it, so capture it in a resolver as above.
      </p>

      <h3 id="environment">Environment values</h3>
      <p>
        Environment values are seeded through the <code>environment</code> option of{" "}
        <code>MemoryFoundryDataAdapter</code> or <code>FileFoundryDataAdapter</code> and
        are read-only afterwards. A value with <code>scope: &quot;agent&quot;</code> needs{" "}
        <code>agentId</code>; <code>&quot;conversation&quot;</code> needs{" "}
        <code>conversationId</code>. They are not <code>process.env</code> and must never
        hold secrets — keep credentials in adapters.
      </p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`new FileFoundryDataAdapter({
  file: ".foundry-data/state.json",
  environment: [
    { scope: "workspace", workspaceId: "acme", key: "region", value: "eu-west" },
    { scope: "agent", workspaceId: "acme", agentId: "support-desk",
      key: "escalationEmail", value: "tier2@acme.example" },
  ],
});`} />

      <h2 id="inboxes">Lazy <code>inboxes</code>: feed results into the next turn</h2>
      <p>
        The shared inbox is Foundry data; the model never sees it unless a tool reads
        it. The <code>inboxes</code> field bridges the two: a resolver (it must be a
        function) that returns native Glove <code>InboxItem[]</code> for the current run.
        Foundry loads them into the conversation store before the loop starts, and Glove
        does the rest:
      </p>
      <ul>
        <li><code>resolved</code> items are injected into the next model turn as an inbox message, then marked <code>consumed</code> in the store.</li>
        <li><code>pending</code> items with <code>blocking: true</code> add a notice that dependent actions must wait.</li>
        <li>Loading adds unknown ids and updates <code>status</code>/<code>response</code>/<code>resolved_at</code> of known ones. It never deletes. Returning an item again as <code>resolved</code> re-injects it, so hand each item over once.</li>
        <li>The store must be inbox-capable (<code>MemoryStore</code> from <code>glove-core</code> is).</li>
      </ul>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import type { InboxItem } from "glove-core";
import { Effect } from "effect";

// inside defineAgent({ ... })
inboxes: async (_agent, ctx) => {
  const shared = await Effect.runPromise(ctx.data.listInboxItems(ctx.workspaceId));
  const ready = shared.filter(
    (item) => item.conversationId === ctx.conversationId && item.status === "resolved",
  );
  for (const item of ready) {
    // Dismissed items are not loaded again.
    await Effect.runPromise(ctx.data.putInboxItem({
      ...item,
      status: "dismissed",
      updatedAt: new Date().toISOString(),
    }));
  }
  return ready.map((item): InboxItem => ({
    id: item.id,
    tag: item.topic,
    request: \`Shared inbox item "\${item.topic}"\`,
    response: JSON.stringify(item.payload).slice(0, 4_000),
    status: "resolved",
    blocking: false,
    created_at: item.createdAt,
    resolved_at: item.updatedAt,
  }));
},`} />
      <p>
        When <code>inboxes</code> is set, each run emits{" "}
        <code>foundry.definition.inboxes.loaded</code> with{" "}
        <code>{"{ count, added, updated }"}</code>. Mesh messages use the same native
        inbox; see <Link href="/foundry/docs/multi-agent#mesh">Multi-agent</Link>.
      </p>

      <h2 id="artifacts">Pass artifacts by reference</h2>
      <p>
        Put a pointer in shared data, not a document in a prompt: a workspace entry such
        as <code>{"{ key: \"order-4411/summary\", value: { path: \"/out/refund-4411.md\", producedBy: runId } }"}</code>,
        or a shared inbox payload with the same shape. The reader opens the canonical file
        and the history of who wrote it stays inspectable. A reference only helps if the
        reader can resolve it: agents inside one run (subagents, an in-process mesh) can
        share one working environment, while separate instances need storage both can
        read, such as your own VFS persistence keyed by workspace or an object-store key.
        Foundry&apos;s own VFS snapshots are private to an agent or conversation and are
        never exposed as workspace entries. See{" "}
        <Link href="/foundry/docs/working-environments">Working environments</Link>.
      </p>

      <h2 id="background">Background work and reconvene</h2>
      <p>
        <code>glove_foundry_background</code> lets the model start more work without
        waiting for it. Input: <code>{"{ message, payload?, definitionId?, reconvene? }"}</code>;{" "}
        <code>reconvene</code> defaults to <code>true</code>. The tool returns{" "}
        <code>{"{ commandId, accepted: true, type: \"background\" }"}</code> at once, and
        the runtime queues a new run with the <strong>same instance and the same
        conversation</strong> (<code>source.kind: &quot;background&quot;</code>).
      </p>
      <p>
        With <code>reconvene</code> on, Foundry waits for that run (up to 60 seconds) and
        then posts a shared inbox item to the calling conversation:{" "}
        <code>topic: &quot;background.reconvene&quot;</code>,{" "}
        <code>status: &quot;resolved&quot;</code>,{" "}
        <code>payload: {"{ commandId, run }"}</code>. If the run is still going after 60
        seconds the item records its unfinished status. Nothing wakes the conversation:
        the result reaches the model on its next turn only if you load it, for example
        with the <a href="#inboxes"><code>inboxes</code> resolver</a> above.
      </p>
      <div className="docs-note">
        <span className="docs-note-icon">◆</span>
        <p>
          Because background runs share the caller&apos;s conversation history, prefer{" "}
          <code>glove_foundry_spawn</code> (a new conversation by default) for long or
          independent work, and use the shared inbox or a task to report back. See{" "}
          <Link href="/foundry/docs/multi-agent#spawn">Multi-agent systems</Link>.
        </p>
      </div>
    </article>
  );
}
