"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/bots", label: "Bots" },
  { href: "/groups", label: "Group chats" },
  { href: "/apps", label: "Apps" },
  { href: "/templates", label: "Templates" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="nav">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} aria-current={path === link.href || path.startsWith(`${link.href}/`) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
