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
        label: "What is Glove?",
        href: "/docs/intro",
        summary:
          "The idea behind Glove: define capabilities as tools, let an agent orchestrate them.",
      },
      {
        label: "Glove Foundry",
        href: "/foundry",
        badge: "new",
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
        badge: "new",
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
        badge: "new",
        summary:
          "Prompt pipelines with enhancer inbetweens, durable characters and scenes, reference images, editing, assembly, vision review and per-call cost tracking.",
        packages: ["glove-image"],
      },
      {
        label: "Image Gallery",
        href: "/docs/image/gallery",
        badge: "new",
        summary:
          "A worked SS26 campaign — every image with its real prompt, pipeline trace and cost, plus a provenance canvas showing how one was made.",
        packages: ["glove-image"],
      },
      {
        label: "Video Workflows",
        href: "/docs/video",
        badge: "new",
        summary:
          "Temporal prompt pipelines, continuity libraries, image references, actual-video review, delivery gates, resumable flows and spend tracking.",
        packages: ["glove-video", "glove-image"],
      },
      {
        label: "Video Gallery",
        href: "/docs/video/gallery",
        badge: "new",
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
        label: "Forms",
        href: "/docs/forms",
        badge: "new",
        summary:
          "Structured collection over a conversation — Zod-authored definitions, lazily loaded, with colocated executors.",
        packages: ["glove-memory"],
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
        label: "Working Environment",
        href: "/docs/working-environment",
        badge: "new",
        summary:
          "A persistent sandboxed virtual filesystem — write scripts, run them, iterate, export artifacts.",
        packages: [
          "glove-working-environment",
          "glove-env-documents",
          "glove-env-spreadsheets",
          "glove-env-images",
          "glove-env-slides",
          "glove-env-zip",
          "glove-env-media",
        ],
      },
      {
        label: "Code Execution",
        href: "/docs/code-execution",
        badge: "new",
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
    title: "Integrate & Deploy",
    blurb: "Reach the outside world, then ship.",
    items: [
      {
        label: "MCP",
        href: "/docs/mcp",
        summary:
          "Bridge Model Context Protocol servers in as first-class tools, with a discovery subagent.",
        packages: ["glove-mcp"],
      },
      {
        label: "Glovebox",
        href: "/docs/glovebox",
        badge: "beta",
        summary:
          "Package an agent as a sandboxed container with one authenticated WebSocket endpoint.",
        packages: ["glovebox-core", "glovebox-kit", "glovebox-client"],
      },
    ],
  },
  {
    title: "Showcase",
    blurb: "Complete applications, read end to end.",
    items: [
      { label: "Travel Planner", href: "/docs/showcase/travel-planner" },
      { label: "Coding Agent", href: "/docs/showcase/coding-agent" },
      { label: "Coffee Shop", href: "/docs/showcase/coffee-shop", badge: "voice" },
      { label: "Lola", href: "/docs/showcase/lola", badge: "voice" },
      { label: "Ecommerce Store", href: "/docs/showcase/ecommerce-store" },
      { label: "Terminal Agent", href: "/docs/showcase/terminal-agent" },
      { label: "Glovebox", href: "/docs/showcase/glovebox", badge: "beta" },
    ],
  },
  {
    title: "Resources",
    blurb: "Everything else.",
    items: [
      {
        label: "Glove for LLMs",
        href: "/docs/llms",
        badge: "new",
        summary: "llms.txt, llms-full.txt and the Claude Code agent skill.",
      },
      { label: "Agent Skill", href: "/docs/agent-skill" },
      { label: "v3.0.0 Release Notes", href: "/docs/v3" },
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
