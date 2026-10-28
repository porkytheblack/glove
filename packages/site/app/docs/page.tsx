import Link from "next/link";
import { DocCards } from "@/components/doc-cards";
import { BuildLadder, LayerStack } from "@/components/diagrams";

export const metadata = {
  title: "Documentation",
  description:
    "Glove is a set of primitives for building agent harnesses: coding agents, personal assistants, support desks, voice agents and more. Glove Foundry turns harnesses into a running system; Kuiper runs it in production.",
};

const tasks: { want: string; href: string; page: string; pkg: string }[] = [
  { want: "See everything that already exists before I build something", href: "/docs/primitives", page: "Primitives map", pkg: "all" },
  { want: "Build a coding agent", href: "/docs/harnesses/coding", page: "Coding agent blueprint", pkg: "glove-core · glove-execution" },
  { want: "Build a personal assistant that works while I'm away", href: "/docs/harnesses/personal", page: "Personal agent blueprint", pkg: "glove-foundry · glove-memory" },
  { want: "Run many durable agents with an HTTP API, a dashboard and schedules", href: "/foundry/docs/tutorial", page: "Foundry tutorial", pkg: "glove-foundry" },
  { want: "Deploy my agent and keep it running", href: "/foundry/docs/kuiper", page: "Deploy on Kuiper", pkg: "glove-foundry · Kuiper" },
  { want: "Talk to my agent from any OpenAI SDK or chat UI", href: "/foundry/docs/openai-compatible", page: "OpenAI-compatible API", pkg: "glove-foundry" },
  { want: "Have a human approve risky actions before they run", href: "/foundry/docs/approvals", page: "Approvals & steering", pkg: "glove-foundry · glove-core" },
  { want: "Wake an agent on a cron, after a delay, or when a webhook arrives", href: "/foundry/docs/automation", page: "Playbooks, schedules & sleep", pkg: "glove-foundry" },
  { want: "Connect an agent to Telegram, Slack, email or a ticket system", href: "/foundry/docs/applications", page: "Apps & transmissions", pkg: "glove-foundry" },
  { want: "Add a chat agent to my existing Next.js app", href: "/docs/getting-started", page: "Quickstart", pkg: "glove-react · glove-next" },
  { want: "Run an agent in a script, CLI or backend service", href: "/docs/server-side", page: "Server-side agents", pkg: "glove-core" },
  { want: "Let tools render UI and wait for the user mid-conversation", href: "/docs/display-stack", page: "Display stack", pkg: "glove-core · glove-react" },
  { want: "Keep current state in front of the model without rewriting the prompt", href: "/docs/build/context", page: "Control what it sees", pkg: "glove-core" },
  { want: "Remember people, facts and past sessions", href: "/docs/memory", page: "Memory", pkg: "glove-memory" },
  { want: "Build an agent that pursues an objective and collects what it is missing", href: "/docs/goal-oriented-agents", page: "Goal-oriented agents", pkg: "glove-memory · glove-facts" },
  { want: "Produce PDFs, spreadsheets, slides and images as files", href: "/docs/working-environment", page: "Working environment", pkg: "glove-working-environment" },
  { want: "Replace 50 tool definitions with one code-eval tool", href: "/docs/code-execution", page: "Code execution", pkg: "glove-js · glove-python · glove-lisp" },
  { want: "Browse websites, write code and run servers in a sandbox", href: "/docs/execution", page: "Browsers & sandboxes", pkg: "glove-execution" },
  { want: "Use tools from MCP servers (Notion, Gmail, Linear…)", href: "/docs/mcp", page: "MCP", pkg: "glove-mcp" },
  { want: "Make cheap, fast typed decisions (triage, routing, filtering)", href: "/docs/classifier", page: "Classifier models", pkg: "glove-classifier" },
  { want: "Build a voice agent", href: "/docs/harnesses/voice", page: "Voice agent blueprint", pkg: "glove-voice · glove-voice-s2s · glove-realtime" },
  { want: "Generate and review images or video as a directed workflow", href: "/docs/image", page: "Image workflows", pkg: "glove-image · glove-video" },
  { want: "Have agents message and delegate to each other", href: "/docs/build/team", page: "Split the work", pkg: "glove-core · glove-mesh" },
];

