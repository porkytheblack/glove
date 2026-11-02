import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { durableResearchFiles as files } from "@/lib/foundry-durable-example";

export const metadata = {
  title: "Realtime front and durable researcher example",
  description: "A complete Foundry example with a realtime front, a long-running durable researcher, explicit inheritance, restricted apps, direct messages, task delegation and durable event policies.",
};
const source = "https://github.com/porkytheblack/glove/tree/main/examples/foundry-durable-research";
const supportFiles = ["package.json", "tsconfig.json", "foundry.application.ts", "foundry.config.ts", "agents/front/personal.memory.ts", "agents/front/library.app.ts", "agents/front/tools.ts", "lib/models.ts", "lib/corpus.ts", "lib/paths.ts", "lib/file-store.ts", "lib/room.ts", "lib/room.html", "scripts/verify.ts", "scripts/verify-live.ts", "scripts/live-controller.ts"] as const;

export default function DurableSubagentsPage() {
  return <article className="docs-content">
    <span className="foundry-doc-kicker">Durable subagents / Worked example</span>
    <h1>A realtime front, a durable researcher</h1>
    <p>Start with the <Link href="/foundry/docs/durable-subagents">durable subagents guide</Link> for the ownership model, instance lifecycle, inheritance, messaging and delivery contract. This walkthrough applies those primitives to one particular system: a responsive front and a background researcher.</p>
    <p className="blog-lede">Keep the conversation responsive while another agent does substantial work. A named durable worker keeps its identity and data across runs. Direct messages and delegated tasks reach an exact runtime context through the same persistent event-delivery layer.</p>
    <p>This complete <a href={source}>runnable example</a> uses <Link href="/docs/realtime">glove-realtime</Link> for the front and a text model for the researcher. The browser uses typed input and text output to keep transport code small; it is a provider-owned realtime session, not repeated text-model calls. Voice can use the same session with audio capture and playback. File listings below are read from the example source at build time.</p>
    <p>The example requires the durable-subagent APIs in this checkout; an older registry release may not include them. The fictional vendor corpus is small and finishes quickly. The researcher has a four-hour run allowance, not an artificial four-hour delay.</p>

    <h2 id="flow">What stays alive, and what persists</h2>
    <CodeBlock language="text" code={`Browser ↔ front / demo-live (RealtimeSession, up to 30 minutes)
             │
             ├─ delegate("research", task) → owned worker / task conversation
             │                              └─ question or result → demo-live
             │
             └─ message("research", update) → worker's stable event conversation
                                            └─ explicit message → demo-live

Foundry event journal: exact target + event ID + policy + receipt
No live front? A new text turn handles the event in demo-live.
Next live session: seed from that same persisted transcript.`} />
    <p>Each parent instance owns a separate <code>research</code> instance. Reusing a definition creates an owned worker; it does not adopt another tenant&apos;s agent. One parent can own several named workers with different tools, memory scopes, models and deadlines.</p>

    <h2 id="run">Run the complete example</h2>
    <p>Use Node 22.13 or newer for SQLite memory. From the repository root:</p>
    <CodeBlock language="bash" code={`pnpm install
pnpm -r --filter 'glove-foundry-durable-research^...' build
cd examples/foundry-durable-research
# Create .env containing your server-side GEMINI_API_KEY.
# Optional: REALTIME_MODEL, RESEARCH_TEXT_MODEL, RESEARCH_DATA_DIR.
pnpm typecheck
pnpm verify # offline: discovery, inheritance, journal, transcripts and transport
pnpm start`} />
    <p>For OpenAI, set <code>RESEARCH_PROVIDER=openai</code> and <code>OPENAI_API_KEY</code> instead. The default models are <code>gpt-realtime</code> and <code>gpt-4.1-mini</code>. The opt-in <code>pnpm verify:live</code> command uses OpenAI, loads the repository&apos;s ignored <code>.env.local</code> when present, and tests messaging and delegation across separate controller processes using isolated temporary data. All app data stays fictional; only model calls are remote. Set <code>RESEARCH_DOCUMENT_DELAY_MS</code> between 0 and 10000 to simulate a slow document service.</p>
    <p>Open the local room URL printed after the provider connects. The Foundry API is at <code>127.0.0.1:4143</code>; this local example permits one live room at <code>127.0.0.1:8787</code>. The session token is ephemeral and the API key stays on the server. Ending the live room leaves the controller and worker running; Ctrl-C stops the controller.</p>
    <p>Ask: “Compare Atlas, Birch and Cedar. I need EU hosting. Delegate the research and keep talking to me.” Then ask the front another question while the worker runs. The slot below can defer an idle worker for up to 30 seconds, so delegation does not require an immediate worker turn.</p>

    <h2 id="definition">Define the front and select inheritance</h2>
    <CodeBlock filename="agents/front/agent.ts" code={files["agents/front/agent.ts"]} />
    <table><thead><tr><th>Selection</th><th>Effective access</th></tr></thead><tbody>
      <tr><td><code>context: true</code></td><td>Copies parent instance context once, when provisioning. It does not copy transcripts or track subsequent parent-context edits.</td></tr>
      <tr><td><code>tools</code></td><td>Inherits the named always-on tool, resolved in the child&apos;s context. Permission requirements remain.</td></tr>
      <tr><td><code>memory: shared / reader</code></td><td>Reads the selected parent-scoped profile. It cannot mutate pinned context. Choose <code>scope: &quot;isolated&quot;</code> for a child namespace; curator access cannot exceed the parent&apos;s access.</td></tr>
      <tr><td><code>restrictApp(library, …)</code></td><td>Only the installed parent library&apos;s read tool is available. The write tool, account operations and transmissions are denied. Removing the parent installation revokes the inherited app.</td></tr>
    </tbody></table>
    <p>The app is local in this example, so no account is acquired and no account operation is granted. With an account-backed app, explicitly allow operation names used by <code>withAccountSession</code>; a modifier cannot grant credentials or outbound routes. These are capability boundaries for trusted application code, not a sandbox for hostile tool implementations.</p>
    <p>The startup script installs the library on the parent. <code>composeAgent</code> alone only makes an app available for installation. The cleanup hook deletes the worker&apos;s private transcripts; shared parent memory and workspace notes remain.</p>

    <h2 id="researcher">Reuse an ordinary researcher definition</h2>
    <CodeBlock filename="agents/researcher/agent.ts" code={files["agents/researcher/agent.ts"]} />
    <p>A durable slot can use an imported definition or an inline <code>defineAgent</code>. This researcher uses inherited search and document-reading tools when mounted under the front. Its standalone route does not automatically receive those inherited capabilities. <code>maxConcurrentRuns: 1</code> limits this definition&apos;s work; the runtime has four execution slots so a background worker does not consume all capacity available to fronts. This is capacity planning, not a preemption or latency guarantee.</p>

    <h2 id="realtime">Bridge native events into the live runtime</h2>
    <CodeBlock filename="agents/front/live.ts" code={files["agents/front/live.ts"]} />
    <p><code>RealtimeSession.start()</code> holds the agent&apos;s turn queue. Native events join the live session at a tool/user-turn boundary or a quiet pause; they do not wake the placeholder text model. Runtime-context providers, including the list of open delegated tasks, refresh through the same session. There is no mesh inbox, relay polling loop or separate delegation callback.</p>
    <p>Only an explicit direct request with <code>payload.mode = &quot;live&quot;</code> opens the room. When a result arrives after the session ends, the model resolver selects a normal text model and <code>ctx.defaultRun()</code> handles the event. That output is persisted in <code>demo-live</code>; reopening the realtime session seeds it from the stored history. The browser/provider socket itself is not durable.</p>
    <p>The front denies approval-gated tools during realtime sessions. To enable them in another application, supply a real permission decision flow. The transport handles typed input, incremental event delivery, disconnects and cleanup; the <Link href="/docs/realtime">realtime guide</Link> covers audio capture, output formats and playback notifications.</p>

    <h2 id="delegate">Task delegation and spontaneous messages</h2>
    <p>These are the generated model-tool calls, not functions imported into your application:</p>
    <CodeBlock language="typescript" code={`// Front: create tracked work on the owned worker.
glove_foundry_delegate({
  to: "research",
  task: "Compare the three vendor briefs for EU hosting and a $50/user budget. Cite IDs.",
});

// Worker: ask about its current task; the front answers or asks the person.
glove_foundry_ask({ question: "Does the budget include SSO add-ons?" });
glove_foundry_reply({ delegationId: "<returned task ID>", message: "Yes, include SSO." });
// The worker's final answer returns to the originating conversation automatically.

// Front: update the worker without creating another task.
glove_foundry_message({
  to: "research",
  message: "Reliability now matters most. Report important findings to parent conversation demo-live.",
  delivery: { id: "priority-v1", whenIdle: "wake" },
});

// Worker: explicitly address the live front conversation.
glove_foundry_message({
  to: "parent",
  message: "Cedar has the strongest support SLA, but exceeds the budget.",
  delivery: { conversationId: "demo-live", whenIdle: "wake" },
});`} />
    <p>A task gets its own conversation on the same persistent worker. Direct messages without a conversation ID use the recipient&apos;s stable default event conversation. They do not automatically enter an active task or the latest parent chat. To steer a particular task, use <code>glove_foundry_reply</code> with its delegation ID, or explicitly address its conversation.</p>
    <p>Messages sent by the tool carry a host-readable <code>metadata.replyTo</code> address in <code>ctx.events</code>. The example includes the desired parent conversation ID in the message content too, so the model can target it. The tool permits declared children and the actual parent; the runtime validates conversation ownership and workspace.</p>
    <p>Existing sibling <code>delegates</code> remain available. You do not repeat a durable name in <code>delegates</code>; the durable slot already makes it a delegation target. <Link href="/foundry/docs/layered-agents">Layered agents</Link> explains the sibling-only form.</p>

    <h2 id="direct">Message a worker directly from your application</h2>
    <p>While the controller is running, use another terminal:</p>
    <CodeBlock language="bash" code="node --import tsx scripts/message.ts" />
    <CodeBlock filename="scripts/message.ts" code={files["scripts/message.ts"]} />
    <p>The first send explicitly wakes the worker. The second uses the exact agent/conversation address returned by the first and defers a budget update. Keep the IDs unchanged when retrying the same events; use new IDs for new updates. Reusing an ID with different content or policy fails. A receipt means accepted durably, not that the model has finished responding.</p>

    <h2 id="policies">Configure delivery at three levels</h2>
    <p>The reused agent supplies its default <code>eventDelivery</code>. A durable slot can replace that default. Each send can override the effective recipient policy. The front and worker can therefore have different responsiveness without coupling their run lifetimes.</p>
    <table><thead><tr><th>Effective policy</th><th>Idle recipient</th></tr></thead><tbody>
      <tr><td><code>{'{ whenIdle: "wake" }'}</code></td><td>Starts an event turn. This is the default.</td></tr>
      <tr><td><code>{'{ whenIdle: "defer" }'}</code>, no effective timeout</td><td>Waits for another turn.</td></tr>
      <tr><td><code>{'{ whenIdle: "defer", deferTimeoutMs: 30_000 }'}</code></td><td>Joins the next turn or wakes after 30 seconds from acceptance, including across restarts.</td></tr>
      <tr><td><code>expiresAt</code> on a message/event</td><td>Discards an event that expires before it is consumed.</td></tr>
    </tbody></table>
    <CodeBlock language="typescript" code={`await worker.send("A temporary offer is available.", {
  id: "offer-v1",
  conversationId: workerConversationId, // must already belong to this worker
  whenIdle: "defer",
  deferTimeoutMs: 15_000,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});`} />
    <p>These policies govern idle targets. Busy targets receive events at native event boundaries; a live realtime session controls when it can respond. A waking event may carry deferred events into the same turn. <code>whenIdle</code> does not interrupt a tool call or infer user presence. Defaults also apply to task starts and updates; the front&apos;s wake policy makes task results promptly actionable.</p>

    <h2 id="persistence">Durability and data lifecycle</h2>
    <p>The shared journal persists accepted events, explicit targets, policies and consumed-event receipts. Direct messages, task starts, questions, replies and results use it. A stopped controller replays pending delivery and retains deduplication IDs for acknowledged or expired events. A successful receiving run acknowledges what it consumed; until a long live run closes, consumed events can still be pending in the journal.</p>
    <p>Recovery is <strong>at least once</strong>. A crash between an external effect and its receipt can repeat work, even if an event is already in the transcript. Use event IDs for idempotent effects. Recovery restarts a run; it does not checkpoint arbitrary tool code or promise exactly-once speech.</p>
    <table><thead><tr><th>Data</th><th>Storage in this example</th></tr></thead><tbody>
      <tr><td>Instances, conversations, tasks, events, receipts</td><td><code>.data/foundry.json</code> through <code>FileFoundryDataAdapter</code></td></tr>
      <tr><td>Native message history</td><td><code>.data/transcripts</code> through the supplied <code>FileStore</code></td></tr>
      <tr><td>Parent memory</td><td><code>.data/personal.sqlite</code>, namespaced by workspace and parent instance</td></tr>
      <tr><td>Workspace notes</td><td><code>.data/notes</code>; shared workspace data, not worker-owned</td></tr>
    </tbody></table>
    <CodeBlock language="typescript" code={`const worker = client.subagent("demo-front", "research");
const state = await worker.data(); // includes event journal records and conversations
await worker.archive();           // stop work; retain pending events and private data
await worker.resume();            // recover pending work; schedules/descendants stay paused
await worker.archive();
await worker.purge();             // explicit cleanup, owned records removed, tombstone retained`} />
    <p>Purge requires archival and an idempotent cleanup hook. It does not delete received copies in the parent&apos;s history, shared memory, app accounts, or execution/observability logs. A purged slot cannot silently recreate itself; use a new worker name for a replacement. Run one controller per data store. For deployment, add request authorization, an authenticated per-session transport and persistent storage.</p>

    <h2 id="files">Startup and all supporting files</h2>
    <p>The startup script installs the parent app, reuses stable instance/conversation IDs and opens only the front session. Worker provisioning stays lazy.</p>
    <CodeBlock filename="scripts/start.ts" code={files["scripts/start.ts"]} />
    <p>Copy these files alongside the definitions above, or use <a href={source}>the repository example</a>. The document catalogue is fixture data; replace it with your app&apos;s authenticated sources for real research.</p>
    {supportFiles.map((path) => <details key={path}><summary><code>{path}</code></summary><CodeBlock filename={path} language={path.endsWith(".json") ? "json" : path.endsWith(".html") ? "html" : "typescript"} code={files[path]} /></details>)}
    <p>Continue with <Link href="/foundry/docs/persistence">persistence</Link>, <Link href="/foundry/docs/applications">applications and permissions</Link>, or <Link href="/docs/runtime-context">native runtime context and spontaneous events</Link>.</p>
  </article>;
}
