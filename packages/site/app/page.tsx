import { GloveLogo } from "@/components/glove-logo";
import { CodeBlock } from "@/components/code-block";
import { CopyButton } from "@/components/copy-button";
import { RevealOnScroll } from "@/components/reveal";
import {
  CardBloom,
  ClosingGrain,
  FoundryDither,
  HeroGrain,
} from "@/components/landing-shaders";
import type { CSSProperties, ReactNode } from "react";
import { partsOf } from "@/lib/primitives";
import "./landing.css";

/* ── Capability icons — minimal 24px line glyphs ───────────────────── */
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const icons: Record<string, ReactNode> = {
  foundry: (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="8.5" y="14" width="7" height="6.5" rx="1.5" />
      <path d="M7 10.5v1.7h10v-1.7M12 12.2V14" opacity=".65" />
    </svg>
  ),
  instances: (
    <svg {...iconProps}>
      <rect x="3.5" y="5" width="12" height="14" rx="2" />
      <path d="M8.5 5V3.5h12v14H15.5" opacity=".6" />
      <path d="M7 9h5M7 13h5" />
    </svg>
  ),
  observe: (
    <svg {...iconProps}>
      <path d="M4 7h4l2.2 5 3.2-8 2.2 6H20" />
      <path d="M4 16.5h16" opacity=".55" />
      <circle cx="16" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  display: (
    <svg {...iconProps}>
      <rect x="4" y="3.5" width="16" height="5" rx="1.5" />
      <rect x="4" y="10.5" width="16" height="5" rx="1.5" />
      <rect x="4" y="17.5" width="10" height="3" rx="1.5" />
    </svg>
  ),
  voice: (
    <svg {...iconProps}>
      <path d="M4 10v4M8 6.5v11M12 3v18M16 7v10M20 10v4" />
    </svg>
  ),
  image: (
    <svg {...iconProps}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="10" r="1.7" />
      <path d="M21 16.2 16 10.5l-6 6.5" />
    </svg>
  ),
  gallery: (
    <svg {...iconProps}>
      <rect x="3" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="3" y="13" width="7.5" height="7.5" rx="1.4" />
      <rect x="13.5" y="13" width="7.5" height="7.5" rx="1.4" />
    </svg>
  ),
  video: (
    <svg {...iconProps}>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 10 4-2.5v9L17 14" />
      <path d="M7 9.5h5M7 13h3.5" opacity=".65" />
    </svg>
  ),
  play: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5.5 3.5-5.5 3.5z" />
    </svg>
  ),
  memory: (
    <svg {...iconProps}>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="17.5" cy="6" r="2.2" />
      <circle cx="7" cy="17.5" r="2.2" />
      <circle cx="17.5" cy="17.5" r="2.2" />
      <path d="M8.1 8.2 15.4 6.6M7 9.6 7 15.3M9.1 17.5h6.2M17.5 8.2v7.1" opacity=".55" />
    </svg>
  ),
  scratchpad: (
    <svg {...iconProps}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5v10M3.5 14.5h17" opacity=".7" />
    </svg>
  ),
  inbox: (
    <svg {...iconProps}>
      <path d="M4 13l2.4-7A2 2 0 0 1 8.3 4.5h7.4a2 2 0 0 1 1.9 1.5L20 13" />
      <path d="M4 13h4.2l1 2h5.6l1-2H20v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  ),
  mesh: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="5" cy="6" r="1.9" />
      <circle cx="19" cy="6" r="1.9" />
      <circle cx="12" cy="20" r="1.9" />
      <path d="M10.4 10.6 6.3 7.3M13.6 10.6l3.9-3.1M12 14.4v3.7" opacity=".55" />
    </svg>
  ),
  continuum: (
    <svg {...iconProps}>
      <path d="M3 12h3.5l2-5.5 3.2 11 2.2-6.5H21" />
    </svg>
  ),
  extensions: (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7.5 10 10 12.2 7.5 14.4M12.5 14.5h4" />
    </svg>
  ),
  mcp: (
    <svg {...iconProps}>
      <path d="M9 3v3.5M15 3v3.5" />
      <rect x="7" y="6.5" width="10" height="6" rx="2" />
      <path d="M12 12.5v4a3 3 0 0 1-3 3H7.5" />
    </svg>
  ),
  avatar: (
    <svg {...iconProps}>
      <circle cx="12" cy="9.5" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M2.8 7.5v-2a2 2 0 0 1 2-2h2M21.2 7.5v-2a2 2 0 0 0-2-2h-2" opacity=".6" />
    </svg>
  ),
  browser: (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8.5h18M6.5 6.3h.01M9.5 6.3h.01" opacity=".65" />
      <path d="m10 11 6 3-2.5 1-1 2.5z" />
    </svg>
  ),
  daemon: (
    <svg {...iconProps}>
      <rect x="4" y="3" width="16" height="7" rx="2" />
      <rect x="4" y="14" width="16" height="7" rx="2" />
      <path d="M8 6.5h.01M8 17.5h.01M12 6.5h4M12 17.5h4M12 10v4" />
    </svg>
  ),
  sandbox: (
    <svg {...iconProps}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.6 2h8.2a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M7.5 12.5l2 1.8-2 1.8M12 16.1h4" opacity=".7" />
    </svg>
  ),
  code: (
    <svg {...iconProps}>
      <path d="M8.5 8 4 12l4.5 4M15.5 8 20 12l-4.5 4M13.5 5l-3 14" />
    </svg>
  ),
  shield: (
    <svg {...iconProps}>
      <path d="M12 3.2 19 6v5.4c0 4.2-2.8 7.6-7 9.4-4.2-1.8-7-5.2-7-9.4V6z" />
      <path d="M9.3 12.2l1.9 1.9 3.6-3.7" opacity=".75" />
    </svg>
  ),
  classifier: (
    <svg {...iconProps}>
      <path d="M4 5h16l-6 7v6.5l-4 1.5V12z" />
      <path d="M17.5 16.5l1.5 1.5 2.5-3" opacity=".75" />
    </svg>
  ),
  ship: (
    <svg {...iconProps}>
      <path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" opacity=".65" />
    </svg>
  ),
};

