"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { foundryOrder } from "@/lib/foundry-nav";

export function FoundryBreadcrumb() {
  const pathname = usePathname();
  const entry = foundryOrder.find((item) => item.href === pathname);
  return (
    <nav className="docs-breadcrumb" aria-label="Breadcrumb">
      <Link href="/">Glove</Link><span className="sep">/</span>
      <Link href="/foundry">Foundry</Link><span className="sep">/</span>
      <span>{entry?.label ?? "Docs"}</span>
    </nav>
  );
}
export function FoundryPager() {
  const pathname = usePathname();
  const index = foundryOrder.findIndex((item) => item.href === pathname);
  if (index < 0) return null;
  const previous = foundryOrder[index - 1];
  const next = foundryOrder[index + 1];
  return (
    <div className="docs-pager">
      {previous ? (
        <Link href={previous.href} className="docs-pager-link prev">
          <span className="docs-pager-dir">← Previous</span>
          <span className="docs-pager-title">{previous.label}</span>
        </Link>
      ) : <span />}
      {next ? (
        <Link href={next.href} className="docs-pager-link next">
          <span className="docs-pager-dir">Next →</span>
          <span className="docs-pager-title">{next.label}</span>
        </Link>
      ) : <span />}
    </div>
  );
}
