// Single source of truth for docs navigation. The sidebar renders these
// sections directly; the breadcrumb + prev/next pager derive their linear
// reading order from the same list, so adding a page only touches this file.
//
// Section order is the reading order: start here → build → interfaces →
// state → sandboxes → multi-agent → ship → showcase → resources.

export type DocsBadge = "voice" | "beta" | "new" | "deprecated";

export interface DocsNavItem {
  label: string;
  href: string;
  badge?: DocsBadge;
  /** One-line summary — used by the section index cards and llms.txt. */
  summary?: string;
  /** npm packages this page documents. */
  packages?: string[];
}

export interface DocsNavSection {
  title: string;
  /** Shown on section index cards and in llms.txt. */
  blurb?: string;
  items: DocsNavItem[];
}

export const docsSections: DocsNavSection[] = [
  {
    title: "Start Here",
    blurb: "What Glove is, how to install it, and a tour of every package.",
    items: [
      {
        label: "Choose your path",
        href: "/docs",
        summary:
          "Start here: Foundry for complete agent systems, glove-core for an agent inside your app, or one capability package — plus an I-want-to index.",
      },
      {
        label: "What is Glove?",
        href: "/docs/intro",
        summary:
          "The idea behind Glove: define capabilities as tools, let an agent orchestrate them.",
      },
      {
        label: "Glove Foundry",
        href: "/foundry",
        summary:
          "The file-routed, Effect-native framework for assembling, running, and inspecting complete agent systems.",
        packages: ["glove-foundry"],
      },
      {
        label: "Installation",
        href: "/docs/installation",
        summary:
          "Which packages to install for which shape of app, model providers, and environment variables.",
        packages: ["glove-core", "glove-react", "glove-next"],
      },
      {
        label: "Quickstart",
        href: "/docs/getting-started",
        summary:
          "Build a working agent in 15 minutes — full-stack (Next.js + React) and server-only paths.",
        packages: ["glove-core", "glove-react", "glove-next"],
      },
      {
        label: "Core Concepts",
        href: "/docs/concepts",
        summary:
          "The agent loop, tools, the display stack, stores, adapters and context compaction.",
      },
      {
        label: "All Packages",
        href: "/docs/packages",
        summary:
          "Every package Glove ships, what it is for, and the smallest snippet that uses it.",
      },
    ],
  },
  {
    title: "Building Agents",
    blurb: "The runtime surface you write against every day.",
    items: [
      {
        label: "The Display Stack",
        href: "/docs/display-stack",
        summary:
          "Tools push UI mid-conversation — pushAndWait, pushAndForget, display strategies.",
        packages: ["glove-core", "glove-react"],
      },
      {
        label: "Hooks, Skills & Subagents",
        href: "/docs/extensions",
        summary:
          "Mutate state before a turn, inject context on demand, and route work to isolated children.",
        packages: ["glove-core"],
      },
      {
        label: "The Inbox",
        href: "/docs/inbox",
        summary:
          "A persistent mailbox for work that cannot resolve now — resolved later, injected next turn.",
        packages: ["glove-core"],
      },
      {
        label: "Classifier Models",
        href: "/docs/classifier",
        badge: "new",
        summary:
          "Fast, calibrated typed decisions — TypeSafe's Jev or any classifier — as agent tools, with an LLM fallback and confidence-gated cascades.",
        packages: ["glove-classifier"],
      },
      {
        label: "Server-Side Agents",
        href: "/docs/server-side",
        summary:
          "CLI tools, backend services and WebSocket servers with no React in sight.",
        packages: ["glove-core"],
      },
      {
        label: "Core API Reference",
        href: "/docs/core",
        summary:
          "Glove, Agent, PromptMachine, Executor, Observer, DisplayManager and every adapter contract.",
        packages: ["glove-core"],
      },
    ],
  },
  {
    title: "Interfaces",
    blurb: "How people reach the agent — rendered UI, speech, and a live face.",
    items: [
      {
        label: "React",
        href: "/docs/react",
        summary:
          "GloveClient, GloveProvider, useGlove, <Render>, defineTool and the client bindings.",
        packages: ["glove-react"],
      },
      {
        label: "Next.js",
        href: "/docs/next",
        summary: "createChatHandler — SSE streaming route handlers for the App Router.",
        packages: ["glove-next"],
      },
      {
        label: "Voice Agent Architectures",
        href: "/docs/voice-architectures",
        badge: "new",
        summary:
          "Pipeline vs realtime, single vs layered: a fast front agent that talks while a worker thinks, and <speech> tags for streaming only what should be said.",
        packages: ["glove-voice", "glove-voice-s2s", "glove-mesh"],
      },
      {
        label: "Voice Pipeline",
        href: "/docs/voice",
        badge: "voice",
        summary:
          "The cascade — VAD → STT → agent → TTS — with barge-in, push-to-talk and React Native.",
        packages: ["glove-voice", "glove-voice-native"],
      },
      {
        label: "Realtime Voice & Avatars",
        href: "/docs/realtime-voice",
        summary:
          "Speech-to-speech models, live avatars, and LiveKit as the room transport.",
        packages: ["glove-voice-s2s", "glove-voice-avatar", "glove-voice-livekit"],
      },
    ],
  },
  {
    title: "Generative Media",
    blurb: "Agentic image and video generation — workflows, not one-off calls.",
    items: [
      {
        label: "Image Workflows",
        href: "/docs/image",
        summary:
          "Prompt pipelines with enhancer inbetweens, durable characters and scenes, reference images, editing, assembly, vision review and per-call cost tracking.",
        packages: ["glove-image"],
      },
      {
        label: "Image Gallery",
        href: "/docs/image/gallery",
        summary:
          "A worked SS26 campaign — every image with its real prompt, pipeline trace and cost, plus a provenance canvas showing how one was made.",
        packages: ["glove-image"],
      },
      {
        label: "Video Workflows",
        href: "/docs/video",
        summary:
          "Temporal prompt pipelines, continuity libraries, image references, actual-video review, delivery gates, resumable flows and spend tracking.",
        packages: ["glove-video", "glove-image"],
      },
      {
        label: "Video Gallery",
        href: "/docs/video/gallery",
        summary:
          "An agent-directed case study exposing the keyframe, timed recipe, every reviewed take, revision evidence, delivery decision and real spend.",
        packages: ["glove-video", "glove-image"],
      },
    ],
  },
  {
    title: "Memory & State",
    blurb: "What the agent knows, and what it carries between turns.",
    items: [
      {
        label: "Memory",
        href: "/docs/memory",
        summary:
          "Entity graph, episodic timeline, resource filesystem and ambient context — BYO storage.",
        packages: ["glove-memory"],
      },
      {
        label: "Goal-Oriented Agents",
        href: "/docs/goal-oriented-agents",
        badge: "new",
        summary:
          "When to use goals, forms, facts, memory context or a UI form to collect information — and a complete agent that pursues an objective, gathers what is missing, then acts.",
        packages: ["glove-memory", "glove-facts"],
      },
      {
        label: "Forms",
        href: "/docs/forms",
        summary:
          "Structured collection over a conversation — Zod-authored definitions, lazily loaded, with colocated executors.",
        packages: ["glove-memory"],
      },
      {
        label: "Dynamic goals",
        href: "/docs/goals",
        summary: "Context-sensitive goal programs, checklist progress, revision history, and deferred follow-ups — BYO storage.",
        packages: ["glove-memory"],
      },
      {
        label: "Shared facts",
        href: "/docs/facts",
        summary: "Scoped evidence and preparation through a supplied Glove agent, shared by goals and forms.",
        packages: ["glove-facts", "glove-memory"],
      },
      {
        label: "Why Memory",
        href: "/docs/memory/why",
        summary: "The design story behind the four-primitive split.",
      },
      {
        label: "Scratchpad",
        href: "/docs/scratchpad",
        summary:
          "Expose tools as a relational database the model queries with one execute_sql tool.",
        packages: ["glove-scratchpad"],
      },
      {
        label: "SQL Engine",
        href: "/docs/sql",
        summary:
          "The zero-dependency Postgres-subset engine behind the scratchpad.",
        packages: ["glove-sql"],
      },
    ],
  },
  {
    title: "Sandboxes & Execution",
    blurb:
      "Give the model a place to compute instead of a wall of tool definitions.",
    items: [
      {
        label: "Browsers & Sandboxes",
        href: "/docs/execution",
        badge: "new",
        summary: "Mounted browser workflows, persistent coding sandboxes, and optional shared Station hosting in Foundry.",
        packages: ["glove-execution", "glove-foundry"],
      },
      {
        label: "Virtual Filesystem",
        href: "/docs/vfs",
        badge: "new",
        summary:
          "One tree the working environment, memory resources and the REPLs all share — mounts, access policies, metadata and search.",
        packages: ["glove-vfs"],
      },
      {
        label: "Working Environment",
        href: "/docs/working-environment",
        summary:
          "A persistent sandboxed virtual filesystem — write scripts, run them, iterate, export artifacts.",
        packages: [
          "glove-working-environment",
          "glove-vfs",
          "glove-env-documents",
          "glove-env-spreadsheets",
          "glove-env-images",
          "glove-env-slides",
          "glove-env-zip",
          "glove-env-media",
          "glove-env-fetch",
          "glove-env-secret",
        ],
      },
      {
        label: "Code Execution",
        href: "/docs/code-execution",
        summary:
          "One eval tool instead of fifty tool definitions — JavaScript, Python and Lisp REPLs.",
        packages: ["glove-js", "glove-python", "glove-lisp"],
      },
      {
        label: "Egress Control",
        href: "/docs/egress",
        badge: "deprecated",
        summary:
          "Make the sandbox boundary a measured, enforced privacy boundary.",
        packages: ["glove-egress"],
      },
    ],
  },
  {
    title: "Multi-Agent",
    blurb: "Many agents, coordinated.",
    items: [
      {
        label: "Mesh",
        href: "/docs/mesh",
        summary:
          "Direct, broadcast and acknowledged messaging between agents over a pluggable transport.",
        packages: ["glove-mesh"],
      },
      {
        label: "Continuum",
        href: "/docs/continuum",
        badge: "beta",
        summary:
          "Supervise agents as subprocesses — triggered (cold) and concurrent (warm) modes.",
        packages: ["glove-continuum-signal"],
      },
    ],
  },
  {
    title: "Integrate",
    blurb: "Reach the outside world. To deploy, see the Foundry deploy guide.",
    items: [
      {
        label: "MCP",
        href: "/docs/mcp",
        summary:
          "Bridge Model Context Protocol servers in as first-class tools, with a discovery subagent.",
        packages: ["glove-mcp"],
      },
    ],
  },
  {
    title: "Showcase",
    blurb: "Complete applications, read end to end.",
    items: [
      {
        label: "All examples",
        href: "/docs/showcase",
        summary:
          "Every runnable example and walkthrough — Foundry systems, display-stack apps, voice agents, sandboxes and media studios.",
      },
      {
        label: "Travel Planner",
        href: "/docs/showcase/travel-planner",
        summary:
          "Build a trip planner whose tools render option pickers, itinerary cards and confirmations with the display stack.",
        packages: ["glove-react", "glove-next"],
      },
      {
        label: "Coding Agent",
        href: "/docs/showcase/coding-agent",
        summary:
          "A coding agent with file tools, a WebSocket server, a React client and permission prompts before writes.",
        packages: ["glove-core", "glove-react"],
      },
      {
        label: "Coffee Shop",
        href: "/docs/showcase/coffee-shop",
        badge: "voice",
        summary:
          "A voice-first barista: product cards, a live shopping bag and checkout, ordered by speaking.",
        packages: ["glove-react", "glove-voice"],
      },
      {
        label: "Lola",
        href: "/docs/showcase/lola",
        badge: "voice",
        summary:
          "A voice movie companion that searches films and narrates while it renders poster grids.",
        packages: ["glove-react", "glove-voice"],
      },
      {
        label: "Ecommerce Store",
        href: "/docs/showcase/ecommerce-store",
        summary:
          "A shopping assistant with product grids, size and colour pickers, a cart and checkout as tool-rendered UI.",
        packages: ["glove-react", "glove-next"],
      },
      {
        label: "Terminal Agent",
        href: "/docs/showcase/terminal-agent",
        summary:
          "A server-only agent in the terminal with filesystem and shell tools and no React.",
        packages: ["glove-core"],
      },
    ],
  },
  {
    title: "Resources",
    blurb: "Everything else.",
    items: [
      {
        label: "Glove for LLMs",
        href: "/docs/llms",
        summary: "llms.txt, llms-full.txt and the Claude Code agent skill.",
      },
      {
        label: "Agent Skill",
        href: "/docs/agent-skill",
        summary: "Install the Glove and Foundry skills so Claude Code and other coding agents write correct Glove code.",
      },
      {
        label: "v4 Release Notes",
        href: "/docs/v4",
        summary:
          "What changed in glove-core 4.0 through 4.3: live runtime context, the 4.0 migration, and the 4.1–4.3 highlights.",
        packages: ["glove-core"],
      },
      {
        label: "v3.0.0 Release Notes",
        href: "/docs/v3",
        summary: "What changed in Glove v3 and how to upgrade.",
      },
    ],
  },
];

export interface DocsOrderEntry {
  href: string;
  label: string;
  section: string;
}

/** Flat linear reading order derived from the sections above. */
export const docsOrder: DocsOrderEntry[] = docsSections.flatMap((section) =>
  section.items.map((item) => ({
    href: item.href,
    label: item.label,
    section: section.title,
  })).filter((item) => item.href.startsWith("/docs/")),
);

/** Look up the section a page belongs to. */
export function sectionFor(href: string): DocsNavSection | undefined {
  return docsSections.find((s) => s.items.some((i) => i.href === href));
}

/**
 * Page metadata from the nav entry, so a page's title and description match
 * what the sidebar, search and llms.txt already say about it.
 */
export function docsMetadata(href: string): { title: string; description?: string } {
  for (const section of docsSections) {
    const item = section.items.find((entry) => entry.href === href);
    if (item) return { title: item.label, ...(item.summary ? { description: item.summary } : {}) };
  }
  throw new Error(`docsMetadata: ${href} is not registered in lib/docs-nav.ts`);
}
