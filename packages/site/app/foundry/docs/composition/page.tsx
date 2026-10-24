import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "defineAgent & assembly",
  description:
    "Every defineAgent field, the value-or-resolver rule, the assembly and execution contexts, the per-run assembly order, and configure/build/run hooks.",
};

type Field = { name: string; type: string; lazy: string; purpose: string };

const identityFields: Field[] = [
  { name: "description", type: "string (required)", lazy: "no", purpose: "Shown in the manifest and inspector; default mesh identity description." },
  { name: "tags", type: "readonly string[]", lazy: "no", purpose: "Labels copied into the manifest (GET /api/agents)." },
  { name: "components", type: "composeAgent(...)", lazy: "no", purpose: "Catalogue of shared tools, apps, MCP servers, memory profiles, layers and subscribers this definition may use. Nothing in it mounts by itself." },
  { name: "store", type: "({ definitionId, agentId, conversationId, workspaceId }) => StoreAdapter | Promise", lazy: "own signature", purpose: "Conversation store for history. Falls back to the application's conversationStore; with neither, history is empty." },
  { name: "mcpAdapter", type: "(ctx) => Effect<McpAdapter>", lazy: "per run", purpose: "Auth headers, tokens and stdio env for installed MCP servers. Required once any MCP is installed." },
  { name: "accountSessions", type: "{ identifier, withSession(request, use) }", lazy: "per run", purpose: "Gives installers withAccountSession for installations that selected an account." },
];

const gloveFields: Field[] = [
  { name: "model", type: "ModelAdapter", lazy: "yes", purpose: "Required unless run or spawn is defined." },
  { name: "systemPrompt", type: "string", lazy: "yes", purpose: "Required whenever model is defined." },
  { name: "displayManager", type: "DisplayManagerAdapter", lazy: "yes", purpose: "Default is Foundry's approval display manager, which turns permission prompts into approval records. Overriding it sends those prompts to your display manager instead." },
  { name: "serverMode", type: "boolean", lazy: "no", purpose: "Glove serverMode. Foundry's default is true." },
  { name: "maxRetries", type: "number", lazy: "no", purpose: "Tool execution retries (Glove default 3)." },
  { name: "maxConsecutiveErrors", type: "number", lazy: "no", purpose: "Passed through to Glove's maxConsecutiveErrors option." },
  { name: "compactionLimit", type: "number", lazy: "yes", purpose: "Context tokens before compaction (Glove default 100,000)." },
  { name: "compactionInstructions", type: "string", lazy: "yes", purpose: "Default: “Preserve goals, decisions, unresolved work, tool results, and pending inbox items.”" },
  { name: "maxTurns", type: "number", lazy: "yes", purpose: "Model turns allowed per request (Glove default 120)." },
  { name: "enableToolResultSummary", type: "boolean", lazy: "no", purpose: "Summarize older tool results in the prompt (Glove default false)." },
];

const surfaceFields: Field[] = [
  { name: "tools", type: "GloveFoldArgs[]", lazy: "yes", purpose: "Always-on tools for every instance." },
  { name: "hooks", type: "{ name, handler: HookHandler }[]", lazy: "yes", purpose: "Glove hooks triggered by /name directives." },
  { name: "skills", type: "DefineSkillArgs[]", lazy: "yes", purpose: "Glove skills." },
  { name: "subagents", type: "DefineSubAgentArgs[] (defineSubagent)", lazy: "yes", purpose: "Child agents that run inside this run's tool call; see Multi-agent." },
  { name: "delegates", type: "(string | { agent, description? })[]", lazy: "yes", purpose: "Sibling agents, by route, that this one hands work to and hears back from. Adds glove_foundry_delegate and glove_foundry_reply; see Layered agents." },
  { name: "answerWaitMs", type: "number", lazy: "no", purpose: "When working on a delegated task, how long glove_foundry_ask waits in the same run before it suspends. Default 90 000." },
  { name: "memory", type: "(defineMemory | configureMemory(...))[]", lazy: "yes", purpose: "Memory profiles to mount. Each must also be in components." },
  { name: "goals / facts / forms", type: "defineGoals / defineFacts / defineForms", lazy: "yes", purpose: "Guidance runners; handles appear on the execution context." },
  { name: "contextProviders", type: "RuntimeContextProvider[]", lazy: "yes", purpose: "Transient context re-read before each model iteration." },
  { name: "inboxes", type: "(agent, ctx) => InboxItem[]", lazy: "must be a function", purpose: "Loads Glove inbox items into the store. Requires an inbox-capable store." },
  { name: "subscribers", type: "(defineSubscriber | SubscriberAdapter)[]", lazy: "yes", purpose: "Event observers. Foundry subscribers must be in components; plain adapters need not be." },
  { name: "layers", type: "(defineLayer | configureLayer(...))[]", lazy: "yes", purpose: "Setup functions with native Glove access. Must be in components." },
  { name: "calls", type: "defineCall(...)[]", lazy: "yes", purpose: "Typed functions, exposed as tools unless exposeToAgent: false; callable with ctx.invoke." },
  { name: "schedules", type: "defineSchedule(...)[]", lazy: "yes", purpose: "Desired recurring work, reconciled into activations every run." },
  { name: "playbooks", type: "composePlaybook(...)[]", lazy: "yes", purpose: "Inbound-event policy persisted on the instance. Omit to keep the instance's own playbooks." },
  { name: "mesh", type: "{ adapter: MeshAdapter, identity? }", lazy: "yes", purpose: "Peer messaging via glove-mesh." },
  { name: "workingEnvironment", type: "defineWorkingEnvironment(...)", lazy: "yes", purpose: "Persistent VFS and named scripts." },
  { name: "repl", type: "defineRepl(...)", lazy: "yes", purpose: "One JavaScript, Python or Lisp REPL, optionally with programmatic tool calling." },
];

