import Link from "next/link";
import { BlogPostHeader } from "@/components/blog-post-header";
import { CodeBlock } from "@/components/code-block";
import { getPost, postMetadata } from "@/lib/blog";

const post = getPost("before-you-build-it")!;
export const metadata = postMetadata(post);

export default function BeforeYouBuildItPost() {
  return (
    <article className="docs-content">
      <BlogPostHeader post={post} />

      <p className="blog-lede">
        Fourteen things teams and coding agents keep building on top of Glove, and the
        primitive that already does each one. Every one of these works when you build it
        by hand. Every one is code you then own, and most lose something the primitive
        gives you for free.
      </p>

      <p>
        The pattern is always the same. Someone needs a feature, writes the obvious
        version, and ships it. Months later the agent forgets a reminder after a deploy,
        or two runs approve the same refund, or the prompt cache stops hitting. The
        primitive had already solved that edge. Here is the list we wish every team, and
        every coding agent, read first.
      </p>

      <h2 id="reminders">1. A job queue for &quot;remind me tomorrow&quot;</h2>
      <p>By hand: a reminders table, a worker that polls it, and a tool that inserts rows.</p>
      <CodeBlock language="typescript" code={`await db.insert(reminders).values({ userId, at: tomorrow, text });
setInterval(async () => {
  for (const due of await dueReminders()) await runAgent(due.userId, due.text);
}, 60_000);`} />
      <p>
        Already there: every Foundry agent has scheduling tools. The model calls them
        itself, so you write nothing.
      </p>
      <CodeBlock language="typescript" code={`glove_foundry_schedule({ message: "Remind Ada about the dentist.", timing: { kind: "after", duration: "1d" } })
glove_foundry_sleep({ kind: "for", duration: "20m", message: "Check whether the deploy finished." })
glove_foundry_schedules({ action: "list" })`} />
      <p>
        What you get: activations stored through the data adapter before they are armed,
        so they survive a restart. Sleep wakes the same instance and conversation with
        its history intact. The agent can list, pause and cancel its own reminders.
        Recurring work you know about in advance goes in code with{" "}
        <code>defineSchedule</code> and the agent&apos;s <code>schedules</code> field.
      </p>

      <h2 id="approvals">2. An approvals table with pause and resume</h2>
      <p>
        By hand: a <code>pending_actions</code> table, a tool that writes a row and returns
        &quot;waiting for approval&quot;, an endpoint that flips the row, and logic to
        resume the agent with the answer.
      </p>
      <p>Already there: one flag on the tool.</p>
      <CodeBlock language="typescript" code={`agent.fold({
  name: "refund_order",
  description: "Refund an order in full.",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  requiresPermission: ({ amount }) => amount > 50,
  async do({ orderId, amount }) { /* … */ },
});

// In Foundry, a trusted host resolves it:
const [pending] = await foundry.approvals({ runId: handle.id, status: "pending" });
await foundry.resolveApproval(pending.id, "approve");`} />
      <p>
        What you get: in an app, the display stack shows the prompt and the tool resumes
        with the answer. In Foundry, the run pauses on an approval record that carries the
        exact tool input, expires, and fails closed when the channel is gone or the run is
        cancelled. The inspector shows it with approve and deny buttons.
      </p>

      <h2 id="ask-and-wait">3. An &quot;ask the user and wait&quot; protocol</h2>
      <p>
        By hand: a <code>need_input</code> message over the socket, a map of pending
        promises keyed by request id, a resume endpoint, and cleanup for abandoned asks.
      </p>
      <p>Already there: the display stack.</p>
      <CodeBlock language="typescript" code={`async do({ slots }, display) {
  const choice = await display.pushAndWait({ renderer: "pick_slot", input: { slots } });
  return { status: "success", data: choice };
}`} />
      <p>
        What you get: the tool suspends until the person answers, then resumes in the same
        loop. <code>pushAndForget</code> shows a result without waiting. With{" "}
        <code>glove-react</code>&apos;s <code>defineTool</code> the renderer lives next to
        the tool, typed, with a separate view for history.
      </p>

      <h2 id="conversation-tables">4. A conversations-per-customer table</h2>
      <p>
        By hand: an <code>agents</code> table keyed by customer, a <code>threads</code>{" "}
        table, a lookup in every request handler, and a factory that rebuilds the agent
        with the right tools for that customer.
      </p>
      <p>Already there: Foundry instances and conversations.</p>
      <CodeBlock language="typescript" code={`const support = await foundry.agent("support").create({ context: { customerId: "c_42" } });
const thread = await foundry.createConversation(support.id, { title: "Order 1042" });
const run = await foundry.send(support.id, thread.id, "Where is order 1042?");
const done = await run.wait();`} />
      <p>
        What you get: one definition in code, any number of persisted instances, each with
        its own context, workspace, installed capabilities and threads. Every run assembles
        a fresh agent from the definition, the instance and the message, so per-customer
        behaviour is a resolver, not a switch statement.
      </p>

      <h2 id="prompt-rebuilds">5. Rebuilding the system prompt every turn</h2>
      <p>By hand: append the current state to the instructions before each request.</p>
      <CodeBlock language="typescript" code={`agent.setSystemPrompt(BASE_PROMPT + "\\nCurrent cart: " + JSON.stringify(await loadCart()));`} />
      <p>Already there: a context provider.</p>
      <CodeBlock language="typescript" code={`agent.addContextProvider(async () => \`Current cart: \${JSON.stringify(await loadCart())}\`);`} />
      <p>
        What you get: the snapshot is appended after the history before every model call,
        including the call after a tool changed the cart. The hand-built version only
        refreshes per request, and it changes the start of every request, which defeats
        prefix caching. The provider leaves the prompt and history stable and is never
        saved as a message. See{" "}
        <Link href="/blog/fresh-context-in-the-agent-loop">Fresh context belongs inside the agent loop</Link>.
      </p>

      <h2 id="summariser">6. A summariser for long conversations</h2>
      <p>
        By hand: count tokens, call the model to summarise older turns, splice the summary
        into history, and hope no tool call is separated from its result.
      </p>
      <p>Already there: compaction is part of the agent&apos;s config.</p>
      <CodeBlock language="typescript" code={`new Glove({
  // …
  compaction_config: {
    compaction_instructions: "Keep decisions, open questions and order numbers.",
    compaction_context_limit: 120_000,
  },
});`} />
      <p>
        What you get: compaction never separates a tool call from its result. The
        store keeps the full history for your UI while the model sees the summary forward.
        Subscribers get <code>compaction_start</code> and <code>compaction_end</code> with
        the exact usage of the summary call.
      </p>

      <h2 id="todo-tool">7. A todo or planning tool</h2>
      <p>By hand: an <code>update_plan</code> tool, a place to keep the plan, and a UI that reads it.</p>
      <p>
        Already there: a store that implements <code>getTasks</code> and{" "}
        <code>addTasks</code> (the built-in <code>MemoryStore</code> does) registers{" "}
        <code>glove_update_tasks</code> on the agent automatically.
      </p>
      <p>
        What you get: the agent keeps a pending, in-progress and completed plan with an
        imperative and an &quot;-ing&quot; form for each item, saved with the conversation
        and readable by your UI from the store.
      </p>

      <h2 id="fifty-tools">8. Fifty tool definitions</h2>
      <p>
        By hand: a <code>fold</code> per endpoint. The prompt grows with every one, and a
        task that needs ten lookups costs ten model round trips.
      </p>
      <p>Already there: give the model an interpreter over a catalogue of functions.</p>
      <CodeBlock language="typescript" code={`import { JsSession, defineFn, mountJs } from "glove-js";

const session = JsSession.create();
session.register(defineFn({
  name: "orders__list",
  description: "List a customer's orders, newest first.",
  input: z.object({ customerId: z.string() }),
  readOnlyHint: true,
  handler: (args) => orders.list(args.customerId as string),
}));
mountJs(agent, { session });`} />
      <p>
        What you get: one <code>execute_js</code> tool and discovery inside the
        interpreter. The model writes a program that loops, filters and branches, and only
        the final value returns to context. <code>glove-python</code>,{" "}
        <code>glove-lisp</code> and <code>glove-scratchpad</code> (the same catalogue as
        SQL tables) cover other shapes.
      </p>

      <h2 id="webhook-dispatcher">9. A webhook dispatcher</h2>
      <p>
        By hand: a route per provider, signature checks, a switch that decides which agent
        handles which event, a dedupe table for retries, and onboarding code that creates
        an agent before its first message.
      </p>
      <p>Already there: transmissions, playbooks and subscriptions.</p>
      <CodeBlock language="typescript" code={`const tickets = defineTransmission({
  events: [ticketCreated],
  inbound: { event: TicketSchema, classify: () => Effect.succeed(ticketCreated), predicates: [isUrgent] },
  outbound: { input: ReplySchema, output: SentSchema, adapter: { deliver: sendReply } },
  // …
});

composePlaybook({
  name: "urgent-ticket",
  transmission: tickets,
  match: { event: ticketCreated, routes: [ticketInbound], predicate: { definition: isUrgent } },
  directives: [{ action: resolve, instruction: "Investigate and respond." }],
});`} />
      <p>
        What you get: delivery is claimed by route and event id before anything runs, so a
        retried webhook does not start a second run. Events land in a conversation per
        external thread. A subscription can create zero, one or many instances when the
        first event arrives. Outbound delivery becomes a validated tool only on instances
        that install the app, and credentials stay in your adapter. See{" "}
        <Link href="/foundry/docs/applications">Apps &amp; transmissions</Link>.
      </p>

      <h2 id="browser-tools">10. Playwright wrapped in click and type tools</h2>
      <p>
        By hand: <code>open_page</code>, <code>click</code>, <code>type</code>,{" "}
        <code>screenshot</code>, each a model round trip, with screenshots pasted into
        history as base64.
      </p>
      <p>Already there:</p>
      <CodeBlock language="typescript" code={`import { mountBrowser } from "glove-execution";

const browser = mountBrowser(agent, { adapter });
try {
  await agent.processRequest("Fill in the contact form on example.com");
} finally {
  await browser.close();
}`} />
      <p>
        What you get: <code>execute_browser</code>, where the model scripts open, observe,
        act and verify in one call. Screenshots arrive as native images on the next model
        call and never pile up in history. Failed scripts are not replayed. The adapter is
        Station today, or any <code>BrowserAdapter</code> you implement.
      </p>

      <h2 id="docker-exec">11. A docker exec wrapper</h2>
      <p>
        By hand: create a container per task, shell out to <code>docker exec</code>,
        track which container belongs to whom, and remember to clean up.
      </p>
      <p>
        Already there: <code>mountSandbox(agent, {"{ adapter }"})</code> from{" "}
        <code>glove-execution</code>.
      </p>
      <p>
        What you get: <code>execute_sandbox</code> over create, exec, files, terminals and
        long-running services. The scope only sees sandboxes it was granted or created,
        caps how many it may open, counts creations whose outcome is unknown, and on close
        either keeps or destroys what it made. On Kuiper, a unit can run Station&apos;s
        container sandboxes through the Docker socket Kuiper serves it, or call
        Kuiper&apos;s own sandboxes through <code>@kuiper-sh/sdk</code>.
      </p>

      <h2 id="vector-memory">12. A vector store as memory</h2>
      <p>
        By hand: embed every message, add <code>remember</code> and <code>recall</code>{" "}
        tools, and discover later that nothing records where a memory came from or who
        may change it.
      </p>
      <p>Already there: <code>glove-memory</code>, with SQLite adapters included.</p>
      <CodeBlock language="typescript" code={`import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { useContext, useEpisodicReader, useMemoryReader } from "glove-memory/tools";

const memory = createSqliteMemoryAdapters({ file: "/data/memory.db", namespace: userId, schema });
useMemoryReader(agent, memory.entity);
useEpisodicReader(agent, memory.episodic);
useContext(agent, memory.context);`} />
      <p>
        What you get: an entity graph, an episodic timeline, a resource filesystem and
        pinned context, every write with provenance. Readers and curators are separate, so
        the conversational agent can look things up while a narrower agent decides what to
        file. Search is yours to plug in, including vectors.
      </p>

      <h2 id="re-asking">13. Asking people for things they already said</h2>
      <p>
        By hand: nothing, usually. The user mentions their order number in the first
        message, and the form asks for it again five minutes later.
      </p>
      <p>Already there:</p>
      <CodeBlock language="typescript" code={`import { useFacts } from "glove-facts";

useFacts(agent, facts, source); // mounts record_fact`} />
      <p>
        What you get: details recorded once, scoped, revisioned and reusable by forms and
        goals in the same scope, which can prepare their answers from them through a
        dedicated preparation agent. Recorded facts are unverified on purpose: they never
        complete a goal or fill a field on their own.
      </p>

      <h2 id="provider-glue">14. Glue for each model provider</h2>
      <p>
        By hand: one code path per SDK, a translation between tool-call formats, a
        streaming parser each, and a different way to read cache usage.
      </p>
      <CodeBlock language="typescript" code={`import { createAdapter } from "glove-core/models/providers";

const model = createAdapter({ provider: "gemini", model: "gemini-2.5-flash", cache: true });
agent.setModel(model); // between requests, history kept`} />
      <p>
        What you get: Anthropic, OpenAI, Gemini, OpenRouter, Bedrock, the Vercel AI
        Gateway, Kimi, GLM, MiniMax, MiMo, Ollama and LM Studio behind one interface, with
        streaming, reasoning, prompt caching and cache usage reported the same way.
      </p>

      <h2 id="a-few-more">A few more</h2>
      <ul>
        <li><strong>Polling for work that finishes later.</strong> The inbox: post with <code>glove_post_to_inbox</code>, resolve from anywhere, and the answer is injected on the next turn.</li>
        <li><strong>A router agent that calls other agents.</strong> <code>defineSubAgent</code> registers a child the model calls through <code>glove_invoke_subagent</code>, with its own tools and store.</li>
        <li><strong>An admin page to see what agents did.</strong> The Foundry inspector, at <code>localhost:4141</code> in development and in the Kuiper dashboard in production.</li>
        <li><strong>An adapter so chat UIs can reach your agent.</strong> Foundry serves <code>/v1/chat/completions</code> and <code>/v1/responses</code> over durable conversations.</li>
        <li><strong>Cancel and resend to change direction.</strong> <code>handle.steer(message)</code> interrupts cleanly and restarts in the same conversation.</li>
      </ul>

      <h2 id="how-to-check">How to check before you build</h2>
      <p>
        The rule of thumb: if the thing you are about to write is not specific to your
        product, it probably exists. Three ways to find out:
      </p>
      <ul>
        <li>
          The <Link href="/docs/primitives">primitives map</Link> lists every primitive by
          the part of a harness it serves, with the thing people hand-build in its place.
        </li>
        <li>
          Point your coding agent at <a href="/llms.txt"><code>/llms.txt</code></a> and{" "}
          <a href="/llms-full.txt"><code>/llms-full.txt</code></a>. Both lead with the same
          map.
        </li>
        <li>
          Install the <Link href="/docs/agent-skill">glove and glove-foundry skills</Link>{" "}
          with <code>npx skills add porkytheblack/glove</code>, so the agent checks for a
          primitive before it writes a scheduler.
        </li>
      </ul>
    </article>
  );
}
