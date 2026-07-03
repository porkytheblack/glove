"use client";

import Link from "next/link";
import { GloveLogo } from "@/components/glove-logo";

export function SiteNav() {
  return (
    <nav>
      <Link href="/" className="nav-brand">
        <GloveLogo className="nav-logo" />
        <span className="nav-wordmark">Glove</span>
        <span className="nav-pill">v3</span>
      </Link>
      <div className="nav-links">
        <Link href="/docs/intro">Docs</Link>
        <Link href="/docs/showcase/travel-planner">Showcase</Link>
        <a
          href="https://github.com/porkytheblack/glove"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-cta"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85 0 1.34-.01 2.42-.01 2.75 0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" />
          </svg>
          <span className="nav-cta-label">GitHub</span>
        </a>
      </div>
    </nav>
  );
}
