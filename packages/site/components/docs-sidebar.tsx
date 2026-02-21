"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  voice?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { label: "What is Glove?", href: "/docs/intro" },
      { label: "Getting Started", href: "/docs/getting-started" },
      { label: "The Display Stack", href: "/docs/display-stack" },
    ],
  },
  {
    title: "Core",
    items: [
      { label: "Concepts", href: "/docs/concepts" },
      { label: "Core API", href: "/docs/core" },
    ],
  },
  {
    title: "Showcase",
    items: [
      { label: "Travel Planner", href: "/docs/showcase/travel-planner" },
      { label: "Coding Agent", href: "/docs/showcase/coding-agent" },
      { label: "Coffee Shop", href: "/docs/showcase/coffee-shop", voice: true },
      { label: "Lola", href: "/docs/showcase/lola", voice: true },
      { label: "Ecommerce Store", href: "/docs/showcase/ecommerce-store" },
      { label: "Terminal Agent", href: "/docs/showcase/terminal-agent" },
    ],
  },
  {
    title: "Packages",
    items: [
      { label: "React", href: "/docs/react" },
      { label: "Next.js", href: "/docs/next" },
      { label: "Voice", href: "/docs/voice" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Agent Skill", href: "/docs/agent-skill" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="docs-sidebar-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
      >
        {isOpen ? "\u2715" : "\u2630"}
      </button>
      {isOpen && (
        <div
          className="docs-sidebar-backdrop"
          onClick={() => setIsOpen(false)}
        />
      )}
      <aside className={`docs-sidebar${isOpen ? " open" : ""}`}>
        {sections.map((section) => (
          <div key={section.title} className="docs-sidebar-section">
            <div className="docs-sidebar-label">{section.title}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`docs-sidebar-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setIsOpen(false)}
              >
                {item.label}
                {item.voice && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      marginLeft: 6,
                      padding: "1px 5px",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      borderRadius: 3,
                      background: "rgba(245, 166, 35, 0.12)",
                      color: "#f5a623",
                      lineHeight: 1.5,
                    }}
                  >
                    voice
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </aside>
    </>
  );
}
