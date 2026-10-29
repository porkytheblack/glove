import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Tutorial: your first agent system",
  description:
    "Build a customer-support agent end to end: tools, an installed capability, conversations, schedules, approvals and an OpenAI SDK client.",
};

export default function FoundryTutorialPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / Tutorial</span>
      <h1>Tutorial: your first agent system</h1>
      <p className="blog-lede">
        In about half an hour you will build a customer-support agent that looks up orders,
        keeps separate conversations per customer, schedules its own follow-ups, waits for a
        human before refunding money, and answers any OpenAI SDK client. Every step ends with
        something you can see in the inspector or your terminal.
      </p>

      <p>
        You need Node.js 22 or newer (22.13+ recommended), pnpm (or npm, yarn, bun), and an{" "}
        <a href="https://openrouter.ai">OpenRouter</a> API key. Commands below use pnpm; with
        npm, write <code>npm run dev</code> instead of <code>pnpm dev</code>.
      </p>

      <h2 id="step-1-scaffold">1. Scaffold and run</h2>
      <CodeBlock filename="terminal" language="bash" code={`npx glove-foundry init support-desk --template minimal
cd support-desk
cp .env.example .env.local      # then set OPENROUTER_API_KEY=... in .env.local
pnpm dev`} />
      <p>
        The wizard asks only what you did not pass on the command line (project type, package
        manager, whether to install). For scripts, add <code>--yes --install</code>. When the
        runtime is up, the terminal prints:
      </p>
      <CodeBlock filename="terminal" language="text" code={`  Glove Foundry

  Local:    http://127.0.0.1:4141
  Agents:   1
  Runtime:  ready
  Types:    .foundry/routes.d.ts`} />
      <p>
        Open <code>http://127.0.0.1:4141</code>. Press <strong>Start a run</strong>, pick the{" "}
        <code>assistant</code> definition, type “What time is it?”, and submit. The inspector
        creates an instance and a conversation for you, then opens the run: a four-phase spine
        (Accepted → Assembled → Agent work → Completed) with the model and tool events below it.
        The <strong>Chat</strong> page is the built-in WebChat for the same instance.
      </p>
      <p>
        <code>pnpm dev</code> restarts the runtime whenever a file under <code>agents/</code>,{" "}
        <code>.env</code>, <code>.env.local</code>, <code>foundry.application.ts</code> or{" "}
        <code>foundry.config.ts</code> changes. Keep it running for the whole tutorial.
      </p>

      <h2 id="step-2-agent">2. Define the support agent</h2>
      <p>
        First, notice what the starter already did to make state survive. Two facts about
        Foundry make it necessary:
      </p>
      <ul>
        <li>
          <code>pnpm dev</code> restarts the runtime on every save, so runtime data kept only in
          memory (<code>MemoryFoundryDataAdapter</code>) would lose every instance, conversation
          and schedule each time.
        </li>
        <li>
          Every run executes in its own worker process. A <code>store</code> that returned{" "}
          <code>new MemoryStore(...)</code> would start each turn with an empty history, and the
          WebChat would have nothing to show.
        </li>
      </ul>
      <p>
        So <code>foundry.application.ts</code> uses the bundled file adapter, and{" "}
        <code>lib/file-store.ts</code> is a file-backed transcript store. Both write under{" "}
        <code>.data/</code>, which the starter already git-ignores. You don&apos;t need to change
        either; this is the essence of what they do:
      </p>
      <CodeBlock filename="foundry.application.ts (already in your project)" language="typescript" code={`import { FileFoundryDataAdapter, defineApplication } from "glove-foundry";
import { fileURLToPath } from "node:url";

// Instances, conversations, installations and schedules, in one JSON file.
export const data = new FileFoundryDataAdapter({
  file: fileURLToPath(new URL("./.data/foundry.json", import.meta.url)),
});

export default defineApplication({ name: "support-desk", data });`} />
      <CodeBlock filename="lib/file-store.ts (simplified)" language="typescript" code={`import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore, type Message } from "glove-core";

/**
 * A MemoryStore that saves the transcript to a JSON file after every append.
 * Each Foundry run executes in its own process, so a plain MemoryStore starts
 * empty on every message; this one reloads the conversation first.
 * The starter's version also saves turn and token counters, tasks and inbox items.
 */
export class FileStore extends MemoryStore {
  private constructor(id: string, private readonly file: string) {
    super(id);
  }

  static async open(id: string, directory = ".data/transcripts"): Promise<FileStore> {
    await mkdir(directory, { recursive: true });
    const store = new FileStore(id, join(directory, \`\${encodeURIComponent(id)}.json\`));
    const saved = await readFile(store.file, "utf8").then(JSON.parse, () => [] as Message[]);
    await MemoryStore.prototype.appendMessages.call(store, saved); // restore without re-saving
    return store;
  }

  override async appendMessages(messages: Message[]): Promise<void> {
    await super.appendMessages(messages);
    const temp = \`\${this.file}.tmp\`;
    await writeFile(temp, JSON.stringify(await this.getMessages()));
    await rename(temp, this.file);
  }
}`} />
      <p>
        Now the agent. Its file path is its id: <code>agents/support/agent.ts</code> is the
        definition <code>support</code>.
      </p>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";

