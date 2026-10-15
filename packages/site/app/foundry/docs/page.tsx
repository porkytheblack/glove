import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { foundrySections } from "@/lib/foundry-nav";

export const metadata = {
  title: "Overview",
  description:
    "What Glove Foundry provides out of the box, when to use it instead of plain glove-core, and how definitions, instances, conversations and runs fit together.",
};

const inventory: { need: string; get: string; api: string; href: string }[] = [
  { need: "Define agents", get: "One file per agent; the path is its id. Typed route map generated on every dev start.", api: "defineAgent, .foundry/routes.d.ts", href: "/foundry/docs/project-structure" },
  { need: "Many agents from one definition", get: "Persisted instances with their own context, workspace, installations and playbooks.", api: "createAgent, defineAgentInstance", href: "/foundry/docs/definitions-and-instances" },
  { need: "Per-message behaviour", get: "Every field can be a function of the instance, conversation and the new message.", api: "FoundryResolver, AgentAssemblyContext", href: "/foundry/docs/composition" },
  { need: "Capabilities per customer", get: "Shared tools, apps and MCP servers mount only on instances that install them, with typed config.", api: "defineSharedTool, defineApp, defineMcp, install()", href: "/foundry/docs/capabilities" },
  { need: "Threads", get: "Any number of durable conversations per instance, with exact transcripts.", api: "createConversation, conversationTranscript", href: "/foundry/docs/conversations" },
  { need: "Call agents from code", get: "A typed client with run handles you can wait on, cancel, steer and stream.", api: "createFoundryClient, FoundryRunHandle", href: "/foundry/docs/runtime" },
  { need: "Call agents from anything", get: "OpenAI-compatible Chat Completions and Responses endpoints, plus an async run API.", api: "/v1/chat/completions, /v1/responses, /v1/runs", href: "/foundry/docs/openai-compatible" },
  { need: "Future and recurring work", get: "Cron, interval and one-shot schedules; sleep that resumes the same conversation; spawn.", api: "defineSchedule, glove_foundry_schedule, glove_foundry_sleep", href: "/foundry/docs/automation" },
  { need: "Events from the outside world", get: "Typed inbound/outbound transports, playbooks, idempotent delivery and auto-provisioned agents.", api: "defineTransmission, composePlaybook", href: "/foundry/docs/applications" },
  { need: "Human sign-off", get: "Permission-gated tools pause the run on an expiring approval record.", api: "requiresPermission, resolveApproval", href: "/foundry/docs/approvals" },
  { need: "Redirect running work", get: "Interrupt-and-restart steering in the same conversation, with lineage.", api: "handle.steer(), /v1/runs/:id/steer", href: "/foundry/docs/approvals#steering" },
  { need: "Files, code and artifacts", get: "A persistent VFS, JavaScript/Python/Lisp REPLs and document/media adapters.", api: "defineWorkingEnvironment, defineRepl", href: "/foundry/docs/working-environments" },
  { need: "Browsers and sandboxes", get: "Mounted browser sessions and persistent coding containers on one managed Station.", api: "mountBrowser, mountSandbox, stationDaemon", href: "/foundry/docs/browser-and-sandbox" },
  { need: "Guided conversations", get: "Goals, facts and forms mounted as first-class lazy fields.", api: "defineGoals, defineFacts, defineForms", href: "/foundry/docs/guidance" },
  { need: "See what happened", get: "An inspector and WebChat at localhost:4141, and a correlated event stream.", api: "glove foundry dev, /api/events", href: "/foundry/docs/observability" },
  { need: "Keep state across restarts", get: "Swappable data adapters, including a single-host file adapter.", api: "FileFoundryDataAdapter, FoundryDataAdapter", href: "/foundry/docs/persistence" },
];

