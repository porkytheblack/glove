import { RevealOnScroll } from "@/components/reveal";
import type { CSSProperties, ReactNode } from "react";

const HAND_PATH =
  "M410.08 393.32C410.08 393.447 410.105 393.573 410.153 393.69C410.202 393.807 410.273 393.913 410.362 394.002C410.451 394.092 410.557 394.162 410.673 394.21C410.79 394.257 410.914 394.281 411.04 394.28L422.48 394.22C422.626 394.22 422.766 394.162 422.869 394.059C422.972 393.956 423.03 393.816 423.03 393.67L422.1 203.44C422.099 203.381 422.109 203.323 422.131 203.269C422.153 203.214 422.186 203.164 422.228 203.122C422.27 203.081 422.32 203.047 422.375 203.024C422.431 203.002 422.49 202.99 422.55 202.99L479.35 202.88C479.631 202.88 479.901 202.992 480.1 203.19C480.298 203.389 480.41 203.659 480.41 203.94L480.76 393.79C480.76 393.904 480.805 394.013 480.886 394.094C480.967 394.175 481.076 394.22 481.19 394.22L493.3 394.16C493.449 394.157 493.592 394.096 493.697 393.99C493.801 393.883 493.86 393.739 493.86 393.59L493.45 172.81C493.45 172.593 493.536 172.384 493.69 172.23C493.844 172.076 494.053 171.99 494.27 171.99L546.6 171.73C546.674 171.73 546.745 171.759 546.798 171.812C546.85 171.865 546.88 171.936 546.88 172.01L547.29 394C547.29 394.217 547.376 394.426 547.53 394.58C547.684 394.734 547.893 394.82 548.11 394.82L559.31 394.8C559.543 394.8 559.767 394.706 559.932 394.539C560.097 394.372 560.19 394.146 560.19 393.91L559.84 203.7C559.84 203.498 559.921 203.305 560.066 203.163C560.21 203.02 560.406 202.94 560.61 202.94L617.16 202.83C617.36 202.83 617.552 202.91 617.694 203.052C617.836 203.194 617.917 203.388 617.92 203.59L618.46 497.93C618.459 498.009 618.48 498.087 618.523 498.153C618.565 498.22 618.627 498.273 618.699 498.305C618.772 498.338 618.854 498.349 618.934 498.338C619.013 498.326 619.089 498.292 619.15 498.24L710.7 416.63C710.966 416.396 711.296 416.256 711.64 416.23C712.093 416.197 713.19 416.98 714.93 418.58C726.357 429.047 738.423 439.817 751.13 450.89C752.057 451.697 752.843 452.367 753.49 452.9C753.881 453.221 754.13 453.685 754.183 454.19C754.235 454.695 754.087 455.201 753.77 455.6C748.957 461.66 744.16 467.85 739.38 474.17C730.767 485.563 722.277 496.827 713.91 507.96C704.103 521.013 694.037 534.443 683.71 548.25C682.31 550.123 681.463 551.257 681.17 551.65C651.197 591.923 635.867 612.51 635.18 613.41C633.727 615.303 626.6 624.933 613.8 642.3C612.853 643.587 611.92 644.223 611 644.21C593.94 643.94 576.01 644.48 560.67 644.48C557.17 644.48 507.53 644.427 411.75 644.32C410.983 644.32 410.13 644.353 409.19 644.42C408.676 644.453 408.163 644.342 407.709 644.1C407.255 643.858 406.878 643.494 406.62 643.05C403.013 636.843 400.117 631.393 397.93 626.7C394.94 620.29 392.01 614.85 389 608.75C382.72 595.99 376.747 583.813 371.08 572.22C368.85 567.67 364.77 560.45 362.06 554.23C362.014 554.138 361.99 554.035 361.99 553.93L362 269.83C362 269.637 362.039 269.445 362.115 269.267C362.192 269.09 362.303 268.929 362.444 268.797C362.584 268.664 362.75 268.561 362.932 268.494C363.114 268.428 363.307 268.399 363.5 268.41C378.36 269.18 393.79 268.85 408.23 268.58C408.441 268.575 408.651 268.612 408.847 268.689C409.043 268.766 409.222 268.881 409.373 269.028C409.524 269.176 409.644 269.352 409.726 269.546C409.808 269.74 409.85 269.949 409.85 270.16L410.08 393.32Z";