export default defineAgent({
  description: "Answers Acme Outfitters customers about orders and refunds",
  // Called per run with the ids of the conversation being served.
  store: ({ conversationId }) => FileStore.open(conversationId),
  model: () =>
    createAdapter({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
      stream: true,
    }),
  // A function is resolved per run from the assembly context.
  systemPrompt: (_agent, ctx) =>
    [
      "You are the customer-support agent for Acme Outfitters. Be brief.",
      "Never invent order details. If you cannot look an order up, say so.",
      \`Customer tier: \${String(ctx.agentInstance.context.tier ?? "standard")}.\`,
      \`Installed for this instance: \${ctx.installations.map((item) => \`\${item.kind}:\${item.id}\`).join(", ") || "nothing"}.\`,
      \`Earlier messages in this conversation: \${ctx.history.length}.\`,
    ].join("\\n"),
});`} />
      <p>
        Save, and the runtime restarts with <code>Agents: 2</code>. Every field of{" "}
        <code>defineAgent</code> may be a value or a resolver{" "}
        <code>(agent, ctx) =&gt; value</code>; <code>ctx</code> carries the instance (
        <code>ctx.agentInstance.context</code>), its <code>installations</code>, the current{" "}
        <code>message</code>, the prior <code>history</code>, and the agent, conversation and
        workspace ids. Press <strong>Start a run</strong>, choose <code>support</code> and send
        “Hi, I’m Sam.” Then open <strong>Chat</strong>, select the new <code>support</code>{" "}
        instance and its conversation, and ask “What’s my name?” — the reply knows, because the
        transcript now outlives the worker process. (<code>model</code> and{" "}
        <code>systemPrompt</code> must be defined together; the{" "}
        <Link href="/foundry/docs/composition">defineAgent reference</Link> lists every field.)
      </p>

      <h2 id="step-3-always-on-tool">3. Add an always-on tool</h2>
      <p>
        Tools that every instance should always have go in the <code>tools</code> field. They are
        plain Glove tools — <code>name</code>, <code>description</code>,{" "}
        <code>inputSchema</code>, <code>do</code> — with no installation step.
      </p>
      <CodeBlock filename="agents/support/agent.ts (additions)" language="typescript" code={`import { z } from "zod";

const supportHours = {
  name: "support_hours",
  description: "Say whether the human support desk is open right now (Mon–Fri, 09:00–17:00 UTC).",
  inputSchema: z.object({}),
  async do() {
    const now = new Date();
    const weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
    const open = weekday && now.getUTCHours() >= 9 && now.getUTCHours() < 17;
    return { status: "success" as const, data: { open, checkedAt: now.toISOString() } };
  },
};

export default defineAgent({
  // ...everything from step 2
  tools: [supportHours],
});`} />
      <p>
        Ask “Is the support desk open right now?”. The run trace shows a{" "}
        <code>support_hours</code> tool call and its result before the reply. <code>tools</code> can also be a resolver, e.g. to
        return extra tools only for <code>ctx.agentInstance.context.tier === &quot;gold&quot;</code>.
      </p>

      <h2 id="step-4-installable-tool">4. Add an installable tool</h2>
      <p>
        Some capabilities differ per instance: the EU desk must query the EU order system, the
        US desk the US one. A <strong>shared tool</strong> is a convention file with a typed
        config; each instance that installs it supplies its own config.
      </p>
      <CodeBlock filename="agents/support/tools/lookup-order.tool.ts" language="typescript" code={`import { Effect } from "effect";
import { defineSharedTool } from "glove-foundry";
import { z } from "zod";

// your code: replace this with a call to your order system.
const ORDERS: Record<string, { region: "eu" | "us"; status: string; total: number }> = {
  "A-1001": { region: "eu", status: "shipped, arriving Thursday", total: 84 },
  "A-1002": { region: "eu", status: "processing", total: 129 },
  "B-2001": { region: "us", status: "delivered", total: 42 },
};

const lookupOrder = defineSharedTool({
  description: "Look up an order in one regional order system",
  // Each instance that installs this tool must supply a region.
  config: z.object({ region: z.enum(["eu", "us"]) }),
  create: ({ config }) =>
    Effect.succeed({
      name: "lookup_order",
      description: \`Look up an order in the \${config.region.toUpperCase()} order system by id, e.g. A-1001.\`,
      inputSchema: z.object({ orderId: z.string() }),
      async do({ orderId }: { orderId: string }) {
        const order = ORDERS[orderId];
        if (!order || order.region !== config.region) {
          return { status: "error" as const, data: null, message: \`No \${config.region} order "\${orderId}".\` };
        }
        return { status: "success" as const, data: { orderId, status: order.status, total: order.total } };
      },
    }),
});

export default lookupOrder;`} />
      <p>
        The filename is the id: <code>tools/lookup-order.tool.ts</code> is the tool{" "}
        <code>lookup-order</code>. Add it to the agent’s catalogue:
      </p>
      <CodeBlock filename="agents/support/agent.ts (additions)" language="typescript" code={`import { composeAgent, defineAgent } from "glove-foundry";
import lookupOrder from "./tools/lookup-order.tool.js";

export default defineAgent({
  // ...
  components: composeAgent(lookupOrder),
});`} />

      <h3 id="not-installed">It is in the catalogue, not on the agent</h3>
      <p>
        <code>composeAgent</code> only says which installable parts an instance <em>may</em>{" "}
        use. Create an instance and try it:
      </p>
      <CodeBlock filename="terminal" language="bash" code={`curl -s -X POST http://127.0.0.1:4141/api/agent-instances \\
  -H 'content-type: application/json' \\
  -d '{"definitionId":"support","id":"support-eu","workspaceId":"acme","context":{"tier":"gold"}}'`} />
      <p>
        In <strong>Chat</strong>, open <code>support-eu</code> and ask “Where is order
        A-1001?”. The agent says it cannot look orders up — its prompt said{" "}
        <code>Installed for this instance: nothing</code> and the run has no{" "}
        <code>lookup_order</code> tool. If a model calls it anyway, the tool result is{" "}
        <code>No tool called lookup_order exists. Available tools: …</code>. The instance page in{" "}
        <strong>Agents</strong> shows “Nothing installed”.
      </p>

      <h3 id="install">Install it</h3>
      <p>An installation is instance data: kind, id and config. Add it over HTTP…</p>
      <CodeBlock filename="terminal" language="bash" code={`curl -s -X PUT http://127.0.0.1:4141/api/installations \\
  -H 'content-type: application/json' \\
  -d '{"agentId":"support-eu","kind":"tool","id":"lookup-order","config":{"region":"eu"}}'`} />
      <p>
        …or with the typed client, <code>await foundry.install(&quot;support-eu&quot;, {"{"} kind:
        &quot;tool&quot;, id: &quot;lookup-order&quot;, config: {"{"} region: &quot;eu&quot; {"}"}{" "}
        {"}"})</code>, or by passing <code>installations</code> when you create the instance.
        Ask again: the trace now shows a <code>lookup_order</code> call returning{" "}
        <code>shipped, arriving Thursday</code>, and the instance page lists{" "}
        <code>tool · lookup-order</code>. No restart was needed — assembly reads installations on
        every run.
      </p>
      <p>To seed an instance from code instead, declare it next to the data adapter:</p>
      <CodeBlock filename="foundry.application.ts" language="typescript" code={`import {
  FileFoundryDataAdapter,
  defineAgentInstance,
  defineApplication,
  install,
} from "glove-foundry";
import support from "./agents/support/agent.js";
import lookupOrder from "./agents/support/tools/lookup-order.tool.js";

// Seeded once: inserted only if .data/foundry.json has no instance with this id.
const supportUs = defineAgentInstance(support, {
  id: "support-us",
  workspaceId: "acme",
  installations: [install(lookupOrder, { region: "us" })], // config is type-checked
});

export const data = new FileFoundryDataAdapter({
  file: ".data/foundry.json",
  agents: [supportUs],
});

export default defineApplication({ name: "support-desk", data });`} />
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        Installing an id that is not in the definition’s <code>composeAgent</code> catalogue is
        rejected with <code>Unknown Foundry tool capability &quot;…&quot;</code> (HTTP 400). Config
        is decoded against the zod schema when a run assembles; a bad config fails that run with{" "}
        <code>Invalid config for tool &quot;lookup-order&quot;</code>. Use <code>install()</code>{" "}
        only inside the Foundry project; client applications send the plain{" "}
        <code>{"{"} kind, id, config {"}"}</code> object. The inspector displays installations but
        does not edit them.
      </p></div>

      <h2 id="step-5-client">5. Call it from code</h2>
      <p>
        Your application talks to the runtime over HTTP with the typed client.{" "}
        <code>FoundryRoutes</code> is regenerated into <code>.foundry/routes.d.ts</code> on every
        start, so <code>agent(&quot;support&quot;)</code> is checked against the agents that exist.
      </p>
      <CodeBlock filename="src/support-client.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>({ baseUrl: "http://127.0.0.1:4141" });

// One instance = one persisted support identity with its own installations.
const existing = (await foundry.agentInstances("support")).find((item) => item.id === "support-eu");
const agent = existing ?? await foundry.agent("support").create({
  id: "support-eu",
  workspaceId: "acme",
  context: { tier: "gold" },
  installations: [{ kind: "tool", id: "lookup-order", config: { region: "eu" } }],
});

// Two independent conversations owned by the same instance.
const alice = await foundry.createConversation(agent.id, { title: "Alice" });
const bob = await foundry.createConversation(agent.id, { title: "Bob" });

async function ask(conversationId: string, text: string): Promise<unknown> {
  const run = await foundry.send(agent.id, conversationId, text);
  const done = await run.wait({ timeoutMs: 120_000 });
  if (done.status !== "completed") throw new Error(done.error ?? \`run \${done.status}\`);
  return done.output?.value;
}

console.log("alice:", await ask(alice.id, "Hi, I'm Alice. Where is order A-1001?"));
console.log("bob:  ", await ask(bob.id, "Hi! What's my name?"));
console.log("alice:", await ask(alice.id, "What's my name, and what was my order?"));`} />
      <CodeBlock filename="terminal" language="bash" code={`npx tsx src/support-client.ts
# alice: Order A-1001 has shipped and should arrive Thursday.
# bob:   I don't know your name yet — what should I call you?
# alice: You're Alice, and you asked about order A-1001 (shipped, arriving Thursday).`} />
      <p>
        Model wording varies; the shape does not. <code>send</code> returns as soon as the run is
        accepted; <code>run.wait()</code> polls until it is <code>completed</code>,{" "}
        <code>failed</code> or <code>cancelled</code> (default timeout 60 s) and{" "}
        <code>output.value</code> holds the final assistant text. Both conversations appear under
        the instance in <strong>Chat</strong>; <code>foundry.conversationTranscript(agent.id,
        alice.id)</code> returns the stored messages.
      </p>

      <h2 id="step-6-schedules">6. Let it schedule follow-up work</h2>
      <p>
        Your agent can wake itself up. There are two ways, and you get both.
      </p>
      <p>
        <strong>Schedules you declare.</strong> A <code>defineSchedule</code> value in the{" "}
        <code>schedules</code> field is desired recurring work for each instance:
      </p>
      <CodeBlock filename="agents/support/agent.ts (additions)" language="typescript" code={`import { composeAgent, defineAgent, defineSchedule } from "glove-foundry";

const followUpSweep = defineSchedule({
  name: "follow-up-sweep",
  description: "Weekday review of anything the agent promised to follow up on",
  timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  message: "Review this conversation for promised follow-ups. Re-check those orders and summarize what changed.",
});

export default defineAgent({
  // ...
  // An instance can opt out through its own context.
  schedules: (_agent, ctx) => (ctx.agentInstance.context.followUps === false ? [] : [followUpSweep]),
});`} />
      <p>
        Foundry reconciles schedules while it assembles a run, so an instance’s activation is
        created on that instance’s next run and delivers into the conversation that run belonged
        to. Send any message, then open <strong>Automations</strong>: <code>follow-up-sweep</code>{" "}
        is listed for <code>support-eu</code>. Timing kinds are <code>cron</code> (timezone
        defaults to UTC), <code>every</code> (<code>&quot;2h&quot;</code>), <code>after</code>{" "}
        (<code>&quot;20m&quot;</code>) and <code>at</code> (ISO date). Schedules are values you
        import — there is no <code>schedules/</code> file convention.
      </p>
      <p>
        <strong>Work the model schedules itself.</strong> Every run also gets Foundry’s built-in
        tools, including <code>glove_foundry_schedule</code> (one-off or recurring future
        work), <code>glove_foundry_schedules</code> (list, update, pause, resume, cancel its own)
        and <code>glove_foundry_sleep</code> (suspend this run and resume the same conversation
        later). Tell the model when to use them:
      </p>
      <CodeBlock filename="agents/support/agent.ts (systemPrompt)" language="typescript" code={`"If you promise to check something later, schedule it with glove_foundry_schedule.",`} />
      <p>
        Ask “Order A-1002 is still processing — can you check again in 2 minutes?”. The trace
        shows a call like <code>glove_foundry_schedule({"{"} message: &quot;Re-check order
        A-1002…&quot;, timing: {"{"} kind: &quot;after&quot;, duration: &quot;2m&quot; {"}"} {"}"})</code>.
        The activation appears in <strong>Automations</strong>; two minutes later a new run with
        source <code>activation</code> appears in <strong>Runs</strong> and its answer lands in the
        same conversation. From code, <code>foundry.activations(&quot;acme&quot;)</code> lists
        them. Activations live in the data adapter, so with <code>FileFoundryDataAdapter</code>{" "}
        they survive restarts; they fire only while the runtime is running.
      </p>

      <h2 id="step-7-approvals">7. Gate a risky tool behind approval</h2>
      <p>
        Refunds move money, so a human approves each one. Mark the tool with{" "}
        <code>requiresPermission</code>:
      </p>
      <CodeBlock filename="agents/support/agent.ts (additions)" language="typescript" code={`import type { GloveFoldArgs } from "glove-core";

const refundInput = z.object({
  orderId: z.string(),
  amount: z.number().positive().describe("Amount in USD"),
  reason: z.string(),
});
const issueRefund: GloveFoldArgs<z.infer<typeof refundInput>> = {
  name: "issue_refund",
  description: "Refund all or part of an order. A human approves every refund.",
  inputSchema: refundInput,
  requiresPermission: true, // or (input) => input.amount > 50
  async do({ orderId, amount }) {
    // your code: await payments.refund(orderId, amount)
    return { status: "success", data: { orderId, refunded: amount } };
  },
};

export default defineAgent({
  // ...
  tools: [supportHours, issueRefund],
});`} />
      <p>
        Ask “Order A-1001 arrived broken, please refund the $84.” The run stays{" "}
        <code>running</code> and the inspector’s Overview shows <em>Agents are waiting for a
        decision</em> with the exact tool input and <strong>Deny</strong> /{" "}
        <strong>Approve this input</strong> buttons (the run page shows the same card). From code:
      </p>
      <CodeBlock filename="src/approve-refund.ts" language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";
import type { FoundryRoutes } from "../.foundry/routes.js";

const foundry = createFoundryClient<FoundryRoutes>();
const agentId = "support-eu";
const conversation = await foundry.createConversation(agentId, { title: "Refund" });

const run = await foundry.send(agentId, conversation.id, "Order A-1001 arrived broken. Please refund the full $84.");

// The run pauses at issue_refund. Poll until the approval record appears.
let approval = (await foundry.approvals({ runId: run.id, status: "pending" }))[0];
while (!approval) {
  const current = await run.get();
  if (current.status !== "pending" && current.status !== "running") {
    throw new Error(\`run ended as \${current.status} without asking for approval\`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  approval = (await foundry.approvals({ runId: run.id, status: "pending" }))[0];
}

console.log(approval.toolName, approval.toolInput, "expires", approval.expiresAt);
await foundry.resolveApproval(approval.id, "approve"); // or "deny"

const done = await run.wait({ timeoutMs: 120_000 });
console.log(done.status, done.output?.value);`} />
      <p>
        Approval records do not expire unless <code>defineApplication</code> sets{" "}
        <code>approvals.timeoutMs</code>, and a durable data adapter keeps a pending one across a
        restart. Resolving it then starts a new run in the same conversation. Approvals
        only work through Foundry’s default display manager, so leave{" "}
        <code>displayManager</code> unset on the definition. A denial, an expired request and an
        unavailable
        approval channel all fail closed: the tool does not run and the model receives{" "}
        <code>Permission denied for tool &quot;issue_refund&quot;</code>. The same operations
        exist over HTTP as <code>GET /api/approvals?runId=…&amp;status=pending</code> and{" "}
        <code>POST /api/approvals/:id</code> with <code>{"{"}&quot;decision&quot;:&quot;approve&quot;{"}"}</code>{" "}
        (also under <code>/v1/approvals</code>). See{" "}
        <Link href="/foundry/docs/approvals">Approvals &amp; steering</Link>.
      </p>

      <h2 id="step-8-openai">8. Talk to it with the OpenAI SDK</h2>
      <p>
        Any OpenAI-compatible client can use your agent: Foundry serves{" "}
        <code>/v1/chat/completions</code>, and the “model” is an agent instance id.
      </p>
      <CodeBlock filename="terminal" language="bash" code={`pnpm add openai`} />
      <CodeBlock filename="src/openai-client.ts" language="typescript" code={`import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:4141/v1",
  // The SDK insists on a key. Foundry ignores it on loopback; with
  // requestAuthorization configured, your adapter receives it as a Bearer token.
  apiKey: "unused-on-loopback",
});

// model = an agent instance id. Send only the new user turn: Foundry keeps the history.
const { data: first, response } = await openai.chat.completions
  .create({
    model: "support-eu",
    messages: [{ role: "user", content: "Hi, where is order A-1001?" }],
  })
  .withResponse();
console.log(first.choices[0]?.message.content);

// Continue the same durable conversation.
const conversationId = response.headers.get("x-foundry-conversation-id")!;
const followUp = await openai.chat.completions.create(
  { model: "support-eu", messages: [{ role: "user", content: "Thanks. Is the help desk open right now?" }] },
  { headers: { "x-foundry-conversation-id": conversationId } },
);
console.log(followUp.choices[0]?.message.content);

// Streaming uses the same endpoint.
const stream = await openai.chat.completions.create(
  { model: "support-eu", stream: true, messages: [{ role: "user", content: "Summarize what we discussed." }] },
  { headers: { "x-foundry-conversation-id": conversationId } },
);
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
process.stdout.write("\\n");`} />
      <p>
        Run it with <code>npx tsx src/openai-client.ts</code>. The runs show up in the inspector
        like any other, with tool calls executed server-side. What Foundry does with the request:
      </p>
      <table>
        <thead><tr><th>Request part</th><th>Behavior</th></tr></thead>
        <tbody>
          <tr><td><code>model</code></td><td>An instance id, or a definition id that has exactly one instance. Otherwise 404: <code>Foundry model &quot;…&quot; does not resolve to one agent instance.</code> <code>GET /v1/models</code> lists instances.</td></tr>
          <tr><td>Conversation key</td><td>Header <code>x-foundry-conversation-id</code>, else body <code>conversation_id</code>, else <code>user</code>. Keys already shaped like <code>openai-…</code> are used as-is; others map to a stable <code>openai-&lt;hash&gt;</code> per instance. No key starts a new conversation.</td></tr>
          <tr><td><code>messages</code></td><td>Only the last user message becomes the new turn. Earlier entries are folded in as context text only when the conversation is new; afterwards Foundry uses its stored history. Roles must be <code>system</code>, <code>user</code>, <code>assistant</code> or <code>tool</code> (a <code>developer</code> message is a 400).</td></tr>
          <tr><td><code>stream</code></td><td><code>chat.completion.chunk</code> SSE events, then <code>data: [DONE]</code>.</td></tr>
          <tr><td>Response</td><td>Always carries <code>x-foundry-conversation-id</code>. No <code>usage</code> block. A failed run returns HTTP 502 (non-streaming) or a final <code>Foundry error: …</code> chunk.</td></tr>
          <tr><td>Other params</td><td><code>tools</code>, <code>temperature</code> and similar are ignored; the definition owns model and tools.</td></tr>
        </tbody>
      </table>
      <p>
        <code>/v1/responses</code> works the same way for the Responses API. Details in{" "}
        <Link href="/foundry/docs/openai-compatible">OpenAI-compatible API</Link>.
      </p>

      <h2 id="finished-agent">The finished agent</h2>
      <CodeBlock filename="agents/support/agent.ts" language="typescript" code={`import type { GloveFoldArgs } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { composeAgent, defineAgent, defineSchedule } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js";
import lookupOrder from "./tools/lookup-order.tool.js";

// Step 3 — always on: every instance gets this tool on every run.
const supportHours = {
  name: "support_hours",
  description: "Say whether the human support desk is open right now (Mon–Fri, 09:00–17:00 UTC).",
  inputSchema: z.object({}),
  async do() {
    const now = new Date();
    const weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
    const open = weekday && now.getUTCHours() >= 9 && now.getUTCHours() < 17;
    return { status: "success" as const, data: { open, checkedAt: now.toISOString() } };
  },
};

// Step 7 — a risky tool. Foundry turns every call into an approval request.
const refundInput = z.object({
  orderId: z.string(),
  amount: z.number().positive().describe("Amount in USD"),
  reason: z.string(),
});
const issueRefund: GloveFoldArgs<z.infer<typeof refundInput>> = {
  name: "issue_refund",
  description: "Refund all or part of an order. A human approves every refund.",
  inputSchema: refundInput,
  requiresPermission: true,
  async do({ orderId, amount }) {
    // your code: await payments.refund(orderId, amount)
    return { status: "success", data: { orderId, refunded: amount } };
  },
};

// Step 6 — desired recurring work, owned by each instance that runs.
const followUpSweep = defineSchedule({
  name: "follow-up-sweep",
  description: "Weekday review of anything the agent promised to follow up on",
  timing: { kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
  message: "Review this conversation for promised follow-ups. Re-check those orders and summarize what changed.",
});

export default defineAgent({
  description: "Answers Acme Outfitters customers about orders and refunds",
  components: composeAgent(lookupOrder), // step 4: installable, per instance
  store: ({ conversationId }) => FileStore.open(conversationId),
  model: () =>
    createAdapter({
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
      stream: true,
    }),
  systemPrompt: (_agent, ctx) =>
    [
      "You are the customer-support agent for Acme Outfitters. Be brief.",
      "Never invent order details. If you cannot look an order up, say so.",
      "If you promise to check something later, schedule it with glove_foundry_schedule.",
      \`Customer tier: \${String(ctx.agentInstance.context.tier ?? "standard")}.\`,
      \`Installed for this instance: \${ctx.installations.map((item) => \`\${item.kind}:\${item.id}\`).join(", ") || "nothing"}.\`,
      \`Earlier messages in this conversation: \${ctx.history.length}.\`,
    ].join("\\n"),
  tools: [supportHours, issueRefund],
  schedules: (_agent, ctx) => (ctx.agentInstance.context.followUps === false ? [] : [followUpSweep]),
});`} />
      <p>
        Run <code>pnpm typecheck</code> and <code>pnpm lint</code>; the lint step includes the{" "}
        <Link href="/foundry/docs/project-structure#eslint">Foundry ESLint rules</Link>.
      </p>

      <h2 id="next">Where to go next</h2>
      <ul>
        <li><Link href="/foundry/docs/project-structure">Project structure</Link> — every file convention and how ids are derived.</li>
        <li><Link href="/foundry/docs/capabilities">Tools, MCP &amp; memory</Link> — MCP servers, memory profiles, layers and typed calls.</li>
        <li><Link href="/foundry/docs/applications">Apps &amp; transmissions</Link> — turn the desk into a <code>helpdesk</code> app that receives and replies to <code>tickets</code>.</li>
        <li><Link href="/foundry/docs/automation">Playbooks, schedules &amp; sleep</Link> — event-driven work and every built-in agent tool.</li>
        <li><Link href="/foundry/docs/runtime">Client &amp; HTTP API</Link> — every endpoint, <code>/v1/runs</code>, steering and event streams.</li>
        <li><Link href="/foundry/docs/persistence">Persistence</Link> — production adapters for runtime data, transcripts, memory and files.</li>
        <li><Link href="/foundry/docs/deploy">Deploy &amp; security</Link> and the <Link href="/foundry/docs/faq">FAQ</Link>.</li>
      </ul>
    </article>
  );
}