const hookFields: Field[] = [
  { name: "configure", type: "(agent: IGloveRunnable, ctx: FoundryExecutionContext) => Resolvable<void>", lazy: "hook", purpose: "Mount anything onto the assembled agent; register teardown with ctx.onCleanup." },
  { name: "build", type: "(agent, ctx: AgentAssemblyContext) => Resolvable<IGloveRunnable | undefined>", lazy: "hook", purpose: "Wrap or replace the runnable. Returning undefined keeps it." },
  { name: "spawn", type: "(agent, ctx: FoundryExecutionContext, message) => Resolvable<unknown>", lazy: "hook", purpose: "Build a custom execution for one message. A returned object with processRequest() or run(message, signal) is executed; any other value is the result." },
  { name: "run", type: "(agent, ctx: AgentHandlerContext) => Resolvable<unknown>", lazy: "hook", purpose: "Own the whole execution. Call ctx.defaultRun() for the normal Glove loop." },
];

const contextFields: { name: string; type: string; notes: string }[] = [
  { name: "definitionId", type: "string", notes: "The route, e.g. support" },
  { name: "agentId", type: "string", notes: "The instance id" },
  { name: "conversationId", type: "string", notes: "" },
  { name: "workspaceId", type: "string", notes: "" },
  { name: "runId", type: "string", notes: "" },
  { name: "name / mode", type: "string / \"agent\"", notes: "Internal execution name (foundry_support) and mode" },
  { name: "request", type: "FoundryRequest", notes: "{ agentId, conversationId, workspaceId, message, payload?, context?, source? }; input is the same object" },
  { name: "agentInstance", type: "AgentInstance", notes: "Persisted record: context, installations, playbooks…" },
  { name: "conversation", type: "Conversation", notes: "Persisted record: title, context…" },
  { name: "activations", type: "FoundryActivationRecord[]", notes: "This instance's schedules and sleeps" },
  { name: "delegations", type: "FoundryDelegation[]", notes: "Delegations this conversation started that are still open" },
  { name: "delegation", type: "FoundryDelegation | undefined", notes: "Set when this run works on a task another agent delegated" },
  { name: "data", type: "FoundryDataAdapter", notes: "The application's adapter, constructed inside the run process" },
  { name: "message", type: "Message", notes: "Native Glove user message for this turn, including media parts" },
  { name: "messageInput", type: "string | ContentPart[]", notes: "Exactly what processRequest will receive" },
  { name: "messageText", type: "string", notes: "Text projection of message" },
  { name: "history", type: "Message[]", notes: "Stored messages before this turn ([] without a store)" },
  { name: "messages", type: "Message[]", notes: "history plus message" },
  { name: "installations", type: "AgentInstallation[]", notes: "{ kind, id, config?, accountId? } records from the instance" },
  { name: "store", type: "StoreAdapter | null", notes: "The resolved store" },
  { name: "subscriber", type: "SubscriberAdapter", notes: "Foundry's event forwarder" },
  { name: "controls", type: "{ signal, emit, commands }", notes: "Abort signal and custom-event emitter" },
];

