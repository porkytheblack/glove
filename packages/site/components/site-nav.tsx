"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GloveLogo } from "@/components/glove-logo";
import { SiteSearch } from "@/components/site-search";

const links = [
  { href: "/foundry", label: "Foundry", match: "/foundry", className: "nav-foundry" },
  { href: "/docs", label: "Docs", match: "/docs" },
  { href: "/docs/showcase", label: "Showcase", match: "/docs/showcase" },
  { href: "/blog", label: "Blog", match: "/blog" },
];

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85 0 1.34-.01 2.42-.01 2.75 0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" />
    </svg>
  );
}

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  // The most specific matching link is the current section.
  const current = links
    .filter((link) => pathname === link.match || pathname.startsWith(`${link.match}/`))
    .sort((a, b) => b.match.length - a.match.length)[0]?.href;

  return (
    <nav>
      <Link href="/" className="nav-brand">
        <GloveLogo className="nav-logo" />
        <span className="nav-wordmark">Glove</span>
        <span className="nav-pill">v4</span>
      </Link>
      <div className="nav-links">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={[link.className, current === link.href ? "active" : ""].filter(Boolean).join(" ") || undefined}
            aria-current={current === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
        <SiteSearch />
        <a
          href="https://github.com/porkytheblack/glove"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-cta"
        >
          <GitHubIcon />
          <span className="nav-cta-label">GitHub</span>
        </a>
        <button
          type="button"
          className="nav-menu-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {menuOpen && (
        <div className="nav-sheet">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={current === link.href ? "active" : undefined}>
              {link.label}
            </Link>
          ))}
          <Link href="/foundry/docs/getting-started">Install Foundry</Link>
          <Link href="/docs/getting-started">Glove quickstart</Link>
          <a href="https://github.com/porkytheblack/glove" target="_blank" rel="noopener noreferrer">
            GitHub ↗
          </a>
        </div>
      )}
    </nav>
  );
}
