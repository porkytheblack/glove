import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = {
  title: "Durable subagents",
  description: "Compose persistent workers owned by each agent instance. Understand provisioning, identity, inheritance, memory and app permissions, addressed events, task delegation, delivery policies and data lifecycle.",
};

export default function DurableSubagentsPage() {
  return <article className="docs-content">
    <span className="foundry-doc-kicker">Design your system / Durable subagents</span>
    <h1>Durable subagents</h1>
    <p className="blog-lede">A durable subagent is an agent instance owned by another agent instance. You declare a named worker in <code>defineAgent</code>; Foundry creates that worker on first use and keeps its identity, conversations and owned data available for future work.</p>
    <p>Use durable subagents when one agent needs several intelligent workers with separate responsibilities. Each worker can have its own model, instructions, tools, memory access and run limits. A worker can handle many tasks over time, receive events independently, and own further workers. The parent can keep serving requests while that work proceeds.</p>
    <p>This composition works for chat agents, background services, scheduled work and applications with no conversational front at all. What connects the agents is an ownership relationship and durable, addressed event delivery. A live conversation is one possible place to receive the results.</p>

    <h2 id="ownership">What exists in code, and what exists in storage</h2>
    <p>The declaration describes a relationship between agent definitions. The running application creates a separate instance of that relationship for each parent. These identities matter when deciding which state is shared and where a message will arrive:</p>
    <table><thead><tr><th>Concept</th><th>Meaning</th></tr></thead><tbody>
      <tr><td>Worker definition</td><td>A normal <code>defineAgent</code> value: the model, instructions and capabilities from which workers are assembled. Several parents or slots can reuse it.</td></tr>
      <tr><td>Named slot</td><td>A key in <code>durableSubagents</code>, such as <code>analysis</code>. It selects the definition, inheritance and delivery defaults for that relationship.</td></tr>
      <tr><td>Owned worker instance</td><td>One persisted agent for a particular parent instance and slot name. It has its own instance ID in the parent&apos;s workspace.</td></tr>
      <tr><td>Conversation</td><td>A thread owned by the worker. A worker can have a default event conversation and separate conversations for individual tasks.</td></tr>
      <tr><td>Run</td><td>An execution that assembles the worker and processes work in one conversation. The same worker instance can be used by many runs.</td></tr>
    </tbody></table>
    <p>If two customer agents use the same parent definition, each gets its own <code>analysis</code> worker. If one parent declares two slots using the same worker definition, it gets two distinct workers. Reusing a definition does not attach an unrelated existing agent instance to the parent.</p>
    <p>The durable part is the identity and persisted state. Foundry assembles an agent for each run; it does not keep a JavaScript process alive simply because the worker exists. An idle worker can remain available for months without a continuous model session.</p>

    <h2 id="definition">Declare the workers an agent owns</h2>
    <p>Keep the worker as an ordinary agent definition, then import it into the parent. Model and storage adapters remain normal Foundry configuration; there is no special worker harness to construct.</p>
    <CodeBlock filename="agents/worker/agent.ts" code={`import { defineAgent } from "glove-foundry";
import { workerModel } from "../../lib/models.js";

export default defineAgent({
  description: "Analyze assigned work and report useful findings",
  model: workerModel,
  systemPrompt: "Complete assigned work. Ask for missing information when needed.",
});`} />
    <CodeBlock filename="agents/coordinator/agent.ts" code={`import { defineAgent } from "glove-foundry";
import worker from "../worker/agent.js";
import { primaryModel } from "../../lib/models.js";

export default defineAgent({
  description: "Coordinate requests and ongoing work",
  model: primaryModel,
  systemPrompt: "Help with incoming requests and coordinate your workers.",
  durableSubagents: {
    analysis: {
      agent: worker,
      description: "Detailed analysis that can continue independently",
      eventDelivery: { whenIdle: "wake" },
    },
  },
});`} />
    <p>An inline <code>defineAgent</code> also works as the slot&apos;s <code>agent</code>. The reused definition keeps its own explicit capabilities; the slot can add selected inheritance and replace its event-delivery defaults. The source definition is not mutated, so using it elsewhere does not grant the parent&apos;s capabilities there.</p>
    <p>Slots are declared statically. Names are lowercase slugs; <code>parent</code> is reserved. Foundry derives a definition route such as <code>coordinator/workers/analysis</code>. Workers can declare their own <code>durableSubagents</code>, but cyclic definition graphs and route collisions fail discovery. See <Link href="/foundry/docs/composition">agent assembly</Link> for the ordinary definition fields.</p>

    <h2 id="provisioning">When a worker is created and reused</h2>
    <p>Declaring a slot makes a worker available. It does not create every possible instance at startup. Foundry provisions the owned instance atomically when a message or delegated task first needs it. Your application can also ensure the instance explicitly:</p>
    <CodeBlock language="typescript" code={`import { createFoundryClient } from "glove-foundry/client";

const client = createFoundryClient({ baseUrl: process.env.FOUNDRY_URL! });
const parent = await client.agent("coordinator").create({
  workspaceId: "workspace-a",
});

const worker = client.subagent(parent.id, "analysis"); // a client handle; no request yet
const instance = await worker.ensure();              // create once, or return the existing instance
await worker.send("Review the current plan.");       // also ensures the worker if needed`} />
    <p>The ownership key is the parent instance ID plus the slot name. Repeated sends, new tasks and controller restarts reuse that worker when the application data adapter is persistent. Ensuring it does not start a model run. Listing workers with <code>client.subagents(parent.id)</code> and inspecting <code>worker.data()</code> do not provision or reactivate workers.</p>
    <p>A new parent instance gets new workers even if it uses the same definition. Changing a slot name identifies a different worker; it is not a rename of the stored instance. Keep names stable when you intend to retain the same state.</p>

    <h2 id="inheritance">Choose what the worker inherits</h2>
    <p>Parenthood does not automatically grant access to the parent&apos;s context, tools, memory or installed apps. The worker starts with the capabilities in its own definition. The slot&apos;s <code>inherit</code> field adds the specific parent surfaces it needs:</p>
    <CodeBlock language="typescript" code={`// Within durableSubagents. documents is a parent app definition.
analysis: {
  agent: worker,
  inherit: {
    context: true,
    tools: ["lookup_status"],
    memory: { scope: "shared", access: "reader", profiles: ["case-notes"] },
    apps: [restrictApp(documents, {
      tools: ["search", "read_document"],
      operations: ["documents.read"],
    })],
  },
}`} />
    <p>Import <code>restrictApp</code> from <code>glove-foundry</code>. The selected app and memory profiles must be in the parent&apos;s capability catalogue, and the parent must have selected or installed them as appropriate. <Link href="/foundry/docs/applications">Applications</Link> explains availability versus installation.</p>
    <table><thead><tr><th>Selection</th><th>What the worker receives</th></tr></thead><tbody>
      <tr><td><code>context: true</code></td><td>A copy of parent instance context when the worker is first provisioned. Later parent edits do not overwrite worker context.</td></tr>
      <tr><td><code>tools</code></td><td>Always-on parent tools selected by exact name. The parent tool resolver runs in the child&apos;s context, and approval requirements remain in force.</td></tr>
      <tr><td><code>memory</code></td><td>Selected parent memory profile definitions, with explicit storage scope and reader or curator access.</td></tr>
      <tr><td><code>apps</code></td><td>Restricted views of apps currently installed on the parent, using the parent&apos;s selected account and installation configuration.</td></tr>
    </tbody></table>
    <p>Transcripts are not inherited. Neither are the parent&apos;s schedules, playbooks, outbound route grants or MCP installations. Installed shared tools are not selected by <code>inherit.tools</code>; declare them on the worker or expose the needed operations through an app.</p>

    <h3 id="memory">Shared and isolated memory</h3>
    <p><code>scope: &quot;shared&quot;</code> gives the worker access to the selected parent-scoped memory. It is the same underlying memory, so changes by an authorized curator can become visible to both agents. <code>scope: &quot;isolated&quot;</code> uses the same profile definitions under the child&apos;s storage identity. Omit memory inheritance when only the worker&apos;s own profiles should be available.</p>
    <p>Inherited memory is read-only by default. Explicit <code>access: &quot;curator&quot;</code> can preserve curator abilities the parent already has; it cannot upgrade a parent reader. Reader inheritance also removes pinned-context mutation tools. Shared memory is scoped to the parent agent, not to whichever parent chat happens to be active.</p>
    <p>Memory adapters must namespace storage by the identity supplied to their factories. Foundry cannot isolate an adapter that always opens the same global namespace. Profiles with custom <code>mount</code> functions are rejected for inheritance because Foundry cannot inspect their permissions. See <Link href="/foundry/docs/capabilities#memory">memory profiles</Link> for configuration.</p>

    <h3 id="apps">App permissions and revocation</h3>
    <p><code>{"restrictApp(app, { tools, operations, transmissions })"}</code> narrows an existing app. Each list is an exact allowlist; omitted lists grant nothing. <code>tools</code> selects contributed tools, <code>operations</code> gates <code>withAccountSession</code>, and <code>transmissions</code> selects the app&apos;s transmission surfaces. Chaining restrictions intersects access.</p>
    <p>App inheritance borrows a current installation rather than copying it permanently into the worker&apos;s desired state. Foundry resolves it on each run and rechecks borrowed app authority before tool and account-session operations. Removing the parent installation revokes future use, including in a long-running worker; revocation cannot undo an external effect already in progress.</p>
    <p>A modifier cannot acquire credentials, grant an outbound route or bypass tool approval. Route grants and bindings remain separate, and API calls still use the application&apos;s request-authorization adapter. These controls constrain model-visible capabilities; tool implementations, app installers and memory factories remain trusted application code.</p>

    <h2 id="communication">Direct messages and delegated tasks</h2>
    <p>A durable worker is a place to send work over time. Task delegation is one way to organize that work. It adds task status, questions and a correlated result to the worker&apos;s independent lifetime.</p>
    <table><thead><tr><th>Operation</th><th>Use it for</th><th>What comes back</th></tr></thead><tbody>
      <tr><td>Direct message</td><td>A new fact, a changed priority, a spontaneous finding, or coordination without opening a tracked task.</td><td>A durable acceptance receipt. A response is separate work; there is no automatic reply loop.</td></tr>
      <tr><td>Task delegation</td><td>An assignment whose progress, clarification questions and final outcome should be associated with the caller.</td><td>A task ID immediately; questions and the final result return to the originating conversation.</td></tr>
    </tbody></table>
    <p>Both operations use the same durable event-delivery layer. Neither requires a mesh inbox. Existing sibling <code>delegates</code> still work; a declared durable slot is automatically a delegation target, so you do not repeat its name in <code>delegates</code>.</p>

    <h3 id="direct">Send a message to a worker or parent</h3>
    <p>Foundry exposes the following model tools. These calls describe what the agent can do; they are not functions to import into application code:</p>
    <CodeBlock language="typescript" code={`// Parent → its named worker.
glove_foundry_message({
  to: "analysis",
  message: "The source data has changed. Use revision 12 for future work.",
  delivery: { id: "source-revision-12", whenIdle: "wake" },
});

// Worker → its actual parent, in a specific parent conversation.
glove_foundry_message({
  to: "parent",
  message: "A finding needs attention.",
  delivery: { conversationId: "<parent conversation ID>", whenIdle: "wake" },
});`} />
    <p>The model tool can address declared children and the actual parent, rather than arbitrary instance IDs. Messages include a host-readable <code>metadata.replyTo</code> address in <code>ctx.events</code>. Application code can use that origin when choosing where a reply belongs.</p>
    <p>Your application can contact the worker directly through the client, even when its parent has no active run. Use a stable ID when retrying the same message:</p>
    <CodeBlock language="typescript" code={`const worker = client.subagent(parentId, "analysis");
const receipt = await worker.send("Use revision 12 for future work.", {
  id: "source-revision-12",
  whenIdle: "wake",
});

// An app can also publish an event to an exact existing conversation.
await client.emitEvent(
  { agentId: receipt.agentId, conversationId: receipt.conversationId },
  { id: "revision-13", source: "app:documents", kind: "source.changed", content: "Revision 13 is available." },
  { whenIdle: "defer", deferTimeoutMs: 30_000 },
);`} />

    <h3 id="targeting">Choose the conversation that should receive it</h3>
    <p>An instance ID identifies the worker. A conversation ID identifies the particular context in which it will process the event. A direct message without <code>delivery.conversationId</code> uses the recipient&apos;s stable default event conversation, created when needed. It does not select the latest chat or the currently running task.</p>
    <p>Set <code>delivery.conversationId</code> to reach an existing conversation belonging to that recipient. Foundry validates instance ownership and workspace. This applies in both directions: a worker&apos;s message to <code>parent</code> needs an explicit conversation ID to reach a particular user chat. To update a delegated task, address its conversation or use the task reply tool.</p>
    <p>A message receipt contains <code>messageId</code>, <code>agentId</code>, <code>conversationId</code> and a <code>runId</code> when one is handling the event. Acceptance means the journal owns the event, not that a model has answered it. Reusing an ID with different content or policy fails; new information should get a new ID.</p>

    <h3 id="delegate">Delegate a tracked task</h3>
    <CodeBlock language="typescript" code={`// Parent: start a task on the existing owned worker.
glove_foundry_delegate({ to: "analysis", task: "Assess the proposed change and report risks." });

// Worker, while handling that task: request clarification.
glove_foundry_ask({ question: "Which constraints are mandatory?" });

// Parent: answer or add instructions to the task.
glove_foundry_reply({ delegationId: "<task ID>", message: "Preserve the existing API." });

// The worker's final answer returns to the originating conversation automatically.`} />
    <p>Each task creates a separate conversation on the same owned worker instance. A new task does not create a new worker. Questions and results retain their task correlation and return to the conversation that delegated the work. Direct messages to the worker&apos;s default conversation remain separate from those tasks.</p>
    <p>For delegation between separately managed sibling agents, see <Link href="/foundry/docs/layered-agents">layered agents</Link>. For a transient nested tool invocation, see the <Link href="/foundry/docs/multi-agent">multi-agent composition guide</Link>.</p>

    <h2 id="policies">Configure how events reach a runtime</h2>
    <p>Delivery is addressed to an agent and conversation before any model is invoked. Foundry first persists the event, target and policy. If that conversation has a live run, the event joins its native event stream at the next available boundary. Otherwise, the idle policy determines when a new event turn starts.</p>
    <p>There are three configuration levels: the worker definition&apos;s <code>eventDelivery</code> supplies defaults; a slot&apos;s <code>eventDelivery</code> replaces that default object for the owned worker; an individual send overrides fields of the effective recipient policy.</p>
    <CodeBlock language="typescript" code={`// On an ordinary agent definition:
eventDelivery: { whenIdle: "wake" }

// In one parent's durableSubagents slot:
analysis: {
  agent: worker,
  eventDelivery: { whenIdle: "defer", deferTimeoutMs: 60_000 },
}

// For a particular message:
await workerHandle.send("Handle this update promptly.", {
  id: "update-42",
  whenIdle: "wake",
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
});`} />
    <table><thead><tr><th>Policy</th><th>Idle conversation</th></tr></thead><tbody>
      <tr><td><code>whenIdle: &quot;wake&quot;</code></td><td>Starts an event turn. This is the default when no policy is supplied.</td></tr>
      <tr><td><code>whenIdle: &quot;defer&quot;</code>, no effective timeout</td><td>Waits for the next turn in that conversation.</td></tr>
      <tr><td><code>defer</code> with <code>deferTimeoutMs</code></td><td>Joins the next turn, or wakes at the deadline measured from durable acceptance. Restarting the controller does not reset that deadline.</td></tr>
      <tr><td><code>expiresAt</code> on the message or event</td><td>Discards stale input before consumption, including during recovery.</td></tr>
    </tbody></table>
    <p>These policies do not interrupt an executing tool or infer whether a user is present. A waking event can bring deferred events into the same turn. Different conversations can run independently within the configured execution limits. Task starts, questions, replies and results use the same delivery layer and recipient defaults.</p>

    <h2 id="runtime-context">Spontaneous delivery into runtime context</h2>
    <p>A delivered message becomes a native <code>AgentEvent</code>. During a normal model/tool loop it joins the context at an event boundary and is saved to history. An idle event turn uses <code>processEvents()</code>. Custom Foundry handlers can read <code>ctx.events</code> or call <code>ctx.defaultRun()</code> to use the normal loop.</p>
    <p>Standing state, such as the current list of open tasks, is supplied as live runtime-context snapshots. Arriving messages are events. This lets a worker report new information while the parent is doing other work, without turning every arrival into a synthetic user request.</p>
    <p>A realtime runtime can hold the turn queue and consume native events as part of its session. It decides when a response can be spoken or displayed, for example at a quiet pause. The controller still owns durable targeting and delivery; a provider socket or live room is not what makes the worker durable.</p>
    <p>Use <code>client.emitEvent</code>, <code>runtime.emitEvent</code> or the Foundry messaging tool for durable acceptance. A direct <code>glove.emitEvent</code> call inside a process does not create a Foundry journal record. Optional live mesh transport has its own configuration and is not required here. See <Link href="/docs/runtime-context">runtime context and spontaneous events</Link> for the native primitives.</p>

    <h2 id="responsiveness">Give workers different execution budgets</h2>
    <p>A worker&apos;s run is independent of the run that delegated to it. A parent can finish a request while its worker continues, and a later question or result can wake the originating parent conversation. You can choose different models and run limits for each responsibility:</p>
    <CodeBlock language="typescript" code={`// On the worker's defineAgent:
runTimeoutMs: 4 * 60 * 60 * 1000,
maxConcurrentRuns: 1`} />
    <p><code>runTimeoutMs</code> is the run deadline; the default is five minutes. <code>maxConcurrentRuns</code> limits simultaneous runs of that definition. Plan the runtime&apos;s <code>execution.maxConcurrent</code> alongside those limits so background work leaves capacity for responsive agents.</p>
    <p>A durable identity does not give a worker an unlimited run or a scheduling priority. These settings control time and capacity; they do not guarantee latency or preempt a slow tool.</p>

    <h2 id="persistence">What survives a restart</h2>
    <p>The shared journal retains accepted direct messages, delegated task deliveries, questions, replies and results until a successful receiving run reports consumption. Startup reconciles completed-run receipts and replays unfinished delivery to the stored target. A long live run may have heard an event while its journal receipt remains pending until that run successfully closes.</p>
    <p>Delivery is <strong>at least once</strong>. A crash after a side effect or transcript write but before acknowledgment can repeat work. Use stable event IDs for idempotent external effects. Recovery starts a new execution of pending work; it does not restore a JavaScript stack, arbitrary tool checkpoints or a provider session.</p>
    <table><thead><tr><th>State</th><th>Persistence boundary</th></tr></thead><tbody>
      <tr><td>Instances, ownership, conversation records, events and receipts</td><td>The application&apos;s <code>FoundryDataAdapter</code>. Use <code>FileFoundryDataAdapter</code> or a persistent adapter implementing the event-journal methods.</td></tr>
      <tr><td>Message history</td><td>The application <code>conversationStore</code> or agent <code>store</code>. An instance record alone does not save native transcripts.</td></tr>
      <tr><td>Structured memory</td><td>The selected memory adapters, with the intended parent or child namespaces.</td></tr>
      <tr><td>Files and external application data</td><td>The configured working-environment persistence or application-owned storage.</td></tr>
    </tbody></table>
    <p>The in-memory adapter does not survive a process restart. Completed and expired event IDs remain as deduplication receipts until owned-data purge; there is no automatic receipt expiry. Transcript writes and journal acknowledgments are separate transactions. Run one controller per data store, and read <Link href="/foundry/docs/persistence">persistence</Link> before deploying.</p>

    <h2 id="lifecycle">Inspect, archive, resume and purge</h2>
    <p>The worker&apos;s data belongs to its ownership relationship, so lifecycle operations address the parent and slot. The client exposes these operations on the same handle used for messaging:</p>
    <CodeBlock language="typescript" code={`const worker = client.subagent(parentId, "analysis");
const state = await worker.data(); // existing instance, conversations, events, children and owned records
await worker.archive();           // stop work and retain its data
await worker.resume();            // activate this worker and recover pending events
await worker.archive();
await worker.purge();             // remove owned data after explicit cleanup`} />
    <p>Archival marks the worker inactive, archives its existing descendants, pauses schedules and stops queued/running work. Messages, delegation and direct runs are rejected while it is archived. Pending events and private data remain available for inspection or recovery.</p>
    <p>Resume activates the selected worker and recovers its pending events. Descendants and paused schedules need explicit resumption. Removing a slot from code detaches its existing worker; it does not erase its records. You can still inspect and archive that data.</p>
    <p>Purge requires an archived worker, no running work, already-purged descendants and an explicit idempotent <code>cleanup</code> hook on the slot. The hook deletes private transcripts, memory and external files through your application&apos;s adapters. Hook failure leaves the archived Foundry records available for a retry; keep the declaration until cleanup finishes. A no-op hook is appropriate only when no application-owned private data exists.</p>
    <p>The bundled adapters then remove owned conversations, event records and deduplication receipts, pending deliveries, activations, VFS snapshots, tasks, inbox items and scoped environment data. Shared parent memory, shared workspace entries and app accounts are preserved. Copies already received in another agent&apos;s history, execution logs, observability and third-party records have separate retention.</p>
    <p>A minimal tombstone keeps the worker&apos;s ownership and provisioning identity. Old retries cannot silently recreate a purged worker. Declare a new slot name when you intentionally want a replacement.</p>

    <h2 id="run">A complete worked example</h2>
    <p>The <Link href="/foundry/docs/durable-subagents/realtime-example">realtime front and durable researcher walkthrough</Link> puts these primitives together in a runnable project. It includes persistent stores, memory and app inheritance, direct messaging, delegation, delivery policies and restart verification. It is one application of durable workers; the ownership and delivery model above applies regardless of how your agents receive work.</p>
    <p>Continue with <Link href="/foundry/docs/definitions-and-instances">definitions and instances</Link>, <Link href="/foundry/docs/applications">applications</Link>, <Link href="/foundry/docs/layered-agents">task delegation</Link>, or the <Link href="/foundry/docs/reference">API reference</Link>.</p>
  </article>;
}
