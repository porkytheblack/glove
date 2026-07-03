import Link from "next/link";
import { GloveLogo } from "@/components/glove-logo";

const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Learn",
    links: [
      { label: "What is Glove?", href: "/docs/intro" },
      { label: "Getting Started", href: "/docs/getting-started" },
      { label: "Display Stack", href: "/docs/display-stack" },
      { label: "Core Concepts", href: "/docs/concepts" },
    ],
  },
  {
    title: "Packages",
    links: [
      { label: "Memory", href: "/docs/memory" },
      { label: "Mesh", href: "/docs/mesh" },
      { label: "Scratchpad", href: "/docs/scratchpad" },
      { label: "MCP", href: "/docs/mcp" },
      { label: "Glovebox", href: "/docs/glovebox" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: "https://github.com/porkytheblack/glove", external: true },
      { label: "Showcase", href: "/docs/showcase/travel-planner" },
      { label: "v3 Release Notes", href: "/docs/v3" },
      { label: "dterminal", href: "https://dterminal.net", external: true },
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
            An open-source agentic runtime for building applications as
            conversations.
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
        <span>
          A product by{" "}
          <a
            href="https://dterminal.net"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "var(--mono)" }}
          >
            dterminal
          </a>
        </span>
        <span>MIT Licensed &middot; &copy; 2026</span>
      </div>
    </footer>
  );
}