export default function FoundryOverviewPage() {
  return (
    <article className="docs-content">
      <span className="foundry-doc-kicker">Start / Overview</span>
      <h1>Glove Foundry</h1>
      <p className="blog-lede">
        Foundry is the application framework for Glove agents. You write each agent
        as a TypeScript file; Foundry turns the folder into a running service with
        persisted agents, conversations, a run queue, an HTTP and OpenAI-compatible
        API, schedules, inbound integrations, approvals and an inspector.
      </p>

      <div className="docs-note"><span className="docs-note-icon">◆</span><p>
        <strong>Foundry builds on Glove; it does not replace it.</strong> Every agent
        Foundry runs is a normal <Link href="/docs/core">glove-core</Link> agent with
        normal tools. Any Glove package — memory, MCP, REPLs, voice, image — mounts
        the same way inside Foundry as outside it.
      </p></div>

      <h2 id="what-you-get">What you get out of the box</h2>
      <table>
        <thead><tr><th>You need</th><th>Foundry gives you</th><th>Start with</th></tr></thead>
        <tbody>
          {inventory.map((row) => (
            <tr key={row.need}>
              <td><Link href={row.href}>{row.need}</Link></td>
              <td>{row.get}</td>
              <td><code>{row.api}</code></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="when-to-use">When to use Foundry</h2>
      <p>Use Foundry when the agent is the backend of a product:</p>
      <ul>
        <li>more than one user, tenant or team needs <strong>their own agent</strong> with its own data and capabilities;</li>
        <li>other services, UIs or SDKs need to <strong>call agents over HTTP</strong>;</li>
        <li>agents must <strong>act later</strong> — on a schedule, after a delay, or when a message or webhook arrives;</li>
        <li>people need to <strong>approve, redirect or audit</strong> what agents do.</li>
      </ul>
      <p>
        If you are adding one assistant to an app you already run and you are happy to
        own storage and the request path, <Link href="/docs/getting-started">glove-core with glove-react and glove-next</Link>{" "}
        is smaller. You can move the same tools into Foundry later.
      </p>

      <h2 id="mental-model">The mental model</h2>
      <div className="foundry-model-grid">
        <div><span>01 / CODE</span><h3>Definition</h3><p><code>agents/support/agent.ts</code>. What an agent of this kind <em>can</em> assemble: model, prompt, tools, catalogue, schedules. Identity comes from the file path.</p></div>
        <div><span>02 / DATA</span><h3>Instance</h3><p>A persisted agent: id, workspace, context, installed apps/tools/MCP servers and playbooks. Created by your app, the API or the inspector.</p></div>
        <div><span>03 / DATA</span><h3>Conversation</h3><p>A durable thread owned by one instance. An instance can hold many at once; each has its own transcript.</p></div>
        <div><span>04 / EXECUTION</span><h3>Run</h3><p>One message processed by one freshly assembled agent. Correlated with its model passes, tool calls, events and result.</p></div>
      </div>

      <h2 id="lifecycle">What happens when a message arrives</h2>
      <ol>
        <li>A message reaches an instance and conversation — from the typed client, <code>/api</code>, <code>/v1/chat/completions</code>, a schedule, or an inbound transmission.</li>
        <li>Foundry persists the run and queues it on its managed execution daemon, which executes it in a fresh child process.</li>
        <li>The job reloads the instance and conversation from the data adapter and loads the definition from its file.</li>
        <li>Each definition field is resolved for this run — literals as-is, functions called with the assembly context (instance, conversation, message, history, installations).</li>
        <li>Built-in Foundry tools, the definition&apos;s own tools, and the apps, shared tools and MCP servers <em>this instance installed</em> are mounted, along with memory, layers, subscribers, the working environment and REPL.</li>
        <li>The normal Glove agent loop runs; every model pass, tool call and custom event is recorded against the run.</li>
        <li>The result and transcript are stored; the inspector, event stream and any waiting client see the outcome.</li>
      </ol>
      <p>
        Because step 3 happens on every run, editing an instance (installing an app,
        changing its context) takes effect on the next message — no deploy, no restart.
      </p>

      <h2 id="smallest-agent">The smallest useful agent</h2>
      <CodeBlock
        filename="agents/assistant/agent.ts"
        language="typescript"
        code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { FileStore } from "../../lib/file-store.js";

export default defineAgent({
  description: "A general-purpose assistant",
  model: () => createAdapter({
    provider: "openrouter",
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
    stream: true,
  }),
  // Where this conversation's transcript lives between messages.
  store: ({ conversationId }) => FileStore.open(conversationId),
  systemPrompt: "You are a precise, practical assistant.",
});`}
      />
      <div className="docs-note"><span className="docs-note-icon">!</span><p>
        <strong>Every run is a separate process.</strong> Foundry executes each message
        in a fresh child process, so anything held only in memory —{" "}
        <code>new MemoryStore(...)</code>, in-memory memory adapters, module-level
        variables — starts empty on the next message. Use a store that reads and writes
        outside the process (both starter templates already do): the 25-line{" "}
        <code>FileStore</code> from the <Link href="/foundry/docs/tutorial#step-2-agent">tutorial</Link>,
        the fuller <code>FileConversationStore</code> on the{" "}
        <Link href="/foundry/docs/persistence">Persistence</Link> page, or your database.
      </p></div>
      <p>
        Run <code>pnpm dev</code>, open <code>http://127.0.0.1:4141</code>, and choose
        <strong> Start a run</strong>. The <Link href="/foundry/docs/tutorial">tutorial</Link>{" "}
        takes this to a multi-tenant support agent with installed tools, schedules,
        approvals and an OpenAI SDK client.
      </p>

      <h2 id="boundaries">What Foundry owns and what you own</h2>
      <table>
        <thead><tr><th>Foundry owns</th><th>You provide</th></tr></thead>
        <tbody>
          <tr><td>Discovery, file identities, assembly, the run lifecycle and the inspector</td><td>Model provider configuration and API keys</td></tr>
          <tr><td>Instance, conversation, playbook, schedule and installation records and contracts</td><td>A durable data adapter (file adapter included) and a durable transcript store</td></tr>
          <tr><td>Tools generated from installed apps and outbound transmissions</td><td>Credential lookup and refresh behind opaque account references</td></tr>
          <tr><td>The HTTP API, typed client and OpenAI-compatible endpoints</td><td>Request authorization when the server is not on loopback, TLS and network policy</td></tr>
        </tbody>
      </table>
      <p>
        Foundry never performs OAuth, stores secrets, or picks an account for a user.
        It records only account metadata and an opaque <code>accessRef</code> that your
        adapter resolves. See <Link href="/foundry/docs/applications#credentials">the credential boundary</Link>.
      </p>

      <h2 id="read-the-handbook">Read by task</h2>
      {foundrySections.slice(1).map((section) => (
        <div key={section.title}>
          <h3 id={`handbook-${section.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{section.title}</h3>
          <div className="doc-cards foundry-handbook-grid">
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="doc-card">
                <strong className="doc-card-title">{item.label}</strong>
                <p className="doc-card-desc">{item.summary}</p>
                <span>Read →</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </article>
  );
}
