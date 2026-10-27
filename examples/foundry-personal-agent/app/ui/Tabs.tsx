"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/chat", label: "Chat" },
  { href: "/watch", label: "Watch" },
  { href: "/plans", label: "Plans" },
  { href: "/you", label: "You" },
] as const;

/** The four tabs, and Try it when the demo connectors are on. */
export function Tabs({ demo = false }: { readonly demo?: boolean }) {
  const path = usePathname();
  const tabs = demo ? [...TABS, { href: "/demo", label: "Try it" }] : TABS;
  return (
    <nav aria-label="Main" className="tabs">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={path === tab.href || path.startsWith(`${tab.href}/`) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