/* ── Content ───────────────────────────────────────────────────────── */

type Path = {
  label: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  hue: string;
  code: string;
};

const paths: Path[] = [
  {
    label: "Run agents as a service",
    title: "Glove Foundry",
    desc: "One TypeScript file per agent. Foundry adds persisted instances and conversations, an HTTP and OpenAI-compatible API, schedules, webhooks, approvals and an inspector.",
    href: "/foundry/docs/getting-started",
    cta: "Start with Foundry",
    hue: "#2f6b55",
    code: "npx glove-foundry init",
  },
  {
    label: "Put an agent in your app",
    title: "glove-core",
    desc: "The agent loop, any model, Zod-validated tools and a display stack that renders React UI mid-conversation, in your Next.js or Node app.",
    href: "/docs/getting-started",
    cta: "Quickstart",
    hue: "#5c4a2a",
    code: "pnpm add glove-core glove-react",
  },
  {
    label: "Add one capability",
    title: "A single package",
    desc: "Memory, voice, browsers, sandboxes, MCP, image and video workflows. Each package mounts onto an agent you already have.",
    href: "/docs/packages",
    cta: "Browse packages",
    hue: "#3b3566",
    code: "pnpm add glove-memory",
  },
];

type Link = { name: string; href: string; badge?: "new" | "beta" };
type Group = {
  name: string;
  line: string;
  icon: keyof typeof icons;
  tint: string;
  links: Link[];
};

