import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { GloveLogo } from "@/components/glove-logo";

export const metadata: Metadata = {
  title: "Glove Foundry — the framework for agent systems",
  description:
    "Write agents as TypeScript files. Foundry runs them as a service: persisted instances and conversations, a typed client, an OpenAI-compatible API, schedules, webhooks, approvals and a built-in inspector.",
};

const features: { title: string; text: string; api: string; href: string }[] = [
  {
    title: "Agents as files",
    text: "agents/support/agent.ts is the agent “support”. Generated route types make every client call type-checked.",
    api: "defineAgent · FoundryRoutes",
    href: "/foundry/docs/project-structure",
  },
  {
    title: "Instances & conversations",
    text: "One definition, many persisted agents — each with its own context, installed apps and any number of conversations.",
    api: "createAgent · createConversation",
    href: "/foundry/docs/definitions-and-instances",
  },
  {
    title: "Typed client & REST API",
    text: "Create agents, send messages, wait for runs, read transcripts and stream events from your app or another service.",
    api: "createFoundryClient · /api/*",
    href: "/foundry/docs/runtime",
  },
  {
    title: "OpenAI-compatible endpoints",
    text: "Point any OpenAI SDK, chat UI or eval harness at an agent. Conversations stay durable across requests.",
    api: "/v1/chat/completions · /v1/responses",
    href: "/foundry/docs/openai-compatible",
  },
  {
    title: "Inspector & WebChat",
    text: "localhost:4141 shows every definition, instance, run, event and schedule — and lets you chat with any instance.",
    api: "glove foundry dev",
    href: "/foundry/docs/observability",
  },
  {
    title: "Schedules, sleep & spawn",
    text: "Agents wake themselves on a cron or after a delay, suspend and resume the same conversation, or start other agents.",
    api: "defineSchedule · glove_foundry_schedule",
    href: "/foundry/docs/automation",
  },
  {
    title: "Inbound events & playbooks",
    text: "Webhooks and chat messages arrive as runs. Subscriptions can provision a fresh agent per thread or per event.",
    api: "defineTransmission · composePlaybook",
    href: "/foundry/docs/applications",
  },
  {
    title: "Installable apps, tools & MCP",
    text: "Each instance installs only the capabilities it should have, with typed config and per-account credentials you control.",
    api: "defineApp · defineMcp · install()",
    href: "/foundry/docs/capabilities",
  },
  {
    title: "Approvals",
    text: "Mark a tool as permission-gated and the run pauses on an expiring approval record until a person approves or denies it.",
    api: "requiresPermission · resolveApproval",
    href: "/foundry/docs/approvals",
  },
  {
    title: "Steering",
    text: "Redirect an agent mid-task: Foundry interrupts at a safe boundary and restarts with the new instruction in the same conversation.",
    api: "handle.steer() · /v1/runs/:id/steer",
    href: "/foundry/docs/approvals#steering",
  },
  {
    title: "Workspaces, files & code",
    text: "A persistent virtual filesystem, JavaScript/Python/Lisp REPLs, document and media adapters, shared tasks and an inbox.",
    api: "defineWorkingEnvironment · defineRepl",
    href: "/foundry/docs/working-environments",
  },
  {
    title: "Browsers & sandboxes",
    text: "Mount browser sessions and persistent coding containers. Foundry hosts the providers on the Station it already runs.",
    api: "mountBrowser · mountSandbox",
    href: "/foundry/docs/browser-and-sandbox",
  },
];

const stopWriting: [string, string][] = [
  ["A table of agents per user and the code to rebuild each one", "Persisted instances reconstructed from the current definition on every run"],
  ["An HTTP server, request validation and run tracking", "A typed client, a REST API and OpenAI-compatible endpoints"],
  ["A job queue, cron runner and “remind me later” storage", "Durable schedules, sleep and spawn the model can call itself"],
  ["Webhook handlers that find the right agent and thread", "Transmissions, playbooks and idempotent inbound delivery"],
  ["A pause/resume flow for human sign-off", "Approval records with list/approve/deny APIs and inspector controls"],
  ["Logging you read after something went wrong", "A causal trace of every run, model pass and tool call, live"],
];

