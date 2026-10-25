import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Multi-agent systems",
  description:
    "The mesh between agents, subagents with least-privilege tools, typed calls, spawn and background runs, client-driven fan-out, voice calls and visible orchestration.",
};

export default function MultiAgentPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Design your system / Multi-agent systems</span>
      <h1>Multi-agent systems</h1>
      <p className="blog-lede">
        Foundry does not impose one orchestration pattern. An assistant can message another
        agent and hear back, ask a read-only researcher for facts inside its turn,
        fan a batch of tickets out to parallel conversations, or take a live call, and
        every hop shows up in the same event trace.
      </p>

      <h2 id="choose">Choose the smallest boundary</h2>
      <table>
        <thead><tr><th>Mechanism</th><th>Runs where</th><th>Result comes back</th><th>Use when</th></tr></thead>
        <tbody>
          <tr><td><a href="#mesh"><code>mesh</code></a></td><td>A new run on another agent instance, in a conversation per thread</td><td>Back in the conversation that sent it: into a listening run, or as a new turn. The other agent can ask questions too.</td><td>Agents work together: a fast agent hands off slow work and keeps talking, or teammates pass work between them.</td></tr>
          <tr><td><a href="#subagents"><code>defineSubagent</code></a></td><td>Inside the parent&apos;s run and process, with its own Glove, prompt and store</td><td>As the parent&apos;s tool result</td><td>A bounded sub-task needs a different prompt or fewer tools, and the parent waits for the answer.</td></tr>
          <tr><td><a href="#calls"><code>defineCall</code></a></td><td>Inside the run; a plain function</td><td>Return value, validated by Zod</td><td>A deterministic step with a known output shape. No model involved.</td></tr>
          <tr><td><a href="#spawn"><code>glove_foundry_spawn</code></a></td><td>A new queued run, new or existing instance and conversation</td><td>Not returned (command id only)</td><td>The model decides to start separate durable work now.</td></tr>
          <tr><td><Link href="/foundry/docs/conversations#background"><code>glove_foundry_background</code></Link></td><td>A new queued run on the <em>same</em> instance and conversation</td><td>Optional <code>background.reconvene</code> inbox item</td><td>Follow-up work on the same thread.</td></tr>
          <tr><td><a href="#client-fan-out">Typed client from code</a></td><td>Any instance and conversation</td><td><code>handle.wait()</code></td><td>Deterministic fan-out / fan-in that you, not the model, control.</td></tr>
          <tr><td><a href="#shared-work">Workspace, inbox, tasks</a></td><td>Durable data</td><td>Whenever someone reads it</td><td>Handoffs that may outlive any single run.</td></tr>
          <tr><td><Link href="/foundry/docs/automation">Playbook subscriptions</Link></td><td>The runtime, on inbound events</td><td>—</td><td>An inbound event should provision or wake a workforce.</td></tr>
          <tr><td><Link href="/foundry/docs/voice"><code>voiceCall</code></Link></td><td>A live call in a run, over the assembled agent</td><td>Mesh replies are spoken at the next pause</td><td>A speaking agent must stay responsive while durable work runs elsewhere.</td></tr>
        </tbody>
      </table>

      <h2 id="mesh">The mesh: agents message each other</h2>
      <p>
        Foundry hosts <Link href="/docs/mesh">Glove Mesh</Link> for its agents. Turn it on
        in a definition and every instance of it can message the other agents in its
        workspace by instance id. Who is on the team is data: an agent added to the
        workspace is reachable at once, and a rename shows up the next time someone lists
        the team. There is no transport to run, and the agent you message does not have to
        be running: the message starts a run.
      </p>
      <CodeBlock filename="agents/bot/agent.ts" language="typescript" code={`export default defineAgent({
  description: "A bot: an AI teammate with its own job",
  // …
  mesh: {
    peers: (self, peer) => peer.context.team === self.context.team,  // optional: narrow by data
    waitMs: 60_000,                                                    // a blocking send waits this long
    mount: (ctx) => ctx.request.source?.kind !== "activation",         // optional: per run
  },
});`} />
      <CodeBlock filename="when a person makes their team" language="typescript" code={`await foundry.createAgent("bot", { id: "maya-main", workspaceId: "maya", name: "Chief", context: { primary: true } });
await foundry.createAgent("bot", { id: "maya-bot-2", workspaceId: "maya", name: "Bug Triage", description: "Files and sorts bug reports." });`} />
      <table>
        <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>glove_mesh_list_agents({"{ name? }"})</code></td><td>The agents this one can message: id, name and description, from their instances.</td></tr>
          <tr><td><code>glove_mesh_send_message({"{ to, content, in_reply_to?, blocking? }"})</code></td><td>A new message starts a thread. <code>in_reply_to</code> answers a message in one. <code>blocking</code> waits in the run for the reply.</td></tr>
          <tr><td><code>glove_mesh_broadcast({"{ content }"})</code></td><td>One thread per agent it can message; each reply arrives on its own.</td></tr>
          <tr><td><code>glove_mesh_acknowledge({"{ message_id, note? }"})</code></td><td>A read receipt for an agent that is waiting.</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th><code>mesh</code> option</th><th>Default / notes</th></tr></thead>
        <tbody>
          <tr><td><code>true</code></td><td>The tools on every run, every other agent in the workspace as a peer, a 90 s wait.</td></tr>
          <tr><td><code>peers(self, peer)</code></td><td>Every other agent in the workspace. Return <code>false</code> to hide a peer; it gets both instances. An agent can always answer whoever messaged it, so <code>() =&gt; false</code> makes an agent that only answers.</td></tr>
          <tr><td><code>waitMs</code></td><td>90 000. How long a blocking send waits in the run before the run suspends.</td></tr>
          <tr><td><code>mount(ctx)</code></td><td>Every run. Return <code>false</code> and the run has no mesh tools at all, for example scheduled research that must only read.</td></tr>
        </tbody>
      </table>
      <ul>
        <li>A thread is a conversation on the recipient. Its final reply goes back to the conversation that started the thread on its own, as a <code>&lt;mesh-message status=&quot;replied&quot;&gt;</code>; a failed or cancelled run sends <code>status=&quot;failed&quot;</code>.</li>
        <li>Messages go straight into a run that listens with <code>ctx.onMeshMessage</code>. Otherwise they wait until the conversation is free and start one run with <code>source.kind: &quot;mesh&quot;</code>.</li>
        <li>Workspaces are the boundary. Another tenant&apos;s agents are never listed and cannot be messaged, whatever the peers rule says.</li>
        <li>Messages still owed are kept on the thread and handed over after a restart. <code>runtime.listThreads()</code> lists threads; the trace has <code>mesh.thread.started</code>, <code>mesh.message.sent</code>, <code>mesh.delivered</code>, <code>mesh.thread.replied</code> and <code>mesh.refused</code>.</li>
        <li>To mesh Gloves inside a single run, use <Link href="/docs/mesh">glove-mesh</Link> directly, as braind-storm&apos;s lead does with its specialists.</li>
      </ul>
      <p>
        The interactor-and-workers pattern, with questions and voice, is on{" "}
        <Link href="/foundry/docs/layered-agents">Layered agents</Link>. Why agents are
        instances rather than definitions is on{" "}
        <Link href="/foundry/docs/agents-are-data">Agents are data</Link>.
      </p>

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
        servers and message-dependent tools are mounted. That lets a subagent inherit a
        read operation without inheriting the parent&apos;s write surface. Foundry has no
        built-in projection helper; <code>parent.tools</code> exposes the registered
        tools, so a five-line function does it:
      </p>
      <CodeBlock filename="agents/billing/agent.ts" language="typescript" code={`import { getToolJsonSchema, type GloveFoldArgs, type IGloveRunnable } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineSubagent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

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
  store: ({ conversationId }) => FileStore.open(conversationId),
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
          <tr><td><code>layers</code>, <code>subscribers</code></td><td>Mounted on the child when it is invoked (layers accept <code>configureLayer(layer, config)</code>) and disposed when its request ends. They get the same synthetic context as <code>configure</code>.</td></tr>
          <tr><td><code>configure(context)</code></td><td>Runs after the child is built and its layers and subscribers are mounted. Its context is synthetic: <code>conversationId</code> and <code>runId</code> are <code>subagent:&lt;name&gt;</code>, <code>workspaceId</code> is <code>&quot;subagent&quot;</code>, <code>emit</code> is a no-op.</td></tr>
        </tbody>
      </table>
      <p>
        The child uses the parent&apos;s display manager and, unless overridden, its
        model and <code>serverMode</code>; prompt, store and compaction are its own.
        Parent subscribers still record{" "}
        <code>subagent_invoked</code> and <code>subagent_completed</code>, so the handoff
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
      <CodeBlock filename="agents/triage/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { createFoundryClient } from "glove-foundry/client";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

const foundry = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL ?? "http://127.0.0.1:4141" });

interface Ticket { readonly id: string; readonly summary: string }

export default defineAgent({
  description: "Fans a batch of tickets out to the support agent, one conversation each",
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "Coordinate ticket batches.",
  store: ({ conversationId }) => FileStore.open(conversationId),
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

      <h2 id="voice">Voice calls</h2>
      <p>
        A live call is a run: <code>run: voiceCall(...)</code> from{" "}
        <code>glove-foundry/voice</code> hosts a realtime speech session over the assembled
        agent. Keep the call thin and turn on the <a href="#mesh">mesh</a>; replies and
        questions from other agents are spoken at the next pause. See{" "}
        <Link href="/foundry/docs/voice">Voice agents</Link>.
      </p>
      <p>
        <strong>Reference implementations.</strong>{" "}
        <code>examples/foundry-layered-assistant</code> is an assistant that takes chat or
        calls, keeps personal memory, and messages a coder and a researcher on the mesh.{" "}
        <code>examples/foundry-braind-storm</code> is a brand workforce: its briefing line is a{" "}
        <code>voiceCall</code> with Gemini Live, its lead convenes four specialists over an
        in-process mesh with one shared working environment, and its campaign orchestrator
        fans campaigns out through the typed client.
      </p>

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
