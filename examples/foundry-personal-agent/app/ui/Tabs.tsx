"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/chat", label: "Chat" },
  { href: "/watch", label: "Watch" },
  { href: "/plans", label: "Plans" },
  { href: "/you", label: "You" },
] as const;

export function Tabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="tabs">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={path === tab.href || path.startsWith(`${tab.href}/`) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