function FieldTable({ rows }: { rows: Field[] }) {
  return (
    <table>
      <thead><tr><th>Field</th><th>Type (resolved value)</th><th>Lazy</th><th>Purpose</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td><code>{row.name}</code></td>
            <td><code>{row.type}</code></td>
            <td>{row.lazy}</td>
            <td>{row.purpose}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CompositionPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Build agents / defineAgent &amp; assembly</span>
      <h1>defineAgent and per-run assembly</h1>
      <p className="blog-lede">
        <code>defineAgent</code> describes how to build a Glove agent for one run. Almost
        every field can be a function of the instance, the conversation and the new
        message, so one definition can serve many customers with different prompts,
        models and tools — without branching inside the prompt.
      </p>

      <h2 id="minimal">A complete agent in one file</h2>
      <p>
        Save this as <code>agents/support/agent.ts</code> and the route <code>support</code>{" "}
        exists. Every instance of it gets the <code>lookup_order</code> tool.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

export default defineAgent({
  description: "Answers customer questions about orders",
  store: ({ conversationId }) => FileStore.open(conversationId),
  model: () =>
    createAdapter({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
      stream: true,
    }),
  systemPrompt: "You are a concise, friendly customer-support agent.",
  tools: [
    {
      name: "lookup_order",
      description: "Look up an order by its id",
      inputSchema: z.object({ orderId: z.string() }),
      async do({ orderId }) {
        // your code: query the order system
        return { status: "success" as const, data: { orderId, status: "shipped" } };
      },
    },
  ],
});`} />
      <p><code>defineAgent</code> validates the definition when the module loads:</p>
      <ul>
        <li>It must define <code>model</code>, <code>run</code> or <code>spawn</code>.</li>
        <li>Defining <code>model</code> requires <code>systemPrompt</code>.</li>
        <li><code>inboxes</code> must be a function.</li>
        <li><code>input</code> and <code>output</code> keys are rejected: requests and results use Foundry&apos;s fixed contracts. Use <code>request.payload</code> or <code>defineCall</code> for typed data.</li>
      </ul>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        Each run executes in its own agent job subprocess. A <code>MemoryStore</code>,
        an in-memory memory adapter or a module-level variable therefore does not carry
        over to the next run. Return a durable <code>StoreAdapter</code> from{" "}
        <code>store</code> when history must survive between turns; see{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link>.
      </p></div>

      <h2 id="value-or-resolver">The value-or-resolver rule</h2>
      <p>Lazy fields have the type <code>FoundryResolver&lt;T&gt;</code>:</p>
      <CodeBlock filename="glove-foundry (types)" language="typescript" code={`type Resolvable<T> = T | Promise<T> | Effect.Effect<T, unknown, never>;

type FoundryResolver<T, TInput> =
  | T
  | ((agent: FoundryAgentDefinition, ctx: AgentAssemblyContext<TInput>) => Resolvable<T>);`} />
      <ul>
        <li>A literal is used as is for every run. Any function is treated as a resolver and called once per run.</li>
        <li>A resolver may return the value, a <code>Promise</code>, or an <code>Effect</code> with no requirements (Foundry runs it with <code>Effect.runPromise</code>). A literal cannot be a Promise.</li>
        <li>The first argument is the frozen definition itself (<code>agent.id</code>, <code>agent.description</code>), not a Glove instance.</li>
        <li>Resolvers in the same assembly step run concurrently and see the same read-only context; do not rely on order between them. A thrown error fails the run.</li>
        <li><code>store</code>, <code>inboxes</code>, <code>mcpAdapter</code>, <code>configure</code>, <code>build</code>, <code>spawn</code> and <code>run</code> have their own signatures, listed below.</li>
      </ul>

      <h2 id="fields">Every field</h2>
      <h3 id="fields-identity">Identity, catalogue and adapters</h3>
      <FieldTable rows={identityFields} />
      <h3 id="fields-glove">Glove configuration</h3>
      <FieldTable rows={gloveFields} />
      <h3 id="fields-surfaces">Mounted surfaces</h3>
      <FieldTable rows={surfaceFields} />
      <p>
        Installable shared tools, apps and MCP servers are not fields: they live in{" "}
        <code>components</code> and mount only when the instance installs them. See{" "}
        <Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link>.
        Guidance fields are covered in <Link href="/foundry/docs/guidance">Goals, facts &amp; forms</Link>,{" "}
        <code>schedules</code> and <code>playbooks</code> in{" "}
        <Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link>, and{" "}
        <code>workingEnvironment</code>/<code>repl</code> in{" "}
        <Link href="/foundry/docs/working-environments">Working environments</Link>.
      </p>
      <h3 id="fields-hooks">Lifecycle hooks</h3>
      <FieldTable rows={hookFields} />
      <p>
        <code>id</code> and <code>handler</code> still type-check but are deprecated: the file
        path owns identity, and <code>run</code> replaces <code>handler</code>. An{" "}
        <code>agent.ts</code> may also use named exports (<code>export const description</code>,{" "}
        <code>export const run</code>, …) instead of a default <code>defineAgent</code>.
      </p>

      <h2 id="context">The assembly context</h2>
      <p>
        Every resolver and <code>build</code> receive an <code>AgentAssemblyContext</code>:
      </p>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
        <tbody>
          {contextFields.map((row) => (
            <tr key={row.name}>
              <td><code>{row.name}</code></td>
              <td><code>{row.type}</code></td>
              <td>{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 id="execution-context">The execution context</h3>
      <p>
        <code>configure</code>, <code>spawn</code>, <code>run</code> and call handlers receive a{" "}
        <code>FoundryExecutionContext</code> instead. It shares the identity and message
        fields (<code>definitionId</code> through <code>messages</code>, <code>request</code>,{" "}
        <code>installations</code>) and adds:
      </p>
      <table>
        <thead><tr><th>Field</th><th>What it is</th></tr></thead>
        <tbody>
          <tr><td><code>glove</code></td><td>The assembled runnable (after <code>build</code>, in <code>run</code>/<code>spawn</code>)</td></tr>
          <tr><td><code>signal</code>, <code>emit</code></td><td>Run abort signal and custom-event emitter</td></tr>
          <tr><td><code>onCleanup(fn)</code></td><td>Register run-scoped teardown; runs in reverse order even if assembly fails</td></tr>
          <tr><td><code>invoke(name, input)</code></td><td>Call one of this run&apos;s <code>calls</code>; input and output are validated</td></tr>
          <tr><td><code>onDelegationUpdate(handler)</code></td><td>Take delegation results and questions inside this run while it stays live, instead of Foundry starting a new run for each. Returns <code>stop()</code>. <Link href="/foundry/docs/voice"><code>voiceCall</code></Link> uses it.</td></tr>
          <tr><td><code>workingEnvironment</code>, <code>vfs</code>, <code>repl</code></td><td>Present when those fields are configured</td></tr>
          <tr><td><code>goals</code>, <code>facts</code>, <code>forms</code></td><td>Runner handles when guidance is configured</td></tr>
          <tr><td><code>defaultRun(message?)</code>, <code>spawn(message?)</code></td><td><code>run</code> only: the standard loop, or your <code>spawn</code> path</td></tr>
        </tbody>
      </table>
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        The execution context does <strong>not</strong> carry <code>agentInstance</code>,{" "}
        <code>conversation</code>, <code>activations</code>, <code>data</code>,{" "}
        <code>store</code> or <code>controls</code>. Read instance data in a resolver (a{" "}
        <code>calls</code> resolver can close over it, as below), and use{" "}
        <code>ctx.emit</code> instead of <code>controls.emit</code>.
      </p></div>

      <h2 id="lifecycle">Assembly order for one run</h2>
      <p>
        Before a run starts, the host reloads the instance and conversation from the data
        adapter, checks they belong together and share a workspace, and enqueues the run.
        Inside the run process Foundry then:
      </p>
      <ol>
        <li>Loads <code>foundry.application.ts</code>, calls <code>store</code> (or the application&apos;s <code>conversationStore</code>), reads <code>history</code>, and builds the assembly context.</li>
        <li>Resolves <code>model</code>, <code>systemPrompt</code>, <code>displayManager</code>, <code>compactionLimit</code>, <code>compactionInstructions</code> and <code>maxTurns</code> concurrently, then constructs the Glove agent.</li>
        <li>Resolves <code>tools</code>, <code>hooks</code>, <code>skills</code>, <code>subagents</code>, <code>memory</code>, <code>inboxes</code>, <code>layers</code>, <code>subscribers</code>, <code>calls</code>, <code>playbooks</code>, <code>schedules</code>, <code>mesh</code>, <code>workingEnvironment</code> and <code>repl</code> concurrently.</li>
        <li>Reconciles <code>schedules</code> (every run) and <code>playbooks</code> (when the field is defined) onto the instance.</li>
        <li>Folds the built-in <code>glove_foundry_*</code> tools, then outbound-transmission tools of installed apps, then your <code>tools</code>, hooks, skills and subagents.</li>
        <li>Mounts the working environment and REPL. A REPL with <code>programmaticTools</code> waits until step 12.</li>
        <li>Resolves <code>facts</code>, <code>goals</code>, <code>forms</code> and <code>contextProviders</code> and mounts them.</li>
        <li>Registers <code>calls</code>, folding each as a tool unless <code>exposeToAgent: false</code>.</li>
        <li>Mounts <code>subscribers</code>, then runs each layer&apos;s <code>setup</code>.</li>
        <li>Mounts the instance&apos;s installations — shared tools and app contributions in installation order, then every installed MCP server through <code>mcpAdapter</code> — followed by memory profiles, inbox items and mesh.</li>
        <li>Calls <code>configure(agent, ctx)</code>.</li>
        <li>Mounts the programmatic REPL, so it sees every tool mounted so far.</li>
        <li>Calls <code>build(agent, ctx)</code>; its return value (or the same agent) is what runs.</li>
        <li>Executes <code>run</code> if defined, otherwise <code>spawn</code>, otherwise Glove&apos;s <code>processRequest</code> with the inbound message.</li>
        <li>Finishes: a run that called sleep ends <code>suspended</code>; <code>onCleanup</code> callbacks run in reverse, then layer and subscriber teardown.</li>
      </ol>
      <p>
        Each resolver emits <code>foundry.assembly.resolve.start</code>/<code>complete</code>{" "}
        events, so slow assembly is visible in the run trace in the{" "}
        <Link href="/foundry/docs/observability">inspector</Link>.
      </p>

      <h2 id="message-dependent">Message-dependent assembly</h2>
      <p>
        The same definition picks a vision model only when an image is attached, writes
        its prompt from instance data, and exposes a refund tool only to instances whose
        context allows it — and only on turns that mention refunds.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { type GloveFoldArgs } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { Effect } from "effect";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

const lookupOrder: GloveFoldArgs<{ orderId: string }> = {
  name: "lookup_order",
  description: "Look up an order by its id",
  inputSchema: z.object({ orderId: z.string() }),
  async do({ orderId }) {
    return { status: "success", data: { orderId, status: "shipped" } };
  },
};

const issueRefund: GloveFoldArgs<{ orderId: string; amountCents: number }> = {
  name: "issue_refund",
  description: "Refund part or all of an order",
  inputSchema: z.object({ orderId: z.string(), amountCents: z.number().int().positive() }),
  requiresPermission: true, // pauses the run for an approval
  async do({ orderId, amountCents }) {
    return { status: "success", data: { orderId, refundedCents: amountCents } };
  },
};

export default defineAgent({
  description: "Answers customer questions about orders",
  store: ({ conversationId }) => FileStore.open(conversationId),

  model: (_agent, { message }) => {
    const hasImage = message.content?.some((part) => part.type === "image") ?? false;
    return createAdapter({
      provider: "openrouter",
      model: hasImage ? "openai/gpt-4.1" : "openai/gpt-4.1-mini",
      stream: true,
    });
  },

  systemPrompt: (_agent, { agentInstance, conversation, history }) =>
    [
      \`You are the support agent for \${String(agentInstance.context.brand ?? "our store")}.\`,
      \`Conversation "\${conversation.title ?? conversation.id}" has \${history.length} earlier messages.\`,
    ].join("\\n"),

  tools: (_agent, { agentInstance, messageText, controls }) => {
    const tools: GloveFoldArgs<any>[] = [lookupOrder];
    if (agentInstance.context.canRefund === true && /refund/i.test(messageText)) {
      tools.push(issueRefund);
    }
    // Custom events land in the run trace as agent.support.tools.selected
    controls.emit({ type: "support.tools.selected", data: { names: tools.map((t) => t.name) } });
    return tools;
  },

  // Resolvers may return a Promise or an Effect.
  compactionLimit: (_agent, { history }) =>
    Effect.succeed(history.length > 200 ? 60_000 : 100_000),
  maxTurns: 25,
});`} />
      <p>
        <code>agentInstance.context</code> is whatever you stored when creating the instance (
        <code>{"{ brand: \"Acme\", canRefund: true }"}</code>); change it with{" "}
        <code>configureAgent</code> and the next run assembles differently. See{" "}
        <Link href="/foundry/docs/definitions-and-instances">Definitions &amp; instances</Link>.
        Data passed to <code>emit</code> is retained in observability as is, so never emit secrets.
      </p>

      <h2 id="configure-and-run">configure, calls and a custom run</h2>
      <p>
        <code>configure</code> mounts anything a field cannot express and registers its
        teardown. <code>run</code> takes over execution: here a typed payload takes a
        deterministic fast path with no model call, and everything else goes through the
        normal loop with an enriched user turn.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent, defineCall } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // durable transcript — see Persistence