const groups: Group[] = [
  {
    name: "Foundry",
    line: "Agent systems as a running service",
    icon: "foundry",
    tint: "var(--accent)",
    links: [
      { name: "Instances & conversations", href: "/foundry/docs/definitions-and-instances" },
      { name: "OpenAI-compatible API", href: "/foundry/docs/openai-compatible" },
      { name: "Schedules, sleep & webhooks", href: "/foundry/docs/automation" },
      { name: "Approvals & steering", href: "/foundry/docs/approvals" },
      { name: "Inspector & WebChat", href: "/foundry/docs/observability" },
    ],
  },
  {
    name: "Browsers & sandboxes",
    line: "Browse, build and run",
    icon: "browser",
    tint: "var(--accent)",
    links: [
      { name: "Browser use", href: "/docs/execution#workflow" },
      { name: "Sandboxes", href: "/docs/execution#mount" },
      { name: "Managed execution", href: "/docs/execution#foundry" },
    ],
  },
  {
    name: "Interfaces",
    line: "How people reach the agent",
    icon: "display",
    tint: "var(--c-interface)",
    links: [
      { name: "Display stack", href: "/docs/display-stack" },
      { name: "Voice pipeline", href: "/docs/voice" },
      { name: "Realtime voice & avatars", href: "/docs/realtime-voice" },
      { name: "Voice architectures", href: "/docs/voice-architectures", badge: "new" },
    ],
  },
  {
    name: "Memory & state",
    line: "What it knows and carries forward",
    icon: "memory",
    tint: "var(--c-state)",
    links: [
      { name: "Memory", href: "/docs/memory" },
      { name: "Goals, forms & facts", href: "/docs/goal-oriented-agents", badge: "new" },
      { name: "Scratchpad", href: "/docs/scratchpad" },
      { name: "Inbox", href: "/docs/inbox" },
    ],
  },
  {
    name: "Compute",
    line: "Somewhere to do the work",
    icon: "code",
    tint: "var(--c-deploy)",
    links: [
      { name: "Working environment", href: "/docs/working-environment" },
      { name: "Code execution", href: "/docs/code-execution" },
      { name: "Classifier models", href: "/docs/classifier" },
      { name: "Egress control", href: "/docs/egress", badge: "beta" },
    ],
  },
  {
    name: "Generative media",
    line: "Images and video you can inspect",
    icon: "image",
    tint: "var(--c-media)",
    links: [
      { name: "Image workflows", href: "/docs/image" },
      { name: "Image gallery", href: "/docs/image/gallery" },
      { name: "Video workflows", href: "/docs/video" },
      { name: "Video gallery", href: "/docs/video/gallery" },
    ],
  },
  {
    name: "Coordination",
    line: "Agents working together",
    icon: "mesh",
    tint: "var(--c-network)",
    links: [
      { name: "Mesh", href: "/docs/mesh" },
      { name: "Continuum", href: "/docs/continuum", badge: "beta" },
    ],
  },
  {
    name: "Extend & integrate",
    line: "Shape it, connect it",
    icon: "extensions",
    tint: "var(--c-network)",
    links: [
      { name: "Hooks, skills & subagents", href: "/docs/extensions" },
      { name: "MCP servers", href: "/docs/mcp" },
    ],
  },
];

// The parts every harness is made of, from lib/primitives.ts, plus the two
// layers above the harness.
const layers = [
  ...partsOf("harness").map((part) => ({ name: part.name, desc: part.question, href: `/docs/primitives#${part.id}` })),
  { name: "System", desc: "Identity, time, arrival, oversight, access: Glove Foundry.", href: "/docs/primitives#layer-system" },
  { name: "Production", desc: "Run, keep, reach, watch: Kuiper.", href: "/docs/primitives#layer-production" },
];

const usedBy: {
  name: string;
  href: string;
  icon: string;
  tile?: string;
  pad?: boolean;
}[] = [
  { name: "Proxima", href: "https://proximadroids.com", icon: "/brand/proxima-icon.svg" },
  {
    name: "Origin",
    href: "https://www.origin-industries.systems/",
    icon: "/brand/origin-icon.png",
    tile: "#FBF8F1",
    pad: true,
  },
];

