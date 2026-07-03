import { RevealOnScroll } from "@/components/reveal";
import { GloveLogo } from "@/components/glove-logo";
import type { CSSProperties, ReactNode } from "react";

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
};

type Cap = {
  icon: keyof typeof icons;
  kicker: string;
  name: string;
  href: string;
  badge?: "beta" | "new";
  desc: ReactNode;
  meta?: string;
};

type CapGroup = {
  cat: string;
  name: string;
  line: string;
  caps: Cap[];
};

const capabilityGroups: CapGroup[] = [
  {
    cat: "var(--c-interface)",
    name: "Interfaces",
    line: "How people interact with the agent",
    caps: [
      {
        icon: "display",
        kicker: "Rendered UI",
        name: "Display Stack",
        href: "/docs/display-stack",
        desc: (
          <>
            Tools push React components onto a stack — product grids, forms,
            confirmations — rendered inline, mid-conversation. Pause for input
            with <code>pushAndWait</code> or stream results with{" "}
            <code>pushAndForget</code>.
          </>
        ),
      },
      {
        icon: "voice",
        kicker: "Full-duplex speech",
        name: "Voice",
        href: "/docs/voice",
        desc: (
          <>
            A complete voice pipeline — STT → agent → TTS — with barge-in,
            push-to-talk, and narration. Every tool and display slot keeps
            working, spoken instead of typed.
          </>
        ),
      },
    ],
  },
  {
    cat: "var(--c-state)",
    name: "Memory & State",
    line: "What the agent knows and carries forward",
    caps: [
      {
        icon: "memory",
        kicker: "Long-term recall",
        name: "Memory",
        href: "/docs/memory",
        desc: (
          <>
            Four sibling subsystems — an entity graph, an episodic timeline, a
            resource filesystem, and ambient context — each an independent,
            bring-your-own-storage adapter with its own tool surface.
          </>
        ),
      },
      {
        icon: "scratchpad",
        kicker: "Tools as SQL",
        name: "Scratchpad",
        href: "/docs/scratchpad",
        desc: (
          <>
            Expose capabilities as a relational database. The model discovers,
            invokes, and composes tools by writing SQL through a single{" "}
            <code>execute_sql</code> tool — with transactions as a real dry-run.
          </>
        ),
        meta: "Benchmarked — up to 35× less context, higher accuracy",
      },
      {
        icon: "inbox",
        kicker: "Async mailbox",
        name: "Inbox",
        href: "/docs/inbox",
        desc: (
          <>
            A persistent mailbox for what can&apos;t resolve now. The agent
            posts a request; a webhook, cron, or human resolves it later — and
            it&apos;s injected on the next turn, across restarts.
          </>
        ),
      },
    ],
  },
  {
    cat: "var(--c-network)",
    name: "Coordination",
    line: "How agents work together",
    caps: [
      {
        icon: "mesh",
        kicker: "Multi-agent",
        name: "Mesh",
        href: "/docs/mesh",
        desc: (
          <>
            Agents message each other — direct, broadcast, acknowledge — over a
            pluggable transport, riding the same inbox primitive. A planner and
            its workers, or a swarm of specialists.
          </>
        ),
      },
      {
        icon: "continuum",
        kicker: "Subprocess runtime",
        name: "Continuum",
        href: "/docs/continuum",
        badge: "beta",
        desc: (
          <>
            Supervise agents as subprocesses. Triggered agents wake cold per
            event and resume a persistent store; concurrent agents stay warm and
            are notified inline.
          </>
        ),
      },
    ],
  },
  {
    cat: "var(--c-deploy)",
    name: "Extend & Integrate",
    line: "Shape the agent, reach the world",
    caps: [
      {
        icon: "extensions",
        kicker: "Hooks · Skills · Subagents",
        name: "Extensions",
        href: "/docs/extensions",
        desc: (
          <>
            Hooks mutate agent state before a turn, skills inject context, and
            subagents route self-contained work to isolated children — the{" "}
            <code>/command</code> and <code>@mention</code> surface.
          </>
        ),
      },
      {
        icon: "mcp",
        kicker: "Integrations",
        name: "MCP",
        href: "/docs/mcp",
        desc: (
          <>
            Bridge Model Context Protocol servers — Notion, Gmail, Linear — in as
            first-class tools. A discovery subagent finds and activates them
            mid-conversation.
          </>
        ),
      },
    ],
  },
];

