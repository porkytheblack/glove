import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Goals, facts, forms & live context" };
export default function GuidancePage() {
  return <article className="docs-content">
    <span className="foundry-doc-kicker">Model the system / Guided conversations</span>
    <h1>Guide the conversation. Preserve what it learns.</h1>
    <p className="blog-lede">Goals describe the obligations. Facts retain evidence. Forms collect validated answers and drive effects. Context providers keep the model informed as the world changes.</p>
    <p>All four are typed, lazy agent-definition fields. Foundry mounts the existing Glove implementations; it does not introduce another workflow engine or memory system.</p>
    <h2 id="mount">Mount what this conversation needs</h2>
    <CodeBlock filename="agents/intake/agent.ts" language="typescript" code={`export default defineAgent({
  description: "Conversational intake",
  model,
  systemPrompt: "Collect information conversationally using workflow tools.",
  facts: (_agent, ctx) => defineFacts({ adapter: memory(ctx).facts }),
  goals: (_agent, ctx) => defineGoals({
    adapter: memory(ctx).goals, program: intakeGoals,
  }),
  forms: (_agent, ctx) => defineForms({
    adapter: memory(ctx).forms, registry: intakeForms,
  }),
  contextProviders: (_agent, ctx) => [async signal => {
    signal?.throwIfAborted();
    return await loadCurrentPolicy(ctx.agentId, signal);
  }],
});`} />
    <p>Import the helpers from <code>glove-foundry</code>. Return literal values, Promises, or Effects, or use named exports in <code>agent.ts</code>. Return undefined to leave a surface unmounted for this run without deleting its state. One goal program can contain many goals; one registry can expose many forms.</p>
    <h2 id="code-and-data">Code defines behavior. Adapters retain state.</h2>
    <table><thead><tr><th>Code</th><th>Saved data</th></tr></thead><tbody>
      <tr><td>Goal program, stable obligation keys and hooks</td><td>Progress, versioned revisions and hook receipts</td></tr>
      <tr><td>Fact scope, provenance adapter and evidence rules</td><td>Fact revisions, corrections and reusable claims</td></tr>
      <tr><td>Native form schema, gates and executors</td><td>Answers, revision history, pending effects and checkpoint state</td></tr>
      <tr><td>Read-only context providers</td><td>The underlying adapter data, not copied prompt snapshots</td></tr>
    </tbody></table>
    <p>Conversation-local scope is the default and includes workspace and instance ownership. Set <code>scope: "instance"</code> deliberately to share conversations. Custom business subjects remain host-authorized. Use <code>foundryGuidanceSubject(ctx, scope)</code> to derive the same ownership key outside assembly.</p>
    <h2 id="dynamic-goals">Adapt goals without resetting progress</h2>
    <p>A configured program starts only when no saved goal set exists. New runs preserve progress. To change obligations, use the native runner’s versioned revise operation with a reason. Native goal/item keys preserve revision identity; reference their code values instead of copying strings.</p>
    <p>Execution hooks receive typed <code>ctx.goals</code>, <code>ctx.facts</code> and <code>ctx.forms</code> handles. Goals accept native configure and lifecycle hooks for progress-dependent tool selection. Forms remain available until selected; defining a registry does not automatically start every form.</p>
    <h2 id="preparation">Preparation is explicit and evidence-based</h2>
    <p>Set <code>facts.preparationAgent</code> to a dedicated built Glove runnable with its own scope-specific store and tracing subscribers. Add native rule and eligibility callbacks under <code>goals.preparation</code> or <code>forms.preparation</code>. Foundry constructs the shared native preparer; subjects must match. The conversational runnable must not prepare itself.</p>
    <p>Missing rules stay manual. Unverified information needs confirmation unless explicitly permitted. Actions and outcomes require verified successful evidence; approvals require authorized actors. Corrections do not automatically overwrite answers or repeat completed effects. Hooks and effects are at-least-once; downstream integrations must honor idempotency keys.</p>
    <h2 id="context">Live context, not a growing system prompt</h2>
    <p>The outer resolver chooses providers for the current message. Each provider is re-read before a model iteration, receives an abort signal, and returns text or nothing. Keep it read-only. Glove appends transient user-role context after complete tool results without modifying system instructions or saved history. Foundry removes custom providers on cleanup.</p>
    <p>Native realtime voice refreshes at startup and after tools. After external changes the voice host calls <code>realtime.refreshContext()</code>. Wrappers must forward the native context-provider methods; refreshing does not erase older provider-session context.</p>
    <h2 id="persistence">Start with durable adapters</h2>
    <CodeBlock filename="memory.ts" language="typescript" code={`import { createSqliteMemoryAdapters } from "glove-memory/sqlite";
import { MemorySchema } from "glove-memory/core";
import { foundryGuidanceSubject, type AgentAssemblyContext } from "glove-foundry";

export const memory = (ctx: AgentAssemblyContext) => createSqliteMemoryAdapters({
  file: "/data/agent-memory.sqlite",
  namespace: foundryGuidanceSubject(ctx, "instance"),
  schema: new MemorySchema(),
});`} />
    <p>The bundle includes goals, facts and forms as well as entity, episodic, resource and pinned-context memory. Use Node 22.13+ and a local persistent volume. Goal/form writes retain native CAS semantics. A separate SQLite lock protects fact callbacks across processes while each save commits independently; process death releases the lock. Fact scopes in one file serialize. Use a database adapter or separate files for greater concurrency; network filesystems are unsupported.</p>
    <p>Transcript storage, Foundry runtime data, workflow state and VFS persistence remain separate. Persist all the boundaries your application needs. These fields do not create timers; use Foundry schedules and inbound activation for future work.</p>
    <h2 id="inspect">Inspect progress without dumping answers</h2>
    <p>The run inspector’s Conversation guidance card shows the latest observed goal progress, fact/claim counts, and form state with pending effects. It is not a live database view. Its summary omits answer values and fact bodies; native tool/context traces may still contain conversation data and need appropriate access and retention policies.</p>
    <p><a href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent/agents/guided-intake">Explore the runnable guided-intake example</a>, or continue to <Link href="/foundry/docs/getting-started">setup and commands</Link>.</p>
  </article>;
}