const arrow = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/* ── Page ──────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="lp">
      {/* Hero */}
      <section className="lp-hero" aria-labelledby="lp-hero-title">
        <div className="lp-hero-canvas">
          <HeroGrain />
          <div className="lp-hero-scrim" />
        </div>
        <div className="lp-hero-inner">
          <a className="lp-announce" href="/docs/v4">
            <span className="lp-announce-tag">v4</span>
            <span>Live context, Foundry &amp; new guides</span>
            {arrow}
          </a>
          <GloveLogo className="lp-hero-logo" />
          <h1 id="lp-hero-title">
            Agents that <em>do the work.</em>
          </h1>
          <p className="lp-hero-sub">
            Glove is the open-source TypeScript stack for building agent
            harnesses: coding agents, personal assistants, support desks, voice
            agents. A primitive for every part of a harness, Foundry to run them
            as a system, and Kuiper to put that system in production.
          </p>
          <div className="lp-hero-actions">
            <a href="/foundry/docs/getting-started" className="btn-primary">
              Start building {arrow}
            </a>
            <a href="/docs" className="btn-secondary">
              Read the docs
            </a>
          </div>
          <div className="lp-install">
            <span className="lp-install-prompt" aria-hidden="true">$</span>
            <code>npx glove-foundry init</code>
            <CopyButton text="npx glove-foundry init" />
          </div>
        </div>
      </section>

      {/* Used by */}
      <section className="lp-usedby" aria-label="Used in production by">
        <span>Used in production by</span>
        {usedBy.map((c) => (
          <a key={c.name} href={c.href} target="_blank" rel="noopener noreferrer">
            <span className="lp-usedby-badge" style={c.tile ? { background: c.tile } : undefined}>
              <img src={c.icon} alt="" width={28} height={28} className={c.pad ? "pad" : undefined} />
            </span>
            {c.name}
          </a>
        ))}
      </section>

      {/* Paths */}
      <section className="lp-section" aria-labelledby="lp-paths-title">
        <h2 id="lp-paths-title" className="lp-title">
          Three ways in.
        </h2>
        <p className="lp-lede">
          Every package works on its own. Start where your project is.
        </p>
        <div className="lp-paths">
          {paths.map((path) => (
            <a key={path.title} href={path.href} className="lp-path">
              <CardBloom hue={path.hue} />
              <div className="lp-path-body">
                <span className="lp-path-label">{path.label}</span>
                <h3>{path.title}</h3>
                <p>{path.desc}</p>
                <code className="lp-path-code">{path.code}</code>
                <span className="lp-path-cta">
                  {path.cta} {arrow}
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Foundry */}
      <section className="lp-section" aria-labelledby="lp-foundry-title">
        <div className="lp-foundry">
          <FoundryDither />
          <div className="lp-foundry-scrim" />
          <div className="lp-foundry-copy">
            <span className="lp-kicker">Glove Foundry</span>
            <h2 id="lp-foundry-title">Define it in code. Run it as data.</h2>
            <p>
              A definition says what an agent can be. Each instance stores what
              one live agent has: its context, installed apps and schedules.
              Foundry assembles the right model, tools and memory for every
              message, and shows you how the work happened.
            </p>
            <div className="lp-foundry-actions">
              <a href="/foundry/docs/tutorial" className="btn-primary">
                Build your first agent system {arrow}
              </a>
              <a href="/foundry" className="btn-secondary">
                What you get
              </a>
            </div>
          </div>
          <ol className="lp-flow" aria-label="How Foundry runs an agent">
            <li>
              <span>Code</span>
              <strong>agents/support/agent.ts</strong>
              <i>a file-routed definition</i>
            </li>
            <li>
              <span>Data</span>
              <strong>support-acme</strong>
              <i>an instance with its own installs</i>
            </li>
            <li>
              <span>Run</span>
              <strong>POST /v1/chat/completions</strong>
              <i>assembled per message, traced</i>
            </li>
          </ol>
        </div>
      </section>

      {/* Capabilities */}
      <section className="lp-section" id="platform" aria-labelledby="lp-caps-title">
        <h2 id="lp-caps-title" className="lp-title">
          Everything an agent needs to finish the job.
        </h2>
        <p className="lp-lede">
          Interfaces, memory, compute, media and coordination, as packages that
          mount onto the same runtime.
        </p>
        <RevealOnScroll>
          <div className="lp-groups">
            {groups.map((group) => (
              <div
                key={group.name}
                className="lp-group"
                style={{ ["--tint" as string]: group.tint } as CSSProperties}
              >
                <div className="lp-group-head">
                  <span className="lp-group-icon">{icons[group.icon]}</span>
                  <div>
                    <h3>{group.name}</h3>
                    <p>{group.line}</p>
                  </div>
                </div>
                <ul>
                  {group.links.map((link) => (
                    <li key={link.name}>
                      <a href={link.href}>
                        {link.name}
                        {link.badge && <span className={`docs-badge ${link.badge}`}>{link.badge}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </RevealOnScroll>
      </section>

      {/* Code */}
      <section className="lp-section" aria-labelledby="lp-code-title">
        <div className="lp-code">
          <div className="lp-code-copy">
            <span className="lp-kicker">In your app</span>
            <h2 id="lp-code-title" className="lp-title">
              A model, a tool, and you&apos;re running.
            </h2>
            <p className="lp-lede">
              Tools are Zod-validated functions. They can render UI in the
              middle of a conversation and wait for the person to answer.
            </p>
            <ul className="lp-points">
              <li>
                <strong>Any model.</strong> Anthropic, OpenAI, Gemini,
                OpenRouter, Bedrock, Vercel AI Gateway, Ollama.
              </li>
              <li>
                <strong>Any store.</strong> A small adapter interface over
                whatever you already run.
              </li>
              <li>
                <strong>Tools that render.</strong> <code>pushAndForget</code>{" "}
                shows UI; <code>pushAndWait</code> pauses until it&apos;s answered.
              </li>
            </ul>
          </div>
          <CodeBlock
            filename="agent.ts"
            language="typescript"
            code={`import { Glove, Displaymanager, createAdapter } from "glove-core";
import { z } from "zod";

const agent = new Glove({
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You help people find running shoes.",
  compaction_config: { compaction_instructions: "Keep the shopper's preferences." },
})
  .fold({
    name: "search_products",
    description: "Search the product catalog",
    inputSchema: z.object({ query: z.string() }),
    async do(input, display) {
      const hits = await catalog.search(input.query);
      await display.pushAndForget({ renderer: "product_grid", input: hits });
      return { status: "success", data: hits };
    },
  })
  .build();

await agent.processRequest("Running shoes under $100");`}
          />
        </div>
      </section>

      {/* Under the hood */}
      <section className="lp-section" aria-labelledby="lp-arch-title">
        <h2 id="lp-arch-title" className="lp-title">
          Every harness is the same seven parts.
        </h2>
        <p className="lp-lede">
          A coding agent and a support desk differ in shape, not in parts. Glove
          has a primitive for each part, so you assemble a harness instead of
          rebuilding one. Foundry and Kuiper add the two layers above it.
        </p>
        <RevealOnScroll>
          <ol className="lp-layers">
            {layers.map((layer, index) => (
              <li key={layer.name}>
                <span className="lp-layer-n">{String(index + 1).padStart(2, "0")}</span>
                <strong><a href={layer.href}>{layer.name}</a></strong>
                <p>{layer.desc}</p>
              </li>
            ))}
          </ol>
        </RevealOnScroll>
        <a href="/docs/first-principles" className="lp-more">
          First principles: how the parts fit together {arrow}
        </a>
      </section>

      {/* Closing */}
      <section className="lp-section">
        <div className="lp-closing">
          <ClosingGrain />
          <div className="lp-closing-scrim" />
          <div className="lp-closing-body">
            <h2>Build something that works while you don&apos;t.</h2>
            <p>Open source, MIT licensed, ready to build on.</p>
            <div className="lp-hero-actions">
              <a href="https://github.com/porkytheblack/glove" target="_blank" rel="noopener noreferrer" className="btn-primary">
                Star on GitHub
              </a>
              <a href="/docs" className="btn-secondary">
                Read the docs
              </a>
            </div>
          </div>
        </div>
        <div className="lp-grant">
          <a href="https://elevenlabs.io/startup-grants" target="_blank" rel="noopener noreferrer">
            <img
              src="https://eleven-public-cdn.elevenlabs.io/payloadcms/cy7rxce8uki-IIElevenLabsGrants%201.webp"
              alt="ElevenLabs Startup Grant"
              width={200}
              height={45}
            />
          </a>
        </div>
      </section>
    </main>
  );
}