export default function FoundryPage() {
  return (
    <main className="foundry-page">
      <section className="foundry-hero">
        <div className="foundry-hero-copy">
          <div className="foundry-eyebrow"><GloveLogo /> Glove Foundry <span>glove-foundry</span></div>
          <h1>The application framework for <em>agent systems.</em></h1>
          <p>
            Write each agent as a TypeScript file. Foundry runs them as a service:
            a persisted agent per customer, durable conversations, a job queue,
            schedules, webhooks, human approvals, a typed and an OpenAI-compatible
            API — and an inspector that shows you how every run happened.
          </p>
          <div className="foundry-hero-actions">
            <Link href="/foundry/docs/tutorial" className="btn-primary">Build your first agent system →</Link>
            <Link href="#out-of-the-box" className="btn-secondary">See what you get</Link>
          </div>
          <div className="foundry-install"><span>$</span> npx glove-foundry init my-agents</div>
        </div>

        <div className="foundry-assembly" aria-label="How a Foundry run is assembled">
          <div className="assembly-topline"><span>ONE RUN / LIVE</span><i /></div>
          <div className="assembly-column">
            <div className="assembly-node code"><b>01</b><span><small>CODE · agents/support/agent.ts</small>Definition: model, prompt, tools</span></div>
            <div className="assembly-connector"><span>+ persisted data</span></div>
            <div className="assembly-node data"><b>02</b><span><small>DATA · instance + conversation</small>Context, installed apps, history</span></div>
            <div className="assembly-connector"><span>+ the new message</span></div>
            <div className="assembly-node run"><b>03</b><span><small>RUNTIME · inspector</small>Assembled agent, observable run</span><i /></div>
          </div>
          <div className="assembly-readout">
            <span>/api</span><span>/v1</span><span>:4141</span><span>sse</span>
          </div>
        </div>
      </section>

      <section className="foundry-steps" aria-labelledby="sixty-seconds">
        <span className="section-label">In sixty seconds</span>
        <h2 id="sixty-seconds">Write a file. Run the server. Call your agent.</h2>
        <div className="foundry-steps-grid">
          <div>
            <span className="foundry-step-n">1 · Define</span>
            <CodeBlock
              filename="agents/support/agent.ts"
              language="typescript"
              code={`import { createAdapter } from "glove-core/models/providers";
import { defineAgent } from "glove-foundry";
import { z } from "zod";
import { FileStore } from "../../lib/file-store.js"; // 25 lines, see Persistence

export default defineAgent({
  description: "Answers questions about orders",
  model: () => createAdapter({
    provider: "openrouter",
    model: "openai/gpt-4.1-mini",
    stream: true,
  }),
  // Each run is its own process: keep the transcript somewhere durable.
  store: ({ conversationId }) => FileStore.open(conversationId),
  // Resolved per run, from the instance's own data.
  systemPrompt: (_agent, ctx) =>
    \`You are support for \${ctx.agentInstance.context.company}.\`,
  tools: [{
    name: "lookup_order",
    description: "Find an order by id",
    inputSchema: z.object({ orderId: z.string() }),
    async do({ orderId }) {
      return { status: "success", data: { orderId, state: "shipped" } };
    },
  }],
});`}
            />
          </div>
          <div>
            <span className="foundry-step-n">2 · Run</span>
            <CodeBlock
              filename="terminal"
              language="bash"
              code={`$ pnpm dev

  Glove Foundry

  Local:    http://127.0.0.1:4141
  Agents:   1
  Runtime:  ready
  Types:    .foundry/routes.d.ts

# Create an instance of "support" for one customer
$ curl -s localhost:4141/api/agent-instances \\
    -H 'content-type: application/json' \\
    -d '{"definitionId":"support","context":{"company":"Acme"}}'
{"id":"agent_…","definitionId":"support",…}`}
            />
            <p className="foundry-step-note">
              Open <code>http://127.0.0.1:4141</code> to chat with it in WebChat and
              watch each model pass and tool call in the run trace.
            </p>
          </div>
          <div>
            <span className="foundry-step-n">3 · Call</span>
            <CodeBlock
              filename="any OpenAI client"
              language="typescript"
              code={`import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://127.0.0.1:4141/v1",
  apiKey: "unused-on-loopback",
});

// model = an instance id, or a route
// with exactly one instance
const reply = await openai.chat.completions.create({
  model: "support",
  messages: [
    { role: "user", content: "Where is order 1042?" },
  ],
});`}
            />
            <p className="foundry-step-note">
              Or use the generated typed client: <code>foundry.send(agentId, conversationId, text)</code>.
            </p>
          </div>
        </div>
      </section>

      <section id="out-of-the-box" className="foundry-features" aria-labelledby="features-title">
        <span className="section-label">Out of the box</span>
        <h2 id="features-title">Everything between “an agent loop” and “a product people use”.</h2>
        <p className="section-desc">
          Glove gives an agent its abilities. Foundry gives it the rest of a backend.
          Every item below ships in <code>glove-foundry</code> and is on by default or
          one definition away.
        </p>
        <div className="foundry-feature-grid">
          {features.map((feature) => (
            <Link key={feature.title} href={feature.href} className="foundry-feature">
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <code>{feature.api}</code>
            </Link>
          ))}
        </div>
      </section>

      <section className="foundry-code-section">
        <div>
          <span className="section-label">Definitions in code · instances in data</span>
          <h2>One definition. A different agent for every customer.</h2>
          <p>
            A definition says what an agent <em>can</em> assemble. An instance is a
            persisted record of what one agent <em>has</em>: its context, the apps
            and MCP servers it installed, its playbooks and schedules. On every run
            Foundry reloads the instance and resolves each field against the new
            message — so changing an instance never requires a deploy.
          </p>
          <Link href="/foundry/docs/definitions-and-instances">Definitions & instances →</Link>
        </div>
        <CodeBlock
          filename="agents/support/instances.ts"
          language="typescript"
          code={`import { defineAgentInstance, install } from "glove-foundry";
import support from "./agent.js";
import helpdesk from "./apps/helpdesk.app.js";
import refunds from "./tools/refunds.tool.js";

// Same code, two customers, different capabilities.
// Installed tools and apps mount only on the instance that installed them.
export const acme = defineAgentInstance(support, {
  workspaceId: "acme",
  context: { company: "Acme" },
  installations: [
    install(refunds, { limitUsd: 200 }),   // typed by the tool's zod config
    install(helpdesk, { queue: "enterprise" }),
  ],
});

export const globex = defineAgentInstance(support, {
  workspaceId: "globex",
  context: { company: "Globex" },
  installations: [],                       // no refunds, no helpdesk
});`}
        />
      </section>

      <section className="foundry-compare" aria-labelledby="stop-writing">
        <span className="section-label">Compared with glove-core alone</span>
        <h2 id="stop-writing">What you stop writing.</h2>
        <div className="foundry-compare-table">
          <div className="foundry-compare-head"><span>Without Foundry you build</span><span>Foundry provides</span></div>
          {stopWriting.map(([before, after]) => (
            <div key={before} className="foundry-compare-row">
              <span>{before}</span>
              <span>{after}</span>
            </div>
          ))}
        </div>
        <p className="foundry-compare-note">
          Only embedding one agent inside an existing app? <Link href="/docs/getting-started">glove-core and glove-react</Link>{" "}
          are enough. <Link href="/docs">Compare the paths →</Link>
        </p>
      </section>

      <section className="foundry-statement">
        <span>THE THESIS</span>
        <h2>Stop drawing every route through the work.</h2>
        <p>
          Workflow software asks you to predict the branches. Foundry lets you define
          capable agents, the world they can act in, and the boundaries they must
          respect. The agent can interpret the request, plan, create artifacts, ask for
          approval, schedule a follow-up, and adapt while it runs. Deterministic
          handlers and fixed schedules are still there when you need them.
        </p>
      </section>

      <section className="foundry-code-section">
        <div>
          <span className="section-label">Browser + sandbox capabilities</span>
          <h2>One managed Station. The providers you choose.</h2>
          <p>Mount browser workflows and persistent coding sandboxes with glove-execution. Foundry can run their provider adapters alongside agent jobs on the Station it already owns.</p>
          <Link href="/foundry/docs/browser-and-sandbox">Run the illustrated Operator example →</Link>
          <p><Link href="/blog/agents-with-browsers-and-sandboxes">Read the design story →</Link></p>
        </div>
        <img src="/foundry/operator/architecture.svg" alt="Foundry owns one Station with agent jobs and optional browser and sandbox adapters." width={1200} height={530} style={{ width: "100%", height: "auto" }} />
      </section>

      <section className="foundry-examples" aria-labelledby="built-with">
        <span className="section-label">Built with Foundry</span>
        <h2 id="built-with">Read a complete system.</h2>
        <div className="doc-cards">
          <Link className="doc-card" href="/foundry/docs/browser-and-sandbox">
            <span className="doc-card-kicker">Browser · sandbox · memory</span>
            <span className="doc-card-title">Operator</span>
            <p className="doc-card-desc">Browses sites, writes an app and keeps its server running in a persistent container.</p>
          </Link>
          <a className="doc-card" href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-braind-storm">
            <span className="doc-card-kicker">Mesh · voice · image · workspace</span>
            <span className="doc-card-title">Braind Storm</span>
            <p className="doc-card-desc">A voice-led brand workforce of five agents sharing one sandboxed workspace and a live observatory.</p>
          </a>
          <a className="doc-card" href="https://github.com/porkytheblack/glove/tree/main/examples/foundry-agent">
            <span className="doc-card-kicker">Reference app</span>
            <span className="doc-card-title">Release planner & guided intake</span>
            <p className="doc-card-desc">The canonical small project: a typed handler, schedules, and goals, facts and forms on SQLite.</p>
          </a>
        </div>
      </section>

      <section className="foundry-spectrum">
        <div><span>Glove capabilities</span><strong>models · memory · inboxes · voice · images · mesh · MCP · browsers · sandboxes · working environments</strong></div>
        <div><span>Foundry framework</span><strong>routes · instances · conversations · installations · playbooks · schedules · approvals · HTTP & OpenAI API · inspector</strong></div>
        <div><span>Your adapters</span><strong>identity · persistence · credentials · transport · deployment</strong></div>
      </section>

      <section className="foundry-final-cta">
        <div><span>READY / 01</span><h2>Give the idea somewhere to become work.</h2></div>
        <div className="foundry-final-actions">
          <Link href="/foundry/docs/tutorial" className="btn-primary">Start the tutorial →</Link>
          <Link href="/foundry/docs" className="btn-secondary">Read the handbook</Link>
        </div>
      </section>
    </main>
  );
}