// your code: a client that holds a connection open for one run
function connectCrm(workspaceId: string) {
  return {
    async findCustomer(email: string) { return { email, plan: "pro", workspaceId }; },
    async close() {},
  };
}

const statusRequest = z.object({ kind: z.literal("order-status"), orderId: z.string() });

export default defineAgent({
  description: "Support agent with a deterministic fast path",
  store: ({ conversationId }) => FileStore.open(conversationId),
  model: () => createAdapter({ provider: "openrouter", model: "openai/gpt-4.1-mini", stream: true }),
  systemPrompt: "You are a concise customer-support agent.",

  calls: (_agent, { agentInstance }) => [
    defineCall({
      name: "order_status",
      description: "Return the status of one order",
      input: z.object({ orderId: z.string() }),
      output: z.object({ orderId: z.string(), status: z.string(), region: z.string() }),
      // Closes over assembly-time instance data.
      handler: ({ orderId }) => ({
        orderId,
        status: "shipped",
        region: String(agentInstance.context.region ?? "us"),
      }),
    }),
  ],

  configure: async (agent, ctx) => {
    const crm = connectCrm(ctx.workspaceId);
    ctx.onCleanup(() => crm.close()); // register right after acquiring
    agent.fold({
      name: "find_customer",
      description: "Find a customer in the CRM by email",
      inputSchema: z.object({ email: z.string() }),
      async do({ email }) {
        return { status: "success", data: await crm.findCustomer(email) };
      },
    });
    agent.addContextProvider(() => \`Current time: \${new Date().toISOString()}\`);
  },

  run: async (_agent, ctx) => {
    const status = statusRequest.safeParse(ctx.request.payload);
    if (status.success) {
      ctx.emit({ type: "support.fast-path", data: { orderId: status.data.orderId } });
      return ctx.invoke("order_status", { orderId: status.data.orderId });
    }
    return ctx.defaultRun([
      { type: "text", text: \`\${ctx.messageText}\\n\\n(arrived via \${ctx.request.source?.kind ?? "direct"})\` },
    ]);
  },
});`} />
      <ul>
        <li><code>defaultRun(message?)</code> runs Glove&apos;s <code>processRequest</code>; without an argument it uses the inbound message. Its return value is the final assistant text.</li>
        <li>Whatever <code>run</code> returns becomes the run&apos;s <code>output</code> (JSON-serialized). A fast path that skips <code>defaultRun</code> writes nothing to the conversation store.</li>
        <li>Inside <code>run</code>, <code>ctx.spawn(message?)</code> calls your <code>spawn</code> hook when one is defined and falls back to <code>defaultRun</code>.</li>
        <li><code>onCleanup</code> callbacks run after the run finishes, fails or is cancelled. A failing callback does not stop the others; the errors are reported together.</li>
      </ul>

      <h2 id="build">build</h2>
      <p>
        <code>build(agent, ctx)</code> runs after everything is mounted and receives the
        assembly context. Return a wrapped or different <code>IGloveRunnable</code> to change
        what executes, or return nothing to keep the assembled agent. Prefer{" "}
        <code>configure</code> for mounting; reach for <code>build</code> only when you need to
        replace the runnable itself.
      </p>

      <h2 id="layout">Splitting the definition across files</h2>
      <p>
        Larger agents keep <code>agent.ts</code> small by importing colocated pieces —{" "}
        <code>tools/*.tool.ts</code>, <code>apps/*.app.ts</code>, <code>mcp/*.mcp.ts</code>,{" "}
        <code>memory/*.memory.ts</code>, <code>layers/*.layer.ts</code>,{" "}
        <code>subscribers/*.subscriber.ts</code> — and passing them to{" "}
        <code>composeAgent(...)</code> in <code>components</code>. File names become ids;
        see <Link href="/foundry/docs/project-structure">Project structure</Link> for the
        conventions and <Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link>{" "}
        for how each piece is mounted.
      </p>
    </article>
  );
}
