export interface FoundryNavItem {
  label: string;
  href: string;
  summary: string;
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
        label: "Foundry overview",
        href: "/foundry/docs",
        summary: "The framework, its boundaries, and the definition → instance → run model.",
      },
      {
        label: "Installation",
        href: "/foundry/docs/getting-started",
        summary: "Scaffold, configure, run, inspect, and call your first file-routed agent.",
      },
    ],
  },
  {
    title: "Model the system",
    items: [
      {
        label: "Definitions & instances",
        href: "/foundry/docs/definitions-and-instances",
        summary: "What belongs in code, what belongs in data, and how persisted instances are reconstructed.",
      },
      {
        label: "Agent composition",
        href: "/foundry/docs/composition",
        summary: "Message-aware lazy assembly, shared tools, models, memory, inboxes, layers, MCP, and mesh calls.",
      },
      {
        label: "Apps & transmissions",
        href: "/foundry/docs/applications",
        summary: "Dynamically installed capabilities, inbound and outbound routes, accounts, and credential adapters.",
      },
      {
        label: "Playbooks & schedules",
        href: "/foundry/docs/automation",
        summary: "Runtime playbooks, event subscriptions, instance provisioning, future triggers, sleep, wake, and cancellation.",
      },
    ],
  },
  {
    title: "Give agents a world",
    items: [
      {
        label: "Conversations & work",
        href: "/foundry/docs/conversations",
        summary: "Multiple conversations per instance, inboxes, shared workspaces, tasks, artifacts, and background work.",
      },
      {
        label: "Working environments",
        href: "/foundry/docs/working-environments",
        summary: "Mount a VFS, REPL, skills, and document or media adapters for artifact-producing agents.",
      },
      {
        label: "Multi-agent systems",
        href: "/foundry/docs/multi-agent",
        summary: "Layered agents, subagents, S2S and S2V calls, fan-out, handoffs, and shared work.",
      },
    ],
  },
  {
    title: "Operate",
    items: [
      {
        label: "Runtime & HTTP API",
        href: "/foundry/docs/runtime",
        summary: "Typed clients, handlers, activation endpoints, Effect services, and adapter boundaries.",
      },
      {
        label: "Inspector & observability",
        href: "/foundry/docs/observability",
        summary: "Follow runs, model passes, tool calls, messages, retries, artifacts, and safe working notes.",
      },
      {
        label: "Deploy",
        href: "/foundry/docs/deploy",
        summary: "Production adapters, durable state, Glovebox packaging, and the path from local Foundry to cloud agents.",
      },
    ],
  },
];

export const foundryOrder = foundrySections.flatMap((section) =>
  section.items.map((item) => ({ ...item, section: section.title })),
);
