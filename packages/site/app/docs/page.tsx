import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { DocCards } from "@/components/doc-cards";

export const metadata = {
  title: "Documentation",
  description:
    "Start here: choose between Glove Foundry for complete agent systems, glove-core for an agent inside your own app, or a single capability package.",
};

const tasks: { want: string; href: string; page: string; pkg: string }[] = [
  { want: "Run many durable agents with an HTTP API, a dashboard and schedules", href: "/foundry/docs/tutorial", page: "Foundry tutorial", pkg: "glove-foundry" },
  { want: "Talk to my agent from any OpenAI SDK or chat UI", href: "/foundry/docs/openai-compatible", page: "OpenAI-compatible API", pkg: "glove-foundry" },
  { want: "Have a human approve risky actions before they run", href: "/foundry/docs/approvals", page: "Approvals & steering", pkg: "glove-foundry · glove-core" },
  { want: "Wake an agent on a cron, after a delay, or when a webhook arrives", href: "/foundry/docs/automation", page: "Playbooks, schedules & sleep", pkg: "glove-foundry" },
  { want: "Connect an agent to Telegram, Slack, email or a ticket system", href: "/foundry/docs/applications", page: "Apps & transmissions", pkg: "glove-foundry" },
  { want: "Add a chat agent to my existing Next.js app", href: "/docs/getting-started", page: "Quickstart", pkg: "glove-react · glove-next" },
  { want: "Run an agent in a script, CLI or backend service", href: "/docs/server-side", page: "Server-side agents", pkg: "glove-core" },
  { want: "Let tools render UI and wait for the user mid-conversation", href: "/docs/display-stack", page: "Display stack", pkg: "glove-core · glove-react" },
  { want: "Remember people, facts and past sessions", href: "/docs/memory", page: "Memory", pkg: "glove-memory" },
  { want: "Collect structured information over a conversation", href: "/docs/forms", page: "Forms", pkg: "glove-memory" },
  { want: "Produce PDFs, spreadsheets, slides and images as files", href: "/docs/working-environment", page: "Working environment", pkg: "glove-working-environment" },
  { want: "Replace 50 tool definitions with one code-eval tool", href: "/docs/code-execution", page: "Code execution", pkg: "glove-js · glove-python · glove-lisp" },
  { want: "Browse websites, write code and run servers in a sandbox", href: "/docs/execution", page: "Browsers & sandboxes", pkg: "glove-execution" },
  { want: "Use tools from MCP servers (Notion, Gmail, Linear…)", href: "/docs/mcp", page: "MCP", pkg: "glove-mcp" },
  { want: "Make cheap, fast typed decisions (triage, routing, filtering)", href: "/docs/classifier", page: "Classifier models", pkg: "glove-classifier" },
  { want: "Build a voice agent (STT → agent → TTS)", href: "/docs/voice", page: "Voice pipeline", pkg: "glove-voice" },
  { want: "Use realtime speech-to-speech models or a live avatar", href: "/docs/realtime-voice", page: "Realtime voice & avatars", pkg: "glove-voice-s2s" },
  { want: "Generate and review images or video as a directed workflow", href: "/docs/image", page: "Image workflows", pkg: "glove-image · glove-video" },
  { want: "Have agents message and delegate to each other", href: "/docs/mesh", page: "Mesh", pkg: "glove-mesh" },
];