const CUFF_PATH =
  "M406.91 658.31C406.91 658.22 406.946 658.133 407.01 658.07C407.073 658.006 407.16 657.97 407.25 657.97C462.983 657.857 503.02 657.817 527.36 657.85C559.72 657.9 574.5 657.57 611.92 657.12C612.178 657.117 612.435 657.166 612.674 657.263C612.913 657.36 613.131 657.504 613.315 657.686C613.499 657.869 613.646 658.085 613.746 658.325C613.846 658.564 613.899 658.82 613.9 659.08L614.06 747.46C614.06 747.776 613.946 748.08 613.738 748.318C613.53 748.555 613.243 748.709 612.93 748.75C612.257 748.837 610.613 748.88 608 748.88C574.107 748.9 508.023 748.873 409.75 748.8C407.817 748.8 406.85 747.943 406.85 746.23C406.903 718.95 406.923 689.643 406.91 658.31Z";

function GloveLogo({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={HAND_PATH} fill="currentColor" />
      <path d={CUFF_PATH} fill="currentColor" />
    </svg>
  );
}

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
  glovebox: (
    <svg {...iconProps}>
      <path d="M12 2.8 20.4 7v10L12 21.2 3.6 17V7z" />
      <path d="M3.8 7 12 11.5 20.2 7M12 11.5v9.4" opacity=".55" />
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
    line: "How agents work together and extend",
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
    ],
  },
  {
    cat: "var(--c-deploy)",
    name: "Connect & Deploy",
    line: "Reaching the outside world, and shipping",
    caps: [
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
      {
        icon: "glovebox",
        kicker: "Sandboxed service",
        name: "Glovebox",
        href: "/docs/glovebox",
        badge: "beta",
        desc: (
          <>
            Package an agent as a network-addressable service in an isolated
            container — with system tools like ffmpeg, pandoc, and Chromium
            baked in — behind one authenticated endpoint.
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
            <strong>v3.0</strong> — memory, mesh & sandboxed deploys
          </span>
        </a>
        <GloveLogo className="hero-icon" />
        <h1>
          Build entire apps as <strong>conversations.</strong>
        </h1>
        <p className="hero-sub">
          An open-source TypeScript framework for agentic apps. You define what
          your app can do — <strong>tools, UI, memory, integrations</strong> —
          and an agent orchestrates it all from plain conversation.
        </p>
        <div className="hero-pills">
          {[
            "Display Stack",
            "Memory",
            "Inbox",
            "Mesh",
            "Scratchpad",
            "Voice",
            "MCP",
            "Sandbox",
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

      {/* ── The Idea ────────────────────────────────────────────── */}
      <section id="idea">
        <p className="section-label">The idea</p>
        <h2 className="section-title">
          What if every app was a single chat interface?
        </h2>
        <p className="section-desc">
          Traditional apps encode user flows in UI — pages, routes, navigation
          hierarchies. Glove replaces that wiring with an agent. The developer
          defines capabilities. The agent does the orchestration.
        </p>
        <div className="key-terms">
          <div className="key-term">
            <span className="key-term-label">Agent</span>
            <span className="key-term-def">An AI that reads what users ask for and decides which of your app&apos;s capabilities to use.</span>
          </div>
          <div className="key-term">
            <span className="key-term-label">Tool</span>
            <span className="key-term-def">A capability — a function the agent can call. Search a database, call an API, compute a result.</span>
          </div>
          <div className="key-term">
            <span className="key-term-label">Renderer</span>
            <span className="key-term-def">A React component that shows the result. Product grids, forms, confirmation dialogs.</span>
          </div>
        </div>
        <div className="idea-grid">
          <RevealOnScroll>
            <div className="idea-block">
              <h3>
                <span className="num">01</span> Tools are the backend
              </h3>
              <p>
                Every action your app can take — search, checkout, track an
                order — is a tool. The agent decides when to call them based on
                what the user asks for.
              </p>
            </div>
          </RevealOnScroll>
          <RevealOnScroll>
            <div className="idea-block">
              <h3>
                <span className="num">02</span> Renderers are the UI
              </h3>
              <p>
                Product grids, forms, confirmation dialogs — they&#39;re all
                renderers on a display stack. Tools push them. The agent
                orchestrates which ones appear and when.
              </p>
            </div>
          </RevealOnScroll>
          <RevealOnScroll>
            <div className="idea-block">
              <h3>
                <span className="num">03</span> The conversation is navigation
              </h3>
              <p>
                No routes, no page transitions, no navigation state machines.
                The user says what they want. The agent figures out the path to
                get there.
              </p>
            </div>
          </RevealOnScroll>
          <RevealOnScroll>
            <div className="idea-block">
              <h3>
                <span className="num">04</span> Human-in-the-loop is native
              </h3>
              <p>
                Tools can pause and wait for user input. Permission requests,
                form submissions, confirmations — all first-class primitives,
                not afterthoughts.
              </p>
            </div>
          </RevealOnScroll>
        </div>
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
        <p className="section-label">The platform</p>
        <h2 className="section-title">
          It stopped being just a chat box. It&apos;s a{" "}
          <strong>runtime.</strong>
        </h2>
        <p className="section-desc">
          Rendering UI is one thing Glove does. The agent also remembers, keeps
          a mailbox, talks to peers, runs on a schedule, reaches external
          services, and ships as a sandboxed box — each an independent piece you
          can adopt on its own.
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
                  </a>
                ))}
              </div>
            </div>
          </RevealOnScroll>
        ))}
      </section>

      {/* ── Architecture ────────────────────────────────────────── */}
      <section id="architecture">
        <p className="section-label">Architecture</p>
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

      {/* ── Display Stack ───────────────────────────────────────── */}
      <section id="display-stack">
        <p className="section-label">The display stack</p>
        <h2 className="section-title">See it in action.</h2>
        <p className="section-desc">
          A user asks to buy running shoes. Here&#39;s what happens inside the
          runtime — step by step.
        </p>
        <RevealOnScroll>
          <div className="stack-flow">
            {/* Step 1 */}
            <div className="stack-step">
              <div className="step-num">1</div>
              <div className="step-content">
                <h4>User sends a message</h4>
                <p>
                  &ldquo;Find me running shoes under 100 bucks&rdquo;
                </p>
                <p style={{ marginTop: "0.5rem" }}>
                  The agent interprets the intent and calls the{" "}
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.8em",
                      color: "var(--accent)",
                    }}
                  >
                    search_products
                  </code>{" "}
                  tool.
                </p>
              </div>
              <div className="step-stack">
                <div className="step-stack-header">Display stack</div>
                <div className="step-stack-body">
                  <span className="step-stack-empty">empty</span>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="stack-step">
              <div className="step-num active">2</div>
              <div className="step-content">
                <h4>Tool pushes a renderer</h4>
                <p>
                  The search tool finds results and pushes a product grid to the
                  display stack. The tool doesn&#39;t wait — it returns
                  immediately.
                </p>
                <span className="step-code">
                  {`pushAndForget({ renderer: "product_grid" })`}
                </span>
              </div>
              <div className="step-stack">
                <div className="step-stack-header">Display stack</div>
                <div className="step-stack-body">
                  <div className="step-slot forget">
                    <span>product_grid</span>
                    <span className="slot-status">rendered</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="stack-step">
              <div className="step-num">3</div>
              <div className="step-content">
                <h4>User continues the conversation</h4>
                <p>
                  &ldquo;Add the Nike ones to my cart and check out&rdquo;
                </p>
                <p style={{ marginTop: "0.5rem" }}>
                  The agent calls{" "}
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.8em",
                      color: "var(--accent)",
                    }}
                  >
                    add_to_cart
                  </code>
                  , then{" "}
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.8em",
                      color: "var(--accent)",
                    }}
                  >
                    checkout
                  </code>
                  .
                </p>
              </div>
              <div className="step-stack">
                <div className="step-stack-header">Display stack</div>
                <div className="step-stack-body">
                  <div className="step-slot forget">
                    <span>product_grid</span>
                    <span className="slot-status">rendered</span>
                  </div>
                  <div className="step-slot forget">
                    <span>cart_summary</span>
                    <span className="slot-status">rendered</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4 */}
            <div className="stack-step">
              <div className="step-num active">4</div>
              <div className="step-content">
                <h4>Tool pauses for input</h4>
                <p>
                  The checkout tool needs payment details. It pushes a payment
                  form and <strong>waits</strong>. The tool&#39;s execution is
                  suspended until the user submits.
                </p>
                <span className="step-code">
                  {`pushAndWait({ renderer: "payment_form" })`}
                </span>
              </div>
              <div className="step-stack">
                <div className="step-stack-header">Display stack</div>
                <div className="step-stack-body">
                  <div className="step-slot forget">
                    <span>product_grid</span>
                    <span className="slot-status">rendered</span>
                  </div>
                  <div className="step-slot forget">
                    <span>cart_summary</span>
                    <span className="slot-status">rendered</span>
                  </div>
                  <div className="step-slot waiting">
                    <span>payment_form</span>
                    <span className="slot-status">waiting</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 5 */}
            <div className="stack-step">
              <div className="step-num">5</div>
              <div className="step-content">
                <h4>User submits, tool resumes</h4>
                <p>
                  The form resolves with payment data. The checkout tool picks
                  up where it left off, creates the order, and pushes a
                  confirmation.
                </p>
                <span className="step-code">
                  resolve(slot_id, paymentData)
                </span>
              </div>
              <div className="step-stack">
                <div className="step-stack-header">Display stack</div>
                <div className="step-stack-body">
                  <div className="step-slot resolved">
                    <span>order_confirmation</span>
                    <span className="slot-status">done</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </section>

      {/* ── Code ────────────────────────────────────────────────── */}
      <section id="code">
        <p className="section-label">Developer experience</p>
        <h2 className="section-title">
          Define capabilities. Ship applications.
        </h2>
        <p className="section-desc">
          A tool is a function with a name and a schema. Register tools with{" "}
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: "0.9em",
              color: "var(--accent)",
            }}
          >
            .fold()
          </code>
          . The agent figures out when to call them.
        </p>

        {/* ── Simple example ── */}
        <RevealOnScroll>
          <p className="code-example-label">Simple — a weather tool</p>
          <div className="code-block">
            <div className="code-block-header">
              <span>lib/glove.ts</span>
              <span>TypeScript</span>
            </div>
            <pre>
              <span className="kw">const</span> client ={" "}
              <span className="kw">new</span>{" "}
              <span className="fn">GloveClient</span>
              {"({\n"}
              {"  endpoint: "}
              <span className="str">&quot;/api/chat&quot;</span>
              {",\n"}
              {"  systemPrompt: "}
              <span className="str">&quot;You are a helpful weather assistant.&quot;</span>
              {",\n"}
              {"  tools: [{\n"}
              {"    name: "}
              <span className="str">&quot;get_weather&quot;</span>
              {",\n"}
              {"    description: "}
              <span className="str">&quot;Get current weather for a city&quot;</span>
              {",\n"}
              {"    inputSchema: z."}
              <span className="fn">object</span>
              {"({ city: z."}
              <span className="fn">string</span>
              {"() }),\n"}
              {"    "}
              <span className="kw">async</span>{" "}
              <span className="fn">do</span>
              {"(input) {\n"}
              {"      "}
              <span className="kw">return await</span>{" "}
              <span className="fn">fetchWeather</span>
              {"(input.city);\n"}
              {"    },\n"}
              {"  }],\n"}
              {"});\n\n"}
              <span className="cm">{"// That's a working AI app."}</span>
              {"\n"}
              <span className="cm">{"// User says \"weather in Tokyo\" → agent calls get_weather → shows result."}</span>
            </pre>
          </div>
        </RevealOnScroll>

        {/* ── Advanced example ── */}
        <RevealOnScroll>
          <p className="code-example-label">Advanced — tools with interactive UI</p>
          <div className="code-block">
            <div className="code-block-header">
              <span>app.ts</span>
              <span>TypeScript</span>
            </div>
            <pre>
              <span className="kw">const</span> app ={" "}
              <span className="kw">new</span>{" "}
              <span className="fn">Glove</span>
              {"({\n"}
              {"  store, model, displayManager,\n"}
              {"  systemPrompt: "}
              <span className="str">
                &quot;You are a shopping assistant...&quot;
              </span>
              {",\n"}
              {"})\n"}
              {"  ."}
              <span className="fn">fold</span>
              {"({\n"}
              {"    name: "}
              <span className="str">&quot;search_products&quot;</span>
              {",\n"}
              {"    description: "}
              <span className="str">
                &quot;Search the product catalog&quot;
              </span>
              {",\n"}
              {"    inputSchema: z."}
              <span className="fn">object</span>
              {"({ query: z."}
              <span className="fn">string</span>
              {"() }),\n"}
              {"    "}
              <span className="kw">async</span>{" "}
              <span className="fn">do</span>
              {"(input, display) {\n"}
              {"      "}
              <span className="kw">const</span> results ={" "}
              <span className="kw">await</span> catalog.
              <span className="fn">search</span>
              {"(input.query);\n"}
              {"      "}
              <span className="cm">{"// Show a product grid — tool keeps running"}</span>
              {"\n"}
              {"      "}
              <span className="kw">await</span> display.
              <span className="fn">pushAndForget</span>
              {"({ renderer: "}
              <span className="str">&quot;product_grid&quot;</span>
              {", input: results });\n"}
              {"      "}
              <span className="kw">return</span>
              {" results;\n"}
              {"    },\n"}
              {"  })\n"}
              {"  ."}
              <span className="fn">fold</span>
              {"({\n"}
              {"    name: "}
              <span className="str">&quot;checkout&quot;</span>
              {",\n"}
              {"    description: "}
              <span className="str">
                &quot;Start the checkout process&quot;
              </span>
              {",\n"}
              {"    inputSchema: z."}
              <span className="fn">object</span>
              {"({ cartId: z."}
              <span className="fn">string</span>
              {"() }),\n"}
              {"    "}
              <span className="kw">async</span>{" "}
              <span className="fn">do</span>
              {"(input, display) {\n"}
              {"      "}
              <span className="kw">const</span> cart ={" "}
              <span className="kw">await</span> carts.
              <span className="fn">get</span>
              {"(input.cartId);\n"}
              {"      "}
              <span className="cm">
                {"// Show a payment form — tool PAUSES until user submits"}
              </span>
              {"\n"}
              {"      "}
              <span className="kw">const</span> payment ={" "}
              <span className="kw">await</span> display.
              <span className="fn">pushAndWait</span>
              {"({ renderer: "}
              <span className="str">&quot;payment_form&quot;</span>
              {", input: cart });\n"}
              {"      "}
              <span className="kw">return await</span> orders.
              <span className="fn">create</span>
              {"(cart, payment);\n"}
              {"    },\n"}
              {"  })\n"}
              {"  ."}
              <span className="fn">build</span>
              {"();"}
            </pre>
          </div>
        </RevealOnScroll>
      </section>

      {/* ── Adapters ────────────────────────────────────────────── */}
      <section id="adapters">
        <p className="section-label">Adapters</p>
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

      {/* ── Trade-offs ──────────────────────────────────────────── */}
      <section id="tradeoffs">
        <p className="section-label">Trade-offs</p>
        <h2 className="section-title">Honest about what this costs.</h2>
        <RevealOnScroll>
          <div className="tradeoff-list">
            <div className="tradeoff">
              <span className="tradeoff-label">Latency</span>
              <span className="tradeoff-text">
                Every interaction round-trips through an LLM. 50ms becomes
                1&ndash;2 seconds. Acceptable for complex workflows. For high-frequency
                actions, renderers can trigger tools directly — bypassing the
                agent for deterministic operations.
              </span>
            </div>
            <div className="tradeoff">
              <span className="tradeoff-label">Determinism</span>
              <span className="tradeoff-text">
                A button always does what it says. Natural language probably does
                what you mean. The gap is real. Critical paths need
                deterministic fallbacks — renderer-initiated actions that skip
                the model entirely.
              </span>
            </div>
            <div className="tradeoff">
              <span className="tradeoff-label">Cost</span>
              <span className="tradeoff-text">
                Every turn consumes tokens. Compaction helps with context limits
                but not cumulative cost. Fewer, more capable tools mean fewer
                round-trips. Design tools intentionally.
              </span>
            </div>
          </div>
        </RevealOnScroll>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <div className="cta-section">
        <h2>
          Define capabilities. <strong>Ship applications.</strong>
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
