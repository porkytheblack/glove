"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface DocEntry {
  href: string;
  label: string;
  section: string;
}

// Linear reading order across the docs — drives breadcrumbs + prev/next.
const order: DocEntry[] = [
  { href: "/docs/intro", label: "What is Glove?", section: "Getting Started" },
  { href: "/docs/getting-started", label: "Getting Started", section: "Getting Started" },
  { href: "/docs/concepts", label: "Core Concepts", section: "Getting Started" },
  { href: "/docs/display-stack", label: "The Display Stack", section: "Core" },
  { href: "/docs/inbox", label: "The Inbox", section: "Core" },
  { href: "/docs/extensions", label: "Hooks, Skills & Subagents", section: "Core" },
  { href: "/docs/server-side", label: "Server-Side Agents", section: "Core" },
  { href: "/docs/core", label: "Core API", section: "Core" },
  { href: "/docs/memory", label: "Memory", section: "Memory & State" },
  { href: "/docs/scratchpad", label: "Scratchpad", section: "Memory & State" },
  { href: "/docs/sql", label: "SQL Engine", section: "Memory & State" },
  { href: "/docs/mesh", label: "Mesh", section: "Multi-Agent" },
  { href: "/docs/continuum", label: "Continuum", section: "Multi-Agent" },
  { href: "/docs/mcp", label: "MCP", section: "Integrate & Deploy" },
  { href: "/docs/glovebox", label: "Glovebox", section: "Integrate & Deploy" },
  { href: "/docs/react", label: "React", section: "Framework Packages" },
  { href: "/docs/next", label: "Next.js", section: "Framework Packages" },
  { href: "/docs/voice", label: "Voice", section: "Framework Packages" },
  { href: "/docs/showcase/travel-planner", label: "Travel Planner", section: "Showcase" },
  { href: "/docs/showcase/coding-agent", label: "Coding Agent", section: "Showcase" },
  { href: "/docs/showcase/coffee-shop", label: "Coffee Shop", section: "Showcase" },
  { href: "/docs/showcase/lola", label: "Lola", section: "Showcase" },
  { href: "/docs/showcase/ecommerce-store", label: "Ecommerce Store", section: "Showcase" },
  { href: "/docs/showcase/terminal-agent", label: "Terminal Agent", section: "Showcase" },
  { href: "/docs/showcase/glovebox", label: "Glovebox Example", section: "Showcase" },
  { href: "/docs/agent-skill", label: "Agent Skill", section: "Resources" },
  { href: "/docs/v3", label: "v3.0.0 Release Notes", section: "Resources" },
  { href: "/docs/memory/why", label: "Why Memory", section: "Resources" },
];

const byHref = new Map(order.map((e) => [e.href, e]));

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="M19 12H5M11 6l-6 6 6 6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  );
}

export function DocsBreadcrumb() {
  const pathname = usePathname();
  const entry = pathname ? byHref.get(pathname) : undefined;
  return (
    <nav className="docs-breadcrumb" aria-label="Breadcrumb">
      <Link href="/">Glove</Link>
      <span className="sep">/</span>
      <Link href="/docs/intro">Docs</Link>
      {entry && (
        <>
          <span className="sep">/</span>
          <span style={{ color: "var(--text-secondary)" }}>{entry.section}</span>
        </>
      )}
    </nav>
  );
}

export function DocsPager() {
  const pathname = usePathname();
  if (!pathname) return null;
  const idx = order.findIndex((e) => e.href === pathname);
  if (idx === -1) return null;
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx < order.length - 1 ? order[idx + 1] : null;
  if (!prev && !next) return null;

  return (
    <div className="docs-pager">
      {prev ? (
        <Link href={prev.href} className="docs-pager-link prev">
          <span className="docs-pager-dir">
            <Arrow dir="left" /> Previous
          </span>
          <span className="docs-pager-title">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="docs-pager-link next">
          <span className="docs-pager-dir">
            Next <Arrow dir="right" />
          </span>
          <span className="docs-pager-title">{next.label}</span>
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
