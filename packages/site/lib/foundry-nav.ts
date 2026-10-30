// Single source of truth for the Foundry handbook. The sidebar, breadcrumb,
// pager, docs search, sitemap and /foundry/llms.txt all derive from this list,
// so adding a page only touches this file.

export interface FoundryNavItem {
  label: string;
  href: string;
  summary: string;
  badge?: "new";
}
export interface FoundryNavSection {
  title: string;
  items: FoundryNavItem[];
}

export const foundrySections: FoundryNavSection[] = [
  {
    title: "Start",
    items: [
      {
        label: "Overview",
        href: "/foundry/docs",
        summary: "What Foundry gives you out of the box, when to use it instead of plain Glove, and the definition → instance → run model.",
      },
      {
        label: "Install & CLI",
        href: "/foundry/docs/getting-started",
        summary: "The setup wizard, both starter templates, every CLI command and flag, and your first run in the inspector.",
      },
      {
        label: "Tutorial: first agent system",
        href: "/foundry/docs/tutorial",
        badge: "new",
        summary: "Build a support agent step by step: a tool, an installed app, instances, conversations, a schedule, an approval, and an OpenAI SDK client.",
      },
      {
        label: "Project structure",
        href: "/foundry/docs/project-structure",
        badge: "new",
        summary: "Every file convention, how filenames become ids, foundry.application.ts vs foundry.config.ts, generated route types and the ESLint preset.",
      },
    ],
  },
  {
    title: "Build agents",
    items: [
      {
        label: "Definitions & instances",
        href: "/foundry/docs/definitions-and-instances",
        summary: "What belongs in code, what belongs in data, how instances are created, updated and reconstructed, and where string ids are correct.",
      },
      {
        label: "defineAgent & assembly",
        href: "/foundry/docs/composition",
        summary: "Every defineAgent field, the value-or-resolver rule, the assembly context, and configure/build/run lifecycle hooks.",
      },
      {
        label: "Tools, MCP & memory",
        href: "/foundry/docs/capabilities",
        badge: "new",
        summary: "Always-on tools vs installable shared tools, MCP servers over HTTP or stdio, memory profiles, layers, subscribers, and typed calls.",
      },
      {
        label: "Goals, facts & forms",
        href: "/foundry/docs/guidance",
        summary: "Guided conversations, durable evidence and answers, native preparation, and live context providers.",
      },
    ],
  },
  {
    title: "Design your system",
    items: [
      {
        label: "Layered agents",
        href: "/foundry/docs/layered-agents",
        badge: "new",
        summary: "Split an assistant by speed, context and duration: an interactor that talks and remembers, workers that do the work, delegates that hand off and hear back.",
      },
      {
        label: "Durable subagents",
        href: "/foundry/docs/durable-subagents",
        badge: "new",
        summary: "Complete realtime front and long-running researcher: inheritance, memory and app permissions, direct messaging, task delegation, event targeting, wake/defer policies and restart recovery.",
      },
      {
        label: "Voice agents",
        href: "/foundry/docs/voice",
        badge: "new",
        summary: "Run an agent as a live call with voiceCall: rooms, the tools a call may use, and delegation results spoken at the next pause.",
      },
      {
        label: "Multi-agent systems",
        href: "/foundry/docs/multi-agent",
        summary: "Every way agents work together: delegates, subagents, typed calls, spawn, mesh, client fan-out and coordination through shared work.",
      },
    ],
  },
  {
    title: "Connect & automate",
    items: [
      {
        label: "Apps & transmissions",
        href: "/foundry/docs/applications",
        summary: "Installable capability bundles, inbound and outbound transports, accounts, routes, connections, and the credential boundary.",
      },
      {
        label: "Playbooks, schedules & sleep",
        href: "/foundry/docs/automation",
        summary: "Event-driven playbooks, subscriptions that provision agents, cron and interval schedules, sleep, spawn and the built-in agent tools.",
      },
    ],
  },
  {
    title: "Give agents a world",
    items: [
      {
        label: "Conversations & shared work",
        href: "/foundry/docs/conversations",
        summary: "Many conversations per instance, transcripts, workspace entries, the shared inbox, tasks, and scoped environment values.",
      },
      {
        label: "Working environments",
        href: "/foundry/docs/working-environments",
        summary: "Mount a VFS, a REPL, programmatic tool calling, skills, and document or media adapters for artifact-producing agents.",
      },
      {
        label: "Browser & sandbox agent",
        href: "/foundry/docs/browser-and-sandbox",
        summary: "A runnable personal agent with mounted browser scripts, persistent code sandboxes and managed servers on one Station.",
      },
    ],
  },
  {
    title: "Operate",
    items: [
      {
        label: "Client & HTTP API",
        href: "/foundry/docs/runtime",
        summary: "The typed client, every native /api endpoint, the /v1/runs automation API, live event streams and health checks.",
      },
      {
        label: "OpenAI-compatible API",
        href: "/foundry/docs/openai-compatible",
        badge: "new",
        summary: "Point any OpenAI SDK at Foundry: /v1/chat/completions and /v1/responses backed by durable instances and conversations.",
      },
      {
        label: "Approvals & steering",
        href: "/foundry/docs/approvals",
        badge: "new",
        summary: "Human-in-the-loop: permission-gated tools become expiring approval records; redirect active work with interrupt-and-restart steering.",
      },
      {
        label: "Inspector & WebChat",
        href: "/foundry/docs/observability",
        summary: "The built-in inspector, WebChat, run traces, keyboard shortcuts, the event envelope, and custom subscribers.",
      },
      {
        label: "Persistence",
        href: "/foundry/docs/persistence",
        badge: "new",
        summary: "The four things to persist separately — runtime data, transcripts, memory and the VFS — with file, SQLite and custom adapters.",
      },
      {
        label: "Next.js integration",
        href: "/foundry/docs/nextjs",
        badge: "new",
        summary: "Add Foundry to an existing Next.js app: the generated layout, the typed client, route handlers and FOUNDRY_URL.",
      },
      {
        label: "Deploy on Kuiper",
        href: "/foundry/docs/kuiper",
        badge: "new",
        summary: "Deploy a Foundry folder with no Dockerfile: the /data disk, secrets, the model gateway, browsers, sandboxes, email, and the agent's runs in the Kuiper dashboard.",
      },
      {
        label: "Deploy & security",
        href: "/foundry/docs/deploy",
        summary: "Production checklist, request authorization, health checks, the managed execution daemon and scaling by role.",
      },
    ],
  },
  {
    title: "Reference",
    items: [
      {
        label: "API reference",
        href: "/foundry/docs/reference",
        badge: "new",
        summary: "Every export of glove-foundry and its subpaths, the built-in agent tools, HTTP endpoints, CLI flags and config keys in one place.",
      },
      {
        label: "FAQ & troubleshooting",
        href: "/foundry/docs/faq",
        badge: "new",
        summary: "Why a tool is missing, why state reset, why the server refuses to bind, and other questions people ask in their first week.",
      },
    ],
  },
];

export const foundryOrder = foundrySections.flatMap((section) =>
  section.items.map((item) => ({ ...item, section: section.title })),
);
