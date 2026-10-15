import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Multi-agent systems",
  description:
    "Subagents with least-privilege tools, typed calls, spawn and background runs, client-driven fan-out, mesh peers, voice hosts and visible orchestration.",
};

export default function MultiAgentPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Give agents a world / Multi-agent systems</span>
      <h1>Multi-agent systems</h1>
      <p className="blog-lede">
        Foundry does not impose one orchestration pattern. A support agent can ask a
        read-only researcher for facts, hand a refund to a billing agent, fan a batch of
        tickets out to parallel conversations, or sit behind a live voice line — and
        every hop shows up in the same event trace.
      </p>

      <h2 id="choose">Choose the smallest boundary</h2>
      <table>
        <thead><tr><th>Mechanism</th><th>Runs where</th><th>Result comes back</th><th>Use when</th></tr></thead>
        <tbody>
          <tr><td><a href="#subagents"><code>defineSubagent</code></a></td><td>Inside the parent&apos;s run and process, with its own Glove, prompt and store</td><td>As the parent&apos;s tool result</td><td>A bounded sub-task needs a different prompt or fewer tools, and the parent waits for the answer.</td></tr>
          <tr><td><a href="#calls"><code>defineCall</code></a></td><td>Inside the run; a plain function</td><td>Return value, validated by Zod</td><td>A deterministic step with a known output shape. No model involved.</td></tr>
          <tr><td><a href="#spawn"><code>glove_foundry_spawn</code></a></td><td>A new queued run, new or existing instance and conversation</td><td>Not returned (command id only)</td><td>The model decides to start separate durable work now.</td></tr>
          <tr><td><Link href="/foundry/docs/conversations#background"><code>glove_foundry_background</code></Link></td><td>A new queued run on the <em>same</em> instance and conversation</td><td>Optional <code>background.reconvene</code> inbox item</td><td>Follow-up work on the same thread.</td></tr>
          <tr><td><a href="#client-fan-out">Typed client from code</a></td><td>Any instance and conversation</td><td><code>handle.wait()</code></td><td>Deterministic fan-out / fan-in that you, not the model, control.</td></tr>
          <tr><td><a href="#mesh"><code>mesh</code></a></td><td>Between runs that are live at the same time, over your transport</td><td>Messages land in the receiver&apos;s inbox</td><td>Peers that must talk while both are working.</td></tr>
          <tr><td><a href="#shared-work">Workspace, inbox, tasks</a></td><td>Durable data</td><td>Whenever someone reads it</td><td>Handoffs that may outlive any single run.</td></tr>
          <tr><td><Link href="/foundry/docs/automation">Playbook subscriptions</Link></td><td>The runtime, on inbound events</td><td>—</td><td>An inbound event should provision or wake a workforce.</td></tr>
          <tr><td><a href="#voice">Voice host</a></td><td>A realtime session that delegates to Foundry instances</td><td>The delegation tool&apos;s result</td><td>A speaking agent must stay responsive while durable work runs elsewhere.</td></tr>
        </tbody>
      </table>

      <h2 id="subagents">Subagents with least-privilege tools</h2>
      <p>
        A subagent is a separate Glove the parent model can call. When a definition has
        subagents, Glove registers the <code>glove_invoke_subagent</code> tool; an{" "}
        <code>@name</code> mention in the user&apos;s text is a routing hint. The child
        runs to completion inside the parent&apos;s tool call and its final answer
        becomes the tool result.
      </p>
      <p>
        The <code>tools</code> option can be a function of the <em>fully assembled</em>{" "}
        parent, resolved only when the subagent is invoked — after installations, MCP
        servers and message-dependent tools are mounted. That lets a delegate inherit a
        read operation without inheriting the parent&apos;s write surface. Foundry has no
        built-in projection helper; <code>parent.tools</code> exposes the registered
        tools, so a five-line function does it:
      </p>
      <CodeBlock filename="agents/billing/agent.ts" language="typescript" code={`import { MemoryStore, getToolJsonSchema, type GloveFoldArgs, type IGloveRunnable } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineSubagent } from "glove-foundry";

// Re-expose selected tools of the assembled parent, by name.
function projectTools(parent: IGloveRunnable, names: ReadonlyArray<string>): ReadonlyArray<GloveFoldArgs<unknown>> {
  return parent.tools
    .filter((tool) => names.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      jsonSchema: getToolJsonSchema(tool),
      do: (input, _display, _glove, signal) => tool.run(input, undefined, signal),
    }));
}

export default defineAgent({
  description: "Handles refunds and billing questions",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "You handle billing. Ask @order-researcher to gather facts before deciding.",
  store: ({ conversationId }) => new MemoryStore(\`billing:\${conversationId}\`),
  subagents: [
    defineSubagent({
      name: "order-researcher",
      description: "Look up orders and summarize what happened. Read-only.",
      systemPrompt: "Gather facts about one order. Never change anything. Return a short summary.",
      tools: ({ parent }) => projectTools(parent, ["lookup_order", "glove_foundry_workspace"]),
    }),
  ],
});`} />
      <table>
        <thead><tr><th><code>defineSubagent</code> option</th><th>Default / notes</th></tr></thead>
        <tbody>
          <tr><td><code>name</code>, <code>description</code>, <code>systemPrompt</code></td><td>Required. <code>name</code> matches <code>/^[A-Za-z][\w-]*$/</code>.</td></tr>
          <tr><td><code>tools</code></td><td>An array, or <code>({"{ name, prompt, parent }"}) =&gt; tools</code> (may return a Promise or Effect). Default: no tools.</td></tr>
          <tr><td><code>model</code></td><td>The parent&apos;s model.</td></tr>
          <tr><td><code>durable</code></td><td><code>false</code>: a fresh child store per invocation via the parent store&apos;s <code>createSubAgentStore</code>. <code>true</code>: the same child store for that name, so history carries over between invocations.</td></tr>
          <tr><td><code>serverMode</code></td><td>The parent&apos;s.</td></tr>
          <tr><td><code>compactionInstructions</code></td><td>&ldquo;Preserve the &lt;name&gt; subagent&apos;s findings and unresolved work.&rdquo;</td></tr>
          <tr><td><code>maxRetries</code>, <code>maxConsecutiveErrors</code>, <code>compactionLimit</code>, <code>maxTurns</code>, <code>enableToolResultSummary</code></td><td>Glove defaults.</td></tr>
          <tr><td><code>hooks</code>, <code>skills</code>, <code>subagents</code></td><td>Mounted on the child.</td></tr>
          <tr><td><code>configure(context)</code></td><td>Runs after the child is built. Its context is synthetic: <code>conversationId</code> and <code>runId</code> are <code>subagent:&lt;name&gt;</code>, <code>workspaceId</code> is <code>&quot;subagent&quot;</code>, <code>emit</code> is a no-op.</td></tr>
          <tr><td><code>layers</code>, <code>subscribers</code></td><td>Accepted by the type but not mounted by the current implementation; use <code>configure</code>.</td></tr>
        </tbody>
      </table>
      <p>
        The child uses the parent&apos;s display manager and, unless overridden, its
        model and <code>serverMode</code>; prompt, store and compaction are its own.
        Parent subscribers still record{" "}
        <code>subagent_invoked</code> and <code>subagent_completed</code>, so delegation
        appears in the parent run&apos;s trace (category <code>extension</code>). The{" "}
        <code>subagents</code> field itself can be a resolver, so the set of specialists
        can depend on the instance or message.
      </p>

      <h2 id="calls">Typed calls</h2>
      <p>
        <code>defineCall</code> is a schema-checked function that lives in the run. By
        default (<code>exposeToAgent: true</code>) it is also a tool the model can call;
        your own code calls it with <code>ctx.invoke(name, input)</code> from{" "}
        <code>run</code> or <code>configure</code>. Input is parsed with{" "}
        <code>input</code>, the handler&apos;s return value with <code>output</code>;
        a thrown error or failed parse becomes an error tool result for the model.
      </p>
      <CodeBlock filename="agents/billing/agent.ts" language="typescript" code={`import { defineCall } from "glove-foundry";
import { z } from "zod";

const RefundQuote = z.object({ orderId: z.string(), refundable: z.boolean(), amount: z.number() });

// inside defineAgent({ ... })
calls: [
  defineCall({
    name: "refund_quote",
    description: "Compute how much of an order can be refunded.",
    input: z.object({ orderId: z.string() }),
    output: RefundQuote,
    handler: async ({ orderId }) => {
      // your code: const order = await billingApi.getOrder(orderId)
      const order = { id: orderId, paid: 42, refunded: 0 };
      return { orderId: order.id, refundable: order.refunded < order.paid, amount: order.paid - order.refunded };
    },
  }),
],
run: async (_glove, ctx) => {
  const orderId = /\\b\\d{4,}\\b/.exec(ctx.messageText)?.[0];
  if (!orderId) return ctx.defaultRun();
  const quote = (await ctx.invoke("refund_quote", { orderId })) as z.output<typeof RefundQuote>;
  ctx.emit({ type: "billing.quote.ready", data: { orderId, refundable: quote.refundable } });
  return ctx.defaultRun(\`\${ctx.messageText}\\n\\n[Refund quote: \${JSON.stringify(quote)}]\`);
},`} />
      <ul>
        <li>Names match <code>/^[A-Za-z][A-Za-z0-9_-]*$/</code>; two calls with one name fail assembly.</li>
        <li>Set <code>exposeToAgent: false</code> for calls only your code should use.</li>
        <li><code>calls</code> can be a resolver, so a call can close over the instance or message.</li>
        <li>
          <code>ctx.spawn(message)</code> inside <code>run</code> is unrelated to agent
          spawning: it runs the definition&apos;s layered <code>spawn</code> hook (S2S/S2V)
          or the normal loop. See <Link href="/foundry/docs/composition">defineAgent &amp; assembly</Link>.
        </li>
      </ul>

      <h2 id="spawn">Spawn a separate run</h2>
      <p>
        Every run has the built-in <code>glove_foundry_spawn</code> tool. The model uses
        it to start durable work elsewhere — for example the support agent handing a
        refund dispute to the billing definition — without waiting for it.
      </p>
      <table>
        <thead><tr><th>Input</th><th>Default when omitted</th></tr></thead>
        <tbody>
          <tr><td><code>message</code> (string, required)</td><td>—</td></tr>
          <tr><td><code>definitionId</code></td><td>The caller&apos;s definition (a route such as <code>&quot;billing&quot;</code>).</td></tr>
          <tr><td><code>agentId</code></td><td>A <strong>new</strong> instance of <code>definitionId</code> in the caller&apos;s workspace, with <code>context.spawnedByRunId</code>. An unknown id creates an instance with that id.</td></tr>
          <tr><td><code>conversationId</code></td><td>A new conversation (unknown ids are created with that id), with <code>context.spawnedByRunId</code>.</td></tr>
          <tr><td><code>payload</code></td><td>None. Passed as the child request&apos;s <code>payload</code>.</td></tr>
        </tbody>
      </table>
      <p>
        The tool returns <code>{"{ commandId, accepted: true, type: \"spawn\" }"}</code>{" "}
        immediately. The runtime queues the child run (<code>source.kind: &quot;spawn&quot;</code>)
        and records <code>core.command.accepted</code> with the <code>childRunId</code> on
        the parent run, or <code>core.command.failed</code> with the error. The result is
        not delivered back; have the child report through the{" "}
        <Link href="/foundry/docs/conversations#workspace">shared inbox, a task or a workspace entry</Link>.
        Tell the model the real ids it may use in its system prompt. For later or
        recurring work use <code>glove_foundry_schedule</code> (see{" "}
        <Link href="/foundry/docs/automation">Automation</Link>).
      </p>

      <h2 id="client-fan-out">Fan out from code with the typed client</h2>
      <p>
        When the orchestration itself should be deterministic, write it in a{" "}
        <code>run</code> function and drive other instances through{" "}
        <code>glove-foundry/client</code>. This is how{" "}
        <code>examples/foundry-braind-storm</code> runs campaign batches. Each ticket gets
        its own conversation on the support instance, so histories stay separate and the
        runs execute in parallel.
      </p>
      <CodeBlock filename="agents/triage/agent.ts" language="typescript" code={`import { MemoryStore } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141" });

interface Ticket { readonly id: string; readonly summary: string }

export default defineAgent({
  description: "Fans a batch of tickets out to the support agent, one conversation each",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "Coordinate ticket batches.",
  store: ({ conversationId }) => new MemoryStore(\`triage:\${conversationId}\`),
  run: async (_glove, ctx) => {
    const tickets = (ctx.request.payload as { tickets?: Ticket[] } | undefined)?.tickets ?? [];
    const results = await Promise.all(tickets.map(async (ticket) => {
      const conversation = await foundry.createConversation("support-desk", {
        id: \`ticket-\${ticket.id}\`,
        title: ticket.summary,
        context: { parentRunId: ctx.runId },
      });
      const handle = await foundry.send("support-desk", conversation.id, ticket.summary, {
        context: { parentRunId: ctx.runId },
      });
      ctx.emit({ type: "triage.ticket.started", data: { ticketId: ticket.id, runId: handle.id } });
      const run = await handle.wait({ pollMs: 500, timeoutMs: 10 * 60_000 });
      ctx.emit({ type: "triage.ticket.finished", data: { ticketId: ticket.id, status: run.status } });
      return { ticketId: ticket.id, status: run.status, runId: handle.id };
    }));
    return { tickets: results };
  },
});`} />
      <ul>
        <li>The run reaches the server over HTTP: set <code>FOUNDRY_URL</code> for the agent process, and pass an <code>authorization</code> adapter to <code>createFoundryClient</code> if the server uses <code>requestAuthorization</code>.</li>
        <li>At most <code>execution.maxConcurrent</code> runs execute at once (default 5); the rest queue. An orchestrator that waits holds one of those slots, so size the limit for parent plus children.</li>
        <li><code>handle.wait()</code> polls every 150 ms and times out after 60 s by default; pass <code>timeoutMs</code> for long work.</li>
      </ul>

      <h3 id="parallel">Parallel campaigns are conversations</h3>
      <p>
        Model concurrent work as separate conversations (or instances) and runs, never as
        branches inside one prompt. Each gets its own history, run id, trace and cancel
        button; sequential dependencies become explicit waits in your orchestrator. The
        braind-storm campaign orchestrator accepts up to eight campaigns and runs them{" "}
        <code>parallel</code>, <code>sequential</code>, or <code>auto</code> (waves
        computed from <code>dependsOn</code>), one lead conversation per campaign.
      </p>

      <h2 id="mesh">Mesh: peers that talk while running</h2>
      <p>
        The <code>mesh</code> field mounts <Link href="/docs/mesh">Glove Mesh</Link> on
        the run. Its value (or resolver result) is a <code>FoundryMeshConfig</code>:
      </p>
      <CodeBlock filename="glove-foundry (definition.ts)" language="typescript" code={`interface FoundryMeshConfig {
  readonly adapter: MeshAdapter; // from glove-mesh: your transport, one adapter per agent
  readonly identity?: Omit<AgentIdentity, "id"> & { readonly id?: string };
}`} />
      <CodeBlock filename="agents/billing/agent.ts" language="typescript" code={`import { createMeshAdapter } from "../../lib/mesh.js"; // your code: a MeshAdapter over Redis, NATS, …

// inside defineAgent({ ... })
mesh: (_agent, ctx) => ({
  adapter: createMeshAdapter(ctx.agentId),
  identity: { name: "Billing", description: "Refunds and invoices", capabilities: ["refunds"] },
}),`} />
      <ul>
        <li>Identity defaults: <code>id</code> and <code>name</code> = the instance id, <code>description</code> = the definition&apos;s; <code>metadata</code> always includes <code>definitionId</code>, <code>conversationId</code> and <code>workspaceId</code>.</li>
        <li>Mounts <code>glove_mesh_send_message</code>, <code>glove_mesh_broadcast</code>, <code>glove_mesh_list_agents</code> and <code>glove_mesh_acknowledge</code>. Incoming messages become resolved inbox items, so the store must be inbox-capable.</li>
        <li>The agent registers when the run assembles and <code>adapter.unregister()</code> runs at cleanup: a peer is reachable only while one of its runs is executing.</li>
        <li>Each run is its own process, so <code>InMemoryMeshAdapter</code> cannot connect two Foundry runs. Use a transport-backed adapter, or build the whole mesh inside one run as braind-storm does.</li>
      </ul>

      <h2 id="shared-work">Coordinate through shared work</h2>
      <p>
        For handoffs that must survive restarts, coordinate through{" "}
        <Link href="/foundry/docs/conversations#workspace">workspace data</Link> rather
        than live messages:
      </p>
      <table>
        <thead><tr><th>Need</th><th>Primitive</th></tr></thead>
        <tbody>
          <tr><td>Hand a result to a specific instance or conversation</td><td>Shared inbox item with <code>agentId</code>/<code>conversationId</code>, loaded on its next turn via <Link href="/foundry/docs/conversations#inboxes"><code>inboxes</code></Link></td></tr>
          <tr><td>Make sure only one agent takes a job</td><td><code>compareAndSetWorkspaceEntry</code> with <code>null</code> (a claim)</td></tr>
          <tr><td>Show who owns what and how far it got</td><td>Tasks: <code>open</code> → <code>in-progress</code> → <code>completed</code>/<code>cancelled</code></td></tr>
          <tr><td>Share a document</td><td>A workspace entry holding a path or object key, not the body</td></tr>
        </tbody>
      </table>

      <h2 id="voice">Voice hosts delegate durable work</h2>
      <p>
        A realtime voice session owns turn-taking, interruption and audio; it is not a
        durable Foundry run. Keep it thin and give it a delegation tool that sends work
        to a persisted instance and conversation through the typed client. The work then
        has a run id, a trace, approvals and a transcript. Use{" "}
        <code>glove-voice-s2s</code> (<code>RealtimeAgent</code>, Gemini Live, OpenAI
        Realtime, GPT-Live) for speech-to-speech or <code>glove-voice</code> for an
        STT → Glove → TTS pipeline; see <Link href="/docs/realtime-voice">Realtime voice</Link>.
      </p>
      <CodeBlock filename="agents/phone-line/delegate.ts" language="typescript" code={`import type { GloveFoldArgs } from "glove-core";
import { createFoundryClient } from "glove-foundry/client";
import { z } from "zod";

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141" });

export const delegateToSupport: GloveFoldArgs<{ request: string }> = {
  name: "delegate_to_support",
  description: "Hand a customer request to the support team. Returns a run id to read back.",
  inputSchema: z.object({ request: z.string().min(3) }),
  async do({ request }) {
    const handle = await foundry.send("support-desk", "support-voice", request, {
      context: { channel: "voice" },
    });
    return { status: "success", data: { accepted: true, runId: handle.id } };
  },
};`} />
      <p>
        <strong>Reference implementation: <code>examples/foundry-braind-storm</code>.</strong>{" "}
        A brand workforce where you talk to Mara, the lead:
      </p>
      <ul>
        <li><code>agents/briefing-line</code> — a Foundry agent whose model is <code>s2sDrivenModel({"{ provider: \"gemini\" }"})</code> and whose <code>run</code> wraps the assembled Glove in <code>RealtimeAgent</code> and serves a local WebSocket call room. Its tools: <code>get_storm_briefing</code> (read the latest work), <code>record_direction</code> (persist spoken direction), <code>launch_campaign_workforce</code> (start real work).</li>
        <li><code>launch_campaign_workforce</code> calls <code>client.send</code> on the <code>campaign-orchestrator</code> instance and returns the batch run id at once, so the call never blocks on the work.</li>
        <li><code>agents/campaign-orchestrator</code> — a headless <code>run</code> that plans waves and gives each campaign its own conversation on the lead instance (<code>createConversation</code> → <code>send</code> → <code>wait</code>), emitting <code>braind.campaign.*</code> events.</li>
        <li><code>agents/lead</code> — Mara&apos;s <code>run</code> convenes four specialists (scout, strategist, maker, critic) over an in-process Glove Mesh with one shared working environment, passing <code>/out/...</code> paths instead of document bodies.</li>
        <li>All instances and conversations are seeded in <code>foundry.application.ts</code> in one workspace. Run it with <code>GEMINI_API_KEY</code> set and <code>pnpm --filter glove-foundry-braind-storm dev</code>.</li>
      </ul>

      <h2 id="visible">Make orchestration visible</h2>
      <p>
        Emit a short, safe event at every milestone: who handed what to whom, for which
        conversation, and where the artifact is. Use <code>ctx.emit</code> in{" "}
        <code>run</code>, calls and layers, or <code>ctx.controls.emit</code> in
        resolvers. Events are stored with the run id and definition, appear in the
        inspector&apos;s run trace (custom types land in category <code>system</code>), and
        can be read with <code>client.getEvents({"{ runId }"})</code>,{" "}
        <code>handle.events()</code> or the live stream at <code>GET /api/events</code>{" "}
        with <code>Accept: text/event-stream</code>.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`ctx.emit({
  type: "support.handoff",
  data: {
    to: "billing",
    purpose: "refund above auto-approval limit",
    conversationId: ctx.conversationId,
    artifact: "/out/refund-4411.md",
  },
});`} />
      <p>
        Foundry already records the structural events: <code>foundry.core.command</code>{" "}
        for every spawn, background, schedule and transmit command (transmit payloads are
        withheld), <code>core.command.accepted</code> with the child run id,{" "}
        <code>core.command.failed</code>, and the subagent bracket. Emit intent and
        outcomes, never secrets or private model reasoning. See{" "}
        <Link href="/foundry/docs/observability">Inspector &amp; WebChat</Link>.
      </p>
    </article>
  );
}