export default function LandingPage() {
  return (
    <main>
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="hero">
        <a className="hero-badge" href="/docs/v3">
          <span className="dot" />
          <span>
            <strong>v3.0</strong> — memory, mesh & the scratchpad
          </span>
        </a>
        <GloveLogo className="hero-icon" />
        <h1>
          Build agents that do <strong>cool things.</strong>
        </h1>
        <p className="hero-sub">
          Glove is your open-source TypeScript toolkit for{" "}
          <strong>multi-agent orchestration systems</strong> — agents with
          tools, memory, a shared mailbox, a mesh to talk over, and a way to
          ship.
        </p>
        <div className="hero-pills">
          {[
            "Memory",
            "Inbox",
            "Mesh",
            "Scratchpad",
            "Continuum",
            "Voice",
            "MCP",
            "Subagents",
          ].map((p) => (
            <span key={p} className="hero-pill">
              {p}
            </span>
          ))}
        </div>
        <div className="hero-actions">
          <a href="/docs/getting-started" className="btn-primary">
            Get Started
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <a href="#platform" className="btn-secondary">
            Explore the platform
          </a>
        </div>
      </section>

      {/* ── Used by ─────────────────────────────────────────────── */}
      <section className="usedby" aria-label="Used in production by">
        <span className="usedby-label">Used in production by</span>
        <a
          className="usedby-logo"
          href="https://proximadroids.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src="/brand/proxima-icon.svg" alt="Proxima" width={32} height={32} />
          <span className="usedby-name">Proxima</span>
          <span className="usedby-sep" aria-hidden="true" />
          <span className="usedby-tag">Droids for your team</span>
        </a>
      </section>

      {/* ── Platform / Capabilities ─────────────────────────────── */}
      <section id="platform" className="platform">
        <svg
          className="platform-deco"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
          aria-hidden="true"
        >
          <circle cx="40" cy="40" r="3" fill="currentColor" stroke="none" />
          <circle cx="150" cy="30" r="3" fill="currentColor" stroke="none" />
          <circle cx="100" cy="90" r="3.5" fill="currentColor" stroke="none" />
          <circle cx="30" cy="140" r="3" fill="currentColor" stroke="none" />
          <circle cx="160" cy="150" r="3" fill="currentColor" stroke="none" />
          <circle cx="70" cy="175" r="2.5" fill="currentColor" stroke="none" />
          <path d="M40 40 100 90M150 30 100 90M100 90 30 140M100 90 160 150M30 140 70 175M160 150 70 175M40 40 150 30" opacity=".45" />
        </svg>
        <h2 className="section-title">
          Agents outgrew the chatbox, and <strong>need more.</strong>
        </h2>
        <p className="section-desc">
          An agent that only calls tools and prints text hits a wall fast. Glove
          gives it the rest — memory, a mailbox, peers to coordinate with, a
          schedule to run on, and external services to reach — each an
          independent piece you can adopt on its own.
        </p>

        {capabilityGroups.map((group) => (
          <RevealOnScroll key={group.name}>
            <div className="cap-group" style={{ ["--cat" as string]: group.cat } as CSSProperties}>
              <div className="cap-group-head">
                <span className="cap-group-dot" />
                <span className="cap-group-name">{group.name}</span>
                <span className="cap-group-line">{group.line}</span>
              </div>
              <div className="cap-grid">
                {group.caps.map((cap) => (
                  <a
                    key={cap.name}
                    className="cap-card"
                    href={cap.href}
                    style={{ ["--cat" as string]: group.cat } as CSSProperties}
                  >
                    <div className="cap-card-top">
                      <span className="cap-icon">{icons[cap.icon]}</span>
                      <svg
                        className="cap-arrow"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M7 17 17 7M8 7h9v9" />
                      </svg>
                    </div>
                    <div>
                      <div className="cap-kicker">{cap.kicker}</div>
                      <div className="cap-name">
                        {cap.name}
                        {cap.badge && (
                          <span className={`docs-badge ${cap.badge}`}>{cap.badge}</span>
                        )}
                      </div>
                    </div>
                    <p className="cap-desc">{cap.desc}</p>
                    {cap.meta && <div className="cap-meta">{cap.meta}</div>}
                  </a>
                ))}
              </div>
            </div>
          </RevealOnScroll>
        ))}
      </section>

      {/* ── Architecture ────────────────────────────────────────── */}
      <section id="architecture">
        <h2 className="section-title">Five components. One runtime.</h2>
        <p className="section-desc">
          Built on adapters — interfaces that decouple the runtime from specific
          implementations. Swap models, stores, or UI frameworks without
          changing application logic.
        </p>
        <RevealOnScroll>
          <div className="arch-stack">
            <div className="arch-layer">
              <span className="arch-layer-name">Agent</span>
              <span className="arch-layer-desc">
                <strong>The agentic loop.</strong> Takes a message, prompts the
                model, executes tool calls, feeds results back, repeats until
                the model responds with text.
              </span>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-name">Prompt Machine</span>
              <span className="arch-layer-desc">
                <strong>The model wrapper.</strong> Manages system prompts,
                dispatches requests, notifies subscribers. The model itself is
                swappable via the ModelAdapter interface.
              </span>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-name">Executor</span>
              <span className="arch-layer-desc">
                <strong>The tool runner.</strong> Validates inputs with Zod,
                retries with Effect, manages permissions through the tool permission
                system. Tools are registered at build time.
              </span>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-name">Observer</span>
              <span className="arch-layer-desc">
                <strong>The session watcher.</strong> Tracks turns, token
                consumption, and triggers context compaction when conversations
                get too long. Sessions run indefinitely.
              </span>
            </div>
            <div className="arch-layer">
              <span className="arch-layer-name">Display Manager</span>
              <span className="arch-layer-desc">
                <strong>The UI state machine.</strong> Manages the display
                stack — what the user sees. Framework-agnostic. This is what
                makes Glove an application runtime, not a chatbot backend.
              </span>
            </div>
          </div>
        </RevealOnScroll>
      </section>

      {/* ── Adapters ────────────────────────────────────────────── */}
      <section id="adapters">
        <h2 className="section-title">Swap anything. Change nothing.</h2>
        <p className="section-desc">
          Every layer is an interface. The runtime doesn&#39;t care what&#39;s
          behind it.
        </p>
        <RevealOnScroll>
          <div className="adapter-grid">
            <div className="adapter-card">
              <h3>ModelAdapter</h3>
              <p>
                The AI provider. Anthropic, OpenAI, local models, or mocks for
                testing. Anything that takes messages and returns responses.
              </p>
            </div>
            <div className="adapter-card">
              <h3>StoreAdapter</h3>
              <p>
                The persistence layer. Messages, tokens, turns, inbox. In-memory,
                SQLite, Postgres — wherever your state lives.
              </p>
            </div>
            <div className="adapter-card">
              <h3>DisplayManagerAdapter</h3>
              <p>
                The UI state layer. Manages the display stack.
                Framework-agnostic — React, Vue, Svelte, terminal UI. Bind
                however you want.
              </p>
            </div>
            <div className="adapter-card">
              <h3>SubscriberAdapter</h3>
              <p>
                The event bus. Logging, analytics, real-time streaming,
                debugging. Plug in whatever you need to observe.
              </p>
            </div>
          </div>
        </RevealOnScroll>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <div className="cta-section">
        <h2>
          Build something <strong>cool.</strong>
        </h2>
        <p>Glove is open source and ready to build on.</p>
        <div className="cta-actions">
          <a
            href="https://github.com/porkytheblack/glove"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            View on GitHub
          </a>
          <a href="/docs/getting-started" className="btn-secondary">
            Read the Docs
          </a>
        </div>
        <div className="grant-badge">
          <a
            href="https://elevenlabs.io/startup-grants"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://eleven-public-cdn.elevenlabs.io/payloadcms/cy7rxce8uki-IIElevenLabsGrants%201.webp"
              alt="ElevenLabs Startup Grant"
              width={250}
              height={56}
            />
          </a>
        </div>
      </div>
    </main>
  );
}
