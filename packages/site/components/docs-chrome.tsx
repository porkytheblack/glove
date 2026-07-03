"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsOrder as order } from "@/lib/docs-nav";

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
