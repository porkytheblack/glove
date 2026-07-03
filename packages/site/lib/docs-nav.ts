// Single source of truth for docs navigation. The sidebar renders these
// sections directly; the breadcrumb + prev/next pager derive their linear
// reading order from the same list, so adding a page only touches this file.

export type DocsBadge = "voice" | "beta" | "new";

export interface DocsNavItem {
  label: string;
  href: string;
  badge?: DocsBadge;
}

export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}

export const docsSections: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { label: "What is Glove?", href: "/docs/intro" },
      { label: "Getting Started", href: "/docs/getting-started" },
      { label: "Core Concepts", href: "/docs/concepts" },
    ],
  },
  {
    title: "Core",
    items: [
      { label: "The Display Stack", href: "/docs/display-stack" },
      { label: "The Inbox", href: "/docs/inbox" },
      { label: "Hooks, Skills & Subagents", href: "/docs/extensions" },
      { label: "Server-Side Agents", href: "/docs/server-side" },
      { label: "Core API", href: "/docs/core" },
    ],
  },
  {
    title: "Memory & State",
    items: [
      { label: "Memory", href: "/docs/memory", badge: "new" },
      { label: "Scratchpad", href: "/docs/scratchpad", badge: "new" },
      { label: "SQL Engine", href: "/docs/sql" },
    ],
  },
  {
    title: "Multi-Agent",
    items: [
      { label: "Mesh", href: "/docs/mesh", badge: "new" },
      { label: "Continuum", href: "/docs/continuum", badge: "beta" },
    ],
  },
  {
    title: "Integrate & Deploy",
    items: [
      { label: "MCP", href: "/docs/mcp" },
      { label: "Glovebox", href: "/docs/glovebox", badge: "beta" },
    ],
  },
  {
    title: "Framework Packages",
    items: [
      { label: "React", href: "/docs/react" },
      { label: "Next.js", href: "/docs/next" },
      { label: "Voice", href: "/docs/voice", badge: "voice" },
    ],
  },
  {
    title: "Showcase",
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
    items: [
      { label: "Agent Skill", href: "/docs/agent-skill" },
      { label: "v3.0.0 Release Notes", href: "/docs/v3" },
      { label: "Why Memory", href: "/docs/memory/why", badge: "beta" },
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
  })),
);
