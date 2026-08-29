import Link from "next/link";
import { GloveLogo } from "@/components/glove-logo";
import { CradleLogo } from "@/components/cradle-logo";

const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Learn",
    links: [
      { label: "Glove Foundry", href: "/foundry" },
      { label: "Foundry handbook", href: "/foundry/docs" },
      { label: "What is Glove?", href: "/docs/intro" },
      { label: "Installation", href: "/docs/installation" },
      { label: "Quickstart", href: "/docs/getting-started" },
      { label: "Core Concepts", href: "/docs/concepts" },
      { label: "All Packages", href: "/docs/packages" },
    ],
  },
  {
    title: "Capabilities",
    links: [
      { label: "Display Stack", href: "/docs/display-stack" },
      { label: "Memory", href: "/docs/memory" },
      { label: "Scratchpad", href: "/docs/scratchpad" },
      { label: "Working Environment", href: "/docs/working-environment" },
      { label: "Code Execution", href: "/docs/code-execution" },
      { label: "Realtime Voice", href: "/docs/realtime-voice" },
      { label: "Image Workflows", href: "/docs/image" },
      { label: "Mesh", href: "/docs/mesh" },
    ],
  },
  {
    title: "Ship",
    links: [
      { label: "Server-Side Agents", href: "/docs/server-side" },
      { label: "MCP", href: "/docs/mcp" },
      { label: "Glovebox", href: "/docs/glovebox" },
      { label: "Showcase", href: "/docs/showcase/travel-planner" },
    ],
  },
  {
    title: "For LLMs",
    links: [
      // Plain text routes, not pages — let the browser fetch them directly.
      { label: "llms.txt", href: "/llms.txt", external: true },
      { label: "llms-full.txt", href: "/llms-full.txt", external: true },
      { label: "Foundry llms.txt", href: "/foundry/llms.txt", external: true },
      { label: "Agent Skill", href: "/docs/agent-skill" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: "https://github.com/porkytheblack/glove", external: true },
      { label: "v3 Release Notes", href: "/docs/v3" },
      { label: "Used by Proxima", href: "https://proximadroids.com", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-brand-row">
            <GloveLogo className="footer-logo" />
            <span className="footer-brand-name">Glove</span>
          </div>
          <span className="footer-tagline">
            The open-source TypeScript stack for complete agent systems.
          </span>
        </div>
        <div className="footer-cols">
          {columns.map((col) => (
            <div key={col.title} className="footer-col">
              <span className="footer-col-title">{col.title}</span>
              {col.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href}>
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="footer-bottom">
        <span className="footer-credit">
          A product by
          <CradleLogo className="cradle-logo" />
          <span className="cradle-name">Cradle Research</span>
        </span>
        <span>MIT Licensed &middot; &copy; 2026</span>
      </div>
    </footer>
  );
}