export default function DocsHomePage() {
  return (
    <article className="docs-content">
      <h1>Glove documentation</h1>
      <p className="blog-lede">
        Glove is a family of TypeScript packages for building software that an
        AI agent operates. Pick the layer that matches what you are building —
        you can always move up a layer later without rewriting your tools.
      </p>

      <h2 id="choose-a-path">Choose a path</h2>
      <DocCards
        cards={[
          {
            href: "/foundry/docs",
            kicker: "Complete agent systems",
            title: "Glove Foundry",
            desc: "A framework and runtime: file-routed agents, persisted instances and conversations, a run queue, a typed client, an OpenAI-compatible API, schedules, inbound integrations, approvals, and a built-in inspector and chat UI.",
            packages: ["glove-foundry"],
          },
          {
            href: "/docs/getting-started",
            kicker: "An agent inside your app",
            title: "The Glove runtime",
            desc: "The agent loop as a library. You own the server, storage and UI; Glove gives you tools, a display stack that renders React mid-conversation, model adapters and context compaction.",
            packages: ["glove-core", "glove-react", "glove-next"],
          },
          {
            href: "/docs/packages",
            kicker: "One capability",
            title: "Individual packages",
            desc: "Memory, voice, MCP, sandboxes, REPLs, image and video, classifiers and mesh each work on their own and mount onto any Glove agent — inside Foundry or not.",
            packages: ["glove-memory", "glove-mcp", "glove-voice", "…"],
          },
        ]}
      />

      <h2 id="foundry-or-core">Foundry or glove-core?</h2>
      <p>
        Both run the same agent loop and the same tools. The difference is how much
        of the surrounding system you want to build yourself.
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
          <tr><td>A UI that renders inside the chat</td><td colSpan={2}>Both: the <Link href="/docs/display-stack">display stack</Link> is part of glove-core</td></tr>
        </tbody>
      </table>
      <p>
        Rule of thumb: if the agent <em>is</em> the product backend, start with{" "}
        <Link href="/foundry/docs/tutorial">Foundry</Link>. If the agent is one feature
        inside an app you already run, start with the{" "}
        <Link href="/docs/getting-started">quickstart</Link>.
      </p>

      <h2 id="how-it-stacks">How the layers stack</h2>
      <CodeBlock
        filename="the Glove stack"
        language="text"
        code={`your product          UI · auth · billing · your data
──────────────────────────────────────────────────────────────────────
glove-foundry         file routes · instances · conversations · apps
                      playbooks · schedules · approvals · HTTP + OpenAI API
                      inspector · WebChat · persistence adapters
──────────────────────────────────────────────────────────────────────
capability packages   memory · forms · goals · facts · working environment
                      JS/Python/Lisp REPLs · browsers & sandboxes · MCP
                      voice · realtime voice · image · video · mesh · classifiers
──────────────────────────────────────────────────────────────────────
glove-core            agent loop · tools · display stack · stores
                      model adapters (Anthropic, OpenAI, Gemini, OpenRouter…)`}
      />

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
          { href: "/docs/showcase", kicker: "Showcase", title: "Complete applications", desc: "Travel planner, coding agent, voice coffee shop, a browser-and-sandbox operator, a brand workforce and more — read end to end." },
          { href: "/foundry/docs/browser-and-sandbox", kicker: "Foundry example", title: "Operator", desc: "A Foundry agent that browses, writes code and keeps a server running in a persistent container." },
          { href: "/docs/image/gallery", kicker: "Gallery", title: "Image & video galleries", desc: "Real generated work with the prompts, pipeline traces and spend behind every frame." },
        ]}
      />

      <h2 id="for-coding-agents">For LLMs and coding agents</h2>
      <p>
        Every page here is also available in machine-readable form. Point your coding
        agent at these before it writes Glove code.
      </p>
      <ul>
        <li><a href="/llms.txt"><code>/llms.txt</code></a> — an index of every page with one-line summaries.</li>
        <li><a href="/llms-full.txt"><code>/llms-full.txt</code></a> — the condensed Glove reference in one file.</li>
        <li><a href="/foundry/llms-full.txt"><code>/foundry/llms-full.txt</code></a> — the complete Foundry reference: conventions, APIs, endpoints and built-in tools.</li>
        <li><Link href="/docs/agent-skill">Agent skills</Link> — drop-in Claude Code skills for Glove and Foundry.</li>
      </ul>
    </article>
  );
}