export default function DocsHomePage() {
  return (
    <article className="docs-content">
      <h1>Glove documentation</h1>
      <p className="blog-lede">
        Glove is a set of TypeScript primitives for building agent harnesses: coding
        agents, personal assistants, support desks, voice agents, research tools,
        whole workforces. Glove Foundry turns harnesses into a running system.{" "}
        <a href="https://kuiper.sh">Kuiper</a> runs that system in production. Most of
        what an agent needs already exists as a primitive. These docs are organised so
        you find it before you build it.
      </p>

      <LayerStack />

      <h2 id="start">Start here</h2>
      <DocCards
        cards={[
          {
            href: "/docs/first-principles",
            kicker: "Understand",
            title: "First principles",
            desc: "The seven parts of every harness, the five a system adds and the four production needs, how they connect, and the rules Glove's primitives follow. Read this first.",
          },
          {
            href: "/docs/primitives",
            kicker: "Look it up",
            title: "Primitives map",
            desc: "Every primitive, grouped by part, with the thing people hand-build when they don't know it exists. Check here before writing infrastructure.",
          },
          {
            href: "/docs/harnesses",
            kicker: "Assemble",
            title: "Harness blueprints",
            desc: "Coding, personal, support, voice, research and multi-agent harnesses: the primitives each uses, what you write, how it deploys.",
          },
        ]}
      />

      <h2 id="build-it-up">Build it up, layer by layer</h2>
      <p>
        One agent, eight steps. Each step adds one part of a harness and shows the
        primitive for it in a few lines, so by the end you have used most of Glove and
        know where everything else goes.
      </p>
      <BuildLadder />

      <h2 id="foundry-or-core">Foundry or glove-core?</h2>
      <p>
        Both run the same loop and the same tools. The difference is how much of the
        surrounding system you want to build yourself.
      </p>
      <table>
        <thead>
          <tr><th>You need…</th><th>With glove-core you write</th><th>With Foundry you get</th></tr>
        </thead>
        <tbody>
          <tr><td>Many users, each with their own agent</td><td>Your own instance table and lookup</td><td>Persisted agent instances created from one definition</td></tr>
          <tr><td>Several threads per user</td><td>Store keys and routing</td><td>First-class conversations per instance</td></tr>
          <tr><td>An API other services can call</td><td>An HTTP server and run tracking</td><td>Typed client, REST API, OpenAI-compatible endpoints</td></tr>
          <tr><td>Work that happens later</td><td>A job queue and cron</td><td>Schedules, sleep and spawn as built-in agent tools</td></tr>
          <tr><td>Events from Slack, email or webhooks</td><td>Webhook handlers and dispatch</td><td>Transmissions, playbooks and auto-provisioned agents</td></tr>
          <tr><td>Human sign-off on risky actions</td><td>A pause/resume mechanism</td><td>Expiring approval records with approve/deny APIs</td></tr>
          <tr><td>To see what happened</td><td>Logging</td><td>A run inspector and WebChat at localhost:4141</td></tr>
          <tr><td>Somewhere to run it</td><td>A Dockerfile, a server and a volume</td><td><Link href="/foundry/docs/kuiper">Kuiper</Link> deploys the folder as it is</td></tr>
          <tr><td>A UI that renders inside the chat</td><td colSpan={2}>Both: the <Link href="/docs/display-stack">display stack</Link> is part of glove-core</td></tr>
        </tbody>
      </table>
      <p>
        Rule of thumb: if the agent <em>is</em> the product backend, start with{" "}
        <Link href="/foundry/docs/tutorial">Foundry</Link>. If the agent is one feature
        inside an app you already run, start with the{" "}
        <Link href="/docs/getting-started">quickstart</Link>. Tools move from one to the
        other unchanged.
      </p>

      <h2 id="i-want-to">I want to…</h2>
      <table>
        <thead><tr><th>Goal</th><th>Read</th><th>Package</th></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.want}>
              <td>{task.want}</td>
              <td><Link href={task.href}>{task.page}</Link></td>
              <td><code>{task.pkg}</code></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="learn-by-example">Learn by example</h2>
      <DocCards
        cards={[
          { href: "/docs/showcase", kicker: "Showcase", title: "Complete applications", desc: "Travel planner, coding agent, voice coffee shop, a browser-and-sandbox operator, a brand workforce and more, read end to end." },
          { href: "/foundry/docs/browser-and-sandbox", kicker: "Foundry example", title: "Operator", desc: "A Foundry agent that browses, writes code and keeps a server running in a persistent container." },
          { href: "/docs/image/gallery", kicker: "Gallery", title: "Image & video galleries", desc: "Real generated work with the prompts, pipeline traces and spend behind every frame." },
        ]}
      />

      <h2 id="for-coding-agents">For LLMs and coding agents</h2>
      <p>
        Point your coding agent at these before it writes Glove code. They lead with
        the same parts and primitives as these pages, so the agent reaches for what
        exists instead of rebuilding it.
      </p>
      <ul>
        <li><a href="/llms.txt"><code>/llms.txt</code></a>: the mental model, the primitives map and an index of every page.</li>
        <li><a href="/llms-full.txt"><code>/llms-full.txt</code></a>: the condensed Glove reference in one file.</li>
        <li><a href="/foundry/llms-full.txt"><code>/foundry/llms-full.txt</code></a>: the complete Foundry reference: conventions, APIs, endpoints and built-in tools.</li>
        <li><Link href="/docs/agent-skill">Agent skills</Link>: drop-in skills for Glove, Foundry and deploying on Kuiper.</li>
        <li><a href="https://kuiper.sh/llms.txt"><code>kuiper.sh/llms.txt</code></a>: everything Kuiper does, for deploying what you build.</li>
      </ul>
    </article>
  );
}
